"""
Kotitaulun kotiagentti (Windows).

Ottaa Tapo-kameroista kuvan muutaman minuutin välein ja lähettää sen Kotitaululle.
Hakee lisäksi sähkönkulutuksen Caruna Plussasta muutaman tunnin välein.

Käyttö:
  python kotiagentti.py              pyörii taustalla (käynnistetään asenna.bat:lla)
  python kotiagentti.py --kerran     tekee yhden kierroksen ja tulostaa tuloksen
  python kotiagentti.py --testaa     ottaa kamerakuvat talteen tähän kansioon, ei lähetä mitään
"""
from __future__ import annotations

import argparse
import json
import logging
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import quote

import requests

VERSION = "1.2"
HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.json"
LOG = HERE / "kotiagentti.log"
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

log = logging.getLogger("kotiagentti")
_lock = None


def setup_logging(console: bool) -> None:
    log.setLevel(logging.INFO)
    fh = RotatingFileHandler(LOG, maxBytes=1_000_000, backupCount=2, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(fh)
    if console:
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(logging.Formatter("%(message)s"))
        log.addHandler(ch)


def load_config() -> dict:
    if not CONFIG.exists():
        sys.exit(f"Asetustiedosto puuttuu: {CONFIG}\nKopioi config.example.json nimelle config.json ja täytä se.")
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg["site_url"] = cfg["site_url"].rstrip("/")
    for key in ("site_url", "agent_key"):
        if not cfg.get(key) or "TÄYTÄ" in str(cfg.get(key)):
            sys.exit(f"Täytä '{key}' tiedostoon config.json")
    return cfg


# ---------------------------------------------------------------- Lähetys


class Site:
    def __init__(self, cfg: dict):
        self.url = cfg["site_url"] + "/api/upload"
        self.headers = {"x-agent-key": cfg["agent_key"], "x-agent-version": VERSION, "x-agent-commands": "1"}
        self.commands: list[dict] = []

    def post(self, params: dict, data: bytes | None = None, payload: dict | None = None) -> None:
        r = requests.post(self.url, params=params, data=data, json=payload, headers=self.headers, timeout=30)
        if r.status_code != 200:
            try:
                msg = r.json().get("error")
            except ValueError:
                msg = r.text[:200]
            raise RuntimeError(f"Kotitaulu vastasi {r.status_code}: {msg}")
        try:
            self.commands.extend(r.json().get("commands") or [])
        except ValueError:
            pass


# ---------------------------------------------------------------- Kamerat


def ffmpeg_path() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return "ffmpeg"


def snapshot(cam: dict) -> bytes:
    user = quote(cam["user"], safe="")
    pwd = quote(cam["password"], safe="")
    stream = cam.get("stream", "stream1")
    url = f"rtsp://{user}:{pwd}@{cam['host']}:{cam.get('port', 554)}/{stream}"
    cmd = [
        ffmpeg_path(), "-hide_banner", "-loglevel", "error",
        "-rtsp_transport", "tcp", "-timeout", "15000000",
        "-i", url,
        "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "5",
        "-f", "image2", "-vcodec", "mjpeg", "pipe:1",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=30, creationflags=CREATE_NO_WINDOW)
    except subprocess.TimeoutExpired:
        raise RuntimeError("kamera ei vastannut 30 sekunnissa")
    if res.returncode != 0 or len(res.stdout) < 1000:
        err = res.stderr.decode(errors="replace").strip().splitlines()
        # Ei salasanaa lokiin
        msg = (err[-1] if err else "tuntematon virhe").replace(cam["password"], "***")
        if "401" in msg or "Unauthorized" in msg:
            msg = "väärä kameratilin tunnus tai salasana (Tapo-sovellus: Kameratili)"
        raise RuntimeError(msg)
    return res.stdout


def run_cameras(cfg: dict, site: Site | None, save_dir: Path | None = None) -> None:
    for cam in cfg.get("cameras", []):
        cid, name = cam["id"], cam.get("name", cam["id"])
        try:
            jpg = snapshot(cam)
            taken = datetime.now(timezone.utc).isoformat(timespec="seconds")
            if save_dir:
                (save_dir / f"testi-{cid}.jpg").write_bytes(jpg)
                log.info(f"OK  {name}: {len(jpg) // 1024} kt tallennettu tiedostoon testi-{cid}.jpg")
            else:
                site.post({"type": "cam", "id": cid, "name": name, "taken": taken}, data=jpg)
                log.info(f"OK  {name}: kuva lähetetty ({len(jpg) // 1024} kt)")
        except Exception as e:  # noqa: BLE001
            log.warning(f"VIRHE {name}: {e}")
            if site and not save_dir:
                try:
                    site.post({"type": "cam-error"}, payload={"id": cid, "name": name, "error": str(e)})
                except Exception:  # noqa: BLE001
                    pass


# ---------------------------------------------------------------- Kameravahti

KIND_RANK = {"liike": 1, "eläin": 2, "ajoneuvo": 3, "henkilö": 4}


class CameraWatch:
    """
    Kuuntelee kameran liike- ja henkilötapahtumia (ONVIF) ja lähettää havainnosta heti kuvan.
    Ottaa lisäksi tavallisen kuvan, kun edellisestä lähetetystä kuvasta on kulunut snapshot_minutes.
    Havaintokuva nollaa tavallisen kuvan laskurin, joten se ei ylikirjoitu heti.
    """

    def __init__(self, cam: dict, site: Site, cfg: dict):
        import threading

        self.cam = cam
        self.site = site
        self.id = cam["id"]
        self.name = cam.get("name", cam["id"])
        self.every = max(1, int(cfg.get("snapshot_minutes", 15))) * 60
        self.cooldown = max(5, int(cfg.get("event_cooldown_seconds", 30)))
        self.second_delay = float(cfg.get("event_second_shot_seconds", 2))
        self.watch_enabled = cam.get("events", True) and cfg.get("events", True)
        self.lock = threading.Lock()  # yksi ffmpeg-yhteys kerrallaan per kamera
        self.last_upload = 0.0  # time.time()
        self.last_event = 0.0
        self.last_kind = ""
        self.stop = threading.Event()

    # -- kuvat
    def _shoot_and_send(self, kind: str | None, seq: int = 1) -> bool:
        with self.lock:
            try:
                jpg = snapshot(self.cam)
            except Exception as e:  # noqa: BLE001
                log.warning(f"VIRHE {self.name}: {e}")
                try:
                    self.site.post({"type": "cam-error"}, payload={"id": self.id, "name": self.name, "error": str(e)})
                except Exception:  # noqa: BLE001
                    pass
                return False
        taken = datetime.now(timezone.utc).isoformat(timespec="seconds")
        params = {"type": "cam", "id": self.id, "name": self.name, "taken": taken}
        if kind:
            params.update({"event": kind, "seq": seq})
        try:
            self.site.post(params, data=jpg)
        except Exception as e:  # noqa: BLE001
            log.warning(f"VIRHE {self.name}: kuvan lähetys epäonnistui: {e}")
            return False
        self.last_upload = time.time()
        log.info(f"OK  {self.name}: {'havainto ' + kind if kind else 'kuva'} lähetetty ({len(jpg) // 1024} kt)")
        return True

    def periodic_due(self) -> bool:
        return time.time() - self.last_upload >= self.every - 5

    def periodic(self) -> None:
        if self.periodic_due():
            if not self._shoot_and_send(None):
                # Yritetään uudelleen seuraavalla kierroksella, mutta ei joka minuutti.
                self.last_upload = time.time() - self.every + 120

    def on_event(self, kind: str) -> None:
        now = time.time()
        recent = now - self.last_event < self.cooldown
        # Saman havainnon aikana lähetetään uusi kuva vain, jos laji "paranee" (liike -> henkilö).
        if recent and KIND_RANK.get(kind, 0) <= KIND_RANK.get(self.last_kind, 0):
            return
        self.last_event, self.last_kind = now, kind
        if self._shoot_and_send(kind, 1) and self.second_delay > 0:
            time.sleep(self.second_delay)
            self._shoot_and_send(kind, 2)

    # -- tapahtumien kuuntelu
    def watch(self) -> None:
        import liike

        backoff = 5
        while not self.stop.is_set():
            lst = liike.EventListener(self.cam["host"], self.cam["user"], self.cam["password"], int(self.cam.get("onvif_port", 2020)))
            try:
                lst.subscribe(minutes=10)
                log.info(f"OK  {self.name}: kuunnellaan liike- ja henkilötapahtumia")
                backoff = 5
                renewed = time.monotonic()
                errors = 0
                while not self.stop.is_set():
                    if time.monotonic() - renewed > 300:
                        lst.renew(10)
                        renewed = time.monotonic()
                    try:
                        events = lst.pull(wait_seconds=10)
                        errors = 0
                    except liike.OnvifError:
                        errors += 1
                        if errors >= 3:
                            raise
                        time.sleep(2)
                        continue
                    best = None
                    for ev in events:
                        k = liike.classify(ev)
                        if k and KIND_RANK.get(k, 0) > KIND_RANK.get(best or "", 0):
                            best = k
                    if best:
                        self.on_event(best)
            except Exception as e:  # noqa: BLE001
                log.warning(f"{self.name}: tapahtumien kuuntelu katkesi ({e}), yhdistetään uudelleen {backoff} s päästä")
            finally:
                try:
                    lst.unsubscribe()
                except Exception:  # noqa: BLE001
                    pass
            self.stop.wait(backoff)
            backoff = min(backoff * 2, 300)

    def start(self) -> None:
        import threading

        if self.watch_enabled:
            threading.Thread(target=self.watch, name=f"watch-{self.id}", daemon=True).start()


# ---------------------------------------------------------------- Caruna


def helsinki_date(ts: str) -> str:
    from zoneinfo import ZoneInfo

    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt.astimezone(ZoneInfo("Europe/Helsinki")).date().isoformat()


class CarunaLoginError(RuntimeError):
    pass


def _visible_text(html: bytes | str, limit: int = 200) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style"]):
        t.decompose()
    return " ".join(soup.get_text(" ").split())[:limit]


def _refresh_url(html: bytes) -> str:
    """Palauttaa <meta http-equiv="refresh" content="0;URL=..."> -ohjauksen osoitteen."""
    from bs4 import BeautifulSoup

    meta = BeautifulSoup(html, "lxml").find("meta")
    if not meta or "content" not in meta.attrs:
        raise CarunaLoginError(f"odotettua ohjausta ei löytynyt. Sivun teksti: {_visible_text(html)}")
    content = meta["content"]
    i = content.lower().find("url=")
    return content[i + 4:].strip() if i >= 0 else content[6:]


def caruna_login(username: str, password: str) -> dict:
    """Caruna Plus -kirjautuminen (pycarunan menetelmä) vaihe kerrallaan selkeillä virheillä."""
    from urllib.parse import parse_qs, urlparse

    from bs4 import BeautifulSoup

    api = "https://plus.caruna.fi/api"
    auth = "https://authentication2.caruna.fi"
    s = requests.session()
    s.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kotitaulu"

    def step(n: int, what: str, fn):
        try:
            return fn()
        except CarunaLoginError:
            raise
        except Exception as e:  # noqa: BLE001
            raise CarunaLoginError(f"vaihe {n}/7 ({what}) epäonnistui: {type(e).__name__} {e}") from e

    def hidden(soup):
        out = {}
        for i in soup.find_all("input", type="hidden"):
            out[i.get("name")] = i.get("value", "")
        return out

    r = step(1, "kirjautumisen aloitus", lambda: s.post(f"{api}/authorization/login", json={"language": "fi", "redirectAfterLogin": "https://plus.caruna.fi/"}, timeout=30))
    r = step(2, "ohjaus kirjautumissivulle", lambda: s.get(r.json()["loginRedirectUrl"], timeout=30))
    r = step(3, "kirjautumissivun avaus", lambda: s.get(auth + _refresh_url(r.content), timeout=30))

    soup = BeautifulSoup(r.content, "lxml")
    if not soup.find("input", attrs={"name": "ttqusername"}):
        raise CarunaLoginError(
            "Caruna Plussan kirjautumissivulla ei ole enää sähköposti- ja salasanakenttää. "
            "Caruna on muuttanut kirjautumistaan, eikä automaattinen haku toimi. "
            f"Sivun teksti: {_visible_text(r.content)}"
        )
    form = hidden(soup)
    form["ttqusername"] = username
    form["userPassword"] = password
    submit = soup.find("input", type="submit")
    if submit and submit.get("name"):
        form[submit["name"]] = "1"
    r = step(4, "tunnusten lähetys", lambda: s.post(
        f"{auth}/portal/login?2-1.0-userIDPanel-usernameLogin-loginWithUserID",
        data=form,
        headers={
            "Wicket-Ajax": "true", "Wicket-Ajax-BaseURL": "login", "Wicket-FocusedElementId": "loginWithUserID5",
            "X-Requested-With": "XMLHttpRequest", "Origin": auth, "Referer": f"{auth}/portal/login",
        },
        timeout=30,
    ))
    loc = r.headers.get("Ajax-Location")
    if not loc:
        txt = _visible_text(r.content, 300).replace(password, "***")
        hint = "Tarkista sähköposti ja salasana kirjautumalla osoitteessa plus.caruna.fi."
        raise CarunaLoginError(f"Caruna ei hyväksynyt kirjautumista. {hint} Vastaus: {txt or '(tyhjä)'}")

    r = step(5, "kirjautumisen jatko", lambda: s.get(f"{auth}/portal{loc[1:]}", timeout=30))
    r = step(6, "paluu Caruna Plussaan", lambda: s.get(_refresh_url(r.content), timeout=30))
    soup = BeautifulSoup(r.content, "lxml")

    def finish():
        rr = s.post(soup.find("form")["action"], data=hidden(soup), allow_redirects=False, timeout=30)
        rr = s.get(rr.headers["Location"], allow_redirects=False, timeout=30)
        q = parse_qs(urlparse(rr.headers["Location"]).query)
        params = {"code": q["code"][0], "state": q["state"][0], "session_state": q["session_state"][0]}
        tok = s.post(f"{api}/authorization/token", data=params, timeout=30)
        tok.raise_for_status()
        return tok.json()

    return step(7, "tunnisteen haku", finish)


KWH_KEYS = ("consumption", "totalConsumption", "boughtenergy", "boughtEnergy", "energy", "value", "kwh", "amount")
TS_KEYS = ("timestamp", "time", "date", "startTime", "start", "from")


def row_kwh(row: dict):
    for k in KWH_KEYS:
        v = row.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


def row_ts(row: dict):
    for k in TS_KEYS:
        v = row.get(k)
        if isinstance(v, str) and len(v) >= 10:
            return v
    return None


def _all_row_lists(obj, depth=0):
    """Etsii vastauksesta kaikki listat, joiden alkiot näyttävät kulutusriveiltä."""
    if depth > 5:
        return
    if isinstance(obj, list):
        rows = [r for r in obj if isinstance(r, dict)]
        if rows and any(row_ts(r) for r in rows):
            yield rows
        for r in rows:
            yield from _all_row_lists(r, depth + 1)
    elif isinstance(obj, dict):
        for v in obj.values():
            if isinstance(v, (list, dict)):
                yield from _all_row_lists(v, depth + 1)


def energy_rows(res) -> list[dict]:
    """Palauttaa vastauksesta sen rivilistan, jossa on eniten kulutuslukemia."""
    best: list[dict] = []
    best_n = -1
    for rows in _all_row_lists(res):
        n = sum(1 for r in rows if row_kwh(r) is not None and row_ts(r))
        if n > best_n:
            best, best_n = rows, n
    return best


def _save_debug(debug: dict) -> None:
    try:
        (HERE / "caruna-vastaus.json").write_text(json.dumps(debug, ensure_ascii=False, indent=1, default=str)[:300_000], encoding="utf-8")
        log.info("Carunan vastaus tallennettu tiedostoon caruna-vastaus.json")
    except Exception:  # noqa: BLE001
        pass


def _fetch_daily(client, TimeSpan, customer: str, asset_id: str, debug: dict) -> dict[str, dict]:
    today = date.today()
    prev = today.replace(day=1) - timedelta(days=1)
    daily: dict[str, dict] = {}
    for d in (prev, today):
        res = client.get_energy(customer, asset_id, TimeSpan.MONTHLY, d.year, d.month, 1)
        debug[f"energy_{asset_id}_{d.year}_{d.month:02d}"] = res
        for row in energy_rows(res):
            kwh, ts = row_kwh(row), row_ts(row)
            if kwh is None or not ts:
                continue
            key = helsinki_date(ts) if "T" in ts else ts[:10]
            cost = row.get("totalcost", row.get("totalCost"))
            daily[key] = {
                "date": key,
                "kwh": round(kwh, 2),
                "temp": row.get("temperature"),
                "cost": round(cost, 2) if isinstance(cost, (int, float)) else None,
            }
    return daily


def run_caruna(cfg: dict, site: Site | None) -> None:
    c = cfg.get("caruna") or {}
    if not c.get("username") or "TÄYTÄ" in c.get("username", ""):
        log.info("Caruna-tunnuksia ei ole asetettu, sähkönkulutus ohitetaan.")
        return
    from pycaruna import CarunaPlus, TimeSpan

    debug: dict = {}
    try:
        login = caruna_login(c["username"], c["password"])
        user = login.get("user") or {}
        debug["customers"] = {"own": user.get("ownCustomerNumbers"), "represented": user.get("representedCustomerNumbers")}
        customers = [c["customer_id"]] if c.get("customer_id") else (user.get("ownCustomerNumbers") or []) + (user.get("representedCustomerNumbers") or [])
        if not customers:
            raise RuntimeError("Caruna-tililtä ei löytynyt asiakasnumeroa")
        client = CarunaPlus(login["token"])

        # Käydään läpi kaikki asiakkuudet ja käyttöpaikat, kunnes löytyy kulutusta.
        chosen = None
        daily: dict[str, dict] = {}
        for customer in customers:
            raw = client.get_assets(customer)
            debug[f"assets_{customer}"] = raw
            if isinstance(raw, dict):
                raw = raw.get("assets") or raw.get("results") or raw.get("data") or [raw]
            assets = [a for a in raw if isinstance(a, dict)]
            ids = [c["asset_id"]] if c.get("asset_id") else [
                a.get("assetId") or a.get("id")
                for a in sorted(assets, key=lambda a: a.get("type") != "meteringPoint")
                if a.get("assetId") or a.get("id")
            ]
            for asset_id in ids:
                try:
                    daily = _fetch_daily(client, TimeSpan, customer, asset_id, debug)
                except Exception as e:  # noqa: BLE001
                    debug[f"error_{asset_id}"] = str(e)
                    continue
                if daily:
                    chosen = (customer, asset_id)
                    break
            if chosen:
                break

        if not chosen:
            _save_debug(debug)
            raise RuntimeError("kirjautuminen onnistui, mutta Caruna ei palauttanut kulutuslukemia yhdellekään käyttöpaikalle")
        customer, asset_id = chosen

        yesterday = date.today() - timedelta(days=1)
        hourly = []
        try:
            res = client.get_energy(customer, asset_id, TimeSpan.DAILY, yesterday.year, yesterday.month, yesterday.day)
            seen = set()
            for row in energy_rows(res):
                kwh, ts = row_kwh(row), row_ts(row)
                if kwh is None or not ts or ts in seen:
                    continue  # kesäaikamuutoksessa sama tunti voi tulla kahdesti
                seen.add(ts)
                hourly.append({"ts": ts, "kwh": kwh})
        except Exception as e:  # noqa: BLE001
            log.info(f"Tuntikulutusta ei saatu: {e}")

        days = sorted(daily.values(), key=lambda x: x["date"])[-45:]
        if site is None:
            _save_debug(debug)
            last = days[-1]
            log.info(f"OK  Caruna: {len(days)} päivää kulutusta, viimeisin {last['date']}: {last['kwh']} kWh (käyttöpaikka {asset_id})")
            return
        site.post({"type": "energy"}, payload={"daily": days, "hourly": hourly})
        log.info(f"OK  Caruna: {len(days)} päivää lähetetty")
    except Exception as e:  # noqa: BLE001
        import traceback

        msg = str(e).replace(c.get("password", "") or "\0", "***")
        where = traceback.extract_tb(e.__traceback__)[-1]
        log.warning(f"VIRHE Caruna: {msg} (rivi {where.lineno})")
        if debug and site is None and "ei palauttanut kulutuslukemia" not in msg:
            _save_debug(debug)
        if site is None:
            return
        try:
            site.post({"type": "energy-error"}, payload={"error": f"Caruna-haku epäonnistui: {msg[:250]}"})
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------- Liiketapahtumat


def test_motion(cfg: dict, seconds: int) -> None:
    import threading

    import liike

    cams = cfg.get("cameras", [])
    found: dict[str, dict] = {}
    lock = threading.Lock()

    def listen(cam: dict) -> None:
        name = cam.get("name", cam["id"])
        lst = liike.EventListener(cam["host"], cam["user"], cam["password"], int(cam.get("onvif_port", 2020)))
        try:
            lst.subscribe(minutes=max(2, seconds // 60 + 2))
            log.info(f"OK  {name}: tapahtumatilaus onnistui, kuunnellaan")
        except Exception as e:  # noqa: BLE001
            log.warning(f"VIRHE {name}: {e}")
            return
        end = time.monotonic() + seconds
        try:
            while time.monotonic() < end:
                try:
                    events = lst.pull(wait_seconds=min(10, max(1, int(end - time.monotonic()))))
                except Exception as e:  # noqa: BLE001
                    log.warning(f"VIRHE {name}: {e}")
                    time.sleep(2)
                    continue
                for ev in events:
                    kind = liike.classify(ev)
                    stamp = datetime.now().strftime("%H.%M.%S")
                    vals = ", ".join(f"{k}={v}" for k, v in ev["data"].items())
                    log.info(f"{stamp}  {name}: {ev['topic']}  {vals}" + (f"  ->  {kind.upper()}" if kind else ""))
                    with lock:
                        found.setdefault(name, {}).setdefault(ev["topic"], set()).add(kind or "-")
        finally:
            lst.unsubscribe()

    log.info(f"Kuunnellaan {len(cams)} kameran tapahtumia {seconds} sekuntia.")
    log.info("Kävele nyt kameran edestä tai heiluta kättä kameran edessä.")
    threads = [threading.Thread(target=listen, args=(c,), daemon=True) for c in cams]
    for t in threads:
        t.start()
    for t in threads:
        t.join(seconds + 40)

    log.info("")
    log.info("YHTEENVETO")
    for c in cams:
        name = c.get("name", c["id"])
        topics = found.get(name)
        if not topics:
            log.info(f"{name}: ei tapahtumia")
            continue
        for topic, kinds in topics.items():
            k = ", ".join(sorted(x for x in kinds if x != "-")) or "vain alku-/lopputila"
            log.info(f"{name}: {topic}  ({k})")


# ---------------------------------------------------------------- Lämpöpumppu


class HeatPump:
    """Pitää yhteyden ilmalämpöpumppuun ja välittää sen tilan Kotitauluun."""

    def __init__(self, cfg: dict):
        c = cfg.get("lampopumppu") or {}
        self.enabled = bool(c) and c.get("enabled", True)
        self.host = c.get("host") or ""
        self.name = c.get("name") or "Ilmalämpöpumppu"
        self.dev = None

    def _device(self):
        import lampopumppu as lp

        if self.dev is None:
            if not self.host:
                hits = [d for d in lp.discover() if d.devtype == lp.DEVICE_TYPE]
                if not hits:
                    raise RuntimeError("lämpöpumppua ei löytynyt verkosta, lisää sen IP config.json-tiedostoon")
                self.host = hits[0].host[0]
                log.info(f"Lämpöpumppu löytyi osoitteesta {self.host}")
            self.dev = lp.connect(self.host)
        return self.dev

    def _call(self, fn):
        try:
            return fn(self._device())
        except Exception:
            self.dev = None  # yhdistetään uudelleen seuraavalla yrityksellä
            return fn(self._device())

    def execute(self, commands: list[dict]) -> list[dict]:
        done = []
        for c in commands:
            action, value = c.get("action"), c.get("value")
            try:
                if action == "power":
                    self._call(lambda d: d.set_power(bool(value)))
                elif action == "temp":
                    self._call(lambda d: d.set_temp(int(value)))
                elif action == "mode":
                    self._call(lambda d: d.set_mode(int(value)))
                elif action == "fan":
                    self._call(lambda d: d.set_fan(int(value)))
                else:
                    raise ValueError("tuntematon komento")
                done.append({"id": c.get("id"), "action": action, "value": value, "ok": True})
                log.info(f"OK  Lämpöpumppu: {action} = {value}")
            except Exception as e:  # noqa: BLE001
                done.append({"id": c.get("id"), "action": action, "value": value, "ok": False, "error": str(e)[:120]})
                log.warning(f"VIRHE lämpöpumppu {action}={value}: {e}")
            time.sleep(0.5)
        return done

    def report(self, site: Site, executed: list[dict] | None = None) -> None:
        if not self.enabled:
            return
        import lampopumppu as lp

        payload: dict = {"name": self.name, "executed": executed or []}
        try:
            payload["state"] = lp.summarize(self._call(lambda d: d.status()))
        except Exception as e:  # noqa: BLE001
            payload["error"] = f"Lämpöpumppu ei vastannut: {e}"
            log.warning(f"VIRHE lämpöpumppu: {e}")
        site.post({"type": "heatpump"}, payload=payload)


def test_heatpump(ip: str) -> None:
    try:
        import lampopumppu as lp
    except ImportError as e:
        log.warning(f"VIRHE: broadlink-kirjasto puuttuu ({e}). Aja asenna.bat uudelleen.")
        return

    if not ip:
        log.info("Etsitään Broadlink-laitteita kotiverkosta (noin 6 s)...")
        try:
            devices = lp.discover()
        except Exception as e:  # noqa: BLE001
            log.warning(f"VIRHE haussa: {e}")
            devices = []
        for d in devices:
            mark = "  <-- Electrolux-ilmalämpöpumppu" if d.devtype == lp.DEVICE_TYPE else ""
            log.info(f"Löytyi: {d.host[0]}  tyyppi 0x{d.devtype:04X}  {d.model or ''} {d.manufacturer or ''}{mark}")
        hits = [d for d in devices if d.devtype == lp.DEVICE_TYPE]
        if not hits:
            log.warning(
                "Lämpöpumppua ei löytynyt automaattisesti. Katso sen IP-osoite reitittimestä "
                "ja aja: testaa-lampopumppu.bat 192.168.x.x"
            )
            return
        ip = hits[0].host[0]

    log.info(f"Yhdistetään lämpöpumppuun {ip}...")
    try:
        hp = lp.connect(ip)
        st = hp.status()
    except Exception as e:  # noqa: BLE001
        log.warning(f"VIRHE: {type(e).__name__} {e}")
        log.warning("Tarkista IP-osoite ja että kone ja lämpöpumppu ovat samassa verkossa.")
        return
    s = lp.summarize(st)
    log.info(
        f"OK  Lämpöpumppu vastaa: {'päällä' if s['on'] else 'pois päältä'}, tila {s['modeText']}, "
        f"asetus {s['target']} °C, huone {s['room']} °C, puhallin {s['fanText']}"
    )
    (HERE / "lampopumppu-vastaus.json").write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info(f"Koko vastaus tallennettu tiedostoon lampopumppu-vastaus.json. IP-osoite: {ip}")


# ---------------------------------------------------------------- Pääsilmukka


def main() -> None:
    ap = argparse.ArgumentParser(description="Kotitaulun kotiagentti")
    ap.add_argument("--kerran", action="store_true", help="tee yksi kierros ja lopeta")
    ap.add_argument("--testaa", action="store_true", help="tallenna kamerakuvat paikallisesti, älä lähetä")
    ap.add_argument("--caruna", action="store_true", help="testaa vain Caruna-kirjautuminen, älä lähetä")
    ap.add_argument("--lampopumppu", nargs="?", const="", metavar="IP", help="etsi ja testaa ilmalämpöpumppu")
    ap.add_argument("--liike", nargs="?", const=60, type=int, metavar="SEK", help="kuuntele kameroiden liiketapahtumia")
    args = ap.parse_args()
    setup_logging(console=args.kerran or args.testaa or args.caruna or args.lampopumppu is not None or args.liike is not None)

    if args.lampopumppu is not None:
        test_heatpump(args.lampopumppu)
        return

    cfg = load_config()

    if args.liike is not None:
        test_motion(cfg, args.liike)
        return

    if args.caruna:
        log.info("Testataan Caruna (mitään ei lähetetä)...")
        run_caruna(cfg, None)
        return

    if args.testaa:
        log.info("Testataan kamerat (mitään ei lähetetä)...")
        run_cameras(cfg, None, save_dir=HERE)
        return

    if not args.kerran:
        # Estää kaksi samanaikaista agenttia (esim. kaksi kirjautumista).
        import socket

        global _lock
        _lock = socket.socket()
        try:
            _lock.bind(("127.0.0.1", 47321))
        except OSError:
            log.info("Agentti on jo käynnissä, tämä kopio lopettaa.")
            return

    site = Site(cfg)
    hp = HeatPump(cfg)
    interval = max(1, int(cfg.get("interval_minutes", 5))) * 60
    caruna_every = max(1, int(cfg.get("caruna_every_hours", 3))) * 3600
    tick = max(20, int(cfg.get("command_poll_seconds", 60)))
    watches = [CameraWatch(c, site, cfg) for c in cfg.get("cameras", [])]
    last_round = -1e9
    last_caruna = 0.0
    log.info(
        f"Kotiagentti {VERSION} käynnistyi, {len(watches)} kameraa (kuva {watches[0].every // 60 if watches else '-'} min välein"
        f" ja havainnoista), lämpöpumppu {hp.host or '(haetaan verkosta)' if hp.enabled else 'ei käytössä'}"
    )
    if not args.kerran:
        for w in watches:
            w.start()

    while True:
        started = time.monotonic()
        try:
            for w in watches:
                w.periodic()
            if started - last_round >= interval - 1:
                last_round = started
                if time.time() - last_caruna > caruna_every:
                    run_caruna(cfg, site)
                    last_caruna = time.time()
                hp.report(site)
            site.post({"type": "heartbeat"})
            if site.commands and hp.enabled:
                cmds, site.commands = site.commands, []
                done = hp.execute(cmds)
                time.sleep(2)  # laite päivittää tilansa hetken viiveellä
                hp.report(site, executed=done)
            if not hp.enabled:
                site.commands = []
        except Exception as e:  # noqa: BLE001
            log.warning(f"Kierros epäonnistui: {e}")
        if args.kerran:
            return
        time.sleep(max(5, tick - (time.monotonic() - started)))

if __name__ == "__main__":
    main()

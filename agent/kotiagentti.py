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

VERSION = "1.0"
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
        self.headers = {"x-agent-key": cfg["agent_key"], "x-agent-version": VERSION}

    def post(self, params: dict, data: bytes | None = None, payload: dict | None = None) -> None:
        r = requests.post(self.url, params=params, data=data, json=payload, headers=self.headers, timeout=30)
        if r.status_code != 200:
            try:
                msg = r.json().get("error")
            except ValueError:
                msg = r.text[:200]
            raise RuntimeError(f"Kotitaulu vastasi {r.status_code}: {msg}")


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


# ---------------------------------------------------------------- Caruna


def helsinki_date(ts: str) -> str:
    from zoneinfo import ZoneInfo

    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt.astimezone(ZoneInfo("Europe/Helsinki")).date().isoformat()


def run_caruna(cfg: dict, site: Site) -> None:
    c = cfg.get("caruna") or {}
    if not c.get("username") or "TÄYTÄ" in c.get("username", ""):
        return
    from pycaruna import Authenticator, CarunaPlus, TimeSpan

    try:
        login = Authenticator(c["username"], c["password"]).login()
        token = login["token"]
        customer = c.get("customer_id") or login["user"]["ownCustomerNumbers"][0]
        client = CarunaPlus(token)
        assets = [a for a in client.get_assets(customer) if a.get("type") == "meteringPoint"] or client.get_assets(customer)
        asset_id = c.get("asset_id") or assets[0]["assetId"]

        today = date.today()
        prev = (today.replace(day=1) - timedelta(days=1))
        daily: dict[str, dict] = {}
        for d in (prev, today):
            res = client.get_energy(customer, asset_id, TimeSpan.MONTHLY, d.year, d.month, 1)
            for row in res["results"][0]["data"]:
                if row.get("consumption") is None:
                    continue
                key = helsinki_date(row["timestamp"])
                daily[key] = {
                    "date": key,
                    "kwh": round(row["consumption"], 2),
                    "temp": row.get("temperature"),
                    "cost": round(row["totalcost"], 2) if row.get("totalcost") is not None else None,
                }
        yesterday = today - timedelta(days=1)
        hourly = []
        try:
            res = client.get_energy(customer, asset_id, TimeSpan.DAILY, yesterday.year, yesterday.month, yesterday.day)
            seen = set()
            for row in res["results"][0]["data"]:
                if row.get("consumption") is None or row["timestamp"] in seen:
                    continue  # kesäaikamuutoksessa sama tunti voi tulla kahdesti
                seen.add(row["timestamp"])
                hourly.append({"ts": row["timestamp"], "kwh": row["consumption"]})
        except Exception as e:  # noqa: BLE001
            log.info(f"Tuntikulutusta ei saatu: {e}")

        days = sorted(daily.values(), key=lambda x: x["date"])[-45:]
        site.post({"type": "energy"}, payload={"daily": days, "hourly": hourly})
        log.info(f"OK  Caruna: {len(days)} päivää lähetetty")
    except Exception as e:  # noqa: BLE001
        msg = str(e).replace(c.get("password", "") or "\0", "***")
        log.warning(f"VIRHE Caruna: {msg}")
        try:
            site.post({"type": "energy-error"}, payload={"error": f"Caruna-haku epäonnistui: {msg[:150]}"})
        except Exception:  # noqa: BLE001
            pass


# ---------------------------------------------------------------- Pääsilmukka


def main() -> None:
    ap = argparse.ArgumentParser(description="Kotitaulun kotiagentti")
    ap.add_argument("--kerran", action="store_true", help="tee yksi kierros ja lopeta")
    ap.add_argument("--testaa", action="store_true", help="tallenna kamerakuvat paikallisesti, älä lähetä")
    args = ap.parse_args()
    setup_logging(console=args.kerran or args.testaa)
    cfg = load_config()

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
    interval = max(1, int(cfg.get("interval_minutes", 5))) * 60
    caruna_every = max(1, int(cfg.get("caruna_every_hours", 3))) * 3600
    last_caruna = 0.0
    log.info(f"Kotiagentti {VERSION} käynnistyi, {len(cfg.get('cameras', []))} kameraa, väli {interval // 60} min")

    while True:
        started = time.monotonic()
        try:
            run_cameras(cfg, site)
            if time.time() - last_caruna > caruna_every:
                run_caruna(cfg, site)
                last_caruna = time.time()
            site.post({"type": "heartbeat"})
        except Exception as e:  # noqa: BLE001
            log.warning(f"Kierros epäonnistui: {e}")
        if args.kerran:
            return
        time.sleep(max(10, interval - (time.monotonic() - started)))


if __name__ == "__main__":
    main()

"use strict";

const TZ = "Europe/Helsinki";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (opts) => new Intl.DateTimeFormat("fi-FI", { timeZone: TZ, ...opts });
const fmtHour = fmt({ hour: "2-digit", minute: "2-digit" });
const fmtDay = fmt({ weekday: "short" });
const fmtDate = fmt({ weekday: "long", day: "numeric", month: "numeric" });
const fmtShort = fmt({ day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const num = (v, d = 0) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "–";
  const r = Number(Number(v).toFixed(d));
  return (r === 0 ? 0 : r).toLocaleString("fi-FI", { maximumFractionDigits: d, minimumFractionDigits: d });
};
const icon = (s) => (s ? `<svg class="icon" aria-hidden="true"><use href="#i-${esc(s)}"/></svg>` : "");

function ago(iso) {
  if (!iso) return "ei koskaan";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "juuri nyt";
  if (min < 60) return `${min} min sitten`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h sitten`;
  return fmtShort.format(new Date(iso));
}

async function api(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401) {
    showLogin();
    throw new Error("Kirjaudu sisään");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Virhe ${res.status}`);
  return data;
}

function failed(el, e) {
  el.innerHTML = `<p class="error">${esc(e.message)}</p>`;
}

// ---------------- Kirjautuminen ----------------
function showLogin() {
  $("app").hidden = true;
  $("login").hidden = false;
  stopTimers();
  setTimeout(() => $("password").focus(), 0);
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("login-error").textContent = "";
  const btn = ev.target.querySelector("button");
  btn.disabled = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Kirjautuminen epäonnistui");
    $("password").value = "";
    start();
  } catch (e) {
    $("login-error").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

$("logout").addEventListener("click", async () => {
  await fetch("/api/login", { method: "DELETE" });
  showLogin();
});

// ---------------- Sää ----------------
function tempChart(hours, width) {
  // Piirretään todelliseen leveyteen, jotta tekstit pysyvät luettavina puhelimessakin.
  const W = Math.max(300, Math.round(width || 640)), H = 170, padT = 26, padB = 34, rainH = 26;
  const pts = hours.filter((h) => h.temp !== null);
  if (pts.length < 2) return "";
  const temps = pts.map((h) => h.temp);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (t) => padT + (1 - (t - lo) / (hi - lo)) * (H - padT - padB - rainH);
  const line = pts.map((h, i) => `${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(" ");
  const base = H - padB - rainH;
  const fill = `0,${base} ${line} ${W},${base}`;
  const maxRain = Math.max(1, ...pts.map((h) => h.precip || 0));
  const bw = W / pts.length;
  const rain = pts.map((h, i) => {
    const r = h.precip || 0;
    if (r < 0.05) return "";
    const bh = Math.max(2, (r / maxRain) * rainH);
    return `<rect class="rain" x="${(x(i) - bw * 0.35).toFixed(1)}" y="${(H - padB - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>`;
  }).join("");
  const ticks = pts.map((h, i) => {
    if (i % (W < 520 ? 6 : 3) !== 0) return "";
    return `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="${padT - 6}" y2="${H - padB}"/>` +
      `<text x="${x(i)}" y="${H - 12}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(fmtHour.format(new Date(h.t)).slice(0, 2))}</text>` +
      `<text class="tlabel" x="${x(i)}" y="${y(h.temp) - 9}" text-anchor="${i === 0 ? "start" : "middle"}">${num(h.temp)}°</text>`;
  }).join("");
  const zero = lo < 0 && hi > 0 ? `<line class="zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>` : "";
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lämpötila ja sade seuraavat 24 tuntia">
    <polygon class="area-fill" points="${fill}"/>${zero}${rain}${ticks}<polyline class="line" points="${line}"/></svg></div>`;
}

async function loadWeather() {
  const el = $("weather");
  try {
    const w = await api("/api/weather");
    const n = w.now || {};
    const days = (w.days || []).map((d, i) => `
      <li>
        <span class="d">${i === 0 ? "Tänään" : esc(fmtDay.format(new Date(d.date + "T12:00:00Z")))}</span>
        ${icon(d.symbol)}
        <span class="hi">${num(d.max)}°</span>
        <span class="lo">${num(d.min)}°</span>
        <span class="pr">${d.precip >= 0.2 ? `${num(d.precip, 1)} mm` : ""}</span>
      </li>`).join("");
    el.innerHTML = `
      <div class="now">
        <div class="temp" aria-label="Lämpötila ${num(n.temp, 1)} astetta">${num(n.temp)}<sup>°C</sup></div>
        <div class="now-detail">
          <span class="now-text">${icon(n.symbol)}${esc(n.text || "")}</span>
          <span class="muted">Tuuli ${num(n.wind)} m/s${n.humidity != null ? `, kosteus ${num(n.humidity)} %` : ""}</span>
          <span class="muted">${esc(w.place)}, mitattu ${n.time ? esc(fmtHour.format(new Date(n.time))) : "–"}</span>
        </div>
      </div>
      ${tempChart(w.hours || [], el.clientWidth)}
      <ul class="days">${days}</ul>
      <p class="muted source">Lähde: ${esc(w.source)}</p>`;
  } catch (e) {
    failed(el, e);
  }
}

// ---------------- Auto ----------------
const PLUG = { CONNECTED: "Kytketty", DISCONNECTED: "Ei kytketty" };
const CHARGE = { IN_PROGRESS: "Lataa", CHARGING: "Lataa", COMPLETED: "Ladattu täyteen", STOPPED: "Lataus pysähtynyt", SCHEDULED: "Ajastettu", NOT_READY: "Ei valmis", FAULT: "Latausvirhe" };

async function loadCar() {
  const el = $("car");
  try {
    const d = await api("/api/ford");
    if (!d.configured) {
      el.innerHTML = `<div class="empty"><p>Ford-yhteyttä ei ole vielä asetettu.</p><p class="muted">Lisää FORD_CLIENT_ID ja FORD_CLIENT_SECRET Netlifyn asetuksiin. Ohjeet ovat README-tiedostossa.</p></div>`;
      return;
    }
    if (!d.authorized) {
      el.innerHTML = `<div class="empty"><p>Yhdistä Ford-tilisi, niin lataustaso näkyy tässä.</p><p><a class="btn" href="/api/ford-login">Yhdistä Ford-tili</a></p></div>`;
      return;
    }
    const c = d.car;
    const pct = c.soc ?? c.fuelLevel;
    const label = c.soc != null ? "akku" : "polttoaine";
    const charging = CHARGE[String(c.charging || "").toUpperCase()];
    const plug = PLUG[String(c.plug || "").toUpperCase()];
    const rows = [
      ["Toimintamatka", c.rangeKm != null ? `${num(c.rangeKm)} km` : null],
      ["Latausjohto", plug ? (charging && plug === "Kytketty" ? `${plug}, ${charging.toLowerCase()}` : plug) : null],
      ["Täynnä", c.minutesToFull > 0 && charging === "Lataa" ? `noin ${Math.floor(c.minutesToFull / 60)} h ${c.minutesToFull % 60} min` : null],
      ["Ovet", c.locked == null ? null : c.locked ? `<span class="good">Lukossa</span>` : `<span class="warn">Auki</span>`],
      ["Mittarilukema", c.odometerKm != null ? `${num(c.odometerKm)} km` : null],
      ["Sijainti", c.position ? `<a href="https://www.openstreetmap.org/?mlat=${c.position.lat}&mlon=${c.position.lon}#map=16/${c.position.lat}/${c.position.lon}" target="_blank" rel="noopener">Näytä kartalla</a>` : null],
    ].filter(([, v]) => v);
    el.innerHTML = `
      <div class="soc-row"><span class="soc">${num(pct)} %</span><span class="muted">${esc(label)}, ${esc(c.name)}</span></div>
      <div class="battery${pct != null && pct < 20 ? " low" : ""}"><span style="width:${Math.max(0, Math.min(100, pct || 0))}%"></span></div>
      <dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
      <p class="muted">Auto päivitti tiedot ${esc(ago(c.updated))}${d.stale ? ". Uusin haku epäonnistui, näytetään edellinen tieto." : ""}</p>`;
  } catch (e) {
    failed(el, e);
  }
}

// ---------------- Sähkö ----------------
function dayBars(daily) {
  const W = 420, H = 120, padB = 20;
  const days = daily.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.kwh || 0));
  const bw = W / days.length;
  return `<div class="bars"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Päiväkulutus viimeiset ${days.length} päivää">` +
    days.map((d, i) => {
      const h = ((d.kwh || 0) / max) * (H - padB - 14);
      const dt = new Date(d.date + "T12:00:00Z");
      const lbl = i % 2 === days.length % 2 ? "" : `<text x="${i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${dt.getUTCDate()}.${dt.getUTCMonth() + 1}.</text>`;
      return `<rect class="${i === days.length - 1 ? "last" : ""}" x="${(i * bw + bw * 0.15).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(d.date)}: ${num(d.kwh, 1)} kWh</title></rect>${lbl}`;
    }).join("") + `</svg></div>`;
}

async function loadEnergy() {
  const el = $("energy");
  try {
    const { data, lastError } = await api("/api/energy");
    if (!data) {
      el.innerHTML = `<div class="empty"><p>Kulutustietoja ei ole vielä tullut.</p><p class="muted">${lastError ? `Kotikoneen viimeisin yritys: ${esc(lastError.error)}` : "Ne tulevat kotikoneen agentilta, kun Caruna-tunnukset on asetettu."}</p></div>`;
      return;
    }
    const daily = (data.daily || []).filter((d) => d.kwh != null);
    const last = daily[daily.length - 1];
    const week = daily.slice(-7);
    const avg = week.length ? week.reduce((s, d) => s + d.kwh, 0) / week.length : null;
    const monthKey = last ? last.date.slice(0, 7) : "";
    const month = daily.filter((d) => d.date.startsWith(monthKey)).reduce((s, d) => s + d.kwh, 0);
    el.innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${num(last?.kwh, 1)}</b><span>kWh ${last ? esc(new Date(last.date + "T12:00:00Z").toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" })) : ""}</span></div>
        <div class="kpi"><b>${num(avg, 1)}</b><span>kWh/vrk, 7 pv ka.</span></div>
        <div class="kpi"><b>${num(month, 0)}</b><span>kWh tässä kuussa</span></div>
      </div>
      ${daily.length ? dayBars(daily) : ""}
      <p class="muted">Caruna päivittää tiedot noin vuorokauden viiveellä. Haettu ${esc(ago(data.receivedAt))}.${lastError ? ` Viimeisin haku epäonnistui: ${esc(lastError.error)}` : ""}</p>`;
  } catch (e) {
    failed(el, e);
  }
}

// ---------------- Kamerat ----------------
const STALE_MIN = 20;

async function loadCams() {
  const el = $("cams");
  try {
    const { cams, agentSeenAt } = await api("/api/cams");
    const agentMin = agentSeenAt ? (Date.now() - new Date(agentSeenAt)) / 60000 : Infinity;
    const st = $("agent-status");
    st.className = `agent ${agentMin < STALE_MIN ? "ok" : "bad"}`;
    st.textContent = agentSeenAt ? `Kotikone yhteydessä ${ago(agentSeenAt)}` : "Kotikone ei ole ollut yhteydessä";
    if (!cams.length) {
      el.innerHTML = `<div class="empty"><p>Kamerakuvia ei ole vielä tullut.</p><p class="muted">Käynnistä kotiagentti Windows-koneella. Kuvat päivittyvät, kun kone on päällä.</p></div>`;
      $("cams-meta").textContent = "";
      return;
    }
    $("cams-meta").textContent = "Päivittyy, kun kotikone on päällä";
    el.innerHTML = cams.map((c) => {
      if (!c.takenAt) {
        return `<figure class="cam missing"><div class="cam-missing"><b>${esc(c.name)}</b><span>Kuvaa ei ole vielä saatu.</span><span class="muted">${esc(c.error || "")}</span></div></figure>`;
      }
      const stale = (Date.now() - new Date(c.takenAt)) / 60000 > STALE_MIN;
      const err = c.error && c.errorAt > c.takenAt ? `Viimeisin virhe: ${c.error}` : "";
      return `<figure class="cam${stale ? " stale" : ""}">
        <button type="button" data-cam="${esc(c.id)}" data-name="${esc(c.name)}" data-taken="${esc(c.takenAt)}" aria-label="Avaa ${esc(c.name)} isona">
          <img src="/api/cam/${encodeURIComponent(c.id)}?t=${encodeURIComponent(c.takenAt)}" alt="${esc(c.name)}, kuva otettu ${esc(fmtShort.format(new Date(c.takenAt)))}" loading="lazy">
        </button>
        <figcaption><b>${esc(c.name)}</b><span class="age" title="${esc(err)}">${esc(ago(c.takenAt))}</span></figcaption>
      </figure>`;
    }).join("");
  } catch (e) {
    failed(el, e);
  }
}

$("cams").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-cam]");
  if (!b) return;
  $("cam-dialog-img").src = `/api/cam/${encodeURIComponent(b.dataset.cam)}?t=${Date.now()}`;
  $("cam-dialog-img").alt = b.dataset.name;
  $("cam-dialog-cap").textContent = `${b.dataset.name}, kuvattu ${fmtShort.format(new Date(b.dataset.taken))}`;
  $("cam-dialog").showModal();
});
$("cam-dialog").addEventListener("click", (ev) => {
  if (ev.target === $("cam-dialog")) $("cam-dialog").close();
});

// ---------------- Lähialue ----------------
async function loadArea() {
  const el = $("area");
  try {
    const a = await api("/api/area");
    $("situation-link").href = a.situationRoomUrl;
    let html = `<h3 class="subhead">Säävaroitukset</h3>`;
    if (a.warnings === null) html += `<p class="error">Varoituksia ei saatu: ${esc(a.warningsError)}</p>`;
    else if (!a.warnings.length) html += `<p class="calm">Ei voimassa olevia varoituksia alueellesi.</p>`;
    else html += `<ul class="list">${a.warnings.map((w) => `
      <li class="warning"><span class="dot ${esc(w.color)}" aria-hidden="true"></span>
        <div><div class="title">${esc(w.event)}${w.colorText ? ` (${esc(w.colorText)})` : ""}</div>
        <div class="sub">${esc(w.area)}, ${w.onset ? esc(fmtShort.format(new Date(w.onset))) : ""}–${w.expires ? esc(fmtShort.format(new Date(w.expires))) : ""}</div>
        ${w.description ? `<div class="sub">${esc(w.description)}</div>` : ""}</div></li>`).join("")}</ul>`;

    html += `<h3 class="subhead">Liikenne ${esc(a.radiusKm)} km säteellä</h3>`;
    if (a.traffic === null) html += `<p class="error">Liikennetietoja ei saatu: ${esc(a.trafficError)}</p>`;
    else if (!a.traffic.length) html += `<p class="calm">Ei liikennetiedotteita lähialueella.</p>`;
    else html += `<ul class="list">${a.traffic.map((t) => `
      <li><div class="title">${esc(t.title || t.type)}</div>
        <div class="sub">${esc(t.type)}, ${esc(t.distanceKm)} km${t.where ? `. ${esc(t.where)}` : ""}</div>
        <div class="sub">${t.start ? `Alkaen ${esc(fmtShort.format(new Date(t.start)))}` : ""}${t.end ? `, päättyy ${esc(fmtShort.format(new Date(t.end)))}` : ""}</div></li>`).join("")}</ul>`;
    el.innerHTML = html;
  } catch (e) {
    failed(el, e);
  }
}

// ---------------- Uutiset ----------------
async function loadNews() {
  const el = $("news");
  try {
    const n = await api("/api/news");
    el.innerHTML = `<ul class="list">${n.items.map((it) => `
      <li><a href="${esc(it.link)}" target="_blank" rel="noopener">
        <div class="title">${esc(it.title)}</div>
        <div class="sub">${esc(it.feed)}, ${it.time ? esc(ago(it.time)) : ""}</div></a></li>`).join("")}</ul>
      ${n.failed?.length ? `<p class="muted">Ei vastannut: ${esc(n.failed.join(", "))}</p>` : ""}`;
  } catch (e) {
    failed(el, e);
  }
}

// ---------------- Käynnistys ja päivitys ----------------
let timers = [];
function stopTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

function every(fn, ms) {
  timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
}

function refreshAll() {
  $("today").textContent = fmtDate.format(new Date()).replace(/^./, (c) => c.toUpperCase());
  loadWeather(); loadCams(); loadCar(); loadEnergy(); loadArea(); loadNews();
}

function showFordNotice() {
  const p = new URLSearchParams(location.search);
  if (!p.has("ford")) return;
  const n = $("notice");
  n.hidden = false;
  if (p.get("ford") === "ok") {
    n.className = "notice";
    n.textContent = "Ford-tili yhdistetty. Auton tiedot päivittyvät tähän.";
  } else {
    n.className = "notice err";
    n.textContent = `Ford-tilin yhdistäminen ei onnistunut: ${p.get("viesti") || "tuntematon virhe"}`;
  }
  history.replaceState(null, "", "/");
}

async function start() {
  const r = await fetch("/api/login").then((x) => x.json()).catch(() => ({ authed: false }));
  if (!r.authed) return showLogin();
  $("login").hidden = true;
  $("app").hidden = false;
  showFordNotice();
  stopTimers();
  refreshAll();
  every(loadCams, 60 * 1000);
  every(loadWeather, 10 * 60 * 1000);
  every(() => { loadCar(); loadArea(); loadNews(); loadEnergy(); }, 5 * 60 * 1000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("app").hidden) refreshAll();
});

start();

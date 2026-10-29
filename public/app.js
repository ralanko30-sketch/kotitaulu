"use strict";

const TZ = "Europe/Helsinki";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (opts) => new Intl.DateTimeFormat("fi-FI", { timeZone: TZ, ...opts });
const fmtHM = fmt({ hour: "numeric", minute: "2-digit" });
const fmtH = fmt({ hour: "2-digit", hour12: false });
const fmtDay = fmt({ weekday: "short" });
const fmtWeekday = fmt({ weekday: "long" });
const fmtLongDate = fmt({ weekday: "long", day: "numeric", month: "long" });
const fmtDM = fmt({ day: "numeric", month: "numeric" });
const fmtShort = fmt({ day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit" });
const fmtYMD = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const num = (v, d = 0) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "–";
  const r = Number(Number(v).toFixed(d));
  return (r === 0 ? 0 : r).toLocaleString("fi-FI", { maximumFractionDigits: d, minimumFractionDigits: d });
};
const icon = (s) => (s ? `<svg class="icon" aria-hidden="true"><use href="#i-${esc(s)}"/></svg>` : "");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const hourOf = (d) => Number(fmtH.format(d)) % 24;

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

// ---------------- Aurinko (SunCalc-menetelmä) ----------------
const RAD = Math.PI / 180;
function sunTimes(date, lat, lon) {
  const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = RAD * 23.4397;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJ = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const lw = RAD * -lon, phi = RAD * lat;
  const n = Math.round(toDays(date) - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosw = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosw < -1) return { polar: "day" };
  if (cosw > 1) return { polar: "night" };
  const w = Math.acos(cosw);
  const Jset = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJ(Jnoon - (Jset - Jnoon)), set: fromJ(Jset) };
}

let home = null; // { lat, lon } säädatasta
const sunCache = new Map();
function sunFor(d) {
  if (!home) return null;
  const key = fmtYMD.format(d);
  if (!sunCache.has(key)) sunCache.set(key, sunTimes(new Date(key + "T10:00:00Z"), home.lat, home.lon));
  return sunCache.get(key);
}
function isNight(d) {
  const s = sunFor(d);
  if (!s) { const h = hourOf(d); return h < 7 || h >= 19; }
  if (s.polar) return s.polar === "night";
  return d < s.rise || d > s.set;
}
const nightIcon = (sym, d) => (sym === "clear" || sym === "partly") && isNight(d) ? `${sym}-night` : sym;

function skyPhase(now) {
  const s = sunFor(now);
  if (!s || s.polar) return s?.polar === "day" ? "day" : "night";
  const m = 60 * 60000;
  if (now < s.rise - m || now > s.set + m) return "night";
  if (now < s.rise + m) return "dawn";
  if (now > s.set - m) return "dusk";
  return "day";
}

function renderSun() {
  const s = sunFor(new Date());
  if (!s) return;
  if (s.polar) { $("sun").textContent = s.polar === "day" ? "Aurinko ei laske" : "Kaamos"; return; }
  const len = Math.round((s.set - s.rise) / 60000);
  $("sun").innerHTML =
    `<span title="Auringonnousu">${icon("sunrise")}${esc(fmtHM.format(s.rise))}</span>` +
    `<span title="Auringonlasku">${icon("sunset")}${esc(fmtHM.format(s.set))}</span>` +
    `<span>Päivän pituus ${Math.floor(len / 60)} h ${len % 60} min</span>`;
  $("weather-panel").className = `weather sky-${skyPhase(new Date())}`;
}

// ---------------- Kello ----------------
function tick() {
  const now = new Date();
  $("clock-time").textContent = fmtHM.format(now);
  $("clock-time").dateTime = now.toISOString();
  $("clock-date").textContent = fmtLongDate.format(now);
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
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("password").value }) });
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

// ---------------- Teema ----------------
function applyThemeLabel() {
  $("theme").textContent = document.documentElement.dataset.theme === "light" ? "Tumma teema" : "Vaalea teema";
}
$("theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("kt-theme", next); } catch (e) {}
  applyThemeLabel();
  loadEnergy();
});

// ---------------- Koko näyttö ----------------
const fsEl = document.documentElement;
const canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function updateFsLabel() {
  $("fullscreen").hidden = !canFs;
  $("fullscreen").textContent = fsActive() ? "Poistu koko näytöstä" : "Koko näyttö";
  document.body.classList.toggle("is-fullscreen", fsActive());
}
$("fullscreen").addEventListener("click", async () => {
  try {
    if (fsActive()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl, { navigationUI: "hide" });
  } catch (e) {}
});
document.addEventListener("fullscreenchange", updateFsLabel);
document.addEventListener("webkitfullscreenchange", updateFsLabel);
// Koko näytössä hiiren osoitin piiloutuu, kun sitä ei liikuteta.
let cursorT;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("hide-cursor");
  clearTimeout(cursorT);
  cursorT = setTimeout(() => { if (fsActive()) document.body.classList.add("hide-cursor"); }, 3000);
});

// ---------------- Sää ----------------
let weatherData = null;
let selectedDay = 0;

function hoursForDay(w, i) {
  if (i === 0) return w.hours.slice(0, 25);
  const date = w.days[i]?.date;
  return w.hours.filter((h) => fmtYMD.format(new Date(h.t)) === date);
}

function timeline(hours, width, firstIsNow) {
  const pts = hours.filter((h) => h.temp !== null && h.temp !== undefined);
  if (pts.length < 2) return `<p class="muted">Tälle päivälle ei ole tuntiennustetta.</p>`;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const col = Math.max(rem * 2.55, Math.floor((width || 600) / pts.length));
  const W = col * pts.length, H = Math.round(rem * 4.6), padT = 10, padB = 6, rainH = Math.round(rem * 1.3);
  const temps = pts.map((h) => h.temp);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
  const x = (i) => col * i + col / 2;
  const y = (t) => padT + (1 - (t - lo) / (hi - lo)) * (H - padT - padB - rainH);
  const line = pts.map((h, i) => `${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(" ");
  const base = H - padB;
  const maxRain = Math.max(1, ...pts.map((h) => h.precip || 0));
  const rain = pts.map((h, i) => {
    const r = h.precip || 0;
    if (r < 0.05) return "";
    const bh = Math.max(2, (r / maxRain) * rainH);
    return `<rect class="rain" x="${(x(i) - col * 0.3).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${(col * 0.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>`;
  }).join("");
  const dots = pts.map((h, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(h.temp).toFixed(1)}" r="2.6"/>`).join("");
  const zero = lo < 0 && hi > 0 ? `<line class="zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>` : "";
  const cols = `grid-template-columns: repeat(${pts.length}, ${col}px)`;
  const cells = (fn, cls) => `<div class="tl-row ${cls}" style="${cols}">${pts.map(fn).join("")}</div>`;
  return `<div class="timeline" tabindex="0" aria-label="Tuntiennuste"><div class="tl-inner" style="width:${W}px">
    ${cells((h, i) => `<span${firstIsNow && i === 0 ? ' class="nowc"' : ""}>${firstIsNow && i === 0 ? "nyt" : String(hourOf(new Date(h.t))).padStart(2, "0")}</span>`, "tl-hour")}
    <svg class="tl-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lämpötila ja sade tunneittain">
      <defs><linearGradient id="tempfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#CFE7F2" stop-opacity=".30"/><stop offset="1" stop-color="#CFE7F2" stop-opacity="0"/></linearGradient></defs>
      <polygon class="fill" points="${x(0)},${base} ${line} ${x(pts.length - 1)},${base}"/>${zero}${rain}<polyline class="line" points="${line}"/>${dots}
    </svg>
    ${cells((h) => icon(nightIcon(h.symbol, new Date(h.t))), "tl-icon")}
    ${cells((h) => `<b>${num(h.temp)}°</b>`, "tl-temp")}
    ${cells((h) => `<span>${h.precip >= 0.1 ? num(h.precip, 1) : ""}</span>`, "tl-rain")}
    ${cells((h) => `<span>${h.wind != null ? num(h.wind) : ""}</span>`, "tl-wind")}
  </div></div>
  <div class="tl-legend muted"><span>Sade mm</span><span>Tuuli m/s</span><span class="src">Lähde: ${esc(weatherData?.source || "")}</span></div>`;
}

function renderWeather() {
  const w = weatherData;
  const el = $("weather");
  if (!w) return;
  const n = w.now || {};
  const nowD = n.time ? new Date(n.time) : new Date();
  const hrs = hoursForDay(w, selectedDay);
  const isToday = selectedDay === 0;
  const day = w.days[selectedDay];
  const dayTitle = isToday ? "Seuraavat 24 tuntia" : `${cap(fmtWeekday.format(new Date(day.date + "T12:00:00Z")))} ${fmtDM.format(new Date(day.date + "T12:00:00Z"))}`;
  const daySum = isToday ? "" : `${num(day.min)}…${num(day.max)} °C${day.precip >= 0.2 ? `, sadetta ${num(day.precip, 1)} mm` : ""}`;
  const chartWidth = el.clientWidth || 600;
  const prevScroll = el.querySelector(".timeline")?.scrollLeft || 0;

  const days = (w.days || []).map((d, i) => `
    <li><button type="button" data-day="${i}" aria-pressed="${i === selectedDay}">
      <span class="d">${i === 0 ? "Tänään" : esc(fmtDay.format(new Date(d.date + "T12:00:00Z")))}</span>
      ${icon(d.symbol)}
      <span class="hi">${num(d.max)}°</span>
      <span class="lo">${num(d.min)}°</span>
      <span class="pr">${d.precip >= 0.2 ? `${num(d.precip, 1)} mm` : ""}</span>
    </button></li>`).join("");

  el.innerHTML = `
    <div class="now">
      <div class="temp" aria-label="Lämpötila ${num(n.temp, 1)} astetta">${num(n.temp)}<sup>°C</sup></div>
      <div class="now-detail">
        <span class="now-text">${icon(nightIcon(n.symbol, nowD))}${esc(n.text || "")}</span>
        <span class="muted">Tuuli ${num(n.wind)} m/s${n.humidity != null ? `, kosteus ${num(n.humidity)} %` : ""}</span>
        <span class="muted">${esc(w.place)}, mitattu ${n.time ? esc(fmtHM.format(nowD)) : "–"}</span>
      </div>
    </div>
    <div class="day-head"><b>${esc(dayTitle)}</b><span class="muted">${esc(daySum)}</span>
      <span class="tl-nav"><button type="button" data-scroll="-1" aria-label="Aiemmat tunnit">‹</button><button type="button" data-scroll="1" aria-label="Myöhemmät tunnit">›</button></span></div>
    ${timeline(hrs, chartWidth, isToday)}
    <ul class="days" aria-label="Valitse päivä nähdäksesi sen tunnit">${days}</ul>`;
  const tl = el.querySelector(".timeline");
  if (tl && renderWeather.keepScroll) tl.scrollLeft = prevScroll;
  renderWeather.keepScroll = false;
  updateNav();
}

function updateNav() {
  const tl = $("weather").querySelector(".timeline");
  const nav = $("weather").querySelector(".tl-nav");
  if (!tl || !nav) return;
  const can = tl.scrollWidth > tl.clientWidth + 2;
  nav.hidden = !can;
  nav.children[0].disabled = tl.scrollLeft <= 1;
  nav.children[1].disabled = tl.scrollLeft + tl.clientWidth >= tl.scrollWidth - 1;
}

$("weather").addEventListener("scroll", updateNav, true);
$("weather").addEventListener("click", (ev) => {
  const sb = ev.target.closest("button[data-scroll]");
  if (sb) {
    const tl = $("weather").querySelector(".timeline");
    tl?.scrollBy({ left: Number(sb.dataset.scroll) * tl.clientWidth * 0.75, behavior: "smooth" });
    return;
  }
  const b = ev.target.closest("button[data-day]");
  if (!b) return;
  selectedDay = Number(b.dataset.day);
  renderWeather();
  $("weather").querySelector(`button[data-day="${selectedDay}"]`)?.focus();
  // Palataan automaattisesti tähän päivään minuutin päästä, jotta seinänäyttö ei jää vanhaan päivään.
  clearTimeout(renderWeather.reset);
  if (selectedDay !== 0) renderWeather.reset = setTimeout(() => { selectedDay = 0; renderWeather(); }, 60000);
});

async function loadWeather() {
  try {
    weatherData = await api("/api/weather");
    renderWeather.keepScroll = true;
    if (Number.isFinite(weatherData.lat)) home = { lat: weatherData.lat, lon: weatherData.lon };
    if (selectedDay >= (weatherData.days || []).length) selectedDay = 0;
    renderWeather();
    renderSun();
  } catch (e) {
    failed($("weather"), e);
  }
}

let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { renderWeather(); loadEnergy(); }, 200);
});

// ---------------- Auto ----------------
const PLUG = { CONNECTED: "Kytketty", DISCONNECTED: "Ei kytketty" };
const CHARGE = { IN_PROGRESS: "Lataa", CHARGING: "Lataa", COMPLETED: "Täynnä", STOPPED: "Pysähtynyt", SCHEDULED: "Ajastettu", NOT_READY: "Ei valmis", FAULT: "Latausvirhe" };

async function loadCar() {
  const el = $("car");
  try {
    const d = await api("/api/ford");
    if (!d.configured) {
      el.innerHTML = `<div class="empty"><p>Ford-yhteyttä ei ole vielä asetettu.</p><p class="muted">Lisää FORD_CLIENT_ID ja FORD_CLIENT_SECRET Netlifyn asetuksiin.</p></div>`;
      return;
    }
    if (!d.authorized) {
      el.innerHTML = `<div class="empty"><p>Yhdistä Ford-tilisi, niin lataustaso näkyy tässä.</p><p><a class="btn" href="/api/ford-login">Yhdistä Ford-tili</a></p></div>`;
      return;
    }
    const c = d.car;
    const ev = c.soc != null;
    const pct = ev ? c.soc : c.fuelLevel;
    const label = ev ? "akku" : "polttoaine";
    const charging = CHARGE[String(c.charging || "").toUpperCase()];
    const plug = PLUG[String(c.plug || "").toUpperCase()];
    const fuelText = c.fuelLevel != null ? `${num(c.fuelLevel)} %${c.fuelRangeKm != null ? `, ${num(c.fuelRangeKm)} km` : ""}` : null;
    const rows = [
      [ev ? "Sähköllä" : "Toimintamatka", (ev ? c.batteryRangeKm : c.fuelRangeKm ?? c.rangeKm) != null ? `${num(ev ? c.batteryRangeKm : c.fuelRangeKm ?? c.rangeKm)} km` : null],
      ["Bensaa", ev ? fuelText : null],
      charging === "Lataa" && c.minutesToFull > 0
        ? ["Lataa, täynnä", `${Math.floor(c.minutesToFull / 60)} h ${c.minutesToFull % 60} min`]
        : ["Lataus", plug ? (plug === "Kytketty" && charging ? charging : plug) : null],
      ["Ovet", c.locked == null ? null : c.locked ? `<span class="good">Lukossa</span>` : `<span class="warn">Auki</span>`],
      ["Mittari", c.odometerKm != null ? `${num(c.odometerKm)} km` : null],
    ].filter(([, v]) => v).slice(0, 6);
    const tires = (c.tires || []).length
      ? `<div class="tires" aria-label="Rengaspaineet">
          <span class="tires-h">Renkaat, bar</span>
          ${c.tires.map((t) => `<span class="${t.low ? "warn" : ""}" title="${esc(t.wheel)}${t.low ? ", paine matala" : ""}"><small>${esc(t.wheel.replace("Etu ", "E").replace("Taka ", "T").replace("vas.", "V").replace("oik.", "O"))}</small>${num(t.bar, 1)}</span>`).join("")}
        </div>`
      : `<p class="muted note">Rengaspaineita ei saatu autolta.</p>`;
    el.innerHTML = `
      <div class="soc-row" title="Auto päivitti tiedot ${esc(ago(c.updated))}"><span class="soc">${num(pct)} %</span><span class="muted">${esc(label)}, ${esc(c.name)}</span><span class="muted upd">${esc(ago(c.updated))}</span></div>
      <div class="battery${pct != null && pct < 20 ? " low" : ""}${ev ? "" : " fuel"}"><span style="width:${Math.max(0, Math.min(100, pct || 0))}%"></span></div>
      <dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>
      ${tires}
      ${d.stale ? `<p class="muted note">Uusin haku epäonnistui.</p>` : ""}`;
  } catch (e) {
    failed(el, e);
  }
}

// ---------------- Sähkö ----------------
let energyData = null;
function dayBars(daily, el) {
  const box = el.querySelector(".bars");
  if (!box) return;
  const W = Math.max(240, Math.round(box.clientWidth || 420));
  const H = Math.max(70, Math.round(box.clientHeight || 110));
  const padB = 18;
  const days = daily.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.kwh || 0));
  const bw = W / days.length;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Päiväkulutus viimeiset ${days.length} päivää">` +
    days.map((d, i) => {
      const h = ((d.kwh || 0) / max) * (H - padB - 6);
      const dt = new Date(d.date + "T12:00:00Z");
      const lbl = (days.length - 1 - i) % 3 === 0 ? `<text x="${(i === days.length - 1 ? W : i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="${i === days.length - 1 ? "end" : "middle"}">${dt.getUTCDate()}.${dt.getUTCMonth() + 1}.</text>` : "";
      return `<rect class="${i === days.length - 1 ? "last" : ""}" x="${(i * bw + bw * 0.16).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(d.date)}: ${num(d.kwh, 1)} kWh</title></rect>${lbl}`;
    }).join("") + `</svg>`;
}

function renderEnergy() {
  const el = $("energy");
  if (!energyData) return;
  const { data, lastError } = energyData;
  if (!data) {
    el.innerHTML = `<div class="empty"><p>Kulutustietoja ei ole vielä tullut.</p><p class="muted">${lastError ? `Kotikoneen viimeisin yritys: ${esc(lastError.error)}` : "Ne tulevat kotikoneen agentilta."}</p></div>`;
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
      <div class="kpi"><b>${num(last?.kwh, 1)}</b><span>kWh ${last ? esc(fmtDM.format(new Date(last.date + "T12:00:00Z"))) : ""}</span></div>
      <div class="kpi"><b>${num(avg, 1)}</b><span>kWh/pv ka.</span></div>
      <div class="kpi"><b>${num(month, 0)}</b><span>kWh tässä kk</span></div>
    </div>
    <div class="bars"></div>
    <p class="muted note">Caruna, noin vuorokauden viiveellä. Haettu ${esc(ago(data.receivedAt))}.${lastError ? ` Viimeisin haku epäonnistui.` : ""}</p>`;
  if (daily.length) dayBars(daily, el);
}

async function loadEnergy() {
  try {
    if (!energyData || loadEnergy.fetch) energyData = await api("/api/energy");
    loadEnergy.fetch = false;
    renderEnergy();
  } catch (e) {
    failed($("energy"), e);
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
    st.textContent = agentSeenAt ? `Kotikone ${ago(agentSeenAt)}` : "Kotikone ei yhteydessä";
    if (!cams.length) {
      el.innerHTML = `<div class="cam-empty"><p>Kamerakuvia ei ole vielä tullut.</p><p class="muted">Kuvat päivittyvät, kun kotikoneen agentti on käynnissä.</p></div>`;
      return;
    }
    el.innerHTML = cams.map((c) => {
      if (!c.takenAt) {
        return `<figure class="cam"><div class="cam-missing"><b>${esc(c.name)}</b><span>Kuvaa ei ole vielä saatu.</span><span class="muted">${esc(c.error || "")}</span></div></figure>`;
      }
      const stale = (Date.now() - new Date(c.takenAt)) / 60000 > STALE_MIN;
      const err = c.error && c.errorAt > c.takenAt ? `Viimeisin virhe: ${c.error}` : "";
      return `<figure class="cam${stale ? " stale" : ""}">
        <button type="button" data-cam="${esc(c.id)}" data-name="${esc(c.name)}" data-taken="${esc(c.takenAt)}" aria-label="Avaa ${esc(c.name)} isona">
          <img src="/api/cam/${encodeURIComponent(c.id)}?t=${encodeURIComponent(c.takenAt)}" alt="${esc(c.name)}, kuva otettu ${esc(fmtShort.format(new Date(c.takenAt)))}">
        </button>
        <figcaption><span><span class="live-dot" aria-hidden="true"></span><b>${esc(c.name)}</b></span><span title="${esc(err)}">${esc(ago(c.takenAt))}</span></figcaption>
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
    else if (!a.warnings.length) html += `<p class="calm">Ei voimassa olevia varoituksia.</p>`;
    else html += `<ul class="list">${a.warnings.map((w) => `
      <li class="warning"><span class="dot ${esc(w.color)}" aria-hidden="true"></span>
        <div><div class="title">${esc(w.event)}${w.colorText ? ` (${esc(w.colorText)})` : ""}</div>
        <div class="sub">${w.onset ? esc(fmtShort.format(new Date(w.onset))) : ""}–${w.expires ? esc(fmtShort.format(new Date(w.expires))) : ""}</div>
        ${w.description ? `<div class="sub">${esc(w.description)}</div>` : ""}</div></li>`).join("")}</ul>`;

    html += `<h3 class="subhead">Liikenne ${esc(a.radiusKm)} km säteellä</h3>`;
    if (a.traffic === null) html += `<p class="error">Liikennetietoja ei saatu: ${esc(a.trafficError)}</p>`;
    else if (!a.traffic.length) html += `<p class="calm">Ei liikennetiedotteita lähialueella.</p>`;
    else html += `<ul class="list">${a.traffic.map((t) => `
      <li><div class="title">${esc(t.title || t.type)}</div>
        <div class="sub">${esc(t.type)}, ${esc(t.distanceKm)} km${t.where ? `. ${esc(t.where)}` : ""}</div></li>`).join("")}</ul>`;
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

// ---------------- Sisäilma ----------------
let airData = null;
let airBusy = false;
const MODE_FI = { Auto: "Automaatti", Manual: "Manuaali", PowerOff: "Pois päältä" };

function aqClass(pm) {
  if (pm == null) return ["", "–"];
  if (pm <= 10) return ["aq-good", "Hyvä"];
  if (pm <= 25) return ["aq-mod", "Kohtalainen"];
  return ["aq-bad", "Huono"];
}

function renderAir() {
  const el = $("air");
  const d = airData;
  if (!d) return;
  if (!d.configured) {
    el.innerHTML = `<h3 class="clim-h">Ilmanpuhdistin</h3><p class="muted">Lisää ELECTROLUX_API_KEY ja ELECTROLUX_REFRESH_TOKEN Netlifyn asetuksiin.</p>`;
    return;
  }
  if (d.error) { el.innerHTML = `<h3 class="clim-h">Ilmanpuhdistin</h3><p class="error">${esc(d.error)}</p>`; return; }
  const p = d.purifier;
  const [cls, label] = aqClass(p.pm25);
  const off = p.mode === "PowerOff";
  const manual = p.mode === "Manual";
  const cell = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const SHORT = { Auto: "Auto", Manual: "Man.", PowerOff: "Pois" };
  el.innerHTML = `
    <h3 class="clim-h" title="${esc(p.name)}, päivitetty ${esc(ago(d.updated))}">Ilmanpuhdistin${p.connected ? "" : ` <span class="warn">ei yhteydessä</span>`}</h3>
    <div class="air-top">
      <span class="aq ${cls}">${num(p.pm25)}<small>PM2.5 µg/m³</small></span>
      <span class="aq-label ${cls}">${esc(label)}</span>
    </div>
    <dl class="air-grid" title="Lämpötila ${num(p.temp, 1)} °C, suodatin ${num(p.filterLife)} %">
      ${cell("PM1", p.pm1 != null ? `${num(p.pm1)} µg/m³` : "–")}
      ${cell("PM10", p.pm10 != null ? `${num(p.pm10)} µg/m³` : "–")}
      ${cell("TVOC", p.tvoc != null ? `${num(p.tvoc)} ppb` : "–")}
      ${cell("CO₂", p.co2 != null ? `${num(p.co2)} ppm` : "–")}
      ${cell("Kosteus", p.humidity != null ? `${num(p.humidity)} %` : "–")}
      ${cell("Suodatin", p.filterLife != null ? `${num(p.filterLife)} %` : "–")}
    </dl>
    <div class="air-ctrl">
      <div class="seg" role="group" aria-label="Ilmanpuhdistimen tila">
        ${["Auto", "Manual", "PowerOff"].map((m) => `<button type="button" data-air="mode" data-v="${m}" aria-pressed="${p.mode === m}" title="${esc(MODE_FI[m])}" ${airBusy ? "disabled" : ""}>${esc(SHORT[m])}</button>`).join("")}
      </div>
      ${manual ? `<span class="fan" aria-label="Puhaltimen nopeus">
        <button type="button" data-air="fan" data-v="${(p.fan || 1) - 1}" aria-label="Hitaammin" ${airBusy || (p.fan || 1) <= 1 ? "disabled" : ""}>−</button>
        <b>Teho ${num(p.fan)}</b>
        <button type="button" data-air="fan" data-v="${(p.fan || 0) + 1}" aria-label="Nopeammin" ${airBusy || (p.fan || 0) >= 9 ? "disabled" : ""}>+</button>
      </span>` : off ? "" : `<span class="muted fan-auto" title="Tehoa voi säätää manuaalitilassa">Teho ${num(p.fan)}</span>`}
    </div>
    ${airBusy ? `<p class="busy">Lähetetään…</p>` : d.stale ? `<p class="muted note">Uusin haku epäonnistui.</p>` : ""}`;
}

// ---------------- Ilmalämpöpumppu ----------------
let hpData = null;
let hpTarget = null; // käyttäjän valitsema, vielä lähettämätön lämpötila
let hpTempT = null;
const HP_MODES = [[1, "Lämmitys"], [0, "Jäähdytys"], [4, "Automaatti"], [2, "Kuivaus"], [3, "Puhallin"], [6, "Ylläpito 8 °C"]];
const HP_FANS = [[0, "Automaatti"], [5, "Hiljainen"], [1, "Hidas"], [2, "Keski"], [3, "Nopea"], [4, "Turbo"]];

function hpPending(action) {
  return (hpData?.pending || []).find((c) => c.action === action);
}

function renderHp() {
  const el = $("hp");
  const d = hpData;
  if (!d) return;
  const st = d.state?.state;
  if (!d.state) {
    el.innerHTML = `<h3 class="clim-h">Ilmalämpöpumppu</h3><p class="muted">Ei tietoja vielä. Lisää lämpöpumppu kotiagentin config.json-tiedostoon.</p>`;
    return;
  }
  if (!st) {
    el.innerHTML = `<h3 class="clim-h">${esc(d.state.name)}</h3><p class="error">${esc(d.state.error || "Ei yhteyttä laitteeseen")}</p>`;
    return;
  }
  const pPow = hpPending("power"), pTemp = hpPending("temp"), pMode = hpPending("mode"), pFan = hpPending("fan");
  const on = pPow ? pPow.value : st.on;
  const target = hpTarget ?? (pTemp ? pTemp.value : st.target);
  const mode = pMode ? pMode.value : st.mode;
  const fan = pFan ? pFan.value : st.fan;
  const waiting = (d.pending || []).length > 0 || hpTarget != null;
  const lastFail = (d.state.executed || []).find((x) => !x.ok);
  el.innerHTML = `
    <h3 class="clim-h" title="Päivitetty ${esc(ago(d.state.receivedAt))}">${esc(d.state.name)}
      <button type="button" class="pwr${on ? " on" : ""}" data-hp="power" aria-pressed="${on}">${on ? "Päällä" : "Pois"}</button></h3>
    <div class="hp-temp${on ? "" : " off"}">
      <button type="button" data-hp="temp" data-v="-1" aria-label="Laske lämpötilaa" ${target <= 16 ? "disabled" : ""}>−</button>
      <span class="hp-set"><b>${num(target)}</b><small>°C</small></span>
      <button type="button" data-hp="temp" data-v="1" aria-label="Nosta lämpötilaa" ${target >= 32 ? "disabled" : ""}>+</button>
    </div>
    <p class="hp-room">Huone ${st.room != null ? `${num(st.room, 1)} °C` : "–"}</p>
    <div class="hp-sel">
      <label><span>Tila</span><select data-hp="mode">${HP_MODES.map(([v, t]) => `<option value="${v}"${v === mode ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
      <label><span>Puhallin</span><select data-hp="fan">${HP_FANS.map(([v, t]) => `<option value="${v}"${v === fan ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
    </div>
    ${waiting ? `<p class="busy">Odottaa kotikonetta, enintään noin minuutti…</p>` : lastFail ? `<p class="error note">Komento epäonnistui: ${esc(lastFail.error || "")}</p>` : ""}`;
}

async function sendHp(action, value) {
  try {
    const res = await fetch("/api/hp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, value }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Virhe ${res.status}`);
    hpData = { state: data.state, pending: data.pending };
  } catch (e) {
    alertNotice(`Lämpöpumpun komento ei mennyt perille: ${e.message}`);
  }
  renderHp();
  scheduleHp();
}

$("hp").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-hp]");
  if (!b || !hpData?.state?.state) return;
  if (b.dataset.hp === "power") {
    const st = hpData.state.state;
    const cur = hpPending("power") ? hpPending("power").value : st.on;
    sendHp("power", !cur);
  } else if (b.dataset.hp === "temp") {
    const st = hpData.state.state;
    const base = hpTarget ?? (hpPending("temp") ? hpPending("temp").value : st.target);
    hpTarget = Math.max(16, Math.min(32, base + Number(b.dataset.v)));
    renderHp();
    // Odotetaan hetki, jotta useampi painallus lähtee yhtenä komentona.
    clearTimeout(hpTempT);
    hpTempT = setTimeout(() => { const v = hpTarget; hpTarget = null; sendHp("temp", v); }, 900);
  }
});
$("hp").addEventListener("change", (ev) => {
  const s = ev.target.closest("select[data-hp]");
  if (s) sendHp(s.dataset.hp, Number(s.value));
});

let hpTimer = null;
function scheduleHp() {
  clearTimeout(hpTimer);
  const busy = (hpData?.pending || []).length > 0;
  hpTimer = setTimeout(loadHp, busy ? 15000 : 120000);
}

async function loadHp() {
  try {
    if (hpTarget == null) {
      hpData = await api("/api/hp");
      renderHp();
    }
  } catch (e) {
    failed($("hp"), e);
  }
  scheduleHp();
}

async function loadAir() {
  try {
    airData = await api("/api/air");
    renderAir();
  } catch (e) {
    failed($("air"), e);
  }
}

$("air").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button[data-air]");
  if (!b || airBusy || !airData?.purifier) return;
  const action = b.dataset.air;
  const value = action === "fan" ? Number(b.dataset.v) : b.dataset.v;
  airBusy = true;
  renderAir();
  try {
    const res = await fetch("/api/air", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: airData.purifier.id, action, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Virhe ${res.status}`);
    airData = data;
  } catch (e) {
    alertNotice(`Komento ei mennyt perille: ${e.message}`);
  } finally {
    airBusy = false;
    renderAir();
  }
});

function alertNotice(text) {
  const n = $("notice");
  n.hidden = false;
  n.className = "notice err";
  n.textContent = text;
  setTimeout(() => { n.hidden = true; }, 15000);
}

// ---------------- Kalenteri ----------------
let calData = null;
const fmtCalDay = fmt({ weekday: "short", day: "numeric", month: "numeric" });
const fmtMonth = fmt({ month: "long" });

function calRows(events, now, withDay) {
  const today = fmtYMD.format(now);
  const groups = new Map();
  for (const e of events) {
    const key = e.allDay ? e.date : fmtYMD.format(new Date(e.start));
    const k = key < today ? today : key; // monipäiväinen, jo alkanut
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const tomorrow = fmtYMD.format(new Date(now.getTime() + 86400000));
  return [...groups.entries()].map(([day, list]) => {
    const d = new Date(day + "T12:00:00Z");
    const label = day === today ? "Tänään" : day === tomorrow ? "Huomenna" : cap(fmtCalDay.format(d));
    return `<h3 class="cal-day${day === today ? " today" : ""}"><span>${esc(label)}</span>${withDay && (day === today || day === tomorrow) ? `<span>${esc(cap(fmtCalDay.format(d)))}</span>` : ""}</h3>
      <ul class="cal-list">${list.map((e) => {
        const s = new Date(e.start), en = new Date(e.end);
        const live = !e.allDay && s <= now && en > now;
        const past = !e.allDay && en <= now;
        const multi = e.allDay && e.endDate && (new Date(e.endDate) - new Date(e.date)) > 86400000;
        const time = e.allDay ? (multi ? `${fmtDM.format(new Date(e.date + "T12:00:00Z"))}–${fmtDM.format(new Date(new Date(e.endDate + "T12:00:00Z") - 86400000))}` : "Koko päivä") : fmtHM.format(s);
        return `<li class="cal-item cal-c${Number(e.color) % 4}${live ? " live" : ""}${past ? " past" : ""}" title="${esc(e.cal)}${e.allDay ? "" : `, ${fmtHM.format(s)}–${fmtHM.format(en)}`}">
          <span class="cal-time">${esc(time)}</span>
          <span class="cal-title">${esc(e.title)}${e.location ? `<span class="cal-loc">${esc(e.location)}</span>` : ""}</span></li>`;
      }).join("")}</ul>`;
  }).join("");
}

function renderCal() {
  const el = $("cal");
  const d = calData;
  if (!d) return;
  if (!d.configured) {
    el.innerHTML = `<div class="empty"><p>Google-kalenteria ei ole vielä yhdistetty.</p><p class="muted">Lisää kalenterin salainen iCal-osoite Netlifyyn muuttujaan GCAL_ICS.</p></div>`;
    return;
  }
  const now = new Date();
  let html = d.week.length ? calRows(d.week, now, true) : `<p class="calm">Ei tapahtumia seuraavan viikon aikana.</p>`;
  if (d.later.length) html += `<h3 class="cal-sub">Myöhemmin ${esc(fmtMonth.format(new Date(Date.parse(d.monthEnd) - 86400000)))}ssa</h3>${calRows(d.later, now, false)}`;
  if (d.next.length) html += `<h3 class="cal-sub">Tulossa ${esc(fmtMonth.format(new Date(d.monthEnd)))}ssa</h3>${calRows(d.next, now, false)}`;
  if (d.failed?.length) html += `<p class="muted note">Ei vastannut: ${esc(d.failed.join(", "))}</p>`;
  el.innerHTML = html;
}

async function loadCal() {
  try {
    calData = await api("/api/calendar");
    renderCal();
  } catch (e) {
    failed($("cal"), e);
  }
}

// ---------------- Ole.Fit ----------------
let gymData = null;
const fmtGymDay = fmt({ weekday: "long", day: "numeric", month: "numeric" });

function hmToDate(ymd, hm) {
  // Paikallinen aika Helsingissä: lasketaan erotus UTC:hen sen päivän keskipäivästä.
  const noon = new Date(ymd + "T12:00:00Z");
  const local = Number(fmtH.format(noon));
  const offset = local - 12;
  const [h, m] = hm.split(":").map(Number);
  return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), h - offset, m));
}

function renderGym() {
  const el = $("gym");
  const g = gymData;
  if (!g) return;
  const now = new Date();
  const today = fmtYMD.format(now);
  if (today > g.validTo) {
    el.innerHTML = `<div class="empty"><p>Aikataulu oli voimassa ${esc(fmtDM.format(new Date(g.validTo + "T12:00:00Z")))} asti.</p><p class="muted">Päivitä uudet tunnit tiedostoon olefit.json.</p></div>`;
    return;
  }
  const hl = new Set((g.highlight || []).map((x) => x.toUpperCase()));
  const blocks = [];
  let shown = 0;
  for (let i = 0; i < 7 && (blocks.length < 2 || shown < 4); i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const ymd = fmtYMD.format(d);
    if (ymd < g.validFrom || ymd > g.validTo) continue;
    const wd = ((new Date(ymd + "T12:00:00Z").getUTCDay() + 6) % 7) + 1; // 1 = maanantai
    let items = (g.week[String(wd)] || []).map((c) => ({ ...c, s: hmToDate(ymd, c.start), e: hmToDate(ymd, c.end) }));
    if (i === 0 && !items.some((c) => c.e > now)) continue; // tämän päivän tunnit ohi
    if (!items.length) continue;
    const label = i === 0 ? "Tänään" : i === 1 ? "Huomenna" : cap(fmtGymDay.format(d));
    blocks.push(`<h3 class="gym-day"><span>${esc(label)}</span>${i > 1 ? "" : `<span>${esc(cap(fmtWeekday.format(d)))}</span>`}</h3>
      <ul class="gym-list">${items.map((c) => {
        const live = c.s <= now && c.e > now;
        const past = c.e <= now;
        const mins = Math.round((c.s - now) / 60000);
        const soon = !live && !past && mins <= 120 ? `<span class="gym-soon">${mins < 60 ? `${mins} min päästä` : `${Math.floor(mins / 60)} h ${mins % 60} min päästä`}</span>` : "";
        return `<li class="gym-item${hl.has(c.name.toUpperCase()) ? " hl" : ""}${live ? " live" : ""}${past ? " past" : ""}">
          <span class="gym-time">${esc(c.start.replace(":", "."))}–${esc(c.end.replace(":", "."))}</span>
          <span><span class="gym-name">${esc(c.name)}</span>${live ? `<span class="gym-badge">käynnissä</span>` : soon}</span>
          <span class="gym-who">${esc(c.who || "")}</span></li>`;
      }).join("")}</ul>`);
    shown += items.length;
  }
  el.innerHTML = blocks.join("") || `<p class="muted">Ei tunteja lähipäivinä.</p>`;
}

async function loadGym() {
  try {
    if (!gymData) {
      const r = await fetch("/olefit.json", { cache: "no-cache" });
      if (!r.ok) throw new Error("Tuntiaikataulua ei löytynyt");
      gymData = await r.json();
    }
    renderGym();
  } catch (e) {
    failed($("gym"), e);
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
  tick();
  loadWeather(); loadCams(); loadCar(); loadArea(); loadNews(); loadGym(); loadAir(); loadHp(); loadCal();
  loadEnergy.fetch = true; loadEnergy();
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
  setTimeout(() => { n.hidden = true; }, 30000);
}

async function start() {
  const r = await fetch("/api/login").then((x) => x.json()).catch(() => ({ authed: false }));
  if (!r.authed) return showLogin();
  $("login").hidden = true;
  $("app").hidden = false;
  applyThemeLabel();
  updateFsLabel();
  showFordNotice();
  stopTimers();
  refreshAll();
  timers.push(setInterval(tick, 1000));
  every(renderSun, 5 * 60 * 1000);
  every(renderGym, 60 * 1000);
  every(renderCal, 60 * 1000);
  every(loadCal, 10 * 60 * 1000);
  every(loadCams, 60 * 1000);
  every(loadWeather, 10 * 60 * 1000);
  every(() => { loadCar(); loadArea(); loadNews(); loadEnergy.fetch = true; loadEnergy(); }, 5 * 60 * 1000);
  every(() => { if (!airBusy) loadAir(); }, 2 * 60 * 1000);
  // Seinänäyttö: ladataan sivu kokonaan uudelleen kuuden tunnin välein, jotta uudet julkaisut tulevat käyttöön.
  setTimeout(() => location.reload(), 6 * 3600 * 1000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("app").hidden) refreshAll();
});

start();

import { lineChart, barChart, sparkline } from "./charts.js";
import { computeState } from "./core.js";
import { analyzeActivity, compareActivity, personalBests, PB_DIST, fmtTime, weekReview, totals as calcTotals, lapAnalysis, DYN, dynLevel, DYN_LEVEL, dynSummary } from "./insights.js";
import {
  SPORTS, SPORT_KEYS, DAY_NAMES, DAY_NAMES_LONG, dayKey, parseDay, addDays, startOfDay, weekStart, weekdayIdx,
  fmtDur, fmtH, fmtKm, fmtNum, fmtPace, fmtPct, weekly, efficiencySeries, rolling, ITYPES, ITYPE_KEYS, ZONES,
  HR_REF, fmtNorm, isoWeekNum, upcomingEvents,
} from "./model.js";

const APP_VERSION = "6.1 (30.10.2026)";
const $ = (id) => document.getElementById(id);
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const ss = {
  get(k, d = null) { try { const v = sessionStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};
const UI = {
  password: ls.get("pw") || ss.get("pw") || "",
  tab: ss.get("tab", "today"),
  sport: ss.get("sport", "all"),
  range: parseInt(ls.get("range", "90")),
  calOffset: 0, calView: ls.get("calView", "week"), monthOffset: 0,
  log: { sport: "all", itype: "all", days: "90", q: "", limit: 25 },
  drawn: {},
};
let S = {};

// ---------------- API ----------------
async function api(action = "data", body) {
  const res = await fetch(`/api?action=${action}`, {
    method: body ? "POST" : "GET",
    headers: { "x-site-password": UI.password, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw Object.assign(new Error("Väärä salasana"), { auth: true });
  if (!res.ok) throw new Error(json.error || `Virhe ${res.status}`);
  return json;
}
function prepare(raw) { S = computeState(raw, new Date()); }

// ---------------- apurit ----------------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sw = (k) => `<span class="sw" style="background:${SPORTS[k]?.color || "var(--muted)"}"></span>`;
const dShort = (d) => `${d.getDate()}.${d.getMonth() + 1}.`;
const dLong = (d) => d.toLocaleDateString("fi-FI", { weekday: "short", day: "numeric", month: "numeric" });
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const stateBadge = (st) => ({
  up: `<span class="st good">↑ Paranee</span>`, flat: `<span class="st neutral">→ Vakaa</span>`,
  down: `<span class="st bad">↓ Heikkenee</span>`, unknown: `<span class="st neutral">Vähän dataa</span>`,
}[st]);
const alertIcon = { bad: "⚠", warn: "◆", good: "✓" };
const isMobile = () => window.matchMedia("(max-width: 720px)").matches;
function relTime(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 2) return "juuri nyt";
  if (m < 60) return `${m} min sitten`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h sitten`;
  const d = Math.round(h / 24);
  return d === 1 ? "eilen" : `${d} pv sitten`;
}

function alertHTML(a) {
  return `<div class="alert ${a.level}"><div class="ico" style="color:var(--${a.level === "warn" ? "warn" : a.level})">${alertIcon[a.level]}</div>
    <div><b>${esc(a.title)}</b><div class="small muted">${esc(a.text)}</div>${a.suggestion ? `<div class="s">→ ${a.suggestion}</div>` : ""}</div></div>`;
}
const ibadge = (k) => `<span class="ibadge" title="${esc(ITYPES[k]?.desc)}"><i style="background:${ITYPES[k]?.color}"></i>${ITYPES[k]?.name}</span>`;
const zoneRange = (i) => {
  const z = S.hrZones?.[i];
  return z && z.lo ? (z.hi ? `${z.lo}–${z.hi} bpm` : `yli ${z.lo} bpm`) : "";
};
function zbar(zones, h) {
  if (!zones) return "";
  const t = zones.reduce((s, v) => s + v, 0);
  if (!t) return "";
  return `<div class="zbar" ${h ? `style="height:${h}px"` : ""} title="${zones.map((v, i) => `${ZONES[i].short} ${Math.round(v / t * 100)} %`).join(" · ")}">${zones.map((v, i) => v > 0 ? `<span style="flex:${v};background:${ZONES[i].color}"></span>` : "").join("")}</div>`;
}
function zoneTable(zones) {
  const t = zones.reduce((s, v) => s + v, 0) || 1;
  const max = Math.max(...zones);
  return `<table class="ztable">${zones.map((v, i) => `<tr>
    <td><span class="sw" style="background:${ZONES[i].color}"></span>${ZONES[i].short} ${ZONES[i].desc}<div class="muted" style="font-size:.72rem;padding-left:16px">${zoneRange(i)}</div></td>
    <td class="zt"><div style="width:${max ? v / max * 100 : 0}%;background:${ZONES[i].color}"></div></td>
    <td class="n">${fmtDur(v)}</td><td class="n muted" style="width:44px">${Math.round(v / t * 100)} %</td></tr>`).join("")}</table>`;
}
function cmpHTML(c) {
  if (!c || !c.n) return `<div class="small muted">Ei vielä vertailukelpoisia treenejä (sama laji ja tyyppi, samankaltainen matka tai kesto).</div>`;
  const arrow = (b) => b === "n" ? "" : b === null ? `<span class="muted">=</span>` : b ? `<span style="color:var(--good)">▲</span>` : `<span style="color:var(--bad)">▼</span>`;
  return `<div class="small muted" style="margin-bottom:6px">Verrattu ${c.n} vastaavaan treeniin (${esc(c.label)}), viim. 4 kk</div>
    <table class="cmp"><tr><th></th><th>Tämä</th><th>Keskiarvo</th><th></th></tr>
    ${c.rows.map(r => `<tr><td class="muted">${r.label}</td><td><b>${r.cur}</b></td><td class="muted">${r.avg}</td><td>${arrow(r.better)}</td></tr>`).join("")}</table>
    <div class="small" style="margin-top:8px">${esc(c.verdict)}</div>`;
}
function stepsHTML(det) {
  if (!det) return "";
  const sg = S.settings.stationGuideUrl;
  return `<ol class="steps">${det.steps.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join("")}</ol>
    ${det.tip ? `<div class="small tip"><b>Vinkki:</b> ${esc(det.tip)}</div>` : ""}
    ${det.hyrox && sg ? `<div class="small" style="margin-top:8px"><a href="${esc(sg)}" target="_blank" rel="noopener" style="color:var(--accent-hi)">Asemien ohjeet Station guidessa ↗</a></div>` : ""}`;
}
function lapsHTML(la) {
  if (!la) return "";
  const rows = la.rows.slice(0, 40);
  const hy = la.runs != null;
  return `<div class="laps">
    ${la.notes.length ? `<ul class="small findings">${la.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <table class="cmp" style="margin-top:8px"><tr><th>#</th>${hy ? "<th>Osuus</th>" : ""}<th>Aika</th><th>Matka</th><th>Vauhti</th><th>Syke</th></tr>
    ${rows.map(r => `<tr><td class="muted">${r.i}</td>${hy ? `<td>${r.isRun ? "Juoksu" : "Asema"}</td>` : ""}<td>${fmtTime(r.t || 0)}</td><td>${r.d ? (r.d >= 1000 ? fmtKm(r.d) : `${r.d} m`) : "–"}</td><td>${r.speed && r.d >= 200 ? fmtPace(r.speed) : "–"}</td><td>${r.hr || "–"}</td></tr>`).join("")}</table></div>`;
}

function sessHTML(it) {
  if (it.kind === "event") return `<div class="sess event"><div class="st-t">🏁 ${esc(it.title)}</div><div class="muted">${it.prio || "A"}-tapahtuma</div></div>`;
  const det = S.sessionDetail(it);
  const meta = [it.time, fmtDur(it.dur), !it.manual && it.kind === "hard" ? "kova" : ""].filter(Boolean).join(" · ");
  const mv = `<button class="mini" data-act="move" data-key="${esc(it.manual ? `m|${it.mid}|${it.date}` : `a|${it.hideKey}`)}">Siirrä</button>`;
  let actions;
  if (it.manual) {
    actions = `<div class="acts"><button class="mini" data-act="edit" data-mid="${esc(it.mid)}">Muokkaa</button>${mv}` +
      (it.recurring
        ? `<button class="mini" data-act="skip" data-mid="${esc(it.mid)}" data-date="${esc(it.date)}">Poista tämä kerta</button><button class="mini danger" data-act="del" data-mid="${esc(it.mid)}">Poista sarja</button>`
        : `<button class="mini danger" data-act="del" data-mid="${esc(it.mid)}">Poista</button>`) + `</div>`;
  } else actions = it.hideKey ? `<div class="acts">${mv}<button class="mini" data-act="hide" data-key="${esc(it.hideKey)}">Piilota ehdotus</button></div>` : "";
  const itype = it.itype || det?.itype;
  const tags = `<div class="tags">${itype ? ibadge(itype) : ""}${it.recurring ? `<span class="tag">↻ toistuva</span>` : ""}${it.manual ? "" : `<span class="tag neutral">automaattinen</span>`}</div>`;
  return `<div class="sess ${it.done ? "done" : ""} ${it.changed ? "changed" : ""} ${it.manual ? "manual" : ""}" data-open style="border-left-color:${SPORTS[it.sport].color}">
    <div class="st-t">${esc(it.title)}</div><div class="muted">${meta}</div>${tags}
    <div class="why">${it.why && !(it.manual && det) ? `<div>${esc(it.why)}</div>` : ""}${it.estLoad ? `<div class="small muted" style="margin-top:4px">Arvioitu kuorma ~${it.estLoad}</div>` : ""}${stepsHTML(det)}${actions}</div></div>`;
}

function suggHTML(sg, i) {
  const added = S.plan.items.some(x => x.date === dayKey(S.today) && x.title === sg.title);
  return `<div class="sugg" style="border-left-color:${SPORTS[sg.sport].color}">
    <div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div class="st-t">${sg.rest ? "😴 " : ""}${esc(sg.title)}</div><span class="small muted" style="white-space:nowrap">${sg.rest ? "" : fmtDur(sg.dur)}</span></div>
    <div class="tags">${i === 0 ? `<span class="tag rec">★ Suositus</span>` : ""}${sg.rest ? `<span class="tag neutral">Palautuminen</span>` : `${ibadge(sg.itype)}<span class="tag neutral">${SPORTS[sg.sport].name}</span>`}</div>
    <div class="small muted" style="margin-top:6px">${esc(sg.why[0])}</div>
    <div class="sdetail">
      ${stepsHTML(sg)}
      ${sg.why.length > 1 ? `<ul class="small whys">${sg.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${sg.rest ? "" : `<div class="acts">${added ? `<span class="small" style="color:var(--good)">✓ Lisätty kalenteriin</span>` : `<button class="mini" data-act="add-sugg" data-sid="${sg.id}">Lisää tämän päivän kalenteriin</button>`}</div>`}
    </div>
    <div class="more small">Näytä sisältö ▾</div>
  </div>`;
}

function actItem(a) {
  const extra = [
    a.dist > 0 ? fmtKm(a.dist) : "", a.sport === "run" && a.speed ? fmtPace(a.speed) : "",
    a.avgHR ? `syke ${Math.round(a.avgHR)}` : "", a.sets ? `${a.sets} sarjaa` : "",
  ].filter(Boolean).join(" · ");
  const src = { garmin: "Garminin arvio", syke: "päätelty sykealueista", TE: "päätelty Training Effectistä", laji: "päätelty lajista", kasin: "lisätty käsin" }[a.itypeSource] || "";
  return `<div class="item act" data-aid="${esc(a.id)}">
    <div class="head"><div>${sw(a.sport)}<span class="n">${esc(a.name || SPORTS[a.sport].name)}</span>
      <div class="meta small muted">${dLong(a.date)}${a.date.getFullYear() !== S.today.getFullYear() ? ` ${a.date.getFullYear()}` : ""}${a.name && a.name !== SPORTS[a.sport].name ? ` · ${SPORTS[a.sport].name}` : ""} ${ibadge(a.itype)}</div></div>
      <div class="r"><b>${fmtDur(a.dur)}</b><div class="small muted">${extra}</div></div></div>
    ${zbar(a.zones)}
    <div class="detail"></div></div>`;
}
function actDetail(a) {
  const src = { garmin: "Garminin arvio", syke: "päätelty sykealueista", TE: "päätelty Training Effectistä", laji: "päätelty lajista", kasin: "lisätty käsin" }[a.itypeSource] || "";
  const la = lapAnalysis(a);
  return `<div class="small"><b>${ITYPES[a.itype].name}</b>${src ? ` <span class="muted">(${src})</span>` : ""}: ${esc(ITYPES[a.itype].desc)}</div>
    ${a.zones ? `<div style="margin-top:10px">${zoneTable(a.zones)}</div>` : ""}
    <div class="kv">
      ${a.aeTE != null ? `<span>Aerobinen TE <b>${fmtNum(a.aeTE, 1)}</b></span>` : ""}
      ${a.anTE != null ? `<span>Anaerobinen TE <b>${fmtNum(a.anTE, 1)}</b></span>` : ""}
      <span>Kuorma <b>${fmtNum(a.load)}</b></span>
      ${a.maxHR ? `<span>Maksimisyke <b>${Math.round(a.maxHR)}</b></span>` : ""}
      ${a.cal ? `<span>Kalorit <b>${Math.round(a.cal)}</b></span>` : ""}
      ${a.elev ? `<span>Nousu <b>${Math.round(a.elev)} m</b></span>` : ""}
      ${a.vo2 ? `<span>VO2max <b>${fmtNum(a.vo2, 0)}</b></span>` : ""}
    </div>
    ${la ? `<div style="margin-top:12px"><div class="small" style="font-weight:600;margin-bottom:4px">Kierrokset</div>${lapsHTML(la)}</div>` : ""}
    ${dynFold(a)}
    ${a.best ? `<div class="kv" style="margin-top:8px">${PB_DIST.filter(([k]) => a.best[k]).map(([k, l]) => `<span>Nopein ${l} <b>${fmtTime(a.best[k])}</b></span>`).join("")}</div>` : ""}
    <div style="margin-top:12px"><div class="small" style="font-weight:600;margin-bottom:4px">Vertailu aiempiin vastaaviin</div>${cmpHTML(compareActivity(a, S.acts))}</div>`;
}

// ---------------- juoksun dynamiikka ----------------
const LVL_COLOR = { 1: "var(--bad)", 2: "#f0883e", 3: "var(--good)", 4: "#3a8fd1", 5: "#8b5cf6" };
const BAL_LABEL = { 5: "Tasapainoinen", 3: "Pieni ero", 1: "Selvä ero" };
function dynGauge(m, lvl) {
  if (lvl == null || m.balance) return "";
  return `<div class="dgauge">${[1, 2, 3, 4, 5].map(i => `<span style="background:${LVL_COLOR[i]};opacity:${i === lvl ? 1 : 0.28}"></span>`).join("")}</div>`;
}
function dynHTML(a) {
  if (!a.dyn) return "";
  const sum = dynSummary(S.acts, S.today);
  const tips = [];
  const cells = DYN.filter(m => a.dyn[m.k] != null).map(m => {
    const v = a.dyn[m.k], lvl = dynLevel(m, v);
    const own = sum?.metrics[m.k]?.recent;
    if (m.tipLow && lvl != null && lvl <= (m.balance ? 1 : 2)) tips.push(m.tipLow);
    const label = lvl == null ? "" : m.balance ? BAL_LABEL[lvl] : DYN_LEVEL[lvl];
    return `<div class="dm"><div class="row between small" style="flex-wrap:nowrap"><span>${m.name}</span><b>${m.fmt(v)} <span class="muted" style="font-weight:400">${m.unit}</span></b></div>
      ${dynGauge(m, lvl)}
      <div class="small muted">${label ? `<span style="color:${LVL_COLOR[lvl]}">${label}</span>` : ""}${m.k === "cad" && a.dyn.cadMax ? `${label ? " · " : ""}maks. ${fmtNum(a.dyn.cadMax, 0)}` : ""}${own != null ? `${label || m.k === "cad" ? " · " : ""}oma ka. ${m.fmt(own)}` : ""}</div></div>`;
  }).join("");
  return `<div class="dyn">${cells}</div>
    ${tips.length ? `<ul class="small findings" style="margin-top:10px">${tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : `<div class="small muted" style="margin-top:8px">Tekniikka on Garminin vertailualueilla hyvällä tasolla.</div>`}
    <div class="small muted" style="margin-top:6px">Värit: Garminin vertailu kaikkiin juoksijoihin (punainen → violetti = heikoin → paras). Arvot vaihtelevat vauhdin mukaan: hitaalla lenkillä askeltiheys on luonnostaan pienempi ja maakosketus pidempi.</div>`;
}
function dynFold(a, open = "") {
  return a.dyn ? `<details class="fold" style="margin-top:12px" ${open}><summary><h3 style="font-size:.9rem;display:inline">Juoksun dynamiikka</h3></summary>${dynHTML(a)}</details>` : "";
}
function techniqueHTML() {
  const sum = dynSummary(S.acts, S.today);
  if (!sum) return `<h2 class="sec">Juoksutekniikka</h2><div class="card small muted">Juoksun dynamiikkaa (askeltiheys, maakosketus, pystyliike) ei löytynyt treeneistä. Ne tallentuvat, kun kello tai sykevyö tukee juoksun dynamiikkaa.</div>`;
  const tips = [];
  const cards = DYN.filter(m => sum.metrics[m.k]).map(m => {
    const x = sum.metrics[m.k];
    const v = x.recent ?? x.latest, lvl = dynLevel(m, v);
    if (m.tipLow && lvl != null && lvl <= (m.balance ? 1 : 2)) tips.push(m.tipLow);
    let delta = "";
    if (x.recent != null && x.base != null && !m.balance) {
      const d = x.recent - x.base;
      const good = m.higher ? d > 0 : d < 0;
      const tiny = Math.abs(d) < (m.k === "cad" || m.k === "gct" ? 1 : 0.05);
      delta = tiny ? `<span class="muted">= aiemmin</span>` : `<span class="${good ? "up" : "down"}">${d > 0 ? "+" : "−"}${m.fmt(Math.abs(d))} vs. 12 vk</span>`;
    }
    const label = lvl == null ? "" : m.balance ? BAL_LABEL[lvl] : DYN_LEVEL[lvl];
    return `<div class="card trend"><div class="top"><div><h3>${m.name}</h3><div class="small muted">${m.unit} · ka. 4 vk</div></div>${label ? `<span class="st" style="color:${LVL_COLOR[lvl]};background:var(--surface-2)">${label}</span>` : ""}</div>
      <div class="v">${m.fmt(v)} <span class="small">${delta}</span></div>${dynGauge(m, lvl)}
      <div class="spark" data-dyn="${m.k}"></div></div>`;
  }).join("");
  return `<h2 class="sec">Juoksutekniikka</h2>
    <div class="grid g3c">${cards}</div>
    ${tips.length ? `<div class="card" style="margin-top:10px"><h3>Kehityskohteet</h3><ul class="small findings">${tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
    <p class="small muted">Juoksun dynamiikka ${sum.runs} juoksusta. Värit ovat Garminin vertailualueet kaikkiin juoksijoihin. Seuraa ennen kaikkea omaa kehitystäsi: tekniikka muuttuu hitaasti, viikkojen ja kuukausien aikana.</p>`;
}

function ringHTML(score, level) {
  const r = 30, c = 2 * Math.PI * r, v = score ?? 0;
  const col = level === "go" ? "var(--good)" : level === "easy" ? "var(--bad)" : "var(--accent-hi)";
  return `<svg class="ring" viewBox="0 0 76 76" width="76" height="76" role="img" aria-label="Harjoitusvalmius ${score ?? "–"}/100">
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>
    <circle cx="38" cy="38" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/>
    <text x="38" y="44" text-anchor="middle" fill="var(--text)" font-size="20" font-weight="800">${score ?? "–"}</text></svg>`;
}

// ---------------- TÄNÄÄN ----------------
function avg30(f) {
  const from = dayKey(addDays(S.today, -30)), to = dayKey(addDays(S.today, -1));
  const v = S.health.filter(d => d.day >= from && d.day <= to && d[f] != null).map(d => d[f]);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
function deltaTxt(v, avg, lowerBetter, unit = "", dp = 0) {
  if (v == null || avg == null) return "";
  const diff = v - avg;
  if (Math.abs(diff) < (dp ? 0.05 : 0.5)) return `<span class="muted">= 30 pv ka.</span>`;
  const good = lowerBetter ? diff < 0 : diff > 0;
  return `<span class="${good ? "up" : "down"}">${diff > 0 ? "+" : "−"}${fmtNum(Math.abs(diff), dp)}${unit} vs. 30 pv</span>`;
}

function tilanneHTML() {
  const r = S.ready, h = r.latest || {}, p = r.parts || {};
  const bar = (sc) => sc == null ? "" : `<div class="track"><div style="width:${sc}%;background:${sc >= 70 ? "var(--good)" : sc < 45 ? "var(--bad)" : "var(--accent)"}"></div></div>`;
  const sleepH = h.sleepSec != null ? h.sleepSec / 3600 : null;
  const s30 = avg30("sleepSec");
  const rows = [
    ["HRV", p.hrv, h.hrv != null ? `${h.hrv} ms` : null, deltaTxt(h.hrv, avg30("hrv"), false, " ms"), p.hrv?.text?.match(/\(normaali[^)]*\)/)?.[0] || ""],
    ["Uni", p.sleep, sleepH != null ? `${fmtNum(sleepH, 1)} h` : null, deltaTxt(sleepH, s30 != null ? s30 / 3600 : null, false, " h", 1), h.sleepScore != null ? `pisteet ${h.sleepScore}` : ""],
    ["Body Battery", p.bb, h.bbWake ?? h.bbHigh ?? null, "", "herätessä"],
    ["Leposyke", p.rhr, h.rhr ?? null, deltaTxt(h.rhr, avg30("rhr"), true), "bpm"],
    ["Treenikuorma", p.load, null, "", p.load?.text || ""],
  ];
  const stages = h.deepPct != null ? `<div class="part">
      <div class="row between small"><span>Unen vaiheet</span><span class="${h.deepPct < 0.13 ? "down" : ""}">syvä ${Math.round(h.deepPct * 100)} %</span></div>
      <div class="zbar" style="height:6px;margin:4px 0 2px"><span style="flex:${h.deepPct};background:var(--z1)"></span><span style="flex:${h.lightPct};background:var(--z2)"></span><span style="flex:${h.remPct};background:var(--z3)"></span></div>
      <div class="small muted">syvä ${Math.round(h.deepPct * 100)} % · kevyt ${Math.round(h.lightPct * 100)} % · REM ${Math.round(h.remPct * 100)} %${h.deepPct < 0.13 ? " · syvää unta tavoitetta (16–33 %) vähemmän" : ""}</div></div>` : "";
  const stressY = [...S.health].reverse().find(d => d.day < dayKey(S.today) && d.stress != null);
  return `<div class="card lvl-${r.level}">
    <div class="ready">${ringHTML(r.score, r.level)}<div><div class="small muted">Harjoitusvalmius</div><div class="t">${r.title}</div><div class="muted small">${r.text}</div></div></div>
    <div class="parts">${rows.map(([l, part, val, dl, sub]) => `<div class="part">
      <div class="row between small"><span>${l}${val != null ? ` <b>${val}</b>` : ""} <span class="muted">${esc(sub)}</span></span><span>${part ? `<b>${Math.round(part.score)}</b>` : `<span class="muted">ei dataa</span>`}</span></div>
      ${bar(part?.score)}${dl ? `<div class="small">${dl}</div>` : ""}</div>`).join("")}
      ${stages}
      ${stressY ? `<div class="part"><div class="row between small"><span>Stressi eilen <b>${stressY.stress}</b></span>${deltaTxt(stressY.stress, avg30("stress"), true)}</div></div>` : ""}
    </div>
    ${r.hist?.length > 3 ? `<div class="row between small muted" style="margin-top:12px"><span>Valmius 30 pv</span><span>ka. ${Math.round(r.hist.reduce((s, x) => s + x.y, 0) / r.hist.length)}</span></div><div class="spark" id="readySpark" style="height:44px"></div>` : ""}
  </div>`;
}

function todayTrainingHTML() {
  const t = S.todayPlan;
  const list = S.sugg.list;
  return `<div class="card">
    <div class="row between"><h3>Tämän päivän treeni</h3><button class="btn ghost sm" data-act="add" data-date="${dayKey(S.today)}">+ Lisää</button></div>
    ${t?.items.length ? `<div class="small muted" style="margin:10px 0 6px">Kalenterissa</div><div class="list">${t.items.map(sessHTML).join("")}</div>` : `<div class="small muted" style="margin-top:8px">${S.settings.restDay === weekdayIdx(S.today) ? "Lepopäivä kalenterissa." : "Kalenterissa ei treeniä tälle päivälle."}</div>`}
    ${t?.extra?.length ? `<div class="small muted" style="margin:10px 0 6px">Tehty tänään</div><div class="list">${t.extra.map(a => `<div class="sess actual" style="border-left-color:${SPORTS[a.sport].color}"><div class="st-t">${esc(a.name || SPORTS[a.sport].name)}</div><div class="muted">${fmtDur(a.dur)}</div></div>`).join("")}</div>` : ""}
    <div class="small muted" style="margin:14px 0 6px">Ehdotukset viimeisen 7 päivän treenien ja valmiuden perusteella</div>
    <div class="list">${list.slice(0, 3).map(suggHTML).join("")}</div>
    ${list.length > 3 ? `<div class="list hidden" id="moreSugg" style="margin-top:6px">${list.slice(3).map((x, i) => suggHTML(x, i + 3)).join("")}</div>
      <button class="btn ghost sm" style="margin-top:8px" data-act="more-sugg">Vaihda: näytä ${list.length - 3} muuta vaihtoehtoa</button>` : ""}
  </div>`;
}

function latestHTML() {
  const a = S.latest;
  if (!a) return "";
  const an = analyzeActivity(a, S.acts);
  const kv = [
    a.dist > 0 ? ["Matka", fmtKm(a.dist)] : null,
    a.sport === "run" && a.speed ? ["Vauhti", fmtPace(a.speed)] : a.sport === "bike" && a.speed ? ["Nopeus", `${fmtNum(a.speed * 3.6, 1)} km/h`] : null,
    a.power ? ["Teho", `${Math.round(a.power)} W`] : null,
    a.avgHR ? ["Keskisyke", Math.round(a.avgHR)] : null,
    a.maxHR ? ["Maksimisyke", Math.round(a.maxHR)] : null,
    a.load ? ["Kuorma", fmtNum(a.load)] : null,
    a.aeTE != null ? ["Aerobinen TE", fmtNum(a.aeTE, 1)] : null,
    a.anTE != null ? ["Anaerobinen TE", fmtNum(a.anTE, 1)] : null,
    a.sets ? ["Sarjat", a.sets] : null,
  ].filter(Boolean);
  const open = isMobile() ? "" : "open";
  return `<h2 class="sec">Viimeisin treeni</h2>
    <div class="card">
      <div class="row between" style="align-items:flex-start">
        <div>${sw(a.sport)}<b style="font-size:1.05rem">${esc(a.name || SPORTS[a.sport].name)}</b>
          <div class="meta small muted" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px">${a.date.toLocaleDateString("fi-FI", { weekday: "long", day: "numeric", month: "numeric" })} · ${SPORTS[a.sport].name} ${ibadge(a.itype)}${a.manual ? `<span class="tag">Lisätty käsin</span>` : ""}</div></div>
        <div style="font-size:1.35rem;font-weight:700;white-space:nowrap">${fmtDur(a.dur)}</div>
      </div>
      <div class="kvgrid">${kv.map(([l, v]) => `<div><div class="small muted">${l}</div><b>${v}</b></div>`).join("")}</div>
      ${a.zones ? `${zbar(a.zones)}<div class="zleg small muted">${ZONES.map((z, i) => { const t = a.zones.reduce((s, v) => s + v, 0) || 1; return `<span><span class="sw" style="background:${z.color}"></span>${z.short} ${Math.round(a.zones[i] / t * 100)} %</span>`; }).join("")}</div>` : ""}
      <div class="grid g2" style="margin-top:14px">
        <div><h3 style="font-size:.9rem">Analyysi</h3><ul class="small findings">${an.findings.map(f => `<li>${esc(f)}</li>`).join("")}</ul></div>
        <div><details class="fold" ${open}><summary><h3 style="font-size:.9rem;display:inline">Vertailu aiempiin</h3></summary>${cmpHTML(an.cmp)}</details></div>
      </div>
      ${dynFold(a)}
      ${an.laps ? `<details class="fold" style="margin-top:12px" ${open}><summary><h3 style="font-size:.9rem;display:inline">Kierrokset${an.laps.runs ? " ja HYROX-analyysi" : ""}</h3></summary>${lapsHTML(an.laps)}</details>` : ""}
    </div>`;
}

function weekCardsHTML() {
  const L = S.load;
  const marker = L.ratio != null ? Math.min(L.ratio, 2) / 2 * 100 : null;
  const loadText = { low: "Kuorma on tavallista pienempi.", ok: "Kuorma on hyvällä tasolla.", high: "Kuorma on korkea: varmista palautuminen.", risk: "Kuorma nousi nopeasti: loukkaantumisriski kasvaa." }[L.zone] || "Kuormaa ei voi vielä laskea.";
  const wk = weekly(S.acts, 1, S.today)[0];
  const planned = S.planNow.planned;
  const sportRows = SPORT_KEYS.filter(k => (planned[k] || 0) > 0 || wk.sports[k].n > 0).map(k => {
    const done = wk.sports[k].n, goal = Math.max(planned[k] || 0, 1);
    return `<div class="sport-row"><div>${sw(k)}${SPORTS[k].name}</div>
      <div class="track"><div style="width:${Math.min(100, done / goal * 100)}%;background:${SPORTS[k].color}"></div></div>
      <div class="small" style="text-align:right">${done}/${planned[k] || 0} · ${fmtH(wk.sports[k].dur)}</div></div>`;
  }).join("");
  const target = S.settings.weeklyHours;
  const wa = S.acts.filter(a => a.date >= weekStart(S.today));
  const c = {}; wa.forEach(a => (c[a.itype] = (c[a.itype] || 0) + 1));
  const ks = ITYPE_KEYS.filter(k => c[k]);
  return `<div class="grid g2">
    <div class="card">
      <div class="row between"><h3>Kuorman nousu</h3>${L.ratio != null ? `<b>${fmtNum(L.ratio, 2)}</b>` : ""}</div>
      <div class="small muted">Viimeiset 7 pv suhteessa 4 viikon keskiarvoon</div>
      <div class="gauge-wrap"><div class="gauge"><span class="z1"></span><span class="z2"></span><span class="z3"></span><span class="z4"></span></div>
        ${marker != null ? `<div class="gauge-marker" style="left:${marker}%"></div>` : ""}</div>
      <div class="gauge-labels"><span style="left:0">Kevyt</span><span style="left:52.5%">Optimaalinen</span><span style="left:70%">Korkea</span><span>Riski</span></div>
      <p class="small" style="margin:10px 0 0">${loadText} <span class="muted">7 pv: ${fmtNum(L.acute)} · keskim. viikko: ${fmtNum(L.chronic)}</span></p>
    </div>
    <div class="card">
      <div class="row between"><h3>Tämä viikko</h3><span class="small muted">vko ${isoWeekNum(S.today)}</span></div>
      <div class="small muted">Tehdyt / suunnitellut treenit</div>
      ${target ? `<div class="sport-row"><div><b>Yhteensä</b></div><div class="track"><div style="width:${Math.min(100, wk.dur / 3600 / target * 100)}%;background:var(--accent)"></div></div><div class="small" style="text-align:right">${fmtNum(wk.dur / 3600, 1)}/${fmtNum(target, 1)} h</div></div>` : ""}
      ${sportRows || `<div class="muted small" style="margin-top:10px">Ei treenejä vielä tällä viikolla.</div>`}
      ${ks.length ? `<div class="row" style="margin-top:12px;gap:6px">${ks.map(k => `${ibadge(k).replace("</span>", "")} ${c[k]}×</span>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

function kuntoCardHTML() {
  const v = S.vo2, fa = S.fitAge;
  const ch = (d, label) => d == null ? "" : `<span class="${Math.abs(d) < 0.5 ? "" : d > 0 ? "up" : "down"}">${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtNum(Math.abs(d), 0)} ${label}</span>`;
  return `<div class="card"><h3>Kunto</h3><div class="kunto" style="margin-top:8px">
    ${v?.main ? `<div>
      <div class="small muted">VO2max · ${SPORTS[v.main].name.toLowerCase()}</div>
      <div class="row" style="align-items:baseline;gap:8px"><span class="big">${fmtNum(v.latest.y, 0)}</span><span class="small muted">ml/kg/min</span></div>
      <div class="small" style="display:flex;gap:12px;flex-wrap:wrap">${ch(v.ch30, "vs. 30 pv")}${ch(v.ch90, "vs. 90 pv")}</div>
      ${(v.main === "run" ? v.run : v.bike).length >= 2 ? `<div class="spark" id="vo2Spark" style="height:40px;margin-top:6px"></div>` : ""}
      ${v.run.length && v.bike.length ? `<div class="small" style="margin-top:4px">${sw("bike")}Pyöräily: <b>${fmtNum(v.bike[v.bike.length - 1].y, 0)}</b></div>` : ""}
    </div>` : `<div><div class="small muted">VO2max</div><div class="small" style="margin-top:6px">Ei vielä löytynyt treenitiedostoista.</div>
      <button class="btn ghost sm" style="margin-top:8px" data-goto="progress">Hae VO2max-historia</button></div>`}
    ${fa ? `<div><div class="small muted">Kuntoikä</div>
      <div class="row" style="align-items:baseline;gap:8px"><span class="big">${fmtNum(fa.fit, 1)}</span><span class="small muted">vuotta</span></div>
      ${fa.chrono ? `<div class="small"><span class="${fa.fit < fa.chrono ? "up" : "down"}">${fa.fit < fa.chrono ? `${fmtNum(fa.chrono - fa.fit, 1)} v nuorempi` : `${fmtNum(fa.fit - fa.chrono, 1)} v vanhempi`}</span> kuin ikäsi</div>` : ""}
      ${fa.achievable ? `<div class="small muted" style="margin-top:4px">Saavutettavissa ${fmtNum(fa.achievable, 1)} v</div>` : ""}
    </div>` : ""}
  </div></div>`;
}

function goalCardHTML() {
  const ph = S.phase;
  const up = upcomingEvents(S.settings.events, S.today);
  if (!ph) return `<div class="card"><h3>Tavoite</h3><p class="small muted" style="margin:8px 0">Lisää tavoitetapahtuma, niin näet lähtölaskennan ja harjoituskauden, ja kalenteri keventää ennen kisaa.</p><button class="btn ghost sm" data-goto="settings">Lisää tapahtuma</button></div>`;
  return `<div class="card"><div class="row between"><h3>Tavoite</h3><span class="tag">${esc(ph.event.prio || "A")}-tapahtuma</span></div>
    <div class="row" style="align-items:baseline;gap:8px;margin-top:8px"><span class="big">${ph.days}</span><span class="small muted">päivää</span></div>
    <div><b>${esc(ph.event.name)}</b> <span class="muted small">${dLong(parseDay(ph.event.date))}</span></div>
    <div class="phase small"><b>${ph.phase}</b>: ${esc(ph.desc)}</div>
    ${up.length > 1 ? `<div class="small muted" style="margin-top:8px">Seuraavaksi: ${up.filter(e => e !== ph.event).slice(0, 3).map(e => `${esc(e.name)} (${dShort(parseDay(e.date))}, ${e.prio})`).join(", ")}</div>` : ""}
  </div>`;
}

function reviewCompactHTML() {
  const rv = weekReview(S.acts, S.health, S.planFor, addDays(weekStart(S.today), -7));
  return `<h2 class="sec">Viime viikko (vko ${rv.week})</h2>
    <div class="card"><div class="row between"><div><b>${rv.n} treeniä · ${fmtH(rv.dur)}</b>${rv.plannedN ? ` <span class="muted small">· kalenterin omista treeneistä ${rv.doneN}/${rv.plannedN}</span>` : ""}</div>
      <a href="#" data-goto="progress" class="small" style="color:var(--accent-hi)">Koko katsaus →</a></div>
      <ul class="small findings">${rv.notes.slice(0, 3).map(n => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
}

function renderToday() {
  const s = S.settings;
  const keyDays = s.keyExpiry ? Math.round((parseDay(s.keyExpiry) - startOfDay(S.today)) / 864e5) : null;
  const wd = weekdayIdx(S.today);
  $("tab-today").innerHTML = `
    ${keyDays != null && keyDays <= 14 ? `<div class="alert ${keyDays < 0 ? "bad" : "warn"}" style="margin-top:16px"><div class="ico">⚠</div><div><b>${keyDays < 0 ? "Garmin-avain on vanhentunut" : `Garmin-avain vanhenee ${keyDays} päivän päästä`}</b><div class="small muted">Luo uusi avain Garmin Connectissa ja vaihda se Netlifyn GARMIN_API_KEY-muuttujaan. Päivitä sitten vanhenemispäivä Asetuksiin.</div></div></div>` : ""}
    <h2 class="sec">${DAY_NAMES_LONG[wd]} ${dShort(S.today)}${S.phase ? ` · <span style="color:var(--accent-hi)">${S.phase.phase}</span>` : ""}</h2>
    <div class="grid g2">${tilanneHTML()}${todayTrainingHTML()}</div>
    ${S.alerts.length ? `<h2 class="sec">Huomiot</h2><div class="list">${S.alerts.slice(0, 2).map(alertHTML).join("")}</div>
      ${S.alerts.length > 2 ? `<p class="small"><a href="#" data-goto="progress" style="color:var(--accent-hi)">Kaikki huomiot (${S.alerts.length}) →</a></p>` : ""}` : ""}
    ${wd <= 1 ? reviewCompactHTML() : ""}
    ${latestHTML()}
    <h2 class="sec">Viikko</h2>
    ${weekCardsHTML()}
    <h2 class="sec">Kunto ja tavoite</h2>
    <div class="grid g2">${kuntoCardHTML()}${goalCardHTML()}</div>
  `;
  if ($("readySpark")) sparkline($("readySpark"), S.ready.hist.map(p => p.y), "var(--accent-hi)");
  if ($("vo2Spark")) { const pts = (S.vo2.main === "run" ? S.vo2.run : S.vo2.bike).filter(p => p.x >= addDays(S.today, -180)); sparkline($("vo2Spark"), pts.map(p => p.y), SPORTS[S.vo2.main].color); }
}

// ---------------- TREENIT ----------------
function typeList(acts) {
  const c = {};
  for (const a of acts) { const t = (c[a.itype] = c[a.itype] || { n: 0, dur: 0 }); t.n++; t.dur += a.dur; }
  const keys = ITYPE_KEYS.filter(k => c[k]);
  if (!keys.length) return `<div class="muted small" style="margin-top:8px">Ei treenejä.</div>`;
  const max = Math.max(...keys.map(k => c[k].dur));
  return `<div class="typelist">${keys.map(k => `<div class="tr" title="${esc(ITYPES[k].desc)}">
    <span><span class="sw" style="background:${ITYPES[k].color}"></span>${ITYPES[k].name}</span>
    <div class="track"><div style="width:${c[k].dur / max * 100}%;background:${ITYPES[k].color}"></div></div>
    <span class="small">${c[k].n} × · ${fmtH(c[k].dur)}</span></div>`).join("")}</div>`;
}
function zonesCard(acts, title) {
  const z = [0, 0, 0, 0, 0];
  for (const a of acts) if (a.zones) a.zones.forEach((v, i) => (z[i] += v));
  const zt = z.reduce((s, v) => s + v, 0);
  return `<div class="card"><h3>${title}</h3><div class="small muted">Kuinka paljon aikaa kullakin sykealueella</div>
    ${zt ? `<div style="margin:12px 0">${zbar(z, 10)}</div>${zoneTable(z)}` : `<div class="muted small" style="margin-top:8px">Ei sykealuedataa.</div>`}</div>`;
}
function totalsHTML(sports) {
  const T = calcTotals(S.acts, S.today);
  const cell = (r) => `${r.n} × · ${fmtH(r.dur)}${r.dist > 500 ? ` · ${fmtKm(r.dist)}` : ""}`;
  return `<div class="card" style="overflow-x:auto"><table class="cmp tot">
    <tr><th></th><th>${T.monthName}</th><th>${T.prevMonthName}</th><th>${T.year0}</th></tr>
    ${sports.map(k => `<tr><td>${k === "all" ? "<b>Kaikki</b>" : `${sw(k)}${SPORTS[k].name}`}</td><td>${cell(T.month[k])}</td><td class="muted">${cell(T.prevMonth[k])}</td><td class="muted">${cell(T.year[k])}</td></tr>`).join("")}
  </table></div>`;
}

function renderSports() {
  const k = UI.sport;
  const seg = `<div style="margin-top:20px" class="seg" id="sportSeg"><button data-sport="all" class="${k === "all" ? "on" : ""}">Kaikki</button>${SPORT_KEYS.map(s => `<button data-sport="${s}" class="${s === k ? "on" : ""}">${sw(s)}${SPORTS[s].name}</button>`).join("")}</div>`;
  if (k === "all") return renderAllSports(seg);
  const from28 = addDays(S.today, -28);
  const acts = S.acts.filter(a => a.sport === k);
  const last = acts.filter(a => a.date >= from28);
  const sumv = (arr, f) => arr.reduce((s, a) => s + (a[f] || 0), 0);
  const hrs = last.filter(a => a.avgHR);
  const avgHR = hrs.length ? sumv(hrs, "avgHR") / hrs.length : null;
  const tiles = [
    ["Treenejä (4 vko)", last.length], ["Aika (4 vko)", fmtH(sumv(last, "dur"))],
    k === "run" || k === "bike" ? ["Matka (4 vko)", fmtKm(sumv(last, "dist"))] : ["Kuorma (4 vko)", fmtNum(sumv(last, "load"))],
    k === "run" ? ["Keskivauhti", fmtPace(last.filter(a => a.speed).reduce((s, a, _, ar) => s + a.speed / ar.length, 0))] : ["Keskisyke", avgHR ? Math.round(avgHR) : "–"],
  ];
  const top = (f) => acts.reduce((b, a) => (a[f] || 0) > (b?.[f] || 0) ? a : b, null);
  const recs = [];
  if (k === "run") { const pb = personalBests(acts); for (const [d, l] of PB_DIST) if (pb[d]) recs.push([`Nopein ${l}`, fmtTime(pb[d].t), pb[d].a]); }
  if (k === "run" || k === "bike") { const t = top("dist"); if (t) recs.push(["Pisin matka", fmtKm(t.dist), t]); }
  { const t = top("dur"); if (t) recs.push(["Pisin kesto", fmtDur(t.dur), t]); }
  { const t = top("load"); if (t) recs.push(["Kovin kuorma", fmtNum(t.load), t]); }
  const hy = k === "hyrox" || k === "strength";
  const hySessions = hy ? acts.map(a => ({ a, la: lapAnalysis(a) })).filter(x => x.la?.runs?.length >= 2) : [];

  $("tab-sports").innerHTML = `${seg}
    <div class="grid g4" style="margin-top:14px">${tiles.map(([l, v]) => `<div class="card tile"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("")}</div>
    <h2 class="sec">Summat</h2>${totalsHTML([k])}
    <h2 class="sec">Viikoittainen määrä (tuntia)</h2><div class="card"><div class="chart" id="chVol"></div></div>
    ${k === "run" || k === "bike" ? `<h2 class="sec">${k === "run" ? `Vauhti sykkeellä ${HR_REF.run}` : `Pyöräily sykkeellä ${HR_REF.bike}`}</h2>
      <div class="card"><div class="chart" id="chEff"></div>
      <p class="small muted" style="margin:8px 0 0">Jokaisen treenin vauhti tai teho muunnettuna samaan sykkeeseen (${k === "run" ? HR_REF.run : HR_REF.bike} bpm, leposyke ${HR_REF.rest}). Näin treenit ovat vertailukelpoisia: kun käyrä paranee, kuntosi kehittyy. Viiva on 3 viikon keskiarvo.</p></div>` : ""}
    ${k === "run" ? techniqueHTML() : ""}
    ${hy && hySessions.length ? `<h2 class="sec">HYROX-juoksut</h2><div class="card"><div class="chart" id="chHy"></div>
      <div class="small" id="hySlow" style="margin-top:6px"></div>
      <p class="small muted" style="margin:8px 0 0">Juoksuosuuksien keskivauhti HYROX-treeneissä (kierrokset FIT-tiedostosta). Mitä pienempi hidastuminen asemien jälkeen, sitä paremmin kestät juoksun väsyneillä jaloilla.</p></div>` : ""}
    ${hy && !hySessions.length ? `<h2 class="sec">HYROX-juoksut</h2><div class="card small muted">Kierrosanalyysi näkyy, kun treeneissä on painettu lap-nappia jokaisen juoksun ja aseman vaihtuessa ja treenitiedostot on luettu (Kehitys → Hae tarkemmat tiedot).</div>` : ""}
    ${k === "strength" ? `<h2 class="sec">Treenit ja sarjat viikoittain</h2><div class="card"><div class="chart" id="chStr"></div></div>` : ""}
    <div style="margin-top:28px">${zonesCard(last, "Sykealueet (4 vko)")}</div>
    <div class="grid g2" style="margin-top:10px">
      <div class="card"><h3>Treenityypit (4 vko)</h3><div class="small muted">Millä intensiteetillä treenit on tehty</div>${typeList(last)}</div>
      <div class="card"><h3>Ennätykset</h3>
        ${recs.length ? recs.map(([l, v, a]) => `<div class="row between small" style="margin:6px 0"><span class="muted">${l}</span><span><b>${v}</b> <span class="muted">${dShort(a.date)}${a.date.getFullYear() !== S.today.getFullYear() ? a.date.getFullYear() : ""}</span></span></div>`).join("") : `<div class="muted small">Ei vielä treenejä.</div>`}
        ${k === "run" && !acts.some(a => a.best) ? `<div class="small muted" style="margin-top:8px">Nopeimmat 1 km, 5 km ja 10 km luetaan treenitiedostoista (Kehitys → Hae tarkemmat tiedot).</div>` : ""}</div>
    </div>
    <h2 class="sec">Viimeisimmät</h2>
    <div class="list">${acts.slice(-15).reverse().map(actItem).join("") || `<div class="empty">Ei treenejä tässä lajissa.</div>`}</div>
    ${acts.length > 15 ? `<button class="btn ghost sm" style="margin-top:10px" data-act="log-sport" data-sport="${k}">Näytä kaikki ${acts.length} treeniä</button>` : ""}
  `;
  const wk = weekly(S.acts, 16, S.today);
  barChart($("chVol"), {
    labels: wk.map(w => dShort(w.start)), tipLabels: wk.map(w => `Viikko ${isoWeekNum(w.start)} (${dShort(w.start)})`),
    series: [{ name: SPORTS[k].name, color: SPORTS[k].color, values: wk.map(w => w.sports[k].dur / 3600) }], yFmt: (v) => fmtNum(v, v < 10 ? 1 : 0),
  });
  if ($("chEff")) {
    const pts0 = efficiencySeries(S.acts, k).filter(p => p.x >= addDays(S.today, -365));
    const unit = pts0[pts0.length - 1]?.unit || "pace";
    const pts = pts0.filter(p => p.unit === unit);
    const fmt = (v) => fmtNorm(v, unit);
    lineChart($("chEff"), { height: 220, yFmt: unit === "pace" ? (v) => fmtPace(v).replace(" /km", "") : fmt, series: [
      { name: "Yksittäiset treenit", color: SPORTS[k].color, points: pts.map(p => ({ ...p, label: `${p.a.name || SPORTS[k].name}, ${dShort(p.x)}` })), opacity: 0, dots: true },
      { name: "3 viikon keskiarvo", color: "var(--text)", points: rolling(pts, 21) },
    ] });
  }
  for (const el of document.querySelectorAll("[data-dyn]")) {
    const x = dynSummary(S.acts, S.today)?.metrics[el.dataset.dyn];
    if (x) sparkline(el, x.pts.filter(p => p.x >= addDays(S.today, -180)).map(p => p.y), SPORTS.run.color);
  }
  if ($("chHy")) {
    const pts = hySessions.map(({ a, la }) => ({ x: a.date, y: la.runs.reduce((s, r) => s + r.speed, 0) / la.runs.length, label: a.name }));
    const slow = hySessions.map(({ a, la }) => ({ x: a.date, y: Math.max(0.5, la.runs.slice(1).reduce((s, r) => s + 1000 / r.speed, 0) / (la.runs.length - 1) - 1000 / la.runs[0].speed), label: a.name }));
    lineChart($("chHy"), { height: 200, yFmt: (v) => fmtPace(v).replace(" /km", ""), series: [{ name: "Juoksujen keskivauhti", color: SPORTS.hyrox.color, points: pts, dots: true }] });
    $("hySlow").innerHTML = (`<div>Hidastuminen asemien jälkeen viimeisimmässä: <b>${Math.round(slow[slow.length - 1].y)} s/km</b>${slow.length > 1 ? `, keskimäärin ${Math.round(slow.reduce((s, p) => s + p.y, 0) / slow.length)} s/km` : ""}</div>`);
  }
  if ($("chStr")) {
    const setsW = wk.map(w => S.acts.filter(a => a.sport === "strength" && a.date >= w.start && a.date < addDays(w.start, 7)).reduce((s, a) => s + (a.sets || 0), 0));
    const hasSets = setsW.some(Boolean);
    barChart($("chStr"), { labels: wk.map(w => dShort(w.start)), tipLabels: wk.map(w => `Viikko ${isoWeekNum(w.start)}`),
      series: [{ name: hasSets ? "Sarjoja" : "Treenejä", color: SPORTS.strength.color, values: hasSets ? setsW : wk.map(w => w.sports.strength.n) }] });
  }
}

function renderAllSports(seg) {
  const from28 = addDays(S.today, -28);
  const last = S.acts.filter(a => a.date >= from28);
  const sum = (f) => last.reduce((s, a) => s + (a[f] || 0), 0);
  const used = SPORT_KEYS.filter(k => S.acts.some(a => a.sport === k));
  const L = UI.log;
  $("tab-sports").innerHTML = `${seg}
    <div class="grid g4" style="margin-top:14px">
      <div class="card tile"><div class="l">Treenejä (4 vko)</div><div class="v">${last.length}</div></div>
      <div class="card tile"><div class="l">Aika (4 vko)</div><div class="v">${fmtH(sum("dur"))}</div></div>
      <div class="card tile"><div class="l">Matka (4 vko)</div><div class="v">${fmtKm(sum("dist"))}</div></div>
      <div class="card tile"><div class="l">Kuorma (4 vko)</div><div class="v">${fmtNum(sum("load"))}</div></div>
    </div>
    <h2 class="sec">Summat lajeittain</h2>${totalsHTML(["all", ...used])}
    <h2 class="sec">Treenitunnit viikoittain lajeittain</h2><div class="card"><div class="chart" id="chAll"></div></div>
    <div class="grid g2" style="margin-top:10px">${zonesCard(last, "Sykealueet (4 vko)")}<div class="card"><h3>Treenityypit (4 vko)</h3><div class="small muted">Kaikki lajit</div>${typeList(last)}</div></div>
    <h2 class="sec">Treeniloki</h2>
    <div class="card filters">
      <div class="grid g4">
        <div><label class="f" for="lgSport">Laji</label><select id="lgSport"><option value="all">Kaikki lajit</option>${SPORT_KEYS.map(k => `<option value="${k}" ${L.sport === k ? "selected" : ""}>${SPORTS[k].name}</option>`).join("")}</select></div>
        <div><label class="f" for="lgType">Tyyppi</label><select id="lgType"><option value="all">Kaikki tyypit</option>${ITYPE_KEYS.map(k => `<option value="${k}" ${L.itype === k ? "selected" : ""}>${ITYPES[k].name}</option>`).join("")}</select></div>
        <div><label class="f" for="lgDays">Aikaväli</label><select id="lgDays">${[["30", "30 päivää"], ["90", "3 kuukautta"], ["180", "6 kuukautta"], ["365", "1 vuosi"], ["all", "Kaikki"]].map(([v, l]) => `<option value="${v}" ${L.days === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label class="f" for="lgQ">Haku</label><input type="text" id="lgQ" value="${esc(L.q)}" placeholder="Nimi, esim. Hyrox"></div>
      </div>
    </div>
    <div id="logList"></div>`;
  const wk = weekly(S.acts, 16, S.today);
  barChart($("chAll"), { labels: wk.map(w => dShort(w.start)), tipLabels: wk.map(w => `Viikko ${isoWeekNum(w.start)} (${dShort(w.start)})`),
    series: used.map(k => ({ name: SPORTS[k].name, color: SPORTS[k].color, values: wk.map(w => w.sports[k].dur / 3600) })), yFmt: (v) => fmtNum(v, 1) });
  const upd = () => {
    L.sport = $("lgSport").value; L.itype = $("lgType").value; L.days = $("lgDays").value; L.q = $("lgQ").value.trim(); L.limit = 25;
    drawLog();
  };
  ["lgSport", "lgType", "lgDays"].forEach(id => $(id).addEventListener("change", upd));
  $("lgQ").addEventListener("input", upd);
  drawLog();
}
function drawLog() {
  const L = UI.log;
  const from = L.days === "all" ? null : addDays(S.today, -parseInt(L.days));
  const q = L.q.toLowerCase();
  const list = S.acts.filter(a => (L.sport === "all" || a.sport === L.sport) && (L.itype === "all" || a.itype === L.itype) && (!from || a.date >= from) && (!q || (a.name || "").toLowerCase().includes(q))).reverse();
  const dur = list.reduce((s, a) => s + a.dur, 0), dist = list.reduce((s, a) => s + a.dist, 0);
  $("logList").innerHTML = `<div class="small muted" style="margin:10px 2px">${list.length} treeniä · ${fmtH(dur)}${dist > 500 ? ` · ${fmtKm(dist)}` : ""}</div>
    <div class="list">${list.slice(0, L.limit).map(actItem).join("") || `<div class="empty">Ei treenejä valituilla ehdoilla.</div>`}</div>
    ${list.length > L.limit ? `<button class="btn ghost sm" style="margin-top:10px" data-act="log-more">Näytä lisää (${list.length - L.limit})</button>` : ""}`;
}

// ---------------- KEHITYS ----------------
function fitRemaining() {
  return Object.values(S.raw?.activities || {}).filter(a => (/run|cycl|bik|ride|cardio|hiit|strength|hyrox|crossfit|fitness_equipment|bootcamp/i.test(a.activityType?.typeKey || "") || /hyrox/i.test(a.activityName || "")) && ((a._fitV || 0) < 3 || ((a._fitV || 0) < 4 && /run/i.test(a.activityType?.typeKey || "") && a.avgGroundContactTime == null && a.averageRunningCadenceInStepsPerMinute == null && a.avgVerticalOscillation == null))).length;
}
function trendCards(group) {
  const order = { down: 0, up: 1, flat: 2, unknown: 3 };
  const cards = S.trends.filter(t => t.group === group && t.points.length >= 2).sort((a, b) => order[a.state] - order[b.state]);
  if (!cards.length) return "";
  return `<div class="grid g2">${cards.map(t => `
    <div class="card trend"><div class="top"><div><h3>${t.sport ? sw(t.sport) : ""}${t.name}</h3><div class="small muted">${t.desc}</div></div>${stateBadge(t.state)}</div>
    <div class="v">${t.recent != null ? t.fmt(t.recent) : "–"} <span class="small muted">${t.unit}</span>
      ${t.change != null && t.state !== "unknown" ? `<span class="small muted">(${fmtPct(t.change)} vs. ${t.fmt(t.base)})</span>` : ""}</div>
    <div class="spark" data-spark="${t.key}"></div></div>`).join("")}</div>`;
}
function reviewFullHTML() {
  const rv = weekReview(S.acts, S.health, S.planFor, addDays(weekStart(S.today), -7));
  const zt = rv.zt || 1;
  return `<div class="card">
    <div class="row between"><h3>Viikko ${rv.week} (${dShort(rv.ws)}–${dShort(addDays(rv.ws, 6))})</h3><span class="small muted">${rv.n} treeniä · ${fmtH(rv.dur)} · kuorma ${fmtNum(rv.load)}</span></div>
    <div class="grid g2" style="margin-top:10px">
      <div>
        ${Object.entries(rv.bySport).map(([k, b]) => `<div class="row between small" style="margin:4px 0"><span>${sw(k)}${SPORTS[k].name}</span><span>${b.n} × · ${fmtH(b.dur)}${b.dist > 500 ? ` · ${fmtKm(b.dist)}` : ""}</span></div>`).join("") || `<div class="small muted">Ei treenejä.</div>`}
        ${rv.zt ? `<div style="margin-top:10px">${zbar(rv.z, 8)}</div><div class="small muted" style="margin-top:4px">Kevyt ${Math.round((rv.z[0] + rv.z[1]) / zt * 100)} % · tempo ${Math.round(rv.z[2] / zt * 100)} % · kova ${Math.round((rv.z[3] + rv.z[4]) / zt * 100)} %</div>` : ""}
      </div>
      <div><ul class="small findings">${rv.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
        ${rv.longest ? `<div class="small muted" style="margin-top:8px">Pisin: ${esc(rv.longest.name || SPORTS[rv.longest.sport].name)} ${fmtDur(rv.longest.dur)}${rv.hardest && rv.hardest !== rv.longest ? ` · kuormittavin: ${esc(rv.hardest.name || SPORTS[rv.hardest.sport].name)} (${fmtNum(rv.hardest.load)})` : ""}</div>` : ""}
      </div>
    </div></div>`;
}

function renderProgress() {
  const R = UI.range;
  const weeks = Math.max(4, Math.min(52, Math.round(R / 7)));
  const rem = fitRemaining(), fd = S.raw?.fitDebug;
  $("tab-progress").innerHTML = `
    <div class="row between" style="margin-top:20px">
      <div class="seg" id="rangeSeg">${[[28, "4 vk"], [90, "3 kk"], [180, "6 kk"], [365, "1 v"]].map(([d, l]) => `<button data-range="${d}" class="${R === d ? "on" : ""}">${l}</button>`).join("")}</div>
    </div>
    <h2 class="sec">Viikkokatsaus</h2>${reviewFullHTML()}
    <h2 class="sec">Huomiot ja ehdotukset</h2>
    <div class="list">${S.alerts.length ? S.alerts.map(alertHTML).join("") : `<div class="card muted">Ei huomautettavaa. Kaikki osa-alueet ovat vakaita tai paranevat.</div>`}</div>
    <p class="small muted">Vertailu: viimeiset 4 viikkoa vs. sitä edeltävät 8 viikkoa (palautumisessa 7 pv vs. 30 pv). Ehdotukset päivittyvät kalenteriin automaattisesti.</p>

    <h1 class="grp">Kunto</h1>
    ${trendCards("kunto")}
    <h2 class="sec">VO2max</h2>
    <div class="card"><div class="chart" id="chVo2"></div>
      <div class="row between" style="margin-top:10px;gap:10px">
        <span class="small muted" id="fitInfo">${fd ? `Tarkistettu ${fd.checked} treenitiedostoa, VO2max löytyi ${fd.found}:stä. ` : ""}${rem ? `${rem} treeniä tarkistamatta.` : "Kaikki treenit tarkistettu."}</span>
        ${rem ? `<button class="btn ghost sm" data-act="fit-backfill">Hae tarkemmat tiedot</button>` : ""}</div>
      <p class="small muted" style="margin:8px 0 0">Treenitiedostoista luetaan VO2max, kierrokset (HYROX-analyysi) ja nopeimmat juoksumatkat. Uudet treenit tarkistetaan automaattisesti jokaisella haulla.</p></div>
    <div class="grid g2" style="margin-top:10px">
      <div class="card"><h3>${sw("run")}Vauhti sykkeellä ${HR_REF.run}</h3><div class="chart" id="chRunEff"></div></div>
      <div class="card"><h3>${sw("bike")}Pyöräily sykkeellä ${HR_REF.bike}</h3><div class="chart" id="chBikeEff"></div></div>
    </div>

    <h1 class="grp">Kuormitus</h1>
    ${trendCards("kuormitus")}
    <h2 class="sec">Kuorma lajeittain</h2><div class="card"><div class="chart" id="chLoad"></div></div>
    <h2 class="sec">Aika sykealueilla (tuntia)</h2>
    <div class="card"><div class="chart" id="chInt"></div>
      ${S.share ? `<p class="small muted" style="margin:8px 0 0">80/20-jakauma, viim. 4 vko: kevyt (Z1–2) <b style="color:var(--text)">${Math.round(S.share.easy * 100)} %</b>, tempo (Z3) ${Math.round(S.share.mod * 100)} %, kova (Z4–5) ${Math.round(S.share.hard * 100)} %. Kestävyyslajeissa tavoite on noin 80 % kevyttä.</p>` : ""}</div>
    <h2 class="sec">Treenityypit (kpl)</h2><div class="card"><div class="chart" id="chTypes"></div></div>

    <h1 class="grp">Palautuminen</h1>
    ${trendCards("palautuminen")}
    <h2 class="sec">HRV (yö)</h2>
    <div class="card"><div class="chart" id="chHrv"></div><p class="small muted" style="margin:8px 0 0">Varjostettu alue on Garminin laskema normaalialueesi.</p></div>
    <div class="grid g2" style="margin-top:10px">
      <div class="card"><h3>Leposyke</h3><div class="chart" id="chRhr"></div></div>
      <div class="card"><h3>Uni (tuntia)</h3><div class="chart" id="chSleep"></div></div>
      <div class="card"><h3>Body Battery herätessä</h3><div class="chart" id="chBb"></div></div>
      <div class="card"><h3>Stressi (päivän keskiarvo)</h3><div class="chart" id="chStress"></div></div>
      <div class="card"><h3>Syvän unen osuus (%)</h3><div class="chart" id="chDeep"></div></div>
    </div>
  `;
  for (const el of document.querySelectorAll("[data-spark]")) {
    const t = S.trends.find(x => x.key === el.dataset.spark);
    const pts = t.key.endsWith("Eff") ? rolling(t.points, 21).slice(-40) : t.points.slice(-40);
    sparkline(el, pts.map(p => p.y), t.sport ? SPORTS[t.sport].color : "var(--accent-hi)");
  }
  const from = addDays(S.today, -R);
  const empty = (el, msg) => { el.innerHTML = `<div class="empty small">${msg}</div>`; };
  {
    const ser = [["run", S.vo2.run], ["bike", S.vo2.bike]].map(([k, p]) => ({ name: SPORTS[k].name, color: SPORTS[k].color, dots: true,
      points: p.filter(x => x.x >= from).map(x => ({ x: x.x, y: x.y, label: `${x.a?.name || SPORTS[k].name}, ${dShort(x.x)}` })) })).filter(s => s.points.length);
    if (ser.some(x => x.points.length >= 2)) lineChart($("chVo2"), { height: 200, series: ser, yFmt: (v) => fmtNum(v, 0) });
    else if (ser.length) empty($("chVo2"), `Nykyinen VO2max: ${ser.map(x => `${x.name.toLowerCase()} <b style="color:var(--text)">${fmtNum(x.points[x.points.length - 1].y, 0)}</b>`).join(", ")}. Kaavio piirtyy, kun arvoja on useammalta päivältä.`);
    else empty($("chVo2"), "VO2max-arvoja ei ole vielä löytynyt valitulta aikaväliltä.");
  }
  for (const [sp, id] of [["run", "chRunEff"], ["bike", "chBikeEff"]]) {
    const pts0 = efficiencySeries(S.acts, sp).filter(p => p.x >= from);
    const unit = pts0[pts0.length - 1]?.unit;
    const pts = pts0.filter(p => p.unit === unit);
    if (pts.length < 2) { empty($(id), "Liian vähän treenejä sykkeellä."); continue; }
    lineChart($(id), { height: 170, yFmt: unit === "pace" ? (v) => fmtPace(v).replace(" /km", "") : (v) => fmtNorm(v, unit), series: [
      { name: "Treenit", color: SPORTS[sp].color, points: pts, opacity: 0, dots: true },
      { name: "3 vk ka.", color: "var(--text)", points: rolling(pts, 21) }] });
  }
  const wk = weekly(S.acts, weeks, S.today);
  const labels = wk.map(w => dShort(w.start)), tipLabels = wk.map(w => `Viikko ${isoWeekNum(w.start)} (${dShort(w.start)})`);
  barChart($("chLoad"), { labels, tipLabels, series: SPORT_KEYS.filter(k => wk.some(w => w.sports[k].load > 0)).map(k => ({ name: SPORTS[k].name, color: SPORTS[k].color, values: wk.map(w => w.sports[k].load) })) });
  barChart($("chInt"), { labels, tipLabels, yFmt: (v) => fmtNum(v, 1), series: ZONES.map((zn, i) => ({ name: `${zn.short} ${zn.desc}`, color: zn.color, values: wk.map(w => w.z[i] / 3600) })) });
  barChart($("chTypes"), { labels, tipLabels, series: ITYPE_KEYS.filter(k => wk.some(w => w.types[k])).map(k => ({ name: ITYPES[k].name, color: ITYPES[k].color, values: wk.map(w => w.types[k]?.n || 0) })) });

  const fk = dayKey(from);
  const hp = (f, tf = (v) => v) => S.health.filter(d => d.day >= fk && d[f] != null).map(d => ({ x: parseDay(d.day), y: tf(d[f]) }));
  const two = (id, pts, fmt) => {
    if (pts.length < 2) return empty($(id), "Ei dataa valitulta aikaväliltä.");
    lineChart($(id), { height: 170, yFmt: fmt, series: [{ name: "Päivä", color: "var(--accent-hi)", points: pts, opacity: 0.35, width: 1.5 }, { name: "7 pv ka.", color: "var(--text)", points: rolling(pts, 7) }] });
  };
  const latest = [...S.health].reverse().find(d => d.hrvLo != null);
  const hrv = hp("hrv");
  if (hrv.length >= 2) lineChart($("chHrv"), { height: 200, band: latest ? { lo: latest.hrvLo, hi: latest.hrvHi } : null, yFmt: (v) => `${Math.round(v)}`,
    series: [{ name: "Yö", color: "var(--accent-hi)", points: hrv, opacity: 0.35, width: 1.5 }, { name: "7 pv keskiarvo", color: "var(--text)", points: rolling(hrv, 7) }] });
  else empty($("chHrv"), "Ei HRV-dataa valitulta aikaväliltä.");
  two("chRhr", hp("rhr"));
  two("chSleep", hp("sleepSec", v => v / 3600), (v) => fmtNum(v, 1));
  two("chBb", hp("bbWake"));
  two("chStress", hp("stress"));
  two("chDeep", hp("deepPct", v => v * 100));
}

// ---------------- KALENTERI ----------------
function weekTitle(ws) {
  const diff = Math.round((ws - weekStart(S.today)) / (7 * 864e5));
  return { 0: "Tämä viikko", 1: "Ensi viikko", "-1": "Viime viikko" }[diff] || `Viikko ${isoWeekNum(ws)}`;
}
function weekHTML(plan) {
  const tk = dayKey(S.today);
  const start = plan.days[0].date, end = plan.days[6].date;
  const T = plan.totals;
  return `
    <div class="week-h"><h3>${weekTitle(start)}</h3><span class="small muted">vko ${isoWeekNum(start)} · ${dShort(start)}–${dShort(end)}</span></div>
    <div class="weeksum small">${plan.pastWeek ? "" : `Suunniteltu <b>${fmtH(T.plannedDur)}</b> · `}Tehty <b>${fmtH(T.doneDur)}</b> (${T.doneN} treeniä)${S.settings.weeklyHours ? ` · tavoite ${fmtNum(S.settings.weeklyHours, 1)} h` : ""}</div>
    ${plan.pastWeek ? `<div class="weeksum small">Kuorma <b>${fmtNum(T.doneLoad)}</b>${T.typWeek ? ` (tavallinen viikko ~${fmtNum(T.typWeek)})` : ""}</div>` : weekLoadHTML(T)}
    <div class="cal">${plan.days.map(d => {
      const k = dayKey(d.date);
      const cls = k === tk ? "today" : k < tk ? "past" : "";
      return `<div class="day ${cls}"><div class="dh"><b>${DAY_NAMES[d.idx]}</b><span>${dShort(d.date)}<button class="add" data-act="add" data-date="${k}" aria-label="Lisää treeni ${dShort(d.date)}" title="Lisää treeni">+</button></span></div>
        ${d.items.map(sessHTML).join("")}
        ${(d.extra || []).map(a => `<div class="sess actual" style="border-left-color:${SPORTS[a.sport].color}"><div class="st-t">${esc(a.name || SPORTS[a.sport].name)}</div><div class="muted">Tehty · ${fmtDur(a.dur)}</div></div>`).join("")}
        ${!d.items.length && !(d.extra || []).length ? `<div class="rest">${d.rest && k >= tk ? "😴 " : ""}Lepo${d.rest?.reason && k >= tk ? `<div class="rr">${esc(d.rest.reason)}</div>` : ""}</div>` : ""}
        ${d.load ? `<div class="dload" title="Päivän ${k < tk ? "toteutunut" : "arvioitu"} kuorma"><div class="dl-bar"><span style="width:${Math.min(100, d.load / Math.max(1, (plan.totals.dailyTyp || 60) * 3) * 100)}%;background:${d.load > (plan.totals.dailyTyp || 60) * 2.2 ? "var(--z4)" : d.load > (plan.totals.dailyTyp || 60) * 1.2 ? "var(--z3)" : "var(--z2)"}"></span></div><span>${k < tk ? "" : "~"}${Math.round(d.load)}</span></div>` : ""}</div>`;
    }).join("")}</div>`;
}
function weekLoadHTML(T) {
  if (!T.typWeek) return `<div class="weeksum small">Arvioitu kuorma <b>~${fmtNum(T.weekLoad)}</b> · lepopäiviä ${T.restDays}</div>`;
  const r = T.loadRatio;
  const cls = r > 1.3 ? "down" : r < 0.7 ? "warn" : "up";
  const txt = r > 1.3 ? "raskas viikko" : r < 0.7 ? "kevyt viikko" : r > 1.1 ? "nouseva" : "tasainen";
  const pos = Math.min(100, (r / 2) * 100);
  return `<div class="weeksum small wl">Arvioitu kuorma <b>~${fmtNum(T.weekLoad)}</b> (tavallinen ~${fmtNum(T.typWeek)}, <span class="${cls}">${fmtNum(r * 100)} % · ${txt}</span>) · lepopäiviä ${T.restDays}
    <div class="wlbar"><span class="z1"></span><span class="z2"></span><span class="z3"></span><span class="z4"></span><i style="left:${pos}%"></i></div></div>`;
}
function monthHTML() {
  const base = new Date(S.today.getFullYear(), S.today.getMonth() + UI.monthOffset, 1);
  const first = weekStart(base);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const tk = dayKey(S.today);
  let cells = "";
  for (let ws = first; ws < end; ws = addDays(ws, 7)) {
    const p = S.planFor(ws);
    cells += p.days.map(d => {
      const k = dayKey(d.date);
      const other = d.date.getMonth() !== base.getMonth();
      const items = [...d.items.map(it => ({ c: it.kind === "event" ? "var(--accent)" : SPORTS[it.sport].color, t: it.kind === "event" ? `🏁 ${it.title}` : it.title, done: it.done })),
        ...(d.extra || []).map(a => ({ c: SPORTS[a.sport].color, t: a.name || SPORTS[a.sport].name, done: true }))];
      return `<div class="mday ${other ? "other" : ""} ${k === tk ? "today" : ""}" data-act="goweek" data-date="${k}" role="button" tabindex="0" aria-label="${dLong(d.date)}">
        <div class="mdh">${d.date.getDate()}</div>${items.slice(0, 3).map(i => `<div class="mi ${i.done ? "done" : ""}" style="--c:${i.c};border-left-color:var(--c)">${esc(i.t)}</div>`).join("")}${items.length > 3 ? `<div class="mi more">+${items.length - 3}</div>` : ""}</div>`;
    }).join("");
  }
  return `<div class="week-h"><h3 style="text-transform:capitalize">${base.toLocaleDateString("fi-FI", { month: "long", year: "numeric" })}</h3><span class="small muted">Napauta päivää nähdäksesi viikon</span></div>
    <div class="month">${DAY_NAMES.map(n => `<div class="mhead">${n}</div>`).join("")}${cells}</div>`;
}
async function icsLink() {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(UI.password + ":ics"));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    return `${location.origin}/kalenteri.ics?k=${hex}`;
  } catch { return null; }
}
function renderCalendar() {
  const week = UI.calView === "week";
  const w0 = addDays(weekStart(S.today), 7 * UI.calOffset);
  const plans = [S.planFor(w0), S.planFor(addDays(w0, 7))];
  const ch = [...new Set(plans.filter(p => !p.pastWeek).flatMap(p => p.changes))];
  const recurring = S.plan.items.filter(i => i.repeat === "weekly");
  $("tab-calendar").innerHTML = `
    <div class="row between" style="margin-top:20px">
      <div class="row" style="gap:6px">
        <button class="btn ghost sm" data-act="cal-prev" aria-label="Edellinen">‹</button>
        <button class="btn ghost sm" data-act="cal-today">Tänään</button>
        <button class="btn ghost sm" data-act="cal-next" aria-label="Seuraava">›</button>
        <div class="seg" style="margin-left:6px"><button data-act="cal-view" data-view="week" class="${week ? "on" : ""}">Viikko</button><button data-act="cal-view" data-view="month" class="${week ? "" : "on"}">Kuukausi</button></div>
      </div>
      <button class="btn sm" data-act="add" data-date="${dayKey(S.today)}">+ Lisää treeni</button>
    </div>
    ${S.phase ? `<div class="phase card" style="margin-top:12px"><b>${S.phase.phase}</b> · ${esc(S.phase.event.name)} ${S.phase.days} pv <div class="small muted">${esc(S.phase.desc)}</div></div>` : ""}
    <div class="card" style="margin-top:12px">
      <div class="small">Suunnitelma rakennetaan asetusten treenimäärien pohjalta ja päivittyy datasi mukaan. Napauta treeniä nähdäksesi sen tarkan sisällön, siirtääksesi tai muokataksesi sitä. Käsin lisätty treeni korvaa saman lajin automaattisen ehdotuksen sillä viikolla.</div>
      ${ch.length ? `<div class="changes"><div class="small" style="color:var(--accent-hi);font-weight:600">Automaattiset muutokset:</div><ul class="small" style="margin:6px 0 0;padding-left:18px;color:var(--text-2)">${ch.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
      ${S.plan.hidden?.length ? `<div style="margin-top:10px"><button class="mini" data-act="unhide">Palauta piilotetut ehdotukset (${S.plan.hidden.length})</button></div>` : ""}
    </div>
    ${week ? plans.map(weekHTML).join("") : monthHTML()}
    ${recurring.length ? `<h2 class="sec">Toistuvat treenit</h2><div class="list">${recurring.map(r => `
      <div class="item"><div>${sw(r.sport)}<span class="n">${esc(r.title || SPORTS[r.sport].name)}</span>
        <div class="small muted">${repeatText(r)}${r.until ? ` · päättyy ${dShort(parseDay(r.until))}` : ""}</div></div>
        <div class="row" style="gap:6px">${ibadge(r.itype)}<button class="mini" data-act="edit" data-mid="${esc(r.id)}">Muokkaa</button></div></div>`).join("")}</div>` : ""}
    <h2 class="sec">Puhelimen kalenteri</h2>
    <div class="card small">
      <div>Tilaa treenisuunnitelma puhelimesi kalenteriin. Kalenteri päivittyy itsestään muutaman tunnin välein ja näyttää edellisen viikon ja seuraavat 4 viikkoa treenien sisältöineen.</div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:nowrap"><input type="text" id="icsUrl" readonly value="Lasketaan…" style="flex:1;min-width:0"><button class="btn ghost sm" data-act="copy-ics">Kopioi</button></div>
      <ul class="findings" style="margin-top:10px">
        <li><b>iPhone:</b> Asetukset → Kalenteri → Tilit → Lisää tili → Muu → Lisää tilattu kalenteri → liitä linkki.</li>
        <li><b>Android / Google-kalenteri:</b> avaa calendar.google.com tietokoneella → Muut kalenterit → + → URL-osoitteesta → liitä linkki.</li>
      </ul>
      <div class="muted">Linkki toimii ilman salasanaa, joten älä jaa sitä. Jos vaihdat sivuston salasanan, linkki vaihtuu.</div>
    </div>
    <p class="small muted" style="margin-top:16px">Garminin rajapinta on vain lukua varten, joten suunnitelmaa ei voi lähettää kelloon. Treenit merkitään tehdyiksi automaattisesti, kun samaa lajia löytyy samalta päivältä.</p>
  `;
  icsLink().then(u => { if ($("icsUrl")) $("icsUrl").value = u || "Selain ei tue linkin laskemista"; });
}

// ---------------- treenin lisäys, muokkaus ja siirto ----------------
const WEEKDAY_ADV = ["maanantaisin", "tiistaisin", "keskiviikkoisin", "torstaisin", "perjantaisin", "lauantaisin", "sunnuntaisin"];
function repeatText(r) { return `Joka viikko ${WEEKDAY_ADV[weekdayIdx(parseDay(r.date))]}${r.time ? ` klo ${r.time}` : ""} · ${fmtDur(r.dur)}`; }

function modal(html) {
  const m = document.createElement("div");
  m.className = "modal-bg";
  m.innerHTML = html;
  document.body.appendChild(m);
  const close = () => { m.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) close(); });
  return { m, close, f: (id) => m.querySelector("#" + id) };
}

function openForm({ date, mid } = {}) {
  const ex = mid ? S.plan.items.find(i => i.id === mid) : null;
  const tk = dayKey(S.today);
  const v = ex ? { ...ex } : { title: "", sport: "strength", itype: "strength", date: date || tk, time: "", dur: 3600, repeat: "none", until: "", note: "", done: (date || tk) < tk };
  const typeOpts = ITYPE_KEYS.filter(k => k !== "unknown").map(k => `<option value="${k}" ${v.itype === k ? "selected" : ""}>${ITYPES[k].name}</option>`).join("");
  const sportOpts = SPORT_KEYS.map(k => `<option value="${k}" ${v.sport === k ? "selected" : ""}>${SPORTS[k].name}</option>`).join("");
  const { f, close } = modal(`
    <form class="modal card" id="wForm" novalidate>
      <div class="row between"><h3>${ex ? "Muokkaa treeniä" : "Lisää treeni"}</h3><button type="button" class="mini" data-close aria-label="Sulje">✕</button></div>
      <label class="f" for="fTitle">Nimi</label>
      <input type="text" id="fTitle" value="${esc(v.title)}" placeholder="HYROX-treeni" maxlength="80">
      <div class="grid g2">
        <div><label class="f" for="fSport">Laji</label><select id="fSport">${sportOpts}</select></div>
        <div><label class="f" for="fType">Intensiteetti</label><select id="fType">${typeOpts}</select></div>
      </div>
      <div class="grid g3">
        <div><label class="f" for="fDate">Päivä</label><input type="date" id="fDate" value="${esc(v.date)}"></div>
        <div><label class="f" for="fTime">Kellonaika</label><input type="time" id="fTime" value="${esc(v.time)}"></div>
        <div><label class="f" for="fDur">Kesto (min)</label><input type="number" id="fDur" min="1" max="1440" value="${Math.round((v.dur || 0) / 60)}"></div>
      </div>
      <label class="f" for="fRepeat">Toistuu</label>
      <select id="fRepeat"><option value="none" ${v.repeat !== "weekly" ? "selected" : ""}>Ei toistu</option><option value="weekly" ${v.repeat === "weekly" ? "selected" : ""}>Joka viikko</option></select>
      <div id="fWeekly"><div class="small" id="fRepeatText" style="color:var(--accent-hi);margin-top:8px"></div>
        <label class="f" for="fUntil">Päättyy (valinnainen)</label><input type="date" id="fUntil" value="${esc(v.until || "")}"></div>
      <label class="row small" id="fDoneRow" style="margin-top:14px;gap:10px;flex-wrap:nowrap"><input type="checkbox" id="fDone" ${v.done ? "checked" : ""}> Treeni on tehty. Se lasketaan tilastoihin, ellei Garminista löydy saman lajin treeniä samalta päivältä.</label>
      <label class="f" for="fNote">Muistiinpano</label>
      <input type="text" id="fNote" value="${esc(v.note || "")}" placeholder="Salin HYROX-ryhmä, tuo omat kengät" maxlength="400">
      <p class="small" id="fErr" style="color:var(--bad);min-height:1.2em;margin:10px 0 0"></p>
      <div class="row between" style="margin-top:6px">
        ${ex ? `<button type="button" class="btn ghost sm danger" data-act="del" data-mid="${esc(ex.id)}">Poista${ex.repeat === "weekly" ? " sarja" : ""}</button>` : "<span></span>"}
        <div class="row" style="gap:8px"><button type="button" class="btn ghost" data-close>Peruuta</button><button type="submit" class="btn">Tallenna</button></div>
      </div>
    </form>`);
  const sync = () => {
    const weekly = f("fRepeat").value === "weekly";
    f("fWeekly").classList.toggle("hidden", !weekly);
    f("fDoneRow").classList.toggle("hidden", weekly);
    const d = f("fDate").value;
    f("fRepeatText").textContent = weekly && d ? `${repeatText({ date: d, time: f("fTime").value, dur: (parseInt(f("fDur").value) || 0) * 60 })}, alkaen ${dShort(parseDay(d))}` : "";
  };
  ["fRepeat", "fDate", "fTime", "fDur"].forEach(id => f(id).addEventListener("input", () => { f("fErr").textContent = ""; sync(); }));
  f("fDate").addEventListener("change", () => { if (!ex) f("fDone").checked = f("fDate").value < dayKey(S.today); });
  f("fSport").addEventListener("change", () => {
    const sp = f("fSport").value;
    if ((sp === "strength" || sp === "hyrox") && !ex) f("fType").value = sp === "hyrox" ? "threshold" : "strength";
    if (sp !== "strength" && sp !== "hyrox" && f("fType").value === "strength") f("fType").value = "base";
  });
  sync();
  f("wForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const date = f("fDate").value, mins = parseInt(f("fDur").value), weekly = f("fRepeat").value === "weekly";
    const until = weekly ? f("fUntil").value : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { f("fErr").textContent = "Valitse päivä."; return; }
    if (!mins || mins < 1 || mins > 1440) { f("fErr").textContent = "Anna kesto minuutteina (1–1440)."; return; }
    if (until && until < date) { f("fErr").textContent = "Päättymispäivä ei voi olla ennen aloituspäivää."; return; }
    const item = {
      ...(ex || {}), id: ex?.id || newId(), title: f("fTitle").value.trim(), sport: f("fSport").value, itype: f("fType").value,
      date, time: f("fTime").value, dur: mins * 60, repeat: weekly ? "weekly" : "none", until,
      note: f("fNote").value.trim(), done: !weekly && f("fDone").checked, skip: weekly ? (ex?.skip || []) : [],
    };
    const items = ex ? S.plan.items.map(i => (i.id === ex.id ? item : i)) : [...S.plan.items, item];
    if (await savePlan({ ...S.plan, items }, f("fErr"))) close();
  });
  setTimeout(() => f("fTitle").focus(), 30);
}

function findSession(key) {
  for (let w = -8; w <= 8; w++) {
    const p = S.planFor(addDays(weekStart(S.today), 7 * (UI.calOffset + w)));
    for (const d of p.days) for (const it of d.items) {
      if (key.startsWith("a|") && !it.manual && it.hideKey === key.slice(2)) return it;
      if (key.startsWith("m|") && it.manual && `m|${it.mid}|${it.date}` === key) return it;
    }
  }
  return null;
}
function openMove(key) {
  const it = findSession(key);
  if (!it) return;
  const from = it.date || it.hideKey?.split("|")[0];
  const { f, close } = modal(`
    <form class="modal card" id="mvForm" novalidate>
      <div class="row between"><h3>Siirrä treeni</h3><button type="button" class="mini" data-close aria-label="Sulje">✕</button></div>
      <p class="small muted" style="margin:6px 0 0"><b style="color:var(--text)">${esc(it.title)}</b> · ${dLong(parseDay(from))}${it.recurring ? " · siirtää vain tämän kerran" : ""}</p>
      <div class="grid g2"><div><label class="f" for="mvDate">Uusi päivä</label><input type="date" id="mvDate" value="${from}"></div>
        <div><label class="f" for="mvTime">Kellonaika</label><input type="time" id="mvTime" value="${esc(it.time || "")}"></div></div>
      <p class="small" id="mvErr" style="color:var(--bad);min-height:1.2em;margin:10px 0 0"></p>
      <div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn ghost" data-close>Peruuta</button><button type="submit" class="btn">Siirrä</button></div>
    </form>`);
  f("mvForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nd = f("mvDate").value, nt = f("mvTime").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) { f("mvErr").textContent = "Valitse päivä."; return; }
    let plan = { ...S.plan, items: [...S.plan.items], hidden: [...(S.plan.hidden || [])] };
    if (it.manual) {
      const src = plan.items.find(i => i.id === it.mid);
      if (it.recurring) {
        plan.items = plan.items.map(i => (i.id === it.mid ? { ...i, skip: [...new Set([...(i.skip || []), it.date])] } : i));
        plan.items.push({ ...src, id: newId(), repeat: "none", until: "", skip: [], date: nd, time: nt, done: false });
      } else plan.items = plan.items.map(i => (i.id === it.mid ? { ...i, date: nd, time: nt } : i));
    } else {
      const det = S.sessionDetail(it);
      plan.hidden.push(it.hideKey);
      plan.items.push({ id: newId(), title: it.title, sport: it.sport, itype: det?.itype || (it.kind === "hard" ? "threshold" : it.sport === "strength" ? "strength" : "base"),
        tpl: it.tpl || null, date: nd, time: nt, dur: it.dur, repeat: "none", until: "", note: it.why || "", done: false, skip: [] });
    }
    if (await savePlan(plan, f("mvErr"))) close();
  });
}

async function savePlan(plan, errEl) {
  try {
    await api("plan", plan);
    S.raw.plan = plan;
    refresh();
    return true;
  } catch (e) {
    if (errEl) errEl.textContent = `Tallennus epäonnistui: ${e.message}`;
    else alert(`Tallennus epäonnistui: ${e.message}`);
    return false;
  }
}

// ---------------- ASETUKSET ----------------
const MAP_OPTS = [["", "Automaattinen"], ...SPORT_KEYS.map(k => [k, SPORTS[k].name]), ["exclude", "Ei analyyseihin"]];
function renderSettings() {
  const s = S.settings;
  const st = S.raw?.status;
  let events = (s.events || []).map(e => ({ ...e }));
  const dayOpts = (sel, withNone) => (withNone ? `<option value="-1" ${sel === -1 ? "selected" : ""}>Ei kiinteää</option>` : "") + DAY_NAMES_LONG.map((n, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${n}</option>`).join("");
  const counts = {};
  for (const a of Object.values(S.raw?.activities || {})) { const t = a.activityType?.typeKey || "other"; counts[t] = (counts[t] || 0) + 1; }
  const sample = Object.values(S.raw?.activities || {}).slice(-1)[0];
  const hs = Object.fromEntries(Object.entries(S.raw?.healthByDate || {}).map(([t, o]) => [t, Object.values(o).slice(-1)[0]]));
  const remembered = !!ls.get("pw");

  $("tab-settings").innerHTML = `
    <h2 class="sec">Viikon treenit</h2>
    <div class="card">
      <div class="small muted">Montako treeniä viikossa kalenteri suunnittelee kullekin lajille.</div>
      <div class="grid g5">${SPORT_KEYS.map(k => `<div><label class="f" for="n_${k}">${sw(k)}${SPORTS[k].name}</label><input type="number" min="0" max="10" id="n_${k}" value="${s.sessions[k] || 0}"></div>`).join("")}</div>
      <div class="grid g3">
        <div><label class="f" for="wHours">Viikkotavoite (tuntia)</label><input type="number" min="0" max="40" step="0.5" id="wHours" value="${s.weeklyHours ?? ""}" placeholder="esim. 7"></div>
        <div><label class="f" for="restDay">Lepopäivä</label><select id="restDay">${dayOpts(s.restDay, true)}</select></div>
        <div><label class="f" for="longDay">Pitkän treenin päivä</label><select id="longDay">${dayOpts(s.longDay)}</select></div>
      </div>
      <label class="row small" style="margin-top:14px;gap:10px;flex-wrap:nowrap"><input type="checkbox" id="auto" ${s.auto ? "checked" : ""}> Muokkaa suunnitelmaa automaattisesti trendien ja palautumisen mukaan</label>
    </div>

    <h2 class="sec">Tavoitetapahtumat</h2>
    <div class="card">
      <div class="small muted"><b>A</b> = päätavoite (2 viikon kevennys ja harjoituskaudet lasketaan siihen), <b>B</b> = tärkeä (1 viikon kevennys), <b>C</b> = harjoituskisa (vain kisapäivä ja kevyt edellinen päivä).</div>
      <div id="evList"></div>
      <button class="btn ghost sm" style="margin-top:10px" id="evAdd">+ Lisää tapahtuma</button>
    </div>

    <h2 class="sec">Lajit</h2>
    <div class="card">
      <div class="small muted">Garminin treenityypit ja mihin lajiin ne lasketaan. HYROX tunnistetaan automaattisesti, jos treenin nimessä on sana "Hyrox". "Ei analyyseihin" jättää treenit pois kaikista laskelmista (esim. työmatkat).</div>
      <table class="cmp maptbl" style="margin-top:10px">${S.typeKeys.map(t => `<tr><td>${esc(t)} <span class="muted">(${counts[t] || 0})</span></td><td><select data-map="${esc(t)}">${MAP_OPTS.map(([v, l]) => `<option value="${v}" ${(s.sportMap[t] || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}</table>
    </div>

    <h2 class="sec">Historia ja muut</h2>
    <div class="card">
      <div class="grid g3">
        <div><label class="f" for="hist">Treenihistoria</label><select id="hist">${[[180, "6 kuukautta"], [365, "1 vuosi"], [730, "2 vuotta"]].map(([v, l]) => `<option value="${v}" ${s.historyDays === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label class="f" for="keyExp">Garmin-avain vanhenee</label><input type="date" id="keyExp" value="${esc(s.keyExpiry)}"></div>
        <div><label class="f" for="sgUrl">Station guide -osoite</label><input type="text" id="sgUrl" value="${esc(s.stationGuideUrl)}" placeholder="https://…netlify.app"></div>
      </div>
      <div class="small muted" style="margin-top:8px">Vanhempia treenejä haetaan 3 kuukautta kerrallaan jokaisella haulla${S.raw?.actOldest ? `, nyt tallessa ${dShort(parseDay(S.raw.actOldest))}${parseDay(S.raw.actOldest).getFullYear()} alkaen` : ""}. Vanhenemispäivästä tulee muistutus Tänään-sivulle 2 viikkoa etukäteen.</div>
    </div>
    <div class="row savebar"><button class="btn" id="saveBtn">Tallenna asetukset</button><span class="small muted" id="saveMsg"></span></div>

    <h2 class="sec">Puhelin ja kirjautuminen</h2>
    <div class="card small">
      <label class="row" style="gap:10px;flex-wrap:nowrap"><input type="checkbox" id="remember" ${remembered ? "checked" : ""}> Muista kirjautuminen tällä laitteella</label>
      <ul class="findings" style="margin-top:10px">
        <li><b>Asenna kotinäytölle:</b> iPhonessa Safari → Jaa → Lisää Koti-valikkoon. Androidissa Chrome → ⋮ → Asenna sovellus. Viimeksi haetut tiedot näkyvät silloin myös ilman verkkoa.</li>
        <li><b>Kalenteri puhelimeen:</b> tilauslinkki on Kalenteri-välilehden lopussa.</li>
      </ul>
    </div>

    <h2 class="sec">Varmuuskopio</h2>
    <div class="card small">
      <div class="muted">Asetukset ja käsin lisätyt treenit yhdessä tiedostossa. Garmin-data haetaan aina uudelleen Garminista.</div>
      <div class="row" style="margin-top:10px;gap:8px">
        <button class="btn ghost sm" data-act="backup">Lataa varmuuskopio</button>
        <label class="btn ghost sm" style="cursor:pointer">Palauta varmuuskopio<input type="file" id="restoreFile" accept="application/json,.json" hidden></label>
        <button class="btn ghost sm" data-act="export-all">Lataa kaikki data (JSON)</button>
      </div>
      <p id="bkMsg" class="small" style="margin:8px 0 0"></p>
    </div>

    <h2 class="sec">Viimeisin haku Garminilta</h2>
    <div class="card small">
      ${st ? `<div class="muted">${new Date(st.time).toLocaleString("fi-FI")}${st.ms ? ` · kesto ${fmtNum(st.ms / 1000, 1)} s` : ""}</div><ul class="signals">${st.steps.map(x => x.optional && !x.ok
        ? `<li><span class="i" style="color:var(--muted)">–</span>${esc(x.name)}: <span class="muted">ei saatavilla</span></li>`
        : `<li><span class="i" style="color:var(--${x.ok ? "good" : "bad"})">${x.ok ? "✓" : "✗"}</span>${esc(x.name)}${x.ok ? "" : `: ${esc(x.error)}`}</li>`).join("")}</ul>` : "Ei vielä hakuja."}
      <p class="muted" style="margin:10px 0 0">Tiedot päivittyvät automaattisesti joka yö. ${S.acts.length} treeniä${S.excluded ? ` (+${S.excluded} pois jätettyä)` : ""} ja ${S.health.length} päivän palautumistiedot tallessa.</p>
    </div>

    <details class="card small fold" style="margin-top:28px"><summary><b>Kehittäjälle</b></summary>
      <p class="muted">Viimeisin treeni, palautumistiedot ja treenitiedostojen tila sellaisenaan Garminilta. Ei sisällä avaimia tai salasanoja.</p>
      <pre class="raw">${esc(JSON.stringify({ tiedostot: S.raw?.fitDebug || "ei vielä tarkistettu", vo2Historia: S.raw?.vo2History || {}, kuntoika: S.raw?.fitnessAge || "ei haettu", sykeviite: HR_REF, treeni: sample, palautuminen: hs }, null, 2))}</pre>
      <p class="muted" style="margin:10px 0 0">Kun Garmin-avain vanhenee, luo uusi Garmin Connectissa, vaihda se Netlifyn GARMIN_API_KEY-muuttujaan ja julkaise sivusto uudelleen.</p>
    </details>
    <div class="row between" style="margin-top:14px"><button class="btn ghost sm" id="logoutBtn">Kirjaudu ulos</button><span class="small muted">Versio ${APP_VERSION}</span></div>
  `;
  const drawEvents = () => {
    $("evList").innerHTML = events.length ? events.map((e, i) => `<div class="evrow">
      <input type="text" data-ev="${i}" data-f="name" value="${esc(e.name)}" placeholder="HYROX Helsinki" aria-label="Tapahtuman nimi">
      <input type="date" data-ev="${i}" data-f="date" value="${esc(e.date)}" aria-label="Päivämäärä">
      <select data-ev="${i}" data-f="prio" aria-label="Prioriteetti">${["A", "B", "C"].map(p => `<option ${e.prio === p ? "selected" : ""}>${p}</option>`).join("")}</select>
      <button class="mini danger" data-evdel="${i}" aria-label="Poista">✕</button></div>`).join("") : `<div class="small muted" style="margin-top:10px">Ei tapahtumia.</div>`;
  };
  drawEvents();
  $("evList").addEventListener("input", (e) => { const t = e.target.closest("[data-ev]"); if (t) events[+t.dataset.ev][t.dataset.f] = t.value; });
  $("evList").addEventListener("click", (e) => { const t = e.target.closest("[data-evdel]"); if (t) { events.splice(+t.dataset.evdel, 1); drawEvents(); } });
  $("evAdd").onclick = () => { events.push({ name: "", date: "", prio: events.some(x => x.prio === "A") ? "B" : "A" }); drawEvents(); };
  $("remember").onchange = (e) => { if (e.target.checked) ls.set("pw", UI.password); else ls.set("pw", null); };
  $("restoreFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!j.settings && !j.plan) throw new Error("Tiedosto ei ole treenisivun varmuuskopio");
      if (!confirm("Korvataanko nykyiset asetukset ja käsin lisätyt treenit varmuuskopiolla?")) return;
      if (j.settings) await api("settings", j.settings);
      if (j.plan) await api("plan", j.plan);
      prepare(await api()); refresh();
      $("bkMsg").textContent = "Varmuuskopio palautettu.";
    } catch (err) { $("bkMsg").textContent = `Palautus epäonnistui: ${err.message}`; }
  };
  $("saveBtn").onclick = async () => {
    const ev = events.filter(e => e.date).map(e => ({ name: e.name.trim() || "Tapahtuma", date: e.date, prio: e.prio || "A" }));
    const map = {};
    for (const sel of document.querySelectorAll("[data-map]")) if (sel.value) map[sel.dataset.map] = sel.value;
    const wh = parseFloat($("wHours").value);
    const url = $("sgUrl").value.trim();
    if (url && !/^https?:\/\//i.test(url)) { $("saveMsg").textContent = "Station guide -osoitteen pitää alkaa https://"; return; }
    const ns = {
      ...s, sessions: Object.fromEntries(SPORT_KEYS.map(k => [k, Math.max(0, Math.min(10, parseInt($(`n_${k}`).value) || 0))])),
      restDay: parseInt($("restDay").value), longDay: parseInt($("longDay").value), auto: $("auto").checked,
      weeklyHours: wh > 0 ? wh : null, events: ev, sportMap: map, historyDays: parseInt($("hist").value), keyExpiry: $("keyExp").value, stationGuideUrl: url,
    };
    $("saveBtn").disabled = true; $("saveMsg").textContent = "Tallennetaan…";
    try {
      await api("settings", ns);
      S.raw.settings = ns; refresh();
      $("saveMsg").textContent = "Tallennettu. Kalenteri ja analyysit päivitetty.";
    } catch (e) { $("saveMsg").textContent = e.message; $("saveBtn").disabled = false; }
  };
  $("logoutBtn").onclick = () => { UI.password = ""; ss.set("pw", null); ls.set("pw", null); boot(); };
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------- tapahtumat ----------------
document.addEventListener("click", async (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); UI.tab = g.dataset.goto; showTab(); return; }
  const b = e.target.closest("[data-act]");
  if (b) {
    e.preventDefault(); e.stopPropagation();
    const act = b.dataset.act, mid = b.dataset.mid;
    if (b.closest(".in-modal") && ["move", "hide", "skip", "edit"].includes(act)) document.querySelector(".modal-bg")?.remove();
    if (act === "add") return openForm({ date: b.dataset.date });
    if (act === "edit") return openForm({ mid });
    if (act === "move") return openMove(b.dataset.key);
    if (act === "cal-prev" || act === "cal-next" || act === "cal-today") {
      const d = act === "cal-today" ? null : act === "cal-next" ? 1 : -1;
      if (UI.calView === "week") UI.calOffset = d == null ? 0 : UI.calOffset + d;
      else UI.monthOffset = d == null ? 0 : UI.monthOffset + d;
      return renderCalendar();
    }
    if (act === "cal-view") { UI.calView = b.dataset.view; ls.set("calView", UI.calView); return renderCalendar(); }
    if (act === "goweek") {
      UI.calView = "week"; ls.set("calView", "week");
      UI.calOffset = Math.round((weekStart(parseDay(b.dataset.date)) - weekStart(S.today)) / (7 * 864e5));
      return renderCalendar();
    }
    if (act === "copy-ics") {
      const v = $("icsUrl").value;
      try { await navigator.clipboard.writeText(v); b.textContent = "Kopioitu ✓"; } catch { $("icsUrl").select(); }
      return;
    }
    if (act === "del") {
      const it = S.plan.items.find(i => i.id === mid);
      if (!it || !confirm(it.repeat === "weekly" ? "Poistetaanko koko toistuva treeni kaikilta viikoilta?" : "Poistetaanko treeni?")) return;
      if (await savePlan({ ...S.plan, items: S.plan.items.filter(i => i.id !== mid) })) document.querySelector(".modal-bg")?.remove();
      return;
    }
    if (act === "skip") return savePlan({ ...S.plan, items: S.plan.items.map(i => (i.id === mid ? { ...i, skip: [...new Set([...(i.skip || []), b.dataset.date])] } : i)) });
    if (act === "hide") return savePlan({ ...S.plan, hidden: [...new Set([...(S.plan.hidden || []), b.dataset.key])] });
    if (act === "unhide") return savePlan({ ...S.plan, hidden: [] });
    if (act === "more-sugg") { $("moreSugg").classList.toggle("hidden"); b.textContent = $("moreSugg").classList.contains("hidden") ? `Vaihda: näytä ${S.sugg.list.length - 3} muuta vaihtoehtoa` : "Piilota muut vaihtoehdot"; return; }
    if (act === "add-sugg") {
      const sg = S.sugg.list.find(x => x.id === b.dataset.sid);
      if (!sg) return;
      return savePlan({ ...S.plan, items: [...S.plan.items, { id: newId(), title: sg.title, sport: sg.sport, itype: sg.itype, tpl: sg.id,
        date: dayKey(S.today), time: "", dur: sg.dur, repeat: "none", until: "", note: sg.why[0] || "", done: false, skip: [] }] });
    }
    if (act === "log-more") { UI.log.limit += 25; return drawLog(); }
    if (act === "log-sport") { UI.log = { ...UI.log, sport: b.dataset.sport, days: "all", limit: 25 }; UI.sport = "all"; ss.set("sport", "all"); renderSports(); window.scrollTo({ top: document.getElementById("logList").offsetTop - 120 }); return; }
    if (act === "fit-backfill") {
      b.disabled = true;
      try {
        for (let i = 0; i < 25; i++) {
          const r = await api("vo2");
          b.textContent = `Haetaan… (${r.remaining} jäljellä)`;
          if ($("fitInfo")) $("fitInfo").textContent = `Tarkistettu ${r.checked} treenitiedostoa, VO2max löytyi ${r.found}:stä.`;
          if (!r.remaining) break;
        }
        prepare(await api()); refresh();
      } catch (err) { alert(`Haku epäonnistui: ${err.message}`); b.disabled = false; b.textContent = "Hae tarkemmat tiedot"; }
      return;
    }
    if (act === "backup") return download(`treenisivu-varmuuskopio-${dayKey(S.today)}.json`, { version: 1, created: new Date().toISOString(), settings: S.settings, plan: S.plan });
    if (act === "export-all") return download(`treenisivu-data-${dayKey(S.today)}.json`, S.raw);
    return;
  }
  const act = e.target.closest(".item.act");
  if (act && !e.target.closest(".detail")) {
    const det = act.querySelector(".detail");
    if (!det.innerHTML) { const a = S.acts.find(x => String(x.id) === act.dataset.aid); if (a) det.innerHTML = actDetail(a); }
    act.classList.toggle("open");
    return;
  }
  const sess = e.target.closest(".sess[data-open]");
  if (sess && sess.closest(".cal") && !sess.closest(".modal-bg")) {
    // kalenterissa sisältö avautuu omaan ikkunaansa, koska päiväsarakkeet ovat kapeita
    const { m } = modal(`<div class="modal card"><div class="row between"><h3>Treeni</h3><button type="button" class="mini" data-close aria-label="Sulje">✕</button></div><div class="sess open in-modal" style="${sess.getAttribute("style")}">${sess.innerHTML}</div></div>`);
    return;
  }
  if (sess) { sess.classList.toggle("open"); return; }
  const sg = e.target.closest(".sugg");
  if (sg && !e.target.closest(".sdetail")) { sg.classList.toggle("open"); const m = sg.querySelector(".more"); if (m) m.textContent = sg.classList.contains("open") ? "Piilota ▴" : "Näytä sisältö ▾"; }
});
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".mday[data-act]")) { e.preventDefault(); e.target.click(); }
});

// ---------------- runko ----------------
function renderHeader() {
  const st = S.raw?.status;
  const failed = st?.steps?.some(x => !x.ok && !x.optional);
  const stale = st ? Date.now() - new Date(st.time) > 26 * 3600 * 1000 : true;
  const cls = !st ? "bad" : failed ? "bad" : stale ? "warn" : "ok";
  $("syncInfo").innerHTML = st ? `<span class="dot ${cls}" title="${failed ? "Edellinen haku epäonnistui osittain, katso Asetukset" : stale ? "Tiedot ovat yli vuorokauden vanhoja" : "Tiedot ajan tasalla"}"></span>Päivitetty<br>${relTime(st.time)}` : `<span class="dot bad"></span>Ei haettu`;
}
function renderAll() {
  renderHeader();
  renderToday(); renderCalendar(); renderSettings();
  UI.drawn = {};
}
function refresh() {
  prepare(S.raw);
  renderAll();
  if (UI.tab === "sports") { renderSports(); UI.drawn.sports = true; }
  if (UI.tab === "progress") { renderProgress(); UI.drawn.progress = true; }
}
function showTab() {
  for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === UI.tab);
  for (const t of ["today", "sports", "progress", "calendar", "settings"]) $(`tab-${t}`).classList.toggle("hidden", t !== UI.tab);
  if (UI.tab === "sports" && !UI.drawn.sports) { renderSports(); UI.drawn.sports = true; }
  if (UI.tab === "progress" && !UI.drawn.progress) { renderProgress(); UI.drawn.progress = true; }
  ss.set("tab", UI.tab);
  window.scrollTo({ top: 0 });
}

$("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { UI.tab = b.dataset.tab; showTab(); } };
$("tab-sports").addEventListener("click", (e) => { const b = e.target.closest("#sportSeg button"); if (b) { UI.sport = b.dataset.sport; ss.set("sport", UI.sport); renderSports(); } });
$("tab-progress").addEventListener("click", (e) => { const b = e.target.closest("#rangeSeg button"); if (b) { UI.range = +b.dataset.range; ls.set("range", String(UI.range)); renderProgress(); } });

async function boot() {
  try {
    if (!UI.password) throw Object.assign(new Error(""), { auth: true });
    const raw = await api();
    prepare(raw);
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    renderAll(); showTab();
    if (!raw.status) $("syncBtn").click();
  } catch (e) {
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    $("loginErr").textContent = UI.password ? e.message : "";
    if (!e.auth && UI.password) console.error(e);
  }
}

$("loginBtn").onclick = () => {
  UI.password = $("pw").value;
  ss.set("pw", UI.password);
  if ($("rememberLogin").checked) ls.set("pw", UI.password);
  boot();
};
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });
$("syncBtn").onclick = async () => {
  const b = $("syncBtn"); b.disabled = true; b.textContent = "Haetaan…";
  try { await api("sync"); prepare(await api()); renderAll(); showTab(); }
  catch (e) { alert(`Haku epäonnistui: ${e.message}`); }
  finally { b.disabled = false; b.textContent = "Päivitä"; }
};
setInterval(() => { if (S.raw) renderHeader(); }, 60000);

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
boot();

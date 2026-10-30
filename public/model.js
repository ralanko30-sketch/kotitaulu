// Datan siivous ja analyysi: treenit, palautuminen, kuorma, trendit, hälytykset ja viikkosuunnitelma.

export const SPORTS = {
  run: { name: "Juoksu", color: "var(--s-run)" },
  bike: { name: "Pyöräily", color: "var(--s-bike)" },
  hyrox: { name: "HYROX", color: "var(--s-hyrox)" },
  strength: { name: "Voima & HIIT", color: "var(--s-strength)" },
  other: { name: "Muu", color: "var(--s-other)" },
};
export const SPORT_KEYS = Object.keys(SPORTS);
export const DAY_NAMES = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"];
export const DAY_NAMES_LONG = ["Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai", "Sunnuntai"];

// Treenin intensiteettityypit (järjestyksessä kevyimmästä kovimpaan)
export const ITYPES = {
  recovery: { name: "Palauttava", color: "var(--z1)", desc: "Hyvin kevyt, syke pääosin alueella 1. Edistää palautumista." },
  base: { name: "Peruskestävyys", color: "var(--z2)", desc: "Aerobinen perustreeni, syke pääosin alueella 2. Kestävyyden pohja." },
  tempo: { name: "Tempo", color: "var(--z3)", desc: "Reipas aerobinen, paljon aikaa alueella 3." },
  threshold: { name: "Kynnys", color: "var(--z4)", desc: "Maitohappokynnyksen tuntumassa, alue 4. Nostaa kestävyyden kattoa." },
  vo2: { name: "VO2max", color: "var(--z5)", desc: "Kovat intervallit alueella 5. Kehittää maksimaalista hapenottoa." },
  anaerobic: { name: "Anaerobinen", color: "var(--z6)", desc: "Lyhyet, maksimaaliset vedot. Kehittää nopeutta ja anaerobista kapasiteettia." },
  strength: { name: "Voima", color: "var(--i-strength)", desc: "Voimaharjoittelu, jossa syke ei kuvaa kuormaa." },
  unknown: { name: "Ei sykettä", color: "var(--muted)", desc: "Treenissä ei ollut sykedataa." },
};
export const ITYPE_KEYS = ["recovery", "base", "tempo", "threshold", "vo2", "anaerobic", "strength", "unknown"];
export const ZONES = [
  { name: "Alue 1", short: "Z1", desc: "Palauttava", color: "var(--z1)" },
  { name: "Alue 2", short: "Z2", desc: "Peruskestävyys", color: "var(--z2)" },
  { name: "Alue 3", short: "Z3", desc: "Tempo", color: "var(--z3)" },
  { name: "Alue 4", short: "Z4", desc: "Kynnys", color: "var(--z4)" },
  { name: "Alue 5", short: "Z5", desc: "Maksimi", color: "var(--z5)" },
];

const LABEL_MAP = [
  [/recover/i, "recovery"], [/base|aerobic_base|aerobic$/i, "base"], [/tempo/i, "tempo"],
  [/threshold|lactate/i, "threshold"], [/vo2/i, "vo2"], [/anaerob|sprint|speed|capacity/i, "anaerobic"],
];

function classify({ typeKey, zones, aeTE, anTE, dur, label }) {
  if (label) for (const [re, k] of LABEL_MAP) if (re.test(label)) return { key: k, source: "garmin" };
  const strengthType = /strength/.test(typeKey);
  if (zones) {
    const t = zones.reduce((s, v) => s + v, 0) || 1;
    const p = zones.map(v => v / t);
    if (anTE != null && anTE >= 3 && p[4] + p[3] < 0.5 && !strengthType) return { key: "anaerobic", source: "syke" };
    if (p[4] >= 0.12) return { key: "vo2", source: "syke" };
    if (p[3] + p[4] >= 0.2) return { key: "threshold", source: "syke" };
    if (p[2] + p[3] + p[4] >= 0.35) return { key: strengthType ? "strength" : "tempo", source: "syke" };
    if (strengthType) return { key: "strength", source: "laji" };
    if ((p[0] >= 0.6 && dur < 50 * 60) || (aeTE != null && aeTE < 1.5)) return { key: "recovery", source: "syke" };
    return { key: "base", source: "syke" };
  }
  if (strengthType) return { key: "strength", source: "laji" };
  if (aeTE != null) {
    if (anTE != null && anTE >= 3) return { key: "anaerobic", source: "TE" };
    if (aeTE < 1.5) return { key: "recovery", source: "TE" };
    if (aeTE < 3) return { key: "base", source: "TE" };
    if (aeTE < 3.8) return { key: "tempo", source: "TE" };
    if (aeTE < 4.5) return { key: "threshold", source: "TE" };
    return { key: "vo2", source: "TE" };
  }
  return { key: "unknown", source: "" };
}

// Garminin sykealueiden rajat (bpm) mistä tahansa vastausmuodosta
export function parseHrZones(raw) {
  if (!raw) return null;
  const list = [];
  (function walk(o, d) {
    if (!o || typeof o !== "object" || d > 4) return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, d + 1)); return; }
    if (typeof o.zone1Floor === "number") list.push(o);
    else Object.values(o).forEach(v => walk(v, d + 1));
  })(raw, 0);
  if (!list.length) return null;
  const pick = list.find(z => /default|generic/i.test(z.sport || "")) || list[0];
  const floors = [1, 2, 3, 4, 5].map(i => pick[`zone${i}Floor`]);
  const max = pick.maxHeartRateUsed || pick.maxHeartRate || null;
  return floors.map((f, i) => ({ lo: f, hi: i < 4 ? floors[i + 1] - 1 : max }));
}

// ---------- päivämäärät ----------
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseDay = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const weekStart = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const weekdayIdx = (d) => (d.getDay() + 6) % 7; // ma = 0

// ---------- muotoilu ----------
export const fmtDur = (s) => {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
};
export const fmtH = (s) => `${((s || 0) / 3600).toFixed(1).replace(".", ",")} h`;
export const fmtKm = (m) => `${((m || 0) / 1000).toFixed(1).replace(".", ",")} km`;
export const fmtNum = (v, d = 0) => (v == null || !isFinite(v) ? "–" : v.toFixed(d).replace(".", ","));
export const fmtPace = (mps) => {
  if (!mps) return "–";
  const s = 1000 / mps;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")} /km`;
};
export const fmtPct = (p) => `${p > 0 ? "+" : ""}${(p * 100).toFixed(0)} %`;

// ---------- apurit ----------
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
function deepNum(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;
  for (const k of keys) if (num(obj[k]) != null) return obj[k];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const r = deepNum(v, keys, depth + 1);
      if (r != null) return r;
    }
  }
  return null;
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const sum = (a) => a.reduce((s, v) => s + (v || 0), 0);

// ---------- treenit ----------
// Käyttäjän lajimuunnokset (Garminin typeKey -> laji tai "exclude") ja sykeviitteet, asetetaan core.js:ssä
let SPORT_MAP = {};
export function setSportMap(m) { SPORT_MAP = m || {}; }
export const HR_REF = { run: 140, bike: 130, rest: 50 };

export function sportOf(typeKey = "", name = "") {
  if (SPORT_MAP[typeKey]) return SPORT_MAP[typeKey];
  const t = typeKey.toLowerCase();
  if (/hyrox/i.test(name) || /hyrox/.test(t)) return "hyrox";
  if (/run/.test(t)) return "run";
  if (/cycl|bik|ride|spin/.test(t)) return "bike";
  if (/strength|hiit|cardio|crossfit|fitness_equipment|boxing|bootcamp|hyrox/.test(t)) return "strength";
  return "other";
}

// Juoksun dynamiikka treenilistasta (tai treenitiedostosta varalla). Yksiköt: spm, m, cm, ms, %, % vasen.
function runDyn(a) {
  const pick = (re) => { for (const [k, v] of Object.entries(a)) if (re.test(k) && typeof v === "number" && v > 0) return v; return null; };
  const f = a._fit?.dyn || {};
  let stride = pick(/^avgStrideLength$/i) ?? f.stride;
  if (stride != null) stride = stride > 300 ? stride / 1000 : stride > 3 ? stride / 100 : stride;
  let vo = pick(/^avgVerticalOscillation$/i) ?? f.vo;
  if (vo != null && vo > 30) vo = vo / 10;
  const d = {
    cad: pick(/^averageRunningCadenceInStepsPerMinute$|^avgRunCadence$/i) ?? f.cad,
    cadMax: pick(/^maxRunningCadenceInStepsPerMinute$|^maxRunCadence$/i),
    stride, vo,
    gct: pick(/^avgGroundContactTime$/i) ?? f.gct,
    vr: pick(/^avgVerticalRatio$/i) ?? f.vr,
    bal: pick(/groundContactBalance/i) ?? f.bal,
  };
  return Object.values(d).some(v => v != null) ? d : null;
}

export function normActivity(a) {
  const typeKey = a.activityType?.typeKey || "other";
  const startStr = (a.startTimeLocal || a.startTimeGMT || "").replace(" ", "T");
  const date = new Date(startStr);
  const dur = num(a.duration) || num(a.movingDuration) || 0;
  const zones = [1, 2, 3, 4, 5].map(i => num(a[`hrTimeInZone_${i}`]));
  const hasZones = zones.some(z => z != null && z > 0);
  const z = zones.map(v => v || 0);
  let load = num(a.activityTrainingLoad);
  if (load == null) {
    load = hasZones ? (z[0] * 1 + z[1] * 2 + z[2] * 3 + z[3] * 4 + z[4] * 5) / 60 * 0.8 : (dur / 60) * 1.5;
  }
  const label = a.trainingEffectLabel || a.trainingEffectLabelDTO?.label || null;
  const aeTE = num(a.aerobicTrainingEffect), anTE = num(a.anaerobicTrainingEffect);
  const cls = classify({ typeKey, zones: hasZones ? z : null, aeTE, anTE, dur, label });
  return {
    itype: cls.key,
    itypeSource: cls.source,
    teLabel: label,
    id: a.activityId,
    name: a.activityName || "",
    typeKey,
    sport: sportOf(typeKey, a.activityName || ""),
    date,
    day: dayKey(date),
    dur,
    dist: num(a.distance) || 0,
    avgHR: num(a.averageHR),
    maxHR: num(a.maxHR),
    speed: num(a.averageSpeed),
    power: num(a.avgPower) ?? num(a.averagePower) ?? num(a.normPower),
    load,
    aeTE,
    anTE,
    zones: hasZones ? z : null,
    sets: num(a.activeSets) ?? num(a.totalSets),
    reps: num(a.totalReps),
    cal: num(a.calories),
    elev: num(a.elevationGain),
    vo2: num(a.vO2MaxValue) ?? num(a.vO2MaxPreciseValue) ?? num(a.vo2MaxValue) ?? num(a.vo2Max) ?? null,
    laps: a._fit?.laps || null,
    best: a._fit?.best || null,
    dyn: /run/.test(typeKey) ? runDyn(a) : null,
    lapCount: num(a.lapCount),
  };
}

// ---------- palautuminen ----------
// Etsii numeron avaimella, joka täsmää regexiin (ohittaa keskiarvo-/historia-avaimet).
function deepMatch(obj, re, depth = 0, skip = /avg|average|seven|week|month|trend|baseline/i) {
  if (!obj || typeof obj !== "object" || depth > 5) return null;
  if (Array.isArray(obj)) return null;
  for (const [k, v] of Object.entries(obj)) if (re.test(k) && !skip.test(k) && num(v) != null) return v;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = deepMatch(v, re, depth + 1, skip);
      if (r != null) return r;
    }
  }
  return null;
}
// Body Battery -käyrä: [[aika, taso], ...] tai [[aika, "MEASURED", taso, ...], ...]
function bbLevels(obj) {
  let arr = null;
  (function find(o, d) {
    if (arr || !o || typeof o !== "object" || d > 4) return;
    for (const [k, v] of Object.entries(o)) {
      if (/bodybattery.*(values|array)|valuesarray/i.test(k) && Array.isArray(v)) { arr = v; return; }
      if (v && typeof v === "object") find(v, d + 1);
    }
  })(obj, 0);
  if (!arr) return null;
  const pts = arr.map(e => {
    if (!Array.isArray(e)) return null;
    const ts = e[0];
    const lvl = typeof e[1] === "number" ? e[1] : typeof e[2] === "number" ? e[2] : null;
    return lvl != null && lvl >= 0 && lvl <= 100 ? { ts, lvl } : null;
  }).filter(Boolean);
  return pts.length ? pts : null;
}

// Etsii leposykkeen mistä tahansa rakenteesta: restingHeartRate, restingHR, heartRate.restingValue, rhr.value jne.
export function findRestingHR(obj, depth = 0, parentHeart = false) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 5) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/avg|average|seven|week|month|trend|baseline|min|max/i.test(k)) continue;
    const kl = k.toLowerCase();
    const isRest = /resting|^rhr$/.test(kl) && (/heart|hr|rhr/.test(kl) || parentHeart || /^resting(value)?$/.test(kl));
    if (isRest) {
      if (num(v) != null && v >= 25 && v <= 130) return v;
      if (v && typeof v === "object" && num(v.value) != null && v.value >= 25 && v.value <= 130) return v.value;
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !/avg|average|seven|week|month/i.test(k)) {
      const r = findRestingHR(v, depth + 1, parentHeart || /heart|^hr$|rhr/i.test(k));
      if (r != null) return r;
    }
  }
  return null;
}

export function normHealth(hbd = {}, fitnessAge = null) {
  const days = {};
  const get = (k) => (days[k] = days[k] || { day: k });
  for (const [k, o] of Object.entries(hbd.hrv || {})) {
    const d = get(k);
    d.hrv = num(o.lastNightAvg) ?? deepNum(o, ["lastNightAvg"]);
    d.hrvWeek = num(o.weeklyAvg) ?? deepNum(o, ["weeklyAvg"]);
    d.hrvStatus = o.status || o.hrvSummary?.status || null;
    d.hrvLo = deepNum(o, ["balancedLow"]);
    d.hrvHi = deepNum(o, ["balancedUpper"]);
  }
  for (const [k, o] of Object.entries(hbd.sleep || {})) {
    const d = get(k);
    d.sleepSec = deepNum(o, ["sleepTimeSeconds", "totalSleepTimeInSeconds", "totalSleepSeconds", "sleepTimeInSeconds"]);
    d.sleepScore = num(o.sleepScores?.overall?.value) ?? num(o.dailySleepDTO?.sleepScores?.overall?.value)
      ?? deepNum(o, ["overallSleepScore", "sleepScore", "overallScore"]);
    const r = deepNum(o, ["restingHeartRate"]) ?? deepMatch(o, /resting.*(heart|hr)|^rhr$/i);
    if (r != null) d.rhrSleep = r;
    d.deepSec = deepNum(o, ["deepSleepSeconds"]); d.lightSec = deepNum(o, ["lightSleepSeconds"]);
    d.remSec = deepNum(o, ["remSleepSeconds"]); d.awakeSec = deepNum(o, ["awakeSleepSeconds"]);
    const bc = deepMatch(o, /bodybattery.*change|bodybatterychange/i, 0, /avg|seven/i);
    if (bc != null) d.bbChange = bc;
  }
  for (const [k, o] of Object.entries(hbd.daily || {})) {
    const d = get(k);
    d.rhr = deepNum(o, ["restingHeartRate", "restingHeartRateValue", "wellnessRestingHeartRate", "restingHr"])
      ?? deepMatch(o, /resting.*(heart|hr)|^rhr$/i);
    d.stress = deepNum(o, ["averageStressLevel", "avgStressLevel"]) ?? num(o.stress?.avgLevel);
    if (o.bodyBattery && typeof o.bodyBattery === "object") {
      d.bbHighD = num(o.bodyBattery.maxValue); d.bbNowD = num(o.bodyBattery.latestValue);
    }
    d.bbHigh = deepNum(o, ["bodyBatteryHighestValue", "highestBodyBattery", "bodyBatteryHighValue"]) ?? deepMatch(o, /bodybattery.*(highest|high|max)/i, 0, /avg|seven/i);
    d.bbWake = deepNum(o, ["bodyBatteryAtWakeTime", "bodyBatteryWakeValue"]) ?? deepMatch(o, /bodybattery.*wake/i, 0, /avg|seven/i);
    d.bbNow = deepNum(o, ["bodyBatteryMostRecentValue", "mostRecentBodyBattery"]) ?? deepMatch(o, /bodybattery.*(recent|current|latest)/i, 0, /avg|seven/i);
    d.bbCharged = deepNum(o, ["bodyBatteryChargedValue", "charged"]);
    d.steps = deepNum(o, ["totalSteps", "steps"]);
  }
  for (const [k, o] of Object.entries(hbd.bb || {})) {
    const d = get(k);
    const lv = bbLevels(o);
    if (lv) {
      const levels = lv.map(p => p.lvl);
      d.bbHigh = d.bbHigh ?? Math.max(...levels);
      // aamun arvo: korkein taso ennen klo 11 paikallista aikaa, muuten päivän korkein
      const morning = lv.filter(p => typeof p.ts === "number" && new Date(p.ts).getHours() < 11).map(p => p.lvl);
      d.bbWake = d.bbWake ?? (morning.length ? Math.max(...morning) : Math.max(...levels));
      d.bbNow = d.bbNow ?? levels[levels.length - 1];
    }
    d.bbCharged = d.bbCharged ?? deepNum(o, ["charged"]);
  }
  for (const [k, o] of Object.entries(hbd.hr || {})) {
    const r = findRestingHR(o);
    if (r != null) get(k).rhrHr = r;
  }
  for (const [k, o] of Object.entries(hbd.daily || {})) {
    if (days[k] && days[k].rhr == null) days[k].rhr = findRestingHR(o);
  }
  for (const [k, o] of Object.entries(hbd.sleep || {})) {
    if (days[k] && days[k].rhrSleep == null) { const r = findRestingHR(o); if (r != null) days[k].rhrSleep = r; }
  }
  if (fitnessAge?.fetched) {
    const r = findRestingHR(fitnessAge);
    if (r != null) get(fitnessAge.fetched).rhrFa = r;
  }
  for (const d of Object.values(days)) {
    d.rhr = d.rhr ?? d.rhrHr ?? d.rhrSleep ?? d.rhrFa ?? null;
    d.bbHigh = d.bbHigh ?? d.bbHighD ?? null;
    d.bbNow = d.bbNow ?? d.bbNowD ?? null;
    const tot = (d.deepSec || 0) + (d.lightSec || 0) + (d.remSec || 0);
    if (tot > 0) { d.deepPct = d.deepSec / tot; d.remPct = d.remSec / tot; d.lightPct = d.lightSec / tot; }
  }
  return Object.values(days).sort((a, b) => (a.day < b.day ? -1 : 1));
}

function series(health, field, fromKey, toKey) {
  return health.filter(d => d.day >= fromKey && d.day <= toKey && num(d[field]) != null).map(d => d[field]);
}

// ---------- harjoitusvalmius 0–100 ----------
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const READY_WEIGHTS = { hrv: 0.25, sleep: 0.22, bb: 0.15, rhr: 0.1, load: 0.28 };

export function readinessScore(health, acts, day = new Date()) {
  const tk = dayKey(day), yk = dayKey(addDays(day, -1));
  const byDay = Object.fromEntries(health.map(d => [d.day, d]));
  // Viime yön tiedot kirjautuvat yleensä tälle päivälle; jos ei vielä ole, käytetään eilistä.
  const pick = (f) => (byDay[tk]?.[f] != null ? byDay[tk][f] : byDay[yk]?.[f] ?? null);
  const from30 = dayKey(addDays(day, -30));
  const parts = {};

  // HRV
  const hrv = pick("hrv");
  if (hrv != null) {
    const ref = byDay[tk]?.hrvLo != null ? byDay[tk] : byDay[yk];
    const lo = ref?.hrvLo, hi = ref?.hrvHi;
    const avg = mean(series(health, "hrv", from30, yk));
    let sc;
    if (lo != null && hi != null && hi > lo) {
      if (hrv < lo) sc = clamp(45 - ((lo - hrv) / lo) * 300, 5, 45);
      else if (hrv > hi) sc = 90;
      else sc = 55 + ((hrv - lo) / (hi - lo)) * 40;
    } else if (avg) sc = clamp(70 + ((hrv - avg) / avg) * 250, 5, 95);
    if (sc != null) parts.hrv = { score: sc, label: "HRV", text: `${hrv} ms${lo != null ? ` (normaali ${lo}–${hi})` : avg ? ` (keskiarvo ${fmtNum(avg)})` : ""}` };
  }

  // Uni: viime yö 70 %, kolmen yön keskiarvo 30 %
  const nightScore = (d) => {
    if (!d) return null;
    if (d.sleepScore != null) return d.sleepScore;
    if (d.sleepSec != null) return clamp(((d.sleepSec / 3600) - 5) / 3 * 100);
    return null;
  };
  const last = nightScore(byDay[tk]?.sleepSec != null || byDay[tk]?.sleepScore != null ? byDay[tk] : byDay[yk]);
  if (last != null) {
    const three = [0, 1, 2].map(i => nightScore(byDay[dayKey(addDays(day, -i))])).filter(v => v != null);
    const sc = last * 0.7 + mean(three) * 0.3;
    const sd = byDay[tk]?.sleepSec != null ? byDay[tk] : byDay[yk];
    parts.sleep = { score: sc, label: "Uni", text: `${sd?.sleepSec != null ? fmtNum(sd.sleepSec / 3600, 1) + " h" : ""}${sd?.sleepScore != null ? `, pisteet ${sd.sleepScore}` : ""}` };
  }

  // Body Battery herätessä
  const bb = byDay[tk]?.bbWake ?? byDay[tk]?.bbHigh ?? null;
  if (bb != null) parts.bb = { score: clamp(bb), label: "Body Battery", text: `${bb} herätessä` };

  // Leposyke vs. 30 pv keskiarvo
  const rhr = pick("rhr");
  if (rhr != null) {
    const avg = mean(series(health, "rhr", from30, yk));
    if (avg) {
      const diff = rhr - avg;
      parts.rhr = { score: clamp(75 - diff * 12, 5, 98), label: "Leposyke", text: `${rhr} (keskiarvo ${fmtNum(avg)})` };
    }
  }

  // Treenikuorma: kahden edellisen päivän kuorma ja 7 pv / 28 pv -suhde
  if (acts?.length) {
    const t0 = startOfDay(day);
    const loadIn = (a, b) => sum(acts.filter(x => x.date >= a && x.date < b).map(x => x.load));
    const daily28 = loadIn(addDays(t0, -28), t0) / 28;
    if (daily28 > 0) {
      const r48 = loadIn(addDays(t0, -2), t0) / (daily28 * 2);
      const acwr = loadIn(addDays(t0, -7), t0) / (daily28 * 7);
      const sc = clamp(100 - Math.max(0, r48 - 0.6) * 40 - Math.max(0, acwr - 1.15) * 90, 5, 100);
      const yLoad = loadIn(addDays(t0, -1), t0);
      parts.load = { score: sc, label: "Treenikuorma", text: yLoad > 0 ? `eilen ${fmtNum(yLoad)}, 2 pv ${fmtNum(r48 * 100)} % normaalista` : "eilen lepo" };
    }
  }

  const keys = Object.keys(parts);
  if (!keys.length) return null;
  const wsum = sum(keys.map(k => READY_WEIGHTS[k]));
  const score = Math.round(sum(keys.map(k => parts[k].score * READY_WEIGHTS[k])) / wsum);
  return { score, parts, missing: Object.keys(READY_WEIGHTS).filter(k => !parts[k]) };
}

export function readiness(health, acts, load, today = new Date()) {
  const r = readinessScore(health, acts, today);
  const hist = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(startOfDay(today), -i);
    const x = readinessScore(health, acts, d);
    if (x) hist.push({ x: d, y: x.score });
  }
  const tk = dayKey(today);
  const latest = { ...([...health].reverse().find(d => d.day < tk) || {}), ...(health.find(d => d.day === tk) || {}) };
  if (!r) return { level: "normal", score: null, title: "Ei palautumisdataa", text: "Palautumistietoja ei löytynyt vielä. Ne täydentyvät seuraavissa hauissa.", signals: [], parts: {}, hist, latest };
  const s = r.score;
  let level, title, text;
  if (s >= 75) { level = "go"; title = "Korkea valmius"; text = "Hyvä päivä kovalle tai pitkälle treenille."; }
  else if (s >= 50) { level = "normal"; title = "Kohtalainen valmius"; text = "Treenaa suunnitelman mukaan, kova treeni onnistuu jos tuntuu hyvältä."; }
  else if (s >= 30) { level = "easy"; title = "Matala valmius"; text = "Valitse kevyt treeni. Kova treeni kannattaa siirtää."; }
  else { level = "easy"; title = "Hyvin matala valmius"; text = "Keho kaipaa lepoa. Lepopäivä tai kevyt kävely."; }
  const signals = Object.values(r.parts).map(p => [p.score >= 70 ? "good" : p.score < 45 ? "bad" : "neutral", `${p.label}: ${p.text}`]);
  if (load?.ratio > 1.3) signals.push(["warn", `Viikon kuorma on korkea (suhde ${fmtNum(load.ratio, 2)})`]);
  return { level, score: s, title, text, signals, parts: r.parts, missing: r.missing, hist, latest };
}

// ---------- kuorma ----------
export function loadStatus(acts, today = new Date()) {
  const t = startOfDay(addDays(today, 1));
  const in7 = acts.filter(a => a.date >= addDays(t, -7) && a.date < t);
  const in28 = acts.filter(a => a.date >= addDays(t, -28) && a.date < t);
  const acute = sum(in7.map(a => a.load));
  const chronic = sum(in28.map(a => a.load)) / 4;
  const ratio = chronic > 0 ? acute / chronic : null;
  let zone = "–";
  if (ratio != null) zone = ratio < 0.8 ? "low" : ratio <= 1.3 ? "ok" : ratio <= 1.5 ? "high" : "risk";
  return { acute, chronic, ratio, zone };
}

export function weekly(acts, weeks = 12, today = new Date()) {
  const ws = weekStart(today);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(ws, -7 * i), end = addDays(start, 7);
    const w = { start, sports: {}, load: 0, dur: 0, easy: 0, mod: 0, hard: 0, z: [0, 0, 0, 0, 0], types: {} };
    for (const k of SPORT_KEYS) w.sports[k] = { dur: 0, dist: 0, n: 0, load: 0 };
    for (const a of acts) {
      if (a.date < start || a.date >= end) continue;
      const s = w.sports[a.sport];
      s.dur += a.dur; s.dist += a.dist; s.n++; s.load += a.load;
      w.load += a.load; w.dur += a.dur;
      if (a.zones) { w.easy += a.zones[0] + a.zones[1]; w.mod += a.zones[2]; w.hard += a.zones[3] + a.zones[4]; a.zones.forEach((v, i) => (w.z[i] += v)); }
      const ty = (w.types[a.itype] = w.types[a.itype] || { n: 0, dur: 0 });
      ty.n++; ty.dur += a.dur;
    }
    out.push(w);
  }
  return out;
}

// ---------- tehokkuus: vauhti tai teho vakiosykkeellä ----------
// Skaalataan treenin vauhti viitesykkeeseen sykereservin suhteessa: v_ref = v × (ref − lepo) / (keskisyke − lepo).
export function hrNorm(a) {
  if (!a.avgHR || a.avgHR <= HR_REF.rest + 10) return null;
  const ref = a.sport === "bike" ? HR_REF.bike : HR_REF.run;
  const k = (ref - HR_REF.rest) / (a.avgHR - HR_REF.rest);
  if (a.sport === "run" && a.speed && a.dist >= 2000) return { y: a.speed * k, unit: "pace" };
  if (a.sport === "bike" && a.power) return { y: a.power * k, unit: "W" };
  if (a.sport === "bike" && a.speed) return { y: a.speed * 3.6 * k, unit: "km/h" };
  return null;
}
export const fmtNorm = (v, unit) => unit === "pace" ? fmtPace(v) : unit === "W" ? `${Math.round(v)} W` : `${fmtNum(v, 1)} km/h`;

export function hrReference(acts, health, today = new Date()) {
  const from = addDays(today, -90);
  const med = (arr) => { const b = arr.filter(x => x != null).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
  const r5 = (v) => Math.round(v / 5) * 5;
  const easy = (sp) => med(acts.filter(a => a.sport === sp && a.date >= from && a.avgHR && (a.itype === "base" || a.itype === "recovery")).map(a => a.avgHR));
  const rest = med(health.filter(d => d.day >= dayKey(addDays(today, -30))).map(d => d.rhr));
  return { run: easy("run") ? r5(easy("run")) : 140, bike: easy("bike") ? r5(easy("bike")) : 130, rest: rest || 50 };
}

export function efficiencySeries(acts, sport) {
  return acts
    .filter(a => a.sport === sport && a.avgHR && a.dur >= 15 * 60)
    .map(a => { const n = hrNorm(a); return n ? { x: a.date, y: n.y, unit: n.unit, a } : null; })
    .filter(Boolean)
    .sort((p, q) => p.x - q.x);
}

export function rolling(points, days = 21) {
  return points.map(p => {
    const win = points.filter(q => q.x <= p.x && q.x > addDays(p.x, -days));
    return { x: p.x, y: mean(win.map(q => q.y)) };
  });
}

// ---------- trendit ----------
// Vertaa viimeisen 4 viikon keskiarvoa sitä edeltävään 8 viikkoon.
function compare(points, { higherBetter = true, threshold = 0.03, minN = 3, today = new Date(), recentDays = 28, baseDays = 56 }) {
  const t = addDays(startOfDay(today), 1);
  const r0 = addDays(t, -recentDays), b0 = addDays(r0, -baseDays);
  const recent = points.filter(p => p.x >= r0 && p.x < t).map(p => p.y);
  const base = points.filter(p => p.x >= b0 && p.x < r0).map(p => p.y);
  if (recent.length < minN || base.length < minN) return { state: "unknown", recent: mean(recent), base: mean(base), n: recent.length };
  const r = mean(recent), b = mean(base);
  const change = b ? (r - b) / Math.abs(b) : 0;
  const better = higherBetter ? change > threshold : change < -threshold;
  const worse = higherBetter ? change < -threshold : change > threshold;
  return { state: better ? "up" : worse ? "down" : "flat", recent: r, base: b, change };
}

export function trends(acts, health, today = new Date(), vo2Hist = {}) {
  const hp = (f) => health.filter(d => num(d[f]) != null).map(d => ({ x: parseDay(d.day), y: d[f] }));
  const wk = weekly(acts, 12, today);
  const weekPts = (fn) => wk.slice(0, -1).map(w => ({ x: w.start, y: fn(w) })); // keskeneräinen viikko pois
  const out = [];

  const runEff = efficiencySeries(acts, "run");
  out.push({ key: "runEff", sport: "run", group: "kunto", name: `Juoksuvauhti sykkeellä ${HR_REF.run}`, unit: "", desc: `Vauhti, jonka juokset sykkeellä ${HR_REF.run}. Nopeutuminen = kunto paranee.`, points: runEff, fmt: (v) => fmtPace(v), ...compare(runEff, { today }) });

  const bikeEff = efficiencySeries(acts, "bike");
  const bikeUnit = bikeEff[bikeEff.length - 1]?.unit || "km/h";
  const bikePts = bikeEff.filter(p => p.unit === bikeUnit);
  out.push({ key: "bikeEff", sport: "bike", group: "kunto", name: `Pyöräily sykkeellä ${HR_REF.bike}`, unit: "", desc: bikeUnit === "W" ? `Teho, jonka tuotat sykkeellä ${HR_REF.bike}.` : `Nopeus sykkeellä ${HR_REF.bike}. Maasto ja tuuli vaikuttavat.`, points: bikePts, fmt: (v) => fmtNorm(v, bikeUnit), ...compare(bikePts, { today, threshold: 0.04 }) });

  for (const k of ["run", "bike", "hyrox", "strength"]) {
    const pts = weekPts(w => w.sports[k].dur / 3600);
    const used = pts.some(p => p.y > 0);
    if (!used) continue;
    out.push({ key: `vol_${k}`, sport: k, group: "kuormitus", name: `${SPORTS[k].name}: viikkomäärä`, unit: "h/vko", desc: "Treenitunteja viikossa.", points: pts, fmt: (v) => fmtNum(v, 1), ...compare(pts, { today, threshold: 0.25, minN: 3, recentDays: 28, baseDays: 56 }) });
  }

  const hrv = hp("hrv");
  out.push({ key: "hrv", group: "palautuminen", name: "HRV (yö)", unit: "ms", desc: "Sykevälivaihtelu. Lasku voi kertoa väsymyksestä tai sairastumisesta.", points: hrv, fmt: (v) => fmtNum(v), ...compare(hrv, { today, recentDays: 7, baseDays: 30, threshold: 0.05 }) });
  const rhr = hp("rhr");
  out.push({ key: "rhr", group: "palautuminen", name: "Leposyke", unit: "bpm", desc: "Nouseva leposyke voi kertoa kuormituksesta.", points: rhr, fmt: (v) => fmtNum(v), ...compare(rhr, { today, higherBetter: false, recentDays: 7, baseDays: 30, threshold: 0.04 }) });
  {
    const vs = (sp) => {
      const byDay = {};
      for (const a of acts) if (a.sport === sp && a.vo2) byDay[a.day] = { x: a.date, y: a.vo2 };
      for (const [d, v] of Object.entries(vo2Hist || {})) { const y = v?.[sp]; if (y && !byDay[d]) byDay[d] = { x: parseDay(d), y }; }
      return Object.values(byDay).sort((p, q) => p.x - q.x);
    };
    const run = vs("run"), bike = vs("bike");
    const pts = run.length >= bike.length ? run : bike;
    const sp = run.length >= bike.length ? "run" : "bike";
    if (pts.length) out.push({ key: "vo2", sport: sp, group: "kunto", name: `VO2max (${SPORTS[sp].name.toLowerCase()})`, unit: "ml/kg/min", desc: "Garminin arvio maksimaalisesta hapenottokyvystä. Kestävyyskunnon tärkein yksittäinen mittari.", points: pts, fmt: (v) => fmtNum(v, 0), ...compare(pts, { today, threshold: 0.015, minN: 2 }) });
  }

  const sl = health.filter(d => d.sleepSec != null).map(d => ({ x: parseDay(d.day), y: d.sleepSec / 3600 }));
  out.push({ key: "sleep", group: "palautuminen", name: "Uni", unit: "h", desc: "Unen määrä öisin.", points: sl, fmt: (v) => fmtNum(v, 1), ...compare(sl, { today, recentDays: 7, baseDays: 30, threshold: 0.06 }) });
  const bbp = hp("bbWake");
  if (bbp.length) out.push({ key: "bb", group: "palautuminen", name: "Body Battery herätessä", unit: "", desc: "Kuinka hyvin keho latautui yön aikana.", points: bbp, fmt: (v) => fmtNum(v), ...compare(bbp, { today, recentDays: 7, baseDays: 30, threshold: 0.08 }) });
  const stp = hp("stress");
  if (stp.length) out.push({ key: "stress", group: "palautuminen", name: "Stressitaso", unit: "", desc: "Päivän keskimääräinen stressi (0–100). Nousu voi heikentää palautumista.", points: stp, fmt: (v) => fmtNum(v), ...compare(stp, { today, higherBetter: false, recentDays: 7, baseDays: 30, threshold: 0.1 }) });
  const dp = health.filter(d => d.deepPct != null).map(d => ({ x: parseDay(d.day), y: d.deepPct * 100 }));
  if (dp.length) out.push({ key: "deep", group: "palautuminen", name: "Syvän unen osuus", unit: "%", desc: "Tavoitealue noin 16–33 %. Syvä uni palauttaa kehoa.", points: dp, fmt: (v) => fmtNum(v), ...compare(dp, { today, recentDays: 7, baseDays: 30, threshold: 0.1 }) });

  return out;
}

export function intensityShare(acts, days = 28, today = new Date()) {
  const from = addDays(startOfDay(today), -days + 1);
  let e = 0, m = 0, h = 0;
  for (const a of acts) if (a.date >= from && a.zones) { e += a.zones[0] + a.zones[1]; m += a.zones[2]; h += a.zones[3] + a.zones[4]; }
  const tot = e + m + h;
  return tot ? { easy: e / tot, mod: m / tot, hard: h / tot, total: tot } : null;
}

// ---------- hälytykset ja ehdotukset ----------
export function alerts(trendList, load, share, ready) {
  const out = [];
  const t = Object.fromEntries(trendList.map(x => [x.key, x]));
  const volDown = (k) => t[`vol_${k}`]?.state === "down";

  if (t.runEff?.state === "down") {
    out.push({ level: "bad", sport: "run", focus: { sport: "run", add: "easy" }, title: `Juoksuvauhti sykkeellä ${HR_REF.run} hidastunut (${fmtPace(t.runEff.base)} → ${fmtPace(t.runEff.recent)})`,
      text: "Juokset hitaammin samalla sykkeellä kuin aiemmin.",
      suggestion: volDown("run") ? "Juoksumäärä on myös laskenut. <b>Lisää yksi rauhallinen peruskestävyyslenkki viikkoon.</b>" : "<b>Lisää rauhallista peruskestävyyttä</b> ja varmista palautuminen kovien treenien välissä." });
  } else if (t.runEff?.state === "up") {
    out.push({ level: "good", sport: "run", title: `Juoksuvauhti sykkeellä ${HR_REF.run} nopeutunut (${fmtPace(t.runEff.base)} → ${fmtPace(t.runEff.recent)})`, text: "Juokset nopeammin samalla sykkeellä. Nykyinen linja toimii." });
  }
  if (t.vo2?.state === "down") {
    out.push({ level: "warn", sport: t.vo2.sport, focus: { sport: t.vo2.sport, add: "hard" }, title: `VO2max laskenut (${fmtNum(t.vo2.base, 0)} → ${fmtNum(t.vo2.recent, 0)})`,
      text: "Maksimaalinen hapenottokyky on heikentynyt edellisiin viikkoihin verrattuna.",
      suggestion: "<b>Lisää yksi VO2max-intervallitreeni viikkoon</b> (esim. 5 × 3 min alueella 5) ja pidä peruskestävyys mukana." });
  } else if (t.vo2?.state === "up") {
    out.push({ level: "good", sport: t.vo2.sport, title: `VO2max noussut (${fmtNum(t.vo2.base, 0)} → ${fmtNum(t.vo2.recent, 0)})`, text: "Kestävyyskuntosi kehittyy." });
  }
  if (t.bikeEff?.state === "down") {
    out.push({ level: "warn", sport: "bike", focus: { sport: "bike", add: "easy" }, title: `Pyöräily sykkeellä ${HR_REF.bike} heikentynyt ${fmtPct(t.bikeEff.change)}`, text: "Sama syke tuottaa vähemmän vauhtia tai tehoa.", suggestion: "<b>Lisää yksi pitkä, rauhallinen lenkki</b> tai tarkista, onko maasto tai sää vaikuttanut." });
  }
  for (const k of ["run", "bike", "hyrox", "strength"]) {
    if (volDown(k)) {
      const tr = t[`vol_${k}`];
      out.push({ level: "warn", sport: k, focus: { sport: k, add: "easy" }, title: `${SPORTS[k].name}: määrä laskenut ${fmtPct(tr.change)}`,
        text: `Viimeiset 4 viikkoa keskimäärin ${fmtNum(tr.recent, 1)} h/vko, aiemmin ${fmtNum(tr.base, 1)} h/vko.`,
        suggestion: `Jos tämä ei ole tarkoituksellista, <b>lisää yksi treeni viikkoon (${SPORTS[k].name}).</b> Kalenteri tekee tämän automaattisesti.` });
    }
  }
  if (t.hrv?.state === "down" && t.rhr?.state === "down") {
    out.push({ level: "bad", title: "HRV laskee ja leposyke nousee", text: "Molemmat viittaavat kertyneeseen väsymykseen tai alkavaan sairastumiseen.", suggestion: "<b>Pidä 2–3 kevyttä päivää</b> ennen seuraavaa kovaa treeniä.", deload: true });
  } else if (t.hrv?.state === "down") {
    out.push({ level: "warn", title: `HRV laskenut ${fmtPct(t.hrv.change)}`, text: "Viikon keskiarvo on alle kuukauden tason.", suggestion: "Seuraa tilannetta. Jos lasku jatkuu, <b>kevennä viikkoa.</b>" });
  }
  if (load?.ratio > 1.5) {
    out.push({ level: "bad", title: "Kuorma noussut liian nopeasti", text: `Viikon kuorma on ${fmtNum(load.ratio, 1)}× tavanomaiseen nähden.`, suggestion: "<b>Kevennä tätä viikkoa</b> ja muuta yksi kova treeni kevyeksi.", deload: true });
  } else if (load?.ratio != null && load.ratio < 0.7) {
    out.push({ level: "warn", title: "Kuorma selvästi tavallista pienempi", text: "Kuntotaso voi alkaa laskea, jos tilanne jatkuu.", suggestion: "Jos olet palautunut, <b>nosta määrää maltillisesti</b> (noin 10 % viikossa)." });
  }
  if (share && share.total > 3 * 3600) {
    if (t.deep?.state === "down" || (t.deep?.recent != null && t.deep.recent < 13)) out.push({ level: "warn", title: `Syvää unta vähän (${fmtNum(t.deep.recent)} %)`, text: "Syvän unen osuus on alle tavoitealueen (16–33 %).", suggestion: "Säännöllinen nukkumaanmenoaika, viileä makuuhuone ja <b>ei kovia treenejä tai alkoholia myöhään illalla</b> auttavat." });
    if (share.easy < 0.65) out.push({ level: "warn", title: `Kevyttä treeniä vain ${Math.round(share.easy * 100)} %`, text: "Suurin osa treenistä on keskiraskasta tai kovaa. Kestävyyslajeissa toimii yleensä noin 80 % kevyttä.", suggestion: "<b>Hidasta peruslenkkejä</b> niin, että syke pysyy alueilla 1–2.", easyMore: true });
    else if (share.hard < 0.04) out.push({ level: "warn", title: "Kovaa treeniä hyvin vähän", text: `Alueilla 4–5 vain ${Math.round(share.hard * 100)} % treeniajasta.`, suggestion: "<b>Lisää yksi intervallitreeni viikkoon.</b>", hardMore: true });
  }
  const order = { bad: 0, warn: 1, good: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------- viikkosuunnitelma ----------
export function defaultSettings(acts, today = new Date()) {
  const wk = weekly(acts, 9, today).slice(0, -1);
  const sessions = {};
  for (const k of SPORT_KEYS) sessions[k] = Math.min(6, Math.round(mean(wk.map(w => w.sports[k].n)) || 0));
  if (!Object.values(sessions).some(Boolean)) Object.assign(sessions, { run: 3, strength: 2 });
  return normalizeSettings({ sessions, restDay: 0, longDay: 5, auto: true });
}

export function normalizeSettings(s0 = {}) {
  const s = { ...s0 };
  s.sessions = { run: 0, bike: 0, hyrox: 0, strength: 0, other: 0, ...(s.sessions || {}) };
  if (!Array.isArray(s.events)) s.events = s.goal?.date ? [{ name: s.goal.name || "Tapahtuma", date: s.goal.date, prio: "A" }] : [];
  delete s.goal;
  s.restDay = s.restDay ?? 0; s.longDay = s.longDay ?? 5; s.auto = s.auto ?? true;
  s.weeklyHours = s.weeklyHours ?? null;
  s.historyDays = s.historyDays ?? 180;
  s.sportMap = s.sportMap || {};
  s.keyExpiry = s.keyExpiry || "";
  s.stationGuideUrl = s.stationGuideUrl || "";
  return s;
}

// ---------- tavoitetapahtumat ja harjoituskaudet ----------
export function upcomingEvents(events = [], today = new Date()) {
  const tk = dayKey(today);
  return events.filter(e => e?.date && e.date >= tk).sort((a, b) => (a.date < b.date ? -1 : 1));
}
export function phaseInfo(events = [], today = new Date()) {
  const up = upcomingEvents(events, today);
  const main = up.find(e => e.prio === "A") || up.find(e => e.prio === "B") || up[0];
  if (!main) return null;
  const days = Math.round((parseDay(main.date) - startOfDay(today)) / 864e5);
  const weeks = Math.ceil(days / 7);
  let phase, desc;
  if (days <= 13 && main.prio !== "C") { phase = "Kevennys"; desc = "Määrää vähennetään, teho säilytetään lyhyinä vetoina. Tavoite on olla levännyt kisapäivänä."; }
  else if (weeks <= 6) { phase = "Kisaan valmistava jakso"; desc = "Kisanomaiset treenit ja kisavauhti. Kova treeni 1–2 kertaa viikossa."; }
  else if (weeks <= 16) { phase = "Kehitysjakso"; desc = "Kynnys- ja VO2max-treenit lisääntyvät, peruskestävyys pysyy mukana."; }
  else { phase = "Perusjakso"; desc = "Rakennetaan peruskestävyyttä ja voimaa. Pääosin kevyttä treeniä."; }
  return { event: main, days, weeks, phase, desc };
}

function typicalLong(acts, sport, today) {
  const from = addDays(today, -42);
  const ds = acts.filter(a => a.sport === sport && a.date >= from).map(a => a.dur).sort((a, b) => b - a);
  return ds.length ? mean(ds.slice(0, 3)) : null;
}
function typical(acts, sport, today) {
  const from = addDays(today, -42);
  const ds = acts.filter(a => a.sport === sport && a.date >= from).map(a => a.dur).sort((a, b) => a - b);
  return ds.length ? ds[Math.floor(ds.length / 2)] : null;
}
const round5 = (s) => Math.max(20 * 60, Math.round(s / 300) * 300);
export function isoWeekNum(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}

// ---------- käsin lisätyt treenit ----------
export const ITYPE_KIND = { recovery: "easy", base: "easy", tempo: "hard", threshold: "hard", vo2: "hard", anaerobic: "hard", strength: "strength", unknown: "easy" };
const LOAD_PER_MIN = { recovery: 0.8, base: 1.3, tempo: 2.0, threshold: 2.6, vo2: 3.2, anaerobic: 3.0, strength: 1.6, unknown: 1.3 };

export function manualKind(it) {
  const k = ITYPE_KIND[it.itype] || "easy";
  return k === "easy" && it.sport !== "strength" && it.sport !== "hyrox" && (it.dur || 0) >= 75 * 60 ? "long" : k;
}

// Palauttaa viikon esiintymät (kertaluontoiset + viikoittain toistuvat)
export function expandManual(items = [], weekStartDate) {
  const out = [];
  const ws = startOfDay(weekStartDate), we = addDays(ws, 7);
  for (const it of items) {
    if (!it?.date) continue;
    const base = parseDay(it.date);
    if (it.repeat === "weekly") {
      const occ = addDays(ws, weekdayIdx(base));
      const k = dayKey(occ);
      if (occ < base) continue;
      if (it.until && k > it.until) continue;
      if ((it.skip || []).includes(k)) continue;
      out.push({ ...it, occDate: k });
    } else if (base >= ws && base < we) {
      out.push({ ...it, occDate: it.date });
    }
  }
  return out;
}

// Käsin kirjatut, tehdyt treenit tilastoihin (vain jos Garminista ei löydy samaa lajia samalta päivältä)
export function manualActivities(items = [], garminActs = [], today = new Date()) {
  const tk = dayKey(today);
  const out = [];
  for (const it of items) {
    if (!it || it.repeat === "weekly" || !it.done || !it.date || it.date > tk) continue;
    if (garminActs.some(a => a.day === it.date && a.sport === it.sport)) continue;
    const [h, m] = (it.time || "12:00").split(":").map(Number);
    const date = parseDay(it.date); date.setHours(h || 12, m || 0);
    const dur = it.dur || 0;
    out.push({
      id: `m_${it.id}`, manual: true, name: it.title || "", typeKey: "manual", sport: it.sport || "other",
      date, day: it.date, dur, dist: 0, avgHR: null, maxHR: null, speed: null, power: null,
      load: (dur / 60) * (LOAD_PER_MIN[it.itype] || 1.3), aeTE: null, anTE: null, zones: null,
      sets: null, reps: null, cal: null, elev: null, vo2: null, itype: it.itype || "base", itypeSource: "kasin", teLabel: null, note: it.note || "",
    });
  }
  return out;
}

// Treenipohjan intensiteetti ja kuormitus
export const TPL_ITYPE = {
  run_vo2: "vo2", run_threshold: "threshold", run_tempo: "tempo", run_hills: "anaerobic", run_base: "base", run_long: "base", run_recovery: "recovery",
  bike_threshold: "threshold", bike_vo2: "vo2", bike_base: "base", bike_long: "base", bike_recovery: "recovery",
  hyrox_run: "threshold", hyrox_stations: "strength", strength_full: "strength", strength_light: "strength", mobility: "recovery", walk: "recovery",
};
const LEG_TPL = new Set(["hyrox_run", "hyrox_stations", "strength_full", "run_hills"]);
function estimate(it) {
  const itype = it.itype || TPL_ITYPE[it.tpl] || (it.kind === "hard" ? "threshold" : it.kind === "strength" ? "strength" : "base");
  const f = { recovery: 0.8, base: 1.3, tempo: 2.0, threshold: 2.6, vo2: 3.2, anaerobic: 3.0, strength: 1.6, unknown: 1.3 }[itype] || 1.3;
  it.estLoad = Math.round(((it.dur || 0) / 60) * f * (it.sport === "hyrox" ? 1.15 : 1));
  if (it.legs == null) it.legs = LEG_TPL.has(it.tpl) || it.sport === "hyrox" || (it.sport === "strength" && it.tpl !== "strength_light" && it.kind !== "easy");
  return it;
}
function isHeavy(it) {
  return it.kind === "hard" || it.kind === "long" || it.sport === "hyrox" || (!!it.manual && it.estLoad >= 140);
}

export function buildPlan({ acts, settings, alertList, load, ready, share, weekStartDate, today = new Date(), manual = [], hidden = [] }) {
  const s = settings;
  const counts = { ...s.sessions };
  const changes = [];
  const pastWeek = addDays(weekStartDate, 7) <= weekStart(today);
  const occ = expandManual(manual, weekStartDate).map(it => ({
    sport: it.sport || "other", kind: manualKind(it), title: it.title || SPORTS[it.sport || "other"].name, dur: it.dur || 0,
    why: it.note || "", manual: true, mid: it.id, date: it.occDate, time: it.time || "", itype: it.itype || "base",
    recurring: it.repeat === "weekly", loggedDone: !!it.done && it.repeat !== "weekly", tpl: it.tpl || null,
  }));
  if (pastWeek) for (const k of SPORT_KEYS) counts[k] = 0;
  const isCurrent = +weekStartDate === +weekStart(today);
  const events = (s.events || []).filter(e => e?.date);
  const evDays = new Set(events.map(e => e.date));
  const taperEv = events.find(e => {
    const d = Math.round((parseDay(e.date) - weekStartDate) / 864e5);
    return (e.prio === "A" && d >= -6 && d <= 13) || (e.prio === "B" && d >= -6 && d <= 6);
  });
  const taper = !!taperEv && !pastWeek;
  const isEventEve = (d) => events.some(e => e.date === dayKey(addDays(d, 1)));
  let hardLimit = Infinity;

  const biggest = (except) => SPORT_KEYS.filter(k => k !== except && counts[k] > 1).sort((a, b) => counts[b] - counts[a])[0];

  if (s.auto && !taper) {
    // Painopisteen muutos heikkenevälle osa-alueelle
    const focus = alertList.find(a => a.focus && counts[a.focus.sport] != null);
    if (focus) {
      const k = focus.focus.sport;
      counts[k] = (counts[k] || 0) + 1;
      const from = biggest(k);
      if (from) { counts[from]--; changes.push(`Painopiste: +1 treeni lajiin ${SPORTS[k].name}, −1 lajista ${SPORTS[from].name}. Syy: ${focus.title}.`); }
      else changes.push(`Painopiste: +1 treeni lajiin ${SPORTS[k].name}. Syy: ${focus.title}.`);
    }
    // Kevennys
    const deload = alertList.some(a => a.deload) || (load?.ratio != null && load.ratio > 1.3);
    if (deload) {
      const from = biggest();
      if (from) counts[from]--;
      hardLimit = 1;
      changes.push("Kevyempi viikko: yksi treeni vähemmän ja enintään yksi kova treeni, koska kuorma on korkea tai palautuminen heikko.");
    }
    if (share && share.easy < 0.65) { hardLimit = Math.min(hardLimit, 1); changes.push("Enintään yksi kova treeni, jotta kevyen treenin osuus kasvaa."); }
  }
  if (taper) {
    for (const k of SPORT_KEYS) if (counts[k] > 1) counts[k]--;
    hardLimit = 1;
    changes.push(`Kevennys kohti tapahtumaa "${taperEv.name}": vähemmän treenejä, lyhyempiä kestoja ja enintään yksi lyhyt kova treeni.`);
  }

  // Treenityypit
  const sess = [];
  // Käsin lisätyt treenit korvaavat saman lajin automaattisia ehdotuksia
  if (occ.length && !pastWeek) {
    let replaced = 0;
    for (const o of occ) if (counts[o.sport] > 0) { counts[o.sport]--; replaced++; }
    if (replaced) changes.push("Käsin lisätyt treenit on huomioitu: saman lajin automaattisia ehdotuksia on vähennetty vastaavasti.");
  }
  let hardUsed = occ.filter(o => o.kind === "hard").length;
  const tLong = (k) => typicalLong(acts, k, today);
  const tMed = (k) => typical(acts, k, today);
  const durOr = (v, d) => round5((v || d) * (taper ? 0.7 : 1));
  const odd = isoWeekNum(weekStartDate) % 2 === 1;
  for (let i = 0; i < (counts.run || 0); i++) {
    if (i === 0 && counts.run >= 2) sess.push({ sport: "run", kind: "long", tpl: "run_long", title: "Pitkä rauhallinen juoksu", dur: durOr(tLong("run"), 70 * 60), why: "Peruskestävyys. Pidä syke alueella 2." });
    else if (i === 1 && counts.run >= 3 && hardUsed < hardLimit) { hardUsed++; const t = odd ? "run_threshold" : "run_vo2"; sess.push({ sport: "run", kind: "hard", tpl: t, title: odd ? "Kynnysintervallit 4 × 6 min" : "VO2max-intervallit 5 × 3 min", dur: durOr(odd ? 55 * 60 : 50 * 60), why: odd ? "Nostaa vauhtia, jota jaksat pitkään." : "Kehittää maksimaalista hapenottokykyä." }); }
    else sess.push({ sport: "run", kind: "easy", tpl: "run_base", title: "Rauhallinen juoksu", dur: durOr(tMed("run"), 40 * 60), why: "Kevyt peruslenkki, syke alueilla 1–2." });
  }
  for (let i = 0; i < (counts.bike || 0); i++) {
    if (i === 0 && counts.bike >= 2) sess.push({ sport: "bike", kind: "long", tpl: "bike_long", title: "Pitkä lenkki", dur: durOr(tLong("bike"), 120 * 60), why: "Rauhallinen peruskestävyys." });
    else if (i === 1 && counts.bike >= 3 && hardUsed < hardLimit) { hardUsed++; const t = odd ? "bike_vo2" : "bike_threshold"; sess.push({ sport: "bike", kind: "hard", tpl: t, title: odd ? "VO2max-intervallit 5 × 4 min" : "Kynnysintervallit 3 × 10 min", dur: durOr(odd ? 65 * 60 : 70 * 60), why: "Kova pyöräilytreeni." }); }
    else sess.push({ sport: "bike", kind: "easy", tpl: "bike_base", title: "Rauhallinen pyöräily", dur: durOr(tMed("bike"), 60 * 60), why: "Kevyt aerobinen lenkki." });
  }
  for (let i = 0; i < (counts.hyrox || 0); i++) {
    if (i % 2 === 0 && hardUsed < hardLimit) { hardUsed++; sess.push({ sport: "hyrox", kind: "hard", tpl: "hyrox_run", title: "HYROX: juoksu + asemat", dur: durOr(60 * 60), why: "Kisanomainen yhdistelmä: juoksu väsyneillä jaloilla." }); }
    else sess.push({ sport: "hyrox", kind: "strength", tpl: "hyrox_stations", title: "HYROX: asemat ja voimakestävyys", dur: durOr(50 * 60), why: "Asemien tekniikka ja voimakestävyys." });
  }
  for (let i = 0; i < (counts.strength || 0); i++) {
    const combo = !(counts.hyrox > 0) && i % 2 === 1 && hardUsed < hardLimit;
    if (combo) { hardUsed++; sess.push({ sport: "strength", kind: "hard", tpl: "hyrox_run", title: "Yhdistelmätreeni", dur: durOr(50 * 60), why: "Juoksu + toiminnalliset liikkeet vuorotellen (HYROX-tyyppinen)." }); }
    else sess.push({ sport: "strength", kind: "strength", tpl: "strength_full", title: "Voimatreeni", dur: durOr(tMed("strength"), 50 * 60), why: "Koko kehon voima, painopiste jaloissa ja keskivartalossa." });
  }
  for (let i = 0; i < (counts.other || 0); i++) sess.push({ sport: "other", kind: "easy", tpl: "mobility", title: "Liikkuvuus tai vapaavalintainen", dur: durOr(tMed("other"), 40 * 60), why: "Kevyt liikunta tai liikkuvuus." });

  // ---------- Päivien jako kuormituksen mukaan ----------
  const days = Array.from({ length: 7 }, (_, i) => ({ idx: i, date: addDays(weekStartDate, i), items: [] }));
  for (const o of occ) days.find(d => dayKey(d.date) === o.date)?.items.push(o);
  const tk = dayKey(today);
  const rest = s.restDay;
  const longRunDay = s.longDay;
  const longBikeDay = (s.longDay + 1) % 7 === rest ? (s.longDay + 6) % 7 : (s.longDay + 1) % 7;

  // Kuorma-arviot: tyypillinen yksittäisen treenin ja päivän kuorma viimeiseltä 4 viikolta
  const recentLoads = acts.filter(a => a.date >= addDays(today, -28) && a.date < today && a.load).map(a => a.load).sort((x, y) => x - y);
  const medAct = recentLoads.length ? recentLoads[Math.floor(recentLoads.length / 2)] : 80;
  const dailyTyp = load?.chronic ? load.chronic / 7 : medAct * 0.6;
  for (const d of days) for (const it of d.items) estimate(it);
  for (const it of sess) estimate(it);

  // Raskas päivä = kova, pitkä tai HYROX, tai toteutunut treeni selvästi tavallista kuormittavampi
  const actsOn = (k) => acts.filter(a => a.day === k);
  const heavyAct = (a) => ["threshold", "vo2", "anaerobic"].includes(a.itype) || a.sport === "hyrox" || a.dur >= 90 * 60 || a.load >= 1.35 * medAct;
  const dayOf = (date) => days.find(d => dayKey(d.date) === dayKey(date));
  const heavyOn = (date) => {
    const d = dayOf(date), k = dayKey(date);
    if (d?.items.some(isHeavy)) return true;
    return k < tk && actsOn(k).some(heavyAct);
  };
  const trainsOn = (date) => {
    const d = dayOf(date), k = dayKey(date);
    if (d?.items.some(i => i.kind !== "event")) return true;
    return k <= tk && actsOn(k).length > 0;
  };
  const streakWith = (d) => {
    // treenipäivien putken pituus, jos päivälle d tulee treeni
    let n = 1;
    for (let i = 1; i < 7 && trainsOn(addDays(d.date, -i)); i++) n++;
    for (let i = 1; i < 7 && trainsOn(addDays(d.date, i)); i++) n++;
    return n;
  };
  const future = (d) => !pastWeek && dayKey(d.date) >= tk;

  const prio = { long: 0, hard: 1, strength: 2, easy: 3 };
  sess.sort((a, b) => (prio[a.kind] - prio[b.kind]) || (isHeavy(b) - isHeavy(a)));
  for (const it of sess) {
    let best = null, bestScore = Infinity;
    for (const d of days) {
      if (d.idx === rest) continue;
      if (evDays.has(dayKey(d.date))) continue;
      if (isEventEve(d.date) && (isHeavy(it) || it.legs)) continue;
      const prevH = heavyOn(addDays(d.date, -1)), nextH = heavyOn(addDays(d.date, 1));
      let sc = d.items.length * 12;
      if (d.items.length >= 2) sc += 100;
      if (it.kind === "long" && it.sport === "run") sc += d.idx === longRunDay ? -50 : 20;
      if (it.kind === "long" && it.sport === "bike") sc += d.idx === longBikeDay ? -50 : 20;
      if (isHeavy(it)) {
        if (d.items.some(isHeavy)) sc += 70;
        if (prevH) sc += 32;
        if (nextH) sc += 32;
      } else if (it.legs) {
        // jalkavoima ei raskaan päivän jälkeen eikä juuri ennen sitä
        if (prevH) sc += 45;
        if (nextH) sc += 20;
        if (d.items.some(isHeavy)) sc += 35;
      } else if (prevH) sc -= 8; // kevyt treeni raskaan päivän jälkeen tukee palautumista
      if (d.items.some(x => x.sport === it.sport)) sc += 40;
      const adjSame = [dayOf(addDays(d.date, -1)), dayOf(addDays(d.date, 1))].filter(Boolean).filter(x => x.items.some(y => y.sport === it.sport)).length;
      sc += adjSame * 16;
      if (!d.items.length) sc -= 4;
      const st = streakWith(d);
      if (st >= 4) sc += 30 + (st - 4) * 15;
      sc += d.idx * 0.01;
      if (sc < bestScore) { bestScore = sc; best = d; }
    }
    if (best) best.items.push({ ...it });
  }

  // ---------- Palautumispäivät ----------
  const fatigue = s.auto && !pastWeek && (alertList.some(a => a.deload) || (isCurrent && ((load?.ratio != null && load.ratio > 1.3) || (ready?.score != null && ready.score < 45))));
  const movable = (it) => !it.manual && it.kind !== "event" && !it.done;
  const trainingDay = (d) => d.items.some(i => i.kind !== "event");
  const dn = (d) => DAY_NAMES_LONG[d.idx].toLowerCase();
  // 1) Enintään 3 treenipäivää peräkkäin: siirretään kevein automaattinen treeni tai jätetään se pois
  for (let guard = 0; guard < 4; guard++) {
    let runD = [], worst = null;
    for (const d of days) {
      if (trainsOn(d.date)) runD.push(d);
      else { if (runD.length >= 4 && !worst) worst = runD; runD = []; }
    }
    if (!worst && runD.length >= 4) worst = runD;
    if (!worst) break;
    const cand = worst.filter(future).flatMap(d => d.items.filter(movable).map(it => ({ d, it }))).sort((a, b) => a.it.estLoad - b.it.estLoad)[0];
    if (!cand) break;
    cand.d.items.splice(cand.d.items.indexOf(cand.it), 1);
    const target = days.filter(d => future(d) && !trainingDay(d) && d.idx !== rest && !evDays.has(dayKey(d.date)) && !worst.includes(d))
      .find(d => streakWith(d) < 4 && !((isHeavy(cand.it) || cand.it.legs) && heavyOn(addDays(d.date, -1))) && !(isHeavy(cand.it) && heavyOn(addDays(d.date, 1))));
    if (target) {
      target.items.push(cand.it);
      changes.push(`Palautumispäivä: "${cand.it.title}" siirretty päivältä ${dn(cand.d)} päivälle ${dn(target)}, jotta treenipäiviä ei tule yli 3 peräkkäin.`);
    } else if (fatigue || !isHeavy(cand.it)) {
      changes.push(`Palautumispäivä: "${cand.it.title}" (${dn(cand.d)}) jätetty pois, koska treenipäiviä olisi tullut yli 3 peräkkäin.`);
    } else { cand.d.items.push(cand.it); break; }
  }
  // 2) Väsymyksen merkeissä vähintään 2 lepopäivää tulevista päivistä
  if (fatigue) {
    const restFuture = () => days.filter(d => future(d) && !trainingDay(d)).length;
    const want = Math.min(2, Math.max(0, days.filter(future).length - 2));
    let dropped = 0;
    while (restFuture() < want && dropped < 2) {
      const cand = days.filter(future).flatMap(d => d.items.filter(i => movable(i) && !isHeavy(i)).map(it => ({ d, it })))
        .filter(x => x.d.items.filter(i => i.kind !== "event").length === 1)
        .sort((a, b) => (heavyOn(addDays(b.d.date, -1)) - heavyOn(addDays(a.d.date, -1))) || (a.it.estLoad - b.it.estLoad))[0];
      if (!cand) break;
      cand.d.items.splice(cand.d.items.indexOf(cand.it), 1);
      dropped++;
      changes.push(`Ylimääräinen lepopäivä (${dn(cand.d)}): "${cand.it.title}" jätetty pois, koska kuorma on noussut tai palautumisen merkit ovat heikot.`);
    }
  }

  // Tämän päivän säätö valmiuden mukaan
  if (isCurrent) {
    const td = days.find(d => dayKey(d.date) === tk);
    if (td && ready?.score != null && ready.score < 30 && td.items.some(movable)) {
      td.items = td.items.filter(i => !movable(i));
      changes.push(`Tänään lepopäivä: harjoitusvalmius on hyvin matala (${ready.score}).`);
    } else if (ready?.level === "easy") {
      for (const it of td?.items || []) {
        if (!it.manual && (it.kind === "hard" || it.kind === "long" || it.legs)) {
          it.title = it.sport === "strength" || it.sport === "hyrox" ? "Kevyt voima ja liikkuvuus" : `Kevyt ${SPORTS[it.sport].name.toLowerCase()}`;
          it.tpl = it.sport === "run" ? "run_recovery" : it.sport === "bike" ? "bike_recovery" : "strength_light";
          it.kind = "easy"; it.legs = false; it.itype = null; it.dur = round5(Math.min(it.dur, 40 * 60)); it.changed = true;
          it.why = "Vaihdettu kevyeksi, koska palautumisen merkit ovat tänään heikot. Kova treeni siirtyy myöhemmäksi.";
          estimate(it);
        }
      }
    }
  }

  // Lepopäivien perustelut
  for (const d of days) {
    if (trainingDay(d)) continue;
    const k = dayKey(d.date);
    if (k < tk && actsOn(k).length) continue;
    const prev = addDays(d.date, -1);
    const prevItem = dayOf(prev)?.items.find(isHeavy) || (dayKey(prev) < tk ? actsOn(dayKey(prev)).find(heavyAct) : null);
    let streak = 0;
    for (let i = 1; i < 7 && trainsOn(addDays(d.date, -i)); i++) streak++;
    let reason;
    if (evDays.has(k)) reason = "";
    else if (isEventEve(d.date)) reason = "Lepo ennen tapahtumaa.";
    else if (prevItem) reason = `Palautuminen eilisestä: ${prevItem.title || prevItem.name || "raskas treeni"}.`;
    else if (streak >= 3) reason = `Lepo ${streak} treenipäivän jälkeen.`;
    else if (d.idx === rest) reason = "Asetusten lepopäivä.";
    else if (fatigue) reason = "Ylimääräinen lepo: kuorma tai palautuminen vaatii.";
    else reason = "Palautuminen.";
    d.rest = { reason };
  }

  // Tarkistus: säännöt, joita ei saatu täytettyä (yleensä käsin lisättyjen treenien takia)
  for (const d of days) {
    if (!future(d)) continue;
    const prevH = heavyOn(addDays(d.date, -1));
    for (const it of d.items) {
      if (!movable(it)) continue;
      if (it.legs && !isHeavy(it) && prevH) changes.push(`Huom: ${dn(d)}n "${it.title}" on raskaan päivän jälkeen. Siirrä se tarvittaessa.`);
      else if (isHeavy(it) && prevH) changes.push(`Huom: kaksi raskasta päivää peräkkäin (${dn(d)}). Viikkoon ei mahtunut parempaa järjestystä.`);
    }
  }

  for (const e of events) {
    const gd = days.find(d => dayKey(d.date) === e.date);
    if (gd) gd.items.unshift({ sport: "other", kind: "event", title: e.name || "Tapahtuma", prio: e.prio, dur: 0, why: `Tavoitetapahtuma (${e.prio || "A"}-prioriteetti). Onnea matkaan!` });
  }

  // Piilotetut ehdotukset pois, järjestys kellonajan mukaan
  const hid = new Set(hidden || []);
  for (const d of days) {
    const k = dayKey(d.date);
    d.items = d.items.filter(it => it.manual || it.kind === "event" || !hid.has(`${k}|${it.title}`));
    for (const it of d.items) if (!it.manual) it.hideKey = `${k}|${it.title}`;
    d.items.sort((a, b) => (a.kind === "event" ? -1 : b.kind === "event" ? 1 : 0) || ((a.time || "99") < (b.time || "99") ? -1 : (a.time || "99") > (b.time || "99") ? 1 : 0));
  }

  // Toteutuneet treenit
  for (const d of days) {
    const k = dayKey(d.date);
    d.actual = acts.filter(a => a.day === k);
    const pool = [...d.actual];
    const ordered = [...d.items.filter(i => i.manual), ...d.items.filter(i => !i.manual)];
    for (const it of ordered) {
      const i = pool.findIndex(a => a.sport === it.sport);
      if (i >= 0) { it.done = true; pool.splice(i, 1); }
    }
    d.extra = pool.filter(a => !a.manual); // tehdyt, joita ei ollut suunnitelmassa
  }
  const planned = {};
  for (const d of days) for (const it of d.items) if (it.kind !== "event") planned[it.sport] = (planned[it.sport] || 0) + 1;
  // Viikon summat: suunniteltu ja toteutunut
  const plannedDur = sum(days.flatMap(d => d.items.filter(i => i.kind !== "event").map(i => i.dur || 0)));
  const doneActs = days.flatMap(d => d.actual);
  for (const d of days) {
    const k = dayKey(d.date);
    const done = sum(d.actual.map(a => a.load));
    const plannedL = sum(d.items.filter(i => i.kind !== "event" && !i.done).map(i => i.estLoad || 0));
    d.load = k < tk ? done : done + plannedL;
    d.heavy = d.items.some(isHeavy) || d.actual.some(heavyAct);
  }
  const weekLoad = sum(days.map(d => d.load));
  const typWeek = load?.chronic || null;
  const totals = { plannedDur, doneDur: sum(doneActs.map(a => a.dur)), doneLoad: sum(doneActs.map(a => a.load)), doneN: doneActs.length,
    weekLoad, typWeek, loadRatio: typWeek ? weekLoad / typWeek : null, dailyTyp, restDays: days.filter(d => d.rest).length };
  if (!pastWeek && totals.loadRatio != null && totals.loadRatio > 1.3) changes.push(`Viikon arvioitu kuorma ${Math.round(weekLoad)} on ${Math.round((totals.loadRatio - 1) * 100)} % tavallista suurempi. Harkitse yhden treenin keventämistä.`);
  return { days, changes, counts, planned, pastWeek, totals };
}

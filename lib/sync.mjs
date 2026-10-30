// Hakee uudet treenit ja palautumisdatan Garminilta ja tallentaa ne Netlify Blobsiin.
// Palautumisdata kerätään päivämäärittäin, joten historia kasvaa joka haulla.
// Vanhempaa palautumisdataa haetaan pala kerrallaan (28 pv / haku), kunnes puoli vuotta on täynnä.
import { getStore } from "@netlify/blobs";
import { garminGet, garminGetBytes, getToken } from "./garmin.mjs";
import { unzipFirst, readFit } from "./fit.mjs";

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n, from = new Date()) => {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};
const HISTORY_DAYS = 180;

// Etsii vastauksesta kaikki oliot, joilla on päivämääräkenttä, ja tallentaa ne päivän mukaan.
function collectByDate(node, target, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return;
  if (Array.isArray(node)) {
    for (const n of node) collectByDate(n, target, depth + 1);
    return;
  }
  const date = node.calendarDate || node.calendarDateString || node.date;
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    const key = date.slice(0, 10);
    target[key] = { ...(target[key] || {}), ...node };
    return;
  }
  for (const v of Object.values(node)) collectByDate(v, target, depth + 1);
}

async function fetchHealth(data, start, end, step) {
  const h = data.healthByDate;
  const add = (type, res) => {
    if (!res) return;
    h[type] = h[type] || {};
    collectByDate(res, h[type]);
  };
  const [hrv, sleep, bb, daily] = await Promise.all([
    step(`HRV ${start}`, () => garminGet(`/hrv-service/hrv/daily/${start}/${end}`)),
    step(`Uni ${start}`, () => garminGet("/sleep-service/sleep/dailySleepSummariesByDate", { startDate: start, endDate: end })),
    step(`Body Battery ${start}`, () => garminGet("/wellness-service/wellness/bodyBattery/reports/daily", { startDate: start, endDate: end })),
    step(`Päiväyhteenvedot ${start}`, () => garminGet("/usersummary-service/v2/dailysummaries", { startDate: start, endDate: end })),
  ]);
  add("hrv", hrv); add("sleep", sleep); add("bb", bb); add("daily", daily);
}

const findNum = (o, re, d = 0) => {
  if (!o || typeof o !== "object" || d > 5) return null;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && typeof v === "number" && v > 0) return v;
  for (const v of Object.values(o)) { const r = v && typeof v === "object" ? findNum(v, re, d + 1) : null; if (r != null) return r; }
  return null;
};
const findStr = (o, re, d = 0) => {
  if (!o || typeof o !== "object" || d > 5) return null;
  for (const [k, v] of Object.entries(o)) if (re.test(k) && typeof v === "string") return v;
  for (const v of Object.values(o)) { const r = v && typeof v === "object" ? findStr(v, re, d + 1) : null; if (r) return r; }
  return null;
};
// Avainten nimet vianselvitystä varten (ei arvoja)
const keyList = (o, prefix = "", d = 0, out = []) => {
  if (!o || typeof o !== "object" || Array.isArray(o) || d > 3) return out;
  for (const [k, v] of Object.entries(o)) {
    out.push(prefix + k);
    if (v && typeof v === "object" && !Array.isArray(v)) keyList(v, prefix + k + ".", d + 1, out);
  }
  return out.slice(0, 120);
};

export async function runSync() {
  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const store = getStore("garmin");
  const data = (await store.get("data", { type: "json" })) || {};
  data.activities = data.activities || {};
  data.healthByDate = data.healthByDate || {};
  data.healthByDate.hr = data.healthByDate.hr || {};
  data.vo2History = data.vo2History || {};
  delete data.health; // vanhan version muoto
  const firstRun = Object.keys(data.activities).length === 0;
  const status = { time: new Date().toISOString(), steps: [] };
  const today = iso(new Date());

  // optional = lisätieto, jonka puuttuminen ei ole virhe
  const step = async (name, fn, optional = false) => {
    try {
      const value = await fn();
      status.steps.push({ name, ok: true });
      return value;
    } catch (e) {
      status.steps.push({ name, ok: false, optional, error: String(e.message || e).slice(0, 200) });
      return null;
    }
  };

  // Tunniste kerran ennen rinnakkaisia hakuja
  await getToken();

  // Vaihe 1: kaikki tärkeät haut rinnakkain (Netlifyn funktiolla on n. 10 s aikaraja)
  const hrDays = Array.from({ length: 7 }, (_, i) => daysAgo(i));
  const [activities, zones, , hrRes, prof, fa] = await Promise.all([
    step("Treenit", async () => {
      const all = [];
      const startDate = daysAgo(firstRun ? HISTORY_DAYS : 14);
      for (let start = 0, i = 0; i < 6; i++, start += 100) {
        const page = await garminGet("/activitylist-service/activities/search/activities", { start, limit: 100, startDate, endDate: today });
        const list = Array.isArray(page) ? page : page?.activityList || [];
        all.push(...list);
        if (list.length < 100) break;
      }
      return all;
    }),
    step("Sykealueet", () => garminGet("/biometric-service/heartRateZones/v2")),
    fetchHealth(data, daysAgo(27), today, step),
    step("Leposyke", async () => {
      const res = await Promise.allSettled(hrDays.map(d => garminGet("/wellness-service/wellness/dailyHeartRate", { date: d })));
      const ok = res.map((r, i) => [hrDays[i], r]).filter(([, r]) => r.status === "fulfilled" && r.value);
      if (!ok.length) throw new Error(res.find(r => r.status === "rejected")?.reason?.message || "ei dataa");
      return ok;
    }, true),
    step("Profiili", () => garminGet("/userprofile-service/userprofile/settings"), true),
    step("Kuntoikä", () => garminGet(`/fitnessage-service/fitnessage/v2/${today}`), true),
  ]);

  if (activities) for (const a of activities) data.activities[a.activityId] = { ...(data.activities[a.activityId] || {}), ...a };
  if (zones) data.hrZones = zones;
  for (const [d, r] of hrRes || []) {
    const slim = Object.fromEntries(Object.entries(r.value).filter(([, x]) => !Array.isArray(x)));
    data.healthByDate.hr[d] = { ...slim, calendarDate: d };
  }
  if (fa) data.fitnessAge = { ...fa, fetched: today };
  if (prof) {
    const run = findNum(prof, /^vo2max(running|run)?$/i) ?? findNum(prof, /vo2max.*run/i);
    const bike = findNum(prof, /^vo2maxcycling$/i) ?? findNum(prof, /vo2max.*(cycl|bik)/i);
    if (run || bike) data.vo2History[today] = { run: run || null, bike: bike || null };
    data.profile = {
      gender: findStr(prof, /^gender$/i), birthDate: findStr(prof, /^birthDate$/i),
      ltHR: findNum(prof, /^lactateThresholdHeartRate$/i), vo2Run: run || null, vo2Bike: bike || null,
      keys: keyList(prof).filter(k => !/name|email|location|id$|uuid/i.test(k)),
    };
  }

  // Pidempi treenihistoria asetusten mukaan (90 pv kerrallaan)
  if (!data.actOldest) {
    const dates = Object.values(data.activities).map(a => String(a.startTimeLocal || "").slice(0, 10)).filter(Boolean).sort();
    data.actOldest = firstRun ? daysAgo(HISTORY_DAYS) : (dates[0] || daysAgo(HISTORY_DAYS));
  }
  const settings = (await store.get("settings", { type: "json" })) || {};
  const wantDays = Math.min(730, settings.historyDays || HISTORY_DAYS);

  // Vaihe 2: lisätiedot vain jos aikaa on jäljellä
  if (elapsed() < 6000) {
    const needOlder = data.actOldest > daysAgo(wantDays);
    const oEnd = daysAgo(1, new Date(data.actOldest + "T00:00:00Z"));
    const oStart = [daysAgo(89, new Date(oEnd + "T00:00:00Z")), daysAgo(wantDays)].sort().pop();
    const oldest = data.backfilledTo || daysAgo(27);
    const doBackfill = oldest > daysAgo(HISTORY_DAYS);
    const bfEnd = daysAgo(1, new Date(oldest + "T00:00:00Z"));
    const bfStart = daysAgo(27, new Date(bfEnd + "T00:00:00Z"));
    await Promise.all([
      probeVo2(data, step, 4),
      doBackfill ? fetchHealth(data, bfStart, bfEnd, step).then(() => { data.backfilledTo = bfStart; }) : null,
      needOlder ? step(`Vanhemmat treenit ${oStart}`, async () => {
        for (let start = 0, i = 0; i < 3; i++, start += 100) {
          const page = await garminGet("/activitylist-service/activities/search/activities", { start, limit: 100, startDate: oStart, endDate: oEnd });
          const list = Array.isArray(page) ? page : page?.activityList || [];
          for (const a of list) data.activities[a.activityId] = { ...(data.activities[a.activityId] || {}), ...a };
          if (list.length < 100) break;
        }
        data.actOldest = oStart;
      }) : null,
    ]);
  }

  status.ms = elapsed();
  data.status = status;
  await store.setJSON("data", data);
  return status;
}

// VO2max treenien FIT-tiedostoista. Garmin tallentaa arvion juoksun ja pyöräilyn FIT-tiedostoon.
// FIT_VERSION nostetaan, kun lukija paranee: silloin aiemmin tarkistetut treenit luetaan uudelleen.
export const FIT_VERSION = 4;
// Juoksun dynamiikka löytyy yleensä jo treenilistasta; tiedosto luetaan uudelleen vain jos ei löydy
const hasListDyn = (a) => a.avgGroundContactTime != null || a.averageRunningCadenceInStepsPerMinute != null || a.avgVerticalOscillation != null;
const needsFit = (a) => (a._fitV || 0) < 3 || ((a._fitV || 0) < 4 && /run/i.test(a.activityType?.typeKey || "") && !hasListDyn(a));
const FIT_TYPES = /run|cycl|bik|ride|cardio|hiit|strength|hyrox|crossfit|fitness_equipment|bootcamp/i;
export function vo2Candidates(data) {
  return Object.values(data.activities)
    .filter(a => (FIT_TYPES.test(a.activityType?.typeKey || "") || /hyrox/i.test(a.activityName || "")) && needsFit(a))
    .sort((a, b) => {
      const out = (x) => (/treadmill|indoor|virtual/i.test(x.activityType?.typeKey || "") ? 1 : 0);
      return out(a) - out(b) || String(b.startTimeLocal).localeCompare(String(a.startTimeLocal));
    });
}

export async function probeVo2(data, step, n = 4) {
  const list = vo2Candidates(data).slice(0, n);
  if (!list.length) return;
  if ((data.fitDebug?.v || 0) < FIT_VERSION) data.fitDebug = { v: FIT_VERSION, checked: 0, found: 0 };
  return step("Treenitiedostot (VO2max, kierrokset, ennätykset)", async () => {
    const res = await Promise.allSettled(list.map(async (a) => {
      const fit = unzipFirst(await garminGetBytes(`/download-service/files/activity/${a.activityId}`));
      return readFit(fit);
    }));
    res.forEach((r, i) => {
      const a = list[i];
      a._fitV = FIT_VERSION;
      data.fitDebug.checked++;
      if (r.status === "fulfilled") {
        const v = r.value.vo2.find(x => x.src === 229) || r.value.vo2[r.value.vo2.length - 1];
        if (v) { a.vO2MaxValue = v.value; a._vo2Src = v.src; data.fitDebug.found++; }
        a._fit = { laps: r.value.laps.slice(0, 80).map(l => ({ t: l.t && Math.round(l.t), d: l.d && Math.round(l.d), hr: l.hr, mhr: l.mhr })), best: r.value.best, dyn: r.value.dyn };
        data.fitDebug.last = {
          activity: a.activityId, type: a.activityType?.typeKey,
          msg229: r.value.counts[229] || 0, msg140: r.value.counts[140] || 0,
          m140: r.value.m140, messages: Object.keys(r.value.counts).map(Number).sort((x, y) => x - y).join(","),
        };
      } else data.fitDebug.lastError = String(r.reason?.message || r.reason).slice(0, 200);
      // jos treeni on samaan aikaan korvattu uudella haulla, kopioidaan tulokset nykyiseen olioon
      const cur = data.activities[a.activityId];
      if (cur && cur !== a) Object.assign(cur, { _fitV: a._fitV, _fit: a._fit, vO2MaxValue: a.vO2MaxValue ?? cur.vO2MaxValue, _vo2Src: a._vo2Src });
    });
    if (res.every(r => r.status === "rejected")) throw new Error(data.fitDebug.lastError || "lataus epäonnistui");
  }, true);
}

// Erillinen VO2max-historian haku napista: käy läpi niin monta treeniä kuin aikaa riittää
export async function runVo2Backfill() {
  const store = getStore("garmin");
  const data = (await store.get("data", { type: "json" })) || {};
  data.activities = data.activities || {};
  const t0 = Date.now();
  const steps = [];
  const step = async (name, fn, optional) => {
    try { const v = await fn(); steps.push({ name, ok: true }); return v; }
    catch (e) { steps.push({ name, ok: false, optional, error: String(e.message || e).slice(0, 200) }); return null; }
  };
  await getToken();
  while (Date.now() - t0 < 6000 && vo2Candidates(data).length) await probeVo2(data, step, 4);
  await store.setJSON("data", data);
  return { remaining: vo2Candidates(data).length, found: data.fitDebug?.found || 0, checked: data.fitDebug?.checked || 0, steps };
}

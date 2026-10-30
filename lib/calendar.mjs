// Google-kalenterin (tai minkä tahansa iCal-syötteen) luku ja toistuvien tapahtumien laajennus.
// Tuettu: DTSTART/DTEND (UTC, TZID, koko päivä), DURATION, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY,
// INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY), EXDATE ja RECURRENCE-ID-poikkeukset.
import { fetchWithTimeout } from "./http.mjs";

const DEFAULT_TZ = "Europe/Helsinki";
const DAY = 86400000;
const WD = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };

// ---------- Aikavyöhykkeet ----------
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - utcMs;
}

export function localToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let off;
  try {
    off = tzOffsetMs(guess, tz);
  } catch {
    off = tzOffsetMs(guess, DEFAULT_TZ);
    tz = DEFAULT_TZ;
  }
  const first = guess - off;
  const off2 = tzOffsetMs(first, tz);
  return off2 === off ? first : guess - off2;
}

function ymdInTz(utcMs, tz) {
  const s = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utcMs));
  return s;
}

// ---------- Jäsennys ----------
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescape(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...ps] = head.split(";");
  const params = {};
  for (const p of ps) {
    const i = p.indexOf("=");
    if (i > 0) params[p.slice(0, i).toUpperCase()] = p.slice(i + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

/** Palauttaa { ms, allDay, local:{y,m,d,h,mi,s}, tz } */
function parseDate(value, params, calTz) {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const local = { y: +y, m: +mo, d: +d, h: +(h || 0), mi: +(mi || 0), s: +(s || 0) };
  if (params.VALUE === "DATE" || h === undefined) {
    return { allDay: true, local, tz: calTz, ms: Date.UTC(local.y, local.m - 1, local.d) };
  }
  if (z) return { allDay: false, local: null, tz: "UTC", ms: Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, local.s) };
  const tz = params.TZID || calTz;
  return { allDay: false, local, tz, ms: localToUtc(local.y, local.m, local.d, local.h, local.mi, local.s, tz) };
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * DAY) + ((+d || 0) * DAY) + ((+h || 0) * 3600000) + ((+mi || 0) * 60000) + ((+s || 0) * 1000);
  return sign === "-" ? -ms : ms;
}

export function parseIcs(text) {
  const lines = unfold(text);
  let calTz = DEFAULT_TZ;
  let calName = null;
  const events = [];
  let cur = null;
  let depth = 0;
  for (const raw of lines) {
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === "X-WR-TIMEZONE" && !cur) calTz = l.value.trim() || calTz;
    if (l.name === "X-WR-CALNAME" && !cur) calName = unescape(l.value.trim());
    if (l.name === "BEGIN") {
      if (l.value === "VEVENT") { cur = { exdates: [] }; depth = 0; }
      else if (cur) depth++;
      continue;
    }
    if (l.name === "END") {
      if (l.value === "VEVENT" && cur) { events.push(cur); cur = null; }
      else if (cur) depth--;
      continue;
    }
    if (!cur || depth > 0) continue; // ohitetaan VALARM ym.
    switch (l.name) {
      case "UID": cur.uid = l.value; break;
      case "SUMMARY": cur.title = unescape(l.value); break;
      case "LOCATION": cur.location = unescape(l.value); break;
      case "STATUS": cur.status = l.value.toUpperCase(); break;
      case "DTSTART": cur.start = parseDate(l.value, l.params, calTz); break;
      case "DTEND": cur.end = parseDate(l.value, l.params, calTz); break;
      case "DURATION": cur.duration = parseDuration(l.value); break;
      case "RRULE": cur.rrule = Object.fromEntries(l.value.split(";").map((p) => p.split("=")).map(([k, v]) => [k.toUpperCase(), v])); break;
      case "EXDATE": for (const v of l.value.split(",")) { const d = parseDate(v, l.params, calTz); if (d) cur.exdates.push(d.ms); } break;
      case "RECURRENCE-ID": cur.recurrenceId = parseDate(l.value, l.params, calTz); break;
    }
  }
  return { calTz, calName, events: events.filter((e) => e.start && e.status !== "CANCELLED") };
}

// ---------- Toistuvat tapahtumat ----------
function addDays(local, n) {
  const d = new Date(Date.UTC(local.y, local.m - 1, local.d + n));
  return { ...local, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
function weekday(local) {
  return new Date(Date.UTC(local.y, local.m - 1, local.d)).getUTCDay();
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function toMs(ev, local) {
  if (ev.start.allDay) return Date.UTC(local.y, local.m - 1, local.d);
  return localToUtc(local.y, local.m, local.d, local.h, local.mi, local.s, ev.start.tz);
}
function nthWeekdayOfMonth(y, m, wd, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return day <= daysInMonth(y, m) ? day : null;
  }
  const lastDay = daysInMonth(y, m);
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  const day = lastDay - ((last - wd + 7) % 7) + (n + 1) * 7;
  return day >= 1 ? day : null;
}

function* occurrences(ev, toMsLimit, fromMs = 0) {
  const r = ev.rrule;
  const base = ev.start.local || (() => {
    // UTC-muotoinen alku: toistetaan Helsingin paikallisajassa.
    const tz = DEFAULT_TZ;
    const off = tzOffsetMs(ev.start.ms, tz);
    const d = new Date(ev.start.ms + off);
    ev.start.tz = tz;
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
  })();
  if (!r) { yield ev.start.ms; return; }
  const interval = Math.max(1, Number(r.INTERVAL || 1));
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? parseDate(r.UNTIL, {}, ev.start.tz).ms + (r.UNTIL.length === 8 ? DAY - 1 : 0) : Infinity;
  const byday = (r.BYDAY || "").split(",").filter(Boolean).map((x) => {
    const m = x.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
    return m ? { n: m[1] ? Number(m[1]) : 0, wd: WD[m[2]] } : null;
  }).filter(Boolean);
  const bymonthday = (r.BYMONTHDAY || "").split(",").filter(Boolean).map(Number);
  let emitted = 0;
  const emit = function* (local) {
    const ms = toMs(ev, local);
    if (ms < ev.start.ms) return;
    if (ms > until || emitted >= count) { emitted = Infinity; return; }
    emitted++;
    yield ms;
  };

  // Pitkään jatkuneissa toistuvissa tapahtumissa hypätään suoraan lähelle tarkasteltavaa aikaväliä.
  let i0 = 0;
  if (count === Infinity && fromMs > ev.start.ms) {
    const period = { DAILY: DAY, WEEKLY: 7 * DAY, MONTHLY: 28 * DAY, YEARLY: 365 * DAY }[r.FREQ];
    if (period) i0 = Math.max(0, Math.floor((fromMs - ev.start.ms) / (period * interval)) - 2);
  }
  for (let i = i0; i < i0 + 3000 && emitted < count; i++) {
    let cands = [];
    if (r.FREQ === "DAILY") {
      cands = [addDays(base, i * interval)];
    } else if (r.FREQ === "WEEKLY") {
      // Viikko alkaa maanantaista (WKST=MO, Googlen oletus).
      const monday = addDays(base, -((weekday(base) + 6) % 7) + i * 7 * interval);
      const days = byday.length ? byday.map((b) => b.wd) : [weekday(base)];
      cands = days.map((wd) => addDays(monday, (wd + 6) % 7)).sort((a, b) => toMs(ev, a) - toMs(ev, b));
    } else if (r.FREQ === "MONTHLY") {
      const mIdx = base.m - 1 + i * interval;
      const y = base.y + Math.floor(mIdx / 12);
      const m = (mIdx % 12) + 1;
      let days = [];
      if (bymonthday.length) days = bymonthday.map((d) => (d < 0 ? daysInMonth(y, m) + d + 1 : d));
      else if (byday.length) days = byday.map((b) => nthWeekdayOfMonth(y, m, b.wd, b.n || 1));
      else days = [base.d];
      cands = days.filter((d) => d && d <= daysInMonth(y, m)).sort((a, b) => a - b).map((d) => ({ ...base, y, m, d }));
    } else if (r.FREQ === "YEARLY") {
      const y = base.y + i * interval;
      if (base.d <= daysInMonth(y, base.m)) cands = [{ ...base, y }];
    } else {
      yield ev.start.ms;
      return;
    }
    for (const c of cands) {
      if (toMs(ev, c) > toMsLimit) return;
      yield* emit(c);
      if (emitted === Infinity) return;
    }
  }
}

/** Laajentaa tapahtumat aikavälille [fromMs, toMs]. */
export function expand(parsed, fromMs, toMsLimit) {
  const overrides = new Map();
  for (const e of parsed.events) if (e.recurrenceId) overrides.set(`${e.uid}|${e.recurrenceId.ms}`, e);
  const out = [];
  for (const e of parsed.events) {
    if (e.recurrenceId) continue;
    const dur = e.end ? e.end.ms - e.start.ms : e.duration ?? (e.start.allDay ? DAY : 0);
    const ex = new Set(e.exdates);
    for (const s of occurrences(e, toMsLimit, fromMs)) {
      if (ex.has(s)) continue;
      const o = overrides.get(`${e.uid}|${s}`);
      if (o) continue; // poikkeus lisätään erikseen alla
      if (s + dur < fromMs && !(dur === 0 && s >= fromMs)) continue;
      out.push({ title: e.title || "(ei otsikkoa)", location: e.location || "", start: s, end: s + dur, allDay: e.start.allDay });
    }
  }
  for (const o of overrides.values()) {
    if (o.status === "CANCELLED") continue;
    const dur = o.end ? o.end.ms - o.start.ms : o.duration ?? 0;
    if (o.start.ms + dur < fromMs || o.start.ms > toMsLimit) continue;
    out.push({ title: o.title || "(ei otsikkoa)", location: o.location || "", start: o.start.ms, end: o.start.ms + dur, allDay: o.start.allDay });
  }
  return out.sort((a, b) => a.start - b.start || (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));
}

export function parseCalendars(envValue) {
  if (!envValue) return [];
  return envValue.split(",").map((s) => s.trim()).filter(Boolean).map((s, i) => {
    const [name, url] = s.includes("|") ? s.split("|") : [i === 0 ? "Kalenteri" : `Kalenteri ${i + 1}`, s];
    return { name: name.trim(), url: url.trim(), index: i };
  });
}

/** Hakee kalenterit ja palauttaa tulevat tapahtumat: 7 päivää + loppukuukausi (väh. 30 pv). */
export async function getCalendar(cals, now = Date.now()) {
  const tz = DEFAULT_TZ;
  const today = ymdInTz(now, tz);
  const [y, m, d] = today.split("-").map(Number);
  const startOfToday = localToUtc(y, m, d, 0, 0, 0, tz);
  const weekEnd = startOfToday + 7 * DAY;
  const monthEnd = localToUtc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, 0, 0, 0, tz);
  const horizon = Math.max(monthEnd, startOfToday + 31 * DAY);

  const stats = [];
  const results = await Promise.allSettled(cals.map(async (c) => {
    const res = await fetchWithTimeout(c.url, {}, 15000);
    if (!res.ok) throw new Error(`${c.name}: ${res.status}`);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error(`${c.name}: osoite ei palauttanut kalenteria`);
    const parsed = parseIcs(text);
    const list = expand(parsed, startOfToday, horizon).map((e) => ({ ...e, cal: c.name, color: c.index }));
    stats.push({ name: c.name, calName: parsed.calName || null, events: parsed.events.length, upcoming: list.length });
    return list;
  }));
  // Koko päivän tapahtumien päivät ovat UTC-keskiyöllä; muutetaan ne Suomen keskiyöksi,
  // muuten eilinen koko päivän tapahtuma näkyisi vielä tänään klo 2 asti (tai koko päivän).
  const local = (ms) => {
    const t = new Date(ms);
    return localToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 0, 0, 0, tz);
  };
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .map((e) => (e.allDay ? { ...e, ls: local(e.start), le: local(e.end) } : { ...e, ls: e.start, le: e.end }))
    .filter((e) => e.le > now)
    .sort((a, b) => a.ls - b.ls);
  const failed = results.map((r, i) => (r.status === "rejected" ? String(r.reason?.message || cals[i].name) : null)).filter(Boolean);
  // Koko päivän tapahtumille annetaan päivämäärä, jotta selain ei siirrä niitä aikavyöhykkeen takia.
  const iso = ({ ls, le, ...e }) => ({
    ...e,
    start: new Date(e.start).toISOString(),
    end: new Date(e.end).toISOString(),
    ...(e.allDay ? { date: new Date(e.start).toISOString().slice(0, 10), endDate: new Date(e.end).toISOString().slice(0, 10) } : {}),
  });
  return {
    week: events.filter((e) => e.ls < weekEnd).slice(0, 40).map(iso),
    later: events.filter((e) => e.ls >= weekEnd && e.ls < monthEnd).slice(0, 20).map(iso),
    // Jos kuukausi loppuu viikon sisällä, näytetään muutama seuraava tapahtuma ensi kuulta.
    next: monthEnd <= weekEnd ? events.filter((e) => e.ls >= weekEnd).slice(0, 6).map(iso) : [],
    monthEnd: new Date(monthEnd).toISOString(),
    calendars: cals.map((c) => c.name),
    stats,
    failed,
  };
}

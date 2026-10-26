import { parseXml } from "./xml.mjs";
import { fetchWithTimeout, helsinkiDate } from "./http.mjs";

const FMI = "https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=getFeature";

// Yhteinen säätilaluokitus kuvakkeille: clear, partly, cloudy, rain, snow, sleet, thunder, fog
export function fmiSymbol(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return null;
  if (c === 1) return "clear";
  if (c === 2) return "partly";
  if (c === 3) return "cloudy";
  if (c >= 21 && c <= 39) return "rain";
  if (c >= 41 && c <= 59) return "snow";
  if (c >= 61 && c <= 69) return "thunder";
  if (c >= 71 && c <= 89) return "sleet";
  if (c >= 91 && c <= 92) return "fog";
  return "cloudy";
}

export function wmoSymbol(code) {
  const c = Number(code);
  if (c === 0) return "clear";
  if (c === 1 || c === 2) return "partly";
  if (c === 3) return "cloudy";
  if (c === 45 || c === 48) return "fog";
  if (c === 56 || c === 57 || c === 66 || c === 67) return "sleet";
  if ((c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return "rain";
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
  if (c >= 95) return "thunder";
  return "cloudy";
}

export const SYMBOL_TEXT = {
  clear: "Selkeää",
  partly: "Puolipilvistä",
  cloudy: "Pilvistä",
  rain: "Sadetta",
  snow: "Lumisadetta",
  sleet: "Räntää",
  thunder: "Ukkosta",
  fog: "Sumua",
};

/** Muuntaa FMI:n "simple"-vastauksen { aika: { parametri: arvo } } -muotoon. */
export function parseFmiSimple(text) {
  const doc = parseXml(text);
  const members = [].concat(doc?.FeatureCollection?.member || []);
  const byTime = new Map();
  for (const m of members) {
    const el = m.BsWfsElement;
    if (!el) continue;
    const t = el.Time;
    const v = Number(el.ParameterValue);
    if (!byTime.has(t)) byTime.set(t, {});
    byTime.get(t)[el.ParameterName] = Number.isFinite(v) ? v : null;
  }
  return [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function fmiForecast(h) {
  const url =
    `${FMI}&storedquery_id=fmi::forecast::edited::weather::scandinavia::point::simple` +
    `&latlon=${h.lat},${h.lon}&timestep=60` +
    `&parameters=Temperature,WindSpeedMS,Precipitation1h,WeatherSymbol3,Humidity`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`FMI ennuste ${res.status}`);
  const rows = parseFmiSimple(await res.text());
  if (!rows.length) throw new Error("FMI ennuste tyhjä");
  return rows.map(([t, p]) => ({
    t,
    temp: p.Temperature,
    wind: p.WindSpeedMS,
    precip: p.Precipitation1h,
    symbol: fmiSymbol(p.WeatherSymbol3),
  }));
}

async function fmiObservation(h) {
  const start = new Date(Date.now() - 2 * 3600 * 1000).toISOString().slice(0, 19) + "Z";
  const url =
    `${FMI}&storedquery_id=fmi::observations::weather::simple&place=${encodeURIComponent(h.place)}` +
    `&starttime=${start}&timestep=10&parameters=t2m,ws_10min,rh`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`FMI havainto ${res.status}`);
  const rows = parseFmiSimple(await res.text()).filter(([, p]) => p.t2m !== null);
  if (!rows.length) return null;
  const [t, p] = rows[rows.length - 1];
  return { time: t, temp: p.t2m, wind: p.ws_10min, humidity: p.rh, source: `FMI havaintoasema, ${h.place}` };
}

async function openMeteo(h) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${h.lat}&longitude=${h.lon}` +
    `&hourly=temperature_2m,precipitation,wind_speed_10m,weather_code` +
    `&current=temperature_2m,wind_speed_10m,relative_humidity_2m` +
    `&wind_speed_unit=ms&timezone=UTC&forecast_days=6`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = await res.json();
  const hours = d.hourly.time.map((t, i) => ({
    t: t + ":00Z",
    temp: d.hourly.temperature_2m[i],
    wind: d.hourly.wind_speed_10m[i],
    precip: d.hourly.precipitation[i],
    symbol: wmoSymbol(d.hourly.weather_code[i]),
  }));
  const now = d.current
    ? { time: d.current.time + ":00Z", temp: d.current.temperature_2m, wind: d.current.wind_speed_10m, humidity: d.current.relative_humidity_2m, source: "Open-Meteo" }
    : null;
  return { hours, now };
}

function mostCommon(arr) {
  const c = {};
  let best = null;
  for (const s of arr) if (s) {
    c[s] = (c[s] || 0) + 1;
    if (!best || c[s] > c[best]) best = s;
  }
  return best;
}

export function summarizeDays(hours) {
  const days = new Map();
  for (const h of hours) {
    const key = helsinkiDate(new Date(h.t));
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(h);
  }
  return [...days.entries()].slice(0, 6).map(([date, hs]) => {
    const temps = hs.map((x) => x.temp).filter((x) => x !== null);
    // Päivän kuvake päiväsaikaan (klo 9–18) vallitsevasta säästä
    const daytime = hs.filter((x) => {
      const hr = Number(new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", hour: "2-digit", hour12: false }).format(new Date(x.t)));
      return hr >= 9 && hr <= 18;
    });
    return {
      date,
      min: temps.length ? Math.min(...temps) : null,
      max: temps.length ? Math.max(...temps) : null,
      precip: Math.round(hs.reduce((s, x) => s + (x.precip || 0), 0) * 10) / 10,
      symbol: mostCommon((daytime.length ? daytime : hs).map((x) => x.symbol)),
    };
  });
}

export async function getWeather(h) {
  let hours, now, source;
  try {
    hours = await fmiForecast(h);
    source = "Ilmatieteen laitos";
    now = await fmiObservation(h).catch(() => null);
  } catch (e) {
    const om = await openMeteo(h);
    hours = om.hours;
    now = om.now;
    source = "Open-Meteo (FMI ei vastannut)";
  }
  const nowMs = Date.now() - 3600 * 1000;
  const upcoming = hours.filter((x) => new Date(x.t).getTime() >= nowMs);
  if (!now && upcoming[0]) now = { time: upcoming[0].t, temp: upcoming[0].temp, wind: upcoming[0].wind, humidity: null, source: "ennuste" };
  if (now) now.symbol = upcoming[0]?.symbol || null;
  if (now?.symbol) now.text = SYMBOL_TEXT[now.symbol];
  return { source, place: h.place, now, hours: upcoming.slice(0, 25), days: summarizeDays(upcoming) };
}

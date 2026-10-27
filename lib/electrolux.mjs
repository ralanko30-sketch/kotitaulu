// Electrolux Group -kehittäjärajapinta (developer.electrolux.one).
// Avaimet: ELECTROLUX_API_KEY ja ELECTROLUX_REFRESH_TOKEN Netlifyn ympäristömuuttujissa.
// Refresh token vaihtuu joka uusinnassa, joten uusin tallennetaan Netlify Blobsiin.
import { env, fetchWithTimeout } from "./http.mjs";
import { store } from "./store.mjs";

const BASE = "https://api.developer.electrolux.one/api/v1";
const K_TOKEN = "electrolux/token";
const K_STATE = "electrolux/state";
const STATE_TTL = 2 * 60 * 1000;

export function configured() {
  return Boolean(env("ELECTROLUX_API_KEY") && env("ELECTROLUX_REFRESH_TOKEN"));
}

function jwtExp(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return p.exp ? p.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function refresh(refreshToken) {
  const res = await fetchWithTimeout(`${BASE}/token/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env("ELECTROLUX_API_KEY") },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.accessToken) {
    throw Object.assign(new Error(`Electrolux-tunnisteen uusinta epäonnistui (${res.status}${data.message ? `: ${data.message}` : ""})`), { status: res.status });
  }
  const exp = jwtExp(data.accessToken) || Date.now() + Number(data.expiresIn || 3600) * 1000;
  return { access: data.accessToken, refresh: data.refreshToken || refreshToken, exp };
}

async function accessToken(force = false) {
  const s = store();
  const seed = env("ELECTROLUX_REFRESH_TOKEN");
  let tok = await s.get(K_TOKEN, { type: "json" });
  // Jos ympäristömuuttujaan on vaihdettu uusi refresh token, aloitetaan siitä.
  if (!tok || tok.seed !== seed) tok = { seed, refresh: seed, access: null, exp: 0 };
  if (!force && tok.access && tok.exp - 60000 > Date.now()) return tok.access;
  try {
    const fresh = await refresh(tok.refresh);
    await s.setJSON(K_TOKEN, { seed, ...fresh });
    return fresh.access;
  } catch (e) {
    // Toinen pyyntö ehti ehkä uusia tunnisteen samaan aikaan: luetaan uudelleen.
    const again = await s.get(K_TOKEN, { type: "json" });
    if (again?.access && again.exp - 60000 > Date.now() && again.access !== tok.access) return again.access;
    throw e;
  }
}

async function api(method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt > 0);
    const res = await fetchWithTimeout(`${BASE}/${path}`, {
      method,
      headers: {
        "x-api-key": env("ELECTROLUX_API_KEY"),
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 429) throw new Error("Electroluxin kutsuraja täynnä, yritä hetken päästä");
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Electrolux ${path} ${res.status}${data?.message ? `: ${data.message}` : ""}`);
    return data;
  }
}

// Haetaan arvo usealla mahdollisella kentän nimellä, kirjainkoosta välittämättä.
function pick(obj, ...names) {
  if (!obj) return null;
  const lower = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

export function summarizePurifier(appliance, state) {
  const r = state?.properties?.reported || state?.reported || {};
  const num = (v) => (typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    id: appliance.applianceId,
    name: appliance.applianceName || "Ilmanpuhdistin",
    connected: String(state?.connectionState || "").toLowerCase() === "connected",
    pm1: num(pick(r, "PM1")),
    pm25: num(pick(r, "PM2_5", "PM25", "PM2_5_approximate")),
    pm10: num(pick(r, "PM10")),
    co2: num(pick(r, "CO2", "ECO2")),
    tvoc: num(pick(r, "TVOC")),
    temp: num(pick(r, "Temp", "Temperature")),
    humidity: num(pick(r, "Humidity", "Humi")),
    filterLife: num(pick(r, "FilterLife", "FilterLife_1")),
    fan: num(pick(r, "Fanspeed", "FanSpeed")),
    mode: pick(r, "Workmode", "WorkMode"),
    ionizer: pick(r, "Ionizer"),
    light: pick(r, "UILight", "UiLight"),
  };
}

function isPurifier(a) {
  const t = `${a.applianceType || ""} ${a.applianceName || ""}`.toUpperCase();
  return /PUR|AIR|A9/.test(t);
}

export async function getAir({ fresh = false } = {}) {
  if (!configured()) return { configured: false };
  const s = store();
  const cache = await s.get(K_STATE, { type: "json" });
  if (!fresh && cache && Date.now() - cache.at < STATE_TTL) return cache.data;
  try {
    const list = (await api("GET", "appliances")) || [];
    const wanted = env("ELECTROLUX_APPLIANCE_ID");
    const appliance = (wanted && list.find((a) => a.applianceId === wanted)) || list.find(isPurifier) || list[0];
    if (!appliance) return { configured: true, error: "Electrolux-tililtä ei löytynyt laitteita" };
    const state = await api("GET", `appliances/${encodeURIComponent(appliance.applianceId)}/state`);
    const data = {
      configured: true,
      purifier: summarizePurifier(appliance, state),
      others: list.filter((a) => a !== appliance).map((a) => ({ name: a.applianceName, type: a.applianceType })),
      updated: new Date().toISOString(),
    };
    await s.setJSON(K_STATE, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (cache) return { ...cache.data, stale: true, warning: e.message };
    throw e;
  }
}

const COMMANDS = {
  mode: (v) => (["Auto", "Manual", "PowerOff"].includes(v) ? { Workmode: v } : null),
  fan: (v) => (Number.isInteger(v) && v >= 1 && v <= 9 ? { Fanspeed: v } : null),
  ionizer: (v) => (typeof v === "boolean" ? { Ionizer: v } : null),
  light: (v) => (typeof v === "boolean" ? { UILight: v } : null),
};

export async function sendAir(id, action, value) {
  if (!configured()) throw new Error("Electrolux-avaimet puuttuvat");
  const make = COMMANDS[action];
  const cmd = make && make(value);
  if (!cmd) throw new Error("Tuntematon komento");
  await api("PUT", `appliances/${encodeURIComponent(id)}/command`, cmd);
  await store().delete(K_STATE);
  return { ok: true };
}

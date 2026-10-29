// FordConnect Query (Fordin virallinen, vain lukeva rajapinta).
// Endpointit vastaavat marq24/ha-fordconnect-query -integraation käyttämiä.
import crypto from "node:crypto";
import { env, fetchWithTimeout } from "./http.mjs";
import { store } from "./store.mjs";

const BASE = "https://api.vehicle.ford.com";
export const AUTHORIZE_URL = `${BASE}/fcon-public/v1/auth/init`;
export const TOKEN_URL = `${BASE}/dah2vb2cprod.onmicrosoft.com/oauth2/v2.0/token?p=B2C_1A_FCON_AUTHORIZE`;
const QUERY = `${BASE}/fcon-query/v1`;

const K_TOKEN = "ford/token";
const K_STATE = "ford/state";
const K_CACHE = "ford/telemetry";
const K_GARAGE = "ford/garage";
const CACHE_MS = 5 * 60 * 1000;

export function fordConfig(req) {
  const clientId = env("FORD_CLIENT_ID");
  const clientSecret = env("FORD_CLIENT_SECRET");
  const origin = env("URL") || (req ? new URL(req.url).origin : "");
  return { clientId, clientSecret, redirectUri: `${origin}/api/ford-callback`, configured: Boolean(clientId && clientSecret) };
}

export async function startLogin(req) {
  const cfg = fordConfig(req);
  // Ford hyväksyy state-arvoksi enintään 16 merkkiä.
  const state = crypto.randomBytes(8).toString("hex");
  await store().setJSON(K_STATE, { state, at: Date.now() });
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(cfg, params) {
  const body = new URLSearchParams({ ...params, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Ford token ${res.status}: ${data.error_description || data.error || "tuntematon virhe"}`);
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in || 300) - 30) * 1000,
    authorized_at: Date.now(),
  };
}

export async function finishLogin(req) {
  const cfg = fordConfig(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = await store().get(K_STATE, { type: "json" });
  if (!code) throw new Error(url.searchParams.get("error_description") || "Ford ei palauttanut koodia");
  if (!saved || saved.state !== state || Date.now() - saved.at > 15 * 60 * 1000) throw new Error("Kirjautumisen tunniste ei täsmää tai vanheni. Aloita uudelleen.");
  const token = await tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri });
  await store().setJSON(K_TOKEN, token);
  await store().delete(K_STATE);
  await store().delete(K_CACHE);
}

async function accessToken(cfg) {
  const s = store();
  const tok = await s.get(K_TOKEN, { type: "json" });
  if (!tok) return null;
  if (tok.expires_at > Date.now()) return tok.access_token;
  if (!tok.refresh_token) return null;
  const fresh = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: tok.refresh_token });
  fresh.refresh_token = fresh.refresh_token || tok.refresh_token;
  fresh.authorized_at = tok.authorized_at;
  await s.setJSON(K_TOKEN, fresh);
  return fresh.access_token;
}

const val = (m, k) => m?.[k]?.value ?? null;

const WHEELS = { FRONT_LEFT: "Etu vas.", FRONT_RIGHT: "Etu oik.", REAR_LEFT: "Taka vas.", REAR_RIGHT: "Taka oik.", INNER_REAR_LEFT: "Taka vas. sis.", INNER_REAR_RIGHT: "Taka oik. sis." };
const WHEEL_ORDER = Object.keys(WHEELS);

function tires(m) {
  const status = Object.fromEntries([].concat(m.tirePressureStatus || []).map((t) => [t.vehicleWheel, String(t.value || "").toUpperCase()]));
  return [].concat(m.tirePressure || [])
    .filter((t) => typeof t.value === "number" && t.vehicleWheel)
    .sort((a, b) => WHEEL_ORDER.indexOf(a.vehicleWheel) - WHEEL_ORDER.indexOf(b.vehicleWheel))
    .map((t) => ({
      wheel: WHEELS[t.vehicleWheel] || t.vehicleWheel,
      bar: Math.round(t.value) / 100, // kPa -> bar
      low: /LOW|ALERT|WARN/.test(status[t.vehicleWheel] || ""),
    }));
}

function carName(g) {
  if (!g) return "Auto";
  if (g.modelName) return `${g.modelName}${g.modelYear ? ` ${g.modelYear}` : ""}`;
  // "2023 Kuga - TD (CX482 EU)" -> "2023 Kuga"
  return String(g.vehicleType || "Auto").replace(/\s+-\s.*$/, "").replace(/\s*\(.*$/, "").trim() || "Auto";
}

export function summarize(telemetry, garage) {
  const m = telemetry?.metrics || {};
  const locks = [].concat(m.doorLockStatus || []);
  const allDoors = locks.find((d) => d.vehicleDoor === "ALL_DOORS") || locks[0];
  const pos = m.position?.value?.location;
  return {
    name: carName(garage),
    tireKeys: Object.keys(m).filter((k) => /tire|tyre|wheel/i.test(k)),
    engineType: garage?.engineType || null,
    soc: val(m, "xevBatteryStateOfCharge"),
    rangeKm: val(m, "xevBatteryRange") ?? val(m, "fuelRange"),
    batteryRangeKm: val(m, "xevBatteryRange"),
    fuelRangeKm: val(m, "fuelRange"),
    fuelLevel: val(m, "fuelLevel"),
    tires: tires(m),
    odometerKm: val(m, "odometer"),
    plug: val(m, "xevPlugChargerStatus"),
    charging: val(m, "xevBatteryChargeDisplayStatus"),
    minutesToFull: val(m, "xevBatteryTimeToFullCharge"),
    locked: allDoors ? String(allDoors.value).toUpperCase() === "LOCKED" : null,
    outsideTemp: val(m, "outsideTemperature"),
    position: pos && Number.isFinite(Number(pos.lat)) ? { lat: Number(pos.lat), lon: Number(pos.lon) } : null,
    updated: telemetry?.updateTime || null,
  };
}

async function apiGet(path, token) {
  const res = await fetchWithTimeout(`${QUERY}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (res.status === 401) throw Object.assign(new Error("Ford-valtuutus ei kelpaa"), { reauth: true });
  if (res.status === 429) throw new Error("Fordin rajapinnan kutsuraja täynnä, yritä hetken päästä");
  if (!res.ok) throw new Error(`Ford ${path} ${res.status}`);
  return res.json();
}

export async function getCar(req) {
  const cfg = fordConfig(req);
  if (!cfg.configured) return { configured: false };
  const s = store();
  const cache = await s.get(K_CACHE, { type: "json" });
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const token = await accessToken(cfg).catch(() => null);
  if (!token) return { configured: true, authorized: false };
  try {
    let garage = await s.get(K_GARAGE, { type: "json" });
    if (!garage) {
      const g = await apiGet("/garage", token);
      garage = Array.isArray(g) ? g[0] : g?.vehicles?.[0] || g;
      await s.setJSON(K_GARAGE, garage || {});
    }
    const telemetry = await apiGet("/telemetry", token);
    const data = { configured: true, authorized: true, car: summarize(telemetry, garage) };
    await s.setJSON(K_CACHE, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e.reauth) return { configured: true, authorized: false };
    if (cache) return { ...cache.data, stale: true, warning: e.message };
    throw e;
  }
}

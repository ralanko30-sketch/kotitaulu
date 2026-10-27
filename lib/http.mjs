import crypto from "node:crypto";

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export function env(name, fallback = undefined) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

// ---------- Kirjautuminen ----------
const COOKIE = "kt_session";
// Pitkä istunto, jotta seinänäyttö pysyy kirjautuneena.
const SESSION_DAYS = 180;

function secret() {
  const s = env("SESSION_SECRET");
  if (!s || s.length < 16) throw new Error("SESSION_SECRET puuttuu tai on liian lyhyt (väh. 16 merkkiä)");
  return s;
}

function hmac(text) {
  return crypto.createHmac("sha256", secret()).update(text).digest("base64url");
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function makeSessionCookie() {
  const exp = Date.now() + SESSION_DAYS * 86400 * 1000;
  const value = `${exp}.${hmac(String(exp))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function isAuthed(req) {
  const header = req.headers.get("cookie") || "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  try {
    return safeEqual(sig, hmac(exp));
  } catch {
    return false;
  }
}

/** Palauttaa 401-vastauksen jos käyttäjä ei ole kirjautunut, muuten null. */
export function guard(req) {
  return isAuthed(req) ? null : json({ error: "Kirjaudu sisään" }, 401);
}

// ---------- Ulkoiset haut ----------
export async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Kevyt muistivälimuisti lämpimälle funktio-instanssille.
const memo = new Map();
export async function cached(key, ttlMs, fn) {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  memo.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

// ---------- Sijainti ----------
export function home() {
  return {
    lat: Number(env("HOME_LAT", "61.0587")),
    lon: Number(env("HOME_LON", "28.1887")),
    place: env("HOME_PLACE", "Lappeenranta"),
  };
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function helsinkiDate(d) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

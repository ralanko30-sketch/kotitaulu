// Garmin Personal API: avaimen vaihto tunnisteeseen ja datan haku.
// Avain luetaan Netlifyn ympäristömuuttujasta GARMIN_API_KEY, se ei koskaan päädy selaimeen.
import { getStore } from "@netlify/blobs";

const TOKEN_URL =
  "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";
const BASE = process.env.GARMIN_API_BASE || "https://personal.connectapi.garmin.com";

function jwtExp(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(part, "base64").toString()).exp || 0;
  } catch {
    return 0;
  }
}

export async function getToken(force = false) {
  const store = getStore("garmin");
  if (!force) {
    const cached = await store.get("token", { type: "json" });
    // Käytetään tallennettua tunnistetta, jos sitä on jäljellä yli tunti
    if (cached && cached.exp * 1000 - Date.now() > 3600 * 1000) return cached.token;
  }
  const key = process.env.GARMIN_API_KEY;
  if (!key) throw new Error("GARMIN_API_KEY puuttuu Netlifyn asetuksista");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `ApiKey ${key.trim()}` },
  });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Tunnisteen haku epäonnistui (${res.status}): ${text.slice(0, 200)}`);

  let token = text;
  try {
    const j = JSON.parse(text);
    token = typeof j === "string" ? j : j.access_token || j.accessToken || j.token || text;
  } catch {}
  token = token.replace(/^"|"$/g, "");
  const exp = jwtExp(token) || Math.floor(Date.now() / 1000) + 23 * 3600;
  await store.setJSON("token", { token, exp });
  return token;
}

export async function garminGet(path, params = {}, retried = false) {
  const token = await getToken();
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (res.status === 401 && !retried) {
    await getToken(true);
    return garminGet(path, params, true);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// Binääritiedoston (esim. treenin ZIP/FIT) lataus
export async function garminGetBytes(path, retried = false) {
  const token = await getToken();
  const res = await fetch(new URL(path, BASE), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/x-zip-compressed, application/octet-stream, */*" },
  });
  if (res.status === 401 && !retried) {
    await getToken(true);
    return garminGetBytes(path, true);
  }
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

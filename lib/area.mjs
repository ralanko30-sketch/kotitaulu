import { parseXml } from "./xml.mjs";
import { fetchWithTimeout, distanceKm } from "./http.mjs";


// ---------- Ilmatieteen laitoksen varoitukset (CAP) ----------

function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function parsePolygon(s) {
  return String(s)
    .trim()
    .split(/\s+/)
    .map((p) => p.split(",").map(Number))
    .filter((p) => p.length === 2 && p.every(Number.isFinite));
}

const COLOR_FI = { yellow: "keltainen", orange: "oranssi", red: "punainen", green: "vihreä" };

export function parseWarnings(text, h, now = Date.now()) {
  const doc = parseXml(text);
  const entries = [].concat(doc?.feed?.entry || []);
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    const alert = e?.content?.alert;
    if (!alert || alert.msgType === "Cancel") continue;
    const infos = [].concat(alert.info || []);
    const info = infos.find((i) => String(i.language).startsWith("fi")) || infos[0];
    if (!info) continue;
    const expires = info.expires ? new Date(info.expires).getTime() : Infinity;
    if (expires < now) continue;
    const areas = [].concat(info.area || []);
    const hit = areas.find((a) => [].concat(a.polygon || []).some((p) => pointInPolygon(h.lat, h.lon, parsePolygon(p))));
    if (!hit) continue;
    const params = [].concat(info.parameter || []);
    const color = params.find((p) => p.valueName === "color")?.value;
    const key = `${info.event}|${info.onset}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      event: info.event,
      headline: info.headline,
      description: info.description,
      color: color || null,
      colorText: COLOR_FI[color] || null,
      onset: info.onset || null,
      expires: info.expires || null,
      area: hit.areaDesc,
    });
  }
  out.sort((a, b) => (a.onset || "").localeCompare(b.onset || ""));
  return out;
}

export async function getWarnings(h) {
  const res = await fetchWithTimeout("https://alerts.fmi.fi/cap/feed/atom_fi-FI.xml");
  if (!res.ok) throw new Error(`varoitukset ${res.status}`);
  return parseWarnings(await res.text(), h);
}

// ---------- Fintraffic / Digitraffic liikennetiedotteet ----------

function flattenCoords(geom) {
  if (!geom) return [];
  const out = [];
  const walk = (c) => {
    if (typeof c[0] === "number") out.push(c);
    else c.forEach(walk);
  };
  if (geom.type === "GeometryCollection") geom.geometries.forEach((g) => out.push(...flattenCoords(g)));
  else if (geom.coordinates) walk(geom.coordinates);
  return out;
}

const TYPE_FI = {
  TRAFFIC_ANNOUNCEMENT: "Liikennetiedote",
  ROAD_WORK: "Tietyö",
  EXEMPTED_TRANSPORT: "Erikoiskuljetus",
  WEIGHT_RESTRICTION: "Painorajoitus",
};

export function parseTraffic(data, h, radiusKm) {
  const out = [];
  for (const f of data?.features || []) {
    const coords = flattenCoords(f.geometry);
    if (!coords.length) continue;
    const dist = Math.min(...coords.map(([lon, lat]) => distanceKm(h.lat, h.lon, lat, lon)));
    if (dist > radiusKm) continue;
    const p = f.properties || {};
    const a = [].concat(p.announcements || [])[0] || {};
    out.push({
      id: p.situationId,
      type: TYPE_FI[p.situationType] || "Tiedote",
      title: a.title || "",
      where: a.location?.description || "",
      start: a.timeAndDuration?.startTime || p.releaseTime || null,
      end: a.timeAndDuration?.endTime || null,
      distanceKm: Math.round(dist),
    });
  }
  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return out;
}

export async function getTraffic(h, radiusKm) {
  const types = ["TRAFFIC_ANNOUNCEMENT", "ROAD_WORK"];
  const results = await Promise.all(
    types.map(async (t) => {
      const res = await fetchWithTimeout(
        `https://tie.digitraffic.fi/api/traffic-message/v1/messages?inactiveHours=0&includeAreaGeometry=false&situationType=${t}`,
        { headers: { "Digitraffic-User": "Kotitaulu/1.0", "Accept-Encoding": "gzip" } },
        15000
      );
      if (!res.ok) throw new Error(`liikenne ${res.status}`);
      // Tietöitä on paljon, joten niistä näytetään vain aivan lähimmät.
      return parseTraffic(await res.json(), h, t === "ROAD_WORK" ? Math.min(radiusKm, 15) : radiusKm);
    })
  );
  const seen = new Set();
  return results
    .flat()
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .slice(0, 12);
}

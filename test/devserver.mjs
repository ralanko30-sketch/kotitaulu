// Paikallinen esikatselu esimerkkidatalla: KT_LOCAL=1 node test/devserver.mjs  →  http://localhost:8888
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

process.env.KT_LOCAL = "1";
process.env.SESSION_SECRET ||= "esikatselu-salaisuus-123456";
process.env.SITE_PASSWORD ||= "demo";
process.env.AGENT_KEY ||= "esikatselu-agenttiavain-123456";
process.env.FORD_CLIENT_ID ||= "demo";
process.env.FORD_CLIENT_SECRET ||= "demo";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const now = Date.now();
const hour = (h) => new Date(Math.floor(now / 3600000) * 3600000 + h * 3600000).toISOString();

// Esimerkkivastaukset ulkoisille palveluille
globalThis.fetch = async (url) => {
  url = String(url);
  const xmlRes = (s) => new Response(s, { status: 200 });
  if (url.includes("fmi::forecast")) {
    let rows = "";
    for (let h = 0; h < 30; h++) {
      const t = hour(h);
      const hr = (new Date(t).getUTCHours() + 2) % 24;
      const temp = -1.5 + 3.5 * Math.sin(((hr - 9) / 24) * 2 * Math.PI) - h * 0.08;
      const sym = h > 14 && h < 19 ? 41 : h > 3 && h < 8 ? 2 : 3;
      const pr = sym === 41 ? 0.4 + (h % 3) * 0.3 : 0;
      for (const [p, v] of [["Temperature", temp.toFixed(1)], ["WindSpeedMS", "5"], ["Precipitation1h", pr.toFixed(1)], ["WeatherSymbol3", sym], ["Humidity", 90]])
        rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>${p}</BsWfs:ParameterName><BsWfs:ParameterValue>${v}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
    }
    for (let h = 30; h < 130; h += 1) {
      const t = hour(h);
      const temp = -4 + Math.sin(h / 7) * 4;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>Temperature</BsWfs:ParameterName><BsWfs:ParameterValue>${temp.toFixed(1)}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>WeatherSymbol3</BsWfs:ParameterName><BsWfs:ParameterValue>${[1, 2, 3, 51, 31][Math.floor(h / 24) % 5]}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>Precipitation1h</BsWfs:ParameterName><BsWfs:ParameterValue>${Math.floor(h / 24) % 5 >= 3 ? "0.3" : "0"}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
    }
    return xmlRes(`<wfs:FeatureCollection>${rows}</wfs:FeatureCollection>`);
  }
  if (url.includes("fmi::observations"))
    return xmlRes(`<wfs:FeatureCollection>${[["t2m", "-2.3"], ["ws_10min", "4.2"], ["rh", "93"]].map(([p, v]) => `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${hour(0)}</BsWfs:Time><BsWfs:ParameterName>${p}</BsWfs:ParameterName><BsWfs:ParameterValue>${v}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`).join("")}</wfs:FeatureCollection>`);
  if (url.includes("alerts.fmi.fi"))
    return xmlRes(`<feed><entry><content><alert><msgType>Alert</msgType><info><language>fi-FI</language><event>Liukkaan kelin varoitus</event><onset>${hour(2)}</onset><expires>${hour(14)}</expires><description>Tiet ja kadut voivat olla iltayöstä liukkaita.</description><parameter><valueName>color</valueName><value>yellow</value></parameter><area><areaDesc>Etelä-Karjala</areaDesc><polygon>60.8,27.6 61.4,27.6 61.4,28.9 60.8,28.9 60.8,27.6</polygon></area></info></alert></content></entry></feed>`);
  if (url.includes("traffic-message")) {
    const rw = url.includes("ROAD_WORK");
    return new Response(JSON.stringify({ features: rw
      ? [{ geometry: { type: "Point", coordinates: [28.17, 61.05] }, properties: { situationId: "R1", situationType: "ROAD_WORK", announcements: [{ title: "Valtatie 13, Lappeenranta. Tietyö.", location: { description: "Kaukaantie, kaistajärjestelyjä" }, timeAndDuration: { startTime: hour(-200), endTime: hour(300) } }] } }]
      : [{ geometry: { type: "Point", coordinates: [28.45, 61.12] }, properties: { situationId: "T1", situationType: "TRAFFIC_ANNOUNCEMENT", announcements: [{ title: "Valtatie 6, Joutseno. Liikenneonnettomuus.", location: { description: "Joutsenon kohdalla, liikenne ohjataan kiertotielle" }, timeAndDuration: { startTime: hour(-1) } }] } }] }), { status: 200 });
  }
  if (url.includes("yle.fi/rss")) {
    const items = [
      ["Lappeenrannan keskustan katutyöt valmistuvat ennen joulua", 0.6],
      ["Hallitus esittää muutoksia asumistukeen", 1.4],
      ["Saimaan jäätilanne: ensimmäiset rantajäät muodostuneet", 2.2],
      ["Tutkimus: kotitalouksien sähkönkulutus laski syksyllä", 3.1],
      ["Imatralla avautuu uusi uimahalli tammikuussa", 4.8],
      ["Talvirenkaat alle viimeistään tällä viikolla, muistuttaa Fintraffic", 6.3],
    ];
    return xmlRes(`<rss><channel>${items.map(([t, h], i) => `<item><title>${t}</title><link>https://yle.fi/a/demo-${i}</link><pubDate>${new Date(now - h * 3600000).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`);
  }
  if (url.includes("/fcon-query/v1/garage")) return new Response(JSON.stringify([{ vehicleType: "Mustang Mach-E", engineType: "BEV" }]));
  if (url.includes("/fcon-query/v1/telemetry"))
    return new Response(JSON.stringify({ updateTime: new Date(now - 7 * 60000).toISOString(), metrics: {
      xevBatteryStateOfCharge: { value: 64 }, xevBatteryRange: { value: 238 }, odometer: { value: 18342 },
      xevPlugChargerStatus: { value: "CONNECTED" }, xevBatteryChargeDisplayStatus: { value: "IN_PROGRESS" }, xevBatteryTimeToFullCharge: { value: 135 },
      doorLockStatus: [{ vehicleDoor: "ALL_DOORS", value: "LOCKED" }], position: { value: { location: { lat: 61.0587, lon: 28.1887 } } } } }));
  return new Response("not mocked", { status: 599 });
};

const fnMap = {
  "/api/login": "login", "/api/weather": "weather", "/api/news": "news", "/api/area": "area",
  "/api/ford": "ford", "/api/ford-login": "ford-login", "/api/ford-callback": "ford-callback",
  "/api/cams": "cams", "/api/energy": "energy", "/api/upload": "upload",
};

// Esimerkkidata säilöön: kamerat, sähkö ja Ford-token
const { store } = await import("../lib/store.mjs");
const s = store();
await s.setJSON("ford/token", { access_token: "demo", refresh_token: "demo", expires_at: now + 86400000 });
const camDir = process.env.DEMO_CAMS;
const camNames = [["etupiha", "Etupiha", 2], ["autokatos", "Autokatos", 3], ["takapiha", "Takapiha", 45]];
const index = {};
for (const [id, name, minAgo] of camNames) {
  const file = camDir ? path.join(camDir, `${id}.jpg`) : null;
  if (file) await s.set(`cam/${id}`, await fs.readFile(file), { metadata: { name } });
  index[id] = { name, takenAt: new Date(now - minAgo * 60000).toISOString() };
}
await s.setJSON("cam-index", index);
await s.setJSON("heartbeat", { at: new Date(now - 60000).toISOString() });
const daily = [];
for (let d = 25; d >= 1; d--) {
  const dt = new Date(now - d * 86400000);
  daily.push({ date: dt.toISOString().slice(0, 10), kwh: Math.round((14 + Math.sin(d / 2) * 4 + (d % 7 === 1 ? 6 : 0)) * 10) / 10 });
}
await s.setJSON("energy", { daily, hourly: [], receivedAt: new Date(now - 3 * 3600000).toISOString() });

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

http.createServer(async (nreq, nres) => {
  const url = new URL(nreq.url, "http://localhost:8888");
  const chunks = [];
  for await (const c of nreq) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  let name = fnMap[url.pathname];
  let context = {};
  if (url.pathname.startsWith("/api/cam/")) { name = "cam"; context = { params: { id: url.pathname.split("/").pop() } }; }
  if (name) {
    const { default: handler } = await import(`../netlify/functions/${name}.mjs`);
    const headers = { ...nreq.headers };
    const r = await handler(new Request(url, { method: nreq.method, headers, body: ["GET", "HEAD"].includes(nreq.method) ? undefined : body }), context);
    const h = Object.fromEntries(r.headers);
    // Paikallisesti ei ole HTTPS:ää, joten Secure-lippu pois esikatselusta.
    if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].replace("; Secure", "");
    nres.writeHead(r.status, h);
    nres.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const file = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
  try {
    const data = await fs.readFile(file);
    nres.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    nres.end(data);
  } catch {
    nres.writeHead(404);
    nres.end("not found");
  }
}).listen(8888, () => console.log("Esikatselu: http://localhost:8888 (salasana: demo)"));

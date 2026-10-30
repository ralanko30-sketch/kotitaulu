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
process.env.HOME_LAT ||= "60.4879";
process.env.GCAL_ICS ||= "Oma|https://calendar.google.com/demo/oma.ics,Perhe|https://calendar.google.com/demo/perhe.ics";
process.env.ELECTROLUX_API_KEY ||= "demo";
process.env.ELECTROLUX_REFRESH_TOKEN ||= "demo";
process.env.HOME_LON ||= "25.0735";
process.env.HOME_PLACE ||= "Järvenpää";

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
    for (let h = 30; h < 172; h += 1) {
      const t = hour(h);
      const temp = -4 + Math.sin(h / 7) * 4;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>Temperature</BsWfs:ParameterName><BsWfs:ParameterValue>${temp.toFixed(1)}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>WeatherSymbol3</BsWfs:ParameterName><BsWfs:ParameterValue>${[1, 2, 3, 51, 31][Math.floor(h / 24) % 5]}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>Precipitation1h</BsWfs:ParameterName><BsWfs:ParameterValue>${Math.floor(h / 24) % 5 >= 3 && h % 4 === 0 ? "0.6" : "0"}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
      rows += `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>WindSpeedMS</BsWfs:ParameterName><BsWfs:ParameterValue>${(3 + (h % 7) * 0.6).toFixed(1)}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`;
    }
    return xmlRes(`<wfs:FeatureCollection>${rows}</wfs:FeatureCollection>`);
  }
  if (url.includes("fmi::observations"))
    return xmlRes(`<wfs:FeatureCollection>${[["t2m", "-2.3"], ["ws_10min", "4.2"], ["rh", "93"]].map(([p, v]) => `<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>${hour(0)}</BsWfs:Time><BsWfs:ParameterName>${p}</BsWfs:ParameterName><BsWfs:ParameterValue>${v}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`).join("")}</wfs:FeatureCollection>`);
  if (url.includes("alerts.fmi.fi"))
    return xmlRes(`<feed><entry><content><alert><msgType>Alert</msgType><info><language>fi-FI</language><event>Liukkaan kelin varoitus</event><onset>${hour(2)}</onset><expires>${hour(14)}</expires><description>Tiet ja kadut voivat olla iltayöstä liukkaita.</description><parameter><valueName>color</valueName><value>yellow</value></parameter><area><areaDesc>Uusimaa</areaDesc><polygon>60.2,24.6 60.8,24.6 60.8,25.6 60.2,25.6 60.2,24.6</polygon></area></info></alert></content></entry></feed>`);
  if (url.includes("traffic-message")) {
    const rw = url.includes("ROAD_WORK");
    return new Response(JSON.stringify({ features: rw
      ? [{ geometry: { type: "Point", coordinates: [25.08, 60.47] }, properties: { situationId: "R1", situationType: "ROAD_WORK", announcements: [{ title: "Seututie 145, Järvenpää. Tietyö.", location: { description: "Helsingintie, kaistajärjestelyjä" }, timeAndDuration: { startTime: hour(-200), endTime: hour(300) } }] } }]
      : [{ geometry: { type: "Point", coordinates: [25.10, 60.50] }, properties: { situationId: "T1", situationType: "TRAFFIC_ANNOUNCEMENT", announcements: [{ title: "Vt 4, Järvenpää. Liikenneonnettomuus.", location: { description: "Järvenpään eteläisen liittymän kohdalla, vasen kaista suljettu" }, timeAndDuration: { startTime: hour(-1) } }] } }] }), { status: 200 });
  }
  if (url.includes("yle.fi/rss")) {
    const items = [
      ["Järvenpään keskustan katutyöt valmistuvat ennen joulua", 0.6],
      ["Hallitus esittää muutoksia asumistukeen", 1.4],
      ["Saimaan jäätilanne: ensimmäiset rantajäät muodostuneet", 2.2],
      ["Tutkimus: kotitalouksien sähkönkulutus laski syksyllä", 3.1],
      ["Keravalla avautuu uusi uimahalli tammikuussa", 4.8],
      ["Tuusulanjärven jääpeite muodostuu tavallista myöhemmin", 7.2],
      ["Junaliikenteessä häiriöitä pääradalla aamulla", 8.1],
      ["Asuntojen hinnat laskivat Uudellamaalla syyskuussa", 9.4],
      ["Talvirenkaat alle viimeistään tällä viikolla, muistuttaa Fintraffic", 6.3],
    ];
    return xmlRes(`<rss><channel>${items.map(([t, h], i) => `<item><title>${t}</title><link>https://yle.fi/a/demo-${i}</link><pubDate>${new Date(now - h * 3600000).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`);
  }
  if (url.includes("calendar.google.com/demo")) {
    const perhe = url.includes("perhe");
    const pad = (n) => String(n).padStart(2, "0");
    const loc = (dayOff, h, mi) => {
      const d = new Date(Date.now() + dayOff * 86400000);
      const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(d).replaceAll("-", "");
      return `${ymd}T${pad(h)}${pad(mi)}00`;
    };
    const dOnly = (off) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki" }).format(new Date(Date.now() + off * 86400000)).replaceAll("-", "");
    const ev = (uid, s, e, sum, extra = "") => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;TZID=Europe/Helsinki:${s}\r\nDTEND;TZID=Europe/Helsinki:${e}\r\nSUMMARY:${sum}\r\n${extra}END:VEVENT\r\n`;
    const body = perhe
      ? ev("p1", loc(0, 17, 30), loc(0, 18, 30), "Lasten uintikoulu", "LOCATION:Järvenpään uimahalli\r\n") +
        `BEGIN:VEVENT\r\nUID:p2\r\nDTSTART;VALUE=DATE:${dOnly(2)}\r\nDTEND;VALUE=DATE:${dOnly(3)}\r\nSUMMARY:Pyhäinpäivä\r\nEND:VEVENT\r\n` +
        ev("p3", loc(5, 12, 0), loc(5, 15, 0), "Mummolan synttärit", "LOCATION:Tuusula\r\n")
      : ev("o1", loc(0, 8, 0), loc(0, 8, 30), "Aamupalaveri") +
        ev("o2", loc(1, 16, 0), loc(1, 17, 0), "Hammaslääkäri", "LOCATION:Järvenpää\r\n") +
        ev("o3", loc(3, 10, 0), loc(3, 11, 30), "Auton talvirenkaat", "LOCATION:Rengasliike\r\n") +
        ev("o4", loc(9, 18, 0), loc(9, 19, 0), "Taloyhtiön kokous") +
        ev("o5", loc(14, 9, 0), loc(14, 10, 0), "Vuosihuolto, ilmalämpöpumppu");
    return new Response(`BEGIN:VCALENDAR\r\nX-WR-TIMEZONE:Europe/Helsinki\r\n${body}END:VCALENDAR\r\n`);
  }
  if (url.includes("electrolux.one/api/v1/token/refresh"))
    return new Response(JSON.stringify({ accessToken: "x." + Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 3600 })).toString("base64url") + ".y", refreshToken: "demo2" }));
  if (url.endsWith("electrolux.one/api/v1/appliances")) return new Response(JSON.stringify([{ applianceId: "A9", applianceName: "Pure A9 olohuone", applianceType: "PUREA9" }]));
  if (url.includes("electrolux.one/api/v1/appliances/A9/state"))
    return new Response(JSON.stringify({ connectionState: "Connected", properties: { reported: { PM1: 2, PM2_5: 4, PM10: 6, CO2: 640, TVOC: 52, Temp: 21.6, Humidity: 34, FilterLife: 82, Fanspeed: 3, Workmode: "Auto" } } }));
  if (url.includes("/fcon-query/v1/garage")) return new Response(JSON.stringify([{ vehicleType: "2023 Kuga - TD (CX482 EU)", modelName: "Kuga - TD (CX482 EU)", modelYear: "2023", engineType: "PHEV" }]));
  if (url.includes("/fcon-query/v1/telemetry"))
    return new Response(JSON.stringify({ updateTime: new Date(now - 7 * 60000).toISOString(), metrics: {
      xevBatteryStateOfCharge: { value: 100 }, xevBatteryRange: { value: 238 }, odometer: { value: 18342 },
      xevPlugChargerStatus: { value: "CONNECTED" }, xevBatteryChargeDisplayStatus: { value: "COMPLETED" }, xevBatteryTimeToFullCharge: { value: 135 },
      doorLockStatus: [{ vehicleDoor: "ALL_DOORS", value: "UNLOCKED" }], position: { value: { location: { lat: 61.0587, lon: 28.1887 } } }, fuelLevel: { value: 30.87 }, fuelRange: { value: 212.6 }, xevBatteryRange: { value: 45.8 }, tirePressure: [{ vehicleWheel: "FRONT_LEFT", value: 240 }, { vehicleWheel: "FRONT_RIGHT", value: 238 }, { vehicleWheel: "REAR_LEFT", value: 226 }, { vehicleWheel: "REAR_RIGHT", value: 241 }], tirePressureStatus: [{ vehicleWheel: "REAR_LEFT", value: "LOW" }] } }));
  return new Response("not mocked", { status: 599 });
};

const fnMap = {
  "/api/login": "login", "/api/weather": "weather", "/api/news": "news", "/api/area": "area",
  "/api/ford": "ford", "/api/ford-login": "ford-login", "/api/ford-callback": "ford-callback",
  "/api/cams": "cams", "/api/air": "air", "/api/hp": "hp", "/api/calendar": "calendar", "/api/energy": "energy", "/api/upload": "upload",
};

// Esimerkkidata säilöön: kamerat, sähkö ja Ford-token
const { store } = await import("../lib/store.mjs");
const s = store();
await s.setJSON("ford/token", { access_token: "demo", refresh_token: "demo", expires_at: now + 86400000 });
const camDir = process.env.DEMO_CAMS;
const camNames = [["autokatos", "Autokatos", 2], ["takapiha", "Takapiha", 3]];
const index = {};
for (const [id, name, minAgo] of camNames) {
  const file = camDir ? path.join(camDir, `${id}.jpg`) : null;
  if (file) await s.set(`cam/${id}`, await fs.readFile(file), { metadata: { name } });
  index[id] = { name, takenAt: new Date(now - minAgo * 60000).toISOString() };
}
index.takapiha.event = "henkilö";
index.takapiha.takenAt = new Date(now - 60000).toISOString();
index.takapiha.lastEvent = { kind: "henkilö", at: index.takapiha.takenAt };
index.autokatos.lastEvent = { kind: "liike", at: new Date(now - 47 * 60000).toISOString() };
await s.setJSON("cam-index", index);
const evs = [["takapiha", "henkilö", 1], ["autokatos", "liike", 47], ["takapiha", "liike", 95], ["takapiha", "henkilö", 260]];
const evList = [];
for (const [cam, kind, min] of evs) {
  const key = `${cam}-${now - min * 60000}`;
  if (camDir) await s.set(`ev/${key}`, await fs.readFile(path.join(camDir, `${cam}.jpg`)));
  evList.push({ key, cam, name: cam, kind, at: new Date(now - min * 60000).toISOString() });
}
await s.setJSON("events", evList);
await s.setJSON("heartbeat", { at: new Date(now - 60000).toISOString() });
await s.setJSON("heatpump", { name: "Ilmalämpöpumppu", state: { on: true, mode: 1, modeText: "Lämmitys", target: 21, room: 20.5, fan: 0, fanText: "Automaatti" }, executed: [], receivedAt: new Date(now - 90000).toISOString() });
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
  if (url.pathname.startsWith("/api/event/")) { name = "event"; context = { params: { key: url.pathname.split("/").pop() } }; }
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

// Ajetaan: KT_LOCAL=1 node test/run.mjs
// Testaa jäsentimet ja funktiot simuloiduilla vastauksilla (ei verkkoa).
import assert from "node:assert/strict";

process.env.KT_LOCAL = "1";
process.env.SESSION_SECRET = "testisalaisuus-1234567890";
process.env.SITE_PASSWORD = "salasana";
process.env.AGENT_KEY = "agenttiavain-123456789012345";
process.env.URL = "https://kotitaulu.example";

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log("ok  ", name);
  } catch (e) {
    console.error("FAIL", name, "\n", e);
    process.exitCode = 1;
  }
};

// ---------- Simuloitu fetch ----------
const routes = [];
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  calls.push({ url, opts });
  for (const [match, handler] of routes) if (url.includes(match)) return handler(url, opts);
  return new Response("not mocked: " + url, { status: 599 });
};
const route = (m, h) => routes.unshift([m, h]);
const text = (s, status = 200) => () => new Response(s, { status });
const jsonRes = (o, status = 200) => () => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

// ---------- Testidata ----------
const now = Date.now();
const hourIso = (h) => new Date(Math.floor(now / 3600000) * 3600000 + h * 3600000).toISOString().replace(".000", "");
const wfs = (rows) => `<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">
${rows.map(([t, p, v]) => `<wfs:member><BsWfs:BsWfsElement gml:id="x"><BsWfs:Location><gml:Point><gml:pos>61.05 28.18 </gml:pos></gml:Point></BsWfs:Location><BsWfs:Time>${t}</BsWfs:Time><BsWfs:ParameterName>${p}</BsWfs:ParameterName><BsWfs:ParameterValue>${v}</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>`).join("\n")}
</wfs:FeatureCollection>`;

const forecastRows = [];
for (let h = 0; h < 30; h++) {
  const t = hourIso(h);
  forecastRows.push([t, "Temperature", (-3 + h * 0.3).toFixed(1)], [t, "WindSpeedMS", "4.0"], [t, "Precipitation1h", h === 5 ? "0.8" : "0.0"], [t, "WeatherSymbol3", h === 5 ? "31" : "3"], [t, "Humidity", "88"]);
}
const obsRows = [[hourIso(-1), "t2m", "-2.4"], [hourIso(-1), "ws_10min", "3.1"], [hourIso(-1), "rh", "91"], [hourIso(0), "t2m", "NaN"], [hourIso(0), "ws_10min", "NaN"], [hourIso(0), "rh", "NaN"]];

const cap = (polygon, msgType = "Alert", expires = new Date(now + 86400000).toISOString()) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>FMI</title>
<entry><title>Keltainen tuulivaroitus</title><content type="application/cap+xml">
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>1</identifier><msgType>${msgType}</msgType>
<info><language>fi-FI</language><event>Tuulivaroitus maa-alueille</event><severity>Moderate</severity>
<onset>${new Date(now).toISOString()}</onset><expires>${expires}</expires><headline>Keltainen tuulivaroitus</headline>
<description>Puuskat 20 m/s.</description><parameter><valueName>color</valueName><value>yellow</value></parameter>
<area><areaDesc>Etelä-Karjala</areaDesc><polygon>${polygon}</polygon></area></info>
<info><language>sv-FI</language><event>Vindvarning</event><area><areaDesc>Södra Karelen</areaDesc><polygon>${polygon}</polygon></area></info>
</alert></content></entry></feed>`;
const polyHome = "60.8,27.6 61.4,27.6 61.4,28.9 60.8,28.9 60.8,27.6";
const polyFar = "60.0,24.0 60.4,24.0 60.4,25.0 60.0,25.0 60.0,24.0";

const traffic = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [28.2, 61.06] }, properties: { situationId: "A1", situationType: "TRAFFIC_ANNOUNCEMENT", announcements: [{ title: "Tie 6, Lappeenranta. Onnettomuus.", location: { description: "Tie 6 välillä X–Y" }, timeAndDuration: { startTime: "2026-10-26T10:00:00Z" } }] } },
    { type: "Feature", geometry: { type: "MultiLineString", coordinates: [[[24.9, 60.2], [24.95, 60.21]]] }, properties: { situationId: "B2", situationType: "TRAFFIC_ANNOUNCEMENT", announcements: [{ title: "Helsinki" }] } },
    { type: "Feature", geometry: null, properties: { situationId: "C3" } },
  ],
};

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Yle</title>
<item><title>Uutinen 1</title><link>https://yle.fi/a/1</link><pubDate>Mon, 26 Oct 2026 10:00:00 +0200</pubDate></item>
<item><title>Uutinen 2</title><link>https://yle.fi/a/2</link><pubDate>Mon, 26 Oct 2026 11:00:00 +0200</pubDate></item>
</channel></rss>`;

// ---------- Apufunktiot ----------
const fn = async (name) => (await import(`../netlify/functions/${name}.mjs`)).default;
const req = (path, opts = {}) => new Request("https://kotitaulu.example" + path, opts);
let cookie = "";
const authed = (path, opts = {}) => req(path, { ...opts, headers: { ...(opts.headers || {}), cookie } });

// ---------- Testit ----------
await test("XML-jäsennin: FMI simple", async () => {
  const { parseFmiSimple } = await import("../lib/weather.mjs");
  const rows = parseFmiSimple(wfs(forecastRows.slice(0, 10)));
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1].Temperature, -3);
  assert.equal(rows[0][1].WeatherSymbol3, 3);
});

await test("Kirjautuminen: väärä salasana hylätään", async () => {
  const login = await fn("login");
  const r = await login(req("/api/login", { method: "POST", body: JSON.stringify({ password: "väärä" }) }));
  assert.equal(r.status, 401);
});

await test("Kirjautuminen: suojattu rajapinta vaatii evästeen", async () => {
  const weather = await fn("weather");
  assert.equal((await weather(req("/api/weather"))).status, 401);
});

await test("Kirjautuminen: oikea salasana antaa evästeen", async () => {
  const login = await fn("login");
  const r = await login(req("/api/login", { method: "POST", body: JSON.stringify({ password: "salasana" }) }));
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /HttpOnly/);
  cookie = sc.split(";")[0];
  const check = await login(authed("/api/login"));
  assert.equal((await check.json()).authed, true);
});

await test("Kirjautuminen: väärennetty eväste hylätään", async () => {
  const weather = await fn("weather");
  const fake = cookie.replace(/\.[^.]+$/, ".väärä");
  assert.equal((await weather(req("/api/weather", { headers: { cookie: fake } }))).status, 401);
});

await test("Sää: FMI-ennuste ja havainto", async () => {
  route("fmi::forecast::edited", text(wfs(forecastRows)));
  route("fmi::observations", text(wfs(obsRows)));
  const weather = await fn("weather");
  const w = await (await weather(authed("/api/weather"))).json();
  assert.equal(w.source, "Ilmatieteen laitos");
  assert.equal(w.now.temp, -2.4, "viimeisin kelvollinen havainto (NaN ohitetaan)");
  assert.equal(w.now.humidity, 91);
  assert.ok(w.hours.length >= 24 && w.hours.length <= 25);
  assert.ok(w.days.length >= 2);
  assert.ok(w.days[0].max >= w.days[0].min);
  assert.equal(w.hours[5].symbol, "rain");
});

await test("Sää: varalähde Open-Meteo kun FMI ei vastaa", async () => {
  const { getWeather } = await import("../lib/weather.mjs");
  route("fmi::forecast::edited", text("virhe", 503));
  const t = new Date(Math.floor(now / 3600000) * 3600000).toISOString().slice(0, 16);
  route("api.open-meteo.com", jsonRes({
    current: { time: t, temperature_2m: 1.5, wind_speed_10m: 2, relative_humidity_2m: 80 },
    hourly: { time: [t], temperature_2m: [1.5], precipitation: [0], wind_speed_10m: [2], weather_code: [71] },
  }));
  const w = await getWeather({ lat: 61, lon: 28, place: "X" });
  assert.match(w.source, /Open-Meteo/);
  assert.equal(w.now.temp, 1.5);
  assert.equal(w.hours[0].symbol, "snow");
});

await test("Varoitukset: vain kotialueen polygoni, peruutukset ja vanhentuneet pois", async () => {
  const { parseWarnings } = await import("../lib/area.mjs");
  const h = { lat: 61.0587, lon: 28.1887 };
  assert.equal(parseWarnings(cap(polyHome), h).length, 1);
  assert.equal(parseWarnings(cap(polyHome), h)[0].colorText, "keltainen");
  assert.equal(parseWarnings(cap(polyHome), h)[0].event, "Tuulivaroitus maa-alueille");
  assert.equal(parseWarnings(cap(polyFar), h).length, 0);
  assert.equal(parseWarnings(cap(polyHome, "Cancel"), h).length, 0);
  assert.equal(parseWarnings(cap(polyHome, "Alert", "2020-01-01T00:00:00Z"), h).length, 0);
});

await test("Liikenne: etäisyysrajaus", async () => {
  const { parseTraffic } = await import("../lib/area.mjs");
  const out = parseTraffic(traffic, { lat: 61.0587, lon: 28.1887 }, 40);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "A1");
  assert.equal(out[0].type, "Liikennetiedote");
});

await test("Lähialue-funktio", async () => {
  route("alerts.fmi.fi", text(cap(polyHome)));
  route("traffic-message", jsonRes(traffic));
  const area = await fn("area");
  const a = await (await area(authed("/api/area"))).json();
  assert.equal(a.warnings.length, 1);
  assert.equal(a.traffic.length, 1, "sama tiedote vain kerran");
  const ua = calls.find((c) => c.url.includes("traffic-message")).opts.headers["Digitraffic-User"];
  assert.ok(ua);
});

await test("Uutiset: yhdistää ja järjestää syötteet", async () => {
  route("yle.fi/rss", text(rss));
  const news = await fn("news");
  const n = await (await news(authed("/api/news"))).json();
  assert.equal(n.items.length, 2, "duplikaatit poistettu");
  assert.equal(n.items[0].title, "Uutinen 2");
});

await test("Kamerat: agentin lähetys, lista ja kuva", async () => {
  const upload = await fn("upload");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  let r = await upload(req("/api/upload?type=cam&id=piha&name=Piha", { method: "POST", body: jpeg, headers: { "x-agent-key": "väärä" } }));
  assert.equal(r.status, 401);
  r = await upload(req("/api/upload?type=cam&id=../x", { method: "POST", body: jpeg, headers: { "x-agent-key": process.env.AGENT_KEY } }));
  assert.equal(r.status, 400);
  r = await upload(req("/api/upload?type=cam&id=piha&name=Piha", { method: "POST", body: jpeg, headers: { "x-agent-key": process.env.AGENT_KEY } }));
  assert.equal(r.status, 200);
  const cams = await fn("cams");
  const list = await (await cams(authed("/api/cams"))).json();
  assert.equal(list.cams[0].name, "Piha");
  assert.ok(list.agentSeenAt);
  r = await upload(req("/api/upload?type=cam-error", { method: "POST", body: JSON.stringify({ id: "varasto", name: "Varasto", error: "ei yhteyttä" }), headers: { "x-agent-key": process.env.AGENT_KEY } }));
  assert.equal(r.status, 200);
  const list2 = await (await cams(authed("/api/cams"))).json();
  const v = list2.cams.find((c) => c.id === "varasto");
  assert.equal(v.takenAt, null);
  assert.equal(v.error, "ei yhteyttä");
  const cam = await fn("cam");
  assert.equal((await cam(req("/api/cam/piha"), { params: { id: "piha" } })).status, 401);
  const img = await cam(authed("/api/cam/piha"), { params: { id: "piha" } });
  assert.equal(img.headers.get("content-type"), "image/jpeg");
  assert.equal((await img.arrayBuffer()).byteLength, jpeg.length);
});

await test("Sähkö: agentin lähetys ja haku", async () => {
  const upload = await fn("upload");
  const energy = await fn("energy");
  let e = await (await energy(authed("/api/energy"))).json();
  assert.equal(e.data, null);
  await upload(req("/api/upload?type=energy", { method: "POST", body: JSON.stringify({ daily: [{ date: "2026-10-25", kwh: 18.4 }], hourly: [] }), headers: { "x-agent-key": process.env.AGENT_KEY } }));
  e = await (await energy(authed("/api/energy"))).json();
  assert.equal(e.data.daily[0].kwh, 18.4);
  assert.equal(e.lastError, null);
});

await test("Ford: ilman asetuksia", async () => {
  const ford = await fn("ford");
  const d = await (await ford(authed("/api/ford"))).json();
  assert.equal(d.configured, false);
});

await test("Ford: OAuth-kirjautuminen, token ja telemetria", async () => {
  process.env.FORD_CLIENT_ID = "cid";
  process.env.FORD_CLIENT_SECRET = "csecret";
  const ford = await fn("ford");
  let d = await (await ford(authed("/api/ford"))).json();
  assert.deepEqual(d, { configured: true, authorized: false });

  const login = await fn("ford-login");
  const r = await login(authed("/api/ford-login"));
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, "https://api.vehicle.ford.com/fcon-public/v1/auth/init");
  assert.equal(loc.searchParams.get("redirect_uri"), "https://kotitaulu.example/api/ford-callback");
  const state = loc.searchParams.get("state");
  assert.equal(state.length, 16);

  let tokenBody = null;
  route("oauth2/v2.0/token", (url, opts) => {
    tokenBody = new URLSearchParams(opts.body);
    return new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 1800 }), { status: 200 });
  });
  const cb = await fn("ford-callback");
  const bad = await cb(authed(`/api/ford-callback?code=abc&state=vaara`));
  assert.match(bad.headers.get("location"), /ford=virhe/);
  const ok = await cb(authed(`/api/ford-callback?code=abc&state=${state}`));
  assert.equal(ok.headers.get("location"), "/?ford=ok");
  assert.equal(tokenBody.get("grant_type"), "authorization_code");
  assert.equal(tokenBody.get("client_secret"), "csecret");

  route("/fcon-query/v1/garage", jsonRes([{ vehicleType: "2024 Mustang Mach-E", engineType: "BEV" }]));
  route("/fcon-query/v1/telemetry", (url, opts) => {
    assert.equal(opts.headers.authorization, "Bearer AT");
    return new Response(JSON.stringify({
      updateTime: "2026-10-26T11:58:00Z",
      metrics: {
        xevBatteryStateOfCharge: { value: 62.5 },
        xevBatteryRange: { value: 241.3 },
        odometer: { value: 18342 },
        xevPlugChargerStatus: { value: "CONNECTED" },
        xevBatteryChargeDisplayStatus: { value: "IN_PROGRESS" },
        xevBatteryTimeToFullCharge: { value: 95 },
        doorLockStatus: [{ vehicleDoor: "ALL_DOORS", value: "LOCKED" }],
        position: { value: { location: { lat: 61.06, lon: 28.19 } } },
      },
    }), { status: 200 });
  });
  d = await (await ford(authed("/api/ford"))).json();
  assert.equal(d.authorized, true);
  assert.equal(d.car.soc, 62.5);
  assert.equal(d.car.name, "2024 Mustang Mach-E");
  assert.equal(d.car.locked, true);
  assert.equal(d.car.plug, "CONNECTED");
  assert.deepEqual(d.car.position, { lat: 61.06, lon: 28.19 });
});

await test("Ford: vanhentunut token uusitaan refresh-tokenilla", async () => {
  const { store } = await import("../lib/store.mjs");
  const s = store();
  await s.delete("ford/telemetry");
  await s.setJSON("ford/token", { access_token: "OLD", refresh_token: "RT", expires_at: Date.now() - 1000 });
  let body = null;
  route("oauth2/v2.0/token", (url, opts) => {
    body = new URLSearchParams(opts.body);
    return new Response(JSON.stringify({ access_token: "AT", expires_in: 1800 }), { status: 200 });
  });
  const ford = await fn("ford");
  const d = await (await ford(authed("/api/ford"))).json();
  assert.equal(body.get("grant_type"), "refresh_token");
  assert.equal(d.car.soc, 62.5);
  const tok = await s.get("ford/token", { type: "json" });
  assert.equal(tok.refresh_token, "RT", "vanha refresh-token säilyy");
});

console.log(`\n${passed} testiä läpi${process.exitCode ? ", osa epäonnistui" : ""}.`);

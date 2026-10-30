// Sivuston rajapinta. Vaatii salasanan (Netlifyn ympäristömuuttuja SITE_PASSWORD).
//   GET  /api              -> tallennettu data + asetukset
//   GET  /api?action=sync  -> hakee uudet tiedot Garminilta
//   POST /api?action=settings  (JSON) -> tallentaa asetukset
//   POST /api?action=plan      (JSON) -> tallentaa käsin lisätyt treenit
//   GET  /api?action=vo2       -> hakee VO2max-historiaa treenien FIT-tiedostoista
import { getStore } from "@netlify/blobs";
import { runSync, runVo2Backfill } from "../../lib/sync.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default async (req) => {
  const password = process.env.SITE_PASSWORD;
  if (!password) return json({ error: "SITE_PASSWORD puuttuu Netlifyn asetuksista" }, 500);
  if (req.headers.get("x-site-password") !== password) return json({ error: "Väärä salasana" }, 401);

  const store = getStore("garmin");
  const action = new URL(req.url).searchParams.get("action") || "data";
  try {
    if (action === "sync") return json({ status: await runSync() });
    if (action === "vo2") return json(await runVo2Backfill());

    if (action === "settings" && req.method === "POST") {
      const body = await req.json();
      if (!body || typeof body !== "object") return json({ error: "Virheelliset asetukset" }, 400);
      await store.setJSON("settings", body);
      return json({ ok: true });
    }

    if (action === "plan" && req.method === "POST") {
      const body = await req.json();
      if (!body || !Array.isArray(body.items) || body.items.length > 1000) return json({ error: "Virheellinen kalenteri" }, 400);
      await store.setJSON("plan", { items: body.items, hidden: Array.isArray(body.hidden) ? body.hidden.slice(-500) : [] });
      return json({ ok: true });
    }

    const [data, settings, plan] = await Promise.all([
      store.get("data", { type: "json" }),
      store.get("settings", { type: "json" }),
      store.get("plan", { type: "json" }),
    ]);
    return json({ ...(data || { activities: {}, healthByDate: {} }), settings: settings || null, plan: plan || { items: [], hidden: [] } });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
};

export const config = { path: "/api" };

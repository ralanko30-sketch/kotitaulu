import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

// Havaintokuvat eivät muutu, joten selain saa pitää ne välimuistissa.
const handler = async (req, context) => {
  const denied = guard(req);
  if (denied) return denied;
  const key = String(context.params?.key || "");
  if (!/^[a-z0-9-]{1,80}$/.test(key)) return json({ error: "Tuntematon kuva" }, 404);
  const data = await store().get(`ev/${key}`, { type: "arrayBuffer" });
  if (!data) return json({ error: "Kuvaa ei enää ole" }, 404);
  return new Response(data, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400, immutable" } });
};

export default async (req, context) => {
  try {
    return await handler(req, context);
  } catch (e) {
    console.error(e);
    return json({ error: `Kuvaa ei saatu: ${e?.message || e}` }, 500);
  }
};

export const config = { path: "/api/event/:key" };

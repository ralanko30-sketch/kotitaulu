import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

const handler = async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  const s = store();
  const [data, err] = await Promise.all([s.get("energy", { type: "json" }), s.get("energy-error", { type: "json" })]);
  const lastError = err && (!data || err.at > data.receivedAt) ? err : null;
  return json({ data: data || null, lastError });
};

export default async (req, context) => {
  try {
    return await handler(req, context);
  } catch (e) {
    console.error(e);
    return json({ error: `Kulutustietoja ei saatu: ${e?.message || e}` }, 500);
  }
};

export const config = { path: "/api/energy" };

import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  const s = store();
  const [data, err] = await Promise.all([s.get("energy", { type: "json" }), s.get("energy-error", { type: "json" })]);
  const lastError = err && (!data || err.at > data.receivedAt) ? err : null;
  return json({ data: data || null, lastError });
};

export const config = { path: "/api/energy" };

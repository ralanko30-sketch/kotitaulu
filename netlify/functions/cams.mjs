import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  const s = store();
  const [index, heartbeat] = await Promise.all([s.get("cam-index", { type: "json" }), s.get("heartbeat", { type: "json" })]);
  const cams = Object.entries(index || {})
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => a.name.localeCompare(b.name, "fi"));
  return json({ cams, agentSeenAt: heartbeat?.at || null });
};

export const config = { path: "/api/cams" };

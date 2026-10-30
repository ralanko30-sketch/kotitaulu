import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

const handler = async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  const s = store();
  const [index, heartbeat, events] = await Promise.all([
    s.get("cam-index", { type: "json" }),
    s.get("heartbeat", { type: "json" }),
    s.get("events", { type: "json" }),
  ]);
  const cams = Object.entries(index || {})
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => a.name.localeCompare(b.name, "fi"));
  return json({ cams, events: events || [], agentSeenAt: heartbeat?.at || null });
};

export default async (req, context) => {
  try {
    return await handler(req, context);
  } catch (e) {
    console.error(e);
    return json({ error: `Kameratietoja ei saatu: ${e?.message || e}` }, 500);
  }
};

export const config = { path: "/api/cams" };

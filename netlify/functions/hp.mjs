import { json, guard } from "../../lib/http.mjs";
import { enqueue, getState, pending, validate } from "../../lib/heatpump.mjs";

const handler = async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const cmd = validate(body.action, body.value);
    if (!cmd) return json({ error: "Virheellinen komento" }, 400);
    const queue = await enqueue(cmd);
    return json({ ok: true, pending: queue, state: await getState() });
  }
  const [state, queue] = await Promise.all([getState(), pending()]);
  return json({ state, pending: queue });
};

export default async (req, context) => {
  try {
    return await handler(req, context);
  } catch (e) {
    console.error(e);
    return json({ error: `Lämpöpumpun tietoja ei saatu: ${e?.message || e}` }, 500);
  }
};

export const config = { path: "/api/hp" };

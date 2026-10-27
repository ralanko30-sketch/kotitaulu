import { json, guard } from "../../lib/http.mjs";
import { getAir, sendAir } from "../../lib/electrolux.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body.id !== "string" || !body.id) return json({ error: "Laite puuttuu" }, 400);
      await sendAir(body.id, body.action, body.value);
      // Laite päivittää tilansa pilveen pienellä viiveellä.
      await new Promise((r) => setTimeout(r, 2500));
      return json(await getAir({ fresh: true }));
    }
    const fresh = new URL(req.url).searchParams.has("fresh");
    return json(await getAir({ fresh }));
  } catch (e) {
    console.error(e);
    return json({ error: `Ilmanpuhdistimen tietoja ei saatu: ${e?.message || e}` }, 502);
  }
};

export const config = { path: "/api/air" };

// Kotikoneen agentti lähettää tänne kamerakuvat, sähkönkulutuksen ja lämpöpumpun tilan.
// Jokaisen vastauksen mukana palautetaan lämpöpumpun odottavat komennot.
import { json, env, safeEqual } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";
import { saveState, takeCommands } from "../../lib/heatpump.mjs";

const MAX_BYTES = 4 * 1024 * 1024;

const handler = async (req) => {
  if (req.method !== "POST") return json({ error: "Väärä metodi" }, 405);
  const key = env("AGENT_KEY");
  if (!key || key.length < 24) return json({ error: "AGENT_KEY puuttuu tai on liian lyhyt (väh. 24 merkkiä)" }, 500);
  if (!safeEqual(req.headers.get("x-agent-key") || "", key)) return json({ error: "Väärä agenttiavain" }, 401);

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const s = store();
  const now = new Date().toISOString();

  if (type === "cam") {
    const id = (url.searchParams.get("id") || "").toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) return json({ error: "Kameran tunnus saa sisältää vain a–z, 0–9 ja -" }, 400);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_BYTES) return json({ error: "Kuva puuttuu tai on liian suuri" }, 413);
    const name = (url.searchParams.get("name") || id).slice(0, 40);
    const takenAt = url.searchParams.get("taken") || now;
    await s.set(`cam/${id}`, buf, { metadata: { name, takenAt, bytes: buf.byteLength } });
    const index = (await s.get("cam-index", { type: "json" })) || {};
    index[id] = { name, takenAt };
    await s.setJSON("cam-index", index);
  } else if (type === "cam-error") {
    const body = await req.json().catch(() => ({}));
    const index = (await s.get("cam-index", { type: "json" })) || {};
    const id = String(body.id || "").toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) return json({ error: "Kameran tunnus saa sisältää vain a–z, 0–9 ja -" }, 400);
    index[id] = { name: String(body.name || id).slice(0, 40), takenAt: null, ...index[id] };
    index[id].error = String(body.error || "").slice(0, 200);
    index[id].errorAt = now;
    await s.setJSON("cam-index", index);
  } else if (type === "energy") {
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.daily)) return json({ error: "Kulutusdata puuttuu" }, 400);
    await s.setJSON("energy", { ...body, receivedAt: now });
  } else if (type === "energy-error") {
    const body = await req.json().catch(() => ({}));
    await s.setJSON("energy-error", { error: String(body.error || "").slice(0, 300), at: now });
  } else if (type === "heatpump") {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Lämpöpumpun tila puuttuu" }, 400);
    await saveState({
      name: String(body.name || "Ilmalämpöpumppu").slice(0, 40),
      state: body.state && typeof body.state === "object" ? body.state : null,
      error: body.error ? String(body.error).slice(0, 200) : null,
      executed: Array.isArray(body.executed) ? body.executed.slice(0, 10) : [],
    });
  } else if (type !== "heartbeat") {
    return json({ error: "Tuntematon tyyppi" }, 400);
  }

  await s.setJSON("heartbeat", { at: now, version: req.headers.get("x-agent-version") || null });
  // Vanhat agentit eivät käsittele komentoja, joten jono annetaan vain uusille.
  const commands = req.headers.get("x-agent-commands") === "1" ? await takeCommands() : [];
  return json({ ok: true, commands });
};

export default async (req, context) => {
  try {
    return await handler(req, context);
  } catch (e) {
    console.error(e);
    return json({ error: `Tallennus epäonnistui: ${e?.message || e}` }, 500);
  }
};

export const config = { path: "/api/upload" };

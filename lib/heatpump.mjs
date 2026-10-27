// Ilmalämpöpumpun tila ja komentojono. Kotiagentti lukee laitetta kotiverkossa,
// lähettää tilan tänne ja hakee komennot heartbeatin vastauksessa.
import { store } from "./store.mjs";

const K_STATE = "heatpump";
const K_QUEUE = "heatpump/commands";
const MAX_AGE_MS = 10 * 60 * 1000;

export const MODES = { 0: "Jäähdytys", 1: "Lämmitys", 2: "Kuivaus", 3: "Puhallin", 4: "Automaatti", 6: "Ylläpito 8 °C" };
export const FANS = { 0: "Automaatti", 1: "Hidas", 2: "Keski", 3: "Nopea", 4: "Turbo", 5: "Hiljainen" };

export function validate(action, value) {
  switch (action) {
    case "power":
      return typeof value === "boolean" ? { action, value } : null;
    case "temp":
      return Number.isInteger(value) && value >= 16 && value <= 32 ? { action, value } : null;
    case "mode":
      return Number.isInteger(value) && value in MODES ? { action, value } : null;
    case "fan":
      return Number.isInteger(value) && value in FANS ? { action, value } : null;
    default:
      return null;
  }
}

export async function enqueue(cmd) {
  const s = store();
  const q = ((await s.get(K_QUEUE, { type: "json" })) || []).filter((c) => Date.now() - c.at < MAX_AGE_MS);
  // Saman tyyppinen uudempi komento korvaa vanhan (esim. lämpötilan napsuttelu).
  const rest = q.filter((c) => c.action !== cmd.action);
  rest.push({ ...cmd, id: Math.random().toString(36).slice(2, 10), at: Date.now() });
  await s.setJSON(K_QUEUE, rest);
  return rest;
}

export async function pending() {
  return ((await store().get(K_QUEUE, { type: "json" })) || []).filter((c) => Date.now() - c.at < MAX_AGE_MS);
}

/** Agentti noutaa jonon: palautetaan komennot ja tyhjennetään jono. */
export async function takeCommands() {
  const q = await pending();
  if (q.length) await store().setJSON(K_QUEUE, []);
  return q;
}

export async function saveState(body) {
  await store().setJSON(K_STATE, { ...body, receivedAt: new Date().toISOString() });
}

export async function getState() {
  return store().get(K_STATE, { type: "json" });
}

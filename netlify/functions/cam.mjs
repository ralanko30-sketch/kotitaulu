import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

const handler = async (req, context) => {
  const denied = guard(req);
  if (denied) return denied;
  const id = String(context.params?.id || "").toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(id)) return json({ error: "Tuntematon kamera" }, 404);
  const blob = await store().getWithMetadata(`cam/${id}`, { type: "arrayBuffer" });
  if (!blob) return json({ error: "Kameralta ei ole vielä kuvaa" }, 404);
  return new Response(blob.data, {
    headers: {
      "content-type": "image/jpeg",
      // Osoitteessa on kuvan aikaleima (?t=...), joten sama osoite = sama kuva.
      "cache-control": "private, max-age=86400",
      "x-taken-at": blob.metadata?.takenAt || "",
    },
  });
};

export default async (req, context) => {
  try {
    return await handler(req, context);
  } catch (e) {
    console.error(e);
    return json({ error: `Kuvaa ei saatu: ${e?.message || e}` }, 500);
  }
};

export const config = { path: "/api/cam/:id" };

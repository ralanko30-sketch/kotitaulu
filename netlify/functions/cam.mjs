import { json, guard } from "../../lib/http.mjs";
import { store } from "../../lib/store.mjs";

export default async (req, context) => {
  const denied = guard(req);
  if (denied) return denied;
  const id = String(context.params?.id || "").toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(id)) return json({ error: "Tuntematon kamera" }, 404);
  const blob = await store().getWithMetadata(`cam/${id}`, { type: "arrayBuffer" });
  if (!blob) return json({ error: "Kameralta ei ole vielä kuvaa" }, 404);
  return new Response(blob.data, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, no-store",
      "x-taken-at": blob.metadata?.takenAt || "",
    },
  });
};

export const config = { path: "/api/cam/:id" };

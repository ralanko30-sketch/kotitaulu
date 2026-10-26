import { json, env, safeEqual, makeSessionCookie, clearSessionCookie, isAuthed } from "../../lib/http.mjs";

export default async (req) => {
  if (req.method === "GET") return json({ authed: isAuthed(req) });
  if (req.method === "DELETE") return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  if (req.method !== "POST") return json({ error: "Väärä metodi" }, 405);

  const expected = env("SITE_PASSWORD");
  if (!expected) return json({ error: "SITE_PASSWORD puuttuu Netlifyn ympäristömuuttujista" }, 500);

  let body = {};
  try {
    body = await req.json();
  } catch {}
  // Pieni viive hidastaa salasanan arvailua.
  await new Promise((r) => setTimeout(r, 600));
  if (!safeEqual(body.password || "", expected)) return json({ error: "Väärä salasana" }, 401);
  return json({ ok: true }, 200, { "set-cookie": makeSessionCookie() });
};

export const config = { path: "/api/login" };

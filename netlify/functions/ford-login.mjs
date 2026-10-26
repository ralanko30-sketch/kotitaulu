import { guard, json } from "../../lib/http.mjs";
import { startLogin, fordConfig } from "../../lib/ford.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return new Response(null, { status: 302, headers: { location: "/" } });
  if (!fordConfig(req).configured) return json({ error: "FORD_CLIENT_ID ja FORD_CLIENT_SECRET puuttuvat" }, 500);
  return new Response(null, { status: 302, headers: { location: await startLogin(req), "cache-control": "no-store" } });
};

export const config = { path: "/api/ford-login" };

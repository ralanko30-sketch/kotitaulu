import { guard } from "../../lib/http.mjs";
import { finishLogin } from "../../lib/ford.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return new Response(null, { status: 302, headers: { location: "/" } });
  try {
    await finishLogin(req);
    return new Response(null, { status: 302, headers: { location: "/?ford=ok" } });
  } catch (e) {
    return new Response(null, { status: 302, headers: { location: `/?ford=virhe&viesti=${encodeURIComponent(e.message)}` } });
  }
};

export const config = { path: "/api/ford-callback" };

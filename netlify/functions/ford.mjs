import { json, guard } from "../../lib/http.mjs";
import { getCar } from "../../lib/ford.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return json(await getCar(req));
  } catch (e) {
    return json({ error: `Auton tietoja ei saatu: ${e.message}` }, 502);
  }
};

export const config = { path: "/api/ford" };

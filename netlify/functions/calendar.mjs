import { json, guard, env, cached } from "../../lib/http.mjs";
import { getCalendar, parseCalendars } from "../../lib/calendar.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  const cals = parseCalendars(env("GCAL_ICS"));
  if (!cals.length) return json({ configured: false });
  try {
    const data = await cached("calendar", 5 * 60 * 1000, () => getCalendar(cals));
    if (data.failed.length === cals.length) return json({ error: `Kalenteria ei saatu: ${data.failed.join(", ")}` }, 502);
    return json({ configured: true, ...data });
  } catch (e) {
    console.error(e);
    return json({ error: `Kalenteria ei saatu: ${e?.message || e}` }, 502);
  }
};

export const config = { path: "/api/calendar" };

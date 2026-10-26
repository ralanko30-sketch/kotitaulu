import { json, guard, home, cached } from "../../lib/http.mjs";
import { getWeather } from "../../lib/weather.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const h = home();
    const data = await cached(`weather:${h.lat},${h.lon}`, 10 * 60 * 1000, () => getWeather(h));
    return json(data);
  } catch (e) {
    return json({ error: `Säätietoja ei saatu: ${e.message}` }, 502);
  }
};

export const config = { path: "/api/weather" };

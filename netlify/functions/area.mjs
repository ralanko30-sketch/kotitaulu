import { json, guard, env, home, cached } from "../../lib/http.mjs";
import { getWarnings, getTraffic } from "../../lib/area.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  const h = home();
  const radius = Number(env("AREA_RADIUS_KM", "40"));
  const [warnings, traffic] = await Promise.allSettled([
    cached("warnings", 5 * 60 * 1000, () => getWarnings(h)),
    cached("traffic", 3 * 60 * 1000, () => getTraffic(h, radius)),
  ]);
  return json({
    place: h.place,
    radiusKm: radius,
    warnings: warnings.status === "fulfilled" ? warnings.value : null,
    warningsError: warnings.status === "rejected" ? String(warnings.reason?.message || warnings.reason) : null,
    traffic: traffic.status === "fulfilled" ? traffic.value : null,
    trafficError: traffic.status === "rejected" ? String(traffic.reason?.message || traffic.reason) : null,
    situationRoomUrl: env("SITUATION_URL", "https://www.tilannehuone.fi/"),
  });
};

export const config = { path: "/api/area" };

// Kalenteritilaus puhelimeen: /kalenteri.ics?k=<tunniste>
// Tunniste johdetaan sivuston salasanasta, joten salasanaa ei tarvitse laittaa kalenterilinkkiin.
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { computeState } from "../../public/core.js";
import { addDays, weekStart, dayKey, SPORTS } from "../../public/model.js";

const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line) => {
  const out = [];
  let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
  out.push(s);
  return out.join("\r\n");
};
const dt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const tm = (d) => `${dt(d)}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;

export default async (req) => {
  const password = process.env.SITE_PASSWORD || "";
  const token = createHash("sha256").update(password + ":ics").digest("hex").slice(0, 32);
  if (!password || new URL(req.url).searchParams.get("k") !== token) return new Response("Ei oikeutta", { status: 401 });

  const store = getStore("garmin");
  const [data, settings, plan] = await Promise.all([
    store.get("data", { type: "json" }), store.get("settings", { type: "json" }), store.get("plan", { type: "json" }),
  ]);
  // Suomen aika: Netlify ajaa UTC:ssä, joten lasketaan paikallinen päivä
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Helsinki" }));
  const S = computeState({ ...(data || {}), settings, plan: plan || { items: [], hidden: [] } }, now);

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Treenisivu//FI", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Treenisivu", "X-WR-TIMEZONE:Europe/Helsinki", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  const stamp = tm(new Date()).replace(/T/, "T") + "Z";
  for (let w = -1; w <= 4; w++) {
    const p = S.planFor(addDays(weekStart(now), 7 * w));
    for (const d of p.days) {
      d.items.forEach((it, i) => {
        const det = S.sessionDetail(it);
        const desc = [
          it.kind === "event" ? "Tavoitetapahtuma" : `${SPORTS[it.sport]?.name || ""}${it.dur ? `, ${Math.round(it.dur / 60)} min` : ""}`,
          it.why || "",
          ...(det?.steps || []).map(([t, s]) => `${t}: ${s}`),
          det?.tip ? `Vinkki: ${det.tip}` : "",
        ].filter(Boolean).join("\n");
        const uid = `${dayKey(d.date)}-${i}-${(it.mid || it.tpl || it.title || "").toString().replace(/\W/g, "")}@treenisivu`;
        lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`);
        if (it.time) {
          const [h, m] = it.time.split(":").map(Number);
          const st = new Date(d.date); st.setHours(h, m, 0, 0);
          const en = new Date(st.getTime() + (it.dur || 3600) * 1000);
          lines.push(`DTSTART;TZID=Europe/Helsinki:${tm(st)}`, `DTEND;TZID=Europe/Helsinki:${tm(en)}`);
        } else {
          lines.push(`DTSTART;VALUE=DATE:${dt(d.date)}`, `DTEND;VALUE=DATE:${dt(addDays(d.date, 1))}`);
        }
        lines.push(fold(`SUMMARY:${esc((it.done ? "✓ " : "") + (it.kind === "event" ? "🏁 " : "") + it.title)}`), fold(`DESCRIPTION:${esc(desc)}`), "TRANSP:TRANSPARENT", "END:VEVENT");
      });
    }
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": "inline; filename=treenisivu.ics" },
  });
};

export const config = { path: "/kalenteri.ics" };

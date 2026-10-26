import { parseXml } from "./xml.mjs";
import { fetchWithTimeout } from "./http.mjs";

export const DEFAULT_FEEDS = [
  { name: "Pääuutiset", url: "https://yle.fi/rss/uutiset/paauutiset" },
  { name: "Etelä-Karjala", url: "https://yle.fi/rss/t/18-141372/fi" },
];

export function parseFeeds(envValue) {
  // Muoto: "Nimi|https://...,Nimi2|https://..."
  if (!envValue) return DEFAULT_FEEDS;
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, url] = s.includes("|") ? s.split("|") : ["Uutiset", s];
      return { name: name.trim(), url: url.trim() };
    });
}

const isoOrNull = (s) => { const d = new Date(s); return s && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const first = (v) => String([].concat(v ?? "").find((x) => typeof x === "string" && x.trim()) ?? "").trim();

export function parseRss(text, feedName) {
  const doc = parseXml(text);
  const items = [].concat(doc?.rss?.channel?.item || []);
  return items.map((it) => ({
    title: first(it.title),
    link: first(it.link),
    time: isoOrNull(first(it.pubDate)),
    feed: feedName,
  }));
}

export async function getNews(feeds, limit = 14) {
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const res = await fetchWithTimeout(f.url);
      if (!res.ok) throw new Error(`${f.name}: ${res.status}`);
      return parseRss(await res.text(), f.name);
    })
  );
  const seen = new Set();
  const items = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const it of r.value) {
      if (!it.link || seen.has(it.link)) continue;
      seen.add(it.link);
      items.push(it);
    }
  }
  items.sort((a, b) => (b.time || "").localeCompare(a.time || ""));
  const failed = results.map((r, i) => (r.status === "rejected" ? feeds[i].name : null)).filter(Boolean);
  return { items: items.slice(0, limit), failed };
}

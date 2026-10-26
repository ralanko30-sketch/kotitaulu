import { json, guard, env, cached } from "../../lib/http.mjs";
import { getNews, parseFeeds } from "../../lib/news.mjs";

export default async (req) => {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const feeds = parseFeeds(env("NEWS_FEEDS"));
    const data = await cached("news", 5 * 60 * 1000, () => getNews(feeds));
    if (!data.items.length) return json({ error: "Uutissyötteet eivät vastanneet" }, 502);
    return json(data);
  } catch (e) {
    return json({ error: `Uutisia ei saatu: ${e.message}` }, 502);
  }
};

export const config = { path: "/api/news" };

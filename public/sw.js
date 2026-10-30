// Treenisivun service worker: verkko ensin, välimuisti varalla (toimii myös ilman verkkoa).
const CACHE = "treenisivu-v5";
const SHELL = ["/", "/index.html", "/style.css", "/app.js", "/core.js", "/model.js", "/insights.js", "/charts.js", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Synkronointi ja kalenteri aina verkosta
  if (url.pathname === "/kalenteri.ics" || /action=(sync|vo2)/.test(url.search)) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.pathname === "/api" ? "/api" : req, copy)); }
      return res;
    }).catch(() => caches.match(url.pathname === "/api" ? "/api" : req).then(r => r || caches.match("/index.html")))
  );
});

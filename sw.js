/* Элсэн цаг — service worker: works offline, caches the app shell and fonts. */
const VERSION = "elsen-v1";
const FONTS = "elsen-fonts";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("elsen-") && k !== VERSION && k !== FONTS).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

// Page: network first (3 s), fall back to cache so the app opens offline.
async function page(req) {
  const cache = await caches.open(VERSION);
  const net = fetch(req).then(res => {
    if (res.ok) cache.put("./index.html", res.clone());
    return res;
  });
  net.catch(() => {});
  const timeout = new Promise(r => setTimeout(r, 3000));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch (_) { /* offline */ }
  const cached = await cache.match("./index.html");
  return cached || net;
}

// Same-origin files: cache first, refresh in the background.
async function asset(req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await net) || Response.error();
}

// Google Fonts: cache first, so text keeps its typeface offline.
async function font(req) {
  const cache = await caches.open(FONTS);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  } catch (_) { return Response.error(); }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (req.mode === "navigate") return e.respondWith(page(req));
  if (url.origin === location.origin) return e.respondWith(asset(req));
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(font(req));
});

// Tapping a notification opens (or focuses) the app.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow("./");
  })());
});

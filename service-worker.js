// Service Worker – מאפשר עבודה גם בלי אינטרנט (offline) והתקנה כאפליקציה
const CACHE = "morti-v3";
const ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", e => {
  // לא קוראים ל-skipWaiting אוטומטית — מחכים לאישור המשתמש דרך הבאנר
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// הודעה מהדף: החל עדכון מיד
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// רשת קודם: תמיד מנסה להביא גרסה עדכנית, ונופל למטמון רק כשאין אינטרנט
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});

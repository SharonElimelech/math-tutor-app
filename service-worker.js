// Service Worker – מאפשר עבודה גם בלי אינטרנט (offline) והתקנה כאפליקציה
const CACHE = "morti-v3.3.8";
const ASSETS = [
  "index.html",
  "styles.css?v=23",
  "app.js?v=25",
  "src/data.js",
  "src/reminders.js",
  "src/calendar.js",
  "src/selectors.js",
  "src/storage.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", e => {
  // מתקינים מיד את הגרסה החדשה — רענון הדף יציג אותה ללא צורך באישור
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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

// לחיצה על התראה — מביאה את האפליקציה לקדמת המסך (או פותחת אותה)
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow("./");
    })
  );
});

// ניווט: רשת קודם כדי לקבל גרסה חדשה. נכסים מקומיים: מטמון קודם לטעינה מיידית.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) e.waitUntil(caches.open(CACHE).then(cache => cache.put("index.html", res.clone())));
          return res;
        })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) e.waitUntil(caches.open(CACHE).then(cache => cache.put(e.request, res.clone())));
        return res;
      }))
    );
    return;
  }

  // משאבים חיצוניים (גופנים): רשת עם נפילה למטמון, בלי להחזיר HTML במקום נכס.
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

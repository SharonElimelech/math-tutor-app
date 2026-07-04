// Service Worker – מאפשר עבודה גם בלי אינטרנט (offline) והתקנה כאפליקציה
const CACHE = "morti-v3.5.0";
const ASSETS = [
  "index.html",
  "styles.css?v=26",
  "app.js?v=29",
  "src/data.js",
  "src/push.js",
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
  // cache: "reload" — עוקף את מטמון ה-HTTP כדי שגרסה חדשה תמיד תיכנס עם קבצים טריים ועקביים
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: "reload" })))).then(() => self.skipWaiting()));
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

// Push מהשרת: דחיפה ריקה שמעירה אותנו. פרטי התזכורת נשמרים במטמון
// mt-push-data על ידי האפליקציה (src/push.js) — קוראים משם ומציגים.
self.addEventListener("push", e => {
  e.waitUntil((async () => {
    let due = [];
    try {
      const cache = await caches.open("mt-push-data");
      const res = await cache.match("reminders");
      const items = res ? await res.json() : [];
      const now = Date.now();
      // חלון 30 דק' אחורה — מכסה איחור של ה-cron בלי להציג תזכורות עתיקות
      due = items.filter(i => i.t <= now && i.t > now - 30 * 60 * 1000);
    } catch { /* מטמון חסר/פגום — נציג הודעה כללית */ }
    if (!due.length) due = [{ title: "המורה שלי", body: "יש תזכורת ממתינה — פתחי את האפליקציה" }];
    for (const item of due) {
      await self.registration.showNotification(item.title, {
        body: item.body,
        tag: item.tag,
        icon: "icon-192.png",
        badge: "icon-192.png",
        data: { url: "./" }
      });
    }
  })());
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

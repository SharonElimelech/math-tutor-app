// Service Worker – מאפשר עבודה גם בלי אינטרנט (offline) והתקנה כאפליקציה
const CACHE = "morti-v4.1.0";
// נתוני ה-push של האפליקציה (רשימת תזכורות + סימוני "הוצג") — חיים מעבר לעדכוני גרסה
const PUSH_DATA = "mt-push-data";
const ASSETS = [
  "index.html",
  "styles.css?v=62",
  "app.js?v=75",
  "src/data.js",
  "src/push.js",
  "src/reminders.js",
  "src/calendar.js",
  "src/selectors.js",
  "src/storage.js",
  "src/whatsapp.js",
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
      Promise.all(keys.filter(k => k !== CACHE && k !== PUSH_DATA).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// הודעה מהדף: החל עדכון מיד
self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Push מהשרת: דחיפה ריקה שמעירה אותנו. פרטי התזכורת נשמרים במטמון mt-push-data על ידי
// האפליקציה (src/push.js). כל פריט נושא חתימה; "shown/<חתימה>" במטמון = כבר הוצג (כאן או
// בטיימר של האפליקציה) — ולא מציגים שוב. מסמנים לפני ההצגה כדי ששני ההקשרים לא יציגו יחד.
const shownKey = sig => sig ? "shown/" + encodeURIComponent(sig) : null;
const notify = (item, extra = {}) => self.registration.showNotification(item.title, {
  body: item.body,
  tag: item.tag,
  icon: "icon-192.png",
  badge: "icon-192.png",
  data: { url: item.url || "./" },
  ...extra
});

self.addEventListener("push", e => {
  e.waitUntil((async () => {
    const now = Date.now();
    let cache, inWindow = null;
    try {
      cache = await caches.open(PUSH_DATA);
      const res = await cache.match("reminders");
      const items = res ? await res.json() : [];
      // חלון 30 דק' אחורה — מכסה איחור של ה-cron בלי להציג תזכורות עתיקות
      inWindow = items.filter(i => i.t <= now && i.t > now - 30 * 60 * 1000);
    } catch { /* מטמון חסר/פגום */ }
    // push חייב להציג התראה גלויה (אחרת Chrome מציג הודעה גנרית משלו ו-iOS מבטל את המנוי)
    if (!inWindow || !inWindow.length) {
      return notify({ title: "המורה שלי", body: "יש תזכורת ממתינה — פתחי את האפליקציה" });
    }
    let shown = 0;
    for (const item of inWindow) {
      const key = shownKey(item.sig);
      if (key && await cache.match(key)) continue;
      if (key) await cache.put(key, new Response(String(now)));
      await notify(item);
      shown++;
    }
    // הכל כבר הוצג (בדף, במסלול הגיבוי): מציגים שוב את האחרון באותו tag ובשקט — באנדרואיד החלפה במקום
    // או חזרה בלי צליל; iOS מתעלם מ-tag ומ-silent ויציג שוב. נדיר — רק כש-push מגיע לפריט שהדף כבר הציג.
    // לא להשמיט: push בלי התראה גלויה = הודעה גנרית של Chrome, וב-iOS ביטול המנוי אחרי 3 פעמים.
    if (!shown) await notify(inWindow[inWindow.length - 1], { silent: true });
  })());
});

// לחיצה על התראה — מביאה את האפליקציה לקדמת המסך (או פותחת אותה) ומנווטת לשיעור
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) {
          if ("navigate" in c && url !== "./") c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
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

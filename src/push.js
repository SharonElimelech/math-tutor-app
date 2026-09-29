import { paymentSignature, reminderSignature } from "./reminders.js";
import { ymd } from "./calendar.js";

// התראות כשהאפליקציה סגורה: ה-cron בשרת שולח web push בזמן התזכורת, וה-service
// worker מציג את ההתראה מהמטמון המקומי. טקסט התזכורת מסונכרן לשרת ולמטמון.

export const PUSH_SERVER = "https://mytutor-push.aruitkh11.workers.dev";
export const VAPID_PUBLIC_KEY = "BHhFFPc6qcDFpasSyWrqfsMUdq4-InJTvr-ehC_1EVSSBlfNmG6rprnc0ONBPsqsMxnKuFY6ROfqMqCF9LW-wew";
export const PUSH_CACHE = "mt-push-data";

const MINUTE = 60 * 1000;

// ----- כל התזכורות במקום אחד -----
// מקור אמת יחיד לשלושת סוגי ה-push: לפני שיעור, בוקר ("X שיעורים היום") ותשלום אחרי שיעור.
// גם הטיימר בדף (גיבוי) וגם הסנכרון לשרת ולמטמון צורכים את אותה רשימה — שני חישובים שונים
// היו הסיבה לתזכורת הכפולה ב-v4.0.0. חלון: 30 דק' אחורה (ה-SW מציג מהמטמון פריטים שכבר עברו)
// ועד האופק קדימה.
const atTime = (date, hhmm) => new Date(`${date}T${hhmm || "00:00"}:00`).getTime();
const nextDay = date => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return ymd(d);
};
const morningBody = n => n === 1 ? "שיעור אחד היום — שלחי תזכורת לתלמיד" : `${n} שיעורים היום — שלחי תזכורות לתלמידים`;

export function plannedReminders(lessons, studentsById, settings, now = Date.now(), horizonDays = 60) {
  const lead = Math.max(0, Number(settings.remindMinutes ?? 30) || 0) * MINUTE;
  const morning = String(settings.morningReminderTime ?? "");
  const payMode = settings.payReminderMode ?? "afterLesson";
  const from = now - 30 * MINUTE;
  const to = now + horizonDays * 24 * 60 * MINUTE;
  const out = [];
  const perDay = new Map();
  for (const l of lessons) {
    const start = atTime(l.date, l.time);
    if (!Number.isFinite(start)) continue;
    const student = studentsById.get(l.studentId);
    const name = student?.name || "תלמיד";
    if (!l.done) {
      out.push({
        t: start - lead,
        title: "תזכורת שיעור",
        body: `שיעור עם ${name} בשעה ${l.time}`,
        tag: `lesson-${l.id}`,
        url: `./?view=home&lesson=${encodeURIComponent(l.id)}`,
        sig: reminderSignature(l)
      });
      perDay.set(l.date, (perDay.get(l.date) || 0) + 1);
    }
    // תשלום: לא דורש "בוצע" — ה-push עצמו הוא הבקשה לאשר את השיעור ולשלוח תזכורת
    const price = Number(l.price ?? student?.price) || 0;
    if (!l.paid && price > 0 && payMode !== "off") {
      const t = payMode === "nextMorning"
        ? atTime(nextDay(l.date), morning || "08:00")
        : start + (Number(l.duration) || 60) * MINUTE;
      out.push({
        t,
        title: "תזכורת תשלום",
        body: `השיעור עם ${name} הסתיים — שלחי תזכורת תשלום להורה`,
        tag: `pay-${l.id}`,
        url: `./?view=home&pay=${encodeURIComponent(l.studentId)}`,
        sig: paymentSignature(l)
      });
    }
  }
  if (morning) {
    for (const [date, n] of perDay) {
      out.push({
        t: atTime(date, morning),
        title: "תזכורות להיום",
        body: morningBody(n),
        tag: `morning-${date}`,
        url: "./?view=home&hub=lessons",
        sig: `morning:${date}`
      });
    }
  }
  return out.filter(i => Number.isFinite(i.t) && i.t > from && i.t <= to).sort((a, b) => a.t - b.t);
}

// מה הדף מציג בעצמו. כשה-push בריא — רק פריטים שזמנם עבר לפני הסנכרון האחרון: הסנכרון שולח
// לשרת רק עתיד, כלומר פריט כזה כבר ירד מרשומת השרת ואף אחד אחר לא יציג אותו. פריט שזמנו אחרי
// הסנכרון עדיין בשרת — ה-cron ידחוף אותו וה-SW יציג. בלי push בריא הדף מציג כל פריט שהגיע זמנו.
export function pageDueItems(items, now, notified, pushHealthy, syncedAt = 0) {
  return items.filter(i => i.t <= now && !notified.has(i.sig) && (!pushHealthy || i.t <= syncedAt));
}

const urlB64ToBytes = s => {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window;

// הרשמה ל-push (אחרי שהרשאת Notification ניתנה). מחזיר את המנוי.
export async function enablePush() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToBytes(VAPID_PUBLIC_KEY)
  });
}

// מזהה מכשיר קבוע — מפתח הרשומה בשרת, כדי שמייל יעבוד גם בלי מנוי push
const CLIENT_ID_KEY = "mt_push_client";
function clientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

// כתיבה למטמון (בשביל ה-SW) ושליחת התזכורות לשרת. זורק על כשל HTTP.
// המטמון מקבל גם את 30 הדקות האחרונות (ה-SW מציג ממנו פריטים שכבר עברו כש-push מגיע);
// השרת מקבל רק עתיד — אחרת ה-cron היה דוחף מיד פריט שהדף בדיוק הציג.
async function writeAndSync(sub, items, now = Date.now()) {
  try {
    const cache = await caches.open(PUSH_CACHE);
    await cache.put("reminders", new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" }
    }));
  } catch { /* אין Cache API — ה-push עדיין יעבוד עם ההודעה הגנרית */ }
  const res = await fetch(`${PUSH_SERVER}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: clientId(),
      sub: sub ? sub.toJSON() : null,
      items: items.filter(i => i.t > now).map(({ t, title, body }) => ({ t, title, body }))
    })
  });
  if (!res.ok) throw new Error(`sync-failed-${res.status}`);
}

// האם קיים מנוי push פעיל במכשיר הזה
export async function pushSubscribed() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

// המנוי הנוכחי אם קיים — נכשל בשקט, מייל לא תלוי במנוי.
async function currentSub() {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// סנכרון: כל התזכורות המתוכננות למטמון + לשרת. רץ אחרי כל שמירה. מחזיר "ok"; זורק על כשל רשת/שרת.
export async function syncPush(lessons, studentsById, settings) {
  const now = Date.now();
  await writeAndSync(await currentSub(), plannedReminders(lessons, studentsById, settings, now), now);
  return "ok";
}

// בדיקת "אפליקציה סגורה": תזכורת בדיקה בעוד 2 דק' + סנכרון לשרת.
// ה-cron רץ כל 5 דק' — ההתראה תגיע תוך 2-7 דקות. מחזיר את זמן הבדיקה.
// ponytail: סנכרון רגיל שירוץ לפני שהבדיקה נורתה ידרוס אותה — זניח, המשתמשת מתבקשת לסגור את האפליקציה.
export async function sendClosedAppTest(lessons, studentsById, settings) {
  const now = Date.now();
  const items = plannedReminders(lessons, studentsById, settings, now);
  const t = now + 2 * MINUTE;
  items.push({ t, title: "בדיקת התראות ✓", body: "מצוין — התזכורות מגיעות גם כשהאפליקציה סגורה", tag: "push-test", sig: `test:${t}` });
  items.sort((a, b) => a.t - b.t);
  await writeAndSync(await currentSub(), items, now);
  return t;
}

// ----- זיכרון "כבר הוצג" משותף לאפליקציה ול-service worker -----
// שני מסלולים יכולים להציג תזכורות: ה-push דרך ה-SW (הרגיל) והטיימר בדף (גיבוי כשאין push בריא).
// בלי זיכרון משותף כל אחד מציג פעם אחת — כלומר פעמיים. מפתח מטמון נפרד לכל חתימה
// ("shown/<sig>", הגוף = זמן הסימון): בלי read-modify-write של מערך, כי שני ההקשרים
// יכולים לכתוב באותו רגע. ה-SW משתמש באותו מפתח (service-worker.js).
const SHOWN_PREFIX = "shown/";
const shownKey = sig => SHOWN_PREFIX + encodeURIComponent(sig);
const sigOfKey = req => {
  const i = req.url.indexOf("/" + SHOWN_PREFIX);
  return i < 0 ? null : decodeURIComponent(req.url.slice(i + 1 + SHOWN_PREFIX.length));
};

export async function shownSigs() {
  try {
    const cache = await caches.open(PUSH_CACHE);
    return new Set((await cache.keys()).map(sigOfKey).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function markShown(sig) {
  try {
    const cache = await caches.open(PUSH_CACHE);
    await cache.put(shownKey(sig), new Response(String(Date.now())));
  } catch { /* אין Cache API — נשאר הדדופ המקומי בלבד */ }
}

// ניקוי בעלייה: סימון רלוונטי רק בחלון של ה-SW (30 דק') — אחרי יום מוחקים, שהרשימה לא תתפח.
export async function pruneShown(now = Date.now()) {
  try {
    const cache = await caches.open(PUSH_CACHE);
    for (const req of await cache.keys()) {
      if (!sigOfKey(req)) continue;
      const at = Number(await (await cache.match(req))?.text());
      if (!(at > now - 86400e3)) await cache.delete(req);
    }
  } catch { /* אין Cache API */ }
}

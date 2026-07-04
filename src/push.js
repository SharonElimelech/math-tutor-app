// Web Push — התראות גם כשהאפליקציה סגורה (iOS 16.4+ מותקנת למסך הבית).
// השרת שומר רק זמני שליחה; טקסט ההתראה נשמר במטמון המקומי וה-service worker
// קורא אותו כשמגיע push. ככה אין שמות תלמידים בענן ואין קריפטו של payload.

export const PUSH_SERVER = "https://mytutor-push.aruitkh11.workers.dev";
export const VAPID_PUBLIC_KEY = "BHhFFPc6qcDFpasSyWrqfsMUdq4-InJTvr-ehC_1EVSSBlfNmG6rprnc0ONBPsqsMxnKuFY6ROfqMqCF9LW-wew";
export const PUSH_CACHE = "mt-push-data";

const MINUTE = 60 * 1000;

// אילו תזכורות עתידיות צריכות push. מחזיר [{t, title, body, tag}] ממוין לפי זמן.
export function upcomingPushReminders(lessons, studentsById, leadMinutes = 30, now = Date.now(), horizonDays = 60) {
  const lead = Math.max(0, Number(leadMinutes) || 0) * MINUTE;
  const horizon = now + horizonDays * 24 * 3600 * 1000;
  const out = [];
  for (const lesson of lessons) {
    if (lesson.done) continue;
    const start = new Date(`${lesson.date}T${lesson.time || "00:00"}:00`).getTime();
    if (!Number.isFinite(start)) continue;
    const t = start - lead;
    if (t <= now || t > horizon) continue;
    const name = studentsById.get(lesson.studentId)?.name || "תלמיד";
    out.push({
      t,
      title: "תזכורת שיעור",
      body: `שיעור עם ${name} בשעה ${lesson.time}`,
      tag: `lesson-${lesson.id}`
    });
  }
  return out.sort((a, b) => a.t - b.t);
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

// כתיבה למטמון (בשביל ה-SW) ושליחת הזמנים לשרת. זורק על כשל HTTP.
async function writeAndSync(sub, items) {
  const cache = await caches.open(PUSH_CACHE);
  await cache.put("reminders", new Response(JSON.stringify(items), {
    headers: { "Content-Type": "application/json" }
  }));
  const res = await fetch(`${PUSH_SERVER}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub: sub.toJSON(), times: items.map(i => i.t) })
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

// סנכרון: תזכורות למטמון + זמנים לשרת. רץ אחרי כל שמירה.
// מחזיר "ok" / "nosub" (אין מנוי או אין תמיכה); זורק על כשל רשת/שרת.
export async function syncPush(lessons, studentsById, leadMinutes) {
  if (!pushSupported()) return "nosub";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return "nosub";
  await writeAndSync(sub, upcomingPushReminders(lessons, studentsById, leadMinutes));
  return "ok";
}

// בדיקת "אפליקציה סגורה": תזכורת בדיקה בעוד 2 דק' + סנכרון לשרת.
// ה-cron רץ כל 5 דק' — ההתראה תגיע תוך 2-7 דקות. מחזיר את זמן הבדיקה.
// ponytail: סנכרון רגיל שירוץ לפני שהבדיקה נורתה ידרוס אותה — זניח, המשתמשת מתבקשת לסגור את האפליקציה.
export async function sendClosedAppTest(lessons, studentsById, leadMinutes) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error("no-subscription");
  const items = upcomingPushReminders(lessons, studentsById, leadMinutes);
  const t = Date.now() + 2 * MINUTE;
  items.push({ t, title: "בדיקת התראות ✓", body: "מצוין — ההתראות מגיעות גם כשהאפליקציה סגורה", tag: "push-test" });
  items.sort((a, b) => a.t - b.t);
  await writeAndSync(sub, items);
  return t;
}

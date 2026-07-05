// התראות כשהאפליקציה סגורה: השרת שולח מייל בזמן התזכורת (אמין באייפון גם
// כשהטלפון נעול) + web push כשיש מנוי. טקסט התזכורת נשלח לשרת כדי שהמייל
// יכיל את פרטי השיעור.

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
async function writeAndSync(sub, items) {
  try {
    const cache = await caches.open(PUSH_CACHE);
    await cache.put("reminders", new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" }
    }));
  } catch { /* אין Cache API — המייל עדיין יעבוד */ }
  const res = await fetch(`${PUSH_SERVER}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: clientId(),
      sub: sub ? sub.toJSON() : null,
      items: items.map(({ t, title, body }) => ({ t, title, body }))
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

// סנכרון: תזכורות למטמון + לשרת (מייל תמיד, push אם יש מנוי). רץ אחרי כל שמירה.
// מחזיר "ok"; זורק על כשל רשת/שרת.
export async function syncPush(lessons, studentsById, leadMinutes) {
  await writeAndSync(await currentSub(), upcomingPushReminders(lessons, studentsById, leadMinutes));
  return "ok";
}

// בדיקת "אפליקציה סגורה": תזכורת בדיקה בעוד 2 דק' + סנכרון לשרת.
// ה-cron רץ כל 5 דק' — ההתראה/מייל יגיעו תוך 2-7 דקות. מחזיר את זמן הבדיקה.
// ponytail: סנכרון רגיל שירוץ לפני שהבדיקה נורתה ידרוס אותה — זניח, המשתמשת מתבקשת לסגור את האפליקציה.
export async function sendClosedAppTest(lessons, studentsById, leadMinutes) {
  const items = upcomingPushReminders(lessons, studentsById, leadMinutes);
  const t = Date.now() + 2 * MINUTE;
  items.push({ t, title: "בדיקת התראות ✓", body: "מצוין — התזכורות מגיעות גם כשהאפליקציה סגורה", tag: "push-test" });
  items.sort((a, b) => a.t - b.t);
  await writeAndSync(await currentSub(), items);
  return t;
}

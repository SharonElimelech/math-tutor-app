import { ymd } from "./calendar.js";

// שליחה אוטומטית בוואטסאפ: האפליקציה מכינה מראש כל הודעה עם חלון זמן (after..until), השרת
// מחזיק אותן, וקיצור הדרך TutorAuto — שאוטומציות "שעה ביום" באייפון מריצות בשעות שבהגדרות —
// מושך מהשרת את מה שהגיע זמנו ושולח. כאן רק מתי ולמי; הטקסטים והטלפונים באים מהאפליקציה (texts).
const HOUR = 3600e3;
const EARLY = 30 * 60e3; // חלון נפתח חצי שעה לפני שעת האוטומציה — היא רצה כמה שניות אחרי
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00`).getTime();
export const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const DEFAULT_TIMES = { daily: "10:00", weekDay: 6, weekly: "20:00" };

export function automationItems({ lessons, studentsById, now, texts, times = DEFAULT_TIMES, horizonDays = 14 }) {
  const today = ymd(new Date(now));
  const last = addDays(today, horizonDays);
  const out = [];
  const push = (id, after, until, msg) => {
    if (msg && msg.phone && msg.text && until > now) out.push({ id, after, until, phone: msg.phone, text: msg.text });
  };

  for (const l of lessons) {
    const s = studentsById.get(l.studentId);
    if (!s || l.date > last) continue;
    const start = at(l.date, l.time);
    // תזכורת ביום השיעור: בריצת הבוקר, ולא אחרי שהשיעור התחיל (שיעור לפני שעת הבוקר — בלי תזכורת)
    if (!l.done && l.date >= today) push(`d:${l.id}:${l.date}:${l.time}`, at(l.date, times.daily) - EARLY, start, texts.daily(l, s));
    // תשלום: מסוף השיעור, בריצה הראשונה שאחריו (בדרך כלל ריצת הערב). חלון 36 שעות.
    if (!l.paid) {
      const end = start + (Number(l.duration) || 60) * 60e3;
      push(`p:${l.id}`, end, end + 36 * HOUR, texts.pay(l, s));
    }
  }

  // שבועי: ביום ובשעה שבהגדרות — הודעה אחת לכל תלמיד עם השיעורים של 7 הימים שאחרי
  for (let date = today; date <= last; date = addDays(date, 1)) {
    if (new Date(`${date}T12:00:00`).getDay() !== times.weekDay) continue;
    const from = addDays(date, 1), to = addDays(date, 7);
    const byStudent = new Map();
    for (const l of lessons) {
      if (l.done || l.date < from || l.date > to || !studentsById.has(l.studentId)) continue;
      if (!byStudent.has(l.studentId)) byStudent.set(l.studentId, []);
      byStudent.get(l.studentId).push(l);
    }
    const send = at(date, times.weekly);
    for (const [sid, list] of byStudent) {
      list.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
      push(`w:${date}:${sid}`, send - EARLY, send + 12 * HOUR, texts.weekly(studentsById.get(sid), list, date));
    }
  }
  return out.sort((a, b) => a.after - b.after).slice(0, 500);
}

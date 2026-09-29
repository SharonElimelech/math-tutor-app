const MINUTE = 60 * 1000;

export const reminderSignature = lesson => `${lesson.id}:${lesson.date}:${lesson.time}`;
export const paymentSignature = lesson => `pay:${lesson.id}:${lesson.date}:${lesson.time}`;

// מועמדים ל"שליחה לכולם": שיעורים בתאריכים הנתונים שלא בוצעו וטרם נשלחה להם תזכורת.
// החתימה כוללת תאריך ושעה — שיעור שהוזז נחשב אוטומטית כ"לא נשלח" ונכנס שוב לתור.
export function bulkReminderLessons(lessons, dates, sent = new Set()) {
  const wanted = new Set(dates);
  return lessons.filter(l => !l.done && wanted.has(l.date) && !sent.has(reminderSignature(l)));
}

export function lessonStartTimestamp(lesson) {
  return new Date(`${lesson.date}T${lesson.time || "00:00"}:00`).getTime();
}

// כמו bulkReminderLessons, אבל בלי שיעורים שכבר התחילו — אין טעם לתזכר על שיעור שעבר.
export function upcomingReminderLessons(lessons, dates, now = Date.now(), sent = new Set()) {
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  return bulkReminderLessons(lessons, dates, sent).filter(lesson => {
    const start = lessonStartTimestamp(lesson);
    return Number.isFinite(start) && start >= nowTime;
  });
}

// שיעורים שכבר הסתיימו ולא סומנו "בוצע" — ממתינים לאישור המורה בדף הבית
export function lessonsAwaitingConfirmation(lessons, now = Date.now()) {
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  return lessons.filter(lesson => {
    if (lesson.done) return false;
    const start = lessonStartTimestamp(lesson);
    if (!Number.isFinite(start)) return false;
    return start + (Number(lesson.duration) || 60) * MINUTE <= nowTime;
  });
}

const calendarEscape = value => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\r?\n/g, "\\n")
  .replace(/,/g, "\\,")
  .replace(/;/g, "\\;");

const pad2 = value => String(value).padStart(2, "0");

// חותמת UTC מפורשת (עם Z). בלי סיומת אזור זמן ובלי VTIMEZONE, יומנים רבים —
// ובראשם Google Calendar — מפרשים את השעה כ-UTC, ואז שיעור ערב בישראל (UTC+3)
// נוחת למחרת אחרי חצות. UTC מפורש חד-משמעי בכל לקוח יומן.
const utcCalendarTime = date =>
  `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
  `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;

export function createLessonsCalendar(lessons, studentsById, reminderMinutes = 30, generatedAt = new Date()) {
  const stamp = utcCalendarTime(generatedAt);
  const alarmMinutes = Math.max(0, Math.round(Number(reminderMinutes) || 0));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//My Tutor Manager//Lessons//HE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  for (const lesson of lessons) {
    const student = studentsById.get(lesson.studentId);
    // השיעור נשמר כשעת קיר מקומית; new Date מפרש אותה באזור המכשיר, כולל שעון קיץ
    const start = new Date(`${lesson.date}T${lesson.time || "00:00"}:00`);
    const end = new Date(start.getTime() + Math.max(0, Number(lesson.duration) || 0) * MINUTE);
    const name = student?.name || "תלמיד";

    lines.push(
      "BEGIN:VEVENT",
      `UID:${calendarEscape(lesson.id)}@my-tutor-manager`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcCalendarTime(start)}`,
      `DTEND:${utcCalendarTime(end)}`,
      `SUMMARY:${calendarEscape(`שיעור עם ${name}`)}`,
      lesson.topic ? `DESCRIPTION:${calendarEscape(lesson.topic)}` : "DESCRIPTION:שיעור פרטי",
      "BEGIN:VALARM",
      `TRIGGER:${alarmMinutes === 0 ? "PT0M" : `-PT${alarmMinutes}M`}`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${calendarEscape(`תזכורת: שיעור עם ${name}`)}`,
      "END:VALARM",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

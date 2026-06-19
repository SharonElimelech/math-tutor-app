const MINUTE = 60 * 1000;

export const reminderSignature = lesson => `${lesson.id}:${lesson.date}:${lesson.time}`;

export function lessonStartTimestamp(lesson) {
  return new Date(`${lesson.date}T${lesson.time || "00:00"}:00`).getTime();
}

export function dueLessonReminders(lessons, now = Date.now(), leadMinutes = 30, notified = new Set()) {
  const nowTime = now instanceof Date ? now.getTime() : Number(now);
  const lead = Math.max(0, Number(leadMinutes) || 0) * MINUTE;
  const grace = 5 * MINUTE;

  return lessons.filter(lesson => {
    if (lesson.done || notified.has(reminderSignature(lesson))) return false;
    const start = lessonStartTimestamp(lesson);
    if (!Number.isFinite(start)) return false;
    return nowTime >= start - lead && nowTime <= start + grace;
  });
}

const calendarEscape = value => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/\r?\n/g, "\\n")
  .replace(/,/g, "\\,")
  .replace(/;/g, "\\;");

const localCalendarTime = (date, time) =>
  `${String(date).replaceAll("-", "")}T${String(time || "00:00").replace(":", "")}00`;

export function createLessonsCalendar(lessons, studentsById, reminderMinutes = 30, generatedAt = new Date()) {
  const stamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
    const start = new Date(`${lesson.date}T${lesson.time || "00:00"}:00`);
    const end = new Date(start.getTime() + Math.max(0, Number(lesson.duration) || 0) * MINUTE);
    const endDate = [
      end.getFullYear(),
      String(end.getMonth() + 1).padStart(2, "0"),
      String(end.getDate()).padStart(2, "0")
    ].join("-");
    const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
    const name = student?.name || "תלמיד";

    lines.push(
      "BEGIN:VEVENT",
      `UID:${calendarEscape(lesson.id)}@my-tutor-manager`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${localCalendarTime(lesson.date, lesson.time)}`,
      `DTEND:${localCalendarTime(endDate, endTime)}`,
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

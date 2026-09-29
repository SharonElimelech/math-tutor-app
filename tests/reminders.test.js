import assert from "node:assert/strict";
import test from "node:test";

import {
  bulkReminderLessons,
  createLessonsCalendar,
  lessonsAwaitingConfirmation,
  paymentSignature,
  reminderSignature,
  upcomingReminderLessons
} from "../src/reminders.js";

const lesson = {
  id: "lesson_1",
  studentId: "student_1",
  date: "2026-06-20",
  time: "16:00",
  duration: 60,
  topic: "אלגברה",
  done: false
};

test("upcoming reminders drop lessons that already started today", () => {
  const later = { ...lesson, id: "lesson_late", time: "20:00" };
  const dates = ["2026-06-20"];
  const now = new Date("2026-06-20T17:00:00");
  // 16:00 כבר עבר, 20:00 עוד לפנינו
  assert.deepEqual(upcomingReminderLessons([lesson, later], dates, now), [later]);
  // לפני שני השיעורים — שניהם מועמדים
  assert.deepEqual(upcomingReminderLessons([lesson, later], dates, new Date("2026-06-20T08:00:00")), [lesson, later]);
  // חתימה שכבר נשלחה עדיין מסוננת
  assert.deepEqual(
    upcomingReminderLessons([lesson, later], dates, new Date("2026-06-20T08:00:00"), new Set([reminderSignature(lesson)])),
    [later]
  );
});

test("bulk reminders cover given dates, skip done and already-sent lessons", () => {
  const tomorrow = { ...lesson, id: "lesson_2", date: "2026-06-21" };
  const farAway = { ...lesson, id: "lesson_3", date: "2026-07-01" };
  const all = [lesson, tomorrow, farAway];
  const dates = ["2026-06-20", "2026-06-21"];
  assert.deepEqual(bulkReminderLessons(all, dates), [lesson, tomorrow]);
  assert.deepEqual(bulkReminderLessons(all, dates, new Set([reminderSignature(lesson)])), [tomorrow]);
  assert.deepEqual(bulkReminderLessons([{ ...lesson, done: true }], dates), []);
  // שיעור שהוזז מקבל חתימה חדשה — חוזר לתור השליחה
  const moved = { ...lesson, time: "18:00" };
  assert.deepEqual(bulkReminderLessons([moved], dates, new Set([reminderSignature(lesson)])), [moved]);
});

test("calendar export includes lesson and native alarm", () => {
  const students = new Map([["student_1", { name: "דנה" }]]);
  const calendar = createLessonsCalendar([lesson], students, 30, new Date("2026-06-20T10:00:00Z"));
  assert.match(calendar, /BEGIN:VEVENT\r\n/);
  assert.match(calendar, /SUMMARY:שיעור עם דנה/);
  // הזמן חייב לצאת ב-UTC מפורש, אחרת יומנים מפרשים שעת ערב כמחרת
  const start = new Date("2026-06-20T16:00:00");
  const expected = start.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  assert.match(calendar, new RegExp(`DTSTART:${expected}`));
  assert.match(calendar, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(calendar, /DTEND:\d{8}T\d{6}Z/);
  assert.match(calendar, /TRIGGER:-PT30M/);
  assert.match(calendar, /END:VCALENDAR\r\n$/);
});

test("awaiting-confirmation lists only lessons that already ended and are not done", () => {
  const base = { studentId: "student_1", time: "16:00", duration: 60, done: false };
  const out = lessonsAwaitingConfirmation([
    { ...base, id: "ended", date: "2026-06-20" },
    { ...base, id: "running", date: "2026-06-21", time: "09:30" },
    { ...base, id: "future", date: "2026-06-22" },
    { ...base, id: "already-done", date: "2026-06-19", done: true },
    { ...base, id: "bad-date", date: "oops" }
  ], new Date("2026-06-21T10:00:00"));
  assert.deepEqual(out.map(l => l.id), ["ended"]);
});

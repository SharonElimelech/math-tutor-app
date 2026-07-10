import assert from "node:assert/strict";
import test from "node:test";

import {
  bulkReminderLessons,
  createLessonsCalendar,
  dueLessonReminders,
  duePaymentReminders,
  lessonsAwaitingConfirmation,
  nextLessonReminderTimestamp,
  paymentSignature,
  reminderSignature
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

test("finds reminders inside lead window and ignores delivered or done lessons", () => {
  const now = new Date("2026-06-20T15:40:00");
  assert.deepEqual(dueLessonReminders([lesson], now, 30), [lesson]);
  assert.deepEqual(dueLessonReminders([lesson], now, 30, new Set([reminderSignature(lesson)])), []);
  assert.deepEqual(dueLessonReminders([{ ...lesson, done: true }], now, 30), []);
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

test("payment reminders flag finished, done, unpaid lessons only once", () => {
  const ended = { ...lesson, done: true, paid: false };
  const after = new Date("2026-06-20T17:30:00");
  const before = new Date("2026-06-20T15:00:00");
  assert.deepEqual(duePaymentReminders([ended], after), [ended]);
  assert.deepEqual(duePaymentReminders([ended], before), []); // not finished yet
  assert.deepEqual(duePaymentReminders([{ ...ended, paid: true }], after), []); // already paid
  assert.deepEqual(duePaymentReminders([{ ...lesson, done: false }], after), []); // not done
  assert.deepEqual(duePaymentReminders([ended], after, new Set([paymentSignature(ended)])), []); // already reminded
});

test("zero-minute reminder gets a short polling grace window", () => {
  assert.deepEqual(dueLessonReminders([lesson], new Date("2026-06-20T16:01:00"), 0), [lesson]);
  assert.deepEqual(dueLessonReminders([lesson], new Date("2026-06-20T16:06:00"), 0), []);
});

test("finds the next reminder time", () => {
  assert.equal(
    nextLessonReminderTimestamp([lesson], new Date("2026-06-20T12:00:00"), 30),
    new Date("2026-06-20T15:30:00").getTime()
  );
  assert.equal(
    nextLessonReminderTimestamp([lesson], new Date("2026-06-20T15:40:00"), 30),
    new Date("2026-06-20T15:40:00").getTime()
  );
  assert.equal(
    nextLessonReminderTimestamp([lesson], new Date("2026-06-20T16:06:00"), 30),
    null
  );
});

test("calendar export includes lesson and native alarm", () => {
  const students = new Map([["student_1", { name: "דנה" }]]);
  const calendar = createLessonsCalendar([lesson], students, 30, new Date("2026-06-20T10:00:00Z"));
  assert.match(calendar, /BEGIN:VEVENT\r\n/);
  assert.match(calendar, /SUMMARY:שיעור עם דנה/);
  assert.match(calendar, /DTSTART:20260620T160000/);
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

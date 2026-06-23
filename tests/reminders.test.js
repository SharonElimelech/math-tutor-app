import assert from "node:assert/strict";
import test from "node:test";

import {
  createLessonsCalendar,
  dueLessonReminders,
  duePaymentReminders,
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

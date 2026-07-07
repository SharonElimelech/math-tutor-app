import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_VERSION,
  DEFAULT_SETTINGS,
  createSnapshot,
  normalizeSettings,
  parseBackup,
  reminderLeadMinutes
} from "../src/data.js";

const student = { id: "student_1", name: "דנה", parentName: "רונית", phone: "0501234567", studentPhone: "0521234567", price: 120, notes: "" };
const lesson = {
  id: "lesson_1",
  studentId: student.id,
  date: "2026-06-20",
  time: "16:00",
  topic: "אלגברה",
  duration: 60,
  done: false,
  paid: false
};

test("release exposes the expected app version", () => {
  assert.equal(APP_VERSION, "3.7.0");
});

test("backup parser normalizes a valid snapshot", () => {
  const result = parseBackup({ students: [student], lessons: [lesson], settings: {} });
  assert.deepEqual(result.students, [student]);
  assert.equal(result.lessons[0].topic, "אלגברה");
  assert.equal(result.settings.currency, DEFAULT_SETTINGS.currency);
});

test("backup parser rejects unsafe identifiers and settings", () => {
  assert.throws(
    () => parseBackup({ students: [{ ...student, id: "x');alert(1)//" }], lessons: [], settings: {} }),
    /id is invalid/
  );
  assert.throws(
    () => normalizeSettings({ currency: "<b>" }),
    /currency is invalid/
  );
});

test("backup parser rejects broken relationships and duplicate IDs", () => {
  assert.throws(
    () => parseBackup({ students: [student], lessons: [{ ...lesson, studentId: "missing" }], settings: {} }),
    /missing student/
  );
  assert.throws(
    () => parseBackup({ students: [student, student], lessons: [], settings: {} }),
    /duplicate student IDs/
  );
});

test("snapshot creation rejects malformed in-memory data", () => {
  assert.throws(() => createSnapshot([student], [{ ...lesson, date: "tomorrow" }], {}), /date is invalid/);
});

test("zero-minute reminders remain zero", () => {
  assert.equal(reminderLeadMinutes(0), 0);
  assert.equal(reminderLeadMinutes("15"), 15);
  assert.equal(reminderLeadMinutes(undefined), 30);
});

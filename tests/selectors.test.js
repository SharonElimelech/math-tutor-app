import assert from "node:assert/strict";
import test from "node:test";

import { buildLessonIndex, summarizeMonth } from "../src/selectors.js";

const students = [
  { id: "s1", name: "דנה" },
  { id: "s2", name: "נועם" }
];
const lessons = [
  { id: "l2", studentId: "s1", date: "2026-07-01", time: "17:00", done: true, paid: false, price: 120 },
  { id: "l1", studentId: "s1", date: "2026-06-20", time: "16:00", done: true, paid: true, price: 100 },
  { id: "l3", studentId: "s2", date: "2026-06-20", time: "18:00", done: false, paid: false, price: 90 }
];

test("lesson index provides stable sorted and grouped views", () => {
  const index = buildLessonIndex(students, lessons);
  assert.deepEqual(index.sortedLessons.map(lesson => lesson.id), ["l1", "l3", "l2"]);
  assert.equal(index.forStudent("s1").length, 2);
  assert.equal(index.onDate("2026-06-20").length, 2);
  assert.deepEqual(index.unpaidForStudent("s1").map(lesson => lesson.id), ["l2"]);
  assert.deepEqual(index.forStudent("missing"), []);
});

test("monthly summaries aggregate once per lesson", () => {
  const index = buildLessonIndex(students, lessons);
  const result = summarizeMonth(
    lessons.filter(lesson => lesson.done),
    index.studentsById,
    lesson => lesson.price
  );

  assert.deepEqual({ earned: result.earned, pending: result.pending, count: result.count }, {
    earned: 100,
    pending: 120,
    count: 2
  });
  assert.equal(result.students[0].student.id, "s1");
  assert.equal(result.students[0].count, 2);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildLessonIndex, debtAgeWeeks, findConflicts, summarizeMonth } from "../src/selectors.js";

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
  // רשימת תלמיד ממוינת כרונולוגית גם כשהשיעורים הוכנסו בסדר הפוך
  assert.deepEqual(index.forStudent("s1").map(lesson => lesson.id), ["l1", "l2"]);
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

test("findConflicts flags overlapping lessons on requested dates", () => {
  const existing = [
    { id: "a", studentId: "s1", date: "2026-07-20", time: "16:00", duration: 60, done: false },
    { id: "b", studentId: "s2", date: "2026-07-27", time: "17:00", duration: 45, done: false },
    { id: "c", studentId: "s2", date: "2026-07-20", time: "16:30", duration: 60, done: true }
  ];
  // חופף ל-a; מדלג על c כי כבר בוצע
  assert.deepEqual(findConflicts(existing, { dates: ["2026-07-20"], time: "16:30", duration: 60 }).map(l => l.id), ["a"]);
  // צמוד (מתחיל בדיוק כשהקודם נגמר) — לא חפיפה
  assert.equal(findConflicts(existing, { dates: ["2026-07-20"], time: "17:00", duration: 60 }).length, 0);
  // סדרה שבועית: כמה תאריכים בבדיקה אחת
  assert.deepEqual(findConflicts(existing, { dates: ["2026-07-20", "2026-07-27"], time: "17:00", duration: 30 }).map(l => l.id), ["b"]);
  // עריכת שיעור לא מתנגשת עם עצמה
  assert.equal(findConflicts(existing, { dates: ["2026-07-20"], time: "16:00", duration: 60, excludeId: "a" }).length, 0);
  // בלי שעה — אין מה לבדוק
  assert.equal(findConflicts(existing, { dates: ["2026-07-20"], time: "", duration: 60 }).length, 0);
});

test("debtAgeWeeks counts whole weeks from the oldest unpaid lesson", () => {
  const unpaid = [
    { date: "2026-07-01" },
    { date: "2026-06-10" },
    { date: "2026-07-15" }
  ];
  assert.equal(debtAgeWeeks(unpaid, "2026-07-19"), 5); // מ-10.6: 39 ימים = 5 שבועות שלמים
  assert.equal(debtAgeWeeks([{ date: "2026-07-13" }], "2026-07-19"), 0); // 6 ימים — עוד לא שבוע
  assert.equal(debtAgeWeeks([{ date: "2026-07-12" }], "2026-07-19"), 1); // בדיוק שבוע
  assert.equal(debtAgeWeeks([], "2026-07-19"), 0);
});

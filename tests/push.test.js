import assert from "node:assert/strict";
import test from "node:test";

import { upcomingPushReminders } from "../src/push.js";

const now = new Date("2026-07-04T12:00:00").getTime();
const students = new Map([["s1", { id: "s1", name: "דנה" }]]);
const lesson = (over = {}) => ({
  id: "l1", studentId: "s1", date: "2026-07-04", time: "16:00", done: false, paid: false, ...over
});

test("future lesson gets a reminder at start minus lead", () => {
  const out = upcomingPushReminders([lesson()], students, 30, now);
  assert.equal(out.length, 1);
  assert.equal(out[0].t, new Date("2026-07-04T15:30:00").getTime());
  assert.ok(out[0].body.includes("דנה"));
  assert.equal(out[0].tag, "lesson-l1");
});

test("done, past, and beyond-horizon lessons are excluded", () => {
  const out = upcomingPushReminders([
    lesson({ id: "done", done: true }),
    lesson({ id: "past", date: "2026-07-03" }),
    lesson({ id: "far", date: "2026-12-01" }),
    lesson({ id: "bad", date: "not-a-date" })
  ], students, 30, now, 60);
  assert.equal(out.length, 0);
});

test("results are sorted by time and unknown student gets a fallback name", () => {
  const out = upcomingPushReminders([
    lesson({ id: "b", date: "2026-07-06", studentId: "missing" }),
    lesson({ id: "a", date: "2026-07-05" })
  ], students, 30, now);
  assert.deepEqual(out.map(i => i.tag), ["lesson-a", "lesson-b"]);
  assert.ok(out[1].body.includes("תלמיד"));
});

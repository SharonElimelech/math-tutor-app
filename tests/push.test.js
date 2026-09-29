import assert from "node:assert/strict";
import test from "node:test";

import { plannedReminders } from "../src/push.js";

const now = new Date("2026-07-04T12:00:00").getTime();
const students = new Map([["s1", { id: "s1", name: "דנה" }]]);
const lesson = (over = {}) => ({
  id: "l1", studentId: "s1", date: "2026-07-04", time: "16:00", done: false, paid: false, ...over
});

// ----- plannedReminders -----
const settings = { remindMinutes: 30, morningReminderTime: "08:00", payReminderMode: "afterLesson" };
const priced = new Map([["s1", { id: "s1", name: "דנה", price: 120 }]]);
const byTag = (items, prefix) => items.filter(i => i.tag.startsWith(prefix));
const ts = iso => new Date(iso).getTime();

test("planner: lesson reminder at start minus lead, with deep link and stable signature", () => {
  const items = plannedReminders([lesson()], priced, settings, now);
  const [l] = byTag(items, "lesson-");
  assert.equal(l.t, ts("2026-07-04T15:30:00"));
  assert.equal(l.title, "תזכורת שיעור");
  assert.equal(l.body, "שיעור עם דנה בשעה 16:00");
  assert.equal(l.url, "./?view=home&lesson=l1");
  assert.equal(l.sig, "l1:2026-07-04:16:00");
  // שיעור שהוזז = חתימה חדשה
  assert.equal(byTag(plannedReminders([lesson({ time: "17:00" })], priced, settings, now), "lesson-")[0].sig, "l1:2026-07-04:17:00");
});

test("planner: morning digest once per day with undone lessons, none when time is empty", () => {
  const tomorrow = [lesson({ id: "a", date: "2026-07-05" }), lesson({ id: "b", date: "2026-07-05", time: "18:00" }), lesson({ id: "c", date: "2026-07-05", done: true })];
  const [m] = byTag(plannedReminders(tomorrow, priced, settings, now), "morning-");
  assert.equal(m.t, ts("2026-07-05T08:00:00"));
  assert.equal(m.title, "תזכורות להיום");
  assert.equal(m.body, "2 שיעורים היום — שלחי תזכורות לתלמידים");
  assert.equal(m.url, "./?view=home&hub=lessons");
  assert.equal(m.sig, "morning:2026-07-05");
  assert.equal(byTag(plannedReminders(tomorrow, priced, settings, now), "morning-").length, 1);
  // שיעור אחד — ניסוח ביחיד
  assert.equal(byTag(plannedReminders([lesson({ id: "a", date: "2026-07-05" })], priced, settings, now), "morning-")[0].body, "שיעור אחד היום — שלחי תזכורת לתלמיד");
  // הבוקר של היום כבר עבר (now = 12:00) — לא נכלל
  assert.equal(byTag(plannedReminders([lesson()], priced, settings, now), "morning-").length, 0);
  // כבוי
  assert.equal(byTag(plannedReminders(tomorrow, priced, { ...settings, morningReminderTime: "" }, now), "morning-").length, 0);
});

test("planner: payment reminder follows payReminderMode", () => {
  const after = byTag(plannedReminders([lesson()], priced, settings, now), "pay-");
  assert.equal(after.length, 1);
  assert.equal(after[0].t, ts("2026-07-04T17:00:00")); // 16:00 + 60 דק'
  assert.equal(after[0].title, "תזכורת תשלום");
  assert.equal(after[0].body, "השיעור עם דנה הסתיים — שלחי תזכורת תשלום להורה");
  assert.equal(after[0].url, "./?view=home&pay=s1");
  assert.equal(after[0].sig, "pay:l1:2026-07-04:16:00");
  assert.equal(byTag(plannedReminders([lesson()], priced, { ...settings, payReminderMode: "nextMorning" }, now), "pay-")[0].t, ts("2026-07-05T08:00:00"));
  // למחרת בבוקר גם כשתזכורת הבוקר כבויה — 08:00
  assert.equal(byTag(plannedReminders([lesson()], priced, { ...settings, payReminderMode: "nextMorning", morningReminderTime: "" }, now), "pay-")[0].t, ts("2026-07-05T08:00:00"));
  assert.equal(byTag(plannedReminders([lesson()], priced, { ...settings, payReminderMode: "off" }, now), "pay-").length, 0);
  assert.equal(byTag(plannedReminders([lesson({ paid: true })], priced, settings, now), "pay-").length, 0);
  assert.equal(byTag(plannedReminders([lesson({ price: 0 })], priced, settings, now), "pay-").length, 0);
  // מחיר השיעור גובר על מחיר התלמיד; בלי שניהם — אין תזכורת
  assert.equal(byTag(plannedReminders([lesson()], new Map([["s1", { id: "s1", name: "דנה" }]]), settings, now), "pay-").length, 0);
});

test("planner: window keeps the last 30 minutes, drops older/past-horizon items, sorts by time", () => {
  const items = plannedReminders([
    lesson({ id: "recent", time: "12:20" }),          // תזכורת ב-11:50 — בתוך 30 הדקות האחרונות
    lesson({ id: "old", time: "12:00" }),             // תזכורת ב-11:30 — בדיוק על הקצה, לא נכללת
    lesson({ id: "far", date: "2026-12-01" }),        // מעבר לאופק
    lesson({ id: "bad", date: "not-a-date" })
  ], priced, settings, now, 60);
  assert.deepEqual(byTag(items, "lesson-").map(i => i.tag), ["lesson-recent"]);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].t <= items[i].t);
});

test("planner: unknown student gets a fallback name; done lessons get no lesson item", () => {
  const items = plannedReminders([lesson({ studentId: "missing" }), lesson({ id: "done", done: true })], priced, settings, now);
  assert.ok(byTag(items, "lesson-")[0].body.includes("תלמיד"));
  assert.deepEqual(byTag(items, "lesson-").map(i => i.tag), ["lesson-l1"]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { automationItems } from "../src/automation.js";
import worker, { cleanWa, takeDue } from "../push-server/worker.js";

const t = (date, hhmm) => new Date(`${date}T${hhmm}:00`).getTime();
const texts = {
  daily: (l, s) => ({ phone: s.phone, text: `day ${l.id}` }),
  pay: (l, s) => ({ phone: s.phone, text: `pay ${l.id}` }),
  weekly: (s, list) => ({ phone: s.phone, text: `week ${list.map(l => l.id).join(",")}` })
};
const studentsById = new Map([["s1", { id: "s1", phone: "+972501234567" }]]);

test("daily, payment and weekly messages get the right send windows", () => {
  // 2026-11-07 is a Saturday; lessons on Thursday, Friday, and next Monday/Tuesday
  const lessons = [
    { id: "a", studentId: "s1", date: "2026-11-05", time: "16:00", duration: 60, done: false, paid: false },
    { id: "b", studentId: "s1", date: "2026-11-06", time: "17:00", duration: 60, done: false, paid: true },
    { id: "c", studentId: "s1", date: "2026-11-09", time: "16:00", duration: 60, done: false, paid: false },
    { id: "d", studentId: "s1", date: "2026-11-10", time: "18:00", duration: 60, done: false, paid: false }
  ];
  const items = automationItems({ lessons, studentsById, now: t("2026-11-05", "08:00"), texts });
  const byId = Object.fromEntries(items.map(i => [i.id, i]));

  assert.equal(byId["d:a:2026-11-05:16:00"].after, t("2026-11-05", "09:30"));
  assert.equal(byId["d:a:2026-11-05:16:00"].until, t("2026-11-05", "16:00"));
  assert.equal(byId["p:a"].after, t("2026-11-05", "17:00"));
  assert.ok(!byId["p:b"], "paid lesson gets no payment message");
  const week = byId["w:2026-11-07:s1"];
  assert.equal(week.text, "week c,d");
  assert.equal(week.after, t("2026-11-07", "19:30"));
  assert.equal(week.until, t("2026-11-08", "08:00"));
});

test("send times follow the settings", () => {
  const lessons = [{ id: "a", studentId: "s1", date: "2026-11-05", time: "16:00", duration: 60, done: false, paid: true }];
  const times = { daily: "08:00", weekDay: 3, weekly: "21:00" }; // Wednesday 2026-11-04
  const items = automationItems({ lessons, studentsById, now: t("2026-11-04", "08:00"), texts, times });
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  assert.equal(byId["d:a:2026-11-05:16:00"].after, t("2026-11-05", "07:30"));
  assert.equal(byId["w:2026-11-04:s1"].after, t("2026-11-04", "20:30"));
});

test("server hands out each due message once, even after a resync", () => {
  const now = t("2026-11-05", "10:00");
  const items = [
    { id: "x", after: now - 1000, until: now + 1000, phone: "+972501234567", text: "hi" },
    { id: "y", after: now + 5000, until: now + 9000, phone: "+972501234567", text: "later" }
  ];
  const stored = cleanWa(items, now);
  const first = takeDue(stored, null, now);
  assert.deepEqual(first.due, [{ phone: "+972501234567", text: "hi" }]);
  // the app recomputes everything on the next save; the sent record lives apart and survives it
  const resynced = cleanWa(items, now);
  assert.deepEqual(takeDue(resynced, first.sent, now).due, []);
  assert.deepEqual(takeDue(resynced, first.sent, now + 6000).due.map(d => d.text), ["later"]);
});

test("send-all and the morning run share an id, so a lesson is reminded once", () => {
  const now = t("2026-11-11", "08:00");
  const msg = { phone: "+972501234567", text: "hi" };
  // send-all now (20-minute window) + the morning reminder for the same lesson (09:30 until 16:00)
  const items = [
    { id: "d:a", after: now - 60e3, until: now + 20 * 60e3, ...msg },
    { id: "d:a", after: t("2026-11-11", "09:30"), until: t("2026-11-11", "16:00"), ...msg }
  ];
  const first = takeDue(items, null, now);
  assert.equal(first.due.length, 1);
  assert.deepEqual(takeDue(items, first.sent, t("2026-11-11", "10:00")).due, []);
  // both windows open at once (send-all after 09:30): still one message
  assert.equal(takeDue(items, null, t("2026-11-11", "10:00")).due.length, 1);
});

test("status shows the shortcut's last run and what it delivered, without consuming anything", async () => {
  const store = new Map();
  const env = { SUBS: {
    get: async (k, type) => (store.has(k) ? (type === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
    put: async (k, v) => { store.set(k, v); }
  } };
  const call = (path, init) => worker.fetch(new Request("https://w.test" + path, init), env);
  const key = "k".repeat(30), now = Date.now();
  const item = { id: "d:a:2026-11-12:17:00", after: now - 1000, until: now + 3600e3, phone: "+972501234567", text: "hi" };
  await call("/sync", { method: "POST", body: JSON.stringify({ id: "device-123", items: [], wa: { key, items: [item] } }) });

  let s = await (await call(`/wa/status?key=${key}`)).json();
  assert.deepEqual([s.lastRun, s.sent], [null, []], "no run yet");
  assert.equal((await (await call(`/wa?key=${key}`)).json()).length, 1);
  s = await (await call(`/wa/status?key=${key}`)).json();
  assert.equal(s.lastRun.n, 1);
  assert.deepEqual(s.sent, [item.id]);
  assert.deepEqual(await (await call(`/wa?key=${key}`)).json(), [], "status did not hand the message out again");

  await call(`/wa?key=${"r".repeat(30)}`);
  assert.ok(![...store.keys()].some(k => k.includes("rrrr")), "unknown key leaves no records");
  assert.equal((await call("/wa/status?key=short")).status, 400);
});

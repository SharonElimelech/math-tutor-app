import assert from "node:assert/strict";
import test from "node:test";

import { mergeSnapshots, sameSnapshot } from "../src/sync.js";

const s = (id, name) => ({ id, name });
const snap = (students, settings = { theme: "auto" }) => ({ students, lessons: [], settings });
const names = m => m.students.map(x => `${x.id}:${x.name}`).sort();

test("additions from both devices are kept", () => {
  const base = snap([s("a", "דנה")]);
  const local = snap([s("a", "דנה"), s("b", "מהטלפון")]);
  const remote = snap([s("a", "דנה"), s("c", "מהמחשב")]);
  assert.deepEqual(names(mergeSnapshots(base, local, remote)), ["a:דנה", "b:מהטלפון", "c:מהמחשב"]);
});

test("a deletion on either device stays deleted", () => {
  const base = snap([s("a", "דנה"), s("b", "יוסי")]);
  assert.deepEqual(names(mergeSnapshots(base, snap([s("a", "דנה")]), base)), ["a:דנה"], "deleted on this device");
  assert.deepEqual(names(mergeSnapshots(base, base, snap([s("b", "יוסי")]))), ["b:יוסי"], "deleted on the other device");
});

test("an edit wins over an untouched copy; the same record edited on both — this device wins", () => {
  const base = snap([s("a", "דנה"), s("b", "יוסי")]);
  const local = snap([s("a", "דנה כהן"), s("b", "יוסי")]);
  const remote = snap([s("a", "דנה"), s("b", "יוסי לוי")]);
  assert.deepEqual(names(mergeSnapshots(base, local, remote)), ["a:דנה כהן", "b:יוסי לוי"]);
  const both = mergeSnapshots(base, snap([s("a", "מקומי")]), snap([s("a", "מרוחק")]));
  assert.deepEqual(names(both), ["a:מקומי"]);
});

test("settings merge per field", () => {
  const base = snap([], { theme: "auto", currency: "₪", payInfo: "" });
  const local = snap([], { theme: "dark", currency: "₪", payInfo: "" });
  const remote = snap([], { theme: "auto", currency: "₪", payInfo: "bit" });
  assert.deepEqual(mergeSnapshots(base, local, remote).settings, { theme: "dark", currency: "₪", payInfo: "bit" });
});

test("first sync of a device that already has data: union, this device wins on the same id", () => {
  const local = snap([s("a", "מקומי"), s("b", "רק כאן")], { theme: "dark" });
  const remote = snap([s("a", "מרוחק"), s("c", "רק שם")], { theme: "light" });
  const m = mergeSnapshots(null, local, remote);
  assert.deepEqual(names(m), ["a:מקומי", "b:רק כאן", "c:רק שם"]);
  assert.equal(m.settings.theme, "dark");
});

test("sameSnapshot ignores key order and spots real changes", () => {
  const a = snap([{ id: "a", name: "x", price: 1 }]);
  assert.ok(sameSnapshot(a, snap([{ price: 1, name: "x", id: "a" }])));
  assert.ok(!sameSnapshot(a, snap([{ id: "a", name: "y", price: 1 }])));
});

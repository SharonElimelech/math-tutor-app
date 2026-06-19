import assert from "node:assert/strict";
import test from "node:test";

import { createSnapshot } from "../src/data.js";
import { AppStorage, STATE_KEY } from "../src/storage.js";

class MemoryStorage {
  values = new Map();
  failWrites = false;
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

const student = { id: "s1", name: "דנה", parentName: "", phone: "", price: 120 };
const lesson = { id: "l1", studentId: "s1", date: "2026-06-20", time: "16:00", topic: "", duration: 60, done: false, paid: false };

test("storage migrates legacy keys into a validated state", () => {
  const memory = new MemoryStorage();
  memory.values.set("mt_students", JSON.stringify([student]));
  memory.values.set("mt_lessons", JSON.stringify([lesson]));
  memory.values.set("mt_settings", JSON.stringify({ currency: "₪" }));

  const result = new AppStorage(memory).load();
  assert.equal(result.needsPersist, true);
  assert.equal(result.error, null);
  assert.equal(result.state.students[0].name, "דנה");
});

test("storage writes one atomic snapshot key", () => {
  const memory = new MemoryStorage();
  const storage = new AppStorage(memory);
  storage.save(createSnapshot([student], [lesson], {}));

  assert.ok(memory.values.has(STATE_KEY));
  assert.equal(memory.values.has("mt_students"), false);
  assert.equal(JSON.parse(memory.values.get(STATE_KEY)).lessons.length, 1);
});

test("storage returns a safe state when persisted data is malformed", () => {
  const memory = new MemoryStorage();
  memory.values.set(STATE_KEY, "not-json");
  const result = new AppStorage(memory).load();

  assert.ok(result.error);
  assert.deepEqual(result.state.students, []);
  assert.deepEqual(result.state.lessons, []);
});

test("storage surfaces write failures", () => {
  const memory = new MemoryStorage();
  memory.failWrites = true;
  assert.throws(() => new AppStorage(memory).save(createSnapshot([], [], {})), /quota exceeded/);
});

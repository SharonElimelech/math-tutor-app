import assert from "node:assert/strict";
import test from "node:test";

import { holidayFor, monthKey, ymd } from "../src/calendar.js";

test("calendar keys use local dates without UTC drift", () => {
  const date = new Date(2026, 5, 9, 23, 30);
  assert.equal(ymd(date), "2026-06-09");
  assert.equal(monthKey(date), "2026-06");
});

test("holiday lookup identifies major Hebrew-calendar dates", () => {
  assert.equal(holidayFor("2025-09-23")?.name, "ראש השנה");
  assert.equal(holidayFor("2025-09-23")?.chag, true);
});

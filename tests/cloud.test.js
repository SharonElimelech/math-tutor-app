import assert from "node:assert/strict";
import test from "node:test";

import { newCode, validCode, formatCode, cloudKeys, seal, unseal } from "../src/cloud.js";

test("recovery code survives sloppy typing and still opens the backup", async () => {
  const code = newCode();
  assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
  const typed = code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
  assert.ok(validCode(typed));
  assert.equal(formatCode(typed), code);

  const value = { students: [{ id: "s1", name: "דנה" }], lessons: [], waKey: "k" };
  const a = await cloudKeys(code), b = await cloudKeys(typed);
  assert.equal(a.id, b.id);
  assert.deepEqual(await unseal(await seal(value, a.key), b.key), value);
});

test("another code finds another slot and cannot read this backup", async () => {
  const mine = await cloudKeys(newCode()), other = await cloudKeys(newCode());
  assert.notEqual(mine.id, other.id);
  assert.match(mine.id, /^[0-9a-f]{64}$/);
  await assert.rejects(unseal(await seal({ x: 1 }, mine.key), other.key));
  assert.ok(!validCode("ABCD-EFGH"), "short code rejected");
  await assert.rejects(cloudKeys("too short"));
});

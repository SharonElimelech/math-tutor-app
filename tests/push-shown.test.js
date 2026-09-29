import assert from "node:assert/strict";
import test from "node:test";

import { markShown, pruneShown, shownSigs } from "../src/push.js";

// Cache API מינימלי בזיכרון: מפתחות יחסיים נפתרים מול כתובת האפליקציה, כמו בדפדפן
function fakeCaches() {
  const store = new Map();
  const base = "https://example.test/math-tutor-app/";
  const href = key => (typeof key === "string" ? new URL(key, base).href : key.url);
  const cache = {
    async keys() { return [...store.keys()].map(url => ({ url })); },
    async match(key) { return store.has(href(key)) ? new Response(store.get(href(key))) : undefined; },
    async put(key, res) { store.set(href(key), await res.text()); },
    async delete(key) { return store.delete(href(key)); }
  };
  return { open: async () => cache, cache };
}

test("markShown / shownSigs round-trip a signature with colons", async () => {
  globalThis.caches = fakeCaches();
  await markShown("l1:2026-07-04:16:00");
  assert.deepEqual([...await shownSigs()], ["l1:2026-07-04:16:00"]);
});

test("pruneShown drops markers older than a day and leaves the reminders list alone", async () => {
  const fake = fakeCaches();
  globalThis.caches = fake;
  const now = Date.parse("2026-07-04T12:00:00Z");
  await fake.cache.put("shown/" + encodeURIComponent("old:2026-07-01:16:00"), new Response(String(now - 2 * 86400e3)));
  await fake.cache.put("shown/" + encodeURIComponent("fresh:2026-07-04:10:00"), new Response(String(now - 3600e3)));
  await fake.cache.put("reminders", new Response("[]"));
  await pruneShown(now);
  assert.deepEqual([...await shownSigs()], ["fresh:2026-07-04:10:00"]);
  assert.ok(await fake.cache.match("reminders"));
});

test("without a Cache API the helpers are silent no-ops", async () => {
  delete globalThis.caches;
  await markShown("x");
  await pruneShown();
  assert.deepEqual([...await shownSigs()], []);
});

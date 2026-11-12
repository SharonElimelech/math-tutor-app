import assert from "node:assert/strict";
import test from "node:test";

import worker, { kvStore } from "../push-server/worker.js";
import { memoryEnv } from "./d1-memory.js";

const PROJECT = "tutor-test";
const b64u = v => Buffer.from(JSON.stringify(v)).toString("base64url");
const google = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...await crypto.subtle.exportKey("jwk", google.publicKey), kid: "k1", alg: "RS256", use: "sig" };
// השרת מושך את המפתחות הציבוריים של Google — בבדיקה הוא מקבל את המפתח שלנו
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).includes("securetoken@system.gserviceaccount.com")
  ? Response.json({ keys: [jwk] }, { headers: { "Cache-Control": "max-age=3600" } })
  : realFetch(url, init);

async function tokenFor(uid) {
  const t = Math.floor(Date.now() / 1000);
  const body = `${b64u({ alg: "RS256", kid: "k1" })}.${b64u({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: t, auth_time: t, exp: t + 3600 })}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", google.privateKey, new TextEncoder().encode(body));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

function client(env, ip = "1.1.1.1") {
  return async (uid, method, path, body) => {
    const headers = { "Content-Type": "application/json", "CF-Connecting-IP": ip };
    if (uid) headers.Authorization = `Bearer ${await tokenFor(uid)}`;
    const res = await worker.fetch(new Request("https://w.test" + path, { method, headers, body: body && JSON.stringify(body) }), env);
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* טקסט */ }
    return { status: res.status, json, text };
  };
}
const snapshot = name => ({ students: [{ id: "s1", name }], lessons: [], settings: {} });

test("no valid login, no data; accounts off until Firebase is configured", async () => {
  const call = client(memoryEnv({ FIREBASE_PROJECT_ID: PROJECT }));
  assert.equal((await call(null, "GET", "/me/data")).status, 401);
  const bad = await worker.fetch(new Request("https://w.test/me/data", { headers: { Authorization: "Bearer x.y.z" } }), memoryEnv({ FIREBASE_PROJECT_ID: PROJECT }));
  assert.equal(bad.status, 401);
  assert.equal((await client(memoryEnv())("a", "GET", "/me/data")).status, 503);
});

test("each user sees only their own data, and a stale device cannot overwrite a newer save", async () => {
  const env = memoryEnv({ FIREBASE_PROJECT_ID: PROJECT }), call = client(env);
  assert.deepEqual((await call("alice", "GET", "/me/data")).json, { data: null, version: 0 });

  const first = await call("alice", "PUT", "/me/data", { baseVersion: 0, data: snapshot("דנה") });
  assert.equal(first.json.version, 1);
  const got = await call("alice", "GET", "/me/data");
  assert.equal(got.json.data.students[0].name, "דנה");
  assert.equal(got.json.version, 1);

  // מכשיר שני שעוד לא ראה את גרסה 1
  const stale = await call("alice", "PUT", "/me/data", { baseVersion: 0, data: snapshot("אחר") });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.version, 1);
  assert.equal(stale.json.data.students[0].name, "דנה", "the conflict returns the newer data to merge");
  assert.equal((await call("alice", "PUT", "/me/data", { baseVersion: 1, data: snapshot("דנה כהן") })).json.version, 2);

  // משתמש אחר: לא רואה ולא נוגע
  assert.deepEqual((await call("bob", "GET", "/me/data")).json, { data: null, version: 0 });
  await call("bob", "PUT", "/me/data", { baseVersion: 0, data: snapshot("של בוב") });
  assert.equal((await call("alice", "GET", "/me/data")).json.data.students[0].name, "דנה כהן");

  assert.equal((await call("alice", "PUT", "/me/data", { baseVersion: 2, data: { students: "x" } })).status, 400);
  assert.equal((await call("alice", "PUT", "/me/data", { baseVersion: -1, data: snapshot("x") })).status, 400);
});

test("the WhatsApp key belongs to one account and follows it to new devices", async () => {
  const env = memoryEnv({ FIREBASE_PROJECT_ID: PROJECT }), call = client(env);
  const k1 = (await call("alice", "GET", "/me/wa-key")).json.key;
  assert.match(k1, /^[\w-]{20,80}$/);
  assert.equal((await call("alice", "GET", "/me/wa-key")).json.key, k1, "same key on every device");

  const existing = "85355c31-3a31-4551-96d9-60eaf8cdb161";
  assert.equal((await call("alice", "PUT", "/me/wa-key", { key: existing })).json.key, existing, "adopt the link already in the shortcut");
  assert.equal((await call("bob", "PUT", "/me/wa-key", { key: existing })).status, 409, "nobody else can claim it");
  assert.equal((await call("alice", "PUT", "/me/wa-key", { key: "short" })).status, 400);
});

test("deleting the account removes everything the server holds for it", async () => {
  const env = memoryEnv({ FIREBASE_PROJECT_ID: PROJECT }), call = client(env), kv = kvStore(env);
  await call("alice", "PUT", "/me/data", { baseVersion: 0, data: snapshot("דנה") });
  const key = (await call("alice", "GET", "/me/wa-key")).json.key;
  await kv.put("wa:" + key, "[]");
  await call("bob", "PUT", "/me/data", { baseVersion: 0, data: snapshot("של בוב") });

  assert.equal((await call("alice", "DELETE", "/me")).json.deleted, true);
  assert.deepEqual((await call("alice", "GET", "/me/data")).json, { data: null, version: 0 });
  assert.equal(await kv.get("wa:" + key), null);
  assert.equal((await call("bob", "GET", "/me/data")).json.version, 1, "other accounts untouched");
});

test("too many requests from one address are refused for a minute", async () => {
  const env = memoryEnv({ FIREBASE_PROJECT_ID: PROJECT }), call = client(env, "9.9.9.9");
  const codes = [];
  for (let i = 0; i < 31; i++) {
    const r = await worker.fetch(new Request("https://w.test/sync", { method: "POST", headers: { "CF-Connecting-IP": "9.9.9.9" }, body: JSON.stringify({ id: "device-123", items: [] }) }), env);
    codes.push(r.status);
  }
  assert.deepEqual([codes[0], codes[29], codes[30]], [200, 200, 429]);
  const other = await worker.fetch(new Request("https://w.test/sync", { method: "POST", headers: { "CF-Connecting-IP": "8.8.8.8" }, body: JSON.stringify({ id: "device-123", items: [] }) }), env);
  assert.equal(other.status, 200, "other addresses are not affected");
  assert.equal((await call("alice", "GET", "/me/data")).status, 200, "limits are per route");
});

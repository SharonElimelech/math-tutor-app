import assert from "node:assert/strict";
import test from "node:test";

import { verifyIdToken } from "../push-server/auth.js";

const PROJECT = "tutor-test";
const b64u = v => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const pair = () => crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);

async function setup() {
  const google = await pair(), attacker = await pair();
  const jwk = { ...await crypto.subtle.exportKey("jwk", google.publicKey), kid: "k1", alg: "RS256", use: "sig" };
  const keys = async () => [jwk];
  const now = Date.now(), t = Math.floor(now / 1000);
  const good = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: "user-a", iat: t - 10, auth_time: t - 10, exp: t + 3600, email: "a@x.test" };
  const sign = async (claims, { key = google.privateKey, header = { alg: "RS256", kid: "k1" } } = {}) => {
    const body = `${b64u(header)}.${b64u(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
    return `${body}.${Buffer.from(sig).toString("base64url")}`;
  };
  return { keys, now, good, sign, attacker };
}

test("a real Firebase token for our project gives the user id", async () => {
  const { keys, now, good, sign } = await setup();
  assert.deepEqual(await verifyIdToken(await sign(good), PROJECT, { now, keys }), { uid: "user-a", email: "a@x.test" });
});

test("forged, expired, foreign or malformed tokens are rejected", async () => {
  const { keys, now, good, sign, attacker } = await setup();
  const bad = {
    "signed by someone else": await sign(good, { key: attacker.privateKey }),
    "edited after signing": (await sign(good)).replace(/\.[^.]+\./, `.${b64u({ ...good, sub: "user-b" })}.`),
    "expired": await sign({ ...good, exp: Math.floor(now / 1000) - 1 }),
    "other project": await sign({ ...good, aud: "someone-else" }),
    "wrong issuer": await sign({ ...good, iss: "https://evil.test" }),
    "no user": await sign({ ...good, sub: "" }),
    "unknown key id": await sign(good, { header: { alg: "RS256", kid: "nope" } }),
    "alg none": `${b64u({ alg: "none", kid: "k1" })}.${b64u(good)}.`,
    "garbage": "not-a-token"
  };
  for (const [name, token] of Object.entries(bad)) {
    await assert.rejects(verifyIdToken(token, PROJECT, { now, keys }), Error, name);
  }
});

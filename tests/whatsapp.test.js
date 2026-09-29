import assert from "node:assert/strict";
import test from "node:test";

import { normalizePhone, whatsappLinks } from "../src/whatsapp.js";

test("Israeli numbers normalize to international digits", () => {
  assert.equal(normalizePhone("050-123 4567"), "972501234567");
  assert.equal(normalizePhone("+972 50 123 4567"), "972501234567");
  assert.equal(normalizePhone("00972501234567"), "972501234567");
  assert.equal(normalizePhone("972501234567"), "972501234567");
  assert.equal(normalizePhone(""), "");
  assert.equal(normalizePhone(" - "), "");
  assert.equal(normalizePhone(undefined), "");
});

test("links: web tab, same-context scheme, Android intent with a web fallback", () => {
  const msg = "שלום רונית,\nתזכורת לשיעור";
  const text = encodeURIComponent(msg);
  const l = whatsappLinks("0501234567", msg);
  assert.equal(l.web, `https://wa.me/972501234567?text=${text}`);
  assert.equal(l.scheme, `whatsapp://send?phone=972501234567&text=${text}`);
  assert.equal(
    l.intent,
    `intent://send?phone=972501234567&text=${text}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(l.web)};end`
  );
});

test("empty message omits the text parameter everywhere", () => {
  const l = whatsappLinks("0501234567", "");
  assert.equal(l.web, "https://wa.me/972501234567");
  assert.equal(l.scheme, "whatsapp://send?phone=972501234567");
  assert.ok(!l.intent.includes("text="));
  assert.ok(l.intent.startsWith("intent://send?phone=972501234567#Intent;"));
});

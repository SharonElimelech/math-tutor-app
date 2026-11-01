import assert from "node:assert/strict";
import test from "node:test";

import { fillTemplate, normalizePhone, shortcutRunUrl, whatsappLinks } from "../src/whatsapp.js";

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

test("message templates fill placeholders and drop the space before an empty one", () => {
  const vars = { הורה: "", תלמיד: "דני", סכום: "240 ₪" };
  assert.equal(fillTemplate("שלום {הורה},\n{תלמיד} חייב {סכום}", vars), "שלום,\nדני חייב 240 ₪");
  assert.equal(fillTemplate("שלום {הורה},", { הורה: "רונית" }), "שלום רונית,");
  assert.equal(fillTemplate("{לא קיים} נשאר", vars), "{לא קיים} נשאר");
  assert.equal(fillTemplate("{constructor}", vars), "{constructor}");
  assert.equal(fillTemplate("{שיעורים} שיעורים", { שיעורים: 0 }), "0 שיעורים");
});

test("shortcut run URL carries the whole message list as JSON text input", () => {
  const items = [{ name: "דני", phone: "+972501234567", text: "שלום דני,\nתזכורת לשיעור מחר בשעה 16:00." }];
  const url = new URL(shortcutRunUrl("תזכורות המורה", items));
  assert.equal(url.protocol, "shortcuts:");
  assert.equal(url.searchParams.get("name"), "תזכורות המורה");
  assert.equal(url.searchParams.get("input"), "text");
  assert.deepEqual(JSON.parse(url.searchParams.get("text")), items);
});

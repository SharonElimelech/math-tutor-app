import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(join(root, file), "utf8");

test("viewport and live regions preserve accessible interaction", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale/i);
  assert.match(html, /id="toastWrap"[^>]+aria-live="polite"/);
  assert.match(html, /id="modal"[^>]+aria-labelledby="modalTitle"/);
  assert.match(html, /id="confirmDialog"[^>]+aria-describedby="confirmMessage"/);
});

test("generated interactive surfaces use native controls", () => {
  const source = read("app.js");
  assert.doesNotMatch(source, /<div[^>]+onclick=/i);
  assert.doesNotMatch(source, /\bconfirm\s*\(/);
  assert.match(source, /<button type="button" class="picker-row/);
  assert.match(source, /<button type="button" class="lesson-open/);
  assert.match(source, /<button type="button" class="\$\{cls\}" aria-label=/);
});

test("service worker scopes document fallback to navigation", () => {
  const worker = read("service-worker.js");
  assert.match(worker, /e\.request\.mode === "navigate"/);
  assert.match(worker, /url\.origin === self\.location\.origin/);
  assert.doesNotMatch(worker, /r \|\| caches\.match\("index\.html"\)/);
});

test("lesson reminders use supported service-worker notifications", () => {
  const source = read("app.js");
  assert.match(source, /reg\.showNotification/);
  assert.doesNotMatch(source, /TimestampTrigger|showTrigger/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /exportCalendar/);
});

test("payment queue is semantic, touch friendly, and responsive", () => {
  const source = read("app.js");
  const styles = read("styles.css");
  assert.match(source, /<article class="payment-account" aria-labelledby=/);
  assert.match(source, /<ul class="payment-lessons" aria-label=/);
  assert.match(source, /class="payment-mark"[^>]+aria-label=/);
  assert.doesNotMatch(source, /class="finance-overview"|class="paid-list"/);
  assert.match(styles, /\.payment-mark\s*\{[^}]*min-height:\s*44px/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.payment-actions\s*\{[^}]*flex-direction:\s*column/);
});

test("high-end redesign keeps every product surface structured", () => {
  const html = read("index.html");
  const source = read("app.js");
  const styles = read("styles.css");

  assert.match(html, /class="app-brand"/);
  assert.doesNotMatch(html, /class="eyebrow"/);
  assert.match(source, /class="agenda-item"/);
  assert.match(source, /class="student-card"/);
  assert.match(source, /class="income-overview"/);
  assert.match(source, /class="settings-group-head"/);
  assert.match(source, /<section class="day-group" aria-labelledby=/);
  assert.doesNotMatch(styles, /transition:\s*all|ease-in-out/);
  assert.match(styles, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.income-overview\s*\{[^}]*grid-template-columns:\s*1fr/);
});

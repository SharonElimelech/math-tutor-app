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
  assert.match(source, /<button type="button" class="\$\{cls\}"[^>]* aria-label=/);
});

test("reminder rows are a labelled list with reachable touch targets", () => {
  const source = read("app.js");
  const styles = read("styles.css");
  assert.match(source, /<section class="reminder-hub" aria-labelledby="hubTitle">/);
  assert.match(source, /<ul class="remind-list">/);
  assert.match(source, /<li class="remind-row">/);
  assert.doesNotMatch(source, /<article class="remind-row">/);
  assert.match(styles, /\.remind-btn\s*\{[^}]*min-height:\s*44px/s);
});

test("lesson and payment reminders live in one hub, sent one at a time", () => {
  const html = read("index.html");
  const source = read("app.js");
  // מקום אחד: אין עוד רשימת תזכורות נפרדת ו-aside גבייה נפרד
  assert.match(html, /id="reminderHub"/);
  assert.doesNotMatch(html, /id="reminderList"|id="paymentAlerts"|home-secondary/);
  // שתי הקבוצות גלויות יחד, כל אחת עם כותרת משלה
  assert.match(source, /id: "hubLessonsTitle"/);
  assert.match(source, /id: "hubMoneyTitle"/);
  // אין "שליחה לכולם": וואטסאפ פותח צ'אט אחד בכל פעם
  assert.doesNotMatch(source, /startLessonReminders|startDebtReminders|startQueue|reminderQueue|reminders-bulk/);
});

test("the reminder hub opens the calendar screen and collapses natively", () => {
  const html = read("index.html");
  const source = read("app.js");
  // ראש דף היומן — התזכורות לפני הלוח, לא אחריו ולא במסך אחר
  const hub = html.indexOf('id="reminderHub"');
  const calendar = html.indexOf('id="homeCalendar"');
  assert.ok(hub > -1 && calendar > -1 && hub < calendar);
  assert.equal(html.match(/id="reminderHub"/g).length, 1);
  // קיפול דרך details/summary — בלי מצב פתיחה שצריך לתחזק ביד
  assert.match(source, /<details class="hub-box"/);
  assert.match(source, /<summary class="hub-summary">/);
  // הבאדג' בכותרת הוסר — אריחי המונים של ה-hub מציגים את אותו מידע בלי חיתוך
  assert.doesNotMatch(html, /id="reminderBadge"/);
  assert.doesNotMatch(source, /goReminders|renderHeader/);
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
  // Home embeds the calendar (week strip + day agenda), like Google Calendar.
  assert.match(html, /id="homeCalendar"/);
  assert.match(source, /class="week-strip"/);
  // הוספת תלמיד זמינה ישירות מהיומן, לא רק ממסך התלמידים
  assert.match(source, /class="btn btn-light cal-add-student"[^>]+App\.openStudentForm\(\)/);
  assert.match(source, /class="agenda-block /);
  assert.match(source, /class="student-card"/);
  assert.match(source, /class="income-overview"/);
  assert.match(source, /class="settings-group-head"/);
  assert.match(source, /<section class="day-group" aria-labelledby=/);
  assert.doesNotMatch(styles, /transition:\s*all|ease-in-out/);
  assert.match(styles, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.income-overview\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("v4 shell: one home screen, four tabs, a contextual FAB and top bar", () => {
  const html = read("index.html");
  const source = read("app.js");
  const styles = read("styles.css");
  // מסך "סיכום" מוזג לתוך "היום" — אין יותר שני מסכי בית
  assert.doesNotMatch(html, /id="view-overview"|data-view="overview"/);
  assert.equal(html.match(/class="nav-btn/g).length, 4);
  // רצועת היום לפני מרכז התזכורות, ושניהם לפני היומן
  const strip = html.indexOf('id="todayStrip"'), hub = html.indexOf('id="reminderHub"'), cal = html.indexOf('id="homeCalendar"');
  assert.ok(strip > -1 && strip < hub && hub < cal);
  // FAB: כפתור אמיתי שממופה לפעולה של המסך הפעיל, ונעלם כשמודאל פתוח
  assert.match(html, /<button id="fab" class="fab" type="button"[^>]+onclick="App\.fabAction\(\)"/);
  assert.match(source, /const FAB_BY_VIEW = \{/);
  assert.match(styles, /body\.modal-open \.fab \{ display: none; \}/);
  // כותרת הקשרית במקום כרטיס מותג
  assert.match(html, /id="topbarContext"/);
  assert.match(source, /function updateChrome\(/);
});

test("v4 calendar: three-day grid, smart scroll, payment state on blocks", () => {
  const source = read("app.js");
  const styles = read("styles.css");
  assert.match(source, /function renderWeekGrid\(day, span = 7\)/);
  assert.match(source, /seg\("3d", "3 ימים"\)/);
  assert.match(source, /function smartCalTop\(/);
  assert.match(source, /const lessonStateClass = /);
  assert.match(styles, /\.wg-block\.is-done\.is-unpaid/);
  assert.match(styles, /grid-template-columns: repeat\(var\(--wg-cols, 7\), minmax\(0, 1fr\)\)/);
});

test("v4 income chart is SVG driven by design tokens, with hover and keyboard access", () => {
  const html = read("index.html");
  const source = read("app.js");
  assert.doesNotMatch(html, /<canvas id="incomeChart"/);
  assert.match(html, /<div id="incomeChart" class="income-chart" role="img"/);
  assert.match(source, /<svg viewBox="0 0 \$\{W\} \$\{H\}" class="chart-svg" role="list"/);
  assert.match(source, /class="chart-bar [^>]*tabindex="0" role="listitem"/);
  assert.doesNotMatch(source, /getContext\("2d"\)/);
});

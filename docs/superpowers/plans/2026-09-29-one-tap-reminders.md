# One-Tap Reminders (Morning + Payment Push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The teacher gets a push at the right moment (morning digest, after each lesson for payment, before a lesson as today), taps it, lands on the reminder hub with the right row highlighted, and one more tap opens WhatsApp with the message ready.

**Architecture:** One pure planner in `src/push.js` (`plannedReminders`) produces every reminder item `{t, title, body, tag, url, sig}` for the next 60 days. The existing Cloudflare Worker (unchanged) pushes when `t` arrives; the service worker shows the item from the `mt-push-data` cache. The in-page timer is only a fallback when push is not healthy. Two new settings choose the morning time and the payment-reminder timing. Deep-link params (`hub=lessons`, `pay=<studentId>`) open the hub and highlight the target.

**Tech Stack:** Vanilla ES modules (no bundler), `node --test` + `node:assert/strict`, Cache API, Web Push (existing worker), GitHub Pages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-29-one-tap-reminders-design.md`. Base: `main` at v4.0.1 (already contains the shared `shown/<sig>` dedup and the "server owns lesson reminders while push is healthy" rule).
- Server (`push-server/worker.js`) must NOT change.
- Working tree files are CRLF; git stores LF. Keep whatever line ending the file already has (never mix).
- Comments in Hebrew explaining WHY, matching the codebase. UI copy in Hebrew, feminine address ("שלחי", "פתחי").
- Every inline `onclick="App.x()"` must be exported in the `return { ... }` block at the end of `app.js` (smoke test enforces it).
- New settings must be added to BOTH `DEFAULT_SETTINGS` and the object returned by `normalizeSettings` in `src/data.js`, or they are silently dropped on save.
- Whenever `app.js` or `styles.css` changes in a way clients must receive: bump `app.js?v=` / `styles.css?v=` in BOTH `index.html` and the `ASSETS` list of `service-worker.js`, and bump `CACHE` in `service-worker.js`. Final values for this feature: `app.js?v=75`, `styles.css?v=62`, `CACHE = "morti-v4.1.0"`, `APP_VERSION = "4.1.0"`, `package.json` version `4.1.0` (Task 6 does all bumps at once).
- Run `npm run check` (syntax + all tests) before every commit.
- Work on branch `feat/one-tap-reminders` created from `main`.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the branch from main**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/one-tap-reminders
```

- [ ] **Step 2: Confirm the baseline is green**

Run: `npm run check`
Expected: `pass 56`, `fail 0`.

- [ ] **Step 3: Commit the spec and this plan (untracked on main)**

```bash
git add docs/superpowers/specs/2026-09-29-one-tap-reminders-design.md docs/superpowers/plans/2026-09-29-one-tap-reminders.md
git commit -m "docs: design spec and plan for one-tap reminders"
```

---

### Task 1: `plannedReminders` planner (pure) in `src/push.js`

**Files:**
- Modify: `src/push.js` (add the planner next to `upcomingPushReminders`; do NOT remove the old function yet)
- Modify: `tests/push.test.js` (add planner tests; keep the old tests for now)

**Interfaces:**
- Consumes: `reminderSignature(l)`, `paymentSignature(l)` from `src/reminders.js`; `ymd(date)` from `src/calendar.js` (returns local `YYYY-MM-DD`).
- Produces: `export function plannedReminders(lessons, studentsById, settings, now = Date.now(), horizonDays = 60)` returning `Array<{ t: number, title: string, body: string, tag: string, url: string, sig: string }>` sorted by `t`, only items with `now - 30min < t <= now + horizonDays`. Settings read: `remindMinutes` (default 30), `morningReminderTime` (`"HH:MM"` or `""`), `payReminderMode` (`"afterLesson" | "nextMorning" | "off"`, default `"afterLesson"`).

- [ ] **Step 1: Write the failing tests**

In `tests/push.test.js` change the import line to:

```js
import { plannedReminders, upcomingPushReminders } from "../src/push.js";
```

and append:

```js
// ----- plannedReminders -----
const settings = { remindMinutes: 30, morningReminderTime: "08:00", payReminderMode: "afterLesson" };
const priced = new Map([["s1", { id: "s1", name: "דנה", price: 120 }]]);
const byTag = (items, prefix) => items.filter(i => i.tag.startsWith(prefix));
const ts = iso => new Date(iso).getTime();

test("planner: lesson reminder at start minus lead, with deep link and stable signature", () => {
  const items = plannedReminders([lesson()], priced, settings, now);
  const [l] = byTag(items, "lesson-");
  assert.equal(l.t, ts("2026-07-04T15:30:00"));
  assert.equal(l.title, "תזכורת שיעור");
  assert.equal(l.body, "שיעור עם דנה בשעה 16:00");
  assert.equal(l.url, "./?view=home&lesson=l1");
  assert.equal(l.sig, "l1:2026-07-04:16:00");
  // שיעור שהוזז = חתימה חדשה
  assert.equal(byTag(plannedReminders([lesson({ time: "17:00" })], priced, settings, now), "lesson-")[0].sig, "l1:2026-07-04:17:00");
});

test("planner: morning digest once per day with undone lessons, none when time is empty", () => {
  const tomorrow = [lesson({ id: "a", date: "2026-07-05" }), lesson({ id: "b", date: "2026-07-05", time: "18:00" }), lesson({ id: "c", date: "2026-07-05", done: true })];
  const [m] = byTag(plannedReminders(tomorrow, priced, settings, now), "morning-");
  assert.equal(m.t, ts("2026-07-05T08:00:00"));
  assert.equal(m.title, "תזכורות להיום");
  assert.equal(m.body, "2 שיעורים היום — שלחי תזכורות לתלמידים");
  assert.equal(m.url, "./?view=home&hub=lessons");
  assert.equal(m.sig, "morning:2026-07-05");
  assert.equal(byTag(plannedReminders(tomorrow, priced, settings, now), "morning-").length, 1);
  // שיעור אחד — ניסוח ביחיד
  assert.equal(byTag(plannedReminders([lesson({ id: "a", date: "2026-07-05" })], priced, settings, now), "morning-")[0].body, "שיעור אחד היום — שלחי תזכורת לתלמיד");
  // הבוקר של היום כבר עבר (now = 12:00) — לא נכלל
  assert.equal(byTag(plannedReminders([lesson()], priced, settings, now), "morning-").length, 0);
  // כבוי
  assert.equal(byTag(plannedReminders(tomorrow, priced, { ...settings, morningReminderTime: "" }, now), "morning-").length, 0);
});

test("planner: payment reminder follows payReminderMode", () => {
  const after = byTag(plannedReminders([lesson()], priced, settings, now), "pay-");
  assert.equal(after.length, 1);
  assert.equal(after[0].t, ts("2026-07-04T17:00:00")); // 16:00 + 60 דק'
  assert.equal(after[0].title, "תזכורת תשלום");
  assert.equal(after[0].body, "השיעור עם דנה הסתיים — שלחי תזכורת תשלום להורה");
  assert.equal(after[0].url, "./?view=home&pay=s1");
  assert.equal(after[0].sig, "pay:l1:2026-07-04:16:00");
  assert.equal(byTag(plannedReminders([lesson()], priced, { ...settings, payReminderMode: "nextMorning" }, now), "pay-")[0].t, ts("2026-07-05T08:00:00"));
  // למחרת בבוקר גם כשתזכורת הבוקר כבויה — 08:00
  assert.equal(byTag(plannedReminders([lesson()], priced, { ...settings, payReminderMode: "nextMorning", morningReminderTime: "" }, now), "pay-")[0].t, ts("2026-07-05T08:00:00"));
  assert.equal(byTag(plannedReminders([lesson()], priced, { ...settings, payReminderMode: "off" }, now), "pay-").length, 0);
  assert.equal(byTag(plannedReminders([lesson({ paid: true })], priced, settings, now), "pay-").length, 0);
  assert.equal(byTag(plannedReminders([lesson({ price: 0 })], priced, settings, now), "pay-").length, 0);
  // מחיר השיעור גובר על מחיר התלמיד; בלי שניהם — אין תזכורת
  assert.equal(byTag(plannedReminders([lesson()], new Map([["s1", { id: "s1", name: "דנה" }]]), settings, now), "pay-").length, 0);
});

test("planner: window keeps the last 30 minutes, drops older/past-horizon items, sorts by time", () => {
  const items = plannedReminders([
    lesson({ id: "recent", time: "12:20" }),          // תזכורת ב-11:50 — בתוך 30 הדקות האחרונות
    lesson({ id: "old", time: "12:00" }),             // תזכורת ב-11:30 — בדיוק על הקצה, לא נכללת
    lesson({ id: "far", date: "2026-12-01" }),        // מעבר לאופק
    lesson({ id: "bad", date: "not-a-date" })
  ], priced, settings, now, 60);
  assert.deepEqual(byTag(items, "lesson-").map(i => i.tag), ["lesson-recent"]);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].t <= items[i].t);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/push.test.js`
Expected: FAIL with `SyntaxError: The requested module '../src/push.js' does not provide an export named 'plannedReminders'`.

- [ ] **Step 3: Implement the planner**

In `src/push.js`, change the first import line and add a second import:

```js
import { paymentSignature, reminderSignature } from "./reminders.js";
import { ymd } from "./calendar.js";
```

Add directly below `upcomingPushReminders` (keep that function for now):

```js
// ----- כל התזכורות במקום אחד -----
// מקור אמת יחיד לשלושת סוגי ה-push: לפני שיעור, בוקר ("X שיעורים היום") ותשלום אחרי שיעור.
// גם הטיימר בדף (גיבוי) וגם הסנכרון לשרת ולמטמון צורכים את אותה רשימה — שני חישובים שונים
// היו הסיבה לתזכורת הכפולה ב-v4.0.0. חלון: 30 דק' אחורה (ה-SW מציג מהמטמון פריטים שכבר עברו)
// ועד האופק קדימה.
const atTime = (date, hhmm) => new Date(`${date}T${hhmm || "00:00"}:00`).getTime();
const nextDay = date => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return ymd(d);
};
const morningBody = n => n === 1 ? "שיעור אחד היום — שלחי תזכורת לתלמיד" : `${n} שיעורים היום — שלחי תזכורות לתלמידים`;

export function plannedReminders(lessons, studentsById, settings, now = Date.now(), horizonDays = 60) {
  const lead = Math.max(0, Number(settings.remindMinutes ?? 30) || 0) * MINUTE;
  const morning = String(settings.morningReminderTime ?? "");
  const payMode = settings.payReminderMode ?? "afterLesson";
  const from = now - 30 * MINUTE;
  const to = now + horizonDays * 24 * 60 * MINUTE;
  const out = [];
  const perDay = new Map();
  for (const l of lessons) {
    const start = atTime(l.date, l.time);
    if (!Number.isFinite(start)) continue;
    const student = studentsById.get(l.studentId);
    const name = student?.name || "תלמיד";
    if (!l.done) {
      out.push({
        t: start - lead,
        title: "תזכורת שיעור",
        body: `שיעור עם ${name} בשעה ${l.time}`,
        tag: `lesson-${l.id}`,
        url: `./?view=home&lesson=${encodeURIComponent(l.id)}`,
        sig: reminderSignature(l)
      });
      perDay.set(l.date, (perDay.get(l.date) || 0) + 1);
    }
    // תשלום: לא דורש "בוצע" — ה-push עצמו הוא הבקשה לאשר את השיעור ולשלוח תזכורת
    const price = Number(l.price ?? student?.price) || 0;
    if (!l.paid && price > 0 && payMode !== "off") {
      const t = payMode === "nextMorning"
        ? atTime(nextDay(l.date), morning || "08:00")
        : start + (Number(l.duration) || 60) * MINUTE;
      out.push({
        t,
        title: "תזכורת תשלום",
        body: `השיעור עם ${name} הסתיים — שלחי תזכורת תשלום להורה`,
        tag: `pay-${l.id}`,
        url: `./?view=home&pay=${encodeURIComponent(l.studentId)}`,
        sig: paymentSignature(l)
      });
    }
  }
  if (morning) {
    for (const [date, n] of perDay) {
      out.push({
        t: atTime(date, morning),
        title: "תזכורות להיום",
        body: morningBody(n),
        tag: `morning-${date}`,
        url: "./?view=home&hub=lessons",
        sig: `morning:${date}`
      });
    }
  }
  return out.filter(i => Number.isFinite(i.t) && i.t > from && i.t <= to).sort((a, b) => a.t - b.t);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run check`
Expected: all pass (`pass 60`, `fail 0`).

- [ ] **Step 5: Commit**

```bash
git add src/push.js tests/push.test.js
git commit -m "feat(push): plannedReminders — lesson, morning and payment items from one planner"
```

---

### Task 2: New settings (`morningReminderTime`, `payReminderMode`)

**Files:**
- Modify: `src/data.js` (`DEFAULT_SETTINGS`, `normalizeSettings`)
- Modify: `tests/data.test.js`
- Modify: `app.js` — `updateSetting` (~line 2202) and the notifications section of `renderSettings` (~lines 2128-2147)
- Modify: `styles.css` (two small rules after `.setting-row input[type="text"]`, ~line 817)
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Produces: `settings.morningReminderTime` (`"HH:MM"` | `""`, default `"08:00"`), `settings.payReminderMode` (`"afterLesson" | "nextMorning" | "off"`, default `"afterLesson"`). `App.updateSetting('morningReminderTime', value)` and `App.updateSetting('payReminderMode', value)` save and call `reschedule()`.

- [ ] **Step 1: Write the failing test**

Append to `tests/data.test.js`:

```js
test("reminder settings: morning time and payment mode normalize with defaults", () => {
  const s = normalizeSettings({});
  assert.equal(s.morningReminderTime, "08:00");
  assert.equal(s.payReminderMode, "afterLesson");
  assert.equal(normalizeSettings({ morningReminderTime: "" }).morningReminderTime, ""); // כבוי
  assert.equal(normalizeSettings({ morningReminderTime: "07:15" }).morningReminderTime, "07:15");
  assert.throws(() => normalizeSettings({ morningReminderTime: "25:99" }), /morningReminderTime is invalid/);
  assert.equal(normalizeSettings({ payReminderMode: "nextMorning" }).payReminderMode, "nextMorning");
  assert.equal(normalizeSettings({ payReminderMode: "off" }).payReminderMode, "off");
  assert.equal(normalizeSettings({ payReminderMode: "whenever" }).payReminderMode, "afterLesson"); // ערך זר → ברירת מחדל
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/data.test.js`
Expected: FAIL — `morningReminderTime` is `undefined`.

- [ ] **Step 3: Implement in `src/data.js`**

In `DEFAULT_SETTINGS` replace `payInfo: ""` with:

```js
  payInfo: "",
  // push של בוקר: "X שיעורים היום"; ריק = כבוי
  morningReminderTime: "08:00",
  // תזכורת תשלום להורה: אחרי כל שיעור / למחרת בבוקר / כבוי
  payReminderMode: "afterLesson"
```

In `normalizeSettings`, before the `return`, add:

```js
  const morningReminderTime = source.morningReminderTime === undefined
    ? DEFAULT_SETTINGS.morningReminderTime
    : (source.morningReminderTime === "" ? "" : time(source.morningReminderTime, "morningReminderTime"));
  const payReminderMode = ["afterLesson", "nextMorning", "off"].includes(source.payReminderMode)
    ? source.payReminderMode
    : DEFAULT_SETTINGS.payReminderMode;
```

and in the returned object replace `payInfo: text(source.payInfo, "payInfo", 300)` with:

```js
    payInfo: text(source.payInfo, "payInfo", 300),
    morningReminderTime,
    payReminderMode
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/data.test.js`
Expected: PASS.

- [ ] **Step 5: Wire `updateSetting` in `app.js`**

Replace the line `if (key === "remindMinutes") reschedule();` in `updateSetting` with:

```js
    if (["remindMinutes", "morningReminderTime", "payReminderMode"].includes(key)) reschedule();
```

(`value` for both new keys goes through the existing `String(value).trim()` branch; `normalizeSettings` validates on save.)

- [ ] **Step 6: Add the two rows to the notifications section of `renderSettings`**

In `renderSettings`, directly after the closing `</div>` of `<div class="reminder-status-card">` (the line after `<input type="number" ... aria-label="דקות לפני שיעור">`) and before `<div class="settings-action-stack reminder-actions">`, insert:

```js
        <div class="settings-panel">
          <div class="setting-row">
            <div>
              <div class="setting-label">תזכורת בוקר</div>
              <p class="settings-help">push עם מספר השיעורים של היום — משם שולחים תזכורות לתלמידים</p>
            </div>
            <div class="setting-inline">
              <input type="time" value="${settings.morningReminderTime}" onchange="App.updateSetting('morningReminderTime', this.value)" aria-label="שעת תזכורת בוקר">
              ${settings.morningReminderTime
                ? `<button type="button" class="btn btn-light" onclick="App.updateSetting('morningReminderTime', '')">כבוי</button>`
                : `<span class="settings-help">כבוי</span>`}
            </div>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">תזכורת תשלום להורה</div>
              <p class="settings-help">push אחרי השיעור — לחיצה פותחת את ההודעה מוכנה לוואטסאפ</p>
            </div>
            <select onchange="App.updateSetting('payReminderMode', this.value)" aria-label="מתי להזכיר על תשלום">
              <option value="afterLesson" ${settings.payReminderMode === "afterLesson" ? "selected" : ""}>אחרי כל שיעור</option>
              <option value="nextMorning" ${settings.payReminderMode === "nextMorning" ? "selected" : ""}>למחרת בבוקר</option>
              <option value="off" ${settings.payReminderMode === "off" ? "selected" : ""}>כבוי</option>
            </select>
          </div>
        </div>
```

- [ ] **Step 7: Styles**

In `styles.css`, after `.setting-row input[type="text"] { max-width: 170px; text-align: right; }` add:

```css
.setting-row input[type="time"], .setting-row select { margin: 0; max-width: 170px; }
.setting-inline { display: flex; align-items: center; gap: var(--sp-2); }
```

- [ ] **Step 8: Contract test for the settings UI**

Append to `tests/ui-contract.test.js`:

```js
test("reminder settings expose morning time and payment mode", () => {
  const source = read("app.js");
  assert.match(source, /App\.updateSetting\('morningReminderTime', this\.value\)/);
  assert.match(source, /App\.updateSetting\('payReminderMode', this\.value\)/);
  assert.match(source, /<option value="nextMorning"/);
  assert.match(source, /\["remindMinutes", "morningReminderTime", "payReminderMode"\]\.includes\(key\)\) reschedule\(\)/);
});
```

- [ ] **Step 9: Run everything**

Run: `npm run check`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/data.js tests/data.test.js app.js styles.css tests/ui-contract.test.js
git commit -m "feat(settings): morning reminder time and payment reminder mode"
```

---

### Task 3: Wire the planner into the app and the sync; delete the old reminder functions

**Files:**
- Modify: `src/push.js` — `writeAndSync`, `syncPush`, `sendClosedAppTest`; delete `upcomingPushReminders`
- Modify: `src/reminders.js` — delete `dueLessonReminders`, `duePaymentReminders`, `nextLessonReminderTimestamp`
- Modify: `tests/reminders.test.js` — delete their tests; `tests/push.test.js` — delete the three `upcomingPushReminders` tests and its import
- Modify: `app.js` — imports (lines 19-29), `showAppNotification` (~2370), `trySyncPush` (~2396), `testClosedPush` (~2415), `rememberNotification` (~2437), `scheduleNextReminder` (~2314), `checkReminders` (~2448)
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `plannedReminders` (Task 1), settings (Task 2).
- Produces: `syncPush(lessons, studentsById, settings)` and `sendClosedAppTest(lessons, studentsById, settings)` (signature change: third argument is now the whole `settings` object). `showAppNotification(title, options, url = "./")`. `pageDueItems(items, now, notified, pushHealthy, syncedAt = 0)` (pure, in `src/push.js`): the items the page shows itself — due and unshown; with healthy push only those with `t <= syncedAt` (the last sync already dropped them from the server).

- [ ] **Step 1: Update `tests/push.test.js` (tests first)**

Delete the three tests that call `upcomingPushReminders` ("future lesson gets a reminder at start minus lead", "done, past, and beyond-horizon lessons are excluded", "results are sorted by time and unknown student gets a fallback name") and remove `upcomingPushReminders` from the import. Add:

```js
test("planner: unknown student gets a fallback name; done lessons get no lesson item", () => {
  const items = plannedReminders([lesson({ studentId: "missing" }), lesson({ id: "done", done: true })], priced, settings, now);
  assert.ok(byTag(items, "lesson-")[0].body.includes("תלמיד"));
  assert.deepEqual(byTag(items, "lesson-").map(i => i.tag), ["lesson-l1"]);
});
```

In `tests/reminders.test.js` delete the tests "finds reminders inside lead window and ignores delivered or done lessons", "payment reminders flag finished, done, unpaid lessons only once", "payment reminders can wait a grace period so they are not instant", "zero-minute reminder gets a short polling grace window", "finds the next reminder time", and remove `dueLessonReminders`, `duePaymentReminders`, `nextLessonReminderTimestamp` from its import.

- [ ] **Step 2: Run tests to verify the suite still passes**

Run: `node --test tests/push.test.js tests/reminders.test.js`
Expected: PASS (nothing imports the deleted names yet). Continue.

- [ ] **Step 3: `src/push.js` — sync sends only future items; the cache keeps the recent past**

Replace `writeAndSync`, `syncPush`, `sendClosedAppTest`:

```js
// כתיבה למטמון (בשביל ה-SW) ושליחת התזכורות לשרת. זורק על כשל HTTP.
// המטמון מקבל גם את 30 הדקות האחרונות (ה-SW מציג ממנו פריטים שכבר עברו כש-push מגיע);
// השרת מקבל רק עתיד — אחרת ה-cron היה דוחף מיד פריט שהדף בדיוק הציג.
async function writeAndSync(sub, items, now = Date.now()) {
  try {
    const cache = await caches.open(PUSH_CACHE);
    await cache.put("reminders", new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" }
    }));
  } catch { /* אין Cache API — ה-push עדיין יעבוד עם ההודעה הגנרית */ }
  const res = await fetch(`${PUSH_SERVER}/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: clientId(),
      sub: sub ? sub.toJSON() : null,
      items: items.filter(i => i.t > now).map(({ t, title, body }) => ({ t, title, body }))
    })
  });
  if (!res.ok) throw new Error(`sync-failed-${res.status}`);
}
```

```js
// סנכרון: כל התזכורות המתוכננות למטמון + לשרת. רץ אחרי כל שמירה. מחזיר "ok"; זורק על כשל רשת/שרת.
export async function syncPush(lessons, studentsById, settings) {
  const now = Date.now();
  await writeAndSync(await currentSub(), plannedReminders(lessons, studentsById, settings, now), now);
  return "ok";
}

// בדיקת "אפליקציה סגורה": תזכורת בדיקה בעוד 2 דק' + סנכרון לשרת.
// ה-cron רץ כל 5 דק' — ההתראה תגיע תוך 2-7 דקות. מחזיר את זמן הבדיקה.
// ponytail: סנכרון רגיל שירוץ לפני שהבדיקה נורתה ידרוס אותה — זניח, המשתמשת מתבקשת לסגור את האפליקציה.
export async function sendClosedAppTest(lessons, studentsById, settings) {
  const now = Date.now();
  const items = plannedReminders(lessons, studentsById, settings, now);
  const t = now + 2 * MINUTE;
  items.push({ t, title: "בדיקת התראות ✓", body: "מצוין — התזכורות מגיעות גם כשהאפליקציה סגורה", tag: "push-test", sig: `test:${t}` });
  items.sort((a, b) => a.t - b.t);
  await writeAndSync(await currentSub(), items, now);
  return t;
}
```

Delete `upcomingPushReminders` and its comment block entirely. Add after `plannedReminders`:

```js
// מה הדף מציג בעצמו. כשה-push בריא — רק פריטים שזמנם עבר לפני הסנכרון האחרון: הסנכרון שולח
// לשרת רק עתיד, כלומר פריט כזה כבר ירד מרשומת השרת ואף אחד אחר לא יציג אותו. פריט שזמנו אחרי
// הסנכרון עדיין בשרת — ה-cron ידחוף אותו וה-SW יציג. בלי push בריא הדף מציג כל פריט שהגיע זמנו.
export function pageDueItems(items, now, notified, pushHealthy, syncedAt = 0) {
  return items.filter(i => i.t <= now && !notified.has(i.sig) && (!pushHealthy || i.t <= syncedAt));
}
```

and a unit test for it in `tests/push.test.js` (healthy push shows only items with `t <= syncedAt`; unhealthy shows every due item; already-notified items are skipped; `syncedAt` default 0 with healthy push shows nothing).

- [ ] **Step 4: `src/reminders.js` — delete the three functions**

Delete `duePaymentReminders`, `dueLessonReminders`, `nextLessonReminderTimestamp` (and only them). Keep `reminderSignature`, `paymentSignature`, `bulkReminderLessons`, `lessonStartTimestamp`, `upcomingReminderLessons`, `lessonsAwaitingConfirmation`, `createLessonsCalendar`.

- [ ] **Step 5: `app.js` imports**

In the `from "./src/reminders.js"` import list remove `dueLessonReminders`, `duePaymentReminders`, `nextLessonReminderTimestamp`. Change the push import to:

```js
import { enablePush, pushSupported, pushSubscribed, syncPush, sendClosedAppTest, plannedReminders, pageDueItems, shownSigs, markShown, pruneShown } from "./src/push.js";
```

- [ ] **Step 6: `app.js` — `showAppNotification` carries the deep link**

```js
  async function showAppNotification(title, options, url = "./") {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      return reg.showNotification(title, { ...options, data: { url } });
    }
    return new Notification(title, options);
  }
```

- [ ] **Step 7: `app.js` — sync calls pass `settings`**

In `trySyncPush` replace `syncPush(lessons, lessonIndex.studentsById, reminderLeadMinutes(settings.remindMinutes))` with `syncPush(lessons, lessonIndex.studentsById, settings)`. In `testClosedPush` replace `sendClosedAppTest(lessons, lessonIndex.studentsById, reminderLeadMinutes(settings.remindMinutes))` with `sendClosedAppTest(lessons, lessonIndex.studentsById, settings)`.

- [ ] **Step 8: `app.js` — `rememberNotification` knows morning signatures**

Replace the line `for (const l of lessons) { activeSignatures.add(reminderSignature(l)); activeSignatures.add(paymentSignature(l)); }` with:

```js
    for (const l of lessons) {
      activeSignatures.add(reminderSignature(l));
      activeSignatures.add(paymentSignature(l));
      activeSignatures.add(`morning:${l.date}`);
    }
```

- [ ] **Step 9: `app.js` — `scheduleNextReminder` and `checkReminders` use the planner**

Replace `scheduleNextReminder`:

```js
  function scheduleNextReminder() {
    clearTimeout(reminderTimer);
    if (!notifSupported || Notification.permission !== "granted") return;
    const now = Date.now();
    const next = plannedReminders(lessons, lessonIndex.studentsById, settings, now).find(i => i.t > now && !notified.has(i.sig));
    if (!next) return;
    // ponytail: normal web notifications cannot wake a closed app; this only tightens timing while it is open.
    const delay = Math.min(Math.max(30 * 1000, next.t - now), 2147483647);
    reminderTimer = setTimeout(() => void checkReminders(), delay);
  }
```

Replace the whole `checkReminders` function:

```js
  async function checkReminders() {
    if (!notifSupported || Notification.permission !== "granted" || reminderCheckRunning) return;
    reminderCheckRunning = true;
    try {
      // מה שה-service worker כבר הציג (push) נכנס ל-notified דרך המטמון המשותף — לא מציגים שוב.
      for (const sig of await shownSigs()) notified.add(sig);
      // כשה-push בריא (מנוי + הסנכרון האחרון הצליח) השרת הוא הבעלים של התזכורות, גם כשהאפליקציה
      // פתוחה — שני מסלולים שמציגים את אותה תזכורת = פעמיים. חריג: פריט שזמנו עבר לפני הסנכרון
      // האחרון כבר ירד מרשומת השרת (הסנכרון שולח רק עתיד), ואם ה-SW לא הציג אותו — רק הדף יכול.
      const sync = lastPushSync();
      const pushHealthy = sync?.state === "ok" && await pushSubscribed();
      const now = Date.now();
      const due = pageDueItems(plannedReminders(lessons, lessonIndex.studentsById, settings, now), now, notified, pushHealthy, sync?.at || 0);
      for (const item of due) {
        await showAppNotification(item.title, {
          tag: item.tag,
          body: item.body,
          icon: "icon-192.png",
          badge: "icon-192.png"
        }, item.url);
        rememberNotification(item.sig);
        await markShown(item.sig); // שגם ה-service worker ידע, אם push בכל זאת יגיע
      }
    } catch (error) {
      console.warn("Could not show reminder", error);
    } finally {
      reminderCheckRunning = false;
      scheduleNextReminder();
    }
  }
```

- [ ] **Step 10: Update the contract test that referenced the old flow**

In `tests/ui-contract.test.js`, in the test "lesson reminders are shown once across the page and the service worker", replace `assert.match(source, /serverOwnsLessons/);` with:

```js
  assert.match(source, /const pushHealthy = sync\?\.state === "ok" && await pushSubscribed\(\)/);
  assert.match(source, /pageDueItems\(/);
```

- [ ] **Step 11: Run everything**

Run: `npm run check`
Expected: all pass. Then confirm nothing references the deleted names:

```bash
grep -n "upcomingPushReminders\|dueLessonReminders\|duePaymentReminders\|nextLessonReminderTimestamp\|reminderLeadMinutes(settings.remindMinutes))" app.js src/*.js tests/*.js
```
Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add app.js src/push.js src/reminders.js tests/push.test.js tests/reminders.test.js tests/ui-contract.test.js
git commit -m "feat(reminders): one planner drives the page timer, the cache and the server sync"
```

---

### Task 4: Deep links from the push into the hub (`hub=lessons`, `pay=<studentId>`)

**Files:**
- Modify: `app.js` — `handleLaunchParams` (~line 2554) and a new `highlightHub` next to it
- Modify: `styles.css` — `.is-highlight` after `.hub-group + .hub-group` (~line 1615)
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `go(view, after)` (runs `after` once the view is applied), `#reminderHub .hub-box` (`<details>`), heading ids `hubLessonsTitle`, `hubMoneyTitle`, `hub-payment-student-<studentId>` (inside `<article class="payment-account">`).
- Produces: URL contract for push items: `./?view=home&hub=lessons`, `./?view=home&pay=<studentId>`.

- [ ] **Step 1: Contract test first**

Append to `tests/ui-contract.test.js`:

```js
test("push deep links open the reminder hub and highlight the target", () => {
  const source = read("app.js");
  const styles = read("styles.css");
  assert.match(source, /p\.get\("hub"\)/);
  assert.match(source, /p\.get\("pay"\)/);
  assert.match(source, /function highlightHub\(/);
  assert.match(source, /hub-payment-student-\$\{/);
  assert.match(styles, /\.is-highlight\s*\{/);
  assert.match(styles, /prefers-reduced-motion: reduce\)[^}]*\.is-highlight/s);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ui-contract.test.js`
Expected: FAIL on `p\.get\("hub"\)`.

- [ ] **Step 3: Implement in `app.js`**

Replace `handleLaunchParams` with:

```js
  function handleLaunchParams() {
    const p = new URLSearchParams(location.search);
    const hub = p.get("hub");
    const pay = p.get("pay");
    if (p.get("view")) go(p.get("view"), (hub || pay) ? () => highlightHub(pay) : undefined);
    if (p.get("action") === "new-lesson") openLessonForm();
    // הגעה מהתראת שיעור — פתיחת אותו שיעור (אם עדיין קיים)
    const lessonId = p.get("lesson");
    if (lessonId && lessons.some(l => l.id === lessonId)) openLessonForm(lessonId);
  }

  // הגעה מ-push של בוקר/תשלום: פותחים את מרכז התזכורות ומדגישים לרגע את הקבוצה או את כרטיס
  // התשלום של התלמיד. ה-<details> החי הוא מקור האמת למצב הפתיחה (ראו renderReminderHub), לכן
  // פותחים אותו ישירות ולא דרך setHubOpen.
  function highlightHub(studentId) {
    const box = document.querySelector("#reminderHub .hub-box");
    if (box) box.open = true;
    const target = (studentId && document.getElementById(`hub-payment-student-${studentId}`)?.closest(".payment-account"))
      || document.getElementById(studentId ? "hubMoneyTitle" : "hubLessonsTitle")?.closest(".hub-group");
    if (!target) return;
    target.classList.add("is-highlight");
    target.scrollIntoView({ block: "center" });
    setTimeout(() => target.classList.remove("is-highlight"), 2000);
  }
```

Note: a payment push can arrive before the lesson is confirmed; then the student has no payment card yet and the highlight lands on the "תשלומים פתוחים" heading, while the lesson waits in "שיעורים שהסתיימו" one group above — confirm, then send. That is the intended flow.

- [ ] **Step 4: Styles**

After `.hub-group + .hub-group { ... }` in `styles.css` add:

```css
/* הדגשה רגעית של היעד שאליו הגיעו מהתראה (קבוצה ב-hub או כרטיס תשלום) */
.is-highlight { box-shadow: 0 0 0 3px var(--focus-ring); border-radius: var(--r-md); transition: box-shadow .6s; }
@media (prefers-reduced-motion: reduce) { .is-highlight { transition: none; } }
```

- [ ] **Step 5: Run everything**

Run: `npm run check`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app.js styles.css tests/ui-contract.test.js
git commit -m "feat(hub): push deep links open the reminder hub and highlight the target"
```

---

### Task 5: Manual check in the browser (no commit)

**Files:** none

- [ ] **Step 1: Serve locally**

```bash
npx serve . -l 8000
```

Open `http://localhost:8000` (the Worker allows this origin). In Settings: confirm the two new rows render, change the morning time, set payment mode to "למחרת בבוקר", reload, confirm both persisted.

- [ ] **Step 2: Deep links**

Open `http://localhost:8000/?view=home&hub=lessons` — the hub is open and the "שיעורים קרובים" group is outlined for ~2s. Add a student with a phone and a done unpaid lesson, then open `http://localhost:8000/?view=home&pay=<thatStudentId>` (id from `localStorage.mt_state_v3`) — the payment card is outlined.

- [ ] **Step 3: Sync payload**

In DevTools → Network, trigger a save and inspect the `POST /sync` body: items include `title: "תזכורות להיום"` and `title: "תזכורת תשלום"` entries with future `t` only; Application → Cache Storage → `mt-push-data` → `reminders` includes the same plus any items from the last 30 minutes.

---

### Task 6: Versions, README, release

**Files:**
- Modify: `src/data.js` (`APP_VERSION`), `package.json` (`version`), `service-worker.js` (`CACHE`, `ASSETS`), `index.html` (`?v=`), `tests/data.test.js`, `README.md`

- [ ] **Step 1: Test first**

In `tests/data.test.js` change `assert.equal(APP_VERSION, "4.0.1");` to `assert.equal(APP_VERSION, "4.1.0");`.

Run: `node --test tests/data.test.js` → FAIL (still 4.0.1).

- [ ] **Step 2: Bump everything together**

- `src/data.js`: `export const APP_VERSION = "4.1.0";`
- `package.json`: `"version": "4.1.0"`
- `service-worker.js`: `const CACHE = "morti-v4.1.0";` and in `ASSETS`: `"styles.css?v=62"`, `"app.js?v=75"`
- `index.html`: `<link rel="stylesheet" href="styles.css?v=62">` and `<script type="module" src="app.js?v=75"></script>`

- [ ] **Step 3: README**

In `README.md` under "## יכולות" replace the bullet that starts with `- **תזכורות בדפדפן**` with:

```markdown
- **תזכורות push** — לפני שיעור, בבוקר ("3 שיעורים היום") ואחרי שיעור (תזכורת תשלום להורה). לחיצה על ההתראה פותחת את מרכז התזכורות עם ההודעה מוכנה — לחיצה אחת ווואטסאפ נפתח. עובד גם כשהאפליקציה סגורה (Web Push דרך Cloudflare Worker, חינם).
```

- [ ] **Step 4: Run everything**

Run: `npm run check`
Expected: all pass. The contract test "index.html and the service worker precache the same app.js version" guards the `?v=` pair.

- [ ] **Step 5: Commit and merge**

```bash
git add src/data.js package.json service-worker.js index.html tests/data.test.js README.md
git commit -m "release: v4.1.0 — one-tap reminders (morning digest, payment push)"
git checkout main && git merge --ff-only feat/one-tap-reminders && git push origin main
```

- [ ] **Step 6: Verify on the phone (iPhone, installed app)**

1. Open the app once after the deploy (a reload happens automatically when the new service worker takes over).
2. Settings → "בדיקה: התראה כשהאפליקציה סגורה" → close the app → the test notification arrives within 2–7 minutes.
3. Set a lesson for tomorrow; next morning at the configured time a "תזכורות להיום" push arrives; tap → hub open, "שיעורים קרובים" outlined; tap "תזכורת" → WhatsApp opens with the message.
4. After a lesson ends, "תזכורת תשלום" arrives; tap → hub → confirm the lesson if needed → "תזכורת תשלום" → WhatsApp.
5. Confirm no reminder arrives twice.

# תזכורות בלחיצה אחת — Push למורה בבוקר ואחרי שיעור

**תאריך:** 2026-09-29 · **סטטוס:** מאושר לתכנון יישום · **בסיס:** branch `fix/duplicate-reminder-and-whatsapp-return` (v4.0.1)

## מטרה

המורה מקבלת push בזמן הנכון, לוחצת, וההודעה לתלמיד/להורה כבר מוכנה בוואטסאפ. לחיצה אחת בתוך האפליקציה לכל הודעה. ₪0, בלי מספר עסקי, בלי Meta, בלי ספריות לא-רשמיות.

## מה המשתמשת רואה

שלושה סוגי push (כולם דרך השרת הקיים ב-Cloudflare, cron כל 5 דק'):

| סוג | מתי | כותרת / גוף | לחיצה פותחת |
|---|---|---|---|
| לפני שיעור (קיים) | `start - remindMinutes` | "תזכורת שיעור" / "שיעור עם דנה בשעה 16:00" | השיעור (קיים: `?view=home&lesson=<id>`) |
| בוקר (חדש) | בכל יום עם שיעור לא-בוצע, בשעת `morningReminderTime` | "תזכורות להיום" / "3 שיעורים היום — שלחי תזכורות לתלמידים" | `?view=home&hub=lessons` — ה-hub פתוח, קבוצת "שיעורים קרובים" מודגשת |
| תשלום (חדש) | סוף השיעור (`start + duration`) או למחרת בשעת הבוקר, לפי `payReminderMode` | "תזכורת תשלום" / "השיעור עם דנה הסתיים — שלחי תזכורת תשלום להורה" | `?view=home&pay=<studentId>` — ה-hub פתוח, כרטיס התשלום של התלמיד מודגש |

מה-hub, כפתור "תזכורת" הקיים פותח וואטסאפ עם ההודעה המוכנה (`sendLessonReminder` / `sendWhatsApp`). אין שינוי בתבניות ההודעות.

## ארכיטקטורה

### מקור אמת אחד לתזכורות — `src/push.js`

```
plannedReminders(lessons, studentsById, settings, now, horizonDays = 60)
  → [{ t, title, body, tag, url, sig }] ממוין לפי t, רק t > now - 30min ו-t <= now + horizon
```

- מחליף את `upcomingPushReminders` (שמחשב רק "לפני שיעור").
- `sig` = מפתח הדדופ: `reminderSignature(l)` לשיעור, `paymentSignature(l)` לתשלום, `morning:<date>` לבוקר. חתימה כוללת תאריך+שעה — שיעור שהוזז נחשב תזכורת חדשה.
- כללים:
  - לפני שיעור: `!done`, `t = start - lead`.
  - בוקר: לכל `date` עם ≥1 שיעור `!done`; `t = date @ morningReminderTime`; אם `morningReminderTime === ""` — אין פריטים.
  - תשלום: `!paid` ו-`lessonPrice(l) > 0`; `afterLesson` → `t = start + duration`; `nextMorning` → `t = (date+1) @ morningReminderTime` (אם השעה ריקה → 08:00); `off` → אין. לא דורש `done` — ה-push עצמו הוא הבקשה לאשר ולשלוח.
  - פריטים שכבר עברו יותר מ-30 דק' לא נכללים (אין ספאם על העבר).
- **צרכנים:** הטיימר באפליקציה לוקח את הפריטים עם `t <= now`; הסנכרון לשרת ולמטמון (`writeAndSync`) שולח **רק** `t > now` — אחרת ה-cron היה דוחף מיד פריט שהאפליקציה בדיוק הציגה.

### שני מסלולי הצגה, זיכרון אחד (קיים מ-v4.0.1)

| מסלול | מתי פעיל | מקור הפריטים |
|---|---|---|
| בתוך האפליקציה (`checkReminders`, טיימר + interval) | **גיבוי בלבד**: כשאין מנוי push או שהסנכרון האחרון נכשל (`serverOwnsLessons === false`) | `plannedReminders(...)` עם `t <= now` |
| שרת → push → SW | תמיד (גם אפליקציה סגורה) | אותם פריטים, שמורים במטמון `mt-push-data`/`reminders` ובשרת |

**זיכרון "כבר הוצג" משותף** — הונח ב-v4.0.1 (תיקון ההתראה הכפולה) ומשמש כאן כמו שהוא:
- Cache API `mt-push-data`, מפתח לכל חתימה: `shown/<encodeURIComponent(sig)>`, גוף = זמן הסימון. בלי מערך אחד → בלי read-modify-write בין שני הקשרים.
- שני המסלולים **מסמנים לפני ההצגה** (`markShown` באפליקציה, `cache.put` ב-SW).
- SW `push`: פריטים בחלון 30 דק' אחורה שלא סומנו → מוצגים. אם הכל כבר סומן → מציג שוב את האחרון באותו `tag` עם `silent: true` (push חייב התראה גלויה: אחרת Chrome מציג הודעה גנרית, iOS מבטל את המנוי). מטמון לא קריא / חלון ריק → הודעה גנרית "יש תזכורת ממתינה".
- אפליקציה `checkReminders`: בכל ריצה ממזג `shownSigs()` ל-`notified`. כש-`serverOwnsLessons` (מנוי push + `lastPushSync().state === "ok"`) — לא מציג פריטי שיעור/בוקר/תשלום בעצמה; השרת הבעלים. אחרת מציגה בעצמה ומסמנת `markShown` אחרי ההצגה. (שני מסלולים פעילים במקביל = כפילות; זה הלקח מ-v4.0.1.)
- `pruneShown()` בעלייה: מוחק סימונים שגילם > יום. פריט בלי `sig` מוצג תמיד.

**נמחק בשלב הזה:** `dueLessonReminders`, `nextLessonReminderTimestamp`, `duePaymentReminders` ב-`src/reminders.js` והטסטים שלהם — ה-planner מחליף אותם. `scheduleNextReminder` מחשב את ה-`t` הבא מתוך `plannedReminders` (הפריט הראשון עם `t > now`).

### השרת

**ללא שינוי.** `push-server/worker.js` כבר מקבל `{t, title, body}` גנרי ושולח push ריק כשמגיע הזמן. ה-SW מציג מהמטמון.

## הגדרות (`src/data.js` + מסך הגדרות)

| מפתח | סוג | ברירת מחדל | UI |
|---|---|---|---|
| `morningReminderTime` | `"HH:MM"` או `""` | `"08:00"` | `<input type="time">` + כפתור "כבוי" (מרוקן) |
| `payReminderMode` | `"afterLesson" \| "nextMorning" \| "off"` | `"afterLesson"` | `<select>` |

שניהם נוספים ל-`DEFAULT_SETTINGS`, ל-`normalizeSettings` (ולידציה: זמן בפורמט תקין או ריק; mode מתוך הרשימה, אחרת ברירת מחדל), ל-`updateSetting` (מחרוזות) ול-`renderSettings` תחת קבוצת "התראות". שינוי בהם מפעיל `reschedule()` (סנכרון לשרת + טיימר).

## Deep link (`handleLaunchParams`)

- `hub=lessons` → `go("home")`, `setHubOpen(true)`, גלילה ל-`#hubLessonsTitle`, מחלקת `is-highlight` ל-2 שניות.
- `pay=<studentId>` → `go("home")`, `setHubOpen(true)`, גלילה ל-`#hub-payment-student-<id>` (אם קיים; אחרת ל-`#hubMoneyTitle`), `is-highlight`.
- `is-highlight`: CSS בלבד — רקע מודגש שדוהה ב-`transition`, מכבד `prefers-reduced-motion`.

## טיפול בשגיאות

- אין שינוי במודל: כשל סנכרון לשרת → `rememberPushSync("fail")` + שורת סטטוס בהגדרות (קיים).
- Cache API לא זמין → `shownSigs()` מחזיר ריק, `markShown` שקט; המסלול ממשיך (יתכן כפל במקרה קצה — עדיף מאי-הצגה).
- ערכי הגדרות לא תקינים חוזרים לברירת מחדל ב-`normalizeSettings` (קיים לכל השדות).

## טסטים

- `tests/push.test.js`: `plannedReminders` — פריט בוקר רק בימים עם שיעור, לא כשהשעה ריקה; תשלום `afterLesson` בסוף השיעור, `nextMorning` למחרת, `off` = כלום, לא לשיעור ששולם, לא למחיר 0; לפני-שיעור כמו היום; סינון עבר > 30 דק'; מיון; `sig` יציב ומשתנה כשהשיעור מוזז; הסנכרון שולח רק `t > now`.
- `tests/data.test.js`: נרמול ההגדרות החדשות (ברירת מחדל, ערך לא תקין).
- `tests/ui-contract.test.js`: מסך ההגדרות מציג את שני השדות; `handleLaunchParams` מטפל ב-`hub`/`pay`; `index.html`/SW מפנים לאותה גרסת `app.js` (קיים).
- הטסטים של `dueLessonReminders`/`duePaymentReminders`/`nextLessonReminderTimestamp` נמחקים עם הפונקציות.

## גרסאות

`APP_VERSION` → `4.1.0`, `package.json` → `4.1.0`, SW `CACHE` → `morti-v4.1.0`, `app.js?v=75` ב-`index.html` וב-SW (v=74 שייך לתיקון הבאגים).

## מחוץ לתחום

- כפתורי פעולה בהתראה (iOS לא תומך; לחיצה על ההתראה מספיקה).
- שליחה אוטומטית להורים/תלמידים בלי לחיצה (Meta Cloud API / Telegram) — אפשרי כשלב הבא על אותו planner.
- שינויים ב-`push-server`.

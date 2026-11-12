-- גיבוי ענן: טקסט מוצפן במכשיר, לפי גיבוב של קוד השחזור. prev = הגרסה מהיום הקודם שבו נשמר.
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  prev TEXT,
  prev_at INTEGER
);

-- חשבונות: כל הנתונים של המשתמש (תלמידים, שיעורים, הגדרות) כמסמך אחד עם גרסה.
-- כתיבה מצליחה רק מהגרסה הנוכחית — שני מכשירים לא דורסים זה את זה בשקט.
CREATE TABLE IF NOT EXISTS user_data (
  uid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- מפתח הוואטסאפ של החשבון (הקישור שבקיצור TutorAuto): מכשיר חדש מקבל אותו, בלי להתקין את הקיצור מחדש
CREATE TABLE IF NOT EXISTS account_keys (
  uid TEXT PRIMARY KEY,
  wa_key TEXT NOT NULL UNIQUE
);

-- מה שהיה ב-KV ("sub:", "wa:", "wasent:", "waseen:", "waalias:"), אותם מפתחות וערכים.
-- ל-KV החינמי יש 1,000 כתיבות ביום לכל המשתמשים יחד; ל-D1 — 100,000.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- הגבלת קצב: מונה לכל נתיב+IP בחלון של דקה
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset INTEGER NOT NULL
);

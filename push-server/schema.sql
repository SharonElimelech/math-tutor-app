-- גיבוי ענן: טקסט מוצפן במכשיר, לפי גיבוב של קוד השחזור. prev = הגרסה מהיום הקודם שבו נשמר.
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  at INTEGER NOT NULL,
  prev TEXT,
  prev_at INTEGER
);

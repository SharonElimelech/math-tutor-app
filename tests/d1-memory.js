// D1 בזיכרון לבדיקות: SQLite אמיתי (node:sqlite) עם schema.sql של השרת, באותו ממשק כמו D1
// (prepare().bind().first()/all()/run()). כך הבדיקות מריצות את ה-SQL האמיתי, לא חיקוי.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function memoryD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../push-server/schema.sql", import.meta.url), "utf8"));
  const plain = row => (row ? { ...row } : null);
  return {
    raw: db,
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const api = {
        bind(...a) { args = a; return api; },
        first: async () => plain(st.get(...args)),
        all: async () => ({ results: st.all(...args).map(plain) }),
        run: async () => ({ meta: { changes: st.run(...args).changes } })
      };
      return api;
    }
  };
}

export const memoryEnv = (extra = {}) => ({ DB: memoryD1(), ...extra });

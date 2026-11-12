// Push server for "המורה שלי".
// Stores reminder items (time + text) per device. Cron sends an empty web push
// "tickle" for each due reminder; the service worker then shows the notification
// from its cached copy. (Email delivery via Resend was removed — push works.)

import { verifyIdToken } from "./auth.js";
import { parseBackup } from "../src/data.js";

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// אחסון מפתח-ערך מעל D1, באותו ממשק כמו KV ועם אותם מפתחות ("sub:", "wa:", "wasent:"...).
// ל-KV החינמי יש 1,000 כתיבות ביום לכל המשתמשים יחד (~15 משתמשים); ל-D1 — 100,000.
export const kvStore = env => ({
  async get(k, type) {
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k = ?1").bind(k).first();
    return row ? (type === "json" ? JSON.parse(row.v) : row.v) : null;
  },
  put: (k, v) => env.DB.prepare("INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, v).run(),
  delete: k => env.DB.prepare("DELETE FROM kv WHERE k = ?1").bind(k).run(),
  async list({ prefix }) {
    const { results } = await env.DB.prepare("SELECT k FROM kv WHERE k >= ?1 AND k < ?2").bind(prefix, prefix + "￿").all();
    return { keys: results.map(r => ({ name: r.k })) };
  }
});

// הגבלת קצב לכל נתיב+IP, בחלון של דקה. true = חרג.
async function limited(env, req, route, max) {
  const now = Date.now(), k = `${route}:${req.headers.get("CF-Connecting-IP") || "local"}`;
  const row = await env.DB.prepare(`INSERT INTO rate (k, n, reset) VALUES (?1, 1, ?2)
    ON CONFLICT(k) DO UPDATE SET n = CASE WHEN rate.reset <= ?3 THEN 1 ELSE rate.n + 1 END,
      reset = CASE WHEN rate.reset <= ?3 THEN ?2 ELSE rate.reset END
    RETURNING n`).bind(k, now + 60e3, now).first();
  return row.n > max;
}

const ORIGINS = [
  "https://sharonelimelech.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];
const corsFor = req => {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
};

async function vapidAuth(endpoint, env) {
  const key = await crypto.subtle.importKey(
    "jwk", JSON.parse(env.VAPID_PRIVATE_JWK.replace(/^\uFEFF/, "")), // strip BOM: secret was stored with a UTF-8 BOM that broke JSON.parse
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: "mailto:aruitkh11@gmail.com"
  })));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${payload}`)
  );
  return `vapid t=${head}.${payload}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// ----- שליחה אוטומטית בוואטסאפ (קיצור הדרך TutorAuto באייפון) -----
// האפליקציה שולחת ב-/sync את כל ההודעות המתוכננות {id, after, until, phone, text} עם מפתח סודי
// (KV "wa:<key>" — רק /sync כותב). הקיצור מושך GET /wa?key=... ומקבל רק מה שבחלון שלו כרגע;
// מה שנמסר נרשם ב-"wasent:<key>" (רק GET כותב) — כך סנכרון ומשיכה באותו רגע לא דורסים זה את זה,
// וסנכרון הבא (שמחשב הכול מחדש) או ריצה כפולה לא שולחים שוב. רישום נשמר עד שה-until של הפריט עבר.
// ponytail: נמסר = נשלח (at-most-once). קיצור שנכשל באמצע — שולחים ידנית ממרכז התזכורות.
const WA_KEY = /^[\w-]{20,80}$/;
export function cleanWa(items, now) {
  return (Array.isArray(items) ? items : [])
    .filter(i => i && typeof i.id === "string" && Number(i.until) > now)
    .map(i => ({
      id: i.id.slice(0, 120), after: Number(i.after), until: Number(i.until),
      phone: String(i.phone || "").slice(0, 20), text: String(i.text || "").slice(0, 1500)
    }))
    .slice(0, 500);
}
export function takeDue(items, sentBefore, now) {
  const sent = Object.fromEntries(Object.entries(sentBefore || {}).filter(([, until]) => until > now));
  const due = [];
  for (const i of items || []) if (i.after <= now && now < i.until && !Object.hasOwn(sent, i.id)) { due.push(i); sent[i.id] = 0; }
  // אותו מזהה בכמה חלונות ("שליחה לכולם" + ריצת הבוקר לאותו שיעור) — הרישום מחזיק עד החלון האחרון,
  // אחרת הוא פג אחרי החלון הקצר והבוקר שולח שוב
  for (const i of items || []) if (Object.hasOwn(sent, i.id) && sent[i.id] < i.until) sent[i.id] = i.until;
  return { due: due.map(({ phone, text }) => ({ phone, text })), sent };
}

export default {
  async fetch(req, env) {
    const reply = (body, status = 200) => new Response(body, { status, headers: corsFor(req) });
    if (req.method === "OPTIONS") return reply(null, 204);
    const url = new URL(req.url);
    const kv = kvStore(env);
    const LIMITS = { "/sync": 30, "/wa": 30, "/wa/status": 60, "/backup": 20, "/me": 60 };
    const route = Object.keys(LIMITS).find(r => url.pathname === r || url.pathname.startsWith(r + "/") && r === "/me");
    if (route && await limited(env, req, route, LIMITS[route])) return reply("too many requests", 429);
    if (url.pathname === "/me" || url.pathname.startsWith("/me/")) return account(req, url, env, reply, kv);
    if (req.method === "GET" && url.pathname === "/wa") {
      let key = url.searchParams.get("key") || "";
      if (!WA_KEY.test(key)) return reply("bad key", 400);
      // קישור ישן (אפליקציה שנמחקה ושוחזרה עם מפתח חדש) → התור החדש: הקיצור שבאייפון ממשיך לעבוד
      // בלי לגעת בו, ולא שולח הודעות מהרשימה הישנה. ponytail: הפניה נכתבת ידנית ב-KV ("waalias:<ישן>"),
      // כי שחזור מהענן כבר מחזיר את המפתח המקורי — צריך את זה רק למי ששוחזר לפני כן.
      key = (await kv.get("waalias:" + key)) || key;
      const items = await kv.get("wa:" + key, "json");
      const { due, sent } = takeDue(items, await kv.get("wasent:" + key, "json"), Date.now());
      if (due.length) await kv.put("wasent:" + key, JSON.stringify(sent));
      // ריצה של הקיצור — לסטטוס באפליקציה. רק לתור קיים: מפתח אקראי לא יוצר רשומות
      if (items) await kv.put("waseen:" + key, JSON.stringify({ at: Date.now(), n: due.length }));
      return Response.json(due, { headers: { "Cache-Control": "no-store" } });
    }
    // סטטוס לאפליקציה: מתי הקיצור רץ לאחרונה ומה כבר נמסר. קריאה בלבד — לא "צורך" הודעות
    if (req.method === "GET" && url.pathname === "/wa/status") {
      const key = url.searchParams.get("key") || "";
      if (!WA_KEY.test(key)) return reply("bad key", 400);
      const [lastRun, sent] = await Promise.all([kv.get("waseen:" + key, "json"), kv.get("wasent:" + key, "json")]);
      const now = Date.now();
      return Response.json({ lastRun, sent: Object.keys(sent || {}).filter(id => sent[id] > now) },
        { headers: { ...corsFor(req), "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/backup") return backup(req, url, env, reply);
    // קובץ הקיצור כהורדה: GitHub Pages שולח אותו בלי Content-Disposition, וספארי מציג את התוכן
    // כטקסט ("ג'יבריש") במקום להוריד. מכאן הוא יורד, ונפתח בקיצורים ← "הוספת קיצור".
    const sc = req.method === "GET" && url.pathname.match(/^\/shortcut\/(TutorAuto|TutorSend)$/);
    if (sc) {
      const file = await fetch(`https://sharonelimelech.github.io/math-tutor-app/shortcuts/${sc[1]}.shortcut`);
      if (!file.ok) return reply("not found", 404);
      return new Response(file.body, { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${sc[1]}.shortcut"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store"
      } });
    }
    if (req.method !== "POST" || url.pathname !== "/sync") return reply("not found", 404);

    let body;
    try { body = await req.json(); } catch { return reply("bad json", 400); }
    const { id, sub, items } = body || {};
    if (typeof id !== "string" || !/^[\w-]{8,64}$/.test(id) || !Array.isArray(items)) {
      return reply("bad request", 400);
    }
    const okSub = sub && typeof sub.endpoint === "string" && sub.endpoint.startsWith("https://") ? sub : null;
    const clean = items
      .filter(i => i && Number.isFinite(Number(i.t)) && Number(i.t) > Date.now() - 3600e3)
      .map(i => ({ t: Number(i.t), title: String(i.title || "").slice(0, 120), body: String(i.body || "").slice(0, 400) }))
      .sort((a, b) => a.t - b.t)
      .slice(0, 500);
    await kv.put("sub:" + id, JSON.stringify({ sub: okSub, items: clean }));
    // בלי wa בגוף (למשל בדיקת push) — רשומת הוואטסאפ לא משתנה
    if (body.wa && WA_KEY.test(String(body.wa.key))) {
      await kv.put("wa:" + body.wa.key, JSON.stringify(cleanWa(body.wa.items, Date.now())));
    }
    return reply("ok");
  },

  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(deliverDue(env));
  }
};

// ----- גיבוי ענן (D1) -----
// המכשיר מצפין את כל הנתונים במפתח שנגזר מקוד השחזור ושולח רק טקסט מוצפן, תחת גיבוב של הקוד.
// השרת לא יכול לקרוא אותם, ומי שאין לו את הקוד לא יכול למצוא אותם. אין מחיקה ואין רשימה.
// prev: בכל יום חדש הגרסה הקודמת נשמרת בצד — שמירה שגויה (נמחקו תלמידים) לא מוחקת את אתמול.
// ponytail: שורה אחת (data+prev) ← כל אחד עד 900KB, מתחת למגבלת 2MB לשורה ב-D1
const BACKUP_ID = /^[0-9a-f]{64}$/;
const BACKUP_MAX = 900_000;
const DAY = 86_400_000;
async function backup(req, url, env, reply) {
  if (req.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!BACKUP_ID.test(id)) return reply("bad id", 400);
    const row = await env.DB.prepare("SELECT data, at, prev, prev_at FROM backups WHERE id = ?1").bind(id).first();
    if (!row) return reply("not found", 404);
    return Response.json({ data: row.data, at: row.at, prev: row.prev, prevAt: row.prev_at },
      { headers: { ...corsFor(req), "Cache-Control": "no-store" } });
  }
  if (req.method !== "POST") return reply("not found", 404);
  let body;
  try { body = await req.json(); } catch { return reply("bad json", 400); }
  const { id, data } = body || {};
  if (typeof id !== "string" || !BACKUP_ID.test(id)) return reply("bad id", 400);
  if (typeof data !== "string" || !data || data.length > BACKUP_MAX || !/^[A-Za-z0-9+/=]+$/.test(data)) return reply("bad data", 400);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO backups (id, data, at) VALUES (?1, ?2, ?3)
    ON CONFLICT(id) DO UPDATE SET
      prev = CASE WHEN backups.at / ${DAY} < excluded.at / ${DAY} THEN backups.data ELSE backups.prev END,
      prev_at = CASE WHEN backups.at / ${DAY} < excluded.at / ${DAY} THEN backups.at ELSE backups.prev_at END,
      data = excluded.data, at = excluded.at`).bind(id, data, now).run();
  return Response.json({ at: now }, { headers: corsFor(req) });
}

// ----- חשבונות (Firebase Authentication) -----
// כל בקשה מגיעה עם "Authorization: Bearer <ID token>" מ-Firebase. השרת מוודא אותו ומשתמש רק ב-uid
// שבתוכו — אין דרך לבקש נתונים של משתמש אחר. הנתונים: מסמך אחד לחשבון עם גרסה; שמירה מצליחה רק
// מהגרסה הנוכחית (409 + הגרסה העדכנית אחרת), והאפליקציה ממזגת ושומרת שוב.
const DATA_MAX = 1_500_000; // מתחת למגבלת 2MB לשורה ב-D1
async function account(req, url, env, reply, kv) {
  if (!env.FIREBASE_PROJECT_ID) return reply("accounts not configured", 503);
  let uid;
  try { ({ uid } = await verifyIdToken((req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.FIREBASE_PROJECT_ID)); }
  catch { return reply("unauthorized", 401); }
  const json = (body, status = 200) => Response.json(body, { status, headers: { ...corsFor(req), "Cache-Control": "no-store" } });
  const readBody = async () => { try { return await req.json(); } catch { return null; } };
  const current = () => env.DB.prepare("SELECT data, version, updated_at FROM user_data WHERE uid = ?1").bind(uid).first();

  if (url.pathname === "/me/data" && req.method === "GET") {
    const row = await current();
    return json(row ? { data: JSON.parse(row.data), version: row.version, updatedAt: row.updated_at } : { data: null, version: 0 });
  }
  if (url.pathname === "/me/data" && req.method === "PUT") {
    const body = await readBody();
    const base = Number(body?.baseVersion);
    if (!Number.isInteger(base) || base < 0) return reply("bad version", 400);
    let text;
    try { text = JSON.stringify(parseBackup(body.data)); } catch { return reply("bad data", 400); }
    if (text.length > DATA_MAX) return reply("too large", 413);
    const now = Date.now();
    const r = base === 0
      ? await env.DB.prepare("INSERT INTO user_data (uid, data, version, updated_at) VALUES (?1, ?2, 1, ?3) ON CONFLICT(uid) DO NOTHING").bind(uid, text, now).run()
      : await env.DB.prepare("UPDATE user_data SET data = ?2, version = version + 1, updated_at = ?3 WHERE uid = ?1 AND version = ?4").bind(uid, text, now, base).run();
    if (!r.meta.changes) {
      const row = await current();
      return json({ conflict: true, data: row ? JSON.parse(row.data) : null, version: row ? row.version : 0 }, 409);
    }
    return json({ version: base + 1, updatedAt: now });
  }
  // מפתח הוואטסאפ של החשבון: נוצר פעם אחת; PUT מאמץ מפתח קיים (הקישור שכבר בקיצור באייפון)
  if (url.pathname === "/me/wa-key" && req.method === "GET") {
    await env.DB.prepare("INSERT INTO account_keys (uid, wa_key) VALUES (?1, ?2) ON CONFLICT(uid) DO NOTHING").bind(uid, crypto.randomUUID()).run();
    return json({ key: (await env.DB.prepare("SELECT wa_key FROM account_keys WHERE uid = ?1").bind(uid).first()).wa_key });
  }
  if (url.pathname === "/me/wa-key" && req.method === "PUT") {
    const key = String((await readBody())?.key || "");
    if (!WA_KEY.test(key)) return reply("bad key", 400);
    try {
      await env.DB.prepare("INSERT INTO account_keys (uid, wa_key) VALUES (?1, ?2) ON CONFLICT(uid) DO UPDATE SET wa_key = excluded.wa_key").bind(uid, key).run();
    } catch { return reply("key in use", 409); } // UNIQUE — מפתח של חשבון אחר
    return json({ key });
  }
  // מחיקת חשבון: כל מה שבשרת על המשתמש. (את החשבון ב-Firebase מוחקת האפליקציה.) Google ו-Facebook מחייבות.
  if (url.pathname === "/me" && req.method === "DELETE") {
    const row = await env.DB.prepare("SELECT wa_key FROM account_keys WHERE uid = ?1").bind(uid).first();
    if (row) for (const p of ["wa:", "wasent:", "waseen:"]) await kv.delete(p + row.wa_key);
    await env.DB.prepare("DELETE FROM account_keys WHERE uid = ?1").bind(uid).run();
    await env.DB.prepare("DELETE FROM user_data WHERE uid = ?1").bind(uid).run();
    return json({ deleted: true });
  }
  return reply("not found", 404);
}

async function deliverDue(env) {
  const kv = kvStore(env);
  const now = Date.now();
  // מונים ישנים של הגבלת הקצב
  await env.DB.prepare("DELETE FROM rate WHERE reset < ?1").bind(now - 3600e3).run();
  const list = await kv.list({ prefix: "sub:" });
  for (const { name } of list.keys) {
    const rec = await kv.get(name, "json");
    if (!rec) continue;
    // Legacy record (times only, keyed by endpoint hash) — delete; app re-syncs in the new format.
    if (!Array.isArray(rec.items)) { await kv.delete(name); continue; }
    const due = rec.items.filter(i => i.t <= now);
    if (!due.length) continue;
    // Prune before sending so a failed delivery never re-fires forever.
    await kv.put(name, JSON.stringify({ sub: rec.sub, items: rec.items.filter(i => i.t > now) }));

    if (rec.sub) {
      // One empty push wakes the SW; it shows every due reminder from its cache.
      const res = await fetch(rec.sub.endpoint, {
        method: "POST",
        headers: { TTL: "3600", Urgency: "high", Authorization: await vapidAuth(rec.sub.endpoint, env) }
      });
      if (res.status === 404 || res.status === 410) {
        await kv.put(name, JSON.stringify({ sub: null, items: rec.items.filter(i => i.t > now) }));
      }
    }
  }
}

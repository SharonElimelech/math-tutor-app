// Push server for "המורה שלי".
// Stores reminder items (time + text) per device. Cron sends an empty web push
// "tickle" for each due reminder; the service worker then shows the notification
// from its cached copy. (Email delivery via Resend was removed — push works.)

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const ORIGINS = [
  "https://sharonelimelech.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];
const corsFor = req => {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
  const due = (items || []).filter(i => i.after <= now && now < i.until && !sent[i.id]);
  for (const i of due) sent[i.id] = i.until;
  return { due: due.map(({ phone, text }) => ({ phone, text })), sent };
}

export default {
  async fetch(req, env) {
    const reply = (body, status = 200) => new Response(body, { status, headers: corsFor(req) });
    if (req.method === "OPTIONS") return reply(null, 204);
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/wa") {
      const key = url.searchParams.get("key") || "";
      if (!WA_KEY.test(key)) return reply("bad key", 400);
      const items = await env.SUBS.get("wa:" + key, "json");
      const { due, sent } = takeDue(items, await env.SUBS.get("wasent:" + key, "json"), Date.now());
      if (due.length) await env.SUBS.put("wasent:" + key, JSON.stringify(sent));
      return Response.json(due, { headers: { "Cache-Control": "no-store" } });
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
    await env.SUBS.put("sub:" + id, JSON.stringify({ sub: okSub, items: clean }));
    // בלי wa בגוף (למשל בדיקת push) — רשומת הוואטסאפ לא משתנה
    if (body.wa && WA_KEY.test(String(body.wa.key))) {
      await env.SUBS.put("wa:" + body.wa.key, JSON.stringify(cleanWa(body.wa.items, Date.now())));
    }
    return reply("ok");
  },

  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(deliverDue(env));
  }
};

async function deliverDue(env) {
  const now = Date.now();
  const list = await env.SUBS.list({ prefix: "sub:" });
  for (const { name } of list.keys) {
    const rec = await env.SUBS.get(name, "json");
    if (!rec) continue;
    // Legacy record (times only, keyed by endpoint hash) — delete; app re-syncs in the new format.
    if (!Array.isArray(rec.items)) { await env.SUBS.delete(name); continue; }
    const due = rec.items.filter(i => i.t <= now);
    if (!due.length) continue;
    // Prune before sending so a failed delivery never re-fires forever.
    await env.SUBS.put(name, JSON.stringify({ sub: rec.sub, items: rec.items.filter(i => i.t > now) }));

    if (rec.sub) {
      // One empty push wakes the SW; it shows every due reminder from its cache.
      const res = await fetch(rec.sub.endpoint, {
        method: "POST",
        headers: { TTL: "3600", Urgency: "high", Authorization: await vapidAuth(rec.sub.endpoint, env) }
      });
      if (res.status === 404 || res.status === 410) {
        await env.SUBS.put(name, JSON.stringify({ sub: null, items: rec.items.filter(i => i.t > now) }));
      }
    }
  }
}

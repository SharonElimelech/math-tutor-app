// Push server for "המורה שלי".
// Stores reminder items (time + text) per device. Cron delivers due reminders
// two ways: email via Resend (reliable on iPhone even when the phone is locked)
// and an empty web push "tickle" when a push subscription exists.
// Note: reminder texts now live on the server — required for email delivery.

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
    "jwk", JSON.parse(env.VAPID_PRIVATE_JWK),
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

export default {
  async fetch(req, env) {
    const reply = (body, status = 200) => new Response(body, { status, headers: corsFor(req) });
    if (req.method === "OPTIONS") return reply(null, 204);
    const url = new URL(req.url);
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

    if (env.RESEND_API_KEY && env.EMAIL_TO) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "המורה שלי <onboarding@resend.dev>",
          to: env.EMAIL_TO,
          subject: due[0].title || "תזכורת שיעור",
          text: due.map(i => i.body || i.title || "תזכורת").join("\n")
        })
      });
    }

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

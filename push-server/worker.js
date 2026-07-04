// Push server for "המורה שלי".
// Stores only push subscriptions + fire timestamps (no lesson content — privacy).
// Cron fires an empty push ("tickle"); the app's service worker reads reminder
// texts from its local cache and shows the notification.

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "https://sharonelimelech.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
const reply = (body, status = 200) => new Response(body, { status, headers: CORS });

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

const subKey = async endpoint =>
  "sub:" + b64u(await crypto.subtle.digest("SHA-256", enc.encode(endpoint)));

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return reply(null, 204);
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/sync") return reply("not found", 404);

    let body;
    try { body = await req.json(); } catch { return reply("bad json", 400); }
    const { sub, times } = body || {};
    if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !Array.isArray(times)) {
      return reply("bad request", 400);
    }
    const clean = times.map(Number)
      .filter(t => Number.isFinite(t) && t > Date.now() - 3600e3)
      .sort((a, b) => a - b)
      .slice(0, 500);
    await env.SUBS.put(await subKey(sub.endpoint), JSON.stringify({ sub, times: clean }));
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
    if (!rec || !Array.isArray(rec.times)) continue;
    const due = rec.times.some(t => t <= now);
    if (!due) continue;
    // Prune before sending so a failed push never re-fires forever.
    await env.SUBS.put(name, JSON.stringify({ ...rec, times: rec.times.filter(t => t > now) }));
    // One empty push wakes the SW; it shows every due reminder from its cache.
    const res = await fetch(rec.sub.endpoint, {
      method: "POST",
      headers: { TTL: "3600", Urgency: "high", Authorization: await vapidAuth(rec.sub.endpoint, env) }
    });
    if (res.status === 404 || res.status === 410) await env.SUBS.delete(name);
  }
}

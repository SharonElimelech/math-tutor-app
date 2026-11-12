// בדיקת "תעודת התחברות" (ID token) של Firebase: חתומה ב-RS256 במפתח של Google, שייכת לפרויקט שלנו
// ולא פגה. הסיסמאות וההתחברות עצמה אצל Firebase — כאן רק מוודאים מי המשתמש.
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let cache = { keys: null, until: 0 };

export async function googleKeys(now = Date.now()) {
  if (cache.keys && now < cache.until) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`keys ${res.status}`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1]) || 3600;
  cache = { keys: (await res.json()).keys, until: now + maxAge * 1000 };
  return cache.keys;
}

const bytes = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const json = s => JSON.parse(new TextDecoder().decode(bytes(s)));
const SKEW = 300; // שניות — שעון לא מדויק בטלפון

export async function verifyIdToken(token, projectId, { now = Date.now(), keys = googleKeys } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed");
  const [h, p, s] = parts;
  const header = json(h), claims = json(p);
  if (header.alg !== "RS256" || !header.kid) throw new Error("alg");
  const jwk = (await keys(now)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(s), new TextEncoder().encode(`${h}.${p}`))) throw new Error("signature");
  const t = Math.floor(now / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("audience");
  if (!(claims.exp > t) || !(claims.iat <= t + SKEW) || !(claims.auth_time <= t + SKEW)) throw new Error("time");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new Error("subject");
  return { uid: claims.sub, email: claims.email || "" };
}

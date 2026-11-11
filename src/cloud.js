import { PUSH_SERVER } from "./push.js";

// גיבוי ענן מוצפן. הכול מוצפן כאן במכשיר (AES-GCM) במפתח שנגזר מקוד השחזור, והשרת מקבל רק
// טקסט מוצפן תחת גיבוב של הקוד: הוא לא יכול לקרוא את הנתונים, ובלי הקוד אי אפשר גם למצוא אותם.
// הקוד: 20 תווים אקראיים (100 ביט). ponytail: אקראי וארוך מספיק ← SHA-256 פשוט, בלי PBKDF2.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: בלי I, L, O, U — לא מתבלבלים בהקלדה

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const raw = [...bytes].map(b => ALPHABET[b & 31]).join("");
  return raw.match(/.{4}/g).join("-");
}

// הקלדה חופשית: אותיות קטנות, רווחים, מקפים, O במקום 0 ו-I/L במקום 1
export function normalizeCode(input) {
  return String(input ?? "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
}
export const validCode = input => {
  const c = normalizeCode(input);
  return c.length === 20 && [...c].every(ch => ALPHABET.includes(ch));
};

const enc = new TextEncoder();
const digest = async text => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
const toB64 = bytes => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// טביעה קצרה — לדעת אם משהו השתנה מאז הגיבוי האחרון (בלי לשמור עותק נוסף במכשיר)
export const fingerprint = async text => hex(await digest(text)).slice(0, 24);
export const formatCode = input => normalizeCode(input).match(/.{1,4}/g)?.join("-") || "";

export async function cloudKeys(code) {
  if (!validCode(code)) throw new Error("bad code");
  const c = normalizeCode(code);
  const key = await crypto.subtle.importKey("raw", await digest("key:" + c), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id: hex(await digest("id:" + c)), key };
}

export async function seal(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return toB64(out);
}

export async function unseal(text, key) {
  const bytes = fromB64(text);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function cloudSave(code, value, server = PUSH_SERVER) {
  const { id, key } = await cloudKeys(code);
  const res = await fetch(`${server}/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, data: await seal(value, key) })
  });
  if (!res.ok) throw new Error(`backup failed: ${res.status}`);
  return (await res.json()).at;
}

// null = אין גיבוי לקוד הזה. previous = הגרסה מהיום הקודם שבו נשמר (אם יש)
export async function cloudLoad(code, server = PUSH_SERVER) {
  const { id, key } = await cloudKeys(code);
  const res = await fetch(`${server}/backup?id=${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  const row = await res.json();
  return {
    latest: { value: await unseal(row.data, key), at: row.at },
    previous: row.prev ? { value: await unseal(row.prev, key), at: row.prevAt } : null
  };
}

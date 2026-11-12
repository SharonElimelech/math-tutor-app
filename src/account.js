import { FIREBASE_CONFIG } from "./firebase-config.js";
import { PUSH_SERVER } from "./push.js";

// חשבונות: ההתחברות אצל Firebase (סיסמאות לא עוברות אצלנו), הנתונים בשרת שלנו לפי המשתמש.
// ה-SDK נטען מה-CDN של Google רק כשצריך — האפליקציה עצמה נשארת בלי שלב בנייה.
const SDK = "https://www.gstatic.com/firebasejs/13.1.0";
let fb = null;
async function firebase() {
  if (fb) return fb;
  const [{ initializeApp }, auth] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`)]);
  const a = auth.getAuth(initializeApp(FIREBASE_CONFIG));
  a.languageCode = "he"; // מיילי איפוס סיסמה וחלון Google בעברית
  fb = { a, ...auth };
  return fb;
}

export async function onAuth(callback) { const f = await firebase(); return f.onAuthStateChanged(f.a, callback); }
export const currentUser = () => fb?.a.currentUser || null;
export async function signInEmail(email, password) { const f = await firebase(); return f.signInWithEmailAndPassword(f.a, email, password); }
export async function signUpEmail(email, password) { const f = await firebase(); return f.createUserWithEmailAndPassword(f.a, email, password); }
export async function resetPassword(email) { const f = await firebase(); return f.sendPasswordResetEmail(f.a, email); }
export async function signInGoogle() { const f = await firebase(); return f.signInWithPopup(f.a, new f.GoogleAuthProvider()); }
export async function signInFacebook() {
  const f = await firebase();
  const provider = new f.FacebookAuthProvider();
  provider.addScope("email");
  return f.signInWithPopup(f.a, provider);
}
export async function signOutUser() { const f = await firebase(); return f.signOut(f.a); }
export async function deleteFirebaseUser() { const f = await firebase(); return f.a.currentUser?.delete(); }

async function api(method, path, body) {
  const user = currentUser();
  if (!user) throw new Error("not signed in");
  const res = await fetch(PUSH_SERVER + path, {
    method,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* תשובת טקסט */ }
  return { status: res.status, json };
}
export const getAccountData = () => api("GET", "/me/data");
export const putAccountData = (data, baseVersion) => api("PUT", "/me/data", { data, baseVersion });
export const getAccountWaKey = () => api("GET", "/me/wa-key");
export const putAccountWaKey = key => api("PUT", "/me/wa-key", { key });
export const deleteAccountData = () => api("DELETE", "/me");

// שגיאות Firebase → משפט בעברית. "" = המשתמש ביטל, לא מציגים כלום.
const ERRORS = {
  "auth/invalid-credential": "המייל או הסיסמה לא נכונים.",
  "auth/wrong-password": "המייל או הסיסמה לא נכונים.",
  "auth/user-not-found": "אין חשבון עם המייל הזה. אפשר להירשם.",
  "auth/email-already-in-use": "כבר יש חשבון עם המייל הזה — אפשר להתחבר.",
  "auth/weak-password": "הסיסמה צריכה להיות לפחות 6 תווים.",
  "auth/invalid-email": "כתובת המייל לא תקינה.",
  "auth/missing-password": "צריך להקליד סיסמה.",
  "auth/popup-blocked": "הדפדפן חסם את חלון ההתחברות. אפשר לנסות שוב.",
  "auth/popup-closed-by-user": "",
  "auth/cancelled-popup-request": "",
  "auth/network-request-failed": "אין חיבור לאינטרנט.",
  "auth/too-many-requests": "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.",
  "auth/requires-recent-login": "מטעמי אבטחה צריך להתחבר שוב ואז לחזור על הפעולה.",
  // אותו מייל כבר רשום בדרך אחרת (למשל Google) — Firebase מחזיק חשבון אחד לכל מייל
  "auth/account-exists-with-different-credential": "כבר יש חשבון עם המייל הזה בדרך אחרת — אפשר להתחבר עם Google או עם מייל וסיסמה."
};
export const authErrorText = error => ERRORS[error?.code] ?? "משהו השתבש. אפשר לנסות שוב.";

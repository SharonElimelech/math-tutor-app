// מיזוג בין מכשירים של אותו חשבון — שלושה כיוונים, לכל תלמיד/שיעור לפי id:
//   base   = מה שהיה בסנכרון האחרון (משותף לשני הצדדים)
//   local  = מה שיש עכשיו במכשיר
//   remote = מה שיש עכשיו בחשבון (מכשיר אחר שמר בינתיים)
// נוספה בצד אחד → נכנסת. נמחקה בצד אחד → נמחקת (לא "חוזרת לחיים" מהמכשיר השני).
// שונתה במכשיר → גרסת המכשיר; אחרת → גרסת החשבון. הגדרות — אותו דבר לכל שדה.
// ponytail: שינוי באותה רשומה בשני המכשירים — המכשיר שמסנכרן אחרון גובר (אין מיזוג בתוך רשומה).
const canon = v => (v && typeof v === "object" ? JSON.stringify(v, Object.keys(v).sort()) : JSON.stringify(v));
const same = (a, b) => canon(a) === canon(b);

function mergeList(base, local, remote) {
  const B = new Map(base.map(r => [r.id, r]));
  const R = new Map(remote.map(r => [r.id, r]));
  const out = [];
  const seen = new Set();
  for (const l of local) {
    seen.add(l.id);
    const b = B.get(l.id), r = R.get(l.id);
    if (!b) out.push(l);                       // חדשה במכשיר (או בשניהם — המכשיר)
    else if (r) out.push(same(l, b) ? r : l);  // קיימת בשניהם: מי ששינה
    // b && !r: נמחקה בחשבון
  }
  for (const r of remote) {
    if (seen.has(r.id)) continue;
    if (!B.has(r.id)) out.push(r);             // חדשה בחשבון
    // B.has && !local: נמחקה במכשיר
  }
  return out;
}

export function mergeSnapshots(base, local, remote) {
  const b = base || { students: [], lessons: [], settings: null };
  const settings = { ...remote.settings };
  for (const k of new Set([...Object.keys(local.settings || {}), ...Object.keys(remote.settings || {})])) {
    if (!b.settings || !same(local.settings?.[k], b.settings[k])) settings[k] = local.settings?.[k];
  }
  return {
    students: mergeList(b.students, local.students, remote.students),
    lessons: mergeList(b.lessons, local.lessons, remote.lessons),
    settings
  };
}

export const sameSnapshot = (a, b) =>
  same(a.settings, b.settings) &&
  ["students", "lessons"].every(k => a[k].length === b[k].length && a[k].every((r, i) => same(r, b[k][i])));

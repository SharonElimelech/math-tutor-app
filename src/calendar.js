// new Date("YYYY-MM-DD") נקרא כחצות UTC ולכן מציג את היום הקודם בכל אזור שמאחורי
// גריניץ'. הוספת T00:00 מפרשת את התאריך כחצות מקומית — היום הנכון בכל מקום.
export const formatDate = value => new Date(
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value
).toLocaleDateString("he-IL", {
  weekday: "short",
  day: "numeric",
  month: "numeric"
});

export const formatTime = value => value || "";

export const ymd = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const todayString = () => ymd(new Date());

export const monthKey = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const hebrewFormatter = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long" });
const holidayCache = new Map();

function hebrewParts(date) {
  let month = "", day = 0;
  for (const part of hebrewFormatter.formatToParts(date)) {
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = Number.parseInt(part.value, 10);
  }
  return { month, day };
}

export function holidayFor(dateString) {
  if (holidayCache.has(dateString)) return holidayCache.get(dateString);
  const { month, day } = hebrewParts(new Date(`${dateString}T00:00`));
  let holiday = null;

  if (month === "Tishri") {
    if (day === 1 || day === 2) holiday = { name: "ראש השנה", chag: true };
    else if (day === 3) holiday = { name: "צום גדליה" };
    else if (day === 10) holiday = { name: "יום כיפור", chag: true };
    else if (day === 15) holiday = { name: "סוכות", chag: true };
    else if (day >= 16 && day <= 20) holiday = { name: "חול המועד סוכות" };
    else if (day === 21) holiday = { name: "הושענא רבה" };
    else if (day === 22) holiday = { name: "שמחת תורה", chag: true };
  } else if ((month === "Kislev" && day >= 25) || (month === "Tevet" && day <= 2)) {
    holiday = { name: "חנוכה" };
  } else if (month === "Tevet" && day === 10) {
    holiday = { name: "צום עשרה בטבת" };
  } else if (month === "Shevat" && day === 15) {
    holiday = { name: "ט״ו בשבט" };
  } else if (month === "Adar" || month === "Adar II") {
    if (day === 13) holiday = { name: "תענית אסתר" };
    else if (day === 14) holiday = { name: "פורים", chag: true };
    else if (day === 15) holiday = { name: "שושן פורים" };
  } else if (month === "Nisan") {
    if (day === 15) holiday = { name: "פסח", chag: true };
    else if (day >= 16 && day <= 20) holiday = { name: "חול המועד פסח" };
    else if (day === 21) holiday = { name: "שביעי של פסח", chag: true };
    else if (day === 27) holiday = { name: "יום השואה" };
  } else if (month === "Iyar") {
    if (day === 4) holiday = { name: "יום הזיכרון" };
    else if (day === 5) holiday = { name: "יום העצמאות", chag: true };
    else if (day === 18) holiday = { name: "ל״ג בעומר" };
    else if (day === 28) holiday = { name: "יום ירושלים" };
  } else if (month === "Sivan" && day === 6) {
    holiday = { name: "שבועות", chag: true };
  } else if (month === "Tammuz" && day === 17) {
    holiday = { name: "צום י״ז בתמוז" };
  } else if (month === "Av" && day === 9) {
    holiday = { name: "תשעה באב" };
  }

  holidayCache.set(dateString, holiday);
  return holiday;
}

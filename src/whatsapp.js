// וואטסאפ: נרמול מספר ישראלי לפורמט בינלאומי וקישורי שליחה.
// web — טאב בדסקטופ. scheme — ניווט באותו הקשר בטלפון (iOS). intent — אנדרואיד, עם fallback
// מובנה לאתר כשוואטסאפ לא מותקן (בלי package= — גם WhatsApp Business עונה ל-whatsapp://). ניווט באותו הקשר משאיר את האפליקציה כפי שהיא — בלי חלון
// דפדפן שנשאר מעליה אחרי החזרה מוואטסאפ.

export function normalizePhone(raw) {
  let phone = String(raw ?? "").replace(/[^0-9]/g, "");
  if (!phone) return "";
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = "972" + phone.slice(1);
  else if (!phone.startsWith("972")) phone = "972" + phone;
  return phone;
}

// הודעה מתבנית שהמורה ערכה בהגדרות: {תלמיד} מוחלף בערך. משתנה ריק לוקח איתו את הרווח שלפניו —
// "שלום {הורה}," בלי שם הורה יוצא "שלום,". משתנה לא מוכר נשאר כפי שנכתב.
export function fillTemplate(template, vars) {
  return String(template ?? "").replace(/([ \t]*)\{([^{}]+)\}/g, (match, space, key) => {
    if (!Object.hasOwn(vars, key)) return match;
    const value = String(vars[key] ?? "");
    return value ? space + value : "";
  });
}

// הרצת קיצור דרך באייפון עם רשימת הודעות כקלט טקסט (JSON). הקיצור קורא אותה ב"קבלת מילון מקלט".
export function shortcutRunUrl(name, items) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(JSON.stringify(items))}`;
}

export function whatsappLinks(rawPhone, msg = "") {
  const phone = normalizePhone(rawPhone);
  const text = msg ? encodeURIComponent(msg) : "";
  const web = `https://wa.me/${phone}${text ? `?text=${text}` : ""}`;
  const query = `phone=${phone}${text ? `&text=${text}` : ""}`;
  return {
    web,
    scheme: `whatsapp://send?${query}`,
    intent: `intent://send?${query}#Intent;scheme=whatsapp;S.browser_fallback_url=${encodeURIComponent(web)};end`
  };
}

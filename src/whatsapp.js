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

import {
  APP_VERSION,
  DATA_VERSION,
  DEFAULT_SETTINGS,
  createSnapshot,
  parseBackup,
  reminderLeadMinutes
} from "./src/data.js";
import {
  formatDate as fmtDate,
  formatTime as fmtTime,
  holidayFor,
  monthKey,
  todayString as todayStr,
  ymd
} from "./src/calendar.js";
import { buildLessonIndex, debtAgeWeeks, findConflicts, findFreeSlots, summarizeMonth } from "./src/selectors.js";
import { AppStorage } from "./src/storage.js";
import {
  createLessonsCalendar,
  dueLessonReminders,
  duePaymentReminders,
  lessonsAwaitingConfirmation,
  nextLessonReminderTimestamp,
  paymentSignature,
  reminderSignature,
  upcomingReminderLessons
} from "./src/reminders.js";
import { enablePush, pushSupported, pushSubscribed, syncPush, sendClosedAppTest } from "./src/push.js";

/* =========================================================
   "המורה שלי" – אפליקציה לניהול שיעורים פרטיים
   כל הנתונים נשמרים מקומית בטלפון (localStorage).
   ========================================================= */

const App = (() => {
  "use strict";

  // ----- מערכת אייקונים וקטוריים -----
  const SVG = {
    calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 9.5h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 13h6M9 17h4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5L16 9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    whatsapp: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.5L3 21l2-5.4A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.6 9.6c0 3.8 2 5.8 5.8 6.3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10.5 21a2 2 0 0 0 3 0"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  const icon = (name, cls) =>
    `<svg class="${cls || "ic"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SVG[name]}</svg>`;

  // ----- שכבת נתונים -----
  const clone = value => JSON.parse(JSON.stringify(value));
  const DB = new AppStorage(localStorage);

  const HORIZON_WEEKS = 52; // כמה שבועות קדימה לממש לשיעור חוזר קבוע
  const loaded = DB.load();
  let students = loaded.state.students;
  let lessons = loaded.state.lessons;
  let settings = loaded.state.settings;
  let lastSavedState = clone(loaded.state);
  let startupDataError = loaded.error;
  let lessonIndex = buildLessonIndex(students, lessons);

  let viewMonth = new Date();      // החודש שמוצג בסיכום הכנסות
  let calMonth  = new Date();      // החודש שמוצג בלוח החודשי
  let selectedDay = null;          // יום נבחר בלוח החודשי
  let homeCalMode = localStorage.getItem("mt_home_cal") || "week"; // day | week | month | list — תצוגת היומן בבית
  let moneyTab = "payments";       // payments | income
  let showPast = false;

  // ----- מיגרציית נתונים -----
  function migrate() {
    if (loaded.needsPersist) persistSnapshot();
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function restoreLastSavedState() {
    const restored = clone(lastSavedState);
    students = restored.students;
    lessons = restored.lessons;
    settings = restored.settings;
    refreshIndex();
  }
  const refreshIndex = () => { lessonIndex = buildLessonIndex(students, lessons); };
  function persistSnapshot() {
    try {
      const snapshot = createSnapshot(students, lessons, settings);
      DB.save(snapshot);
      lastSavedState = clone(snapshot);
      refreshIndex();
      return true;
    } catch (error) {
      restoreLastSavedState();
      toast("השמירה נכשלה. הנתונים הקודמים נשמרו ולא נפגעו.", "err");
      return false;
    }
  }
  const save = () => {
    const saved = persistSnapshot();
    if (saved) reschedule();
    return saved;
  };
  const saveSettings = () => persistSnapshot();

  // ----- עזרי כסף ותצוגה -----
  const cur = n => `${settings.currency}${n}`;
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("");

  const studentById = id => lessonIndex.studentsById.get(id);
  // מחיר שיעור: עדיפות למחיר ששמור על השיעור, אחרת מחיר התלמיד
  const lessonPrice = l => {
    if (typeof l.price === "number") return l.price;
    const s = studentById(l.studentId);
    return s ? (s.price || 0) : 0;
  };

  // ----- הודעות צפות (toast) -----
  function toast(msg, type = "", action = null, duration = 3000) {
    const wrap = document.getElementById("toastWrap");
    if (!wrap) return alert(msg);
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    const ico = type === "ok" ? "checkCircle" : type === "err" ? "warn" : "info";
    el.innerHTML = icon(ico) + "<span>" + escapeHtml(msg) + "</span>";
    if (action) {
      el.classList.add("has-action");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => {
        clearTimeout(timer);
        action.run();
        el.remove();
      }, { once: true });
      el.appendChild(button);
    }
    wrap.appendChild(el);
    const timer = setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 260);
    }, duration);
  }

  // החלפת innerHTML מוחקת את הפוקוס מהמקלדת. שליחת תזכורת מרנדרת מחדש, ולכן
  // הפוקוס היה קופץ ל-body אחרי כל לחיצה. משחזרים לפי המזהה של הכפתור.
  function renderKeepFocus(el, html) {
    const id = document.activeElement && el.contains(document.activeElement)
      ? document.activeElement.id : "";
    el.innerHTML = html;
    if (id) document.getElementById(id)?.focus({ preventScroll: true });
  }

  // ----- ניווט -----
  function go(view, after) {
    const target = document.getElementById("view-" + view);
    if (!target) return;
    const apply = () => {
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      target.classList.add("active");
      document.querySelectorAll(".nav-btn").forEach(b => {
        const active = b.dataset.view === view;
        b.classList.toggle("active", active);
        if (active) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      render(view);
      window.scrollTo(0, 0);
      // Move focus to the new view's heading so screen readers announce the change.
      const heading = target.querySelector("h2");
      if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
      if (after) after();
    };
    // מעבר מסך חלק דרך View Transitions API — רק כשנתמך, כשבאמת מחליפים מסך, ובלי תנועה מופחתת
    if (document.startViewTransition && !target.classList.contains("active") &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // מעבר שנקטע (שתי לחיצות ניווט מהירות) דוחה את ready/finished — בלי catch זו שגיאה בקונסול
      const transition = document.startViewTransition(apply);
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
    } else {
      apply();
    }
  }

  // ----- מודאל -----
  let modalReturnFocus = null;
  const modalSiblings = () => document.querySelectorAll("body > header, body > main, body > nav");
  function openModal(html) {
    modalReturnFocus = document.activeElement;
    document.getElementById("modalBody").innerHTML = html;
    document.getElementById("modal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    modalSiblings().forEach(element => { element.inert = true; });
    setTimeout(() => {
      const preferred = document.getElementById("f-name");
      const fallback = document.querySelector("#modalBody input, #modalBody button, .modal-close");
      (preferred || fallback)?.focus({ preventScroll: true });
    }, 60);
  }
  function closeModal() {
    document.getElementById("modal").classList.add("hidden");
    document.body.classList.remove("modal-open");
    modalSiblings().forEach(element => { element.inert = false; });
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus({ preventScroll: true });
    modalReturnFocus = null;
  }
  function modalOpen() {
    return !document.getElementById("modal").classList.contains("hidden");
  }
  function askConfirmation(message, confirmLabel = "אישור") {
    const dialog = document.getElementById("confirmDialog");
    document.getElementById("confirmMessage").textContent = message;
    dialog.querySelector(".confirm-submit").textContent = confirmLabel;
    dialog.returnValue = "cancel";
    dialog.showModal();
    // לא מסתמכים על אירוע close בלבד — יש סביבות שבהן הוא לא נורה (הדיאלוג נסגר
    // אבל ה-Promise נתקע). מאזינים לכל מקורות הסגירה וסוגרים ידנית.
    return new Promise(resolve => {
      const form = dialog.querySelector("form");
      let settled = false;
      const finish = confirmed => {
        if (settled) return;
        settled = true;
        form.removeEventListener("submit", onSubmit);
        dialog.removeEventListener("cancel", onCancel);
        dialog.removeEventListener("close", onClose);
        dialog.removeEventListener("keydown", onKey);
        if (dialog.open) dialog.close();
        resolve(confirmed);
      };
      const onSubmit = e => { e.preventDefault(); finish(e.submitter?.value === "confirm"); };
      const onCancel = () => finish(false);
      const onClose = () => finish(dialog.returnValue === "confirm");
      const onKey = e => { if (e.key === "Escape") finish(false); };
      form.addEventListener("submit", onSubmit);
      dialog.addEventListener("cancel", onCancel);
      dialog.addEventListener("close", onClose);
      dialog.addEventListener("keydown", onKey);
    });
  }
  // סגירה בלחיצה על הרקע, ב-Esc, ושמירה ב-Enter
  function initModalControls() {
    const modal = document.getElementById("modal");
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", e => {
      if (!modalOpen()) return;
      if (e.key === "Escape") { closeModal(); return; }
      if (e.key === "Tab") {
        const focusable = [...modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")]
          .filter(element => element.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox") {
        const primary = document.querySelector("#modalBody .btn-green");
        if (primary) { e.preventDefault(); primary.click(); }
      }
    });
  }

  // ========== תלמידים ==========
  function openStudentForm(id) {
    const s = id ? studentById(id) : { name: "", parentName: "", phone: "", studentPhone: "", price: settings.defaultPrice };
    openModal(`
      <div class="modal-title-block">
        <span class="modal-title-icon">${icon("edit")}</span>
        <div><h3 id="modalTitle">${id ? "עריכת תלמיד" : "תלמיד חדש"}</h3><p>${id ? "עדכון פרטי הקשר והתעריף" : "הפרטים הדרושים לקביעת שיעור ושליחת תזכורת"}</p></div>
      </div>
      <div class="form-section">
        <label for="f-name">שם התלמיד <span class="required-note">חובה</span></label>
        <input id="f-name" value="${escapeHtml(s.name)}" placeholder="לדוגמה: דנה כהן" autocomplete="name">
        <div id="err-name" class="field-error" style="display:none">נא להזין שם תלמיד</div>
        <div class="row">
          <div><label for="f-parent">שם ההורה</label><input id="f-parent" value="${escapeHtml(s.parentName)}" placeholder="לדוגמה: רונית"></div>
          <div><label for="f-phone">טלפון ההורה (וואטסאפ)</label><input id="f-phone" type="tel" inputmode="tel" value="${escapeHtml(s.phone)}" placeholder="05X-XXXXXXX" autocomplete="tel"></div>
        </div>
        <label for="f-student-phone">טלפון התלמיד (וואטסאפ) — לתזכורות שיעור</label>
        <input id="f-student-phone" type="tel" inputmode="tel" value="${escapeHtml(s.studentPhone || "")}" placeholder="05X-XXXXXXX">
        <label for="f-price">מחיר לשיעור (${escapeHtml(settings.currency)})</label>
        <input id="f-price" type="number" inputmode="numeric" min="0" value="${escapeHtml(s.price)}" placeholder="120">
      </div>
      <div class="modal-actions">
        ${id
          ? `<button class="btn btn-green btn-block" onclick="App.saveStudent('${id}')">${icon("check")} שמירת שינויים</button>
             <button class="btn btn-light btn-block" onclick="App.scheduleForStudent('${id}')">${icon("calendar")} קביעת שיעור</button>`
          : `<button class="btn btn-green btn-block" onclick="App.saveStudent('', true)">${icon("calendar")} הוספה וקביעת שיעור</button>
             <button class="btn btn-light btn-block" onclick="App.saveStudent('')">${icon("check")} הוספה בלבד</button>`}
      </div>
      ${id ? `
        ${studentSummaryLine(id)}
        <div class="danger-zone"><div><strong>מחיקת תלמיד</strong><span>כולל כל השיעורים והיסטוריית התשלומים</span></div><button class="btn btn-danger" onclick="App.deleteStudent('${id}')">מחיקה</button></div>
      ` : ""}
    `);
  }

  // שורת סיכום מהירה בכרטיס תלמיד: שיעורים קרובים + חוב פתוח
  function studentSummaryLine(id) {
    const today = todayStr();
    const upcoming = lessonIndex.forStudent(id).filter(l => l.date >= today && !l.done).length;
    const owed = lessonIndex.unpaidForStudent(id)
      .reduce((sum, l) => sum + lessonPrice(l), 0);
    return `<div class="profile-summary" aria-label="סיכום תלמיד">
      <span><b>${upcoming}</b> שיעורים קרובים</span>
      <span class="${owed > 0 ? "has-debt" : ""}"><b>${cur(owed)}</b> יתרה פתוחה</span>
    </div>`;
  }

  function scheduleForStudent(id) {
    closeModal();
    openLessonForm(null, id);
  }

  // "עוד שיעור כמו הקודם": משכפל את השיעור האחרון של התלמיד שבוע קדימה (לשבוע הקרוב), בלי טופס
  function repeatLastLesson(studentId) {
    const all = lessonIndex.forStudent(studentId); // ממוין כרונולוגית באינדקס
    const last = all[all.length - 1];
    if (!last) { scheduleForStudent(studentId); return; }
    const today = todayStr();
    const d = new Date(`${last.date}T00:00:00`);
    do { d.setDate(d.getDate() + 7); } while (ymd(d) < today);
    const copy = {
      id: uid(), studentId, date: ymd(d), time: last.time,
      duration: last.duration, topic: last.topic || "", done: false, paid: false
    };
    if (typeof last.price === "number") copy.price = last.price;
    lessons.push(copy);
    if (!save()) { lessons.pop(); render(); return; }
    closeModal();
    render();
    toast(`נקבע שיעור ${dayLabelPlain(copy.date)} בשעה ${fmtTime(copy.time)}`, "ok", {
      label: "ביטול",
      run: () => {
        const i = lessons.findIndex(x => x.id === copy.id);
        if (i > -1) { lessons.splice(i, 1); save(); render(); }
      }
    });
  }

  // פרופיל תלמיד: תמונת מצב, נושא הבא, הערות פרטיות והיסטוריית שיעורים
  function openStudentProfile(id) {
    const s = studentById(id);
    if (!s) return openStudentForm(id);
    const today = todayStr();
    const all = lessonIndex.forStudent(id);
    const upcoming = all.filter(l => l.date >= today && !l.done); // כבר ממוין באינדקס
    const next = upcoming[0];
    const done = all.filter(l => l.done)
      .sort((a, b) => (b.date + b.time < a.date + a.time ? -1 : 1));
    const owed = lessonIndex.unpaidForStudent(id).reduce((sum, l) => sum + lessonPrice(l), 0);
    const totalPaid = done.filter(l => l.paid).reduce((sum, l) => sum + lessonPrice(l), 0);
    const contact = escapeHtml(s.parentName) + (s.phone ? ` · ${escapeHtml(s.phone)}` : "");

    const history = done.length ? `<ul class="profile-lessons" aria-label="היסטוריית שיעורים">
      ${done.slice(0, 15).map(l => `<li class="profile-lesson">
        <span class="profile-lesson-date">${fmtDate(l.date)}</span>
        <span class="profile-lesson-topic">${l.topic ? escapeHtml(l.topic) : '<i class="muted-note">ללא נושא</i>'}</span>
        <span class="profile-pill ${l.paid ? "paid" : "due"}">${l.paid ? "שולם" : "חוב"}</span>
      </li>`).join("")}
    </ul>${done.length > 15 ? `<p class="muted-note profile-more">מוצגים 15 מתוך ${done.length} שיעורים</p>` : ""}`
      : `<p class="muted-note">עדיין לא התקיימו שיעורים.</p>`;

    openModal(`
      <div class="modal-title-block">
        <span class="student-avatar profile-avatar" aria-hidden="true">${escapeHtml(initials(s.name))}</span>
        <div><h3 id="modalTitle">${escapeHtml(s.name)}</h3><p>${contact || "לא הוגדר איש קשר"} · ${cur(s.price)} לשיעור</p></div>
      </div>
      <div class="profile-summary" aria-label="סיכום תלמיד">
        <span><b>${upcoming.length}</b> שיעורים קרובים</span>
        <span class="${owed > 0 ? "has-debt" : ""}"><b>${cur(owed)}</b> יתרה פתוחה</span>
        <span><b>${cur(totalPaid)}</b> נגבה בסך הכול</span>
      </div>
      ${next ? `<div class="profile-next">${icon("calendar", "ic-sub")} <span>נושא הבא · ${dayLabelPlain(next.date)} ${fmtTime(next.time)}</span><strong>${next.topic ? escapeHtml(next.topic) : "טרם נקבע נושא"}</strong></div>` : ""}
      <div class="modal-actions profile-quick">
        <button class="btn btn-green btn-block" onclick="App.scheduleForStudent('${id}')">${icon("calendar")} קביעת שיעור</button>
        <button class="btn btn-light btn-block" onclick="App.openStudentForm('${id}')">${icon("edit")} עריכת פרטים</button>
      </div>
      ${all.length ? `<button class="btn btn-light btn-block" onclick="App.repeatLastLesson('${id}')">${icon("repeat")} עוד שיעור כמו הקודם</button>` : ""}
      ${owed > 0 && s.phone ? `<button class="btn btn-wa btn-block" onclick="App.sendWhatsApp('${id}')">${icon("whatsapp")} תזכורת תשלום (${cur(owed)})</button>` : ""}
      ${s.phone ? `<button class="btn btn-light btn-block" onclick="App.sendReceipt('${id}')">${icon("note")} שליחת ריכוז חודשי להורה</button>` : ""}
      <div class="form-section profile-notes">
        <label for="f-notes">הערות פרטיות</label>
        <textarea id="f-notes" rows="3" placeholder="חוזקות, קשיים, סגנון למידה, מה לתרגל בפעם הבאה...">${escapeHtml(s.notes || "")}</textarea>
        <button class="btn btn-light" onclick="App.saveStudentNotes('${id}')">${icon("check")} שמירת הערה</button>
      </div>
      <div class="profile-section-head">${icon("note", "ic-sub")} היסטוריית שיעורים</div>
      ${history}
    `);
  }

  function saveStudentNotes(id) {
    const s = studentById(id);
    const el = document.getElementById("f-notes");
    if (!s || !el) return;
    s.notes = el.value.trim().slice(0, 2000);
    if (!save()) { render(); return; }
    toast("ההערה נשמרה", "ok");
  }

  function saveStudent(id, andSchedule) {
    const name = document.getElementById("f-name").value.trim();
    if (!name) {
      document.getElementById("err-name").style.display = "block";
      return;
    }
    const phone = document.getElementById("f-phone").value.trim();
    const studentPhone = document.getElementById("f-student-phone").value.trim();
    for (const p of [phone, studentPhone]) {
      if (p && !/[0-9]{6,}/.test(p.replace(/[^0-9]/g, ""))) {
        toast("מספר טלפון לא תקין", "err"); return;
      }
    }
    const data = {
      name,
      parentName: document.getElementById("f-parent").value.trim(),
      phone,
      studentPhone,
      price: Math.max(0, parseFloat(document.getElementById("f-price").value) || 0)
    };
    let newId = null;
    if (id) {
      Object.assign(studentById(id), data);
    } else {
      newId = uid();
      students.push({ id: newId, ...data });
    }
    if (!save()) { render(); return; }
    render();
    toast(id ? "התלמיד עודכן" : "תלמיד נוסף", "ok");
    // ליד חדש → ישר לקביעת שיעור, בלי לחפש שוב את התלמיד. אחרת סוגרים.
    if (newId && andSchedule) openLessonForm(null, newId);
    else closeModal();
  }

  async function deleteStudent(id) {
    if (!await askConfirmation("מחיקת התלמיד תמחק גם את כל השיעורים והיסטוריית התשלומים שלו. אין אפשרות לבטל פעולה זו.", "מחיקת תלמיד")) return;
    students = students.filter(s => s.id !== id);
    lessons = lessons.filter(l => l.studentId !== id);
    if (!save()) { render(); return; }
    closeModal(); render();
    toast("התלמיד נמחק");
  }

  function renderStudents() {
    const el = document.getElementById("studentsList");
    const paint = html => renderKeepFocus(el, html);
    if (!students.length) { paint( `<div class="empty empty-action">${icon("plus")}<h3>עדיין אין תלמידים</h3><p>הוסיפי תלמיד ראשון כדי לקבוע שיעור ולעקוב אחר תשלומים.</p><button class="btn btn-green" onclick="App.openStudentForm()">הוספת תלמיד</button></div>`); return; }
    const searchEl = document.getElementById("studentSearch");
    const q = searchEl ? searchEl.value.trim().toLowerCase() : "";
    const filtered = q
      ? students.filter(s => (s.name + " " + (s.parentName || "")).toLowerCase().includes(q))
      : students;
    if (!filtered.length) { paint(`<div class="empty empty-action"><h3>לא נמצאו תלמידים</h3><p>נסי שם תלמיד או שם הורה אחר.</p></div>`); return; }
    const today = todayStr();
    paint(filtered.map(s => {
      const upcoming = lessonIndex.forStudent(s.id).filter(l => l.date >= today && !l.done);
      const next = upcoming[0];
      const unpaid = lessonIndex.unpaidForStudent(s.id);
      const owed = unpaid.reduce((sum, lesson) => sum + lessonPrice(lesson), 0);
      return `
        <button type="button" class="student-card" onclick="App.openStudentProfile('${s.id}')" aria-label="פתיחת הפרופיל של ${escapeHtml(s.name)}">
          <span class="student-avatar" aria-hidden="true">${escapeHtml(initials(s.name))}</span>
          <span class="student-card-main">
            <span class="student-card-top"><strong>${escapeHtml(s.name)}</strong><span>${cur(s.price)} לשיעור</span></span>
            <span class="student-contact">${escapeHtml(s.parentName) || "לא הוגדר איש קשר"}${s.phone ? ` · ${escapeHtml(s.phone)}` : ""}</span>
            <span class="student-insights">
              <span>${icon("calendar", "ic-sub")} ${next ? `${dayLabelPlain(next.date)} · ${fmtTime(next.time)}` : "אין שיעור קרוב"}</span>
              <span class="${owed > 0 ? "debt" : "clear"}">${owed > 0 ? `${icon("warn", "ic-sub")} חוב ${cur(owed)}` : `${icon("checkCircle", "ic-sub")} אין חוב`}</span>
            </span>
          </span>
          <span class="student-card-arrow" aria-hidden="true">‹</span>
        </button>`;
    }).join(""));
  }

  // ========== שיעורים / יומן ==========
  let lessonFormEditing = false; // בעריכה לא ממלאים אוטומטית לפי התלמיד
  function openLessonForm(id, presetStudentId) {
    lessonFormEditing = !!id;
    const l = id
      ? lessons.find(x => x.id === id)
      : { studentId: presetStudentId || "", date: selectedDay || todayStr(), time: quickAddTime || settings.defaultTime, topic: "", duration: settings.defaultDuration, price: undefined };
    const priceVal = (typeof l.price === "number") ? l.price : "";
    // כמה שיעורים עתידיים יש לתלמיד הזה — לכפתור "מחיקת כל העתידיים"
    const futureCount = id
      ? lessons.filter(x => x.studentId === l.studentId && x.date >= todayStr() && !x.done).length
      : 0;
    openModal(`
      <div class="modal-title-block">
        <span class="modal-title-icon">${icon("calendar")}</span>
        <div><h3 id="modalTitle">${id ? "עריכת שיעור" : "שיעור חדש"}</h3><p>${id ? "עדכון מועד, תוכן ופרטי תשלום" : "קביעת מועד חדש ביומן"}</p></div>
      </div>
      <div class="form-section">
      <label for="f-student-search">תלמיד <span class="required-note">בחירה נדרשת</span></label>
      <input id="f-student-search" placeholder="הקלידי שם ובחרי תלמיד" autocomplete="off" oninput="App.renderStudentPicker()">
      <input type="hidden" id="f-student" value="${l.studentId}">
      <div id="studentPicker" class="student-picker"></div>
      <label>בחירה מהירה</label>
      <div class="quick-dates">
        <button type="button" class="quick-date" onclick="App.setLessonDate(0,this)">היום</button>
        <button type="button" class="quick-date" onclick="App.setLessonDate(1,this)">מחר</button>
        <button type="button" class="quick-date" onclick="App.setLessonDate(7,this)">בעוד שבוע</button>
      </div>
      <div class="row">
        <div><label for="f-date">תאריך</label><input id="f-date" type="date" value="${l.date}" onchange="App.renderFreeSlots()"></div>
        <div><label for="f-time">שעה</label><input id="f-time" type="time" value="${l.time}"></div>
      </div>
      <div id="freeSlots" class="free-slots"></div>
      <label for="f-topic">נושא / הערות (לא חובה)</label>
      <input id="f-topic" value="${escapeHtml(l.topic || "")}" placeholder="לדוגמה: גיאומטריה - משפט פיתגורס">

      <button type="button" class="adv-toggle" onclick="App.toggleAdvanced(this)">
        עוד אפשרויות (משך, מחיר${!id ? ", חזרה" : ""}) ${icon("chevron", "ic")}
      </button>
      <div id="advWrap" style="display:none">
        <div class="row">
          <div><label for="f-duration">משך (דקות)</label><input id="f-duration" type="number" inputmode="numeric" min="0" step="15" value="${l.duration ?? settings.defaultDuration}"></div>
          <div><label for="f-price">מחיר לשיעור זה (${escapeHtml(settings.currency)})</label><input id="f-price" type="number" inputmode="numeric" min="0" value="${priceVal}" placeholder="ברירת מחדל"></div>
        </div>
        ${!id ? `
          <div class="checkbox-row">
            <input type="checkbox" id="f-repeat" onchange="App.toggleRepeat(this.checked)">
            <label for="f-repeat">שיעור חוזר כל שבוע</label>
          </div>
          <div id="repeatWrap" style="display:none">
            <input type="hidden" id="f-interval" value="7">
            <label>תדירות</label>
            <div class="seg-toggle">
              <button type="button" class="seg-btn active" data-interval="7" aria-pressed="true" onclick="App.setRecurInterval(7)">כל שבוע</button>
              <button type="button" class="seg-btn" data-interval="14" aria-pressed="false" onclick="App.setRecurInterval(14)">כל שבועיים</button>
            </div>
            <input type="hidden" id="f-recur-mode" value="open">
            <label>עד מתי</label>
            <div class="seg-toggle">
              <button type="button" class="seg-btn active" data-recur="open" aria-pressed="true" onclick="App.setRecurMode('open')">קבוע, ללא סיום</button>
              <button type="button" class="seg-btn" data-recur="count" aria-pressed="false" onclick="App.setRecurMode('count')">מספר מוגדר</button>
            </div>
            <div id="weeksWrap" style="display:none">
              <label for="f-weeks">כמה פעמים?</label>
              <input id="f-weeks" type="number" value="8" min="2" max="52">
            </div>
          </div>
        ` : ""}
      </div></div>
      <div class="modal-actions">
      <button class="btn btn-green btn-block" onclick="App.saveLesson('${id || ""}')">${icon("check")} ${id ? "שמירת שינויים" : "קביעת שיעור"}</button>
      ${id && studentById(l.studentId) && (studentById(l.studentId).studentPhone || studentById(l.studentId).phone)
        ? `<button class="btn btn-wa btn-block" onclick="App.sendLessonReminder('${id}')">${icon("whatsapp")} שליחת תזכורת לתלמיד</button>` : ""}
      ${id && studentById(l.studentId)
        ? `<button class="btn btn-light btn-block" onclick="App.openStudentForm('${l.studentId}')">${icon("edit")} עריכת פרטי התלמיד</button>` : ""}
      </div>
      ${id ? (l.seriesId ? `
        <div class="series-note">${icon("repeat", "ic-sub")} שיעור חוזר ${Number(l.intervalDays) === 14 ? "דו-שבועי" : "שבועי"}</div>
        <div class="danger-zone lesson-danger"><div><strong>מחיקת שיעור</strong><span>אפשר למחוק רק את המועד הזה או את כל ההמשך</span></div><div><button class="btn btn-danger" onclick="App.deleteLesson('${id}')">מועד זה</button><button class="btn btn-danger" onclick="App.deleteSeriesFuture('${id}')">כל ההמשך</button></div></div>
      ` : `
        <div class="danger-zone"><div><strong>מחיקת שיעור</strong><span>השיעור יוסר מהיומן</span></div><button class="btn btn-danger" onclick="App.deleteLesson('${id}')">מחיקה</button></div>
      `) : ""}
      ${id && futureCount > 1 ? `
        <div class="danger-zone"><div><strong>כל השיעורים העתידיים של התלמיד</strong><span>${futureCount} שיעורים שטרם התקיימו יימחקו מהיומן</span></div><button class="btn btn-danger" onclick="App.deleteStudentFuture('${id}')">מחיקת הכל</button></div>
      ` : ""}
    `);
    renderStudentPicker();
    renderFreeSlots();
  }

  // מועדים פנויים ביום הנבחר — לחיצה ממלאת את השעה. חוסך תיאום ידני מול הורה.
  function renderFreeSlots() {
    const box = document.getElementById("freeSlots");
    if (!box) return;
    const date = document.getElementById("f-date")?.value;
    const durEl = document.getElementById("f-duration");
    const dur = durEl && durEl.value ? Math.max(0, parseInt(durEl.value) || 0) : settings.defaultDuration;
    if (!date) { box.innerHTML = ""; return; }
    const slots = findFreeSlots(lessons, { date, duration: dur, limit: 3 });
    box.innerHTML = slots.length
      ? `<label>מועדים פנויים ביום זה</label><div class="quick-dates">${slots.map(t => `<button type="button" class="quick-date" onclick="App.pickFreeSlot('${t}',this)">${t}</button>`).join("")}</div>`
      : "";
  }
  function pickFreeSlot(t, btn) {
    const e = document.getElementById("f-time");
    if (e) e.value = t;
    document.querySelectorAll("#freeSlots .quick-date").forEach(b => b.classList.remove("sel"));
    if (btn) btn.classList.add("sel");
  }
  function setRecurInterval(days) {
    document.getElementById("f-interval").value = days;
    document.querySelectorAll("[data-interval]").forEach(b => {
      const active = Number(b.dataset.interval) === days;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  }

  // בורר תלמיד עם חיפוש (בתוך טופס שיעור)
  function renderStudentPicker() {
    const pick = document.getElementById("studentPicker");
    if (!pick) return;
    const searchEl = document.getElementById("f-student-search");
    const term = (searchEl ? searchEl.value : "").trim().toLowerCase();
    const selId = document.getElementById("f-student").value;
    const matches = students.filter(s => s.name.toLowerCase().includes(term));
    // הוספה מהירה: אם השם שהוקלד לא קיים בדיוק — מציעים ליצור תלמיד חדש מתוך הטופס
    const exact = matches.some(s => s.name.toLowerCase() === term);
    const addRow = term && !exact
      ? `<button type="button" class="picker-row picker-add" onclick="App.quickAddStudent()">+ הוספת "${escapeHtml(searchEl.value.trim())}" כתלמיד חדש</button>`
      : "";
    if (!matches.length && !addRow) { pick.innerHTML = `<div class="picker-empty">לא נמצא תלמיד</div>`; return; }
    pick.innerHTML = matches.map(s => `
      <button type="button" class="picker-row ${s.id === selId ? "sel" : ""}" onclick="App.pickStudent('${s.id}')" aria-pressed="${s.id === selId}">
        <span>${escapeHtml(s.name)}</span>
        ${s.id === selId ? icon("check") : ""}
      </button>`).join("") + addRow;
  }

  // יצירת תלמיד חדש מתוך טופס השיעור, בלי לצאת מהטופס
  function quickAddStudent() {
    const searchEl = document.getElementById("f-student-search");
    const name = (searchEl ? searchEl.value : "").trim();
    if (!name) return;
    const s = { id: uid(), name, parentName: "", phone: "", studentPhone: "", price: settings.defaultPrice };
    students.push(s);
    if (!save()) { students.pop(); renderStudentPicker(); return; }
    pickStudent(s.id);
    toast(`${name} נוסף — אפשר להשלים טלפון ומחיר דרך כרטיס התלמיד`, "ok");
  }

  function pickStudent(id) {
    const h = document.getElementById("f-student");
    if (h) h.value = id;
    if (!lessonFormEditing) applyStudentDefaults(id);
    renderStudentPicker();
  }

  // מילוי אוטומטי לפי השיעור האחרון של התלמיד — שעה/משך/מחיר חוזרים על עצמם
  function applyStudentDefaults(id) {
    const all = lessonIndex.forStudent(id); // ממוין כרונולוגית
    const last = all[all.length - 1];
    if (!last) return;
    const set = (elId, val) => { const e = document.getElementById(elId); if (e && val != null && val !== "") e.value = val; };
    set("f-time", last.time);
    set("f-duration", last.duration);
    if (typeof last.price === "number") set("f-price", last.price);
    renderFreeSlots();
  }

  function toggleAdvanced(btn) {
    const w = document.getElementById("advWrap");
    const open = w.style.display === "block";
    w.style.display = open ? "none" : "block";
    btn.classList.toggle("open", !open);
  }

  function toggleRepeat(checked) {
    document.getElementById("repeatWrap").style.display = checked ? "block" : "none";
  }
  function setRecurMode(mode) {
    document.getElementById("f-recur-mode").value = mode;
    document.querySelectorAll("[data-recur]").forEach(b => {
      const active = b.dataset.recur === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("weeksWrap").style.display = mode === "count" ? "block" : "none";
  }

  async function saveLesson(id) {
    const priceRaw = document.getElementById("f-price").value.trim();
    const durRaw = document.getElementById("f-duration").value.trim();
    const data = {
      studentId: document.getElementById("f-student").value,
      date: document.getElementById("f-date").value,
      time: document.getElementById("f-time").value,
      topic: document.getElementById("f-topic").value.trim(),
      duration: durRaw === "" ? settings.defaultDuration : Math.max(0, parseInt(durRaw) || 0),
      price: priceRaw === "" ? undefined : Math.max(0, parseFloat(priceRaw) || 0)
    };
    if (!data.studentId) { toast("נא לבחור תלמיד", "err"); return; }
    if (!data.date) { toast("נא לבחור תאריך", "err"); return; }
    // אילו תאריכים השמירה תופסת — מועד בודד או סדרה שבועית
    let dates = [data.date];
    let repeatInfo = null;
    if (!id) {
      const repeat = document.getElementById("f-repeat");
      if (repeat && repeat.checked) {
        const mode = document.getElementById("f-recur-mode").value;
        const openEnded = mode === "open";
        const interval = Number(document.getElementById("f-interval")?.value) === 14 ? 14 : 7;
        const count = openEnded
          ? Math.ceil(HORIZON_WEEKS * 7 / interval) // ממלאים עד אופק קבוע, ללא קשר לתדירות
          : Math.max(1, parseInt(document.getElementById("f-weeks").value) || 1);
        repeatInfo = { openEnded, interval };
        dates = Array.from({ length: count }, (_, i) => {
          const d = new Date(data.date + "T00:00");
          d.setDate(d.getDate() + i * interval);
          return ymd(d);
        });
      }
    }
    // התרעה על חפיפה ביומן לפני שמירה — המורה מחליטה אם לקבוע בכל זאת
    const conflicts = findConflicts(lessons, { dates, time: data.time, duration: data.duration, excludeId: id });
    if (conflicts.length) {
      const first = conflicts[0];
      const who = studentById(first.studentId)?.name || "שיעור אחר";
      const more = conflicts.length > 1 ? ` ועוד ${conflicts.length - 1}` : "";
      const proceed = await askConfirmation(
        `חופף לשיעור של ${who} ${dayLabelPlain(first.date)} בשעה ${first.time}${more}. לקבוע בכל זאת?`,
        "קביעה בכל זאת"
      );
      if (!proceed) return;
    }
    let successMessage = "";
    if (id) {
      Object.assign(lessons.find(x => x.id === id), data);
      successMessage = "השיעור עודכן";
    } else if (repeatInfo) {
      const seriesId = uid();
      for (const date of dates) {
        lessons.push({ id: uid(), paid: false, done: false, seriesId, recur: "weekly", intervalDays: repeatInfo.interval, openEnded: repeatInfo.openEnded, ...data, date });
      }
      const freq = repeatInfo.interval === 14 ? "דו-שבועי" : "שבועי";
      successMessage = repeatInfo.openEnded ? `נקבע שיעור ${freq} קבוע` : `נקבעו ${dates.length} שיעורים`;
    } else {
      lessons.push({ id: uid(), paid: false, done: false, ...data });
      successMessage = "השיעור נקבע";
    }
    if (!save()) { render(); return; }
    closeModal(); render();
    // נדנוד עדין: רענון היומן שומר על תזכורות אמינות גם כשהאפליקציה סגורה.
    // ייבוא חוזר מעדכן לפי UID, בלי כפילויות.
    const hasFuture = lessons.some(l => !l.done && new Date(`${l.date}T${l.time || "00:00"}:00`).getTime() >= Date.now());
    toast(successMessage, "ok", hasFuture ? { label: "הוסף ליומן", run: exportCalendar } : null);
  }

  function setLessonDate(offset, btn) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const el = document.getElementById("f-date");
    if (el) el.value = ymd(d);
    document.querySelectorAll(".quick-dates .quick-date").forEach(b => b.classList.remove("sel"));
    if (btn) btn.classList.add("sel");
    renderFreeSlots();
  }

  async function deleteLesson(id) {
    if (!await askConfirmation("השיעור יימחק מהיומן וממעקב התשלומים.", "מחיקת שיעור")) return;
    lessons = lessons.filter(l => l.id !== id);
    if (!save()) { render(); return; }
    closeModal(); render();
    toast("השיעור נמחק");
  }

  // מחיקת השיעור הנוכחי וכל החזרות שאחריו (כמו "אירוע זה ואילך" ביומן גוגל)
  async function deleteSeriesFuture(id) {
    const l = lessons.find(x => x.id === id);
    if (!l) return;
    if (!await askConfirmation("השיעור הנוכחי וכל החזרות הבאות בסדרה יימחקו. שיעורים קודמים יישארו.", "מחיקת ההמשך")) return;
    const removed = lessons.filter(x => x.seriesId === l.seriesId && x.date >= l.date).length;
    lessons = lessons.filter(x => !(x.seriesId === l.seriesId && x.date >= l.date));
    // עצירת הסדרה — שלא תורחב שוב אוטומטית
    lessons.forEach(x => { if (x.seriesId === l.seriesId) x.openEnded = false; });
    if (!save()) { render(); return; }
    closeModal(); render();
    toast(`נמחקו ${removed} שיעורים`);
  }

  // מחיקת כל השיעורים העתידיים של התלמיד — מכל הסדרות והמועדים הבודדים יחד
  async function deleteStudentFuture(lessonId) {
    const l = lessons.find(x => x.id === lessonId);
    if (!l) return;
    const s = studentById(l.studentId);
    const today = todayStr();
    const future = lessons.filter(x => x.studentId === l.studentId && x.date >= today && !x.done);
    if (!future.length) return;
    if (!await askConfirmation(
      `${future.length} השיעורים העתידיים של ${s?.name || "התלמיד"} יימחקו מהיומן. שיעורים שכבר התקיימו יישארו במעקב התשלומים.`,
      "מחיקת כל העתידיים")) return;
    const ids = new Set(future.map(x => x.id));
    lessons = lessons.filter(x => !ids.has(x.id));
    // עצירת סדרות פתוחות של התלמיד — שלא ייווצרו שיעורים חדשים אוטומטית
    lessons.forEach(x => { if (x.studentId === l.studentId) x.openEnded = false; });
    if (!save()) { render(); return; }
    closeModal(); render();
    toast(`נמחקו ${ids.size} שיעורים עתידיים`);
  }

  // הארכה אוטומטית של סדרות "כל שבוע" כדי שתמיד יהיו שיעורים עתידיים (תחושת אינסוף)
  function maintainSeries() {
    const horizon = ymd((() => { const d = new Date(); d.setDate(d.getDate() + HORIZON_WEEKS * 7); return d; })());
    const groups = {};
    lessons.forEach(l => { if (l.seriesId && l.openEnded) (groups[l.seriesId] = groups[l.seriesId] || []).push(l); });
    let added = false;
    Object.values(groups).forEach(arr => {
      arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const last = arr[arr.length - 1];
      const step = Number(last.intervalDays) === 14 ? 14 : 7;
      const d = new Date(last.date + "T00:00");
      while (true) {
        d.setDate(d.getDate() + step);
        const ds = ymd(d);
        if (ds > horizon) break;
        lessons.push({
          id: uid(), paid: false, done: false,
          seriesId: last.seriesId, recur: "weekly", intervalDays: step, openEnded: true,
          studentId: last.studentId, time: last.time, topic: last.topic,
          duration: last.duration, price: last.price, date: ds
        });
        added = true;
      }
    });
    if (added) persistSnapshot();
  }

  function toggleDone(id) {
    const l = lessons.find(x => x.id === id);
    l.done = !l.done;
    if (!save()) { render(); return; }
    render();
    toast(l.done ? "השיעור סומן כבוצע" : "סימון הביצוע בוטל", "ok", {
      label: "ביטול",
      run: () => toggleDone(id)
    });
  }

  function lessonSorted() {
    return lessonIndex.sortedLessons;
  }

  const dateTimeLine = l =>
    `${icon("calendar", "ic-sub")} ${fmtDate(l.date)} &nbsp;·&nbsp; ${icon("clock", "ic-sub")} ${fmtTime(l.time)}`;

  // תווית יום יחסית ("היום", "מחר", שם היום)
  function dayLabel(dateStr) {
    const d = new Date(dateStr + "T00:00");
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((d - t) / 86400000);
    const wd = d.toLocaleDateString("he-IL", { weekday: "long" });
    const dm = d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
    if (diff === 0) return `<span class="rel">היום</span> · ${dm}`;
    if (diff === 1) return `<span class="rel">מחר</span> · ${dm}`;
    if (diff === -1) return `אתמול · ${dm}`;
    if (diff > 1 && diff < 7) return `${wd} · ${dm}`;
    return `${wd}, ${dm}`;
  }

  // גרסת טקסט נקי (להודעות וואטסאפ)
  function dayLabelPlain(dateStr) {
    const d = new Date(dateStr + "T00:00");
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((d - t) / 86400000);
    const wd = d.toLocaleDateString("he-IL", { weekday: "long" });
    const dm = d.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
    if (diff === 0) return `היום (${dm})`;
    if (diff === 1) return `מחר (${dm})`;
    return `ב${wd} (${dm})`;
  }

  function groupByDate(list) {
    const map = new Map();
    list.forEach(l => {
      if (!map.has(l.date)) map.set(l.date, []);
      map.get(l.date).push(l);
    });
    return map;
  }

  function lessonRow(l) {
    const s = studentById(l.studentId) || { name: "תלמיד שנמחק" };
    const isToday = l.date === todayStr();
    const canRemind = !l.done && (s.studentPhone || s.phone);
    return `
      <div class="lesson-row ${l.done ? "is-done" : ""} ${isToday ? "is-today" : ""}" data-id="${l.id}">
        <button type="button" class="lesson-open" onclick="App.openLessonForm('${l.id}')" aria-label="עריכת שיעור עם ${escapeHtml(s.name)} בשעה ${fmtTime(l.time)}">
          <span class="time-chip">${fmtTime(l.time) || "—"}${l.duration ? `<span class="dur">${l.duration}׳</span>` : ""}</span>
          <span class="lesson-body">
            <span class="lesson-name">${escapeHtml(s.name)}${l.done && !l.paid && lessonPrice(l) > 0 ? `<span class="tag tag-due lesson-unpaid">${icon("warn", "ic-sub")} לא שולם</span>` : ""}</span>
            ${l.topic ? `<span class="lesson-topic">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</span>` : ""}
          </span>
        </button>
        ${canRemind ? `<button class="lesson-check lesson-wa" onclick="App.sendLessonReminder('${l.id}')" aria-label="שליחת תזכורת וואטסאפ ל-${escapeHtml(s.name)}" title="תזכורת בוואטסאפ">${icon("whatsapp")}</button>` : ""}
        <button class="lesson-check ${l.done ? "done" : ""}" onclick="App.toggleDone('${l.id}')" aria-label="${l.done ? "ביטול סימון שיעור כבוצע" : "סימון שיעור כבוצע"}" aria-pressed="${l.done}" title="${l.done ? "בוצע" : "סמן כבוצע"}">${icon("check")}</button>
      </div>`;
  }

  function dayGroupHtml(date, dayLessons) {
    const count = dayLessons.length;
    const h = holidayFor(date);
    return `
      <section class="day-group" aria-labelledby="day-${date}">
        <div class="day-head">
          <h3 class="day-label" id="day-${date}">${dayLabel(date)} ${h ? `<span class="holiday-tag">${icon("info", "ic-sub")} ${escapeHtml(h.name)}</span>` : ""}</h3>
          <span class="day-count">${count} ${count === 1 ? "שיעור" : "שיעורים"}</span>
        </div>
        <div class="day-lessons">${dayLessons.map(lessonRow).join("")}</div>
      </section>`;
  }

  // היומן חי רק בבית — כל רענון של הלוח עובר דרך המסך הראשי
  function refreshCalendarSurface() {
    renderHome();
  }

  // ציר שעות של יממה מלאה נגלל בתוך הרשת; זוכרים את המיקום בין רינדורים.
  // ברירת מחדל: פתיחה על 07:00.
  let calScroll = null;
  function applyCalScroll() {
    const el = document.querySelector(".week-grid, .day-agenda");
    if (!el) return;
    el.scrollTop = calScroll ?? 7 * (el.classList.contains("week-grid") ? 48 : 64);
    el.onscroll = () => { calScroll = el.scrollTop; };
  }

  // ניווט מודע-מצב: שבוע קדימה/אחורה, או חודש במצב חודשי
  function calShift(delta) {
    const weekMode = homeCalMode !== "month";
    if (weekMode) {
      const base = new Date((selectedDay || todayStr()) + "T00:00");
      base.setDate(base.getDate() + delta * 7);
      selectedDay = ymd(base);
      calMonth = new Date(base.getFullYear(), base.getMonth(), 1);
    } else {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    }
    refreshCalendarSurface();
  }

  const toMinutes = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  function weekDaysFor(dateStr) {
    const start = new Date(dateStr + "T00:00");
    start.setDate(start.getDate() - start.getDay()); // ראשון = תחילת שבוע
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return ymd(d); });
  }

  function selectCalDay(dateStr) {
    selectedDay = dateStr;
    refreshCalendarSurface();
  }

  function calToday() {
    calMonth = new Date();
    selectedDay = todayStr();
    refreshCalendarSurface();
  }

  // סרגל ניווט משותף לשבוע/חודש (הלוח LTR — ‹ אחורה, › קדימה)
  function calToolbarHtml(label) {
    return `<div class="cal-toolbar">
      <div class="cal-toolbar-nav">
        <button type="button" class="cal-nav" aria-label="הקודם" onclick="App.calShift(-1)">‹</button>
        <button type="button" class="cal-nav" aria-label="הבא" onclick="App.calShift(1)">›</button>
      </div>
      <span class="cal-toolbar-label">${label}</span>
      <button type="button" class="btn-today" onclick="App.calToday()">היום</button>
    </div>`;
  }

  // רצועת שבוע בסגנון יומן — 7 ימים, בחירה מהירה
  function renderWeekStrip(day) {
    const days = weekDaysFor(day);
    const dows = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
    const cells = days.map(ds => {
      const d = new Date(ds + "T00:00");
      // דרך האינדקס: שבע קריאות מפה במקום סריקה של כל השיעורים בכל החלקה
      const n = lessonIndex.onDate(ds).length;
      const isToday = ds === todayStr();
      const isSel = ds === day;
      const cls = ["week-day", isToday ? "today" : "", isSel ? "sel" : ""].filter(Boolean).join(" ");
      const label = `${d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}${n ? `, ${n} שיעורים` : ", אין שיעורים"}`;
      return `<button type="button" class="${cls}" data-day="${ds}" aria-pressed="${isSel}"${isToday ? ' aria-current="date"' : ""} aria-label="${escapeHtml(label)}" onclick="App.selectCalDay('${ds}')">
        <span class="week-dow">${dows[d.getDay()]}</span>
        <span class="week-num">${d.getDate()}</span>
        <span class="week-dot ${n ? "" : "is-empty"}" aria-hidden="true">${n > 1 ? `<i>${n}</i>` : ""}</span>
      </button>`;
    }).join("");
    const monthLabel = new Date(day + "T00:00").toLocaleDateString("he-IL", { month: "long", year: "numeric" });
    return calToolbarHtml(monthLabel) + `<div class="week-strip" role="group" aria-label="בחירת יום">${cells}</div>`;
  }

  // אג'נדת יום עם ציר שעות — תחושת יומן אמיתי
  function renderDayAgenda(day) {
    const h = holidayFor(day);
    const banner = h ? `<div class="holiday-banner">${icon("info")} ${escapeHtml(h.name)}</div>` : "";
    const addBtn = `<button class="btn btn-light btn-block agenda-add" onclick="App.openLessonForm()">${icon("plus")} קביעת שיעור ב-${escapeHtml(fmtDate(day))}</button>`;
    const dayLessons = [...lessonIndex.onDate(day)].sort((a, b) => ((a.time || "") < (b.time || "") ? -1 : 1));
    const HOUR_PX = 64;
    const startH = 0, endH = 24; // יממה מלאה — אפשר לגרור שיעור לכל שעה
    const rows = [];
    for (let hr = startH; hr <= endH; hr++) {
      rows.push(`<div class="hour-row"><span class="hour-label">${String(hr % 24).padStart(2, "0")}:00</span><span class="hour-line"></span></div>`);
    }
    const blocks = dayLessons.map(l => {
      const s = studentById(l.studentId) || { name: "תלמיד שנמחק" };
      const dur = Number(l.duration) || 60;
      const top = (toMinutes(l.time) - startH * 60) / 60 * HOUR_PX;
      const height = Math.max(40, dur / 60 * HOUR_PX - 4);
      const price = lessonPrice(l);
      const status = l.done && !l.paid && price > 0
        ? `<span class="agenda-status unpaid">${icon("warn", "ic-sub")} לא שולם</span>`
        : l.done
          ? `<span class="agenda-status done">${icon("check", "ic-sub")} בוצע</span>`
          : "";
      const aria = `${fmtTime(l.time)} ${s.name}${l.topic ? ", " + l.topic : ""}, ${dur} דקות`;
      return `<button type="button" class="agenda-block ${l.done ? "is-done" : ""}" data-id="${l.id}" style="top:${Math.round(top)}px;height:${Math.round(height)}px" onclick="App.openLessonForm('${l.id}')" aria-label="עריכת שיעור: ${escapeHtml(aria)}">
        <span class="agenda-time">${fmtTime(l.time)}</span>
        <span class="agenda-info"><span class="agenda-name">${escapeHtml(s.name)}</span>${l.topic ? `<span class="agenda-topic">${escapeHtml(l.topic)}</span>` : ""}</span>
        ${status}
      </button>`;
    }).join("");
    const railH = (endH - startH + 1) * HOUR_PX;
    const nowLine = day === todayStr() ? nowLineHtml(startH, endH, HOUR_PX) : "";
    return banner + `<div class="day-agenda" data-day="${day}" data-start="${startH}" style="--rail-h:${railH}px">
      <div class="hour-rail">${rows.join("")}</div>
      <div class="agenda-events">${nowLine}${blocks}</div>
    </div>` + addBtn;
  }

  // תצוגת שבוע מלאה — 7 עמודות על ציר שעות, כמו יומן גוגל.
  // לחיצה על שיעור = עריכה; לחיצה על עמודה ריקה = שיעור חדש באותו יום.
  function renderWeekGrid(day) {
    const days = weekDaysFor(day);
    const byDay = new Map(days.map(ds => [ds, []]));
    lessonSorted().forEach(l => { if (byDay.has(l.date)) byDay.get(l.date).push(l); });
    const HOUR_PX = 48;
    const startH = 0, endH = 24; // יממה מלאה, כמו יומן גוגל
    weekGridStartH = startH;
    const railH = (endH - startH) * HOUR_PX;
    const dows = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
    const heads = days.map(ds => {
      const d = new Date(ds + "T00:00");
      const cls = ["wg-head", ds === todayStr() ? "today" : ""].filter(Boolean).join(" ");
      return `<button type="button" class="${cls}" onclick="App.selectCalDay('${ds}')" aria-label="${escapeHtml(d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }))}"><span>${dows[d.getDay()]}</span><b>${d.getDate()}</b></button>`;
    }).join("");
    let rail = "";
    for (let hr = startH; hr < endH; hr++) rail += `<div class="wg-hour">${String(hr).padStart(2, "0")}</div>`;
    const cols = days.map(ds => {
      const blocks = byDay.get(ds).map(l => {
        const s = studentById(l.studentId);
        const top = (toMinutes(l.time) - startH * 60) / 60 * HOUR_PX;
        const h = Math.max(26, (Number(l.duration) || 60) / 60 * HOUR_PX - 2);
        const aria = `${fmtTime(l.time)} ${s?.name || "תלמיד"}`;
        return `<button type="button" class="wg-block ${l.done ? "is-done" : ""}" data-id="${l.id}" style="top:${Math.round(top)}px;height:${Math.round(h)}px" onclick="App.openLessonForm('${l.id}')" aria-label="עריכת שיעור: ${escapeHtml(aria)}"><b>${fmtTime(l.time)}</b><span>${escapeHtml((s?.name || "תלמיד").split(" ")[0])}</span></button>`;
      }).join("");
      const isToday = ds === todayStr();
      return `<div class="wg-col ${isToday ? "today" : ""}" data-day="${ds}">
        <button type="button" class="wg-add" onclick="App.quickAddLesson('${ds}', event)" aria-label="קביעת שיעור ב-${escapeHtml(fmtDate(ds))}"></button>
        ${isToday ? nowLineHtml(startH, endH, HOUR_PX) : ""}${blocks}
      </div>`;
    }).join("");
    const monthLabel = new Date(day + "T00:00").toLocaleDateString("he-IL", { month: "long", year: "numeric" });
    return calToolbarHtml(monthLabel) + `<div class="week-grid" data-start="${startH}" style="--wg-h:${railH}px">
      <div class="wg-corner"></div><div class="wg-heads">${heads}</div>
      <div class="wg-rail">${rail}</div>
      <div class="wg-cols">${cols}</div>
    </div>`;
  }

  // לחיצה על משבצת ריקה ברשת השבוע — שיעור חדש באותו יום ובאותה שעה (כמו יומן גוגל)
  let quickAddTime = "";
  let weekGridStartH = 8; // ponytail: שעת הפתיחה של הרשת האחרונה שצוירה; מספיק כי יש רשת אחת על המסך
  function quickAddLesson(dateStr, ev) {
    selectedDay = dateStr;
    const y = ev && typeof ev.offsetY === "number" ? ev.offsetY : null;
    // קפיצה ל-15 דק' לפי מיקום הלחיצה — לא רק שעות עגולות
    if (y === null) {
      quickAddTime = "";
    } else {
      const raw = weekGridStartH * 60 + (y / 48) * 60;
      const m = Math.max(0, Math.min(23 * 60 + 45, Math.round(raw / 15) * 15));
      quickAddTime = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    }
    openLessonForm();
    quickAddTime = "";
  }

  // קו "עכשיו" אדום — רק על היום הנוכחי, רק כשהשעה בטווח הרשת
  function nowLineHtml(startH, endH, hourPx) {
    const now = new Date();
    const min = now.getHours() * 60 + now.getMinutes();
    if (min < startH * 60 || min > endH * 60) return "";
    return `<span class="now-line" style="top:${Math.round((min - startH * 60) / 60 * hourPx)}px" aria-hidden="true"></span>`;
  }

  function monthGridHtml() {
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const first = new Date(year, month, 1);
    const startDow = first.getDay(); // 0=ראשון
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const counts = {}, firstTime = {};
    lessons.forEach(l => {
      if (!l.date.startsWith(monthKey(calMonth))) return;
      counts[l.date] = (counts[l.date] || 0) + 1;
      if (!firstTime[l.date] || (l.time || "") < firstTime[l.date]) firstTime[l.date] = l.time || "";
    });

    const dows = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
    let cells = dows.map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const has = counts[ds] > 0;
      const h = holidayFor(ds);
      const cls = ["cal-cell",
        ds === todayStr() ? "today" : "",
        ds === selectedDay ? "sel" : "",
        h ? "holiday" : "",
        has ? "has-lessons" : ""].filter(Boolean).join(" ");
      const title = [h ? h.name : "", has ? counts[ds] + " שיעורים" : ""].filter(Boolean).join(" · ");
      // שיעור בודד — מציגים את השעה שלו (כמו יומן גוגל); כמה שיעורים — מונה
      const marker = has
        ? (counts[ds] === 1 && firstTime[ds]
          ? `<span class="cal-time">${fmtTime(firstTime[ds])}</span>`
          : `<span class="cal-count">${counts[ds]}</span>`)
        : (h ? '<span class="cal-dot holiday-dot"></span>' : "");
      cells += `<button type="button" class="${cls}" data-day="${ds}" aria-label="${escapeHtml(`${day} ${calMonth.toLocaleDateString("he-IL", { month: "long" })}${title ? `, ${title}` : ""}`)}" onclick="App.selectCalDay('${ds}')">${day}${marker}</button>`;
    }

    return `
      <div class="cal-head">
        <button class="cal-nav" aria-label="חודש קודם" onclick="App.calShift(-1)">‹</button>
        <span>${calMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}</span>
        <button class="cal-nav" aria-label="חודש הבא" onclick="App.calShift(1)">›</button>
      </div>
      <button class="btn btn-light btn-block cal-today" onclick="App.calToday()">היום</button>
      <div class="cal-grid">${cells}</div>`;
  }

  // פירוט היום הנבחר מתחת ללוח החודשי
  function monthDayDetailHtml(day) {
    const h = holidayFor(day);
    const dayLessons = lessonSorted().filter(l => l.date === day);
    return (h ? `<div class="holiday-banner">${icon("info")} ${escapeHtml(h.name)}</div>` : "") +
      (dayLessons.length
        ? dayGroupHtml(day, dayLessons)
        : `<div class="empty empty-action">${icon("calendar")}<h3>היום הזה פנוי</h3><p>אין שיעורים ב-${fmtDate(day)}.</p></div>`) +
      `<button class="btn btn-light btn-block" onclick="App.openLessonForm()">${icon("plus")} קביעת שיעור ב-${fmtDate(day)}</button>`;
  }

  // מצב רשימה בלוח הבית — כל השיעורים הקרובים לפי ימים, ועבר בקיפול
  // כמה שיעורים מוצגים ברשימה בבת אחת. יומן של שנה קדימה הוא אלפי שורות,
  // וכולן ביחד היו ~11,000 צמתי DOM וגלילה כבדה. מרחיבים לפי בקשה.
  const LIST_PAGE = 40;
  let listLimit = LIST_PAGE;
  function showMoreLessons() { listLimit += LIST_PAGE; renderHome(); }

  function listViewHtml() {
    const list = lessonSorted();
    if (!list.length) {
      return `<div class="empty empty-action">${icon("calendar")}<h3>היומן עדיין ריק</h3><p>קבעי שיעור ראשון כדי להתחיל לבנות את השבוע.</p><button class="btn btn-green" onclick="App.openLessonForm()">קביעת שיעור</button></div>`;
    }
    const today = todayStr();
    const upcoming = list.filter(l => l.date >= today);
    const past = list.filter(l => l.date < today).reverse();

    const more = (rest, label) =>
      `<button type="button" class="past-toggle" onclick="App.showMoreLessons()">${label} (${rest})</button>`;

    let html = "";
    if (upcoming.length) {
      const shown = upcoming.slice(0, listLimit);
      groupByDate(shown).forEach((ls, date) => { html += dayGroupHtml(date, ls); });
      if (upcoming.length > shown.length) html += more(upcoming.length - shown.length, "הצגת עוד שיעורים");
    } else {
      html += `<div class="empty empty-action"><h3>אין שיעורים קרובים</h3><p>אפשר לקבוע עכשיו את המועד הבא.</p><button class="btn btn-green" onclick="App.openLessonForm()">קביעת שיעור</button></div>`;
    }
    if (past.length) {
      html += `<button type="button" class="past-toggle" onclick="App.togglePast()" aria-expanded="${showPast}">${showPast ? "הסתרת" : "הצגת"} שיעורים שעברו (${past.length})</button>`;
      if (showPast) {
        const shownPast = past.slice(0, listLimit);
        groupByDate(shownPast).forEach((ls, date) => { html += dayGroupHtml(date, ls); });
        if (past.length > shownPast.length) html += more(past.length - shownPast.length, "הצגת עוד שיעורים שעברו");
      }
    }
    return html;
  }

  function togglePast() { showPast = !showPast; renderHome(); }

  function setHomeCalMode(mode) {
    homeCalMode = mode;
    try { localStorage.setItem("mt_home_cal", mode); } catch { /* אין אחסון — המתג פשוט לא יישמר */ }
    renderHome();
  }

  // ========== מסך בית ==========
  // כרטיס הכוונה — מראה למשתמש מה הצעד הבא
  function renderOnboard() {
    const onb = document.getElementById("onboard");
    if (!onb) return;
    const hasStudents = students.length > 0;
    const hasLessons = lessons.length > 0;
    if (hasStudents && hasLessons) { onb.innerHTML = ""; return; }
    const step = (n, txt, done) =>
      `<div class="onboard-step ${done ? "done" : ""}"><span class="num">${done ? "✓" : n}</span><span>${txt}</span></div>`;
    const cta = !hasStudents
      ? `<button class="btn btn-green btn-block" onclick="App.openStudentForm()">הוספת תלמיד ראשון</button>`
      : `<button class="btn btn-green btn-block" onclick="App.openLessonForm()">קביעת שיעור ראשון</button>`;
    onb.innerHTML = `
      <div class="onboard-card">
        <h4>${hasStudents ? "כמעט שם!" : "ברוכה הבאה! 👋"}</h4>
        <p>שלושה צעדים קטנים כדי להתחיל לנהל את השיעורים:</p>
        <div class="onboard-steps">
          ${step(1, "הוספת תלמיד", hasStudents)}
          ${step(2, "קביעת שיעור ביומן", hasLessons)}
          ${step(3, "מעקב ותזכורת תשלום בוואטסאפ", false)}
        </div>
        ${cta}
      </div>`;
  }

  // ----- אישור שיעורים שעברו: "השיעור התקיים?" -----
  const pendingConfirmations = () => lessonsAwaitingConfirmation(lessonSorted());

  function confirmLesson(id, paid) {
    const l = lessons.find(x => x.id === id);
    if (!l) return;
    l.done = true;
    if (paid) { l.paid = true; l.paidAt = todayStr(); }
    if (!save()) { render(); return; }
    render();
    toast(paid ? "סומן: התקיים ושולם" : "סומן: השיעור התקיים", "ok", {
      label: "ביטול",
      run: () => { l.done = false; if (paid) { l.paid = false; delete l.paidAt; } save(); render(); }
    });
  }

  // "בוצע + עוד אחד": מסמן שבוצע ושולם, ומיד קובע שיעור המשך בשבוע הבא לפי האחרון
  function confirmAndRepeat(id) {
    const l = lessons.find(x => x.id === id);
    if (!l) return;
    const studentId = l.studentId;
    l.done = true; l.paid = true; l.paidAt = todayStr();
    if (!save()) { render(); return; }
    repeatLastLesson(studentId);
  }

  // דחייה מהירה בשבוע: אותו יום ושעה, שבוע קדימה. אם המועד תפוס — נפתח הטופס לבחירה ידנית.
  function postponeLesson(id) {
    const l = lessons.find(x => x.id === id);
    if (!l) return;
    const d = new Date(`${l.date}T00:00:00`);
    d.setDate(d.getDate() + 7);
    const date = ymd(d);
    const conflicts = findConflicts(lessons, { dates: [date], time: l.time, duration: l.duration, excludeId: id });
    if (conflicts.length) {
      openLessonForm(id);
      toast("המועד בעוד שבוע תפוס — בחרי מועד אחר", "err");
      return;
    }
    const prev = l.date;
    l.date = date;
    if (!save()) { l.date = prev; render(); return; }
    render();
    toast(`השיעור נדחה — ${dayLabelPlain(date)} בשעה ${fmtTime(l.time)}`, "ok", {
      label: "ביטול",
      run: () => { l.date = prev; save(); render(); }
    });
  }

  // "לא התקיים" — מסירים מהיומן, עם ביטול מיידי בטוסט (בלי חלון אישור)
  function skipLesson(id) {
    const idx = lessons.findIndex(x => x.id === id);
    if (idx === -1) return;
    const [removed] = lessons.splice(idx, 1);
    if (!save()) { render(); return; }
    render();
    toast("השיעור הוסר — לא התקיים", "ok", {
      label: "ביטול",
      run: () => { lessons.push(removed); save(); render(); }
    });
  }

  function renderConfirmQueue() {
    const el = document.getElementById("confirmQueue");
    if (!el) return;
    const pending = pendingConfirmations();
    if (!pending.length) { el.innerHTML = ""; return; }
    const shown = pending.slice(0, 4);
    const rows = shown.map(l => {
      const s = studentById(l.studentId);
      const price = lessonPrice(l);
      return `<article class="confirm-row">
        <div class="confirm-info">
          <strong>${escapeHtml(s?.name || "תלמיד")}</strong>
          <span>${escapeHtml(dayLabelPlain(l.date))} · ${fmtTime(l.time)}${price > 0 ? ` · ${cur(price)}` : ""}</span>
        </div>
        <div class="confirm-actions">
          <button class="btn btn-green" onclick="App.confirmLesson('${l.id}', true)">${icon("check")} התקיים ושולם</button>
          <button class="btn btn-light" onclick="App.confirmLesson('${l.id}', false)">התקיים</button>
          <button class="btn btn-light" onclick="App.confirmAndRepeat('${l.id}')" aria-label="סימון שבוצע ושולם וקביעת עוד שיעור בשבוע הבא">${icon("repeat")} בוצע + עוד אחד</button>
          <button class="btn btn-light" onclick="App.postponeLesson('${l.id}')" aria-label="דחיית השיעור בשבוע, לאותו יום ושעה">לשבוע הבא</button>
          <button class="btn btn-light confirm-skip" onclick="App.skipLesson('${l.id}')" aria-label="השיעור לא התקיים — הסרה מהיומן">לא התקיים</button>
        </div>
      </article>`;
    }).join("");
    el.innerHTML = `<div class="card confirm-card">
      <div class="confirm-head">${icon("bell")}<h3>שיעורים שעברו — מה קרה איתם?</h3>${pending.length > shown.length ? `<span class="confirm-more">ועוד ${pending.length - shown.length}</span>` : ""}</div>
      ${rows}
    </div>`;
  }

  // בית = יומן + מרכז התזכורות מתחתיו; כל השאר עבר למסך "סיכום"
  function renderHome() {
    const calDay = selectedDay || todayStr();
    const seg = (m, label) =>
      `<button type="button" class="seg-btn ${homeCalMode === m ? "active" : ""}" aria-pressed="${homeCalMode === m}" onclick="App.setHomeCalMode('${m}')">${label}</button>`;
    // סרגל היומן: תצוגה + הוספת תלמיד ישירות מהיומן (בלי לעבור למסך התלמידים)
    const modeBar = `<div class="home-cal-bar">
      <div class="seg-toggle home-cal-seg" role="group" aria-label="תצוגת יומן">${seg("day", "יום")}${seg("week", "שבוע")}${seg("month", "חודש")}${seg("list", "רשימה")}</div>
      <button type="button" class="btn btn-light cal-add-student" onclick="App.openStudentForm()" aria-label="הוספת תלמיד חדש">${icon("plus")} תלמיד</button>
    </div>`;
    const body = homeCalMode === "week"
      ? renderWeekGrid(calDay)
      : homeCalMode === "month"
        ? monthGridHtml() + monthDayDetailHtml(calDay)
        : homeCalMode === "list"
          ? listViewHtml()
          : renderWeekStrip(calDay) + renderDayAgenda(calDay);
    document.getElementById("homeCalendar").innerHTML = modeBar + `<div class="cal-slide" id="homeCalSlide">${body}</div>`;
    applyCalScroll();
    renderReminderHub();
  }

  // קיצור דרך מהכותרת (בכל מסך) אל מרכז התזכורות שבראש היומן.
  // פותח אותו בדרך — מי שלחץ על "3 לגבייה" רוצה לראות את הרשימה, לא כותרת מקופלת.
  function goReminders() {
    go("home", () => {
      const hub = document.querySelector("#reminderHub .reminder-hub");
      if (!hub) return;
      const box = hub.querySelector(".hub-box");
      if (box) box.open = true;
      // הפוקוס על הכותרת המתקפלת: פקד אמיתי, מכריז את המונים ואת מצב הפתיחה
      const target = hub.querySelector(".hub-summary") || hub;
      if (target === hub) hub.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      hub.scrollIntoView({ block: "start" });
    });
  }

  // מסך סיכום — השיעור הבא, קיצורי דרך, אישורי שיעורים וגבייה פתוחה
  function renderOverview() {
    document.getElementById("homeGreeting").textContent =
      settings.teacherName ? `שלום ${settings.teacherName}` : "שלום";

    renderOnboard();
    renderConfirmQueue();
    const today = todayStr();
    const todayLessons = lessonIndex.onDate(today);
    const nextLesson = lessonSorted().find(l => l.date >= today && !l.done);
    const nextStudent = nextLesson ? studentById(nextLesson.studentId) : null;
    const openPayments = lessons.filter(l => l.done && !l.paid).length;
    document.getElementById("todaySummary").innerHTML = `
      <div class="summary-top">
        <span>${new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</span>
        <span class="summary-status">${todayLessons.length ? `${todayLessons.length} ${todayLessons.length === 1 ? "שיעור היום" : "שיעורים היום"}` : "יום פנוי"}</span>
      </div>
      <div class="summary-focus">
        <div><span>${nextLesson ? "השיעור הבא" : "היומן מוכן"}</span><strong>${nextLesson ? escapeHtml(nextStudent?.name || "תלמיד") : "אין שיעורים קרובים"}</strong><p>${nextLesson ? `${dayLabelPlain(nextLesson.date)} בשעה ${fmtTime(nextLesson.time)}${nextLesson.topic ? ` · ${escapeHtml(nextLesson.topic)}` : ""}` : "אפשר לקבוע שיעור חדש בכל רגע."}</p></div>
        ${nextLesson ? `<button class="summary-time" onclick="App.openLessonForm('${nextLesson.id}')" aria-label="פתיחת השיעור הבא בשעה ${fmtTime(nextLesson.time)}">${fmtTime(nextLesson.time)}<span>פתיחת שיעור</span></button>` : `<button class="summary-time summary-add" onclick="App.openLessonForm()" aria-label="קביעת שיעור חדש">${icon("plus")}<span>שיעור חדש</span></button>`}
      </div>
      <div class="summary-foot">
        <span><b>${students.length}</b> ${students.length === 1 ? "תלמיד פעיל" : "תלמידים פעילים"}</span>
        <span><b>${openPayments}</b> ${openPayments === 1 ? "תשלום פתוח" : "תשלומים פתוחים"}</span>
      </div>
    `;

    renderInsights();
    renderBackupNudge();
  }

  // ----- מרכז התזכורות -----
  // יושב בראש היומן: שיעורים וכסף באותו כרטיס, בלי לעבור מסך.
  // מקופל כברירת מחדל כדי שהלוח יישאר גלוי — הכותרת לבדה מספרת כמה ממתין,
  // ופתיחה אחת חושפת את שתי הקבוצות. המצב נשמר, כך שמי שרוצה אותו פתוח מקבל אותו פתוח.
  const HUB_OPEN_KEY = "mt_hub_open";
  let hubOpen = localStorage.getItem(HUB_OPEN_KEY) === "1";
  function setHubOpen(open) {
    hubOpen = !!open;
    try { localStorage.setItem(HUB_OPEN_KEY, hubOpen ? "1" : "0"); }
    catch (error) { console.warn("Could not persist reminder hub state", error); }
  }

  // תזכורת שיעור נשלחת לטלפון התלמיד; אם אין — לטלפון ההורה
  const reminderPhone = student => student.studentPhone || student.phone;
  // שיעורים קרובים שאפשר לתזכר: היום ומחר, טרם התחילו.
  // גם שיעור של תלמיד בלי טלפון נשאר ברשימה — עם כפתור שמוסיף מספר, במקום להיעלם בשקט.
  function hubLessons() {
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); })();
    return upcomingReminderLessons(lessonSorted(), [todayStr(), tomorrow])
      .filter(l => studentById(l.studentId));
  }
  // כמה עוד ממתינים לשליחה — המונה שבכותרת
  const pendingLessons = () => hubLessons()
    .filter(l => reminderPhone(studentById(l.studentId)) && !waSent.has(reminderSignature(l)));

  // שלד שורה משותף לשיעורים ולגבייה — אווטאר, שם, שורת פירוט, פעולה אחת
  function remindRow({ name, meta, action }) {
    return `<li class="remind-row">
        <span class="student-avatar remind-avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>
        <span class="remind-info"><strong>${escapeHtml(name)}</strong><span>${meta}</span></span>
        ${action}
      </li>`;
  }

  // כפתור שליחה, או כפתור שמשלים את הטלפון החסר כשאי אפשר לשלוח
  function remindAction({ id, studentId, phone, sendCall, sendLabel, resentLabel, sent, stale = false }) {
    if (!phone) {
      return `<button type="button" id="${id}" class="remind-btn remind-btn-fix" onclick="App.openStudentForm('${studentId}')" aria-label="${sendLabel} — חסר מספר טלפון, הוספה עכשיו">${icon("plus")} טלפון</button>`;
    }
    const cls = stale ? "remind-btn remind-btn-again" : sent ? "remind-btn is-sent" : "remind-btn";
    return `<button type="button" id="${id}" class="${cls}" onclick="${sendCall}" aria-label="${sent ? resentLabel : sendLabel}">${icon("whatsapp")} ${sent ? "שוב" : "תזכורת"}</button>`;
  }

  function lessonReminderRow(l) {
    const s = studentById(l.studentId);
    const signature = reminderSignature(l);
    const sent = waSent.has(signature);
    const name = escapeHtml(s.name);
    const meta = `<span class="remind-when">${dayLabelPlain(l.date)} · ${fmtTime(l.time)}</span>${l.topic ? ` · ${escapeHtml(l.topic)}` : ""}` +
      (sent ? ` · <b class="remind-sent">${icon("check", "ic-sub")} ${sentAgoLabel(signature)}</b>` : "");
    return remindRow({
      name: s.name,
      meta,
      action: remindAction({
        id: `remind-${l.id}`,
        studentId: s.id,
        phone: reminderPhone(s),
        sendCall: `App.sendLessonReminder('${l.id}')`,
        sendLabel: `שליחת תזכורת ל-${name}`,
        resentLabel: `שליחה חוזרת של תזכורת ל-${name}`,
        sent
      })
    });
  }

  function debtReminderRow({ student: s, unpaid, owed }) {
    const signature = debtSignature(s.id, unpaid);
    const sent = !!s.phone && waSent.has(signature);
    const name = escapeHtml(s.name);
    // תזכורת בת יותר משישה ימים שעדיין לא הביאה תשלום — מסומנת ככזו שכדאי לחזור עליה
    const stale = sent && (Date.now() - (waSent.get(signature) || 0)) > 6 * 86400000;
    const meta = `<span class="remind-owed">${cur(owed)}</span> · ${unpaid.length === 1 ? "שיעור אחד" : `${unpaid.length} שיעורים`}` +
      (sent ? ` · <b class="remind-sent${stale ? " remind-stale" : ""}">${icon(stale ? "warn" : "check", "ic-sub")} ${sentAgoLabel(signature)}</b>` : "");
    return remindRow({
      name: s.name,
      meta,
      action: remindAction({
        id: `debt-${s.id}`,
        studentId: s.id,
        phone: s.phone,
        sendCall: `App.sendWhatsApp('${s.id}')`,
        sendLabel: `שליחת תזכורת תשלום ל-${name}`,
        resentLabel: `שליחה חוזרת של תזכורת תשלום ל-${name}`,
        sent,
        stale
      })
    });
  }

  function hubGroup({ id, title, count, countClass = "", note = "", rows, empty, footer = "" }) {
    return `<section class="hub-group" aria-labelledby="${id}">
      <div class="hub-group-head">
        <h4 id="${id}">${title}</h4>
        <span class="hub-count ${countClass}">${count}</span>
      </div>
      ${note ? `<p class="hub-note">${note}</p>` : ""}
      ${rows ? `<ul class="remind-list">${rows}</ul>${footer}` : `<p class="hub-empty">${empty}</p>`}
    </section>`;
  }

  // אריח מונה בכותרת המקופלת. מצב תקין מסומן גם באייקון ולא בצבע בלבד.
  const hubStat = (kind, value, label) =>
    `<span class="hub-stat hub-stat-${kind}">${kind === "ok" ? icon("check", "ic-sub") : `<b>${value}</b>`}<span>${label}</span></span>`;

  function renderReminderHub() {
    const el = document.getElementById("reminderHub");
    if (!el) return;
    // ה-DOM החי הוא מקור האמת למצב הפתיחה. אירוע toggle מגיע בתור נפרד, ורינדור
    // שנכנס באמצע (טיימר תזכורות, שליחה) היה סוגר בחזרה כרטיס שהמשתמשת בדיוק פתחה.
    const live = el.querySelector(".hub-box");
    if (live) hubOpen = live.open;

    const lessonList = hubLessons();
    const lessonsToSend = pendingLessons().length;
    const debtors = debtorList();
    const unpaidAll = lessons.filter(l => l.done && !l.paid);
    const totalOwed = unpaidAll.reduce((sum, l) => sum + lessonPrice(l), 0);
    // גיל החוב הוותיק ביותר — מוצג רק כשהוא כבר מדאיג (שבועיים ומעלה)
    const oldestAge = debtAgeWeeks(unpaidAll, todayStr());

    if (!lessonList.length && !debtors.length) {
      renderKeepFocus(el, `<section class="reminder-hub hub-clear" aria-labelledby="hubTitle">
        ${icon("checkCircle")}
        <span><h3 id="hubTitle">אין תזכורות ממתינות</h3><span>אין שיעורים קרובים לתזכר ואין תשלומים פתוחים.</span></span>
      </section>`);
      return;
    }

    const lessonsGroup = hubGroup({
      id: "hubLessonsTitle",
      title: "שיעורים קרובים",
      count: lessonsToSend ? `${lessonsToSend} לשליחה` : "הכול נשלח",
      countClass: lessonsToSend ? "" : "hub-count-done",
      rows: lessonList.map(lessonReminderRow).join(""),
      empty: "אין שיעורים היום או מחר שממתינים לתזכורת."
    });

    const debtGroup = hubGroup({
      id: "hubMoneyTitle",
      title: "תשלומים פתוחים",
      count: debtors.length ? cur(totalOwed) : "הכול שולם",
      countClass: debtors.length ? "hub-count-due" : "hub-count-done",
      note: oldestAge >= 2 ? `${icon("warn", "ic-sub")} הוותיק כבר מחכה ${debtAgeLabel(oldestAge)}` : "",
      rows: debtors.map(debtReminderRow).join(""),
      empty: "אין כרגע תשלומים פתוחים.",
      footer: `<button type="button" class="debt-summary-link" onclick="App.go('money')" aria-label="מעבר למסך כספים למעקב מלא">מעקב מלא במסך כספים ‹</button>`
    });

    const stats =
      (lessonsToSend
        ? hubStat("live", lessonsToSend, lessonsToSend === 1 ? "שיעור לתזכורת" : "שיעורים לתזכורת")
        : hubStat("ok", "", "כל התזכורות נשלחו")) +
      (totalOwed
        ? hubStat("due", cur(totalOwed), `לגבייה · ${debtors.length === 1 ? "תלמיד אחד" : `${debtors.length} תלמידים`}`)
        : hubStat("ok", "", "אין חוב פתוח"));

    renderKeepFocus(el, `<section class="reminder-hub" aria-labelledby="hubTitle">
      <details class="hub-box"${hubOpen ? " open" : ""} ontoggle="App.setHubOpen(this.open)">
        <summary class="hub-summary">
          <span class="hub-summary-top">
            <span class="hub-mark" aria-hidden="true">${icon("bell")}</span>
            <h3 id="hubTitle">תזכורות</h3>
            <span class="hub-chevron" aria-hidden="true">${icon("chevron")}</span>
          </span>
          <span class="hub-stats">${stats}</span>
        </summary>
        <div class="hub-body">
          ${lessonsGroup}
          ${debtGroup}
        </div>
      </details>
    </section>`);
  }

  // פס תובנות בדף הסיכום: מחזור החודש, שעות הוראה, שיעורי השבוע
  function renderInsights() {
    const el = document.getElementById("homeInsights");
    if (!el) return;
    const mkey = monthKey(new Date());
    const monthDone = lessons.filter(l => l.done && l.date.startsWith(mkey));
    const revenue = monthDone.reduce((sum, l) => sum + lessonPrice(l), 0);
    const minutes = monthDone.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const hours = Math.round(minutes / 6) / 10; // שעה אחת אחרי הנקודה
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - now.getDay()); // ראשון
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const from = ymd(start), to = ymd(end);
    const weekCount = lessons.filter(l => l.date >= from && l.date <= to).length;
    const tile = (label, value, sub) =>
      `<div class="insight-tile"><span class="insight-label">${label}</span><strong class="insight-value">${value}</strong><span class="insight-sub">${sub}</span></div>`;
    el.innerHTML =
      tile("מחזור החודש", cur(revenue), `${monthDone.length} ${monthDone.length === 1 ? "שיעור בוצע" : "שיעורים בוצעו"}`) +
      tile("שעות הוראה", hours.toLocaleString("he-IL"), "החודש") +
      tile("השבוע", weekCount, weekCount === 1 ? "שיעור מתוכנן" : "שיעורים מתוכננים");
  }

  // ========== כספים: מעבר בין תשלומים לסיכום ==========
  function applyMoneyTab() {
    document.querySelectorAll(".seg-btn[data-money]").forEach(b => {
      const active = b.dataset.money === moneyTab;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("money-payments").classList.toggle("hidden", moneyTab !== "payments");
    document.getElementById("money-income").classList.toggle("hidden", moneyTab !== "income");
    if (moneyTab === "income") drawChart();
  }
  function renderMoney() {
    if (moneyTab === "payments") renderPayments();
    else renderIncome();
    applyMoneyTab();
  }
  function setMoneyTab(tab) {
    moneyTab = tab;
    renderMoney();
  }

  // ========== תשלומים ==========
  // כל החייבים, מהחוב הגדול לקטן — מקור אחד ליומן, לסיכום ולמסך כספים
  function debtorList() {
    const today = todayStr();
    return students.map(student => {
      const unpaid = lessonIndex.unpaidForStudent(student.id);
      return {
        student,
        unpaid,
        owed: unpaid.reduce((sum, l) => sum + lessonPrice(l), 0),
        age: debtAgeWeeks(unpaid, today)
      };
    }).filter(item => item.unpaid.length).sort((a, b) => b.owed - a.owed);
  }

  // מי מהחייבים פתוח כרגע. הפירוט נבנה רק בפתיחה — סגור הוא אפס צמתי DOM,
  // והסט שורד רינדור מחדש כדי שסימון תשלום לא יסגור את הרשימה שעובדים בה.
  const openDebtors = new Set();
  function togglePaymentBox(box, studentId) {
    if (box.open) openDebtors.add(studentId); else openDebtors.delete(studentId);
    const list = box.querySelector(".payment-lessons");
    if (box.open && list && !list.children.length) {
      const student = studentById(studentId);
      if (student) list.innerHTML = paymentLessonRows(student);
    }
  }

  function paymentLessonRows(student) {
    return lessonIndex.unpaidForStudent(student.id).map(l => `
      <li class="payment-lesson">
        <div class="payment-lesson-info">
          <span class="payment-lesson-date">${icon("calendar", "ic-sub")} ${fmtDate(l.date)}</span>
          ${l.topic ? `<span class="payment-lesson-topic">${escapeHtml(l.topic)}</span>` : ""}
        </div>
        <strong class="payment-lesson-price">${cur(lessonPrice(l))}</strong>
        <button class="payment-mark" onclick="App.togglePaid('${l.id}')" aria-label="סימון השיעור של ${escapeHtml(student.name)} מ-${fmtDate(l.date)} בסך ${cur(lessonPrice(l))} כשולם">
          ${icon("check")} <span>סימון כשולם</span>
        </button>
      </li>`).join("");
  }

  function renderPayments() {
    const el = document.getElementById("paymentsList");
    const paint = html => renderKeepFocus(el, html);
    if (!students.length) {
      paint(`<div class="empty">כדי לעקוב אחר תשלומים, צריך קודם להוסיף תלמיד ושיעור.</div>`);
      return;
    }
    const totalUnpaid = lessons.filter(lesson => lesson.done && !lesson.paid);
    const totalOwed = totalUnpaid.reduce((sum, lesson) => sum + lessonPrice(lesson), 0);
    const debtors = debtorList();

    // פירוט השיעורים מקופל: חשבון של מורה ותיקה הוא עשרות שורות לתלמיד, וכולן פרושות
    // היו אלפי צמתי DOM ורינדור של ~33ms בכל סימון תשלום. מה שצריך כדי להחליט —
    // שם, כמה, כמה כסף וכמה זמן זה מחכה — נשאר גלוי; הפירוט נפתח בלחיצה.
    const queue = debtors.length ? debtors.map(({ student, unpaid, owed, age }) => {
      const open = openDebtors.has(student.id);
      return `
      <article class="payment-account" aria-labelledby="payment-student-${student.id}">
        <details class="payment-box"${open ? " open" : ""} ontoggle="App.togglePaymentBox(this, '${student.id}')">
          <summary class="payment-account-head">
            <span class="student-avatar payment-avatar" aria-hidden="true">${escapeHtml(initials(student.name))}</span>
            <span class="payment-account-copy">
              <h3 id="payment-student-${student.id}">${escapeHtml(student.name)}</h3>
              <span>${unpaid.length === 1 ? "שיעור אחד ממתין" : `${unpaid.length} שיעורים ממתינים`}${debtAgeLabel(age) ? ` · <span class="debt-age${age >= 3 ? " debt-age-old" : ""}">מחכה כבר ${debtAgeLabel(age)}</span>` : ""}</span>
            </span>
            <span class="payment-account-total">
              <b>${cur(owed)}</b>
              <span class="payment-expand">${icon("chevron", "ic-sub")} פירוט</span>
            </span>
          </summary>
          <ul class="payment-lessons" aria-label="שיעורים שטרם שולמו">${open ? paymentLessonRows(student) : ""}</ul>
        </details>
        <footer class="payment-actions">
          ${student.phone
            ? (waSent.has(debtSignature(student.id, unpaid))
              ? `<button class="btn btn-light" onclick="App.sendWhatsApp('${student.id}')">${icon("check")} ${sentAgoLabel(debtSignature(student.id, unpaid))} · שוב?</button>`
              : `<button class="btn btn-wa" onclick="App.sendWhatsApp('${student.id}')">${icon("whatsapp")} שליחת תזכורת</button>`)
            : `<button class="btn btn-light" onclick="App.openStudentForm('${student.id}')">הוספת מספר טלפון</button>`}
          <button class="btn btn-green" onclick="App.markAllPaid('${student.id}')">${icon("check")} סימון ${unpaid.length === 1 ? "השיעור" : "הכול"} כשולם</button>
        </footer>
      </article>`;
    }).join("") : `
      <div class="payment-empty">
        <span class="payment-empty-icon">${icon("checkCircle")}</span>
        <div><h3>אין תשלומים פתוחים</h3><p>כל השיעורים שבוצעו מסומנים כשולמו.</p></div>
      </div>`;

    const settledStudents = students.length - debtors.length;
    paint(`
      <section class="payment-summary" aria-label="סיכום תשלומים פתוחים">
        <div class="payment-summary-main">
          <span>יתרה לגבייה</span>
          <strong>${cur(totalOwed)}</strong>
        </div>
        <div class="payment-summary-meta">
          <span>${icon("note")} <b>${totalUnpaid.length}</b> ${totalUnpaid.length === 1 ? "שיעור פתוח" : "שיעורים פתוחים"}</span>
          <span>${icon("checkCircle")} <b>${settledStudents}</b> ללא חוב</span>
        </div>
      </section>
      <div class="payment-queue-head">
        <h3>ממתינים לטיפול</h3>
        <span>${debtors.length === 0 ? "הכול מעודכן" : debtors.length === 1 ? "תלמיד אחד" : `${debtors.length} תלמידים`}</span>
      </div>
      <div class="payment-queue">${queue}</div>`);
  }

  // "שבוע" / "שבועיים" / "X שבועות" — תווית גיל חוב; ריק כשהחוב בן פחות משבוע
  function debtAgeLabel(weeks) {
    if (weeks < 1) return "";
    return weeks === 1 ? "שבוע" : weeks === 2 ? "שבועיים" : `${weeks} שבועות`;
  }

  function togglePaid(id, showUndo = true) {
    const l = lessons.find(x => x.id === id);
    if (!l) return;
    l.paid = !l.paid;
    if (l.paid) l.paidAt = todayStr(); else delete l.paidAt;
    if (!save()) { render(); return; }
    render();
    toast(l.paid ? "סומן כשולם" : "בוטל סימון התשלום", "ok", showUndo ? {
      label: "ביטול",
      run: () => togglePaid(id, false)
    } : null);
  }

  async function markAllPaid(studentId) {
    const unpaid = [...lessonIndex.unpaidForStudent(studentId)];
    if (!unpaid.length) return;
    if (!await askConfirmation(`לסמן ${unpaid.length} ${unpaid.length === 1 ? "שיעור" : "שיעורים"} כשולמו?`, "סימון כשולם")) return;
    const paidAt = todayStr();
    unpaid.forEach(l => { l.paid = true; l.paidAt = paidAt; });
    if (!save()) { render(); return; }
    render();
    toast("כל השיעורים סומנו כשולמו", "ok", {
      label: "ביטול",
      run: () => {
        const ids = new Set(unpaid.map(lesson => lesson.id));
        lessons.filter(lesson => ids.has(lesson.id)).forEach(lesson => { lesson.paid = false; delete lesson.paidAt; });
        if (save()) render();
      }
    });
  }

  // ----- וואטסאפ: הודעה מוכנה + קישור לשליחה בלחיצה -----
  // פרטי תשלום (קישור ביט/פייבוקס או מספר להעברה) שנדבקים לסוף הודעת גבייה
  const payInfoLine = () => settings.payInfo ? `\n\nלתשלום: ${settings.payInfo}` : "";

  // פתיחת וואטסאפ עם הודעה מוכנה. מנרמל מספר ישראלי לפורמט בינלאומי.
  function waOpen(rawPhone, msg) {
    if (!rawPhone) { toast("לתלמיד אין מספר טלפון. הוסיפי אותו במסך התלמידים.", "err"); return false; }
    let phone = rawPhone.replace(/[^0-9]/g, "");
    if (phone.startsWith("00")) phone = phone.slice(2);
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    else if (!phone.startsWith("972")) phone = "972" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
    return true;
  }

  // ----- מעקב "נשלח": איזו תזכורת וואטסאפ כבר יצאה ומתי (נשמר מקומית) -----
  // Map<חתימה, חותמת-זמן>. תמיכה לאחור: מערך חתימות ישן נטען עם זמן 0 (לא ידוע).
  const WA_SENT_KEY = "mt_wa_sent";
  function loadWaSent() {
    try {
      const raw = JSON.parse(localStorage.getItem(WA_SENT_KEY) || "[]");
      if (!Array.isArray(raw)) return new Map();
      return new Map(raw.map(v => Array.isArray(v) ? v : [v, 0]));
    } catch {
      return new Map();
    }
  }
  const waSent = loadWaSent();
  // "נשלח לפני N ימים" — לתת למורה לדעת אם כדאי לשלוח שוב
  function sentAgoLabel(signature) {
    const ts = waSent.get(signature);
    if (!ts) return "נשלח";
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days <= 0) return "נשלח היום";
    if (days === 1) return "נשלח אתמול";
    return `נשלח לפני ${days} ימים`;
  }
  // חתימת חוב: משתנה כשהחוב משתנה — תזכורת שנשלחה על חוב ישן לא חוסמת חוב חדש
  const debtSignature = (studentId, unpaid) =>
    `paydebt:${studentId}:${unpaid.length}:${unpaid.reduce((sum, l) => sum + lessonPrice(l), 0)}`;
  function rememberWaSent(signature) {
    waSent.set(signature, Date.now());
    const activeSignatures = new Set(lessons.map(reminderSignature));
    for (const s of students) {
      const unpaid = lessonIndex.unpaidForStudent(s.id);
      if (unpaid.length) activeSignatures.add(debtSignature(s.id, unpaid));
    }
    for (const key of [...waSent.keys()]) {
      if (!activeSignatures.has(key)) waSent.delete(key);
    }
    try { localStorage.setItem(WA_SENT_KEY, JSON.stringify([...waSent])); }
    catch (error) { console.warn("Could not persist WhatsApp reminder history", error); }
  }

  // תזכורת תשלום מוכנה לשליחה. מחזירה true רק אם וואטסאפ באמת נפתח — התור מסתמך על זה.
  function sendWhatsApp(studentId) {
    const s = studentById(studentId);
    if (!s) return false;
    const unpaid = lessonIndex.unpaidForStudent(studentId);
    const owed = unpaid.reduce((sum, l) => sum + lessonPrice(l), 0);
    const greet = s.parentName ? `שלום ${s.parentName},` : "שלום,";
    const msg =
      `${greet}\n` +
      `תזכורת ידידותית לגבי תשלום עבור השיעורים הפרטיים של ${s.name}.\n` +
      `סה"כ ${unpaid.length} שיעורים שטרם שולמו, בסך ${owed} ${settings.currency}.\n` +
      `תודה רבה!` +
      payInfoLine();
    if (!unpaid.length || !waOpen(s.phone, msg)) return false;
    rememberWaSent(debtSignature(studentId, unpaid));
    render();
    return true;
  }

  // קבלה/ריכוז חודשי לשליחה להורה: שיעורים שבוצעו החודש + סכום ומצב תשלום
  function sendReceipt(studentId) {
    const s = studentById(studentId);
    if (!s) return;
    const mkey = monthKey(new Date());
    const monthLessons = lessonIndex.forStudent(studentId)
      .filter(l => l.done && l.date.startsWith(mkey))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (!monthLessons.length) { toast("אין שיעורים שבוצעו החודש", "err"); return; }
    const total = monthLessons.reduce((sum, l) => sum + lessonPrice(l), 0);
    const paid = monthLessons.filter(l => l.paid).reduce((sum, l) => sum + lessonPrice(l), 0);
    const monthName = new Date().toLocaleDateString("he-IL", { month: "long", year: "numeric" });
    const lines = monthLessons.map(l => `• ${fmtDate(l.date)}${l.topic ? ` – ${l.topic}` : ""} (${cur(lessonPrice(l))})`);
    const greet = s.parentName ? `שלום ${s.parentName},` : "שלום,";
    const msg =
      `${greet}\n` +
      `ריכוז שיעורים של ${s.name} – ${monthName}:\n` +
      `${lines.join("\n")}\n\n` +
      `סה"כ ${monthLessons.length} ${monthLessons.length === 1 ? "שיעור" : "שיעורים"} · ${cur(total)}` +
      (paid < total ? `\nשולם ${cur(paid)} · נותר לתשלום ${cur(total - paid)}` + payInfoLine() : `\nהכול שולם — תודה רבה!`);
    waOpen(s.phone, msg);
  }

  // תזכורת שיעור מוכנה לשליחה לתלמיד/הורה
  // מחזירה true רק אם וואטסאפ באמת נפתח — התור מעל מסתמך על זה
  function sendLessonReminder(lessonId) {
    const l = lessons.find(x => x.id === lessonId);
    if (!l) return false;
    const s = studentById(l.studentId);
    if (!s) return false;
    const toStudent = !!s.studentPhone;
    const greet = toStudent ? `שלום ${s.name},` : (s.parentName ? `שלום ${s.parentName},` : "שלום,");
    const when = dayLabelPlain(l.date);
    const msg =
      `${greet}\n` +
      (toStudent
        ? `תזכורת לשיעור ${when} בשעה ${l.time}.`
        : `תזכורת לשיעור של ${s.name} ${when} בשעה ${l.time}.`) +
      (l.topic ? `\nנושא: ${l.topic}.` : "") +
      `\nנתראה!`;
    if (!waOpen(reminderPhone(s), msg)) return false;
    rememberWaSent(reminderSignature(l));
    render();
    return true;
  }

  // אין "שליחה לכולם": וואטסאפ פותח צ'אט אחד בכל פעם, ותור של חלונות קופצים
  // רק נראה כמו שליחה מרוכזת. שולחים שורה-שורה, והמונה מראה כמה נשארו.

  // ========== גיבוי ושחזור ==========
  function exportData() {
    const data = { ...createSnapshot(students, lessons, settings), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `גיבוי-המורה-שלי-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    try { localStorage.setItem(BACKUP_STAMP_KEY, String(Date.now())); } catch { /* לא קריטי */ }
    toast("הגיבוי הורד", "ok");
    render();
  }

  // תזכורת גיבוי: הנתונים חיים רק במכשיר — אחרי שבועיים בלי גיבוי מציעים אחד בלחיצה
  const BACKUP_STAMP_KEY = "mt_last_backup";
  function renderBackupNudge() {
    const el = document.getElementById("backupNudge");
    if (!el) return;
    const last = Number(localStorage.getItem(BACKUP_STAMP_KEY)) || 0;
    const stale = Date.now() - last > 14 * 24 * 60 * 60 * 1000;
    el.innerHTML = stale && (students.length || lessons.length)
      ? `<div class="backup-nudge">${icon("warn")}
          <div><strong>${last ? "עברו יותר משבועיים מהגיבוי האחרון" : "עוד לא נעשה גיבוי"}</strong><span>הנתונים שמורים רק במכשיר הזה.</span></div>
          <button class="btn btn-light" onclick="App.exportData()">גיבוי עכשיו</button>
        </div>`
      : "";
  }

  function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const data = parseBackup(JSON.parse(e.target.result));
        if (!await askConfirmation("השחזור יחליף את כל התלמידים, השיעורים וההגדרות הקיימים.", "שחזור מגיבוי")) { event.target.value = ""; return; }
        students = data.students;
        lessons = data.lessons;
        settings = data.settings;
        if (!save()) { render(); return; }
        applyTheme(); render();
        toast("השחזור הושלם בהצלחה", "ok");
      } catch (err) {
        toast("שגיאה בקריאת הקובץ: " + err.message, "err");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  // ========== סיכום הכנסות ==========
  function changeMonth(delta) {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
    renderIncome();
  }

  function renderIncome() {
    const key = monthKey(viewMonth);
    document.getElementById("currentMonthLabel").textContent =
      viewMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" });

    const monthLessons = lessonIndex.sortedLessons.filter(l => l.date.startsWith(key) && l.done);
    const summary = summarizeMonth(monthLessons, lessonIndex.studentsById, lessonPrice);
    const { earned, pending, students: perStudent } = summary;

    const total = earned + pending;
    const collectionRate = total > 0 ? Math.round((earned / total) * 100) : 0;
    const breakdown = perStudent.length ? `
      <section class="income-breakdown" aria-labelledby="incomeBreakdownTitle">
        <div class="income-section-head"><div><h3 id="incomeBreakdownTitle">פירוט לפי תלמיד</h3><p>${perStudent.length} ${perStudent.length === 1 ? "תלמיד" : "תלמידים"} החודש</p></div></div>
        <div class="income-students">
          ${perStudent.map(x => `
            <button type="button" class="income-student" onclick="App.openStudentProfile('${x.student.id}')" aria-label="פתיחת הפרופיל של ${escapeHtml(x.student.name)}">
              <span class="student-avatar" aria-hidden="true">${escapeHtml(initials(x.student.name))}</span>
              <div><strong>${escapeHtml(x.student.name)}</strong><span>${x.count} ${x.count === 1 ? "שיעור" : "שיעורים"} · התקבל ${cur(x.earned)}</span></div>
              <div class="income-student-total"><b>${cur(x.earned + x.pending)}</b>${x.pending > 0 ? `<span>ממתין ${cur(x.pending)}</span>` : `<span class="paid">שולם</span>`}</div>
            </button>`).join("")}
        </div>
      </section>` : `<div class="empty empty-action"><h3>אין הכנסות בחודש הזה</h3><p>שיעורים שסומנו כבוצעו יופיעו כאן.</p></div>`;

    document.getElementById("incomeSummary").innerHTML = `
      <section class="income-overview" aria-label="סיכום הכנסות לחודש">
        <div class="income-total"><span>מחזור החודש</span><strong>${cur(total)}</strong><small>${monthLessons.length} ${monthLessons.length === 1 ? "שיעור שבוצע" : "שיעורים שבוצעו"}</small></div>
        <div class="income-metrics">
          <div><span>התקבל</span><strong>${cur(earned)}</strong></div>
          <div class="pending"><span>ממתין</span><strong>${cur(pending)}</strong></div>
        </div>
        <div class="collection-rate"><div><span>שיעור גבייה</span><b>${collectionRate}%</b></div><span class="rate-track" aria-hidden="true"><i style="width:${collectionRate}%"></i></span></div>
      </section>
      ${breakdown}`;

    drawChart();
  }

  // גרף עמודות של 6 החודשים האחרונים (ללא ספריות חיצוניות)
  function drawChart() {
    const canvas = document.getElementById("incomeChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const css = getComputedStyle(document.documentElement);
    const textCol = css.getPropertyValue("--text").trim() || "#1f2937";
    const faintCol = css.getPropertyValue("--faint").trim() || "#9aa1ab";
    const brandCol = css.getPropertyValue("--brand-1").trim() || "#2947c7";
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = 200;
    if (W < 60) return; // הקנבס מוסתר/צר מדי — אין מה לצייר
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - i, 1);
      const k = monthKey(d);
      const total = lessons.filter(l => l.date.startsWith(k) && l.done)
        .reduce((sum, l) => sum + lessonPrice(l), 0);
      months.push({ label: d.toLocaleDateString("he-IL", { month: "short" }), total, current: k === monthKey(viewMonth) });
    }

    const max = Math.max(...months.map(m => m.total), 1);
    const pad = 30, gap = 14;
    const bw = (W - pad * 2 - gap * 5) / 6;
    ctx.font = "12px Assistant, sans-serif";
    ctx.textAlign = "center";

    months.forEach((m, i) => {
      const x = pad + i * (bw + gap);
      const h = (m.total / max) * (H - 50);
      const y = H - 25 - h;
      ctx.fillStyle = m.current ? brandCol : css.getPropertyValue("--chart-muted").trim() || "#aeb9cc";
      const r = Math.min(6, bw / 2);
      ctx.beginPath();
      ctx.moveTo(x, H - 25);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.lineTo(x + bw - r, y);
      ctx.arcTo(x + bw, y, x + bw, y + r, r);
      ctx.lineTo(x + bw, H - 25);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = textCol;
      ctx.fillText(settings.currency + m.total, x + bw / 2, y - 6);
      ctx.fillStyle = faintCol;
      ctx.fillText(m.label, x + bw / 2, H - 8);
    });
  }

  // ========== הגדרות ==========
  function renderSettings() {
    const body = document.getElementById("settingsBody");
    renderKeepFocus(body, `
      <section class="settings-group">
        <div class="settings-group-head"><span>${icon("edit")}</span><div><h3>פרופיל</h3><p>הפרטים שמופיעים באפליקציה</p></div></div>
        <div class="settings-panel">
        <div class="setting-row">
          <div><label class="setting-label" for="set-name">שם המורה</label><div class="setting-sub">יופיע בברכה במסך הבית</div></div>
          <input type="text" id="set-name" value="${escapeHtml(settings.teacherName)}" placeholder="שמך" onchange="App.updateSetting('teacherName', this.value)">
        </div>
        <div class="setting-row">
          <div><label class="setting-label" for="set-cur">מטבע</label></div>
          <input type="text" id="set-cur" value="${escapeHtml(settings.currency)}" maxlength="3" onchange="App.updateSetting('currency', this.value)">
        </div>
        <div class="setting-row setting-row-wide">
          <div><label class="setting-label" for="set-payinfo">פרטים לתשלום</label><div class="setting-sub">קישור ביט/פייבוקס או מספר להעברה — יתווסף לתזכורות התשלום בוואטסאפ</div></div>
          <input type="text" id="set-payinfo" value="${escapeHtml(settings.payInfo || "")}" placeholder="לדוגמה: bit.ly/pay או העברה ל-050..." onchange="App.updateSetting('payInfo', this.value)">
        </div>
        </div>
      </section>

      <section class="settings-group">
        <div class="settings-group-head"><span>${icon("calendar")}</span><div><h3>ברירות מחדל לשיעור</h3><p>חוסך הקלדה בכל שיעור חדש</p></div></div>
        <div class="settings-panel">
        <div class="setting-row">
          <div><label class="setting-label" for="set-price">מחיר ברירת מחדל</label></div>
          <input id="set-price" type="number" inputmode="numeric" min="0" value="${settings.defaultPrice}" onchange="App.updateSetting('defaultPrice', this.value)">
        </div>
        <div class="setting-row">
          <div><label class="setting-label" for="set-time">שעת התחלה</label></div>
          <input id="set-time" type="time" value="${settings.defaultTime}" onchange="App.updateSetting('defaultTime', this.value)">
        </div>
        <div class="setting-row">
          <div><label class="setting-label" for="set-duration">משך (דקות)</label></div>
          <input id="set-duration" type="number" inputmode="numeric" min="0" step="15" value="${settings.defaultDuration}" onchange="App.updateSetting('defaultDuration', this.value)">
        </div>
        </div>
      </section>

      <section class="settings-group settings-wide">
        <div class="settings-group-head"><span>${icon("bell")}</span><div><h3>התראות ותזכורות</h3><p>הכנה לקראת שיעורים קרובים</p></div></div>
        <div class="reminder-status-card">
          <div>
            <span class="status-pill">${notifStatusText()}</span>
            <h4>תזכורת ${settings.remindMinutes} דקות לפני שיעור</h4>
            <p>${notifHelpText()}</p>
            ${pushStatusHtml()}
            <p id="pushDiag" class="push-diag" aria-live="polite"></p>
          </div>
          <input type="number" inputmode="numeric" min="0" value="${settings.remindMinutes}" onchange="App.updateSetting('remindMinutes', this.value)" aria-label="דקות לפני שיעור">
        </div>
        <div class="settings-action-stack reminder-actions">
          <button class="btn btn-green btn-block" onclick="App.exportCalendar()">${icon("calendar")} הוספת השיעורים ליומן הטלפון</button>
          <button class="btn btn-light btn-block" onclick="App.testClosedPush()">${icon("bell")} בדיקה: התראה כשהאפליקציה סגורה</button>
          ${notifSupported && Notification.permission === "granted"
            ? `<button class="btn btn-light btn-block" onclick="App.testNotification()">${icon("bell")} שליחת התראת בדיקה באפליקציה</button>`
            : `<button class="btn btn-light btn-block" onclick="App.enableNotifications()">${icon("bell")} הפעלת התראות באפליקציה</button>`}
        </div>
      </section>

      <section class="settings-group">
        <div class="settings-group-head"><span>${icon("info")}</span><div><h3>מראה</h3><p>התאמה לתאורה ולהעדפה שלך</p></div></div>
        <div class="settings-panel">
        <div class="setting-row">
          <div><div class="setting-label">ערכת נושא</div></div>
          <div class="theme-seg">
            <button class="${settings.theme === "auto" ? "active" : ""}" aria-pressed="${settings.theme === "auto"}" onclick="App.setTheme('auto')">אוטומטי</button>
            <button class="${settings.theme === "light" ? "active" : ""}" aria-pressed="${settings.theme === "light"}" onclick="App.setTheme('light')">בהיר</button>
            <button class="${settings.theme === "dark" ? "active" : ""}" aria-pressed="${settings.theme === "dark"}" onclick="App.setTheme('dark')">כהה</button>
          </div>
        </div>
        </div>
      </section>

      <section class="settings-group">
        <div class="settings-group-head"><span>${icon("checkCircle")}</span><div><h3>התקנה</h3><p>גישה מהירה ממסך הבית</p></div></div>
        <div class="settings-action-stack compact">
          ${isStandalone()
            ? `<div class="install-status">${icon("checkCircle")}<div><strong>האפליקציה מותקנת</strong><span>הגרסה מתעדכנת אוטומטית</span></div></div>`
            : canInstall()
              ? `<button class="btn btn-green btn-block" onclick="App.promptInstall()">התקנת האפליקציה למסך הבית</button>`
              : `<p class="settings-help">להתקנה: פתחי את תפריט הדפדפן ובחרי <b>"הוספה למסך הבית"</b>.</p>`}
        </div>
      </section>

      <section class="settings-group settings-wide">
        <div class="settings-group-head"><span>${icon("note")}</span><div><h3>נתונים וגיבוי</h3><p>המידע נשמר מקומית במכשיר הזה</p></div></div>
        <div class="settings-action-stack settings-data-actions">
          <button class="btn btn-light btn-block" onclick="App.exportData()">${icon("note")} ייצוא גיבוי לקובץ</button>
          <button class="btn btn-light btn-block" onclick="document.getElementById('importFile').click()">${icon("repeat")} שחזור מקובץ גיבוי</button>
        </div>
        <div class="settings-danger">
          <p>מחיקה היא סופית ואי אפשר לבטל אותה. כדאי לייצא גיבוי קודם.</p>
          <button class="btn btn-danger btn-block" onclick="App.clearAll()">${icon("warn")} מחיקת כל הנתונים</button>
        </div>
        <div class="app-version">המורה שלי · גרסה ${APP_VERSION}</div>
      </section>
    `);
    fillPushDiag();
  }

  // שורת אבחון התראות — עוזרת להבין למה התראות רקע לא נרשמות במכשיר
  function fillPushDiag() {
    const el = document.getElementById("pushDiag");
    if (!el) return;
    const perm = !notifSupported ? "אין תמיכה"
      : Notification.permission === "granted" ? "אושרה"
      : Notification.permission === "denied" ? "חסומה" : "טרם נשאלה";
    pushSubscribed().then(sub => {
      el.textContent = `אבחון: הרשאה: ${perm} · מותקנת למסך הבית: ${isStandalone() ? "כן" : "לא"} · תמיכת רקע: ${pushSupported() ? "כן" : "לא"} · רישום בשרת: ${sub ? "כן" : "לא"}`;
    });
  }

  function updateSetting(key, value) {
    if (["defaultPrice", "defaultDuration", "remindMinutes"].includes(key)) {
      value = Math.max(0, parseInt(value) || 0);
    } else {
      value = String(value).trim();
    }
    if (key === "currency" && !value) value = "₪";
    if (key === "payInfo") value = value.slice(0, 300); // גבול האימות ב-normalizeSettings
    settings[key] = value;
    if (!saveSettings()) { render(); return; }
    if (key === "remindMinutes") reschedule();
    render();
    toast("נשמר", "ok");
  }

  function setTheme(theme) {
    settings.theme = theme;
    if (!saveSettings()) { renderSettings(); return; }
    applyTheme();
    renderSettings();
  }

  async function clearAll() {
    if (!await askConfirmation("כל התלמידים, השיעורים וההגדרות יימחקו לצמיתות. ניתן לשחזר רק מקובץ גיבוי קיים.", "מחיקת כל הנתונים")) return;
    students = []; lessons = [];
    settings = Object.assign({}, DEFAULT_SETTINGS);
    if (!save()) { render(); return; }
    applyTheme(); render();
    toast("כל הנתונים נמחקו");
  }

  // ----- מצב כהה -----
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  function resolveTheme() {
    if (settings.theme === "auto") return mq.matches ? "dark" : "light";
    return settings.theme;
  }
  function applyTheme() {
    const t = resolveTheme();
    document.documentElement.setAttribute("data-theme", t);
    const meta = document.getElementById("themeColorMeta");
    if (meta) meta.setAttribute("content", t === "dark" ? "#0f141b" : "#1f2937");
    // ציור מחדש של הגרף כדי שצבעי הטקסט יתעדכנו
    // ציור מחדש של הגרף רק אם מסך הכספים פעיל ולשונית הסיכום פתוחה
    const moneyView = document.getElementById("view-money");
    if (moneyView && moneyView.classList.contains("active") && moneyTab === "income") drawChart();
  }
  mq.addEventListener && mq.addEventListener("change", () => { if (settings.theme === "auto") applyTheme(); });

  // ========== תזכורות / התראות ==========
  const notifSupported = "Notification" in window;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let intervalStarted = false;
  let reminderCheckRunning = false;
  let reminderTimer = 0;

  function notifStatusText() {
    // בלי הגנת notifSupported הגישה ל-Notification זורקת ומרוקנת את כל מסך ההגדרות
    if (!notifSupported) return "הדפדפן הזה לא תומך בהתראות";
    if (Notification.permission === "granted" && pushSupported()) return "מופעל — התראות מגיעות גם כשהאפליקציה סגורה";
    return "הפעילי התראות כדי לקבל תזכורות גם כשהאפליקציה סגורה";
  }
  function notifHelpText() {
    return "כל תזכורת שיעור מופיעה כהתראה בזמן, גם כשהטלפון נעול והאפליקציה סגורה. לשם כך צריך שהאפליקציה תותקן למסך הבית ושההתראות יאושרו. אפשר בנוסף להוסיף את השיעורים ליומן.";
  }

  function initReminders() {
    // סנכרון תזכורות לשרת המייל תמיד — לא תלוי בהרשאת התראות (חשוב באייפון)
    trySyncPush();
    if (notifSupported && Notification.permission === "granted") startInterval();
    // focus + pageshow + visibilitychange יורים יחד בחזרה לאפליקציה — סנכרון אחד מספיק
    let lastResume = 0;
    const resume = () => {
      if (Date.now() - lastResume < 2000) return;
      lastResume = Date.now();
      trySyncPush();
      if (!notifSupported || Notification.permission !== "granted") return;
      startInterval();
      void checkReminders();
      if (document.getElementById("view-settings")?.classList.contains("active")) renderSettings();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); });
  }

  function startInterval() {
    if (intervalStarted) return;
    intervalStarted = true;
    setInterval(() => void checkReminders(), 30 * 1000);
    scheduleNextReminder();
    void checkReminders();
    trySyncPush();
  }

  function scheduleNextReminder() {
    clearTimeout(reminderTimer);
    if (!notifSupported || Notification.permission !== "granted") return;
    const next = nextLessonReminderTimestamp(lessons, new Date(), reminderLeadMinutes(settings.remindMinutes), notified);
    if (next === null) return;
    // ponytail: normal web notifications cannot wake a closed app; this only tightens timing while it is open.
    const delay = Math.min(Math.max(30 * 1000, next - Date.now()), 2147483647);
    reminderTimer = setTimeout(() => void checkReminders(), delay);
  }

  async function enableNotifications() {
    if (isIOS() && !isStandalone()) {
      toast("באייפון: הוסיפי קודם את האפליקציה למסך הבית, פתחי אותה משם ואז הפעילי התראות", "err");
      return;
    }
    if (!notifSupported) { toast("הדפדפן לא תומך בהתראות", "err"); return; }
    if (Notification.permission === "denied") {
      toast("ההתראות חסומות — יש לאפשר בהגדרות הדפדפן", "err");
      return;
    }
    const p = await Notification.requestPermission();
    if (p === "granted") {
      startInterval();
      let pushOk = false, pushErr = "";
      if (pushSupported()) {
        try {
          await enablePush();
          trySyncPush();
          pushOk = true;
        } catch (error) {
          console.warn("Push subscribe failed", error);
          pushErr = `${error?.name || ""}: ${error?.message || error}`;
        }
      }
      if (pushOk) toast("התראות הופעלו — כולל כשהאפליקציה סגורה", "ok");
      else if (pushErr) toast(`ההתראות פועלות רק כשהאפליקציה פתוחה — רישום ברקע נכשל (${pushErr})`, "err");
      else toast("התראות הופעלו (באפליקציה פתוחה)", "ok");
      await testNotification();
    } else {
      toast("ההרשאה לא ניתנה", "err");
    }
    renderSettings();
  }

  async function testNotification() {
    if (!notifSupported || Notification.permission !== "granted") return enableNotifications();
    try {
      await showAppNotification("בדיקת התראה ✓", {
        body: "מצוין — ההתראות עובדות!", icon: "icon-192.png", badge: "icon-192.png"
      });
    } catch (error) {
      console.warn("Could not show test notification", error);
      toast("לא ניתן להציג התראה. בדקי הרשאה בהגדרות הטלפון.", "err");
    }
  }

  async function showAppNotification(title, options) {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      return reg.showNotification(title, { ...options, data: { url: "./" } });
    }
    return new Notification(title, options);
  }

  function reschedule() {
    trySyncPush(); // מייל: תמיד מסנכרן את התזכורות המעודכנות לשרת
    if (notifSupported && Notification.permission === "granted") {
      scheduleNextReminder();
      void checkReminders();
    }
  }

  // סנכרון תזכורות לשרת ה-push — רץ ברקע אחרי כל שמירה, כשלון לא מפריע לאפליקציה.
  // התוצאה נשמרת כדי שמסך ההגדרות יראה אם התראות ברקע באמת עובדות.
  const PUSH_SYNC_KEY = "mt_push_sync";
  function rememberPushSync(state) {
    try { localStorage.setItem(PUSH_SYNC_KEY, JSON.stringify({ state, at: Date.now() })); } catch { /* אין אחסון */ }
    if (document.getElementById("view-settings")?.classList.contains("active")) renderSettings();
  }
  function lastPushSync() {
    try { return JSON.parse(localStorage.getItem(PUSH_SYNC_KEY)); } catch { return null; }
  }
  function trySyncPush() {
    // רץ תמיד — המייל לא תלוי בתמיכת push (חשוב באייפון שאינו מותקן למסך הבית)
    syncPush(lessons, lessonIndex.studentsById, reminderLeadMinutes(settings.remindMinutes))
      .then(state => rememberPushSync(state))
      .catch(error => { rememberPushSync("fail"); console.warn("Push sync failed", error); });
  }

  // שורת סטטוס לתזכורות רקע (מייל) במסך ההגדרות
  function pushStatusHtml() {
    const s = lastPushSync();
    if (!s) return "";
    if (s.state === "ok") {
      const when = new Date(s.at).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
      return `<p class="push-status ok">✓ התזכורות מסונכרנות לשרת ההתראות (עודכן ${when})</p>`;
    }
    return `<p class="push-status err">סנכרון התזכורות נכשל — בדקי חיבור לאינטרנט. ינוסה שוב אוטומטית.</p>`;
  }

  // בדיקה אמיתית של תזכורת כשהאפליקציה סגורה — עוברת דרך השרת (מייל + push אם יש)
  async function testClosedPush() {
    try {
      await sendClosedAppTest(lessons, lessonIndex.studentsById, reminderLeadMinutes(settings.remindMinutes));
      rememberPushSync("ok");
      toast("נשלח! סגרי עכשיו את האפליקציה — ההתראה תגיע תוך 2-7 דקות", "ok");
    } catch (error) {
      console.warn("Closed-app reminder test failed", error);
      rememberPushSync("fail");
      toast("השליחה לשרת נכשלה — בדקי חיבור לאינטרנט", "err");
      renderSettings();
    }
  }

  const NOTIFIED_KEY = "mt_notified_lessons";
  function loadNotified() {
    try {
      const values = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "[]");
      return new Set(Array.isArray(values) ? values : []);
    } catch {
      return new Set();
    }
  }
  const notified = loadNotified();
  function rememberNotification(signature) {
    notified.add(signature);
    const activeSignatures = new Set();
    for (const l of lessons) { activeSignatures.add(reminderSignature(l)); activeSignatures.add(paymentSignature(l)); }
    for (const value of notified) {
      if (!activeSignatures.has(value)) notified.delete(value);
    }
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified])); }
    catch (error) { console.warn("Could not persist reminder history", error); }
  }
  async function checkReminders() {
    if (!notifSupported || Notification.permission !== "granted" || reminderCheckRunning) return;
    reminderCheckRunning = true;
    try {
      const due = dueLessonReminders(lessons, new Date(), reminderLeadMinutes(settings.remindMinutes), notified);
      for (const l of due) {
        const s = studentById(l.studentId);
        await showAppNotification("תזכורת שיעור", {
          tag: `lesson-${l.id}`,
          body: `שיעור עם ${s ? s.name : "תלמיד"} בשעה ${l.time}`,
          icon: "icon-192.png",
          badge: "icon-192.png"
        });
        rememberNotification(reminderSignature(l));
      }
      // תזכורת גבייה: שיעור שהסתיים, סומן כבוצע, אך טרם שולם — רק למחרת ואילך (לא מיד בתום השיעור)
      const duePay = duePaymentReminders(lessons, new Date(), notified, 12 * 60);
      for (const l of duePay) {
        const price = lessonPrice(l);
        if (price > 0) {
          const s = studentById(l.studentId);
          await showAppNotification("תזכורת גבייה", {
            tag: `pay-${l.id}`,
            body: `עדיין לא נגבה תשלום מ${s ? s.name : "תלמיד"} (${cur(price)})`,
            icon: "icon-192.png",
            badge: "icon-192.png"
          });
        }
        rememberNotification(paymentSignature(l));
      }
    } catch (error) {
      console.warn("Could not show lesson reminder", error);
    } finally {
      reminderCheckRunning = false;
      scheduleNextReminder();
    }
  }

  function exportCalendar() {
    const now = Date.now();
    const upcoming = lessonSorted().filter(l => !l.done && new Date(`${l.date}T${l.time || "00:00"}:00`).getTime() >= now);
    if (!upcoming.length) { toast("אין שיעורים עתידיים להוספה ליומן", "err"); return; }
    const content = createLessonsCalendar(upcoming, lessonIndex.studentsById, reminderLeadMinutes(settings.remindMinutes));
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `שיעורים-${todayStr()}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("קובץ היומן מוכן — פתחי אותו ואשרי הוספה", "ok");
  }

  // ========== התקנה (PWA) — כפתור בהגדרות, ללא באנר צף ==========
  let deferredPrompt = null;
  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

  function initInstall() {
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredPrompt = e;
      // מציגים את כפתור ההתקנה במסך ההגדרות אם הוא פתוח
      if (document.getElementById("view-settings").classList.contains("active")) renderSettings();
    });
    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      toast("האפליקציה הותקנה", "ok");
      renderSettings();
    });
  }
  function canInstall() { return !!deferredPrompt && !isStandalone(); }
  async function promptInstall() {
    if (!deferredPrompt) { toast("להתקנה: תפריט הדפדפן → הוספה למסך הבית", "info"); return; }
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    renderSettings();
  }

  // ========== רנדור כללי ==========
  let lastBadgeHtml = null;
  function activeViewName() {
    const active = document.querySelector(".view.active");
    return active ? active.id.replace("view-", "") : "home";
  }
  function renderHeader() {
    const todayLessons = lessonIndex.onDate(todayStr());
    const unpaidCount = lessons.filter(l => l.done && !l.paid && lessonPrice(l) > 0).length;
    const badge = document.getElementById("reminderBadge");
    const parts = [];
    if (todayLessons.length) parts.push(`${icon("bell")} ${todayLessons.length} ${todayLessons.length === 1 ? "שיעור היום" : "שיעורים היום"}`);
    if (unpaidCount) parts.push(`${icon("warn")} ${unpaidCount} לגבייה`);
    // aria-live: כתיבה מחדש של אותו טקסט מכריזה שוב בקורא מסך בכל רנדור. כותבים רק כשהשתנה.
    // ההשוואה מול משתנה ולא מול badge.innerHTML — הדפדפן מנרמל את ה-SVG בקריאה חוזרת.
    const html = parts.join('<span class="badge-sep"></span>');
    if (html !== lastBadgeHtml) { badge.innerHTML = html; lastBadgeHtml = html; }
    badge.classList.toggle("hidden", !parts.length);
  }
  function render(view = activeViewName()) {
    renderHeader();
    if (view === "home") renderHome();
    else if (view === "overview") renderOverview();
    else if (view === "students") renderStudents();
    else if (view === "money") renderMoney();
    else if (view === "settings") renderSettings();
  }

  // ----- אתחול -----
  function handleLaunchParams() {
    const p = new URLSearchParams(location.search);
    if (p.get("view")) go(p.get("view"));
    if (p.get("action") === "new-lesson") openLessonForm();
    // הגעה מהתראת שיעור — פתיחת אותו שיעור (אם עדיין קיים)
    const lessonId = p.get("lesson");
    if (lessonId && lessons.some(l => l.id === lessonId)) openLessonForm(lessonId);
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("service-worker.js").catch(error => {
      console.warn("Service worker registration failed", error);
    });
    // עדכון אוטומטי שקט: כש-SW חדש משתלט (skipWaiting), מרעננים פעם אחת
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  function init() {
    // קודם מחברים בקרות קריטיות שלא תלויות ברינדור — כך שגיאת רינדור לא תשבית אותן
    try { migrate(); } catch (e) { console.error(e); }
    try { maintainSeries(); } catch (e) { console.error(e); }
    initModalControls();
    initInstall();
    registerSW();
    applyTheme();
    try { render(); } catch (e) { console.error(e); }
    if (startupDataError) {
      toast("הנתונים המקומיים לא היו תקינים. האפליקציה נפתחה במצב בטוח — אפשר לשחזר מגיבוי.", "err");
      startupDataError = null;
    }
    initReminders();
    initCalendarSwipe();
    initLessonDrag();
    handleLaunchParams();
  }

  // גרירה חיה של היומן — אצבע או עכבר: התוכן נתפס וזז ממש עם התנועה,
  // והשבוע/חודש השכן נראה נכנס מהצד תוך כדי (כמו יומן גוגל).
  // הלוח LTR: גרירה שמאלה = קדימה, ימינה = אחורה.
  function initCalendarSwipe() {
    attachLiveSwipe(document.getElementById("homeCalendar"),
      () => [document.getElementById("homeCalSlide")].filter(Boolean),
      homeNeighborHtml);
  }

  // התוכן של התקופה השכנה (dir = 1 קדימה / -1 אחורה) — מוצג בזמן הגרירה
  function homeNeighborHtml(dir) {
    const day = selectedDay || todayStr();
    if (homeCalMode === "month") {
      const keep = calMonth;
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + dir, 1);
      const html = monthGridHtml();
      calMonth = keep;
      return html;
    }
    const d = new Date(day + "T00:00");
    d.setDate(d.getDate() + dir * 7);
    const ds = ymd(d);
    return homeCalMode === "week" ? renderWeekGrid(ds) : renderWeekStrip(ds) + renderDayAgenda(ds);
  }

  function attachLiveSwipe(container, slides, neighborHtml) {
    if (!container) return;
    let sx = 0, sy = 0, active = false, locked = false, pid = 0, neighbors = [];
    let trail = []; // דגימות אחרונות (t,x) — לזיהוי הטלה מהירה (flick)

    const parts = () => [...slides(), ...neighbors];
    const setX = (els, x, transition) => els.forEach(el => {
      el.style.transition = transition;
      el.style.transform = `translateX(${x}px)`;
    });

    // מהירות אופקית (px/ms) על בסיס ~100ms האחרונות — הטלה קצרה ומהירה נספרת כהחלפת שבוע
    function velocity() {
      const now = performance.now();
      const recent = trail.filter(p => now - p.t <= 100);
      const a = recent[0], b = recent[recent.length - 1];
      if (!a || !b || b.t - a.t < 15) return 0;
      return (b.x - a.x) / (b.t - a.t);
    }

    // פנלים שכנים משני הצדדים — רואים לאן גוררים עוד לפני השחרור
    function spawnNeighbors() {
      if (!neighborHtml) return;
      const el = slides()[0];
      if (!el) return;
      const w = el.offsetWidth;
      neighbors = [1, -1].map(dir => {
        const p = document.createElement("div");
        p.className = "cal-slide cal-neighbor";
        p.style.cssText = `position:absolute;top:${el.offsetTop}px;left:${el.offsetLeft + dir * w}px;width:${w}px;margin:0;`;
        p.innerHTML = neighborHtml(dir);
        container.appendChild(p);
        const rail = p.querySelector(".week-grid, .day-agenda");
        if (rail) rail.scrollTop = calScroll ?? 7 * (rail.classList.contains("week-grid") ? 48 : 64);
        return p;
      });
    }
    function clearNeighbors() { neighbors.forEach(p => p.remove()); neighbors = []; }

    container.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !e.isPrimary || lessonDragging) return;
      sx = e.clientX; sy = e.clientY;
      active = true; locked = false; pid = e.pointerId;
      trail = [{ t: performance.now(), x: e.clientX }];
    });

    container.addEventListener("pointermove", e => {
      if (!active || e.pointerId !== pid) return;
      if (lessonDragging) { // גרירת שיעור התחילה — משחררים את היומן
        if (locked) { setX(slides(), 0, ""); clearNeighbors(); }
        active = false; locked = false;
        container.classList.remove("cal-dragging");
        return;
      }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      trail.push({ t: performance.now(), x: e.clientX });
      if (trail.length > 12) trail.shift();
      if (!locked) {
        // נעילה מוקדמת ורגישה — תופסים את המחווה לפני שהדפדפן לוקח אותה לגלילה
        if (Math.abs(dx) > 10 && Math.abs(dx) > 1.25 * Math.abs(dy)) {
          locked = true;
          sx = e.clientX; // איפוס נקודת הייחוס — הלוח לא קופץ בפתיחת הגרירה
          container.classList.add("cal-dragging");
          spawnNeighbors();
          try { container.setPointerCapture(pid); } catch { /* מצביע כבר לא פעיל */ }
        } else if (Math.abs(dy) > 12 && Math.abs(dy) > 1.3 * Math.abs(dx)) { active = false; return; }
      }
      if (locked) setX(parts(), e.clientX - sx, "none");
    });

    // סיום מחווה — משותף לשחרור אמיתי ול-cancel של הדפדפן, כדי שגרירה
    // שנקטעת באמצע (למשל כשהדפדפן חוטף את המצביע) עדיין תושלם ולא תיזרק.
    function finish(endX) {
      active = false;
      container.classList.remove("cal-dragging");
      if (!locked) return;
      locked = false;
      // בליעת הקליק שאחרי הגרירה — שלא ייבחר יום בטעות
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
      container.addEventListener("click", swallow, true);
      setTimeout(() => container.removeEventListener("click", swallow, true), 350);
      const els = parts();
      if (!els.length) return;
      const dx = endX - sx;
      const width = container.offsetWidth || 320;
      const v = velocity();
      // החלפה: גרירה של 20% מהרוחב, או הטלה מהירה (flick) גם אם קצרה
      const flick = Math.abs(dx) > 20 && Math.abs(v) > 0.35 && Math.sign(v) === Math.sign(dx);
      if (Math.abs(dx) < Math.min(72, width * 0.2) && !flick) {
        setX(els, 0, "transform .2s ease-out"); // לא מספיק — קפיצה חזרה
        setTimeout(clearNeighbors, 220);
        return;
      }
      const dir = dx < 0 ? 1 : -1; // LTR: שמאלה = קדימה
      setX(els, -dir * width, "transform .18s ease-out");
      setTimeout(() => {
        calShift(dir); // מרנדר מחדש; בבית הפנל השכן כבר הראה את היעד — אין קפיצה
        clearNeighbors();
        if (!neighborHtml) { // בלי פנל שכן — התוכן החדש נכנס מהצד
          const next = slides();
          setX(next, dir * width, "none");
          requestAnimationFrame(() => setX(next, 0, "transform .22s ease-out"));
        }
      }, 180);
    }

    container.addEventListener("pointerup", e => {
      if (!active || e.pointerId !== pid) return;
      finish(e.clientX);
    });

    container.addEventListener("pointercancel", e => {
      if (!active || e.pointerId !== pid) return;
      // ב-cancel הקואורדינטות לא אמינות — מסיימים לפי הדגימה האחרונה שנרשמה
      finish(trail.length ? trail[trail.length - 1].x : sx);
    });
  }

  // ----- גרירת שיעור ביומן: לחיצה ארוכה על שיעור ואז גרירה ליום/שעה אחרים -----
  // בקצה רשת השבוע: השהייה קצרה מדפדפת לשבוע הבא/הקודם — אפשר להעביר שיעור בין שבועות.
  let lessonDragging = false;
  function initLessonDrag() {
    const HOLD_MS = 280, SNAP = 15;
    let drag = null, edgeTimer = 0;

    const snapTime = min => {
      const m = Math.max(0, Math.min(23 * 60 + 45, Math.round(min / SNAP) * SNAP));
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
    const stopScroll = e => e.preventDefault();

    document.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !e.isPrimary || lessonDragging) return;
      const block = e.target.closest(".wg-block, .agenda-block, .lesson-row");
      if (!block || !block.dataset.id) return;
      const sx = e.clientX, sy = e.clientY;
      let holdTimer = 0;
      const cancel = () => {
        clearTimeout(holdTimer);
        document.removeEventListener("pointermove", watch);
        document.removeEventListener("pointerup", cancel);
        document.removeEventListener("pointercancel", cancel);
      };
      const watch = ev => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cancel(); };
      document.addEventListener("pointermove", watch);
      document.addEventListener("pointerup", cancel);
      document.addEventListener("pointercancel", cancel);
      holdTimer = setTimeout(() => { cancel(); startDrag(block, e); }, HOLD_MS);
    });

    function startDrag(block, e0) {
      const l = lessons.find(x => x.id === block.dataset.id);
      if (!l) return;
      lessonDragging = true;
      if (navigator.vibrate) navigator.vibrate(20);
      const r = block.getBoundingClientRect();
      const ghost = block.cloneNode(true);
      ghost.classList.add("drag-ghost");
      Object.assign(ghost.style, {
        left: `${r.left}px`, top: `${r.top}px`, right: "auto",
        width: `${r.width}px`, height: `${r.height}px`
      });
      document.body.appendChild(ghost);
      block.classList.add("drag-src");
      drag = { l, ghost, ox: e0.clientX - r.left, oy: e0.clientY - r.top, from: { date: l.date, time: l.time }, target: null, x: e0.clientX };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      document.addEventListener("touchmove", stopScroll, { passive: false });
    }

    // היעד: עמודת יום ברשת השבוע / ציר השעות של היום (שעה לפי החלק העליון של הבלוק),
    // או יום בלוח החודשי / רצועת השבוע (היום משתנה, השעה נשמרת)
    function targetAt(fx, fy, topY) {
      const el = document.elementFromPoint(fx, fy);
      if (!el) return null;
      const col = el.closest(".wg-col");
      if (col) {
        const startH = Number(col.closest(".week-grid")?.dataset.start || 8);
        return { date: col.dataset.day, time: snapTime(startH * 60 + (topY - col.getBoundingClientRect().top) / 48 * 60) };
      }
      const agenda = el.closest(".day-agenda");
      if (agenda) {
        const startH = Number(agenda.dataset.start || 8);
        return { date: agenda.dataset.day, time: snapTime(startH * 60 + (topY - agenda.getBoundingClientRect().top) / 64 * 60) };
      }
      const dayCell = el.closest(".cal-cell[data-day], .week-day[data-day]");
      if (dayCell) return { date: dayCell.dataset.day, time: drag.l.time };
      return null;
    }

    // הלוח LTR כמו יומן גוגל — קצה ימני = קדימה, שמאלי = אחורה.
    // ברשת שבוע ורצועת יום מדפדף שבוע; בלוח חודשי מדפדף חודש (calShift מודע-מצב).
    function edgeCheck(x) {
      drag.x = x;
      const surface = document.querySelector(".week-grid, .cal-grid, .week-strip");
      const r = surface && surface.getBoundingClientRect();
      const dir = !r ? 0 : x > r.right - 34 ? 1 : x < r.left + 34 ? -1 : 0;
      if (!dir) { clearTimeout(edgeTimer); edgeTimer = 0; return; }
      if (!edgeTimer) edgeTimer = setTimeout(() => { edgeTimer = 0; calShift(dir); if (drag) edgeCheck(drag.x); }, 450);
    }

    function onMove(ev) {
      const topY = ev.clientY - drag.oy;
      drag.ghost.style.left = `${ev.clientX - drag.ox}px`;
      drag.ghost.style.top = `${topY}px`;
      // גרירה לקצה העליון/תחתון של ציר השעות — גוללת אותו כדי להגיע לכל שעה
      const rail = document.querySelector(".week-grid, .day-agenda");
      if (rail) {
        const rr = rail.getBoundingClientRect();
        if (ev.clientY < rr.top + 44) rail.scrollTop -= 14;
        else if (ev.clientY > rr.bottom - 44) rail.scrollTop += 14;
      }
      drag.target = targetAt(ev.clientX, ev.clientY, topY);
      const label = drag.ghost.querySelector(".agenda-time, .time-chip, b");
      if (label && drag.target) label.textContent = drag.target.time;
      edgeCheck(ev.clientX);
    }

    const onUp = () => endDrag(true);
    const onCancel = () => endDrag(false);

    function endDrag(commit) {
      clearTimeout(edgeTimer); edgeTimer = 0;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("touchmove", stopScroll);
      // בליעת הקליק שמגיע אחרי השחרור — שלא ייפתח טופס עריכה
      const swallow = e => { e.stopPropagation(); e.preventDefault(); };
      document.addEventListener("click", swallow, true);
      setTimeout(() => document.removeEventListener("click", swallow, true), 350);
      drag.ghost.remove();
      lessonDragging = false;
      const { l, from, target } = drag;
      drag = null;
      if (commit && target && (target.date !== l.date || target.time !== l.time)) {
        l.date = target.date; l.time = target.time;
        if (!save()) { l.date = from.date; l.time = from.time; render(); return; }
        refreshCalendarSurface();
        toast(`השיעור הועבר ${dayLabelPlain(l.date)} בשעה ${fmtTime(l.time)}`, "ok", {
          label: "ביטול",
          run: () => { l.date = from.date; l.time = from.time; save(); render(); }
        });
      } else {
        refreshCalendarSurface();
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ----- חשיפת פונקציות לממשק -----
  return {
    go, goReminders, setHubOpen, closeModal, renderStudents,
    openStudentForm, openStudentProfile, saveStudentNotes, saveStudent, deleteStudent,
    openLessonForm, saveLesson, deleteLesson, deleteSeriesFuture, deleteStudentFuture, toggleDone,
    confirmLesson, confirmAndRepeat, skipLesson,
    setLessonDate, togglePast, renderStudentPicker, pickStudent, quickAddStudent, toggleAdvanced,
    toggleRepeat, setRecurMode, setRecurInterval, renderFreeSlots, pickFreeSlot, scheduleForStudent, togglePaid,
    calShift, selectCalDay, calToday, setHomeCalMode, quickAddLesson, showMoreLessons,
    setMoneyTab, togglePaymentBox, sendWhatsApp, sendReceipt, sendLessonReminder, repeatLastLesson, markAllPaid, postponeLesson,
    exportData, importData, exportCalendar,
    changeMonth,
    updateSetting, setTheme, clearAll,
    enableNotifications, testNotification, testClosedPush,
    promptInstall
  };
})();

window.App = App;

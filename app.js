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
import { buildLessonIndex, summarizeMonth } from "./src/selectors.js";
import { AppStorage } from "./src/storage.js";
import {
  createLessonsCalendar,
  dueLessonReminders,
  reminderSignature
} from "./src/reminders.js";

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
    `<svg class="${cls || "ic"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;

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
  let calMode = "list";            // list | month
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

  const studentById = id => lessonIndex.studentsById.get(id);
  // מחיר שיעור: עדיפות למחיר ששמור על השיעור, אחרת מחיר התלמיד
  const lessonPrice = l => {
    if (typeof l.price === "number") return l.price;
    const s = studentById(l.studentId);
    return s ? (s.price || 0) : 0;
  };

  // ----- הודעות צפות (toast) -----
  function toast(msg, type = "", action = null) {
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
    }, 3000);
  }

  // ----- ניווט -----
  function go(view) {
    const target = document.getElementById("view-" + view);
    if (!target) return;
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
    return new Promise(resolve => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
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
    const s = id ? studentById(id) : { name: "", parentName: "", phone: "", price: settings.defaultPrice };
    openModal(`
      <h3 id="modalTitle">${id ? "עריכת תלמיד" : "תלמיד חדש"}</h3>
      <label for="f-name">שם התלמיד</label>
      <input id="f-name" value="${escapeHtml(s.name)}" placeholder="לדוגמה: דנה כהן">
      <div id="err-name" class="field-error" style="display:none">נא להזין שם תלמיד</div>
      <label for="f-parent">שם ההורה</label>
      <input id="f-parent" value="${escapeHtml(s.parentName)}" placeholder="לדוגמה: רונית">
      <label for="f-phone">טלפון ההורה (לוואטסאפ)</label>
      <input id="f-phone" type="tel" inputmode="tel" value="${escapeHtml(s.phone)}" placeholder="05X-XXXXXXX">
      <label for="f-price">מחיר לשיעור (${escapeHtml(settings.currency)})</label>
      <input id="f-price" type="number" inputmode="numeric" min="0" value="${escapeHtml(s.price)}" placeholder="120">
      <button class="btn btn-green btn-block" onclick="App.saveStudent('${id || ""}')">שמירה</button>
      ${id ? `
        <button class="btn btn-light btn-block" onclick="App.scheduleForStudent('${id}')">${icon("calendar")} קביעת שיעור לתלמיד זה</button>
        ${studentSummaryLine(id)}
        <button class="btn btn-danger btn-block" onclick="App.deleteStudent('${id}')">מחיקת תלמיד</button>
      ` : ""}
    `);
  }

  // שורת סיכום מהירה בכרטיס תלמיד: שיעורים קרובים + חוב פתוח
  function studentSummaryLine(id) {
    const today = todayStr();
    const upcoming = lessonIndex.forStudent(id).filter(l => l.date >= today && !l.done).length;
    const owed = lessonIndex.unpaidForStudent(id)
      .reduce((sum, l) => sum + lessonPrice(l), 0);
    return `<div class="setting-sub" style="text-align:center;margin:10px 0">
      ${upcoming} שיעורים קרובים${owed > 0 ? ` · חוב פתוח: ${cur(owed)}` : ""}
    </div>`;
  }

  function scheduleForStudent(id) {
    closeModal();
    openLessonForm(null, id);
  }

  function saveStudent(id) {
    const name = document.getElementById("f-name").value.trim();
    if (!name) {
      document.getElementById("err-name").style.display = "block";
      return;
    }
    const phone = document.getElementById("f-phone").value.trim();
    if (phone && !/[0-9]{6,}/.test(phone.replace(/[^0-9]/g, ""))) {
      toast("מספר טלפון לא תקין", "err"); return;
    }
    const data = {
      name,
      parentName: document.getElementById("f-parent").value.trim(),
      phone,
      price: Math.max(0, parseFloat(document.getElementById("f-price").value) || 0)
    };
    const successMessage = id ? "התלמיד עודכן" : "תלמיד נוסף";
    if (id) {
      Object.assign(studentById(id), data);
    } else {
      students.push({ id: uid(), ...data });
    }
    if (!save()) { render(); return; }
    closeModal(); render(); toast(successMessage, "ok");
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
    if (!students.length) { el.innerHTML = `<div class="empty">אין תלמידים עדיין.<br>הוסיפי תלמיד ראשון עם הכפתור שלמעלה.</div>`; return; }
    const searchEl = document.getElementById("studentSearch");
    const q = searchEl ? searchEl.value.trim().toLowerCase() : "";
    const filtered = q
      ? students.filter(s => (s.name + " " + (s.parentName || "")).toLowerCase().includes(q))
      : students;
    if (!filtered.length) { el.innerHTML = `<div class="empty">לא נמצאו תלמידים בחיפוש</div>`; return; }
    el.innerHTML = filtered.map(s => `
      <button type="button" class="item item-button" onclick="App.openStudentForm('${s.id}')" aria-label="פתיחת הפרופיל של ${escapeHtml(s.name)}">
        <span class="item-main">
          <span class="item-title">${escapeHtml(s.name)}</span>
          <span class="item-sub">
            ${escapeHtml(s.parentName) || "ללא איש קשר"} ${s.phone ? "· " + escapeHtml(s.phone) : ""}
          </span>
          <span class="item-meta">
            <span>${lessonIndex.forStudent(s.id).filter(l => l.date >= todayStr() && !l.done).length} שיעורים קרובים</span>
            <span>${cur(s.price)} לשיעור</span>
            ${lessonIndex.unpaidForStudent(s.id).length ? `<span class="meta-due">${lessonIndex.unpaidForStudent(s.id).length} ממתינים לתשלום</span>` : ""}
          </span>
        </span>
        <span class="item-actions"><span class="btn btn-light" aria-hidden="true">${icon("edit")}</span></span>
      </button>
    `).join("");
  }

  // ========== שיעורים / יומן ==========
  function openLessonForm(id, presetStudentId) {
    if (!students.length) { toast("צריך קודם להוסיף לפחות תלמיד אחד", "err"); return; }
    const l = id
      ? lessons.find(x => x.id === id)
      : { studentId: presetStudentId || "", date: selectedDay || todayStr(), time: settings.defaultTime, topic: "", duration: settings.defaultDuration, price: undefined };
    const priceVal = (typeof l.price === "number") ? l.price : "";
    openModal(`
      <h3 id="modalTitle">${id ? "עריכת שיעור" : "שיעור חדש"}</h3>
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
        <div><label for="f-date">תאריך</label><input id="f-date" type="date" value="${l.date}"></div>
        <div><label for="f-time">שעה</label><input id="f-time" type="time" value="${l.time}"></div>
      </div>
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
            <input type="hidden" id="f-recur-mode" value="open">
            <div class="seg-toggle">
              <button type="button" class="seg-btn active" data-recur="open" aria-pressed="true" onclick="App.setRecurMode('open')">כל שבוע, קבוע</button>
              <button type="button" class="seg-btn" data-recur="count" aria-pressed="false" onclick="App.setRecurMode('count')">מספר שבועות</button>
            </div>
            <div id="weeksWrap" style="display:none">
              <label for="f-weeks">למשך כמה שבועות?</label>
              <input id="f-weeks" type="number" value="8" min="2" max="52">
            </div>
          </div>
        ` : ""}
      </div>
      <button class="btn btn-green btn-block" onclick="App.saveLesson('${id || ""}')">שמירה</button>
      ${id && studentById(l.studentId) && studentById(l.studentId).phone
        ? `<button class="btn btn-wa btn-block" onclick="App.sendLessonReminder('${id}')">${icon("whatsapp")} שליחת תזכורת לתלמיד</button>` : ""}
      ${id ? (l.seriesId ? `
        <div class="setting-sub" style="text-align:center;margin:10px 0">${icon("repeat", "ic-sub")} שיעור חוזר שבועי</div>
        <button class="btn btn-danger btn-block" onclick="App.deleteLesson('${id}')">מחיקת שיעור זה בלבד</button>
        <button class="btn btn-danger btn-block" onclick="App.deleteSeriesFuture('${id}')">מחיקת השיעור וכל ההמשך</button>
      ` : `
        <button class="btn btn-danger btn-block" onclick="App.deleteLesson('${id}')">מחיקת שיעור</button>
      `) : ""}
    `);
    renderStudentPicker();
  }

  // בורר תלמיד עם חיפוש (בתוך טופס שיעור)
  function renderStudentPicker() {
    const pick = document.getElementById("studentPicker");
    if (!pick) return;
    const searchEl = document.getElementById("f-student-search");
    const term = (searchEl ? searchEl.value : "").trim().toLowerCase();
    const selId = document.getElementById("f-student").value;
    const matches = students.filter(s => s.name.toLowerCase().includes(term));
    if (!matches.length) { pick.innerHTML = `<div class="picker-empty">לא נמצא תלמיד</div>`; return; }
    pick.innerHTML = matches.map(s => `
      <button type="button" class="picker-row ${s.id === selId ? "sel" : ""}" onclick="App.pickStudent('${s.id}')" aria-pressed="${s.id === selId}">
        <span>${escapeHtml(s.name)}</span>
        ${s.id === selId ? icon("check") : ""}
      </button>`).join("");
  }

  function pickStudent(id) {
    const h = document.getElementById("f-student");
    if (h) h.value = id;
    renderStudentPicker();
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

  function saveLesson(id) {
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
    let successMessage = "";
    if (id) {
      Object.assign(lessons.find(x => x.id === id), data);
      successMessage = "השיעור עודכן";
    } else {
      const repeat = document.getElementById("f-repeat");
      if (repeat && repeat.checked) {
        const mode = document.getElementById("f-recur-mode").value;
        const openEnded = mode === "open";
        const weeks = openEnded
          ? HORIZON_WEEKS
          : Math.max(1, parseInt(document.getElementById("f-weeks").value) || 1);
        const seriesId = uid();
        for (let i = 0; i < weeks; i++) {
          const d = new Date(data.date + "T00:00");
          d.setDate(d.getDate() + i * 7);
          lessons.push({ id: uid(), paid: false, done: false, seriesId, recur: "weekly", openEnded, ...data, date: ymd(d) });
        }
        successMessage = openEnded ? "נקבע שיעור שבועי קבוע" : `נקבעו ${weeks} שיעורים`;
      } else {
        lessons.push({ id: uid(), paid: false, done: false, ...data });
        successMessage = "השיעור נקבע";
      }
    }
    if (!save()) { render(); return; }
    closeModal(); render(); toast(successMessage, "ok");
  }

  function setLessonDate(offset, btn) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const el = document.getElementById("f-date");
    if (el) el.value = ymd(d);
    document.querySelectorAll(".quick-date").forEach(b => b.classList.remove("sel"));
    if (btn) btn.classList.add("sel");
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

  // הארכה אוטומטית של סדרות "כל שבוע" כדי שתמיד יהיו שיעורים עתידיים (תחושת אינסוף)
  function maintainSeries() {
    const horizon = ymd((() => { const d = new Date(); d.setDate(d.getDate() + HORIZON_WEEKS * 7); return d; })());
    const groups = {};
    lessons.forEach(l => { if (l.seriesId && l.openEnded) (groups[l.seriesId] = groups[l.seriesId] || []).push(l); });
    let added = false;
    Object.values(groups).forEach(arr => {
      arr.sort((a, b) => a.date.localeCompare(b.date));
      const last = arr[arr.length - 1];
      const d = new Date(last.date + "T00:00");
      while (true) {
        d.setDate(d.getDate() + 7);
        const ds = ymd(d);
        if (ds > horizon) break;
        lessons.push({
          id: uid(), paid: false, done: false,
          seriesId: last.seriesId, recur: "weekly", openEnded: true,
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
    return `
      <div class="lesson-row ${l.done ? "is-done" : ""} ${isToday ? "is-today" : ""}">
        <button type="button" class="lesson-open" onclick="App.openLessonForm('${l.id}')" aria-label="עריכת שיעור עם ${escapeHtml(s.name)} בשעה ${fmtTime(l.time)}">
          <span class="time-chip">${fmtTime(l.time) || "—"}${l.duration ? `<span class="dur">${l.duration}׳</span>` : ""}</span>
          <span class="lesson-body">
            <span class="lesson-name">${escapeHtml(s.name)}</span>
            ${l.topic ? `<span class="lesson-topic">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</span>` : ""}
          </span>
        </button>
        <button class="lesson-check ${l.done ? "done" : ""}" onclick="App.toggleDone('${l.id}')" aria-label="${l.done ? "ביטול סימון שיעור כבוצע" : "סימון שיעור כבוצע"}" aria-pressed="${l.done}" title="${l.done ? "בוצע" : "סמן כבוצע"}">${icon("check")}</button>
      </div>`;
  }

  function dayGroupHtml(date, dayLessons) {
    const count = dayLessons.length;
    const h = holidayFor(date);
    return `
      <div class="day-group">
        <div class="day-head">
          <span class="day-label">${dayLabel(date)} ${h ? `<span class="holiday-tag">${icon("info", "ic-sub")} ${escapeHtml(h.name)}</span>` : ""}</span>
          <span class="day-count">${count} ${count === 1 ? "שיעור" : "שיעורים"}</span>
        </div>
        <div class="day-lessons">${dayLessons.map(lessonRow).join("")}</div>
      </div>`;
  }

  // ----- מתג רשימה / לוח חודשי -----
  function setCalendarMode(mode) {
    calMode = mode;
    if (mode === "month" && !selectedDay) selectedDay = todayStr();
    document.querySelectorAll(".seg-btn[data-cal]").forEach(b => {
      const active = b.dataset.cal === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    document.getElementById("calendarMonth").classList.toggle("hidden", mode !== "month");
    renderCalendar();
  }

  function calShift(delta) {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + delta, 1);
    renderCalendar();
  }

  function selectCalDay(dateStr) {
    selectedDay = dateStr;
    renderCalendar();
  }

  function calToday() {
    calMonth = new Date();
    selectedDay = todayStr();
    renderCalendar();
  }

  function renderMonthGrid() {
    const grid = document.getElementById("calendarMonth");
    if (calMode !== "month") { grid.classList.add("hidden"); return; }
    grid.classList.remove("hidden");

    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const first = new Date(year, month, 1);
    const startDow = first.getDay(); // 0=ראשון
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const counts = {};
    lessons.forEach(l => { if (l.date.startsWith(monthKey(calMonth))) counts[l.date] = (counts[l.date] || 0) + 1; });

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
      const marker = has
        ? `<span class="cal-count">${counts[ds]}</span>`
        : (h ? '<span class="cal-dot holiday-dot"></span>' : "");
      cells += `<button type="button" class="${cls}" aria-label="${escapeHtml(`${day} ${calMonth.toLocaleDateString("he-IL", { month: "long" })}${title ? `, ${title}` : ""}`)}" onclick="App.selectCalDay('${ds}')">${day}${marker}</button>`;
    }

    grid.innerHTML = `
      <div class="cal-head">
        <button class="cal-nav" aria-label="חודש קודם" onclick="App.calShift(-1)">‹</button>
        <span>${calMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}</span>
        <button class="cal-nav" aria-label="חודש הבא" onclick="App.calShift(1)">›</button>
      </div>
      <button class="btn btn-light btn-block cal-today" onclick="App.calToday()">היום</button>
      <div class="cal-grid">${cells}</div>`;
  }

  function renderCalendar() {
    const el = document.getElementById("lessonsList");
    renderMonthGrid();

    if (calMode === "month") {
      const day = selectedDay || todayStr();
      const h = holidayFor(day);
      const dayLessons = lessonSorted().filter(l => l.date === day);
      const addBtn = `<button class="btn btn-light btn-block" onclick="App.openLessonForm()">${icon("plus")} קביעת שיעור ב-${fmtDate(day)}</button>`;
      el.innerHTML = (h ? `<div class="holiday-banner">${icon("info")} ${escapeHtml(h.name)}</div>` : "") +
        (dayLessons.length
          ? dayGroupHtml(day, dayLessons)
          : `<div class="empty">אין שיעורים ב-${fmtDate(day)}</div>`) +
        addBtn;
      return;
    }

    // מצב רשימה
    const list = lessonSorted();
    if (!list.length) {
      el.innerHTML = `<div class="empty">אין שיעורים ביומן.<br>קבעי שיעור עם הכפתור שלמעלה.</div>`;
      return;
    }
    const today = todayStr();
    const upcoming = list.filter(l => l.date >= today);
    const past = list.filter(l => l.date < today).reverse();

    let html = "";
    if (upcoming.length) {
      groupByDate(upcoming).forEach((ls, date) => { html += dayGroupHtml(date, ls); });
    } else {
      html += `<div class="empty">אין שיעורים קרובים</div>`;
    }
    if (past.length) {
      html += `<button class="past-toggle" onclick="App.togglePast()">${showPast ? "הסתר" : "הצג"} שיעורים שעברו (${past.length})</button>`;
      if (showPast) {
        groupByDate(past).forEach((ls, date) => { html += dayGroupHtml(date, ls); });
      }
    }
    el.innerHTML = html;
  }

  function togglePast() { showPast = !showPast; renderCalendar(); }

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

  function renderHome() {
    document.getElementById("homeGreeting").textContent =
      settings.teacherName ? `שלום ${settings.teacherName}` : "שלום";

    renderOnboard();
    const today = todayStr();
    const todayLessons = lessonIndex.onDate(today);
    const nextLesson = lessonSorted().find(l => l.date >= today && !l.done);
    document.getElementById("todaySummary").innerHTML = `
      <div class="summary-kicker">${new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" })}</div>
      <div class="summary-number"><b>${todayLessons.length}</b><span>${todayLessons.length === 1 ? "שיעור היום" : "שיעורים היום"}</span></div>
      <div class="summary-next">
        ${nextLesson
          ? `${icon("clock")} הבא: <strong>${escapeHtml(studentById(nextLesson.studentId)?.name || "תלמיד")}</strong> · ${dayLabelPlain(nextLesson.date)} · ${fmtTime(nextLesson.time)}`
          : `${icon("checkCircle")} היומן פנוי — אפשר לקבוע שיעור חדש`}
      </div>
      <div class="summary-foot"><span>${students.length} ${students.length === 1 ? "תלמיד פעיל" : "תלמידים פעילים"}</span><span>${lessons.filter(l => l.done && !l.paid).length} ${lessons.filter(l => l.done && !l.paid).length === 1 ? "תשלום פתוח" : "תשלומים פתוחים"}</span></div>
    `;

    const upcoming = lessonSorted().filter(l => l.date >= today && !l.done).slice(0, 5);
    const up = document.getElementById("upcomingLessons");
    up.innerHTML = upcoming.length ? upcoming.map(l => {
      const s = studentById(l.studentId) || { name: "?" };
      const isToday = l.date === today;
      return `<div class="item">
        <button type="button" class="item-main item-main-button" onclick="App.openLessonForm('${l.id}')" aria-label="עריכת שיעור עם ${escapeHtml(s.name)}">
          <span class="item-title">${escapeHtml(s.name)} ${isToday ? '<span class="tag tag-soon">היום</span>' : ""}</span>
          <span class="item-sub">${dateTimeLine(l)}</span>
          ${l.topic ? `<span class="item-note">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</span>` : ""}
        </button>
        <div class="item-actions">
          ${s.phone ? `<button class="btn btn-wa" onclick="App.sendLessonReminder('${l.id}')" aria-label="שליחת תזכורת">${icon("whatsapp")} תזכורת</button>` : ""}
          <button class="lesson-check" onclick="App.toggleDone('${l.id}')" aria-label="סימון כבוצע" aria-pressed="false" title="סמן כבוצע">${icon("check")}</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty">אין שיעורים מתוכננים</div>`;

    const dues = students.map(student => {
      const unpaid = lessonIndex.unpaidForStudent(student.id);
      return {
        student,
        count: unpaid.length,
        owed: unpaid.reduce((sum, lesson) => sum + lessonPrice(lesson), 0)
      };
    }).filter(item => item.count > 0).sort((a, b) => b.owed - a.owed);
    const pa = document.getElementById("paymentAlerts");
    pa.innerHTML = dues.length ? dues.map(({ student, count, owed }) => {
      return `<div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(student.name)} <span class="tag tag-due">${cur(owed)}</span></div>
          <div class="item-sub">${count} ${count === 1 ? "שיעור ממתין" : "שיעורים ממתינים"} לתשלום</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-wa" onclick="App.sendWhatsApp('${student.id}')">${icon("whatsapp")} תזכורת</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty"><span style="color:var(--green)">${icon("checkCircle")}</span> הכול שולם</div>`;

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
  function renderPayments() {
    const el = document.getElementById("paymentsList");
    if (!students.length) {
      el.innerHTML = `<div class="empty">כדי לעקוב אחר תשלומים, צריך קודם להוסיף תלמיד ושיעור.</div>`;
      return;
    }
    const totalUnpaid = lessons.filter(lesson => lesson.done && !lesson.paid);
    const totalOwed = totalUnpaid.reduce((sum, lesson) => sum + lessonPrice(lesson), 0);
    const debtors = students.map(s => {
      const unpaid = lessonIndex.unpaidForStudent(s.id);
      const owed = unpaid.reduce((sum, l) => sum + lessonPrice(l), 0);
      return { student: s, unpaid, owed };
    }).filter(item => item.unpaid.length).sort((a, b) => b.owed - a.owed);

    const queue = debtors.length ? debtors.map(({ student, unpaid, owed }) => `
      <article class="payment-account" aria-labelledby="payment-student-${student.id}">
        <header class="payment-account-head">
          <div>
            <h3 id="payment-student-${student.id}">${escapeHtml(student.name)}</h3>
            <p>${unpaid.length === 1 ? "שיעור אחד ממתין לתשלום" : `${unpaid.length} שיעורים ממתינים לתשלום`}</p>
          </div>
          <div class="payment-account-total" aria-label="יתרת חוב ${cur(owed)}">
            <span>לתשלום</span>
            <strong>${cur(owed)}</strong>
          </div>
        </header>
        <ul class="payment-lessons" aria-label="שיעורים שטרם שולמו">
          ${unpaid.map(l => `
            <li class="payment-lesson">
              <div class="payment-lesson-info">
                <span class="payment-lesson-date">${icon("calendar", "ic-sub")} ${fmtDate(l.date)}</span>
                ${l.topic ? `<span class="payment-lesson-topic">${escapeHtml(l.topic)}</span>` : ""}
              </div>
              <strong class="payment-lesson-price">${cur(lessonPrice(l))}</strong>
              <button class="payment-mark" onclick="App.togglePaid('${l.id}')" aria-label="סימון השיעור של ${escapeHtml(student.name)} מ-${fmtDate(l.date)} בסך ${cur(lessonPrice(l))} כשולם">
                ${icon("check")} <span>סימון כשולם</span>
              </button>
            </li>`).join("")}
        </ul>
        <footer class="payment-actions">
          ${student.phone
            ? `<button class="btn btn-wa" onclick="App.sendWhatsApp('${student.id}')">${icon("whatsapp")} שליחת תזכורת</button>`
            : `<button class="btn btn-light" onclick="App.openStudentForm('${student.id}')">הוספת מספר טלפון</button>`}
          <button class="btn btn-green" onclick="App.markAllPaid('${student.id}')">${icon("check")} סימון ${unpaid.length === 1 ? "השיעור" : "הכול"} כשולם</button>
        </footer>
      </article>
    `).join("") : `
      <div class="payment-empty">
        <span class="payment-empty-icon">${icon("checkCircle")}</span>
        <div><h3>אין תשלומים פתוחים</h3><p>כל השיעורים שבוצעו מסומנים כשולמו.</p></div>
      </div>`;

    const settledStudents = students.length - debtors.length;
    el.innerHTML = `
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
      <div class="payment-queue">${queue}</div>`;
  }

  function togglePaid(id, showUndo = true) {
    const l = lessons.find(x => x.id === id);
    if (!l) return;
    l.paid = !l.paid;
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
    unpaid.forEach(l => l.paid = true);
    if (!save()) { render(); return; }
    render();
    toast("כל השיעורים סומנו כשולמו", "ok", {
      label: "ביטול",
      run: () => {
        const ids = new Set(unpaid.map(lesson => lesson.id));
        lessons.filter(lesson => ids.has(lesson.id)).forEach(lesson => { lesson.paid = false; });
        if (save()) render();
      }
    });
  }

  // ----- וואטסאפ: הודעה מוכנה + קישור לשליחה בלחיצה -----
  // פתיחת וואטסאפ עם הודעה מוכנה. מנרמל מספר ישראלי לפורמט בינלאומי.
  function waOpen(student, msg) {
    if (!student.phone) { toast("לתלמיד אין מספר טלפון. הוסיפי אותו במסך התלמידים.", "err"); return; }
    let phone = student.phone.replace(/[^0-9]/g, "");
    if (phone.startsWith("00")) phone = phone.slice(2);
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    else if (!phone.startsWith("972")) phone = "972" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  // תזכורת תשלום מוכנה לשליחה
  function sendWhatsApp(studentId) {
    const s = studentById(studentId);
    if (!s) return;
    const unpaid = lessonIndex.unpaidForStudent(studentId);
    const owed = unpaid.reduce((sum, l) => sum + lessonPrice(l), 0);
    const greet = s.parentName ? `שלום ${s.parentName},` : "שלום,";
    const msg =
      `${greet}\n` +
      `תזכורת ידידותית לגבי תשלום עבור השיעורים הפרטיים של ${s.name}.\n` +
      `סה"כ ${unpaid.length} שיעורים שטרם שולמו, בסך ${owed} ${settings.currency}.\n` +
      `תודה רבה!`;
    waOpen(s, msg);
  }

  // תזכורת שיעור מוכנה לשליחה לתלמיד/הורה
  function sendLessonReminder(lessonId) {
    const l = lessons.find(x => x.id === lessonId);
    if (!l) return;
    const s = studentById(l.studentId);
    if (!s) return;
    const greet = s.parentName ? `שלום ${s.parentName},` : "שלום,";
    const when = dayLabelPlain(l.date);
    const msg =
      `${greet}\n` +
      `תזכורת לשיעור של ${s.name} ${when} בשעה ${l.time}.` +
      (l.topic ? `\nנושא: ${l.topic}.` : "") +
      `\nנתראה!`;
    waOpen(s, msg);
  }

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
    toast("הגיבוי הורד", "ok");
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

    const breakdown = perStudent.length ? `
      <h3>פירוט לפי תלמיד</h3>
      <div class="list">
        ${perStudent.map(x => `
          <div class="item">
            <div class="item-main">
              <div class="item-title">${escapeHtml(x.student.name)}</div>
              <div class="item-sub">${x.count} שיעורים · התקבל ${cur(x.earned)}${x.pending > 0 ? ` · <span style="color:var(--red)">חוב ${cur(x.pending)}</span>` : ""}</div>
            </div>
            <div class="item-actions"><b style="font-size:1.05rem">${cur(x.earned + x.pending)}</b></div>
          </div>`).join("")}
      </div>` : "";

    document.getElementById("incomeSummary").innerHTML = `
      <div class="card summary-card">
        <div>שיעורים שבוצעו: <b>${monthLessons.length}</b></div>
        <div>התקבל בפועל: <b>${cur(earned)}</b></div>
        <div>ממתין לתשלום: <b>${cur(pending)}</b></div>
        <div style="font-size:1.2rem;margin-top:6px">סה"כ החודש: <b>${cur(earned + pending)}</b></div>
      </div>
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
      const grad = ctx.createLinearGradient(0, y, 0, H - 25);
      grad.addColorStop(0, m.current ? "#f59e0b" : "#d97706");
      grad.addColorStop(1, m.current ? "#d97706" : "#b45309");
      ctx.fillStyle = grad;
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
    body.innerHTML = `
      <div class="settings-group">
        <div class="group-title">כללי</div>
        <div class="setting-row">
          <div><label class="setting-label" for="set-name">שם המורה</label><div class="setting-sub">יופיע בברכה במסך הבית</div></div>
          <input type="text" id="set-name" value="${escapeHtml(settings.teacherName)}" placeholder="שמך" onchange="App.updateSetting('teacherName', this.value)">
        </div>
        <div class="setting-row">
          <div><label class="setting-label" for="set-cur">מטבע</label></div>
          <input type="text" id="set-cur" value="${escapeHtml(settings.currency)}" maxlength="3" onchange="App.updateSetting('currency', this.value)">
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">ברירות מחדל לשיעור</div>
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

      <div class="settings-group">
        <div class="group-title">התראות</div>
        <div class="setting-row">
          <div><div class="setting-label">תזכורת לפני שיעור</div><div class="setting-sub">${notifStatusText()}</div></div>
          <input type="number" inputmode="numeric" min="0" value="${settings.remindMinutes}" onchange="App.updateSetting('remindMinutes', this.value)" aria-label="דקות לפני שיעור">
        </div>
        <div class="card" style="margin-top:10px">
          ${notifSupported && Notification.permission === "granted"
            ? `<button class="btn btn-light btn-block" onclick="App.testNotification()">${icon("bell")} שליחת התראת בדיקה</button>`
            : `<button class="btn btn-green btn-block" onclick="App.enableNotifications()">${icon("bell")} הפעלת התראות בטלפון</button>`}
          <button class="btn btn-light btn-block" onclick="App.exportCalendar()">${icon("calendar")} הוספת השיעורים ליומן הטלפון</button>
          <div class="setting-sub" style="margin-top:8px">${notifHelpText()}</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">מראה</div>
        <div class="setting-row">
          <div><div class="setting-label">ערכת נושא</div></div>
          <div class="theme-seg">
            <button class="${settings.theme === "auto" ? "active" : ""}" aria-pressed="${settings.theme === "auto"}" onclick="App.setTheme('auto')">אוטומטי</button>
            <button class="${settings.theme === "light" ? "active" : ""}" aria-pressed="${settings.theme === "light"}" onclick="App.setTheme('light')">בהיר</button>
            <button class="${settings.theme === "dark" ? "active" : ""}" aria-pressed="${settings.theme === "dark"}" onclick="App.setTheme('dark')">כהה</button>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">התקנה</div>
        <div class="card">
          ${isStandalone()
            ? `<div class="setting-sub" style="text-align:center"><span style="color:var(--green)">${icon("checkCircle")}</span> האפליקציה מותקנת</div>`
            : canInstall()
              ? `<button class="btn btn-green btn-block" onclick="App.promptInstall()">התקנת האפליקציה למסך הבית</button>`
              : `<div class="setting-sub" style="text-align:center">להתקנה: פתחי את תפריט הדפדפן ובחרי <b>"הוספה למסך הבית"</b></div>`}
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">נתונים</div>
        <div class="card">
          <button class="btn btn-light btn-block" onclick="App.exportData()">ייצוא גיבוי לקובץ</button>
          <button class="btn btn-light btn-block" onclick="document.getElementById('importFile').click()">שחזור מקובץ גיבוי</button>
          <button class="btn btn-danger btn-block" onclick="App.clearAll()">מחיקת כל הנתונים</button>
        </div>
        <div class="setting-sub" style="margin-top:8px;text-align:center">המורה שלי · גרסה ${APP_VERSION}</div>
      </div>
    `;
  }

  function updateSetting(key, value) {
    if (["defaultPrice", "defaultDuration", "remindMinutes"].includes(key)) {
      value = Math.max(0, parseInt(value) || 0);
    } else {
      value = String(value).trim();
    }
    if (key === "currency" && !value) value = "₪";
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

  function notifStatusText() {
    if (isIOS() && !isStandalone()) return "כדי לקבל התראות באייפון יש להתקין את האפליקציה למסך הבית";
    if (!notifSupported) return "הדפדפן לא תומך בהתראות";
    if (Notification.permission === "granted") return "מופעל — ההתראה תישלח כשהאפליקציה פעילה";
    if (Notification.permission === "denied") return "חסום — יש לאפשר בהגדרות הדפדפן";
    return "כבוי — לחצי 'הפעלת התראות'";
  }
  function notifHelpText() {
    return "לתזכורת אמינה גם כשהאפליקציה סגורה, הוסיפי את השיעורים ליומן הטלפון. כל אירוע כולל התראה לפי מספר הדקות שבחרת.";
  }

  function initReminders() {
    if (notifSupported && Notification.permission === "granted") startInterval();
    const resume = () => {
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
    void checkReminders();
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
      toast("התראות הופעלו", "ok");
      startInterval();
      await testNotification();
    } else {
      toast("ההרשאה לא ניתנה", "err");
    }
    renderSettings();
  }

  async function testNotification() {
    if (Notification.permission !== "granted") return enableNotifications();
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
    if (notifSupported && Notification.permission === "granted") void checkReminders();
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
    const activeSignatures = new Set(lessons.map(reminderSignature));
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
        await showAppNotification("תזכורת שיעור 📚", {
          tag: `lesson-${l.id}`,
          body: `שיעור עם ${s ? s.name : "תלמיד"} בשעה ${l.time}`,
          icon: "icon-192.png",
          badge: "icon-192.png"
        });
        rememberNotification(reminderSignature(l));
      }
    } catch (error) {
      console.warn("Could not show lesson reminder", error);
    } finally {
      reminderCheckRunning = false;
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
  function activeViewName() {
    const active = document.querySelector(".view.active");
    return active ? active.id.replace("view-", "") : "home";
  }
  function renderHeader() {
    const todayLessons = lessonIndex.onDate(todayStr());
    const badge = document.getElementById("reminderBadge");
    if (todayLessons.length) {
      badge.innerHTML = `${icon("bell")} ${todayLessons.length} ${todayLessons.length === 1 ? "שיעור היום" : "שיעורים היום"}`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
  function render(view = activeViewName()) {
    renderHeader();
    if (view === "home") renderHome();
    else if (view === "students") renderStudents();
    else if (view === "calendar") renderCalendar();
    else if (view === "money") renderMoney();
    else if (view === "settings") renderSettings();
  }

  // ----- אתחול -----
  function handleLaunchParams() {
    const p = new URLSearchParams(location.search);
    if (p.get("view")) go(p.get("view"));
    if (p.get("action") === "new-lesson") openLessonForm();
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
    handleLaunchParams();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ----- חשיפת פונקציות לממשק -----
  return {
    go, closeModal, renderStudents,
    openStudentForm, saveStudent, deleteStudent,
    openLessonForm, saveLesson, deleteLesson, deleteSeriesFuture, toggleDone,
    setLessonDate, togglePast, renderStudentPicker, pickStudent, toggleAdvanced,
    toggleRepeat, setRecurMode, scheduleForStudent, togglePaid,
    setCalendarMode, calShift, selectCalDay, calToday,
    setMoneyTab, sendWhatsApp, sendLessonReminder, markAllPaid,
    exportData, importData, exportCalendar,
    changeMonth,
    updateSetting, setTheme, clearAll,
    enableNotifications, testNotification,
    promptInstall
  };
})();

window.App = App;

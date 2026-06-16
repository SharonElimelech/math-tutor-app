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
  const DB = {
    load(key, def) {
      try { const v = JSON.parse(localStorage.getItem("mt_" + key)); return v ?? def; }
      catch { return def; }
    },
    save(key, val) {
      try { localStorage.setItem("mt_" + key, JSON.stringify(val)); }
      catch (e) { toast("שמירה נכשלה — אחסון מלא?", "err"); }
    }
  };

  const DATA_VERSION = 2;
  const DEFAULT_SETTINGS = {
    teacherName: "",
    currency: "₪",
    defaultPrice: 120,
    defaultTime: "16:00",
    defaultDuration: 60,
    theme: "auto",        // auto | light | dark
    remindMinutes: 30
  };

  let students = DB.load("students", []);
  let lessons  = DB.load("lessons", []);
  let settings = Object.assign({}, DEFAULT_SETTINGS, DB.load("settings", {}));

  let viewMonth = new Date();      // החודש שמוצג בסיכום הכנסות
  let calMonth  = new Date();      // החודש שמוצג בלוח החודשי
  let selectedDay = null;          // יום נבחר בלוח החודשי
  let calMode = "list";            // list | month
  let moneyTab = "payments";       // payments | income
  let showPast = false;

  // ----- מיגרציית נתונים -----
  function migrate() {
    const stored = DB.load("version", 1);
    let changed = false;
    if (stored < 2) {
      lessons.forEach(l => {
        if (typeof l.paid !== "boolean") l.paid = false;
        if (typeof l.done !== "boolean") l.done = false;
        if (typeof l.duration !== "number") l.duration = DEFAULT_SETTINGS.defaultDuration;
      });
      changed = true;
    }
    if (changed) { DB.save("lessons", lessons); }
    DB.save("version", DATA_VERSION);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const save = () => { DB.save("students", students); DB.save("lessons", lessons); };
  const saveSettings = () => DB.save("settings", settings);

  // ----- עזרי תאריך וכסף -----
  const fmtDate = d => new Date(d).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
  const fmtTime = t => t || "";
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = () => ymd(new Date());
  const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const cur = n => `${settings.currency}${n}`;
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const studentById = id => students.find(s => s.id === id);
  // מחיר שיעור: עדיפות למחיר ששמור על השיעור, אחרת מחיר התלמיד
  const lessonPrice = l => {
    if (typeof l.price === "number") return l.price;
    const s = studentById(l.studentId);
    return s ? (s.price || 0) : 0;
  };

  // ----- חגי ישראל (לוח עברי דרך Intl, ללא ספריות) -----
  const HEB_FMT = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long" });
  function hebParts(date) {
    let month = "", day = 0;
    for (const p of HEB_FMT.formatToParts(date)) {
      if (p.type === "month") month = p.value;
      if (p.type === "day") day = parseInt(p.value);
    }
    return { month, day };
  }
  const holidayCache = new Map();
  function holidayFor(dateStr) {
    if (holidayCache.has(dateStr)) return holidayCache.get(dateStr);
    const { month: m, day } = hebParts(new Date(dateStr + "T00:00"));
    let h = null;
    if (m === "Tishri") {
      if (day === 1 || day === 2) h = { name: "ראש השנה", chag: true };
      else if (day === 3) h = { name: "צום גדליה" };
      else if (day === 10) h = { name: "יום כיפור", chag: true };
      else if (day === 15) h = { name: "סוכות", chag: true };
      else if (day >= 16 && day <= 20) h = { name: "חול המועד סוכות" };
      else if (day === 21) h = { name: "הושענא רבה" };
      else if (day === 22) h = { name: "שמחת תורה", chag: true };
    } else if ((m === "Kislev" && day >= 25) || (m === "Tevet" && day <= 2)) {
      h = { name: "חנוכה" };
    } else if (m === "Tevet" && day === 10) {
      h = { name: "צום עשרה בטבת" };
    } else if (m === "Shevat" && day === 15) {
      h = { name: "ט״ו בשבט" };
    } else if (m === "Adar" || m === "Adar II") {
      if (day === 13) h = { name: "תענית אסתר" };
      else if (day === 14) h = { name: "פורים", chag: true };
      else if (day === 15) h = { name: "שושן פורים" };
    } else if (m === "Nisan") {
      if (day === 15) h = { name: "פסח", chag: true };
      else if (day >= 16 && day <= 20) h = { name: "חול המועד פסח" };
      else if (day === 21) h = { name: "שביעי של פסח", chag: true };
      else if (day === 27) h = { name: "יום השואה" };
    } else if (m === "Iyar") {
      if (day === 4) h = { name: "יום הזיכרון" };
      else if (day === 5) h = { name: "יום העצמאות", chag: true };
      else if (day === 18) h = { name: "ל״ג בעומר" };
      else if (day === 28) h = { name: "יום ירושלים" };
    } else if (m === "Sivan" && day === 6) {
      h = { name: "שבועות", chag: true };
    } else if (m === "Tammuz" && day === 17) {
      h = { name: "צום י״ז בתמוז" };
    } else if (m === "Av" && day === 9) {
      h = { name: "תשעה באב" };
    }
    holidayCache.set(dateStr, h);
    return h;
  }

  // ----- הודעות צפות (toast) -----
  function toast(msg, type = "") {
    const wrap = document.getElementById("toastWrap");
    if (!wrap) return alert(msg);
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    const ico = type === "ok" ? "checkCircle" : type === "err" ? "warn" : "info";
    el.innerHTML = icon(ico) + "<span>" + escapeHtml(msg) + "</span>";
    wrap.appendChild(el);
    setTimeout(() => {
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
    document.querySelectorAll(".nav-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.view === view));
    render();
    if (view === "money") applyMoneyTab();
    window.scrollTo(0, 0);
  }

  // ----- מודאל -----
  function openModal(html) {
    document.getElementById("modalBody").innerHTML = html;
    document.getElementById("modal").classList.remove("hidden");
  }
  function closeModal() {
    document.getElementById("modal").classList.add("hidden");
  }

  // ========== תלמידים ==========
  function openStudentForm(id) {
    const s = id ? studentById(id) : { name: "", parentName: "", phone: "", price: settings.defaultPrice };
    openModal(`
      <h3>${id ? "עריכת תלמיד" : "תלמיד חדש"}</h3>
      <label>שם התלמיד</label>
      <input id="f-name" value="${escapeHtml(s.name)}" placeholder="לדוגמה: דנה כהן">
      <div id="err-name" class="field-error" style="display:none">נא להזין שם תלמיד</div>
      <label>שם ההורה</label>
      <input id="f-parent" value="${escapeHtml(s.parentName)}" placeholder="לדוגמה: רונית">
      <label>טלפון ההורה (לוואטסאפ)</label>
      <input id="f-phone" type="tel" inputmode="tel" value="${escapeHtml(s.phone)}" placeholder="05X-XXXXXXX">
      <label>מחיר לשיעור (${escapeHtml(settings.currency)})</label>
      <input id="f-price" type="number" inputmode="numeric" min="0" value="${escapeHtml(s.price)}" placeholder="120">
      <button class="btn btn-green btn-block" onclick="App.saveStudent('${id || ""}')">שמירה</button>
      ${id ? `<button class="btn btn-danger btn-block" onclick="App.deleteStudent('${id}')">מחיקת תלמיד</button>` : ""}
    `);
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
    if (id) {
      Object.assign(studentById(id), data);
      toast("התלמיד עודכן", "ok");
    } else {
      students.push({ id: uid(), ...data });
      toast("תלמיד נוסף", "ok");
    }
    save(); closeModal(); render();
  }

  function deleteStudent(id) {
    if (!confirm("למחוק את התלמיד וכל השיעורים שלו?")) return;
    students = students.filter(s => s.id !== id);
    lessons = lessons.filter(l => l.studentId !== id);
    save(); closeModal(); render();
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
      <div class="item" onclick="App.openStudentForm('${s.id}')">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.name)}</div>
          <div class="item-sub">
            הורה: ${escapeHtml(s.parentName) || "—"} ${s.phone ? "· " + escapeHtml(s.phone) : ""}<br>
            ${cur(s.price)} לשיעור
          </div>
        </div>
        <div class="item-actions"><span class="btn btn-light">${icon("edit")}</span></div>
      </div>
    `).join("");
  }

  // ========== שיעורים / יומן ==========
  function openLessonForm(id) {
    if (!students.length) { toast("צריך קודם להוסיף לפחות תלמיד אחד", "err"); return; }
    const l = id
      ? lessons.find(x => x.id === id)
      : { studentId: students[0].id, date: selectedDay || todayStr(), time: settings.defaultTime, topic: "", duration: settings.defaultDuration, price: undefined };
    const priceVal = (typeof l.price === "number") ? l.price : "";
    openModal(`
      <h3>${id ? "עריכת שיעור" : "שיעור חדש"}</h3>
      <label>תלמיד</label>
      <input id="f-student-search" placeholder="חיפוש תלמיד..." autocomplete="off" oninput="App.renderStudentPicker()">
      <input type="hidden" id="f-student" value="${l.studentId}">
      <div id="studentPicker" class="student-picker"></div>
      <label>בחירה מהירה</label>
      <div class="quick-dates">
        <button type="button" class="quick-date" onclick="App.setLessonDate(0,this)">היום</button>
        <button type="button" class="quick-date" onclick="App.setLessonDate(1,this)">מחר</button>
        <button type="button" class="quick-date" onclick="App.setLessonDate(7,this)">בעוד שבוע</button>
      </div>
      <div class="row">
        <div><label>תאריך</label><input id="f-date" type="date" value="${l.date}"></div>
        <div><label>שעה</label><input id="f-time" type="time" value="${l.time}"></div>
      </div>
      <label>נושא / הערות (לא חובה)</label>
      <input id="f-topic" value="${escapeHtml(l.topic || "")}" placeholder="לדוגמה: גיאומטריה - משפט פיתגורס">

      <button type="button" class="adv-toggle" onclick="App.toggleAdvanced(this)">
        עוד אפשרויות (משך, מחיר${!id ? ", חזרה" : ""}) ${icon("chevron", "ic")}
      </button>
      <div id="advWrap" style="display:none">
        <div class="row">
          <div><label>משך (דקות)</label><input id="f-duration" type="number" inputmode="numeric" min="0" step="15" value="${l.duration ?? settings.defaultDuration}"></div>
          <div><label>מחיר לשיעור זה (${escapeHtml(settings.currency)})</label><input id="f-price" type="number" inputmode="numeric" min="0" value="${priceVal}" placeholder="ברירת מחדל"></div>
        </div>
        ${!id ? `
          <div class="checkbox-row">
            <input type="checkbox" id="f-repeat" onchange="document.getElementById('repeatWrap').style.display=this.checked?'block':'none'">
            <label for="f-repeat">שיעור חוזר כל שבוע</label>
          </div>
          <div id="repeatWrap" style="display:none">
            <label>למשך כמה שבועות?</label>
            <input id="f-weeks" type="number" value="8" min="2" max="52">
          </div>
        ` : ""}
      </div>
      <button class="btn btn-green btn-block" onclick="App.saveLesson('${id || ""}')">שמירה</button>
      ${id ? `<button class="btn btn-danger btn-block" onclick="App.deleteLesson('${id}')">מחיקת שיעור</button>` : ""}
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
      <div class="picker-row ${s.id === selId ? "sel" : ""}" onclick="App.pickStudent('${s.id}')">
        <span>${escapeHtml(s.name)}</span>
        ${s.id === selId ? icon("check") : ""}
      </div>`).join("");
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
    if (!data.date) { toast("נא לבחור תאריך", "err"); return; }
    if (id) {
      Object.assign(lessons.find(x => x.id === id), data);
      toast("השיעור עודכן", "ok");
    } else {
      const repeat = document.getElementById("f-repeat");
      const weeks = (repeat && repeat.checked)
        ? Math.max(1, parseInt(document.getElementById("f-weeks").value) || 1)
        : 1;
      for (let i = 0; i < weeks; i++) {
        const d = new Date(data.date + "T00:00");
        d.setDate(d.getDate() + i * 7);
        lessons.push({ id: uid(), paid: false, done: false, ...data, date: ymd(d) });
      }
      toast(weeks > 1 ? `נקבעו ${weeks} שיעורים` : "השיעור נקבע", "ok");
    }
    save(); closeModal(); render();
  }

  function setLessonDate(offset, btn) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const el = document.getElementById("f-date");
    if (el) el.value = ymd(d);
    document.querySelectorAll(".quick-date").forEach(b => b.classList.remove("sel"));
    if (btn) btn.classList.add("sel");
  }

  function deleteLesson(id) {
    if (!confirm("למחוק את השיעור?")) return;
    lessons = lessons.filter(l => l.id !== id);
    save(); closeModal(); render();
    toast("השיעור נמחק");
  }

  function toggleDone(id) {
    const l = lessons.find(x => x.id === id);
    l.done = !l.done;
    save(); render();
  }

  function lessonSorted() {
    return [...lessons].sort((a, b) =>
      (a.date + a.time).localeCompare(b.date + b.time));
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
        <div class="time-chip" onclick="App.openLessonForm('${l.id}')">${fmtTime(l.time) || "—"}${l.duration ? `<span class="dur">${l.duration}׳</span>` : ""}</div>
        <div class="lesson-body" onclick="App.openLessonForm('${l.id}')">
          <div class="lesson-name">${escapeHtml(s.name)}</div>
          ${l.topic ? `<div class="lesson-topic">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</div>` : ""}
        </div>
        <button class="lesson-check ${l.done ? "done" : ""}" onclick="App.toggleDone('${l.id}')" title="${l.done ? "בוצע" : "סמן כבוצע"}">${icon("check")}</button>
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
    document.querySelectorAll(".seg-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.cal === mode));
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
      const dot = h ? '<span class="cal-dot holiday-dot"></span>' : (has ? '<span class="cal-dot"></span>' : "");
      cells += `<div class="${cls}"${title ? ` title="${escapeHtml(title)}"` : ""} onclick="App.selectCalDay('${ds}')">${day}${dot}</div>`;
    }

    grid.innerHTML = `
      <div class="cal-head">
        <button class="cal-nav" onclick="App.calShift(-1)">‹</button>
        <span>${calMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" })}</span>
        <button class="cal-nav" onclick="App.calShift(1)">›</button>
      </div>
      <div class="cal-grid">${cells}</div>`;
  }

  function renderCalendar() {
    const el = document.getElementById("lessonsList");
    renderMonthGrid();

    if (calMode === "month") {
      const day = selectedDay || todayStr();
      const h = holidayFor(day);
      const dayLessons = lessonSorted().filter(l => l.date === day);
      el.innerHTML = dayLessons.length
        ? dayGroupHtml(day, dayLessons)
        : (h ? `<div class="holiday-banner">${icon("info")} ${escapeHtml(h.name)}</div>` : "") +
          `<div class="empty">אין שיעורים ב-${fmtDate(day)}</div>`;
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
    const todayLessons = lessons.filter(l => l.date === today);
    document.getElementById("todaySummary").innerHTML = `
      <div>היום: <b>${todayLessons.length}</b> שיעורים</div>
      <div>סה"כ תלמידים: <b>${students.length}</b></div>
    `;

    const upcoming = lessonSorted().filter(l => l.date >= today && !l.done).slice(0, 5);
    const up = document.getElementById("upcomingLessons");
    up.innerHTML = upcoming.length ? upcoming.map(l => {
      const s = studentById(l.studentId) || { name: "?" };
      const isToday = l.date === today;
      return `<div class="item" onclick="App.openLessonForm('${l.id}')">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.name)} ${isToday ? '<span class="tag tag-soon">היום</span>' : ""}</div>
          <div class="item-sub">${dateTimeLine(l)}</div>
          ${l.topic ? `<div class="item-note">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</div>` : ""}
        </div>
      </div>`;
    }).join("") : `<div class="empty">אין שיעורים מתוכננים</div>`;

    const dues = lessons.filter(l => l.done && !l.paid);
    const pa = document.getElementById("paymentAlerts");
    pa.innerHTML = dues.length ? dues.map(l => {
      const s = studentById(l.studentId) || { name: "?" };
      return `<div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.name)} <span class="tag tag-due">${cur(lessonPrice(l))}</span></div>
          <div class="item-sub">שיעור מ-${fmtDate(l.date)} · ממתין לתשלום</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-wa" onclick="App.sendWhatsApp('${l.studentId}')">${icon("whatsapp")} שליחה</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty"><span style="color:var(--green)">${icon("checkCircle")}</span> הכול שולם</div>`;

    const badge = document.getElementById("reminderBadge");
    if (todayLessons.length) {
      badge.innerHTML = `${icon("bell")} ${todayLessons.length} שיעורים היום`;
      badge.classList.remove("hidden");
    } else { badge.classList.add("hidden"); }
  }

  // ========== כספים: מעבר בין תשלומים לסיכום ==========
  function applyMoneyTab() {
    document.querySelectorAll(".seg-btn[data-money]").forEach(b =>
      b.classList.toggle("active", b.dataset.money === moneyTab));
    document.getElementById("money-payments").classList.toggle("hidden", moneyTab !== "payments");
    document.getElementById("money-income").classList.toggle("hidden", moneyTab !== "income");
    if (moneyTab === "income") drawChart();
  }
  function setMoneyTab(tab) {
    moneyTab = tab;
    applyMoneyTab();
  }

  // ========== תשלומים ==========
  function renderPayments() {
    const el = document.getElementById("paymentsList");
    if (!students.length) { el.innerHTML = `<div class="empty">אין נתונים</div>`; return; }
    el.innerHTML = students.map(s => {
      const sl = lessons.filter(l => l.studentId === s.id && l.done);
      const unpaid = sl.filter(l => !l.paid);
      const owed = unpaid.reduce((sum, l) => sum + lessonPrice(l), 0);
      return `
        <div class="card">
          <div class="item" style="box-shadow:none;padding:0;border:none;">
            <div class="item-main">
              <div class="item-title">${escapeHtml(s.name)}</div>
              <div class="item-sub">
                ${sl.length} שיעורים בוצעו · ${unpaid.length} לא שולמו
                ${owed > 0 ? `<br><span class="tag tag-due">חוב: ${cur(owed)}</span>` : `<br><span class="tag tag-paid">הכול שולם</span>`}
              </div>
            </div>
          </div>
          ${unpaid.length ? `
            <button class="btn btn-wa btn-block" onclick="App.sendWhatsApp('${s.id}')">${icon("whatsapp")} תזכורת תשלום בוואטסאפ (${cur(owed)})</button>
            <button class="btn btn-green btn-block" onclick="App.markAllPaid('${s.id}')">${icon("check")} סימון הכול כשולם</button>
          ` : ""}
        </div>`;
    }).join("");
  }

  function markAllPaid(studentId) {
    lessons.filter(l => l.studentId === studentId && l.done && !l.paid)
      .forEach(l => l.paid = true);
    save(); render();
    toast("סומן כשולם", "ok");
  }

  // ----- וואטסאפ: הודעה מוכנה + קישור לשליחה בלחיצה -----
  function sendWhatsApp(studentId) {
    const s = studentById(studentId);
    if (!s) return;
    if (!s.phone) { toast("לתלמיד אין מספר טלפון. הוסיפי אותו במסך התלמידים.", "err"); return; }

    const unpaid = lessons.filter(l => l.studentId === studentId && l.done && !l.paid);
    const owed = unpaid.reduce((sum, l) => sum + lessonPrice(l), 0);
    const greet = s.parentName ? `שלום ${s.parentName},` : "שלום,";
    const msg =
      `${greet}\n` +
      `תזכורת ידידותית לגבי תשלום עבור השיעורים הפרטיים של ${s.name}.\n` +
      `סה"כ ${unpaid.length} שיעורים שטרם שולמו, בסך ${owed} ${settings.currency}.\n` +
      `תודה רבה!`;

    let phone = s.phone.replace(/[^0-9]/g, "");
    if (phone.startsWith("00")) phone = phone.slice(2);
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    else if (!phone.startsWith("972")) phone = "972" + phone;

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  }

  // ========== גיבוי ושחזור ==========
  function exportData() {
    const data = { students, lessons, settings, exportedAt: new Date().toISOString(), version: DATA_VERSION };
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
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data.students) || !Array.isArray(data.lessons))
          throw new Error("מבנה קובץ לא תקין");
        if (!confirm("שחזור יחליף את כל הנתונים הקיימים. להמשיך?")) { event.target.value = ""; return; }
        students = data.students;
        lessons = data.lessons;
        if (data.settings) settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
        save(); saveSettings(); applyTheme(); render();
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

    const monthLessons = lessons.filter(l => l.date.startsWith(key) && l.done);
    let earned = 0, pending = 0;
    monthLessons.forEach(l => {
      const price = lessonPrice(l);
      if (l.paid) earned += price; else pending += price;
    });

    document.getElementById("incomeSummary").innerHTML = `
      <div class="card summary-card">
        <div>שיעורים שבוצעו: <b>${monthLessons.length}</b></div>
        <div>התקבל בפועל: <b>${cur(earned)}</b></div>
        <div>ממתין לתשלום: <b>${cur(pending)}</b></div>
        <div style="font-size:1.2rem;margin-top:6px">סה"כ החודש: <b>${cur(earned + pending)}</b></div>
      </div>`;

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
          <div><div class="setting-label">שם המורה</div><div class="setting-sub">יופיע בברכה במסך הבית</div></div>
          <input type="text" id="set-name" value="${escapeHtml(settings.teacherName)}" placeholder="שמך" onchange="App.updateSetting('teacherName', this.value)">
        </div>
        <div class="setting-row">
          <div><div class="setting-label">מטבע</div></div>
          <input type="text" id="set-cur" value="${escapeHtml(settings.currency)}" maxlength="3" onchange="App.updateSetting('currency', this.value)">
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">ברירות מחדל לשיעור</div>
        <div class="setting-row">
          <div><div class="setting-label">מחיר ברירת מחדל</div></div>
          <input type="number" inputmode="numeric" min="0" value="${settings.defaultPrice}" onchange="App.updateSetting('defaultPrice', this.value)">
        </div>
        <div class="setting-row">
          <div><div class="setting-label">שעת התחלה</div></div>
          <input type="time" value="${settings.defaultTime}" onchange="App.updateSetting('defaultTime', this.value)">
        </div>
        <div class="setting-row">
          <div><div class="setting-label">משך (דקות)</div></div>
          <input type="number" inputmode="numeric" min="0" step="15" value="${settings.defaultDuration}" onchange="App.updateSetting('defaultDuration', this.value)">
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">תזכורות</div>
        <div class="setting-row">
          <div><div class="setting-label">התראה לפני שיעור</div><div class="setting-sub">דקות לפני (כשהאפליקציה פתוחה)</div></div>
          <input type="number" inputmode="numeric" min="0" value="${settings.remindMinutes}" onchange="App.updateSetting('remindMinutes', this.value)">
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">מראה</div>
        <div class="setting-row">
          <div><div class="setting-label">ערכת נושא</div></div>
          <div class="theme-seg">
            <button class="${settings.theme === "auto" ? "active" : ""}" onclick="App.setTheme('auto')">אוטומטי</button>
            <button class="${settings.theme === "light" ? "active" : ""}" onclick="App.setTheme('light')">בהיר</button>
            <button class="${settings.theme === "dark" ? "active" : ""}" onclick="App.setTheme('dark')">כהה</button>
          </div>
        </div>
      </div>

      <div class="settings-group">
        <div class="group-title">נתונים</div>
        <div class="card">
          <button class="btn btn-light btn-block" onclick="App.exportData()">ייצוא גיבוי לקובץ</button>
          <button class="btn btn-light btn-block" onclick="document.getElementById('importFile').click()">שחזור מקובץ גיבוי</button>
          <button class="btn btn-danger btn-block" onclick="App.clearAll()">מחיקת כל הנתונים</button>
        </div>
        <div class="setting-sub" style="margin-top:8px;text-align:center">המורה שלי · גרסה ${DATA_VERSION}.0</div>
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
    saveSettings();
    render();
    toast("נשמר", "ok");
  }

  function setTheme(theme) {
    settings.theme = theme;
    saveSettings();
    applyTheme();
    renderSettings();
  }

  function clearAll() {
    if (!confirm("פעולה זו תמחק את כל התלמידים, השיעורים וההגדרות לצמיתות. להמשיך?")) return;
    if (!confirm("בטוחה? אין דרך לשחזר ללא קובץ גיבוי.")) return;
    students = []; lessons = [];
    settings = Object.assign({}, DEFAULT_SETTINGS);
    save(); saveSettings(); applyTheme(); render();
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
    if (document.getElementById("view-income").classList.contains("active")) drawChart();
  }
  mq.addEventListener && mq.addEventListener("change", () => { if (settings.theme === "auto") applyTheme(); });

  // ========== תזכורות בדפדפן ==========
  function initReminders() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      document.body.addEventListener("click", () => {
        if (Notification.permission === "default") Notification.requestPermission();
      }, { once: true });
    }
    setInterval(checkReminders, 60 * 1000);
    checkReminders();
  }

  const notified = new Set();
  function checkReminders() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = new Date();
    const lead = settings.remindMinutes || 30;
    lessons.forEach(l => {
      if (l.done || notified.has(l.id)) return;
      const dt = new Date(`${l.date}T${l.time || "00:00"}`);
      const diffMin = (dt - now) / 60000;
      if (diffMin > 0 && diffMin <= lead) {
        const s = studentById(l.studentId);
        new Notification("תזכורת שיעור", {
          body: `שיעור עם ${s ? s.name : "תלמיד"} בשעה ${l.time}`,
          icon: "icon-192.png"
        });
        notified.add(l.id);
      }
    });
  }

  // ========== התקנה (PWA) ==========
  let deferredPrompt = null;

  function initInstall() {
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredPrompt = e;
      if (!localStorage.getItem("mt_installDismissed"))
        document.getElementById("installBanner").classList.remove("hidden");
    });
    window.addEventListener("appinstalled", () => {
      document.getElementById("installBanner").classList.add("hidden");
      deferredPrompt = null;
      toast("האפליקציה הותקנה", "ok");
    });
  }
  async function promptInstall() {
    document.getElementById("installBanner").classList.add("hidden");
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
  }
  function dismissInstall() {
    document.getElementById("installBanner").classList.add("hidden");
    localStorage.setItem("mt_installDismissed", "1");
  }

  // ========== רנדור כללי ==========
  function render() {
    renderHome();
    renderStudents();
    renderCalendar();
    renderPayments();
    renderIncome();
    renderSettings();
  }

  // ----- אתחול -----
  function handleLaunchParams() {
    const p = new URLSearchParams(location.search);
    if (p.get("view")) go(p.get("view"));
    if (p.get("action") === "new-lesson") openLessonForm();
  }

  function init() {
    migrate();
    applyTheme();
    render();
    handleLaunchParams();
    initReminders();
    initInstall();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
      // עדכון אוטומטי שקט: כש-SW חדש משתלט (skipWaiting), מרעננים פעם אחת
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // ----- חשיפת פונקציות לממשק -----
  return {
    go, closeModal, renderStudents,
    openStudentForm, saveStudent, deleteStudent,
    openLessonForm, saveLesson, deleteLesson, toggleDone,
    setLessonDate, togglePast, renderStudentPicker, pickStudent, toggleAdvanced,
    setCalendarMode, calShift, selectCalDay,
    setMoneyTab, sendWhatsApp, markAllPaid,
    exportData, importData,
    changeMonth,
    updateSetting, setTheme, clearAll,
    promptInstall, dismissInstall
  };
})();

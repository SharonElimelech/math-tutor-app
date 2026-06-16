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
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10.5 21a2 2 0 0 0 3 0"/>'
  };
  const icon = (name, cls) =>
    `<svg class="${cls || "ic"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;

  // ----- שכבת נתונים -----
  const DB = {
    load(key, def) {
      try { return JSON.parse(localStorage.getItem("mt_" + key)) ?? def; }
      catch { return def; }
    },
    save(key, val) { localStorage.setItem("mt_" + key, JSON.stringify(val)); }
  };

  let students = DB.load("students", []);
  let lessons  = DB.load("lessons", []);
  let viewMonth = new Date(); // החודש שמוצג בסיכום

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const save = () => { DB.save("students", students); DB.save("lessons", lessons); };

  // ----- עזרי תאריך -----
  const fmtDate = d => new Date(d).toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
  const fmtTime = t => t || "";
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const studentById = id => students.find(s => s.id === id);

  // ----- ניווט -----
  function go(view) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + view).classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.view === view));
    render();
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
    const s = id ? studentById(id) : { name: "", parentName: "", phone: "", price: "" };
    openModal(`
      <h3>${id ? "עריכת תלמיד" : "תלמיד חדש"}</h3>
      <label>שם התלמיד</label>
      <input id="f-name" value="${escapeHtml(s.name)}" placeholder="לדוגמה: דנה כהן">
      <label>שם ההורה</label>
      <input id="f-parent" value="${escapeHtml(s.parentName)}" placeholder="לדוגמה: רונית">
      <label>טלפון ההורה (לוואטסאפ)</label>
      <input id="f-phone" type="tel" value="${escapeHtml(s.phone)}" placeholder="05X-XXXXXXX">
      <label>מחיר לשיעור (₪)</label>
      <input id="f-price" type="number" value="${escapeHtml(s.price)}" placeholder="120">
      <button class="btn btn-green btn-block" onclick="App.saveStudent('${id || ""}')">שמירה</button>
      ${id ? `<button class="btn btn-danger btn-block" onclick="App.deleteStudent('${id}')">מחיקת תלמיד</button>` : ""}
    `);
  }

  function saveStudent(id) {
    const name = document.getElementById("f-name").value.trim();
    if (!name) { alert("נא להזין שם תלמיד"); return; }
    const data = {
      name,
      parentName: document.getElementById("f-parent").value.trim(),
      phone: document.getElementById("f-phone").value.trim(),
      price: parseFloat(document.getElementById("f-price").value) || 0
    };
    if (id) {
      Object.assign(studentById(id), data);
    } else {
      students.push({ id: uid(), ...data });
    }
    save(); closeModal(); render();
  }

  function deleteStudent(id) {
    if (!confirm("למחוק את התלמיד וכל השיעורים שלו?")) return;
    students = students.filter(s => s.id !== id);
    lessons = lessons.filter(l => l.studentId !== id);
    save(); closeModal(); render();
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
            ₪${s.price} לשיעור
          </div>
        </div>
        <div class="item-actions"><span class="btn btn-light">${icon("edit")}</span></div>
      </div>
    `).join("");
  }

  // ========== שיעורים / יומן ==========
  function openLessonForm(id) {
    if (!students.length) { alert("צריך קודם להוסיף לפחות תלמיד אחד"); return; }
    const l = id ? lessons.find(x => x.id === id) : { studentId: students[0].id, date: todayStr(), time: "16:00", topic: "" };
    openModal(`
      <h3>${id ? "עריכת שיעור" : "שיעור חדש"}</h3>
      <label>תלמיד</label>
      <select id="f-student">
        ${students.map(s => `<option value="${s.id}" ${s.id === l.studentId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
      <div class="row">
        <div><label>תאריך</label><input id="f-date" type="date" value="${l.date}"></div>
        <div><label>שעה</label><input id="f-time" type="time" value="${l.time}"></div>
      </div>
      <label>נושא / הערות (לא חובה)</label>
      <input id="f-topic" value="${escapeHtml(l.topic || "")}" placeholder="לדוגמה: גיאומטריה - משפט פיתגורס">
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
      <button class="btn btn-green btn-block" onclick="App.saveLesson('${id || ""}')">שמירה</button>
      ${id ? `<button class="btn btn-danger btn-block" onclick="App.deleteLesson('${id}')">מחיקת שיעור</button>` : ""}
    `);
  }

  function saveLesson(id) {
    const data = {
      studentId: document.getElementById("f-student").value,
      date: document.getElementById("f-date").value,
      time: document.getElementById("f-time").value,
      topic: document.getElementById("f-topic").value.trim()
    };
    if (!data.date) { alert("נא לבחור תאריך"); return; }
    if (id) {
      Object.assign(lessons.find(x => x.id === id), data);
    } else {
      const repeat = document.getElementById("f-repeat");
      const weeks = (repeat && repeat.checked)
        ? Math.max(1, parseInt(document.getElementById("f-weeks").value) || 1)
        : 1;
      for (let i = 0; i < weeks; i++) {
        const d = new Date(data.date + "T00:00");
        d.setDate(d.getDate() + i * 7);
        lessons.push({
          id: uid(), paid: false, done: false, ...data,
          date: d.toISOString().slice(0, 10)
        });
      }
    }
    save(); closeModal(); render();
  }

  function deleteLesson(id) {
    if (!confirm("למחוק את השיעור?")) return;
    lessons = lessons.filter(l => l.id !== id);
    save(); closeModal(); render();
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

  const doneMark = done => done ? `<span style="color:var(--green)">${icon("check")}</span>` : "";
  const dateTimeLine = l =>
    `${icon("calendar", "ic-sub")} ${fmtDate(l.date)} &nbsp;·&nbsp; ${icon("clock", "ic-sub")} ${fmtTime(l.time)}`;

  function renderLessons() {
    const el = document.getElementById("lessonsList");
    const list = lessonSorted();
    if (!list.length) { el.innerHTML = `<div class="empty">אין שיעורים ביומן.<br>קבעי שיעור עם הכפתור שלמעלה.</div>`; return; }
    el.innerHTML = list.map(l => {
      const s = studentById(l.studentId) || { name: "תלמיד שנמחק" };
      return `
        <div class="item">
          <div class="item-main" onclick="App.openLessonForm('${l.id}')">
            <div class="item-title">${escapeHtml(s.name)} ${doneMark(l.done)}</div>
            <div class="item-sub">${dateTimeLine(l)}</div>
            ${l.topic ? `<div class="item-note">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</div>` : ""}
          </div>
          <div class="item-actions">
            <button class="btn ${l.done ? "btn-light" : "btn-green"}" onclick="App.toggleDone('${l.id}')">
              ${l.done ? "בוטל סימון" : "בוצע"}
            </button>
          </div>
        </div>`;
    }).join("");
  }

  // ========== מסך בית ==========
  function renderHome() {
    const today = todayStr();
    const todayLessons = lessons.filter(l => l.date === today);
    document.getElementById("todaySummary").innerHTML = `
      <div>היום: <b>${todayLessons.length}</b> שיעורים</div>
      <div>סה"כ תלמידים: <b>${students.length}</b></div>
    `;

    // שיעורים קרובים (מהיום והלאה, עד 5)
    const upcoming = lessonSorted().filter(l => l.date >= today && !l.done).slice(0, 5);
    const up = document.getElementById("upcomingLessons");
    up.innerHTML = upcoming.length ? upcoming.map(l => {
      const s = studentById(l.studentId) || { name: "?" };
      const isToday = l.date === today;
      return `<div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.name)} ${isToday ? '<span class="tag tag-soon">היום</span>' : ""}</div>
          <div class="item-sub">${dateTimeLine(l)}</div>
          ${l.topic ? `<div class="item-note">${icon("note", "ic-sub")} ${escapeHtml(l.topic)}</div>` : ""}
        </div>
      </div>`;
    }).join("") : `<div class="empty">אין שיעורים מתוכננים</div>`;

    // תזכורות תשלום: שיעורים שבוצעו אך לא שולמו
    const dues = lessons.filter(l => l.done && !l.paid);
    const pa = document.getElementById("paymentAlerts");
    pa.innerHTML = dues.length ? dues.map(l => {
      const s = studentById(l.studentId) || { name: "?", price: 0 };
      return `<div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.name)} <span class="tag tag-due">₪${s.price}</span></div>
          <div class="item-sub">שיעור מ-${fmtDate(l.date)} · ממתין לתשלום</div>
        </div>
        <div class="item-actions">
          <button class="btn btn-wa" onclick="App.sendWhatsApp('${l.studentId}')">${icon("whatsapp")} שליחה</button>
        </div>
      </div>`;
    }).join("") : `<div class="empty"><span style="color:var(--green)">${icon("checkCircle")}</span> הכול שולם</div>`;

    // עדכון תגית בכותרת
    const badge = document.getElementById("reminderBadge");
    if (todayLessons.length) {
      badge.innerHTML = `${icon("bell")} ${todayLessons.length} שיעורים היום`;
      badge.classList.remove("hidden");
    } else { badge.classList.add("hidden"); }
  }

  // ========== תשלומים ==========
  function renderPayments() {
    const el = document.getElementById("paymentsList");
    if (!students.length) { el.innerHTML = `<div class="empty">אין נתונים</div>`; return; }
    el.innerHTML = students.map(s => {
      const sl = lessons.filter(l => l.studentId === s.id && l.done);
      const unpaid = sl.filter(l => !l.paid);
      const owed = unpaid.length * s.price;
      return `
        <div class="card">
          <div class="item" style="box-shadow:none;padding:0;border:none;">
            <div class="item-main">
              <div class="item-title">${escapeHtml(s.name)}</div>
              <div class="item-sub">
                ${sl.length} שיעורים בוצעו · ${unpaid.length} לא שולמו
                ${owed > 0 ? `<br><span class="tag tag-due">חוב: ₪${owed}</span>` : `<br><span class="tag tag-paid">הכול שולם</span>`}
              </div>
            </div>
          </div>
          ${unpaid.length ? `
            <button class="btn btn-wa btn-block" onclick="App.sendWhatsApp('${s.id}')">${icon("whatsapp")} תזכורת תשלום בוואטסאפ (₪${owed})</button>
            <button class="btn btn-green btn-block" onclick="App.markAllPaid('${s.id}')">${icon("check")} סימון הכול כשולם</button>
          ` : ""}
        </div>`;
    }).join("");
  }

  function markAllPaid(studentId) {
    lessons.filter(l => l.studentId === studentId && l.done && !l.paid)
      .forEach(l => l.paid = true);
    save(); render();
  }

  // ----- וואטסאפ: הודעה מוכנה + קישור לשליחה בלחיצה -----
  function sendWhatsApp(studentId) {
    const s = studentById(studentId);
    if (!s) return;
    if (!s.phone) { alert("לתלמיד הזה אין מספר טלפון. הוסיפי אותו במסך התלמידים."); return; }

    const unpaid = lessons.filter(l => l.studentId === studentId && l.done && !l.paid);
    const owed = unpaid.length * s.price;
    const msg =
      `שלום ${s.parentName || ""},\n` +
      `תזכורת ידידותית לגבי תשלום עבור השיעורים הפרטיים של ${s.name}.\n` +
      `סה"כ ${unpaid.length} שיעורים שטרם שולמו, בסך ${owed} ₪.\n` +
      `תודה רבה!`;

    // ניקוי מספר טלפון לפורמט בינלאומי (ישראל +972)
    let phone = s.phone.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) phone = "972" + phone.slice(1);
    else if (!phone.startsWith("972")) phone = "972" + phone;

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  // ========== גיבוי ושחזור ==========
  function exportData() {
    const data = { students, lessons, exportedAt: new Date().toISOString(), version: 1 };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `גיבוי-המורה-שלי-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
        if (!confirm("שחזור יחליף את כל הנתונים הקיימים. להמשיך?")) return;
        students = data.students;
        lessons = data.lessons;
        save(); render();
        alert("השחזור הושלם בהצלחה");
      } catch (err) {
        alert("שגיאה בקריאת הקובץ: " + err.message);
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  }

  // ========== סיכום הכנסות ==========
  function changeMonth(delta) {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
    render();
  }

  function renderIncome() {
    const key = monthKey(viewMonth);
    document.getElementById("currentMonthLabel").textContent =
      viewMonth.toLocaleDateString("he-IL", { month: "long", year: "numeric" });

    const monthLessons = lessons.filter(l => l.date.startsWith(key) && l.done);
    let earned = 0, pending = 0;
    monthLessons.forEach(l => {
      const s = studentById(l.studentId);
      const price = s ? s.price : 0;
      if (l.paid) earned += price; else pending += price;
    });

    document.getElementById("incomeSummary").innerHTML = `
      <div class="card summary-card">
        <div>שיעורים שבוצעו: <b>${monthLessons.length}</b></div>
        <div>התקבל בפועל: <b>₪${earned}</b></div>
        <div>ממתין לתשלום: <b>₪${pending}</b></div>
        <div style="font-size:1.2rem;margin-top:6px">סה"כ החודש: <b>₪${earned + pending}</b></div>
      </div>`;

    drawChart();
  }

  // גרף עמודות של 6 החודשים האחרונים (ללא ספריות חיצוניות)
  function drawChart() {
    const canvas = document.getElementById("incomeChart");
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.clientWidth;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - i, 1);
      const key = monthKey(d);
      const total = lessons.filter(l => l.date.startsWith(key) && l.done)
        .reduce((sum, l) => { const s = studentById(l.studentId); return sum + (s ? s.price : 0); }, 0);
      months.push({ label: d.toLocaleDateString("he-IL", { month: "short" }), total });
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
      ctx.fillStyle = "#d97706";
      ctx.fillRect(x, y, bw, h);
      ctx.fillStyle = "#1f2937";
      ctx.fillText("₪" + m.total, x + bw / 2, y - 6);
      ctx.fillStyle = "#9aa1ab";
      ctx.fillText(m.label, x + bw / 2, H - 8);
    });
  }

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
    lessons.forEach(l => {
      if (l.done || notified.has(l.id)) return;
      const dt = new Date(`${l.date}T${l.time || "00:00"}`);
      const diffMin = (dt - now) / 60000;
      if (diffMin > 0 && diffMin <= 30) {
        const s = studentById(l.studentId);
        new Notification("תזכורת שיעור", {
          body: `שיעור עם ${s ? s.name : "תלמיד"} בשעה ${l.time}`,
          icon: "icon-192.png"
        });
        notified.add(l.id);
      }
    });
  }

  // ========== רנדור כללי ==========
  function render() {
    renderHome();
    renderStudents();
    renderLessons();
    renderPayments();
    renderIncome();
  }

  // ----- אתחול -----
  function init() {
    render();
    initReminders();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  // ----- חשיפת פונקציות לממשק -----
  return {
    go, closeModal, renderStudents,
    openStudentForm, saveStudent, deleteStudent,
    openLessonForm, saveLesson, deleteLesson, toggleDone,
    sendWhatsApp, markAllPaid,
    exportData, importData,
    changeMonth
  };
})();

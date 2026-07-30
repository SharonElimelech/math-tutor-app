const empty = Object.freeze([]);

export function buildLessonIndex(students, lessons) {
  const studentsById = new Map(students.map(student => [student.id, student]));
  const lessonsByStudent = new Map();
  const lessonsByDate = new Map();
  const doneByStudent = new Map();
  const unpaidDoneByStudent = new Map();

  for (const lesson of lessons) {
    append(lessonsByStudent, lesson.studentId, lesson);
    append(lessonsByDate, lesson.date, lesson);
    if (lesson.done) {
      append(doneByStudent, lesson.studentId, lesson);
      if (!lesson.paid) append(unpaidDoneByStudent, lesson.studentId, lesson);
    }
  }

  const sortedLessons = [...lessons].sort((a, b) =>
    `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)
  );

  // רשימות פר-תלמיד ממוינות כרונולוגית — כל הצרכנים מסתמכים על זה במקום למיין שוב
  for (const list of lessonsByStudent.values()) {
    list.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  }

  return {
    studentsById,
    lessonsByStudent,
    lessonsByDate,
    doneByStudent,
    unpaidDoneByStudent,
    sortedLessons,
    forStudent: id => lessonsByStudent.get(id) || empty,
    doneForStudent: id => doneByStudent.get(id) || empty,
    unpaidForStudent: id => unpaidDoneByStudent.get(id) || empty,
    onDate: date => lessonsByDate.get(date) || empty
  };
}

function append(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// חפיפות ביומן: שיעור שטרם בוצע, באחד התאריכים המבוקשים, שטווח הדקות שלו נחתך עם המבוקש.
export function findConflicts(lessons, { dates, time, duration, excludeId }) {
  if (!time) return [];
  const start = toMinutes(time);
  const end = start + Math.max(duration || 0, 1); // ponytail: משך 0 עדיין מתנגש על אותה דקה
  const wanted = new Set(dates);
  return lessons.filter(lesson =>
    lesson.id !== excludeId && !lesson.done && lesson.time && wanted.has(lesson.date) &&
    toMinutes(lesson.time) < end &&
    toMinutes(lesson.time) + Math.max(lesson.duration || 0, 1) > start
  );
}

// גיל חוב בשבועות שלמים — נמדד מהשיעור הוותיק ביותר שלא שולם
export function debtAgeWeeks(unpaidLessons, today) {
  if (!unpaidLessons.length) return 0;
  const oldest = unpaidLessons.reduce((min, lesson) => lesson.date < min ? lesson.date : min, unpaidLessons[0].date);
  return Math.max(0, Math.floor((new Date(today + "T00:00") - new Date(oldest + "T00:00")) / (7 * 86400000)));
}

// מי הבא בתור לתזכורת תשלום: החוב הגדול ביותר שיש לו טלפון וטרם נשלחה עליו תזכורת.
// כשכולם כבר קיבלו — מחזיר את הגדול ביותר לשליחה חוזרת.
export function nextDebtorToRemind(debtors, isSent = () => false) {
  return debtors.find(d => d.student.phone && !isSent(d))
    || debtors.find(d => d.student.phone)
    || debtors[0]
    || null;
}

function toMinutes(time) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + (mins || 0);
}

export function summarizeMonth(lessons, studentsById, priceForLesson) {
  const totals = { earned: 0, pending: 0, count: lessons.length };
  const byStudent = new Map();

  for (const lesson of lessons) {
    const price = priceForLesson(lesson);
    const bucket = lesson.paid ? "earned" : "pending";
    totals[bucket] += price;

    if (!byStudent.has(lesson.studentId)) {
      byStudent.set(lesson.studentId, {
        student: studentsById.get(lesson.studentId),
        count: 0,
        earned: 0,
        pending: 0
      });
    }
    const summary = byStudent.get(lesson.studentId);
    summary.count += 1;
    summary[bucket] += price;
  }

  const students = [...byStudent.values()]
    .filter(summary => summary.student)
    .sort((a, b) => (b.earned + b.pending) - (a.earned + a.pending));

  return { ...totals, students };
}

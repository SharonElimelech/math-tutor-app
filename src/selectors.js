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

export const APP_VERSION = "3.3.9";
export const DATA_VERSION = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  teacherName: "",
  currency: "₪",
  defaultPrice: 120,
  defaultTime: "16:00",
  defaultDuration: 60,
  theme: "auto",
  remindMinutes: 30
});

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const fail = message => { throw new Error(message); };
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

function text(value, field, maxLength, { required = false } = {}) {
  const result = String(value ?? "").trim();
  if (required && !result) fail(`${field} is required`);
  if (result.length > maxLength) fail(`${field} is too long`);
  return result;
}

function id(value, field) {
  const result = text(value, field, 80, { required: true });
  if (!ID_PATTERN.test(result)) fail(`${field} is invalid`);
  return result;
}

function number(value, field, { fallback = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === "" || value === null || value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > max) fail(`${field} is invalid`);
  return result;
}

function date(value, field) {
  const result = text(value, field, 10, { required: true });
  if (!DATE_PATTERN.test(result) || Number.isNaN(new Date(`${result}T00:00:00`).getTime())) {
    fail(`${field} is invalid`);
  }
  return result;
}

function time(value, field) {
  const result = text(value, field, 5, { required: true });
  if (!TIME_PATTERN.test(result)) fail(`${field} is invalid`);
  return result;
}

export function normalizeSettings(input = {}) {
  const source = isRecord(input) ? input : {};
  const theme = ["auto", "light", "dark"].includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme;
  const currency = text(source.currency ?? DEFAULT_SETTINGS.currency, "currency", 3, { required: true });
  if (/[<>"'`]/.test(currency)) fail("currency is invalid");

  return {
    teacherName: text(source.teacherName, "teacherName", 80),
    currency,
    defaultPrice: number(source.defaultPrice, "defaultPrice", { fallback: DEFAULT_SETTINGS.defaultPrice, max: 1000000 }),
    defaultTime: source.defaultTime ? time(source.defaultTime, "defaultTime") : DEFAULT_SETTINGS.defaultTime,
    defaultDuration: number(source.defaultDuration, "defaultDuration", { fallback: DEFAULT_SETTINGS.defaultDuration, max: 1440 }),
    theme,
    remindMinutes: number(source.remindMinutes, "remindMinutes", { fallback: DEFAULT_SETTINGS.remindMinutes, max: 10080 })
  };
}

function normalizeStudent(input, index) {
  if (!isRecord(input)) fail(`student ${index + 1} is invalid`);
  return {
    id: id(input.id, `student ${index + 1} id`),
    name: text(input.name, `student ${index + 1} name`, 120, { required: true }),
    parentName: text(input.parentName, `student ${index + 1} parentName`, 120),
    phone: text(input.phone, `student ${index + 1} phone`, 32),
    price: number(input.price, `student ${index + 1} price`, { max: 1000000 })
  };
}

function normalizeLesson(input, index, studentIds) {
  if (!isRecord(input)) fail(`lesson ${index + 1} is invalid`);
  const studentId = id(input.studentId, `lesson ${index + 1} studentId`);
  if (!studentIds.has(studentId)) fail(`lesson ${index + 1} references a missing student`);

  const lesson = {
    id: id(input.id, `lesson ${index + 1} id`),
    studentId,
    date: date(input.date, `lesson ${index + 1} date`),
    time: time(input.time || "00:00", `lesson ${index + 1} time`),
    topic: text(input.topic, `lesson ${index + 1} topic`, 500),
    duration: number(input.duration, `lesson ${index + 1} duration`, { fallback: DEFAULT_SETTINGS.defaultDuration, max: 1440 }),
    paid: input.paid === true,
    done: input.done === true
  };

  if (input.price !== undefined && input.price !== null && input.price !== "") {
    lesson.price = number(input.price, `lesson ${index + 1} price`, { max: 1000000 });
  }
  if (input.seriesId) lesson.seriesId = id(input.seriesId, `lesson ${index + 1} seriesId`);
  if (input.recur === "weekly") lesson.recur = "weekly";
  if (input.openEnded === true) lesson.openEnded = true;

  return lesson;
}

export function parseBackup(input) {
  if (!isRecord(input)) fail("Backup must contain an object");
  if (!Array.isArray(input.students) || !Array.isArray(input.lessons)) {
    fail("Backup must contain students and lessons arrays");
  }
  if (input.students.length > 10000 || input.lessons.length > 100000) {
    fail("Backup is too large");
  }

  const students = input.students.map(normalizeStudent);
  const studentIds = new Set(students.map(student => student.id));
  if (studentIds.size !== students.length) fail("Backup contains duplicate student IDs");

  const lessons = input.lessons.map((lesson, index) => normalizeLesson(lesson, index, studentIds));
  const lessonIds = new Set(lessons.map(lesson => lesson.id));
  if (lessonIds.size !== lessons.length) fail("Backup contains duplicate lesson IDs");

  return {
    students,
    lessons,
    settings: normalizeSettings(input.settings),
    version: DATA_VERSION
  };
}

export function createSnapshot(students, lessons, settings) {
  return parseBackup({ students, lessons, settings, version: DATA_VERSION });
}

export function reminderLeadMinutes(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : DEFAULT_SETTINGS.remindMinutes;
}

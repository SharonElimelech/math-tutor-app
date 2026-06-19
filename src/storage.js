import { DEFAULT_SETTINGS, parseBackup } from "./data.js";

export const STATE_KEY = "mt_state_v3";

export class AppStorage {
  constructor(storage) {
    this.storage = storage;
  }

  load() {
    try {
      const packed = this.storage.getItem(STATE_KEY);
      if (packed) {
        return { state: parseBackup(JSON.parse(packed)), error: null, needsPersist: false };
      }

      const legacy = {
        students: this.#readLegacy("mt_students", []),
        lessons: this.#readLegacy("mt_lessons", []),
        settings: this.#readLegacy("mt_settings", {})
      };
      return { state: parseBackup(legacy), error: null, needsPersist: true };
    } catch (error) {
      return {
        state: parseBackup({ students: [], lessons: [], settings: DEFAULT_SETTINGS }),
        error,
        needsPersist: false
      };
    }
  }

  save(snapshot) {
    this.storage.setItem(STATE_KEY, JSON.stringify(snapshot));
  }

  #readLegacy(key, fallback) {
    const value = this.storage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  }
}

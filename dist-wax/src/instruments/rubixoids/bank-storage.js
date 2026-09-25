export const RUBIXOIDS_DRUM_BANK_KEY = "morphazoid:rubixoids:fm-drums:bank:v1";
const LEGACY_DRUM_BANK_KEY = "morphazoid:fm-drums:bank:v1";

/** Snapshot the existing kit once; later standalone edits belong to that page. */
export function seedRubixoidsDrumBank(runtime = globalThis) {
  try {
    const storage = runtime.localStorage;
    if (!storage || storage.getItem(RUBIXOIDS_DRUM_BANK_KEY) !== null) return;
    // JSON null records an initially empty bank too, so future legacy saves
    // cannot silently replace this app's original default sounds.
    storage.setItem(RUBIXOIDS_DRUM_BANK_KEY, storage.getItem(LEGACY_DRUM_BANK_KEY) ?? 'null');
  } catch {
    // Storage-unavailable browsers retain the instruments' normal default kit.
  }
}

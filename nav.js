const LEGACY_SETTINGS_KEYS = [
  "morphazoid:shape:audio:v1",
  "morphazoid:lattice:audio:v2",
  "morphazoid:lumber:audio:v2",
];

function clearLegacySettings() {
  try {
    for (const key of LEGACY_SETTINGS_KEYS) globalThis.localStorage?.removeItem(key);
  } catch {
    // Pages still reset normally when storage is unavailable.
  }
}

clearLegacySettings();

for (const select of document.querySelectorAll(".mobile-instrument-select")) {
  select.addEventListener("change", () => {
    if (select.value) globalThis.location.href = select.value;
  });
}

for (const button of document.querySelectorAll("[data-reset-all]")) {
  button.addEventListener("click", () => {
    clearLegacySettings();
    globalThis.location.reload();
  });
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CRICKET_CONTROL_KEYS, CRICKET_CONTROL_SPECS, CRICKET_FULL_PRESETS, CRICKET_SOURCE_IDS, captureCricketPreset,
  randomizeCricketPreset, snapCricketControl, validateCricketPreset,
} from "../src/instruments/crickets/full-presets.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);

test("Crickets bank is complete, valid and uses every source", () => {
  validateFullPresetBank(CRICKET_FULL_PRESETS);
  for (const preset of CRICKET_FULL_PRESETS) {
    assert.equal(validateCricketPreset(preset.snapshot), preset.snapshot);
    assert.notEqual(preset.snapshot.sourceId, "local");
  }
  assert.equal(new Set(CRICKET_FULL_PRESETS.map(p => p.snapshot.sourceId)).size, CRICKET_SOURCE_IDS.length);
  assert.throws(() => validateCricketPreset({ ...CRICKET_FULL_PRESETS[0].snapshot, wingQ: 99 }), TypeError);
  assert.throws(() => validateCricketPreset({ ...CRICKET_FULL_PRESETS[0].snapshot, wingQ: 7.93 }), TypeError);
  assert.throws(() => validateCricketPreset({ sourceId: "field-chirps" }), TypeError);
});

test("source ids and slider ranges stay aligned with the page", async () => {
  const html = await readFile(new URL("../src/pages/crickets.html", import.meta.url), "utf8");
  for (const id of CRICKET_SOURCE_IDS) assert.match(html, new RegExp(`<option value="${id}"`));
  for (const { id, min, max, step } of Object.values(CRICKET_CONTROL_SPECS)) {
    assert.match(html, new RegExp(`id="${id}" type="range" min="${min}" max="${max}" step="${step}"`));
  }
});

test("an uploaded file is capturable but dice keeps it", () => {
  const local = captureCricketPreset({ sourceId: "local", controls: CRICKET_FULL_PRESETS[0].snapshot });
  assert.equal(validateCricketPreset(local), local);
  assert.equal(randomizeCricketPreset(local, seed(2)).sourceId, "local");
  assert.equal(snapCricketControl("wingQ", 7.93), 7.9);
});

test("Crickets dice is pure, reproducible, bounded and unfrozen", () => {
  const initial = CRICKET_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeCricketPreset(initial, seed(5)), randomizeCricketPreset(CRICKET_FULL_PRESETS[4].snapshot, seed(5)));
  assert.deepEqual(initial, before);
  const factory = new Set(CRICKET_FULL_PRESETS.map(p => presetStateKey(p.snapshot)));
  const seen = new Map(["sourceId", ...CRICKET_CONTROL_KEYS].map(key => [key, new Set()]));
  const random = seed(77);
  for (let i = 0; i < 120; i++) {
    const result = randomizeCricketPreset(initial, random);
    validateCricketPreset(result);
    assert.equal(factory.has(presetStateKey(result)), false);
    for (const [key, values] of seen) values.add(result[key]);
  }
  for (const [key, values] of seen) assert.ok(values.size >= (key === "sourceId" ? CRICKET_SOURCE_IDS.length : 30), `${key} stays frozen`);
  validateCricketPreset(randomizeCricketPreset(initial, () => 0));
  validateCricketPreset(randomizeCricketPreset(initial, () => 1));
});

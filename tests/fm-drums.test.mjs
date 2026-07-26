import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cloneDefaultFmDrumVoices,
  DEFAULT_FM_DRUM_VOICES,
  frequencyFromSlider,
  frequencySliderPosition,
  sanitizeFmDrumVoice,
} from "../src/fm-drums.js";

const root = new URL("../", import.meta.url);

test("FM Drums exposes sixteen uniquely keyed reusable voices", () => {
  assert.equal(DEFAULT_FM_DRUM_VOICES.length, 16);
  assert.equal(new Set(DEFAULT_FM_DRUM_VOICES.map(({ id }) => id)).size, 16);
  assert.deepEqual(
    DEFAULT_FM_DRUM_VOICES.map(({ key }) => key).join(""),
    "qwerasdfzxcv1234",
  );
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "kick"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "snare"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "hat"), true);
  assert.equal(DEFAULT_FM_DRUM_VOICES.some(({ family }) => family === "bell"), true);
});

test("FM drum banks clone cleanly and voice values stay bounded", () => {
  const bank = cloneDefaultFmDrumVoices();
  bank[0].frequency = 999;
  assert.notEqual(bank[0].frequency, DEFAULT_FM_DRUM_VOICES[0].frequency);
  assert.deepEqual(
    sanitizeFmDrumVoice({
      frequency: -2,
      attack: 8,
      decay: 0,
      modRatio: 30,
      modIndex: -1,
      pitchBend: 80,
      noise: 4,
      tone: -3,
      level: 7,
    }),
    {
      frequency: 20,
      attack: .25,
      decay: .1,
      modRatio: 8,
      modIndex: 0,
      pitchBend: 8,
      noise: 1,
      tone: 0,
      level: 1,
    },
  );
});

test("FM drum tuning slider is logarithmic and reversible", () => {
  assert.equal(frequencyFromSlider(0), 35);
  assert.equal(frequencyFromSlider(1), 6_000);
  for (const frequency of [48, 176, 784, 4_820]) {
    assert.ok(Math.abs(frequencyFromSlider(frequencySliderPosition(frequency)) - frequency) < 1e-8);
  }
});

test("FM Drums page belongs to the Morphazoid workbench shell", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("fm-drums.html", root), "utf8"),
    readFile(new URL("fm-drums.css", root), "utf8"),
    readFile(new URL("fm-drums-app.js", root), "utf8"),
  ]);
  assert.match(html, /WORKBENCH · 02/);
  assert.match(html, /class="masthead"/);
  assert.match(html, /class="mobile-instrument-select"/);
  assert.match(html, /id="padGrid"/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="fm-drums-app\.js"/);
  assert.match(css, /\.fm-pad-grid[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
});

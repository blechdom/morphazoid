import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { animalState } from "../src/syrinx.js";
import {
  DEFAULT_MORPHYNX_STATE,
  MORPHYNX_ANATOMIES,
  MORPHYNX_VOICE_PRESETS,
  humanizedControls,
  morphynxConfiguration,
  morphynxFormants,
  morphynxKeyboardCommand,
  morphynxVoiceState,
} from "../src/morphynx.js";

const root = new URL("../", import.meta.url);

test("Morphynx continuously maps animal physics toward playable voice anatomy", () => {
  const animal = animalState("raven", { biologicalLock: false });
  const voice = morphynxVoiceState({ voicePreset: "clear", phoneme: "a" });
  const animalEnd = morphynxConfiguration({ animal, voice, morph: 0, active: true });
  const midpoint = morphynxConfiguration({ animal, voice, morph: 0.5, active: true });
  const voiceEnd = morphynxConfiguration({ animal, voice, morph: 1, active: true });

  assert.equal(animalEnd.source.model, "bird");
  assert.equal(animalEnd.tract.animalId, "raven");
  assert.equal(voiceEnd.source.model, "mammal");
  assert.equal(voiceEnd.tract.animalId, "mammal");
  assert.ok(midpoint.source.frequencyHz > Math.min(animalEnd.source.frequencyHz, voiceEnd.source.frequencyHz));
  assert.ok(midpoint.source.frequencyHz < Math.max(animalEnd.source.frequencyHz, voiceEnd.source.frequencyHz));
  assert.ok(voiceEnd.source.pressure > 0);
  assert.equal(morphynxConfiguration({ animal, voice, morph: 1, active: false }).source.pressure, 0);
  for (const configuration of [animalEnd, midpoint, voiceEnd]) {
    for (const value of Object.values(configuration.source)) {
      if (typeof value === "number") assert.ok(Number.isFinite(value));
    }
    for (const value of Object.values(configuration.tract)) {
      if (typeof value === "number") assert.ok(Number.isFinite(value));
    }
  }
});

test("Morphynx inherits every voice, anatomy shortcut, phoneme, and capital mutation", () => {
  assert.ok(MORPHYNX_VOICE_PRESETS.length >= 18);
  assert.ok(MORPHYNX_ANATOMIES.length >= 10);
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    const command = morphynxKeyboardCommand(letter);
    assert.equal(command?.type, "phoneme", `${letter} must be playable`);
    assert.equal(command?.letter, letter);
    const capital = morphynxVoiceState({
      voicePreset: "clear",
      phoneme: command.phoneme,
      capitalLetter: letter,
    });
    assert.equal(capital.phoneme, command.phoneme);
  }
  for (const digit of "1234567890") {
    assert.equal(morphynxKeyboardCommand(digit, `Digit${digit}`)?.type, "anatomy");
  }
  assert.equal(morphynxKeyboardCommand("?", "Slash")?.phoneme, "glottal");
  assert.equal(morphynxKeyboardCommand("!"), null);
});

test("voice articulation supplies finite source controls and microphone formants", () => {
  for (const phoneme of ["a", "e", "i", "o", "u", "s", "m", "glottal"]) {
    const voice = morphynxVoiceState({ voicePreset: "clear", phoneme });
    const controls = humanizedControls(voice);
    const formants = morphynxFormants(phoneme, voice);
    assert.equal(formants.frequencies.length, 3);
    assert.ok(formants.frequencies.every((frequency) => Number.isFinite(frequency) && frequency > 0));
    assert.ok(Object.values(controls).every((value) => typeof value !== "number" || Number.isFinite(value)));
  }
  assert.equal(DEFAULT_MORPHYNX_STATE.sourceMode, "internal");
});

test("Morphynx page exposes the hybrid lab, full keyboard, mic, recording, and canvas", async () => {
  const [html, css, app, icon, iconStat] = await Promise.all([
    readFile(new URL("morphynx.html", root), "utf8"),
    readFile(new URL("morphynx.css", root), "utf8"),
    readFile(new URL("morphynx-app.js", root), "utf8"),
    readFile(new URL("assets/instruments/morphynx.webp", root)),
    stat(new URL("assets/instruments/morphynx.webp", root)),
  ]);

  assert.match(html, /<title>Morphynx - Morphazoid<\/title>/);
  assert.match(html, /id="morphynx"[\s\S]*?aria-keyshortcuts="[^"]*Shift\+Z"/);
  assert.match(html, /id="morphAmount"/);
  assert.match(html, /id="voicePresetSelect"/);
  assert.match(html, /data-source="internal"[\s\S]*data-source="mic"[\s\S]*data-source="hybrid"/);
  assert.match(html, /id="recordButton"/);
  assert.match(html, /id="phonemeButtons"/);
  assert.match(html, /src="nav\.js\?v=morphynx-responsive-[^"]+"/);
  assert.match(html, /src="morphynx-app\.js\?v=morphynx-responsive-[^"]+"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Morphynx element IDs stay unique");

  assert.match(app, /syrinx-processor\.js/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /MediaRecorder/);
  assert.match(app, /morphynxKeyboardCommand/);
  assert.match(css, /\.morphynx-phoneme-grid/);
  assert.match(css, /\.morphynx-stage-axis/);
  assert.match(css, /orientation:\s*landscape[\s\S]*grid-template-columns:[\s\S]*\.morphynx-page \.panel[\s\S]*overflow-y:\s*auto/);
  assert.match(html, /href="morphynx\.css\?v=morphynx-responsive-[^"]+"/);
  assert.ok(iconStat.size > 1_000);
  assert.equal(icon.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(icon.subarray(8, 12).toString("ascii"), "WEBP");
});

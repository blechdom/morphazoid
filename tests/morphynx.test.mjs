import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { animalState } from "../src/syrinx.js";
import {
  DEFAULT_MORPHYNX_STATE,
  MORPHYNX_ANATOMIES,
  MORPHYNX_HUMAN_BRANCH_TRIM,
  MORPHYNX_VOICE_PRESETS,
  humanizedControls,
  morphynxConfiguration,
  morphynxFormants,
  morphynxKeyboardCommand,
  morphynxLevelMatchTrim,
  morphynxMix,
  morphynxVoiceState,
} from "../src/morphynx.js";
import { applyTonguesToDiameter } from "../src/tongue-physics.js";

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

test("Morphynx keeps persistent animal and human endpoints through the former switch boundary", () => {
  const animal = animalState("raven", { biologicalLock: false });
  const voice = morphynxVoiceState({ voicePreset: "clear", phoneme: "a" });
  const configurations = [0.679, 0.68, 0.681].map((morph) => (
    morphynxConfiguration({ animal, voice, morph, active: true })
  ));
  const [before, boundary, after] = configurations;

  for (const configuration of configurations) {
    assert.equal(configuration.animalSource.model, "bird");
    assert.equal(configuration.animalTract.animalId, "raven");
    assert.equal(configuration.humanSource.model, "mammal");
    assert.equal(configuration.humanTract.animalId, "mammal");
    assert.equal(configuration.source.model, "hybrid");
    assert.equal(configuration.tract.animalId, "hybrid");
  }
  for (const endpoint of ["animalSource", "humanSource", "animalTract", "humanTract"]) {
    assert.deepEqual(boundary[endpoint], before[endpoint]);
    assert.deepEqual(after[endpoint], boundary[endpoint]);
  }

  assert.ok(Math.abs(boundary.mix.animalGain - before.mix.animalGain) < 0.002);
  assert.ok(Math.abs(after.mix.animalGain - boundary.mix.animalGain) < 0.002);
  assert.ok(Math.abs(boundary.mix.humanGain - before.mix.humanGain) < 0.002);
  assert.ok(Math.abs(after.mix.humanGain - boundary.mix.humanGain) < 0.002);
  assert.ok(MORPHYNX_HUMAN_BRANCH_TRIM > 0 && MORPHYNX_HUMAN_BRANCH_TRIM < 1);

  for (let index = 0; index <= 100; index += 1) {
    const mix = morphynxMix(index / 100);
    const untrimmedPower = mix.animalGain ** 2
      + (mix.humanGain / MORPHYNX_HUMAN_BRANCH_TRIM) ** 2;
    assert.ok(Math.abs(untrimmedPower - 1) < 1e-12, `mix ${index}% stays equal-power`);
    assert.ok(mix.humanGain <= MORPHYNX_HUMAN_BRANCH_TRIM + 1e-12);
  }
  assert.ok(Math.abs(morphynxMix(0).animalGain - 1) < 1e-12);
  assert.ok(Math.abs(morphynxMix(0).humanGain) < 1e-12);
  assert.ok(Math.abs(morphynxMix(1).animalGain) < 1e-12);
  assert.ok(Math.abs(morphynxMix(1).humanGain - MORPHYNX_HUMAN_BRANCH_TRIM) < 1e-12);
  const calibratingEndpoint = morphynxConfiguration({
    animal,
    voice,
    morph: 1,
    active: true,
    calibrateEndpoints: true,
  });
  assert.ok(calibratingEndpoint.animalSource.pressure > 0);
  assert.ok(calibratingEndpoint.humanSource.pressure > 0);
  assert.equal(morphynxConfiguration({
    animal,
    voice,
    morph: 1,
    active: true,
  }).animalSource.pressure, 0);
});

test("endpoint level matching follows RMS while bounding peaks and extreme corrections", () => {
  assert.equal(
    morphynxLevelMatchTrim({ rms: 0 }, { rms: 0 }, MORPHYNX_HUMAN_BRANCH_TRIM),
    MORPHYNX_HUMAN_BRANCH_TRIM,
  );
  assert.ok(Math.abs(morphynxLevelMatchTrim(
    { rms: 0.04, peak: 0.16 },
    { rms: 0.2, peak: 0.7 },
  ) - 0.2) < 1e-12);
  assert.equal(
    morphynxLevelMatchTrim(
      { rms: 0.4, peak: 0.8 },
      { rms: 0.001, peak: 0.002 },
    ),
    8,
  );
  const peakLimited = morphynxLevelMatchTrim(
    { rms: 0.05, peak: 0.1 },
    { rms: 0.01, peak: 0.2 },
  );
  assert.equal(peakLimited, 1);
  const adaptiveMix = morphynxMix(1, peakLimited);
  assert.equal(adaptiveMix.humanTrim, peakLimited);
  assert.equal(adaptiveMix.humanGain, peakLimited);
});

test("only vowels drive level matching while consonants preserve audible branch floors", () => {
  const animal = animalState("raven", { biologicalLock: false });
  const expectations = [
    ["a", true, 0.04],
    ["s", false, 0.65],
    ["t", false, 0.04],
    ["l", false, 0.55],
    ["m", false, 0.06],
    ["j", false, 0.65],
  ];

  for (const [phoneme, levelMatchEligible, minimumLevelTrim] of expectations) {
    const voice = morphynxVoiceState({ voicePreset: "clear", phoneme });
    const controls = humanizedControls(voice);
    const configuration = morphynxConfiguration({
      animal,
      voice,
      morph: 1,
      active: true,
      humanTrim: 0.04,
    });
    assert.equal(controls.levelMatchEligible, levelMatchEligible, `${phoneme} eligibility`);
    assert.equal(controls.minimumLevelTrim, minimumLevelTrim, `${phoneme} minimum trim`);
    assert.equal(configuration.mix.humanTrim, minimumLevelTrim, `${phoneme} effective trim`);
    assert.equal(configuration.mix.humanGain, minimumLevelTrim, `${phoneme} endpoint gain`);
  }

  const voice = morphynxVoiceState({ voicePreset: "clear", phoneme: "s" });
  assert.equal(morphynxConfiguration({
    animal,
    voice,
    morph: 1,
    active: true,
    humanTrim: 0.9,
  }).mix.humanTrim, 0.9, "an adaptive trim above the floor must remain intact");
});

test("performance source and tract macros remain sensitive at both endpoints", () => {
  const voice = morphynxVoiceState({ voicePreset: "clear", phoneme: "a" });
  const quiet = animalState("raven", {
    biologicalLock: false,
    pressure: 0.18,
    tension: 0.12,
    adduction: 0.16,
    roughness: 0.08,
    asymmetry: 0.1,
    sourceBalance: 0.2,
    tractLengthM: 0.08,
    mouthOpening: 0.12,
    cavityCoupling: 0.08,
  });
  const forceful = animalState("raven", {
    biologicalLock: false,
    pressure: 0.86,
    tension: 0.88,
    adduction: 0.9,
    roughness: 0.82,
    asymmetry: 0.9,
    sourceBalance: 0.8,
    tractLengthM: 0.48,
    mouthOpening: 0.9,
    cavityCoupling: 0.82,
  });
  const animalQuiet = morphynxConfiguration({ animal: quiet, voice, morph: 0, active: true });
  const animalForceful = morphynxConfiguration({ animal: forceful, voice, morph: 0, active: true });
  const humanQuiet = morphynxConfiguration({ animal: quiet, voice, morph: 1, active: true });
  const humanForceful = morphynxConfiguration({ animal: forceful, voice, morph: 1, active: true });

  for (const key of ["pressure", "tension", "adduction", "roughness", "asymmetry", "sourceBalance"]) {
    assert.ok(
      animalForceful.animalSource[key] > animalQuiet.animalSource[key],
      `${key} must move the animal endpoint`,
    );
    assert.ok(
      humanForceful.humanSource[key] > humanQuiet.humanSource[key],
      `${key} must move the human endpoint`,
    );
  }
  for (const key of ["tractLengthM", "mouthOpening", "cavityCoupling"]) {
    assert.ok(
      animalForceful.animalTract[key] > animalQuiet.animalTract[key],
      `${key} must move the animal tract`,
    );
    assert.ok(
      humanForceful.humanTract[key] > humanQuiet.humanTract[key],
      `${key} must move the human tract`,
    );
  }
});

test("alien anatomy counts reach the human source and tract payloads", () => {
  const animal = animalState("raven", { biologicalLock: false });
  const expectations = [
    ["triune", 3, 2, 2],
    ["hydra", 7, 5, 3],
  ];
  for (const [anatomyId, throatCount, tongueCount, noseCount] of expectations) {
    const voice = morphynxVoiceState({ anatomyId, phoneme: "i" });
    const configuration = morphynxConfiguration({ animal, voice, morph: 1, active: true });
    assert.equal(voice.throatCount, throatCount);
    assert.equal(voice.tongueCount, tongueCount);
    assert.equal(voice.noseCount, noseCount);
    assert.equal(configuration.humanSource.voiceCount, throatCount);
    assert.ok(configuration.humanSource.voiceSpreadCents > 0);
    assert.equal(configuration.human.tongueCount, tongueCount);
    assert.equal(configuration.human.noseCount, noseCount);
    assert.equal(configuration.humanTract.tongueEnabled, true);
    assert.equal(configuration.humanTract.tongueCount, tongueCount);
    assert.equal(configuration.humanTract.tongues.length, tongueCount);
    assert.equal(configuration.humanTract.cavityBranches, noseCount);
    assert.ok(configuration.humanTract.cavityCoupling > 0);
    for (const tongue of configuration.humanTract.tongues) {
      assert.equal(tongue.tongueEnabled, true);
      for (const key of ["tonguePosition", "tongueHeight", "tongueShape", "tongueTip"]) {
        assert.ok(Number.isFinite(tongue[key]), `${anatomyId}.${key} must be finite`);
      }
    }
  }
});

test("A, E, and I create distinct internal tongue-shaped tract profiles", () => {
  const animal = animalState("raven", { biologicalLock: false });
  const positions = Array.from({ length: 41 }, (_, index) => index / 40);
  const profiles = ["a", "e", "i"].map((phoneme) => {
    const voice = morphynxVoiceState({ voicePreset: "clear", phoneme });
    const configuration = morphynxConfiguration({ animal, voice, morph: 1, active: true });
    assert.equal(configuration.humanTract.tongueEnabled, true);
    return positions.map((position) => (
      applyTonguesToDiameter(position, 1.5, configuration.humanTract)
    ));
  });
  const signatures = profiles.map((profile) => profile.map((value) => value.toFixed(6)).join(":"));
  assert.equal(new Set(signatures).size, profiles.length);
  assert.equal(
    new Set(profiles.map((profile) => profile.indexOf(Math.min(...profile)))).size,
    profiles.length,
    "the vowel constrictions must occur at distinct tract positions",
  );
});

test("typed consonants reach the internal valve, noise, voicing, and release paths", () => {
  const animal = animalState("raven", { biologicalLock: false });
  const configurationFor = (phoneme) => morphynxConfiguration({
    animal,
    voice: morphynxVoiceState({ voicePreset: "clear", phoneme }),
    morph: 1,
    active: true,
  }).humanTract;
  const vowel = configurationFor("a");
  const fricative = configurationFor("s");
  const stop = configurationFor("t");
  const lateral = configurationFor("l");
  const nasal = configurationFor("m");

  assert.equal(vowel.airwayGate, null);
  assert.ok(fricative.airwayGate > 0 && fricative.airwayGate < 0.4);
  assert.ok(fricative.turbulence > 0.5);
  assert.ok(fricative.articulationVoicing < 0.1);
  assert.equal(stop.airwayGate, 0);
  assert.ok(stop.articulationPressure > 0.9);
  assert.ok(stop.burstGain > 0.8);
  assert.ok(stop.gatePosition > 0.8);
  assert.ok(lateral.lateralBypass > 0.5);
  assert.ok(nasal.cavityBranches >= 1);
  assert.ok(nasal.cavityCoupling > vowel.cavityCoupling);
  assert.ok(nasal.nasalBypass > 0.5);
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
  assert.match(app, /configuration\.animalSource/);
  assert.match(app, /configuration\.humanSource/);
  assert.match(app, /animalMorphGain/);
  assert.match(app, /humanMorphGain/);
  assert.match(app, /receiveBranchTelemetry/);
  assert.match(app, /calibrateEndpoints:\s*!levelMatchReady/);
  assert.match(app, /levelMatchSamples\s*>=\s*24/);
  assert.match(css, /\.morphynx-phoneme-grid/);
  assert.match(css, /\.morphynx-stage-axis/);
  assert.match(css, /orientation:\s*landscape[\s\S]*grid-template-columns:[\s\S]*\.morphynx-page \.panel[\s\S]*overflow-y:\s*auto/);
  assert.match(html, /href="morphynx\.css\?v=morphynx-responsive-[^"]+"/);
  assert.ok(iconStat.size > 1_000);
  assert.equal(icon.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(icon.subarray(8, 12).toString("ascii"), "WEBP");
});

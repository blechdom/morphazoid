import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import { instrumentById } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";
import {
  HICCUP_HEAD_DEFAULTS,
  HICCUP_HEAD_GESTURE_CHANNELS,
  HICCUP_HEAD_GESTURE_TRAJECTORIES,
  HICCUP_HEAD_LIMITS,
  HICCUP_HEAD_PATTERNS,
  HICCUP_HEAD_PRESETS,
  HICCUP_HEAD_SOUND_BANKS,
  HICCUP_HEAD_SOUND_BANK_OUTPUT_TRIMS,
  HICCUP_HEAD_SOUNDS,
  HICCUP_HEAD_STEP_COUNT,
  HICCUP_HEAD_TOOTH_GAP_ANATOMY,
  HICCUP_HEAD_TOOTH_TINE_PROFILES,
  HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
  HICCUP_HEAD_TRACT_LANDMARKS,
  HICCUP_HEAD_TRACT_SECTION_COUNT,
  HICCUP_HEAD_VELOCITIES,
  HICCUP_HEAD_VOICE_CHARACTERS,
  HICCUP_HEAD_VOICE_LIMITS,
  HICCUP_HEAD_VOICE_MODULATION_LIMITS,
  HICCUP_HEAD_VOICE_MODULATION_SOURCES,
  HICCUP_HEAD_VOICE_MODULATION_TARGETS,
  HICCUP_HEAD_VOICE_SOUND_IDS,
  applyHiccupHeadSoundBank,
  clamp,
  clonePattern,
  cycleStepVelocity,
  hiccupHeadBaseOralDiameters,
  hiccupHeadFormants,
  hiccupHeadGestureFrame,
  hiccupHeadGestureFrameAtSample,
  hiccupHeadGeometry,
  hiccupHeadOralTractProfile,
  hiccupHeadPattern,
  hiccupHeadPoseForSound,
  hiccupHeadSoundBank,
  hiccupHeadSoundBankOutputGain,
  hiccupHeadSound,
  hiccupHeadState,
  hiccupHeadTargetOralDiameters,
  hiccupHeadVoiceCharacter,
  mutateHiccupHeadVoice,
  patternEventsAtStep,
  physicalVoiceParameters,
  randomizeHiccupHeadVoice,
  randomizeHiccupHeadState,
  randomizePattern,
  sanitizeHiccupHeadVoice,
  sanitizeHiccupHeadVoiceModulation,
  sampleHiccupHeadGestureCurve,
  sanitizeHiccupHeadState,
  sanitizePattern,
  sequenceStepIntervalSeconds,
} from "../src/hiccup-head.js";

const root = new URL("../", import.meta.url);
const ORIGINAL_SOUND_IDS = Object.freeze([
  "bop",
  "boop",
  "pop",
  "tlik",
  "shh",
  "shack",
  "slap",
  "pff",
  "kick",
  "smack",
  "hee",
  "haw",
  "doo",
  "mwah",
  "kiss",
  "drr",
  "burp",
  "aah",
  "ooh",
  "wail",
  "yodel",
  "growl",
  "holler",
  "hum",
  "rattle",
]);
const SOUND_IDS = Object.freeze([
  ...ORIGINAL_SOUND_IDS,
  "whistle",
  "grunt",
  "moan",
  "lala",
  "pbpb",
  "slurp",
  "hiccup",
  "eef",
  "snare",
  "snap",
  "tomlo",
  "tomhi",
  "braap",
  "brush",
  "huff",
  "waow",
  "whoop",
  "doodoo",
  "llll",
  "purr",
  "klikklak",
  "rrrr",
  "lrroll",
  "lalatrip",
  "hiccuplong",
  "zzzz",
  "ehyeah",
]);

const SOUND_KEYS = Object.freeze([
  "1", "2", "3", "4", "5", "6", "7", "8",
  "9", "0", "q", "w", "e", "r", ";", "t",
  "y", "u", "i", "o", "p", "a", "s", "d",
  "f", "g", "h", "j", "k", "l",
  "z", "x", "c", "v", "b", "n", "m", ",", ".",
  "[", "]", "-", "=", "/", "\\",
  "'", "`", ":", "!", "?", "@", "#",
]);

function assertFiniteTree(value, label = "value", seen = new Set()) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} must be finite`);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertFiniteTree(child, `${label}.${key}`, seen);
  }
}

function assertBoundedState(state, label = "state") {
  for (const [key, [minimum, maximum]] of Object.entries(HICCUP_HEAD_LIMITS)) {
    assert.ok(Number.isFinite(state[key]), `${label}.${key} must be finite`);
    assert.ok(
      state[key] >= minimum && state[key] <= maximum,
      `${label}.${key} must stay in ${minimum}..${maximum}`,
    );
  }
}

function roundedSignature(values) {
  return values.map((value) => Number(value).toFixed(4)).join("|");
}

test("Hiccup Head preserves its original twenty-five sounds and adds twenty-seven complete mouth identities", () => {
  assert.deepEqual(HICCUP_HEAD_SOUNDS.map(({ id }) => id), SOUND_IDS);
  assert.deepEqual(HICCUP_HEAD_SOUNDS.slice(0, 25).map(({ id }) => id), ORIGINAL_SOUND_IDS);
  assert.equal(HICCUP_HEAD_SOUNDS.length, SOUND_IDS.length);
  assert.equal(new Set(HICCUP_HEAD_SOUNDS.map(({ id }) => id)).size, SOUND_IDS.length);
  assert.equal(new Set(HICCUP_HEAD_SOUNDS.map(({ key }) => key)).size, SOUND_IDS.length);
  assert.equal(new Set(HICCUP_HEAD_SOUNDS.map(({ color }) => color)).size, SOUND_IDS.length);
  assert.deepEqual(HICCUP_HEAD_SOUNDS.map(({ key }) => key), SOUND_KEYS);

  for (const sound of HICCUP_HEAD_SOUNDS) {
    assert.equal(hiccupHeadSound(sound.id), sound);
    assert.ok(sound.label.length > 0, `${sound.id} needs a visible label`);
    assert.ok(sound.subtitle.length > 0, `${sound.id} needs an articulatory subtitle`);
    assert.ok(sound.family.length > 0, `${sound.id} needs a physical source family`);
    assert.ok(sound.description.length > 24, `${sound.id} needs a physical description`);
  }
  assert.equal(hiccupHeadSound("shh").label, "PHSHSHK");
  assert.match(hiccupHeadSound("shh").description, /PH puff[\s\S]*K cut/i);
  assert.equal(HICCUP_HEAD_SOUNDS.some(({ label }) => label === "SHHH"), false);
  assert.equal(hiccupHeadSound("pff").label, "PFRR");
  assert.equal(hiccupHeadSound("pff").subtitle, "pressure lip roll");
  assert.deepEqual(
    {
      id: hiccupHeadSound("whistle").id,
      label: hiccupHeadSound("whistle").label,
      subtitle: hiccupHeadSound("whistle").subtitle,
      key: hiccupHeadSound("whistle").key,
      family: hiccupHeadSound("whistle").family,
    },
    {
      id: "whistle",
      label: "FWEE",
      subtitle: "missing-tooth whistle",
      key: "g",
      family: "tooth-whistle",
    },
  );
  assert.match(hiccupHeadSound("whistle").description, /missing upper front tooth[\s\S]*oral tube/i);
  assert.deepEqual(
    HICCUP_HEAD_SOUNDS.slice(31).map(({ id, label, key }) => ({ id, label, key })),
    [
      { id: "hiccup", label: "HIC!", key: "x" },
      { id: "eef", label: "EEF!", key: "c" },
      { id: "snare", label: "KSH!", key: "v" },
      { id: "snap", label: "SNAP", key: "b" },
      { id: "tomlo", label: "TOM-L", key: "n" },
      { id: "tomhi", label: "TOM-H", key: "m" },
      { id: "braap", label: "BRRAP", key: "," },
      { id: "brush", label: "BRUSH", key: "." },
      { id: "huff", label: "HUFF", key: "[" },
      { id: "waow", label: "WAOW", key: "]" },
      { id: "whoop", label: "WHOOP", key: "-" },
      { id: "doodoo", label: "DOO-DOO", key: "=" },
      { id: "llll", label: "LLLL", key: "/" },
      { id: "purr", label: "PURR", key: "\\" },
      { id: "klikklak", label: "KLIK-KLAK", key: "'" },
      { id: "rrrr", label: "RRRR", key: "`" },
      { id: "lrroll", label: "L-R-L-R", key: ":" },
      { id: "lalatrip", label: "LA-LA-LA", key: "!" },
      { id: "hiccuplong", label: "HICCUP!", key: "?" },
      { id: "zzzz", label: "ZZZZ", key: "@" },
      { id: "ehyeah", label: "EH-YEAH", key: "#" },
    ],
  );
  assert.equal(hiccupHeadSound("not-a-mouth-noise").id, "bop");
});

test("Pink-style singing and breath gaps add six finite, independent physical gestures", () => {
  const addedIds = ["huff", "waow", "whoop", "doodoo", "llll", "purr"];
  const signatures = new Set();
  for (const soundId of addedIds) {
    const plan = physicalVoiceParameters(soundId, HICCUP_HEAD_DEFAULTS, 1);
    const pose = hiccupHeadPoseForSound(soundId, HICCUP_HEAD_DEFAULTS);
    assertFiniteTree(plan, `${soundId}.plan`);
    assertBoundedState(pose, `${soundId}.pose`);
    assert.equal(plan.soundId, soundId);
    assert.equal(plan.family, hiccupHeadSound(soundId).family);
    assert.ok(plan.durationSeconds > 0.4 && plan.durationSeconds < 1.4);
    assert.ok(plan.vibratoRateHz >= 0 && plan.vibratoRateHz <= 12);
    assert.ok(plan.vibratoDepthSemitones >= 0 && plan.vibratoDepthSemitones <= 5);
    signatures.add(roundedSignature([
      plan.durationSeconds,
      plan.glottalFrequencyHz,
      plan.vibratoRateHz,
      plan.vibratoDepthSemitones,
      plan.registerJumpSemitones,
      plan.noiseCenterHz,
      ...plan.formantFrequenciesHz,
    ]));
  }
  assert.equal(signatures.size, addedIds.length, "the six gap-filling defaults need distinct plans");

  const huff = hiccupHeadGestureFrame("huff", 0.5);
  assert.ok(huff.aspiration > 0.9 && huff.voicing < 0.08, "HUFF must fill the long breath region");
  assert.ok(hiccupHeadGestureFrame("waow", 0.85).vowelMorph > 0.9);
  assert.ok(hiccupHeadGestureFrame("waow", 0.06).vowelMorph < 0.08);
  assert.ok(hiccupHeadGestureFrame("waow", 0.22).vowelMorph >= 0.5);
  assert.ok(hiccupHeadGestureFrame("whoop", 0.5).registerLift > 0.95);
  assert.ok(hiccupHeadGestureFrame("whoop", 0.1).registerLift < 0.08);
  assert.ok(hiccupHeadGestureFrame("doodoo", 0.45).voicing < 0.5);
  assert.ok(hiccupHeadGestureFrame("doodoo", 0.7).registerLift > 0.95);
  assert.ok(hiccupHeadGestureFrame("llll", 0.5).tongueContact > 0.9);
  const purrPlan = physicalVoiceParameters("purr", HICCUP_HEAD_DEFAULTS, 1);
  assert.ok(purrPlan.glottalFrequencyHz < 55);
  assert.ok(purrPlan.roughness >= 0.5 && purrPlan.subharmonicMix >= 0.6);
});

test("ZZZZ and EH-YEAH fill sustained fricative and three-vowel tract gaps", () => {
  const zzzz = hiccupHeadGestureFrame("zzzz", 0.5);
  assert.ok(zzzz.voicing > 0.8, "ZZZZ needs sustained vocal-fold energy");
  assert.ok(zzzz.turbulence > 0.8, "ZZZZ needs sustained turbulent energy");
  assert.ok(zzzz.constrictionPosition >= 0.82 && zzzz.constrictionPosition <= 0.85);
  assert.ok(zzzz.constriction > 0.6, "the tongue groove must remain physically narrow");
  assert.ok(zzzz.secondaryConstrictionPosition > 0.94);
  assert.ok(zzzz.secondaryConstriction > 0.65, "the jet must meet the anterior tooth edge");
  assert.equal(zzzz.toothJet, 0, "ZZZZ must not reuse the coherent FWEE whistle oscillator");

  const zSlow = physicalVoiceParameters("zzzz", { ...HICCUP_HEAD_DEFAULTS, tempo: 60 }, 0.72);
  const zFast = physicalVoiceParameters("zzzz", { ...HICCUP_HEAD_DEFAULTS, tempo: 400 }, 0.72);
  assert.ok(zSlow.durationSeconds > zFast.durationSeconds * 1.5);
  assert.ok(zFast.durationSeconds > physicalVoiceParameters("shh", HICCUP_HEAD_DEFAULTS, 0.72).durationSeconds * 2.5);

  const eh = hiccupHeadGestureFrame("ehyeah", 0.12);
  const ee = hiccupHeadGestureFrame("ehyeah", 0.52);
  const ah = hiccupHeadGestureFrame("ehyeah", 0.9);
  assert.ok(Math.abs(eh.tongueBodyIndex - 20) < 0.5);
  assert.ok(Math.abs(eh.tongueBodyDiameterCm - 3.35) < 0.08);
  assert.ok(Math.abs(ee.tongueBodyIndex - 27.4) < 0.01);
  assert.ok(Math.abs(ee.tongueBodyDiameterCm - 2.25) < 0.01);
  assert.ok(Math.abs(ah.tongueBodyIndex - 13) < 0.01);
  assert.ok(Math.abs(ah.tongueBodyDiameterCm - 2.4) < 0.01);
  assert.ok(eh.voicing > 0.55 && ee.voicing > 0.9 && ah.voicing > 0.8);

  const ehPlan = physicalVoiceParameters("ehyeah", HICCUP_HEAD_DEFAULTS, 0.72);
  const waowPlan = physicalVoiceParameters("waow", HICCUP_HEAD_DEFAULTS, 0.72);
  assert.ok(ehPlan.vibratoRateHz > 4.5);
  assert.ok(ehPlan.vibratoDepthSemitones > waowPlan.vibratoDepthSemitones + 0.5);
  assert.ok(
    physicalVoiceParameters("ehyeah", { ...HICCUP_HEAD_DEFAULTS, tempo: 60 }, 0.72).durationSeconds
      > physicalVoiceParameters("ehyeah", { ...HICCUP_HEAD_DEFAULTS, tempo: 400 }, 0.72).durationSeconds * 1.5,
  );
});

test("ZZZZ and EH-YEAH render present finite bodies without reaching the safety ceiling", async () => {
  const globalKeys = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originals = new Map(globalKeys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const processors = new Map();
  Object.defineProperty(globalThis, "sampleRate", {
    configurable: true,
    writable: true,
    value: 48_000,
  });
  Object.defineProperty(globalThis, "AudioWorkletProcessor", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        this.messages = [];
        this.port = {
          onmessage: null,
          postMessage: (message) => this.messages.push(message),
        };
      }
    },
  });
  Object.defineProperty(globalThis, "registerProcessor", {
    configurable: true,
    writable: true,
    value: (name, Constructor) => processors.set(name, Constructor),
  });

  try {
    await import(`../src/hiccup-head-processor.js?zzzz-ehyeah=${Date.now()}-${Math.random()}`);
    const Processor = processors.get("hiccup-head-physical-model");
    assert.equal(typeof Processor, "function");
    const renderMetrics = (soundId) => {
      const processor = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
      processor._handleMessage({ type: "strike", soundId, velocity: 0.72 });
      let energy = 0;
      let peak = 0;
      let activeSamples = 0;
      const frameCount = 480 * 128;
      for (let block = 0; block < 480; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        processor.process([], [[left, right]]);
        for (let index = 0; index < left.length; index += 1) {
          assert.ok(Number.isFinite(left[index]) && Number.isFinite(right[index]));
          const mono = (left[index] + right[index]) * 0.5;
          energy += mono * mono;
          peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
          if (Math.max(Math.abs(left[index]), Math.abs(right[index])) > 1e-5) activeSamples += 1;
        }
      }
      return { rms: Math.sqrt(energy / frameCount), peak, activeSamples };
    };

    const zzzz = renderMetrics("zzzz");
    const ehyeah = renderMetrics("ehyeah");
    assert.ok(zzzz.rms >= 0.03 && zzzz.rms <= 0.12);
    assert.ok(ehyeah.rms >= 0.025 && ehyeah.rms <= 0.1);
    assert.ok(zzzz.peak >= 0.12 && zzzz.peak < 0.59);
    assert.ok(ehyeah.peak >= 0.1 && ehyeah.peak < 0.59);
    assert.ok(zzzz.activeSamples > 24_000);
    assert.ok(ehyeah.activeSamples > 30_000);
  } finally {
    for (const key of globalKeys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("seven contrasting sound banks retune anatomy without overwriting live face effects", () => {
  const expectedIds = [
    "natural-mouth",
    "wet-rubber",
    "tongue-workshop",
    "open-throat",
    "rough-cellar",
    "tiny-cartoon",
    "air-pockets",
  ];
  assert.deepEqual(HICCUP_HEAD_SOUND_BANKS.map(({ id }) => id), expectedIds);
  assert.equal(new Set(expectedIds).size, HICCUP_HEAD_SOUND_BANKS.length);
  assert.equal(Object.isFrozen(HICCUP_HEAD_SOUND_BANK_OUTPUT_TRIMS), true);

  const source = sanitizeHiccupHeadState({
    ...HICCUP_HEAD_DEFAULTS,
    tempo: 187,
    swing: 0.23,
    humanize: 0.17,
    level: 0.69,
    nasalMix: 0.83,
    dooPitch: 7,
    earSpread: 1.24,
    leftHairLength: 1.48,
    rightHairLength: 0.72,
    leftHairAngle: -0.44,
    rightHairAngle: 0.58,
    eyeDivergence: 0.62,
    leftEyeClosure: 0.31,
    rightEyeClosure: 0.78,
    leftBrow: 0.75,
    rightBrow: 1,
  });
  const protectedKeys = [
    "tempo", "swing", "humanize", "level", "nasalMix", "dooPitch", "earSpread",
    "leftHairLength", "rightHairLength", "leftHairAngle", "rightHairAngle",
    "eyeDivergence", "eyeClosure", "leftEyeClosure", "rightEyeClosure",
    "leftBrow", "rightBrow",
  ];
  const signatures = new Set();
  for (const bank of HICCUP_HEAD_SOUND_BANKS) {
    assert.equal(hiccupHeadSoundBank(bank.id), bank);
    assert.equal(Object.isFrozen(bank), true);
    assert.equal(Object.isFrozen(bank.characterIds), true);
    assert.equal(Object.isFrozen(bank.settings), true);
    assert.equal(bank.characterIds.length, 4);
    assert.ok(bank.label.length > 0 && bank.description.length > 30);

    const applied = applyHiccupHeadSoundBank(source, bank.id, 1);
    assertBoundedState(applied, bank.id);
    assertFiniteTree(applied, bank.id);
    for (const key of protectedKeys) {
      assert.equal(applied[key], source[key], `${bank.id} must preserve live ${key}`);
      assert.equal(Object.hasOwn(bank.settings, key), false, `${bank.id} must not own live ${key}`);
    }
    signatures.add(roundedSignature([
      applied.lungPressure,
      applied.lipTension,
      applied.lipRounding,
      applied.cheekVolume,
      applied.cheekTension,
      applied.tonguePosition,
      applied.tongueCurl,
      applied.tongueOut,
      applied.mouthOpening,
      applied.tractLengthM,
      applied.silliness,
      applied.decay,
    ]));
  }
  assert.equal(signatures.size, HICCUP_HEAD_SOUND_BANKS.length);
  assert.deepEqual(applyHiccupHeadSoundBank(source, "natural-mouth", 1), source);
  assert.deepEqual(applyHiccupHeadSoundBank(source, "rough-cellar", 0), source);
  assert.equal(hiccupHeadSoundBank("missing-bank"), HICCUP_HEAD_SOUND_BANKS[0]);
  assert.equal(hiccupHeadSoundBankOutputGain("natural-mouth", "pff"), 1);
  assert.equal(hiccupHeadSoundBankOutputGain("wet-rubber", "whistle"), 0.76);
  assert.equal(hiccupHeadSoundBankOutputGain("tongue-workshop", "tlik"), 1.62);
  assert.equal(hiccupHeadSoundBankOutputGain("open-throat", "pff"), 0.246);
  assert.equal(hiccupHeadSoundBankOutputGain("rough-cellar", "pff"), 0.683);
  assert.equal(hiccupHeadSoundBankOutputGain("rough-cellar", "whistle"), 0.73);
  assert.equal(hiccupHeadSoundBankOutputGain("tiny-cartoon", "pop"), 0.96);
  assert.equal(hiccupHeadSoundBankOutputGain("tiny-cartoon", "moan"), 0.94);
  assert.equal(hiccupHeadSoundBankOutputGain("missing-bank", "whistle"), 1);

  const roughState = applyHiccupHeadSoundBank(HICCUP_HEAD_DEFAULTS, "rough-cellar", 1);
  const roughR = hiccupHeadPoseForSound("rrrr", roughState);
  const naturalR = hiccupHeadPoseForSound("rrrr", HICCUP_HEAD_DEFAULTS);
  assert.notEqual(
    roughR.tractLengthM,
    naturalR.tractLengthM,
    "gesture poses must preserve the bank's audible tract-length mutation",
  );
  assert.notEqual(
    roughR.mouthOpening,
    naturalR.mouthOpening,
    "gesture poses must apply relative to the selected sound-bank anatomy",
  );
});

test("measured bank trims travel with each strike and act after the presence knee", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  assert.match(app, /hiccupHeadSoundBankOutputGain\(currentSoundBankId, soundId\)/);
  assert.match(app, /bankOutputGain !== 1 \? \{ bankOutputGain \} : \{\}/);
  assert.match(processor, /this\.bankOutputGain = clamp\(finite\(event\.bankOutputGain, 1\), 0\.2, 1\.8\)/);
  assert.match(processor, /const bankOutputGain = clamp\(finite\(message\.bankOutputGain, 1\), 0\.2, 1\.8\)/);
  assert.match(
    processor,
    /const gesturePostGain = GESTURE_POST_GAIN[\s\S]*?boundedLeft \*= gesturePostGain \* bankOutputGain/,
  );
});

test("new tongue phrases and full HICCUP occupy distinct rhythmic articulations", () => {
  const addedIds = ["klikklak", "rrrr", "lrroll", "lalatrip", "hiccuplong"];
  const planSignatures = new Set();
  for (const soundId of addedIds) {
    const plan = physicalVoiceParameters(soundId, HICCUP_HEAD_DEFAULTS, 1);
    assertFiniteTree(plan, `${soundId}.plan`);
    assert.ok(plan.durationSeconds >= 0.3, `${soundId} must not collapse into a tiny plip`);
    planSignatures.add(roundedSignature([
      plan.durationSeconds,
      plan.glottalFrequencyHz,
      plan.trillFrequencyHz,
      plan.registerJumpSemitones,
      plan.roughness,
      ...plan.formantFrequenciesHz,
    ]));
  }
  assert.equal(planSignatures.size, addedIds.length);

  const countBooleanFalls = (soundId, channel, threshold) => {
    const states = Array.from({ length: 1_001 }, (_, index) => (
      hiccupHeadGestureFrame(soundId, index / 1_000)[channel] > threshold
    ));
    return states.slice(1).filter((active, index) => states[index] && !active).length;
  };
  assert.equal(
    countBooleanFalls("klikklak", "tongueContact", 0.6),
    4,
    "KLIK-KLAK needs four separate tongue-contact releases",
  );
  assert.equal(
    countBooleanFalls("lalatrip", "tongueContact", 0.6),
    3,
    "LA-LA-LA needs three separate tongue syllables",
  );
  assert.equal(
    countBooleanFalls("hiccuplong", "diaphragmCatch", 0.5),
    2,
    "full HICCUP needs two diaphragm catches",
  );

  assert.ok(hiccupHeadGestureFrame("rrrr", 0.5).tongueTrill > 0.9);
  assert.ok(
    physicalVoiceParameters("rrrr", HICCUP_HEAD_DEFAULTS, 1).durationSeconds
      > physicalVoiceParameters("drr", HICCUP_HEAD_DEFAULTS, 1).durationSeconds,
    "RRRR must sustain longer than the compact DRR",
  );
  const firstL = hiccupHeadGestureFrame("lrroll", 0.12);
  const firstR = hiccupHeadGestureFrame("lrroll", 0.32);
  const secondL = hiccupHeadGestureFrame("lrroll", 0.55);
  const secondR = hiccupHeadGestureFrame("lrroll", 0.8);
  assert.ok(firstL.lateralBypass > 0.6 && firstL.tongueTrill < 0.01);
  assert.ok(firstR.tongueTrill > 0.8 && firstR.lateralBypass < 0.08);
  assert.ok(secondL.lateralBypass > 0.6 && secondL.tongueTrill < 0.01);
  assert.ok(secondR.tongueTrill > 0.8 && secondR.lateralBypass < 0.08);
  assert.ok(hiccupHeadGestureFrame("lalatrip", 0.4).registerLift > 0.45);
  assert.ok(hiccupHeadGestureFrame("hiccuplong", 0.88).secondaryConstriction > 0.9);
  assert.ok(
    physicalVoiceParameters("hiccuplong", HICCUP_HEAD_DEFAULTS, 1).durationSeconds
      > physicalVoiceParameters("hiccup", HICCUP_HEAD_DEFAULTS, 1).durationSeconds * 1.8,
  );
});

test("voice-capable sounds come from model metadata and include formerly omitted mouth voices", async () => {
  const derivedVoiceIds = HICCUP_HEAD_SOUNDS
    .filter(({ voiceCapable }) => voiceCapable)
    .map(({ id }) => id);
  assert.deepEqual(HICCUP_HEAD_VOICE_SOUND_IDS, derivedVoiceIds);
  assert.equal(new Set(HICCUP_HEAD_VOICE_SOUND_IDS).size, HICCUP_HEAD_VOICE_SOUND_IDS.length);
  for (const soundId of [
    "kiss", "pbpb", "hiccup", "eef", "braap",
    "huff", "waow", "whoop", "doodoo", "llll", "purr",
    "rrrr", "lrroll", "lalatrip", "hiccuplong", "zzzz", "ehyeah",
  ]) {
    assert.ok(HICCUP_HEAD_VOICE_SOUND_IDS.includes(soundId), `${soundId} needs voice assignment`);
    assert.equal(hiccupHeadSound(soundId).voiceCapable, true);
  }

  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.match(app, /HICCUP_HEAD_VOICE_SOUND_IDS,/);
  assert.match(app, /const VOICE_SOUND_IDS = new Set\(HICCUP_HEAD_VOICE_SOUND_IDS\)/);
  assert.match(app, /\.filter\(\(sound\) => VOICE_SOUND_IDS\.has\(sound\.id\)\)/);
});

test("FWEE drives a bounded edge jet through the missing upper-left central incisor", () => {
  assert.equal(Object.isFrozen(HICCUP_HEAD_TOOTH_GAP_ANATOMY), true);
  assert.equal(Object.isFrozen(HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers), true);
  assert.equal(HICCUP_HEAD_TOOTH_GAP_ANATOMY.missingTooth, "upper-left central incisor");
  assert.deepEqual(HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers, [0.14, 0.2, 0.27]);
  assert.ok(HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapWidthCm > 0.5);
  assert.ok(HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapHeightCm > 0.5);
  assert.ok(HICCUP_HEAD_TOOTH_GAP_ANATOMY.jetSlotHeightCm > 0);
  assert.ok(
    Math.abs(
      HICCUP_HEAD_TOOTH_GAP_ANATOMY.jetSlotAreaCm2
      - HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapWidthCm
        * HICCUP_HEAD_TOOTH_GAP_ANATOMY.jetSlotHeightCm
    ) < 1e-12,
  );
  assert.ok(
    HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection
      > HICCUP_HEAD_TRACT_LANDMARKS.alveolar,
  );
  assert.ok(
    HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection
      < HICCUP_HEAD_TRACT_LANDMARKS.lips,
  );

  const onset = hiccupHeadGestureFrame("whistle", 0.02);
  const sustained = hiccupHeadGestureFrame("whistle", 0.5);
  const released = hiccupHeadGestureFrame("whistle", 1);
  assert.equal(onset.toothJet, 0);
  assert.ok(sustained.toothJet > 0.9);
  assert.ok(sustained.pressure > 0.75);
  assert.equal(sustained.voicing, 0, "FWEE must use its tooth-edge jet, not vocal folds");
  assert.ok(released.toothJet < 0.001);

  const plan = physicalVoiceParameters("whistle", HICCUP_HEAD_DEFAULTS, 1);
  assert.equal(plan.soundId, "whistle");
  assert.equal(plan.family, "tooth-whistle");
  assert.equal(plan.toothGapCanonicalSection, HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection);
  assert.equal(plan.toothGapWidthCm, HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapWidthCm);
  assert.equal(plan.toothGapHeightCm, HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapHeightCm);
  assert.deepEqual(plan.toothWhistleStrouhalNumbers, HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers);
  assert.ok(plan.toothJetSlotHeightCm >= 0.026 && plan.toothJetSlotHeightCm <= 0.16);
  assert.ok(Math.abs(plan.toothJetAreaCm2 - plan.toothGapWidthCm * plan.toothJetSlotHeightCm) < 1e-12);
  assert.ok(plan.toothJetImpingementLengthM >= 0.00072);
  assert.ok(plan.toothJetImpingementLengthM <= 0.0038);
  assert.ok(plan.toothWhistleMaximumPressurePa > 1_000);

  const target = hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, sustained);
  assert.equal(target.length, HICCUP_HEAD_TRACT_SECTION_COUNT);
  assert.ok(target.every(Number.isFinite));
});

test("BRUSH sends one composite gesture and sweeps all teeth upward and downward in the worklet", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const postStrikeSource = app.slice(
    app.indexOf("function postStrike("),
    app.indexOf("async function triggerSound("),
  );
  assert.equal(
    (postStrikeSource.match(/sourceNode\.port\.postMessage\(/g) ?? []).length,
    1,
    "BRUSH must remain one worklet event rather than twelve timer messages",
  );
  assert.match(postStrikeSource, /soundId === "brush"[\s\S]*?brushDirection = nextBrushDirection[\s\S]*?nextBrushDirection \*= -1/);
  assert.match(postStrikeSource, /\.\.\.\(soundId === "brush" \? \{ brushDirection \} : \{\}\)/);
  assert.doesNotMatch(postStrikeSource, /triggerSound\("tlik"|setTimeout\(/);

  const globalKeys = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originals = new Map(globalKeys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const processors = new Map();
  Object.defineProperty(globalThis, "sampleRate", {
    configurable: true,
    writable: true,
    value: 48_000,
  });
  Object.defineProperty(globalThis, "AudioWorkletProcessor", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        this.messages = [];
        this.port = {
          onmessage: null,
          postMessage: (message) => this.messages.push(message),
        };
      }
    },
  });
  Object.defineProperty(globalThis, "registerProcessor", {
    configurable: true,
    writable: true,
    value: (name, Constructor) => processors.set(name, Constructor),
  });

  try {
    await import(`../src/hiccup-head-processor.js?brush-order=${Date.now()}-${Math.random()}`);
    const Processor = processors.get("hiccup-head-physical-model");
    assert.equal(typeof Processor, "function");
    const ascending = HICCUP_HEAD_TOOTH_TINE_PROFILES.map((_, toothIndex) => toothIndex);

    for (const [direction, expectedContacts] of [[1, ascending], [-1, [...ascending].reverse()]]) {
      const processor = new Processor({
        processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
      });
      const contacts = [];
      const strikeNow = processor.tract.toothTine.strikeNow;
      processor.tract.toothTine.strikeNow = function recordBrushContact(metadata, ...args) {
        contacts.push(metadata.toothIndex);
        return strikeNow.call(this, metadata, ...args);
      };
      processor._handleMessage({
        type: "strike",
        soundId: "brush",
        velocity: 0.82,
        brushDirection: direction,
      });
      assert.equal(processor.queue.length, 1, "one BRUSH message must create one queued gesture");
      assert.equal(processor.queue[0].soundId, "brush");
      assert.equal(processor.queue[0].brushDirection, direction);
      assert.equal(processor.queue[0].toothTine, null);

      for (let block = 0; block < 400; block += 1) {
        processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
      }
      assert.deepEqual(contacts, expectedContacts);
      const telemetryContacts = [];
      for (const message of processor.messages.filter(({ type }) => type === "telemetry")) {
        const toothIndex = message.toothTineIndex;
        if (toothIndex < 0 || toothIndex === telemetryContacts.at(-1)) continue;
        telemetryContacts.push(toothIndex);
      }
      assert.deepEqual(
        telemetryContacts,
        expectedContacts,
        "telemetry must reveal the internal ascending or descending tooth contact order",
      );
    }

    for (const [direction, expectedContacts] of [[1, ascending], [-1, [...ascending].reverse()]]) {
      const processor = new Processor({
        processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
      });
      const contacts = [];
      const strikeNow = processor.tract.toothTine.strikeNow;
      processor.tract.toothTine.strikeNow = function recordPreemptedBrush(metadata, ...args) {
        contacts.push(metadata.toothIndex);
        return strikeNow.call(this, metadata, ...args);
      };
      processor._handleMessage({
        type: "strike",
        soundId: "brush",
        velocity: 0.82,
        delaySeconds: 0.02,
        gestureDurationSeconds: 0.024,
        brushDirection: direction,
      });
      processor._handleMessage({
        type: "strike",
        soundId: "hiccuplong",
        velocity: 0.82,
        delaySeconds: 0.05,
      });
      for (let block = 0; block < 100; block += 1) {
        const left = new Float32Array(128);
        const right = new Float32Array(128);
        processor.process([], [[left, right]]);
        assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
      }
      assert.deepEqual(
        contacts,
        expectedContacts,
        "future mouth preparation must not steal BRUSH's internal tooth clock",
      );
    }

    const renderBrushKissHandoff = (includeKiss) => {
      const processor = new Processor({
        processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
      });
      processor._handleMessage({
        type: "strike",
        soundId: "brush",
        velocity: 0.72,
        delaySeconds: 0.072,
        gestureDurationSeconds: 0.092,
      });
      if (includeKiss) {
        processor._handleMessage({
          type: "strike",
          soundId: "kiss",
          velocity: 0.72,
          delaySeconds: 0.199,
        });
      }
      const frameCount = Math.round(0.58 * 48_000);
      const left = new Float32Array(frameCount);
      const right = new Float32Array(frameCount);
      for (let offset = 0; offset < frameCount; offset += 128) {
        processor.process([], [[
          left.subarray(offset, Math.min(frameCount, offset + 128)),
          right.subarray(offset, Math.min(frameCount, offset + 128)),
        ]]);
      }
      return { left, right };
    };
    const brushOnly = renderBrushKissHandoff(false);
    const brushThenKiss = renderBrushKissHandoff(true);
    const preservedTailEnd = Math.floor((0.199 - 0.012) * 48_000);
    assert.deepEqual(
      brushThenKiss.left.slice(0, preservedTailEnd),
      brushOnly.left.slice(0, preservedTailEnd),
      "queued KISS preparation must leave BRUSH and its audible tail untouched",
    );
    const preReleasePeak = Math.max(
      ...brushThenKiss.left.slice(0, Math.floor(0.199 * 48_000)).map(Math.abs),
      ...brushThenKiss.right.slice(0, Math.floor(0.199 * 48_000)).map(Math.abs),
    );
    assert.ok(
      preReleasePeak < 0.45,
      "KISS preparation must stay silent instead of pinning the presence ceiling",
    );
    const kissPreparationPeak = Math.max(
      ...brushThenKiss.left.slice(preservedTailEnd, Math.floor(0.199 * 48_000)).map(Math.abs),
      ...brushThenKiss.right.slice(preservedTailEnd, Math.floor(0.199 * 48_000)).map(Math.abs),
    );
    assert.ok(
      kissPreparationPeak < 0.02,
      "the final KISS preparation window must not radiate a retarget pulse",
    );
    const kissBodyPeak = Math.max(
      ...brushThenKiss.left.slice(Math.floor(0.38 * 48_000)).map(Math.abs),
      ...brushThenKiss.right.slice(Math.floor(0.38 * 48_000)).map(Math.abs),
    );
    assert.ok(kissBodyPeak > 0.07, "the released KISS must remain audible after BRUSH");
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("eight bounded voice characters retune one tract and preserve assignable modulation", () => {
  assert.equal(HICCUP_HEAD_VOICE_CHARACTERS.length, 8);
  assert.equal(
    new Set(HICCUP_HEAD_VOICE_CHARACTERS.map(({ id }) => id)).size,
    HICCUP_HEAD_VOICE_CHARACTERS.length,
  );
  assert.equal(
    new Set(HICCUP_HEAD_VOICE_CHARACTERS.map(({ settings }) => JSON.stringify(settings))).size,
    HICCUP_HEAD_VOICE_CHARACTERS.length,
  );
  for (const character of HICCUP_HEAD_VOICE_CHARACTERS) {
    assert.equal(hiccupHeadVoiceCharacter(character.id), character);
    assert.equal(Object.isFrozen(character), true);
    assert.equal(Object.isFrozen(character.settings), true);
    assert.ok(character.label.length > 0);
    assert.ok(character.description.length > 20);
    const voice = sanitizeHiccupHeadVoice({ characterId: character.id, ...character.settings });
    assert.equal(voice.characterId, character.id);
    for (const [key, [minimum, maximum]] of Object.entries(HICCUP_HEAD_VOICE_LIMITS)) {
      assert.ok(Number.isFinite(voice[key]));
      assert.ok(voice[key] >= minimum && voice[key] <= maximum);
    }
  }
  assert.equal(hiccupHeadVoiceCharacter("not-a-character").id, "natural");

  const hostile = sanitizeHiccupHeadVoice({
    characterId: "monster",
    ...Object.fromEntries(Object.keys(HICCUP_HEAD_VOICE_LIMITS).map((key, index) => [
      key,
      index % 2 ? Number.POSITIVE_INFINITY : -1e9,
    ])),
    modulation: {
      source: "not-an-lfo",
      target: "not-a-target",
      depth: 200,
      rateHz: -200,
      phase: Number.NaN,
    },
  });
  for (const [key, [minimum, maximum]] of Object.entries(HICCUP_HEAD_VOICE_LIMITS)) {
    assert.ok(hostile[key] >= minimum && hostile[key] <= maximum);
  }
  assert.deepEqual(hostile.modulation, {
    source: "sine",
    target: "pitch",
    depth: HICCUP_HEAD_VOICE_MODULATION_LIMITS.depth[1],
    rateHz: HICCUP_HEAD_VOICE_MODULATION_LIMITS.rateHz[0],
    phase: 0,
  });

  assert.deepEqual(HICCUP_HEAD_VOICE_MODULATION_SOURCES, ["sine", "triangle", "random"]);
  assert.deepEqual(
    HICCUP_HEAD_VOICE_MODULATION_TARGETS,
    ["pitch", "vibratoDepth", "breathiness", "roughness", "tractScale"],
  );
  for (const source of HICCUP_HEAD_VOICE_MODULATION_SOURCES) {
    for (const target of HICCUP_HEAD_VOICE_MODULATION_TARGETS) {
      assert.deepEqual(
        sanitizeHiccupHeadVoiceModulation({ source, target, depth: 0.4, rateHz: 7, phase: 0.25 }),
        { source, target, depth: 0.4, rateHz: 7, phase: 0.25 },
      );
    }
  }

  const seed = sanitizeHiccupHeadVoice({
    characterId: "warble",
    modulation: { source: "triangle", target: "roughness", depth: 0.6, rateHz: 4, phase: 0.3 },
  });
  const snapshot = structuredClone(seed);
  const unchanged = mutateHiccupHeadVoice(seed, () => 0, 0);
  const lower = mutateHiccupHeadVoice(seed, () => 0, 0.7);
  const upper = mutateHiccupHeadVoice(seed, () => 1, 0.7);
  const randomized = randomizeHiccupHeadVoice(seed, () => 1);
  assert.deepEqual(seed, snapshot, "voice mutation must not alter a rack slot in place");
  assert.deepEqual(unchanged, seed);
  assert.deepEqual(lower.modulation, seed.modulation, "mutation preserves its assignable modulator");
  assert.deepEqual(upper.modulation, seed.modulation, "mutation preserves its assignable modulator");
  assert.notDeepEqual(lower, upper);
  for (const voice of [lower, upper, randomized]) {
    for (const [key, [minimum, maximum]] of Object.entries(HICCUP_HEAD_VOICE_LIMITS)) {
      assert.ok(voice[key] >= minimum && voice[key] <= maximum);
    }
  }

  const monster = physicalVoiceParameters("aah", HICCUP_HEAD_DEFAULTS, 1, {
    characterId: "monster",
  });
  const helium = physicalVoiceParameters("aah", HICCUP_HEAD_DEFAULTS, 1, {
    characterId: "helium",
  });
  assert.equal(monster.voiceCharacterId, "monster");
  assert.equal(helium.voiceCharacterId, "helium");
  assert.ok(helium.glottalFrequencyHz > monster.glottalFrequencyHz * 4);
  assert.ok(helium.tractScale < monster.tractScale);
  assert.notDeepEqual(helium.formantFrequenciesHz, monster.formantFrequenciesHz);
});

test("voice cards expose every base voice parameter separately from the assignable LFO", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
  ]);
  const specsStart = app.indexOf("const VOICE_BASE_PARAMETER_SPECS");
  const specsEnd = app.indexOf("function voiceParameterSummary", specsStart);
  assert.ok(specsStart >= 0 && specsEnd > specsStart);
  const specs = app.slice(specsStart, specsEnd);
  for (const key of Object.keys(HICCUP_HEAD_VOICE_LIMITS)) {
    assert.match(specs, new RegExp(`key: "${key}"`), `${key} needs an editable base control`);
  }
  assert.equal([...specs.matchAll(/\bkey:\s*"/g)].length, 7);
  assert.match(app, /label: "Base vibrato rate"/);
  assert.match(app, /label: "Base vibrato depth"/);
  assert.match(
    app,
    /const \[minimum, maximum\] = HICCUP_HEAD_VOICE_LIMITS\[spec\.key\]/,
    "base sliders must use the model's own bounded ranges",
  );
  const parameterSetter = app.slice(
    app.indexOf("function setVoiceSlotParameters"),
    app.indexOf("function buildVoiceRack"),
  );
  assert.match(parameterSetter, /modulation: slot\.voice\.modulation/);
  assert.match(app, /baseSummaryTitle\.textContent = "Base voice"/);
  assert.match(app, /modTitle\.textContent = "Assignable LFO"/);
  assert.match(app, /depthText\.textContent = "LFO depth"/);
  assert.match(app, /rateText\.textContent = "LFO rate"/);
  assert.match(css, /\.hiccup-head-voice-base-grid\s*\{/);
  assert.match(css, /\.hiccup-head-voice-base-control input\[type="range"\]/);
  assert.match(css, /\.hiccup-head-voice-mod-title\s*\{/);
});

test("open-throat gestures expose Pink vowel targets, vibrato, register breaks, and rough anatomy", () => {
  const pinkTargets = {
    hee: [27.4, 2.25, 3],
    haw: [13, 2.4, 3],
    doo: [23, 2.1, 0.5],
    aah: [13, 2.4, 3],
    ooh: [17.7, 2.05, 0.95],
    wail: [27.4, 2.25, 3],
    growl: [17.7, 2.05, 0.95],
    holler: [13, 2.4, 3],
    hum: [23, 2.1, 0.5],
    rattle: [13, 2.4, 2.6],
  };
  for (const [soundId, [tongueBodyIndex, tongueBodyDiameterCm, lipDiameterCm]] of Object.entries(pinkTargets)) {
    const frame = hiccupHeadGestureFrame(soundId, 0.5);
    assert.equal(frame.acousticMix, 1);
    assert.equal(frame.tongueBodyIndex, tongueBodyIndex);
    assert.equal(frame.tongueBodyDiameterCm, tongueBodyDiameterCm);
    assert.equal(frame.lipDiameterCm, lipDiameterCm);
  }

  const aah = physicalVoiceParameters("aah", HICCUP_HEAD_DEFAULTS, 1);
  const ooh = physicalVoiceParameters("ooh", HICCUP_HEAD_DEFAULTS, 1);
  const wail = physicalVoiceParameters("wail", HICCUP_HEAD_DEFAULTS, 1);
  const yodel = physicalVoiceParameters("yodel", HICCUP_HEAD_DEFAULTS, 1);
  const growl = physicalVoiceParameters("growl", HICCUP_HEAD_DEFAULTS, 1);
  const holler = physicalVoiceParameters("holler", HICCUP_HEAD_DEFAULTS, 1);
  const hum = physicalVoiceParameters("hum", HICCUP_HEAD_DEFAULTS, 1);
  const rattle = physicalVoiceParameters("rattle", HICCUP_HEAD_DEFAULTS, 1);
  assert.ok(aah.durationSeconds > 0.5 && ooh.durationSeconds > 0.5);
  assert.ok(wail.vibratoRateHz >= 5.3 && wail.vibratoDepthSemitones > 1.5);
  assert.equal(yodel.registerJumpSemitones, 12);
  assert.equal(hiccupHeadGestureFrame("yodel", 0.3).registerLift, 0);
  assert.ok(hiccupHeadGestureFrame("yodel", 0.5).registerLift > 0.99);
  assert.equal(hiccupHeadGestureFrame("yodel", 0.5).tongueBodyIndex, 27.4);
  assert.ok(growl.roughness >= 0.78 && growl.subharmonicMix >= 0.7);
  assert.ok(holler.pressure > aah.pressure * 1.2);
  assert.ok(hiccupHeadGestureFrame("hum", 0.5).lipClosure > 0.99);
  assert.ok(hiccupHeadGestureFrame("hum", 0.5).velum > 0.9);
  assert.ok(hum.nasalMix > HICCUP_HEAD_DEFAULTS.nasalMix * 4);
  assert.ok(hiccupHeadGestureFrame("rattle", 0.5).throatRattle > 0.9);
  assert.ok(rattle.rattleFrequencyHz >= 14 && rattle.rattleFrequencyHz <= 52);
});

test("open vocals, shaped breaths, kisses, and FWEE breathe longer at slow tempo without changing hard attacks", () => {
  for (const soundId of [
    "pff", "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle", "whistle",
    "grunt", "moan", "lala", "pbpb", "slurp", "mwah",
    "huff", "waow", "whoop", "doodoo", "llll", "purr",
  ]) {
    const fast = physicalVoiceParameters(soundId, { ...HICCUP_HEAD_DEFAULTS, tempo: 520 }, 1);
    const medium = physicalVoiceParameters(soundId, { ...HICCUP_HEAD_DEFAULTS, tempo: 118 }, 1);
    const slow = physicalVoiceParameters(soundId, { ...HICCUP_HEAD_DEFAULTS, tempo: 48 }, 1);
    assert.equal(fast.tempoStepSeconds, 15 / 520);
    assert.equal(slow.tempoStepSeconds, 15 / 48);
    assert.ok(fast.durationSeconds < medium.durationSeconds);
    assert.ok(medium.durationSeconds < slow.durationSeconds);
    const minimumStretch = ["whoop", "llll", "purr"].includes(soundId) ? 2 : 2.25;
    assert.ok(
      slow.durationSeconds > fast.durationSeconds * minimumStretch,
      `${soundId} must use the musical room available at slow tempo`,
    );
    assert.ok(slow.durationSeconds <= 1.4, `${soundId} must retain a bounded physical tail`);
  }

  for (const soundId of ["bop", "pop", "tlik", "shack", "slap", "kick", "smack", "kiss"]) {
    assert.equal(
      physicalVoiceParameters(soundId, { ...HICCUP_HEAD_DEFAULTS, tempo: 48 }, 1).durationSeconds,
      physicalVoiceParameters(soundId, { ...HICCUP_HEAD_DEFAULTS, tempo: 520 }, 1).durationSeconds,
      `${soundId} must remain a sharply timed percussive gesture`,
    );
  }
});

test("Hiccup Head sanitation clamps every continuous control and rejects non-finite state", () => {
  const source = structuredClone(HICCUP_HEAD_DEFAULTS);
  const snapshot = structuredClone(source);
  assertBoundedState(sanitizeHiccupHeadState(source));
  assert.deepEqual(source, snapshot, "sanitizing must not mutate its input");

  for (const [key, [minimum, maximum]] of Object.entries(HICCUP_HEAD_LIMITS)) {
    assert.equal(
      sanitizeHiccupHeadState({ ...HICCUP_HEAD_DEFAULTS, [key]: -1e12 })[key],
      minimum,
      `${key} must clamp to its lower physical limit`,
    );
    assert.equal(
      sanitizeHiccupHeadState({ ...HICCUP_HEAD_DEFAULTS, [key]: 1e12 })[key],
      maximum,
      `${key} must clamp to its upper physical limit`,
    );
  }

  const hostile = Object.fromEntries(Object.keys(HICCUP_HEAD_LIMITS).map((key, index) => [
    key,
    index % 2 ? Number.NaN : Number.POSITIVE_INFINITY,
  ]));
  const sanitized = sanitizeHiccupHeadState({
    ...hostile,
    presetId: "not-a-preset",
    patternId: "not-a-pattern",
  });
  assertBoundedState(sanitized, "hostile");
  assert.equal(sanitized.presetId, HICCUP_HEAD_PRESETS[0].id);
  assert.equal(sanitized.patternId, HICCUP_HEAD_PATTERNS[0].id);

  for (const key of [
    "lipTension", "lipRounding", "cheekVolume", "cheekTension",
    "tonguePosition", "tongueCurl",
  ]) {
    assert.ok(HICCUP_HEAD_LIMITS[key][0] < 0, `${key} must travel below the human zone`);
    assert.ok(HICCUP_HEAD_LIMITS[key][1] > 1, `${key} must travel above the human zone`);
  }
  assert.ok(HICCUP_HEAD_LIMITS.mouthOpening[1] > 1);
  assert.ok(HICCUP_HEAD_LIMITS.tractLengthM[0] < 0.07);
  assert.ok(HICCUP_HEAD_LIMITS.tractLengthM[1] > 0.28);
});

test("Hiccup Head exposes one finite 44-section Pink-style oral tract across extreme anatomy", () => {
  assert.equal(HICCUP_HEAD_TRACT_SECTION_COUNT, 44);
  assert.ok(HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM > 0);
  assert.ok(HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM <= 0.01);
  assert.deepEqual(HICCUP_HEAD_TRACT_LANDMARKS, {
    glottis: 0,
    tongueBodyStart: 10,
    tongueControlStart: 12.9,
    velar: 22,
    tongueControlEnd: 30.4,
    postalveolar: 31,
    alveolar: 35,
    lipShapingStart: 37,
    lips: 43,
  });
  assert.ok(HICCUP_HEAD_TRACT_LANDMARKS.glottis < HICCUP_HEAD_TRACT_LANDMARKS.velar);
  assert.ok(HICCUP_HEAD_TRACT_LANDMARKS.velar < HICCUP_HEAD_TRACT_LANDMARKS.postalveolar);
  assert.ok(HICCUP_HEAD_TRACT_LANDMARKS.postalveolar < HICCUP_HEAD_TRACT_LANDMARKS.alveolar);
  assert.ok(HICCUP_HEAD_TRACT_LANDMARKS.alveolar < HICCUP_HEAD_TRACT_LANDMARKS.lips);

  const anatomyKeys = [
    "lipTension", "lipRounding", "cheekVolume", "cheekTension",
    "tonguePosition", "tongueCurl", "mouthOpening", "tractLengthM", "nasalMix",
  ];
  const states = [
    HICCUP_HEAD_DEFAULTS,
    sanitizeHiccupHeadState({
      ...HICCUP_HEAD_DEFAULTS,
      ...Object.fromEntries(anatomyKeys.map((key) => [key, HICCUP_HEAD_LIMITS[key][0]])),
    }),
    sanitizeHiccupHeadState({
      ...HICCUP_HEAD_DEFAULTS,
      ...Object.fromEntries(anatomyKeys.map((key) => [key, HICCUP_HEAD_LIMITS[key][1]])),
    }),
    sanitizeHiccupHeadState({
      ...HICCUP_HEAD_DEFAULTS,
      ...Object.fromEntries(anatomyKeys.map((key, index) => [
        key,
        HICCUP_HEAD_LIMITS[key][index % 2],
      ])),
    }),
  ];
  for (const key of anatomyKeys) {
    for (const value of HICCUP_HEAD_LIMITS[key]) {
      states.push(sanitizeHiccupHeadState({ ...HICCUP_HEAD_DEFAULTS, [key]: value }));
    }
  }
  const phases = Array.from({ length: 21 }, (_, index) => index / 20);

  for (const [stateIndex, state] of states.entries()) {
    const base = hiccupHeadBaseOralDiameters(state);
    const resting = hiccupHeadOralTractProfile(state);
    assert.equal(Object.isFrozen(base), true);
    assert.equal(base.length, HICCUP_HEAD_TRACT_SECTION_COUNT);
    assert.equal(resting.sectionCount, HICCUP_HEAD_TRACT_SECTION_COUNT);
    assert.equal(resting.baseDiameters.length, HICCUP_HEAD_TRACT_SECTION_COUNT);
    assert.equal(resting.targetDiameters.length, HICCUP_HEAD_TRACT_SECTION_COUNT);
    assert.ok(resting.sectionLengthM > 0);
    assert.ok(resting.tongueBodyIndex >= 2 && resting.tongueBodyIndex <= 42);
    assert.ok(resting.tongueTipIndex >= 2 && resting.tongueTipIndex <= 42);
    for (const [index, diameter] of base.entries()) {
      assert.ok(Number.isFinite(diameter), `base[${stateIndex}][${index}] must be finite`);
      assert.ok(
        diameter >= HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM && diameter <= 6.5,
        `base[${stateIndex}][${index}] must stay inside the tube bounds`,
      );
    }

    for (const soundId of SOUND_IDS) {
      const signatures = new Set();
      for (const phase of phases) {
        const frame = hiccupHeadGestureFrame(soundId, phase, state, 0.91);
        const target = hiccupHeadTargetOralDiameters(state, frame);
        const profile = hiccupHeadOralTractProfile(state, frame);
        assertFiniteTree(frame, `${soundId}.frame.${phase}`);
        assertFiniteTree(profile, `${soundId}.profile.${phase}`);
        assert.equal(frame.soundId, soundId);
        assert.equal(frame.phase, phase);
        assert.equal(target.length, HICCUP_HEAD_TRACT_SECTION_COUNT);
        assert.deepEqual(profile.targetDiameters, target);
        assert.ok(target.every((diameter) => (
          Number.isFinite(diameter)
          && diameter >= HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM
          && diameter <= 6.5
        )));
        signatures.add(target.map((diameter) => diameter.toFixed(3)).join("|"));
      }
      assert.ok(
        signatures.size >= 10,
        `${soundId} must move the tube continuously rather than select one static profile`,
      );
    }
  }
});

test("Hiccup Head gesture curves drive sequential seals, suction, releases, and signed tissue motion", () => {
  assert.equal(new Set(HICCUP_HEAD_GESTURE_CHANNELS).size, HICCUP_HEAD_GESTURE_CHANNELS.length);
  assert.deepEqual(Object.keys(HICCUP_HEAD_GESTURE_TRAJECTORIES), SOUND_IDS);
  for (const soundId of SOUND_IDS) {
    const trajectory = HICCUP_HEAD_GESTURE_TRAJECTORIES[soundId];
    assert.equal(trajectory.id, soundId);
    assert.deepEqual(Object.keys(trajectory.curves), HICCUP_HEAD_GESTURE_CHANNELS);
    for (const channel of HICCUP_HEAD_GESTURE_CHANNELS) {
      const curve = trajectory.curves[channel];
      assert.ok(curve.length >= 2, `${soundId}.${channel} needs an explicit trajectory`);
      let previousPhase = -1;
      for (const [phase, value] of curve) {
        assert.ok(Number.isFinite(phase) && phase >= 0 && phase <= 1);
        assert.ok(Number.isFinite(value), `${soundId}.${channel} values must be finite`);
        assert.ok(phase >= previousPhase, `${soundId}.${channel} phases must be ordered`);
        previousPhase = phase;
      }
    }
  }

  assert.equal(sampleHiccupHeadGestureCurve([], 0.5), 0);
  assert.equal(sampleHiccupHeadGestureCurve([[0, 0], [1, 1]], -20), 0);
  assert.equal(sampleHiccupHeadGestureCurve([[0, 0], [1, 1]], 0.5), 0.5);
  assert.equal(sampleHiccupHeadGestureCurve([[0, 0], [1, 1]], 20), 1);
  assert.ok(Number.isFinite(sampleHiccupHeadGestureCurve([[0, Number.NaN], [1, 1]], 0.25)));

  const lipIndex = HICCUP_HEAD_TRACT_LANDMARKS.lips;
  const releasedLipTubes = new Map();
  for (const soundId of ["bop", "boop"]) {
    const frames = Array.from({ length: 201 }, (_, index) => (
      hiccupHeadGestureFrame(soundId, index / 200)
    ));
    const sealed = frames.reduce((best, frame) => (
      frame.lipClosure * frame.pressure > best.lipClosure * best.pressure ? frame : best
    ));
    const released = frames
      .filter((frame) => frame.phase > sealed.phase && frame.lipClosure <= 0.01)
      .reduce((best, frame) => frame.turbulence > best.turbulence ? frame : best);
    const sealedTube = hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, sealed);
    const releasedTube = hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, released);
    releasedLipTubes.set(soundId, releasedTube[lipIndex]);
    assert.ok(sealed.lipClosure >= 0.99, `${soundId} must build pressure behind sealed lips`);
    assert.ok(sealed.pressure >= 0.95, `${soundId} must store pressure before release`);
    assert.ok(released.lipClosure <= 0.01, `${soundId} must release the lips`);
    assert.ok(sealedTube[lipIndex] <= HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM * 1.01);
    assert.ok(releasedTube[lipIndex] > sealedTube[lipIndex] * 20);
    assert.ok(released.turbulence > 0, `${soundId} release must create a local air jet`);
  }
  assert.ok(
    releasedLipTubes.get("boop") < releasedLipTubes.get("bop"),
    "BOOP keeps a more rounded projected lip tube than BOP after release",
  );

  const tlikSealed = hiccupHeadGestureFrame("tlik", 0.4);
  const tlikTipRelease = hiccupHeadGestureFrame("tlik", 0.55);
  const tlikRearRelease = hiccupHeadGestureFrame("tlik", 0.7);
  const sectionForPosition = (position) => 2 + position * (HICCUP_HEAD_TRACT_SECTION_COUNT - 4);
  const tlikSealedTube = hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, tlikSealed);
  const tlikFrontIndex = Math.round(sectionForPosition(tlikSealed.constrictionPosition));
  const tlikRearIndex = Math.round(sectionForPosition(
    tlikSealed.secondaryConstrictionPosition,
  ));
  const tlikTipIndex = Math.round(hiccupHeadOralTractProfile(
    HICCUP_HEAD_DEFAULTS,
    tlikSealed,
  ).tongueTipIndex);
  assert.ok(tlikSealed.constriction >= 0.99);
  assert.ok(tlikSealed.secondaryConstriction >= 0.99);
  assert.ok(tlikSealed.suction >= 0.95);
  assert.ok(tlikSealedTube[tlikFrontIndex] <= 0.035, "TLIK front contact must physically seal");
  assert.ok(tlikSealedTube[tlikRearIndex] <= 0.035, "TLIK rear contact must physically seal");
  assert.ok(tlikSealedTube[tlikTipIndex] <= 0.035, "TLIK curled tongue tip must contact");
  assert.ok(Math.abs(
    sectionForPosition(tlikSealed.constrictionPosition)
      - HICCUP_HEAD_TRACT_LANDMARKS.alveolar,
  ) < 1.5);
  assert.ok(Math.abs(
    sectionForPosition(tlikSealed.secondaryConstrictionPosition)
      - HICCUP_HEAD_TRACT_LANDMARKS.velar,
  ) < 0.1);
  assert.ok(tlikTipRelease.constriction < 0.02, "TLIK tongue tip releases first");
  assert.ok(tlikTipRelease.secondaryConstriction > 0.8, "TLIK rear seal briefly remains");
  assert.ok(tlikRearRelease.secondaryConstriction < 0.01, "TLIK rear seal then releases");

  const ph = hiccupHeadGestureFrame("shh", 0.12);
  const sh = hiccupHeadGestureFrame("shh", 0.4);
  const k = hiccupHeadGestureFrame("shh", 0.8);
  assert.ok(ph.lipClosure > 0.99 && ph.constriction < 0.01 && ph.secondaryConstriction < 0.01);
  assert.ok(sh.lipClosure < 0.01 && sh.constriction > 0.6 && sh.turbulence > 0.9);
  assert.ok(sh.secondaryConstriction < 0.01);
  assert.ok(Math.abs(
    sectionForPosition(sh.constrictionPosition) - HICCUP_HEAD_TRACT_LANDMARKS.postalveolar,
  ) < 0.5);
  assert.ok(k.lipClosure < 0.01 && k.constriction < 0.01 && k.secondaryConstriction > 0.95);
  assert.ok(Math.abs(
    sectionForPosition(k.secondaryConstrictionPosition) - HICCUP_HEAD_TRACT_LANDMARKS.velar,
  ) < 0.1);
  assert.notDeepEqual(
    hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, ph),
    hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, sh),
  );
  assert.notDeepEqual(
    hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, sh),
    hiccupHeadTargetOralDiameters(HICCUP_HEAD_DEFAULTS, k),
  );

  const flutterClosures = Array.from({ length: 1_001 }, (_, index) => (
    hiccupHeadGestureFrame("pff", index / 1_000).lipClosure
  ));
  const flutterClosurePeaks = flutterClosures.slice(1, -1).filter((value, index) => (
    value >= flutterClosures[index]
    && value > flutterClosures[index + 2]
    && value > 0.2
  ));
  assert.equal(flutterClosurePeaks.length, 4, "PFRR needs four softened closure contours");
  assert.ok(hiccupHeadGestureFrame("pff", 0.3).lipFlutter > 0.75);
  assert.ok(hiccupHeadGestureFrame("pff", 1).lipFlutter < 0.01);

  const popMotion = Array.from({ length: 201 }, (_, index) => (
    hiccupHeadGestureFrame("pop", index / 200).cheekImpulse
  ));
  const slapMotion = Array.from({ length: 201 }, (_, index) => (
    hiccupHeadGestureFrame("slap", index / 200).cheekImpulse
  ));
  assert.ok(
    Math.min(...popMotion) < -0.9 && Math.max(...popMotion) > 0.3,
    "POP models inward vacuum then a smaller dry rebound",
  );
  assert.ok(
    Math.min(...slapMotion) < -0.9 && Math.max(...slapMotion) > 0.65,
    "SLAP models skin contact then rebound",
  );
});

test("Hiccup Head sample-addressed gesture frames complete exactly once and stay finite", () => {
  for (const soundId of SOUND_IDS) {
    const start = hiccupHeadGestureFrameAtSample(soundId, 0, 48_000, HICCUP_HEAD_DEFAULTS, 0.86);
    const middle = hiccupHeadGestureFrameAtSample(
      soundId,
      Math.floor(start.totalFrames / 2),
      48_000,
      HICCUP_HEAD_DEFAULTS,
      0.86,
    );
    const end = hiccupHeadGestureFrameAtSample(
      soundId,
      start.totalFrames,
      48_000,
      HICCUP_HEAD_DEFAULTS,
      0.86,
    );
    const after = hiccupHeadGestureFrameAtSample(
      soundId,
      start.totalFrames + 10_000,
      48_000,
      HICCUP_HEAD_DEFAULTS,
      0.86,
    );
    assertFiniteTree(start, `${soundId}.sampleStart`);
    assertFiniteTree(middle, `${soundId}.sampleMiddle`);
    assertFiniteTree(end, `${soundId}.sampleEnd`);
    assert.equal(start.frameIndex, 0);
    assert.equal(start.active, true);
    assert.equal(start.complete, false);
    assert.ok(middle.phase > 0.45 && middle.phase <= 0.5);
    assert.equal(end.frameIndex, start.totalFrames);
    assert.equal(end.remainingFrames, 0);
    assert.equal(end.phase, 1);
    assert.equal(end.active, false);
    assert.equal(end.complete, true);
    assert.equal(after.frameIndex, start.totalFrames);
    assert.equal(after.remainingFrames, 0);
    assert.equal(after.phase, 1);
    assert.equal(after.active, false);
    assert.equal(after.complete, true);
  }
});

test("face geometry, tract formants, and all sound-specific voice plans remain physical and distinct", () => {
  const states = [HICCUP_HEAD_DEFAULTS];
  for (const [key, limits] of Object.entries(HICCUP_HEAD_LIMITS)) {
    if (["tempo", "swing", "humanize", "level"].includes(key)) continue;
    for (const value of limits) states.push(sanitizeHiccupHeadState({ ...HICCUP_HEAD_DEFAULTS, [key]: value }));
  }

  for (const [index, state] of states.entries()) {
    const geometry = hiccupHeadGeometry(state);
    const formants = hiccupHeadFormants(state);
    assertFiniteTree(geometry, `geometry[${index}]`);
    assertFiniteTree(formants, `formants[${index}]`);
    assert.ok(geometry.apertureCm2 >= 0.008 && geometry.apertureCm2 <= 18);
    assert.ok(geometry.cheekVolumeMl >= 8 && geometry.cheekVolumeMl <= 480);
    assert.ok(geometry.neckLengthM >= 0.0025 && geometry.neckLengthM <= 0.12);
    assert.ok(geometry.cavityFrequencyHz >= 22 && geometry.cavityFrequencyHz <= 4_200);
    assert.equal(formants.frequenciesHz.length, 3);
    assert.equal(formants.bandwidthsHz.length, 3);
    assert.ok(formants.frequenciesHz[0] < formants.frequenciesHz[1]);
    assert.ok(formants.frequenciesHz[1] < formants.frequenciesHz[2]);
    assert.ok(formants.bandwidthsHz.every((bandwidth) => bandwidth > 0));
  }

  const shortTract = hiccupHeadFormants({ ...HICCUP_HEAD_DEFAULTS, tractLengthM: HICCUP_HEAD_LIMITS.tractLengthM[0] });
  const longTract = hiccupHeadFormants({ ...HICCUP_HEAD_DEFAULTS, tractLengthM: HICCUP_HEAD_LIMITS.tractLengthM[1] });
  assert.ok(shortTract.frequenciesHz[0] > longTract.frequenciesHz[0]);
  const smallCheeks = hiccupHeadGeometry({
    ...HICCUP_HEAD_DEFAULTS,
    cheekVolume: HICCUP_HEAD_LIMITS.cheekVolume[0],
  });
  const largeCheeks = hiccupHeadGeometry({
    ...HICCUP_HEAD_DEFAULTS,
    cheekVolume: HICCUP_HEAD_LIMITS.cheekVolume[1],
  });
  assert.ok(smallCheeks.cheekVolumeMl < largeCheeks.cheekVolumeMl);
  assert.ok(smallCheeks.cavityFrequencyHz > largeCheeks.cavityFrequencyHz);
  assert.ok(smallCheeks.cheekVolumeMl <= 12, "the face can collapse below a human cheek cavity");
  assert.ok(largeCheeks.cheekVolumeMl >= 450, "the face can inflate beyond a human cheek cavity");

  const voicePlans = SOUND_IDS.map((soundId) => {
    const pose = hiccupHeadPoseForSound(soundId, HICCUP_HEAD_DEFAULTS);
    const plan = physicalVoiceParameters(soundId, HICCUP_HEAD_DEFAULTS, 0.8);
    assertBoundedState(pose, `${soundId}.pose`);
    assertFiniteTree(plan, `${soundId}.voice`);
    assert.equal(plan.soundId, soundId);
    assert.equal(plan.family, hiccupHeadSound(soundId).family);
    assert.ok(plan.durationSeconds > 0.05 && plan.durationSeconds < 2.5);
    assert.ok(plan.pressure > 0 && plan.pressure <= 1.8);
    assert.ok(plan.formantFrequenciesHz[0] < plan.formantFrequenciesHz[1]);
    assert.ok(plan.formantFrequenciesHz[1] < plan.formantFrequenciesHz[2]);
    return { pose, plan };
  });

  const parameterSignatures = voicePlans.map(({ plan }) => roundedSignature([
    plan.durationSeconds,
    plan.glottalFrequencyHz,
    plan.flutterFrequencyHz,
    plan.membraneFrequencyHz,
    plan.cavityFrequencyHz,
    plan.noiseCenterHz,
    plan.noiseBandwidthHz,
    ...plan.formantFrequenciesHz,
    plan.pan,
  ]));
  const formantSignatures = voicePlans.map(({ plan }) => roundedSignature(plan.formantFrequenciesHz));
  const geometrySignatures = voicePlans.map(({ pose }) => roundedSignature(Object.values(hiccupHeadGeometry(pose))));
  assert.equal(
    new Set(parameterSignatures).size,
    SOUND_IDS.length,
    "all gestures, including KISS and composite BRUSH, need distinct physical plans",
  );
  assert.equal(
    new Set(formantSignatures).size,
    SOUND_IDS.length,
    "all sound poses need distinct formants",
  );
  assert.equal(
    new Set(geometrySignatures).size,
    SOUND_IDS.length,
    "all sound poses need distinct face geometry",
  );
  assert.ok(physicalVoiceParameters("shh", HICCUP_HEAD_DEFAULTS, 1).durationSeconds < 0.3);
  assert.ok(physicalVoiceParameters("shack", HICCUP_HEAD_DEFAULTS, 1).durationSeconds < 0.3);
});

test("the expanded bank models body kicks, opposed slaps, reversible breath, pitch, suction, trills, and burps", () => {
  const kick = physicalVoiceParameters("kick", HICCUP_HEAD_DEFAULTS, 1);
  const slap = physicalVoiceParameters("slap", HICCUP_HEAD_DEFAULTS, 1);
  const smack = physicalVoiceParameters("smack", HICCUP_HEAD_DEFAULTS, 1);
  assert.ok(kick.membraneFrequencyHz < slap.membraneFrequencyHz * 0.35);
  assert.ok(kick.glottalFrequencyHz < slap.glottalFrequencyHz * 0.55);
  assert.equal(slap.pan, -smack.pan);
  assert.ok(slap.pan < 0 && smack.pan > 0);
  const tightHand = physicalVoiceParameters("slap", {
    ...HICCUP_HEAD_DEFAULTS,
    cheekVolume: -0.3,
    cheekTension: 1.6,
    tractLengthM: 0.08,
  }, 1);
  const cavernHand = physicalVoiceParameters("slap", {
    ...HICCUP_HEAD_DEFAULTS,
    cheekVolume: 1.9,
    cheekTension: -0.25,
    tractLengthM: 0.42,
  }, 1);
  assert.ok(tightHand.handImpactBrightness > cavernHand.handImpactBrightness + 0.2);
  assert.ok(cavernHand.handContactSpacingMs > tightHand.handContactSpacingMs + 0.8);
  assert.ok(cavernHand.handTail > tightHand.handTail + 0.15);
  for (const plan of [slap, smack, tightHand, cavernHand]) {
    assert.ok(plan.handImpactBrightness >= 0 && plan.handImpactBrightness <= 1);
    assert.ok(plan.handContactSpacingMs >= 0.7 && plan.handContactSpacingMs <= 4.8);
    assert.ok(plan.handTail >= 0.22 && plan.handTail <= 0.94);
  }
  const slapEarlyContacts = Array.from({ length: 81 }, (_, index) => (
    hiccupHeadGestureFrame("slap", index / 200).cheekImpulse
  ));
  const smackEarlyContacts = Array.from({ length: 81 }, (_, index) => (
    hiccupHeadGestureFrame("smack", index / 200).cheekImpulse
  ));
  assert.ok(Math.min(...slapEarlyContacts) < -0.9);
  assert.ok(Math.max(...smackEarlyContacts) > 0.9);
  for (const soundId of ["slap", "smack"]) {
    const contacts = Array.from({ length: 201 }, (_, index) => (
      hiccupHeadGestureFrame(soundId, index / 200).cheekImpulse
    ));
    const extrema = contacts.filter((amount, index) => (
      index > 0
      && index < contacts.length - 1
      && Math.abs(amount) > 0.14
      && Math.abs(amount) >= Math.abs(contacts[index - 1])
      && Math.abs(amount) > Math.abs(contacts[index + 1])
    ));
    const contactSigns = contacts
      .filter((amount) => Math.abs(amount) > 0.1)
      .map(Math.sign);
    const reversals = contactSigns.slice(1)
      .filter((sign, index) => sign !== contactSigns[index]).length;
    assert.ok(extrema.length >= 3, `${soundId} needs palm, finger, and rebound contacts`);
    assert.ok(reversals >= 2, `${soundId} needs alternating clap-like skin displacement`);
  }

  const hee = physicalVoiceParameters("hee", HICCUP_HEAD_DEFAULTS, 1);
  const haw = physicalVoiceParameters("haw", HICCUP_HEAD_DEFAULTS, 1);
  assert.equal(hee.airflowDirection, -1, "HEE must pull air inward across the folds");
  assert.equal(haw.airflowDirection, 1, "HAW must send air outward across the folds");
  assert.ok(hee.glottalFrequencyHz > haw.glottalFrequencyHz * 1.5);
  assert.ok(
    hiccupHeadPoseForSound("hee").mouthOpening < hiccupHeadPoseForSound("haw").mouthOpening * 0.25,
    "HEE and HAW need physically different vowel tracts",
  );

  const dooPitches = [-24, -12, 0, 12, 24].map((dooPitch) => (
    physicalVoiceParameters("doo", { ...HICCUP_HEAD_DEFAULTS, dooPitch }, 1).glottalFrequencyHz
  ));
  for (let index = 1; index < dooPitches.length; index += 1) {
    assert.ok(
      Math.abs(dooPitches[index] / dooPitches[index - 1] - 2) < 1e-12,
      "each DOO octave must double its vocal-fold frequency",
    );
  }

  const mwahFrames = Array.from({ length: 201 }, (_, index) => (
    hiccupHeadGestureFrame("mwah", index / 200)
  ));
  const mwahStored = mwahFrames.reduce((best, frame) => (
    Math.min(frame.lipClosure, frame.suction) > Math.min(best.lipClosure, best.suction)
      ? frame
      : best
  ));
  const mwahReleased = mwahFrames
    .filter((frame) => (
      frame.phase > mwahStored.phase && frame.lipClosure < 0.01 && frame.suction < 0.01
    ))
    .reduce((best, frame) => frame.lipImpulse > best.lipImpulse ? frame : best);
  assert.ok(mwahStored.lipClosure > 0.99 && mwahStored.suction > 0.99);
  assert.ok(mwahReleased.lipClosure < 0.01 && mwahReleased.suction < 0.01);
  assert.ok(mwahReleased.lipImpulse > 0.8, "MWAH must open into a real lip release");
  assert.ok(hiccupHeadGestureFrame("drr", 0.2).tongueTrill > 0.98);

  const burp = physicalVoiceParameters("burp", HICCUP_HEAD_DEFAULTS, 1);
  const burpPressure = [0.2, 0.3, 0.45, 0.6, 0.8]
    .map((phase) => hiccupHeadGestureFrame("burp", phase).pressure);
  assert.ok(burp.irregularity > 0.75);
  assert.ok(Math.max(...burpPressure) - Math.min(...burpPressure) > 0.35);
  assert.ok(
    burp.glottalFrequencyHz < physicalVoiceParameters("doo", HICCUP_HEAD_DEFAULTS, 1).glottalFrequencyHz * 0.4,
  );
});

test("new grunts, moans, tongue gestures, and the softened PFRR keep distinct physical motions", () => {
  assert.deepEqual(
    SOUND_IDS.slice(26, 31).map((id) => ({
      id,
      label: hiccupHeadSound(id).label,
      key: hiccupHeadSound(id).key,
    })),
    [
      { id: "grunt", label: "HNNGH", key: "h" },
      { id: "moan", label: "MMOAN", key: "j" },
      { id: "lala", label: "LA-LA", key: "k" },
      { id: "pbpb", label: "PB-PB", key: "l" },
      { id: "slurp", label: "SLRRP", key: "z" },
    ],
  );

  const grunt = hiccupHeadGestureFrame("grunt", 0.3);
  const gruntPlan = physicalVoiceParameters("grunt", HICCUP_HEAD_DEFAULTS, 1);
  assert.ok(grunt.voicing > 0.8 && grunt.throatRattle > 0.65);
  assert.ok(grunt.nasalMix > 0.7 && grunt.velum > 0.8, "HNNGH needs an open nasal branch");
  assert.ok(
    grunt.constriction > 0.85 && grunt.constrictionPosition < 0.3,
    "HNNGH needs a rear velar tongue closure instead of another open grunt",
  );
  assert.ok(grunt.tongueBodyDiameterCm < 0.5, "HNNGH's Pink-style rear tongue target must seal");
  assert.ok(gruntPlan.glottalFrequencyHz < 70);
  assert.ok(gruntPlan.roughness > 0.65 && gruntPlan.subharmonicMix > 0.5);

  const moan = hiccupHeadGestureFrame("moan", 0.5);
  const moanPlan = physicalVoiceParameters("moan", HICCUP_HEAD_DEFAULTS, 1);
  assert.ok(moan.voicing > 0.85 && moan.tongueExtension > 0.12);
  assert.ok(moanPlan.vibratoDepthSemitones > 0.8);
  assert.ok(hiccupHeadPoseForSound("moan").mouthOpening > 0.75);

  const lalaFrames = Array.from({ length: 81 }, (_, index) => (
    hiccupHeadGestureFrame("lala", index / 80)
  ));
  const lalaContacts = lalaFrames.map(({ tongueContact }) => tongueContact > 0.65);
  let lalaTransitions = 0;
  for (let index = 1; index < lalaContacts.length; index += 1) {
    if (lalaContacts[index] !== lalaContacts[index - 1]) lalaTransitions += 1;
  }
  assert.ok(lalaTransitions >= 6, "LA-LA needs repeated tongue contacts and releases");
  assert.ok(Math.max(...lalaFrames.map(({ tongueExtension }) => tongueExtension)) > 0.85);

  const pbpbFrames = Array.from({ length: 81 }, (_, index) => (
    hiccupHeadGestureFrame("pbpb", index / 80)
  ));
  assert.ok(Math.max(...pbpbFrames.map(({ lipFlutter }) => lipFlutter)) > 0.78);
  assert.ok(Math.max(...pbpbFrames.map(({ voicing }) => voicing)) > 0.72);
  const pbpbClosures = pbpbFrames.map(({ lipClosure }) => lipClosure > 0.55);
  let pbpbTransitions = 0;
  for (let index = 1; index < pbpbClosures.length; index += 1) {
    if (pbpbClosures[index] !== pbpbClosures[index - 1]) pbpbTransitions += 1;
  }
  assert.ok(pbpbTransitions >= 6, "PB-PB needs repeated soft lip meetings and partings");

  const slurpFrames = Array.from({ length: 81 }, (_, index) => (
    hiccupHeadGestureFrame("slurp", index / 80)
  ));
  assert.ok(Math.max(...slurpFrames.map(({ suction }) => suction)) > 0.95);
  assert.ok(Math.max(...slurpFrames.map(({ tongueExtension }) => tongueExtension)) > 0.95);
  assert.ok(hiccupHeadPoseForSound("slurp").tongueOut > 1.4);

  const pffOnset = hiccupHeadGestureFrame("pff", 0.08);
  const pffBody = hiccupHeadGestureFrame("pff", 0.32);
  const pffFrames = Array.from({ length: 101 }, (_, index) => (
    hiccupHeadGestureFrame("pff", index / 100)
  ));
  assert.ok(pffOnset.aspiration < 0.1 && pffOnset.turbulence < 0.05);
  assert.ok(pffBody.lipFlutter > 0.75, "the softer PFRR must retain a pressure-driven lip roll");
  const pffTurbulence = Math.max(...pffFrames.map(({ turbulence }) => turbulence));
  const pffFlutter = Math.max(...pffFrames.map(({ lipFlutter }) => lipFlutter));
  assert.ok(pffTurbulence <= 0.5, "PFRR turbulence must stay softer than a full noise burst");
  assert.ok(pffFlutter > pffTurbulence + 0.3, "PFRR must read as lip motion, not digital noise");
  assert.ok(Math.max(...pffFrames.map(({ lipImpulse }) => lipImpulse)) <= 0.321);

  const addedPercussionIds = ["snare", "snap", "tomlo", "tomhi", "braap"];
  const addedPlans = new Map(addedPercussionIds.map((soundId) => [
    soundId,
    physicalVoiceParameters(soundId, HICCUP_HEAD_DEFAULTS, 1),
  ]));
  for (const soundId of addedPercussionIds) {
    assertFiniteTree(hiccupHeadGestureFrame(soundId, 0.4), `${soundId} frame`);
    assertFiniteTree(addedPlans.get(soundId), `${soundId} physical plan`);
    assert.equal(addedPlans.get(soundId).family, hiccupHeadSound(soundId).family);
  }
  const snareStored = hiccupHeadGestureFrame("snare", 0.24);
  const snareReleased = hiccupHeadGestureFrame("snare", 0.4);
  assert.ok(snareStored.tongueContact > 0.85 && snareStored.secondaryConstriction > 0.9);
  assert.ok(snareReleased.turbulence > 0.85 && snareReleased.aspiration > 0.65);
  const snapStored = hiccupHeadGestureFrame("snap", 0.24);
  const snapReleased = hiccupHeadGestureFrame("snap", 0.38);
  assert.ok(snapStored.suction > 0.95 && snapStored.tongueContact > 0.95);
  assert.ok(snapReleased.suction < 0.05 && snapReleased.cheekImpulse > 0.2);
  assert.ok(Math.abs(hiccupHeadGestureFrame("tomlo", 0.18).cheekImpulse) > 0.95);
  assert.ok(Math.abs(hiccupHeadGestureFrame("tomhi", 0.14).cheekImpulse) > 0.88);
  assert.ok(
    addedPlans.get("tomlo").membraneFrequencyHz
      < addedPlans.get("tomhi").membraneFrequencyHz * 0.5,
    "low and high mouth toms must excite clearly different cheek-wall frequencies",
  );
  const braap = hiccupHeadGestureFrame("braap", 0.4);
  assert.ok(braap.lipFlutter > 0.9 && braap.voicing > 0.85);
  assert.ok(addedPlans.get("braap").roughness > 0.5);
  assert.ok(addedPlans.get("braap").flutterFrequencyHz < 40);

  assert.deepEqual(HICCUP_HEAD_LIMITS.tongueOut, [0, 1.6]);
  assert.deepEqual(HICCUP_HEAD_LIMITS.leftHairLength, [0, 1]);
  assert.deepEqual(HICCUP_HEAD_LIMITS.rightHairLength, [0, 1]);
  assert.deepEqual(HICCUP_HEAD_LIMITS.leftHairAngle, [-1, 1]);
  assert.deepEqual(HICCUP_HEAD_LIMITS.rightHairAngle, [-1, 1]);
  assert.equal(HICCUP_HEAD_DEFAULTS.leftHairLength, 0.14);
  assert.equal(HICCUP_HEAD_DEFAULTS.rightHairLength, 0.14);
  assert.deepEqual(HICCUP_HEAD_LIMITS.eyeClosure, [0, 1]);
  assert.equal(HICCUP_HEAD_DEFAULTS.eyeClosure, 0);
  assert.deepEqual(HICCUP_HEAD_LIMITS.leftBrow, [0, 1]);
  assert.deepEqual(HICCUP_HEAD_LIMITS.rightBrow, [0, 1]);
  assert.equal(HICCUP_HEAD_DEFAULTS.leftBrow, 0);
  assert.equal(HICCUP_HEAD_DEFAULTS.rightBrow, 0);
  assert.ok(
    HICCUP_HEAD_PRESETS.some(({ settings }) => (
      Number.isFinite(settings.leftBrow)
      && Number.isFinite(settings.rightBrow)
      && settings.leftBrow !== settings.rightBrow
    )),
    "presets must visibly separate the two eyebrow controls",
  );
});

test("physical presets and deterministic randomization produce distinct bounded faces", () => {
  assert.equal(HICCUP_HEAD_PRESETS.length, 16, "the expanded face needs all sixteen presets");
  assert.equal(new Set(HICCUP_HEAD_PRESETS.map(({ id }) => id)).size, HICCUP_HEAD_PRESETS.length);
  assert.equal(
    new Set(HICCUP_HEAD_PRESETS.map(({ settings }) => JSON.stringify(settings))).size,
    HICCUP_HEAD_PRESETS.length,
  );

  const presetStates = HICCUP_HEAD_PRESETS.map((preset) => {
    for (const effectKey of [
      "nasalMix", "earSpread", "leftHairLength", "rightHairLength",
      "leftHairAngle", "rightHairAngle", "eyeDivergence", "eyeClosure",
      "leftEyeClosure", "rightEyeClosure",
    ]) {
      assert.equal(
        Object.hasOwn(preset.settings, effectKey),
        false,
        `${preset.id} must not carry ignored live-effect field ${effectKey}`,
      );
    }
    const state = hiccupHeadState(preset.id);
    assert.equal(state.presetId, preset.id);
    assertBoundedState(state, preset.id);
    return state;
  });
  assert.equal(
    new Set(presetStates.map((state) => roundedSignature([
      state.lungPressure,
      state.lipTension,
      state.cheekVolume,
      state.cheekTension,
      state.tonguePosition,
      state.tractLengthM,
    ]))).size,
    HICCUP_HEAD_PRESETS.length,
  );

  const before = hiccupHeadState("cavern-gob", {
    patternId: "hush-rush",
    tempo: 203,
    swing: 0.31,
    humanize: 0.2,
    level: 0.61,
  });
  const snapshot = structuredClone(before);
  const minimum = randomizeHiccupHeadState(before, () => 0);
  const midpoint = randomizeHiccupHeadState(before, () => 0.5);
  const maximum = randomizeHiccupHeadState(before, () => 1);
  assert.deepEqual(before, snapshot, "randomizing must not mutate the selected face");
  for (const [label, state] of [["minimum", minimum], ["midpoint", midpoint], ["maximum", maximum]]) {
    assertBoundedState(state, label);
    assert.equal(state.presetId, before.presetId);
    assert.equal(state.patternId, before.patternId);
    assert.equal(state.tempo, before.tempo);
    assert.equal(state.swing, before.swing);
    assert.equal(state.humanize, before.humanize);
    assert.equal(state.level, before.level);
  }
  for (const key of [
    "lungPressure", "lipTension", "lipRounding", "cheekVolume", "cheekTension",
    "tonguePosition", "tongueCurl", "tongueOut", "mouthOpening", "tractLengthM",
    "nasalMix", "dooPitch", "earSpread", "leftHairLength", "rightHairLength",
    "leftHairAngle", "rightHairAngle", "eyeDivergence", "eyeClosure",
    "leftEyeClosure", "rightEyeClosure",
    "silliness", "decay",
  ]) {
    const [low, high] = HICCUP_HEAD_LIMITS[key];
    assert.equal(minimum[key], low, `${key} random draw zero must reach its minimum`);
    assert.equal(maximum[key], high, `${key} random draw one must reach its maximum`);
    assert.ok(Math.abs(midpoint[key] - (low + high) / 2) < 1e-12);
  }
  for (const key of ["leftBrow", "rightBrow"]) {
    assert.equal(minimum[key], before[key], `${key} must survive whole-face mutation`);
    assert.equal(midpoint[key], before[key], `${key} must survive whole-face mutation`);
    assert.equal(maximum[key], before[key], `${key} must survive whole-face mutation`);
  }
});

test("patterns expose an exclusive editable fifty-two-by-sixty-four face-pose grid", () => {
  assert.equal(HICCUP_HEAD_STEP_COUNT, 64);
  assert.deepEqual(HICCUP_HEAD_VELOCITIES, [0, 0.42, 0.72, 1]);
  assert.equal(HICCUP_HEAD_PATTERNS.length, 19, "the expanded sound bank needs all nineteen rhythms");
  assert.equal(new Set(HICCUP_HEAD_PATTERNS.map(({ id }) => id)).size, HICCUP_HEAD_PATTERNS.length);

  for (const pattern of HICCUP_HEAD_PATTERNS) {
    assert.equal(hiccupHeadPattern(pattern.id), pattern);
    assert.deepEqual(Object.keys(pattern.rows), SOUND_IDS);
    let activeCells = 0;
    for (const soundId of SOUND_IDS) {
      assert.equal(pattern.rows[soundId].length, HICCUP_HEAD_STEP_COUNT);
      for (const amount of pattern.rows[soundId]) {
        assert.ok(Number.isFinite(amount));
        assert.ok(amount >= 0 && amount <= 1);
        if (amount > 0) activeCells += 1;
      }
    }
    for (let phraseStart = 0; phraseStart < HICCUP_HEAD_STEP_COUNT; phraseStart += 16) {
      assert.ok(
        SOUND_IDS.some((soundId) => pattern.rows[soundId]
          .slice(phraseStart, phraseStart + 16)
          .some((amount) => amount > 0)),
        `${pattern.id} must remain playable when a 64-step grid reaches phrase ${phraseStart / 16 + 1}`,
      );
    }
    for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
      const activeAtStep = SOUND_IDS.filter((soundId) => pattern.rows[soundId][step] > 0);
      assert.ok(activeAtStep.length <= 1, `${pattern.id} step ${step + 1} cannot layer mouth poses`);
    }
    assert.ok(activeCells > 0, `${pattern.id} must contain at least one hit`);
  }

  const newPercussionIds = ["snare", "snap", "tomlo", "tomhi", "braap"];
  for (const soundId of newPercussionIds) {
    assert.ok(
      HICCUP_HEAD_PATTERNS.some((candidate) => candidate.rows[soundId].some((amount) => amount > 0)),
      `${soundId} must be exercised by at least one shipped rhythm preset`,
    );
  }
  const percussionPattern = hiccupHeadPattern("boots-cats");
  assert.ok(
    newPercussionIds.every((soundId) => percussionPattern.rows[soundId].some((amount) => amount > 0)),
    "Boots & Cats must preview every added mouth-percussion identity",
  );

  const pinkAtlas = hiccupHeadPattern("pink-mouth-atlas");
  for (const soundId of [
    "huff", "waow", "whoop", "doodoo", "llll", "purr", "kiss", "hiccup", "eef", "brush",
    "zzzz", "ehyeah",
  ]) {
    assert.ok(
      pinkAtlas.rows[soundId].some((amount) => amount > 0),
      `Pink mouth atlas must preview ${soundId}`,
    );
  }

  const tongueMechanics = hiccupHeadPattern("tongue-mechanics");
  for (const soundId of ["klikklak", "rrrr", "lrroll", "lalatrip", "hiccuplong"]) {
    assert.ok(
      tongueMechanics.rows[soundId].some((amount) => amount > 0),
      `Tongue Mechanics must preview ${soundId}`,
    );
  }

  const gapTooth = hiccupHeadPattern("gap-tooth-fwee");
  assert.equal(gapTooth.label, "Gap-tooth FWEE");
  const whistlePhrases = Array.from({ length: 4 }, (_, phrase) => (
    gapTooth.rows.whistle.slice(phrase * 16, phrase * 16 + 16)
  ));
  assert.ok(whistlePhrases.every((phrase) => phrase.some((amount) => amount > 0)));
  assert.equal(
    new Set(whistlePhrases.map((phrase) => roundedSignature(phrase))).size,
    4,
    "FWEE rhythm phrases must evolve across the full 64-step grid",
  );
  assert.ok(gapTooth.rows.whistle.slice(48).some((amount) => amount > 0.9));

  const original = HICCUP_HEAD_PATTERNS[0];
  const editable = clonePattern(original);
  assert.notEqual(editable, original.rows);
  assert.notEqual(editable.bop, original.rows.bop);
  editable.bop[0] = 0;
  assert.notEqual(editable.bop[0], original.rows.bop[0]);

  const hostile = sanitizePattern({
    bop: [Number.NaN, -4, 0.5, 20],
    unknown: Array(HICCUP_HEAD_STEP_COUNT).fill(1),
  });
  assert.deepEqual(Object.keys(hostile), SOUND_IDS);
  assert.equal(hostile.bop.length, HICCUP_HEAD_STEP_COUNT);
  assert.deepEqual(hostile.bop.slice(0, 4), [0, 0, 0.5, 1]);
  assert.ok(hostile.boop.every((amount) => amount === 0));

  assert.deepEqual(
    patternEventsAtStep({ bop: [1], slap: [0.72] }, 0),
    [{ soundId: "bop", velocity: 1, step: 0 }],
  );
  assert.deepEqual(
    patternEventsAtStep({ bop: [0.42], slap: [0.72] }, 0),
    [{ soundId: "slap", velocity: 0.72, step: 0 }],
  );
  assert.deepEqual(
    patternEventsAtStep({ bop: [0.72], slap: [0.72] }, 0),
    [{ soundId: "bop", velocity: 0.72, step: 0 }],
    "stable sound order breaks equal-velocity ties",
  );
  assert.deepEqual(patternEventsAtStep({ boop: { 63: 0.42 } }, -1), [
    { soundId: "boop", velocity: 0.42, step: 63 },
  ]);

  const scattered = randomizePattern(() => 0, 0.22);
  assert.deepEqual(Object.keys(scattered), SOUND_IDS);
  assert.ok(patternEventsAtStep(scattered, 0).length > 0, "scatter always keeps a downbeat");
  assert.ok(Object.values(scattered).flat().every((amount) => HICCUP_HEAD_VELOCITIES.includes(amount)));
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    assert.ok(
      SOUND_IDS.filter((soundId) => scattered[soundId][step] > 0).length <= 1,
      `scattered step ${step + 1} must select at most one mouth pose`,
    );
  }
});

test("velocity cycling and swing preserve every loop duration from one through sixty-four steps", () => {
  const velocityCycle = [0];
  for (let index = 0; index < HICCUP_HEAD_VELOCITIES.length; index += 1) {
    velocityCycle.push(cycleStepVelocity(velocityCycle.at(-1)));
  }
  assert.deepEqual(velocityCycle, [0, 0.72, 1, 0, 0.72]);
  assert.equal(cycleStepVelocity(-10), 0.72);
  assert.equal(cycleStepVelocity(0.42), 0.72);
  assert.equal(cycleStepVelocity(0.6), 0.72);
  assert.equal(cycleStepVelocity(10), 0);

  const tempo = 120;
  const straight = sequenceStepIntervalSeconds(tempo, 0, 0);
  const long = sequenceStepIntervalSeconds(tempo, 0.3, 0);
  const short = sequenceStepIntervalSeconds(tempo, 0.3, 1);
  assert.equal(straight, 0.125);
  assert.ok(long > straight);
  assert.ok(short < straight);
  assert.ok(Math.abs(long + short - straight * 2) < 1e-12);

  for (let stepCount = 1; stepCount <= HICCUP_HEAD_STEP_COUNT; stepCount += 1) {
    const cycleCount = stepCount % 2 === 0 ? 1 : 2;
    const subdivisionCount = stepCount * cycleCount;
    const straightLoop = Array.from({ length: subdivisionCount }, (_, absoluteStep) => (
      sequenceStepIntervalSeconds(tempo, 0, absoluteStep)
    )).reduce((sum, interval) => sum + interval, 0);
    const swungLoop = Array.from({ length: subdivisionCount }, (_, absoluteStep) => (
      sequenceStepIntervalSeconds(tempo, 0.46, absoluteStep)
    )).reduce((sum, interval) => sum + interval, 0);
    assert.ok(Math.abs(straightLoop - subdivisionCount / 8) < 1e-12);
    assert.ok(Math.abs(swungLoop - straightLoop) < 1e-12);
  }
  assert.equal(
    sequenceStepIntervalSeconds(-1e6, -1e6, 0),
    15 / HICCUP_HEAD_LIMITS.tempo[0],
  );
  assert.deepEqual(HICCUP_HEAD_LIMITS.tempo, [48, 520]);
  assert.equal(sequenceStepIntervalSeconds(520, 0, 0), 15 / 520);
  assert.equal(sequenceStepIntervalSeconds(1e6, 0, 0), 15 / 520);
});

test.skip("Hiccup Head bounds mobile grid, canvas, and HUD work without hiding its face controls", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
  ]);
  const drawFaceSource = app.slice(
    app.indexOf("function drawFace("),
    app.indexOf("function drawWaveform("),
  );

  assert.match(
    app,
    /function flashSound\([\s\S]*?for \(const element of \[padButtonsBySound\.get\(sound\.id\)\]\)/,
  );
  assert.doesNotMatch(
    app,
    /document\.querySelectorAll\(`\[data-sound-id="\$\{sound\.id\}"\]`\)/,
    "one hit must not flash every sequencer cell in its sound row",
  );
  assert.match(app, /let gridCellsByStep = \[\]/);
  assert.match(app, /let gridSelectorsByStep = \[\]/);
  assert.match(app, /let gridHeadingsByStep = \[\]/);
  assert.match(
    app,
    /function updateGridPlayhead\(\)[\s\S]*?gridCellsByStep\[paintedGridStep\]\?\.classList\.remove\("is-current"\)[\s\S]*?gridCellsByStep\[visibleStep\]\?\.classList\.add\("is-current"\)[\s\S]*?paintedGridStep = visibleStep/,
  );
  assert.doesNotMatch(
    app,
    /\$\("sequenceGrid"\)\.querySelectorAll\("\.hiccup-head-(?:step-cell|step-number)"\)/,
    "playhead movement must touch only the previous and current cached columns",
  );
  assert.match(app, /function renderPatternColumn\(step\)/);
  assert.match(
    app,
    /function handleSequenceGridClick\([\s\S]*?renderPatternColumn\(step\)/,
  );
  assert.match(app, /\$\("sequenceGrid"\)\.addEventListener\("click", handleSequenceGridClick\)/);
  assert.match(app, /\$\("sequenceGrid"\)\.addEventListener\("keydown", handleGridKeydown\)/);

  assert.match(app, /matchMedia\?\.\("\(max-width: 680px\), \(pointer: coarse\)"\)/);
  assert.match(
    app,
    /function drawStage\([\s\S]*?requestAnimationFrame\(drawStage\)[\s\S]*?flushVisualQueue\(now\)[\s\S]*?!stageIsVisible[\s\S]*?Audio owns the realtime budget[\s\S]*?1000 \/ 24/,
    "offscreen faces must skip paint and compact faces must cap at 24 fps so audio owns the realtime budget",
  );
  assert.match(app, /new IntersectionObserver\([\s\S]*?stageIsVisible = Boolean\(entry\?\.isIntersecting\)/);
  assert.match(app, /Math\.min\(compact \? 1\.5 : 2, globalThis\.devicePixelRatio \|\| 1\)/);
  assert.match(app, /const pixelBudget = compact \? 650_000 : 2_800_000/);
  assert.match(app, /function setTextIfChanged\(id, value\)/);
  assert.match(app, /if \(!force && now - lastHudUpdateAt < 80\) return/);
  assert.match(app, /updateHud\(pose, \{ force: false, now \}\)/);

  assert.match(
    css,
    /@media \(max-width:\s*960px\)[\s\S]*?\.hiccup-head-grid-scroll\s*\{[^}]*overscroll-behavior-y:\s*auto/,
    "the grid must hand vertical scrolling back to the page on phones",
  );
  assert.match(
    css,
    /@media \(max-width:\s*960px\) and \(max-height:\s*560px\)[\s\S]*?grid-template-rows:\s*clamp\(220px, 58dvh, 270px\) 420px/,
  );
  assert.doesNotMatch(html, /hiccup-head-(?:drag-legend|face-guide)/);
  assert.doesNotMatch(css, /hiccup-head-(?:drag-legend|face-guide)/);
  assert.doesNotMatch(html, /\d+ SOUNDS\s*·\s*ANY LENGTH|Sequence the mutable face/i);
  assert.match(
    html,
    /<button id="restartButton"[^>]*aria-label="Back to beginning"[^>]*>\s*<span[^>]*aria-hidden="true"[^>]*>[^<]+<\/span>\s*<\/button>/,
    "restart must be an icon-only control with an accessible Back to beginning name",
  );
  assert.doesNotMatch(html, />\s*First\s*</i);

  assert.match(html, /id="stage"[\s\S]*?slap mitts appear only while dragging SLAP or SMACK/i);
  assert.match(html, /id="presetSelect"[^>]*aria-label="Hiccup Head physical preset"/);
  assert.match(html, /id="patternSelect"[^>]*aria-label="Hiccup Head sequence pattern"/);
  assert.match(app, /function populateSelects\(\)[\s\S]*?HICCUP_HEAD_PRESETS\.map/);
  assert.match(app, /function populateSelects\(\)[\s\S]*?HICCUP_HEAD_PATTERNS\.map/);
  assert.match(
    app,
    /function initialize\(\)[\s\S]*?populateSelects\(\)[\s\S]*?buildPadGrid\(\)[\s\S]*?buildVoiceRack\([\s\S]*?setSequenceLength\([\s\S]*?bindControls\(\)/,
    "startup must populate every preset and sound bank before interaction is bound",
  );
  assert.match(
    app,
    /handles = \[[\s\S]*?key: "earSpread"[\s\S]*?axis: "x-invert"[\s\S]*?key: "earSpread"[\s\S]*?axis: "x"/,
    "both ears must remain visible horizontal parameter handles",
  );
  assert.match(
    app,
    /hands = \[[\s\S]*?id: "left"[\s\S]*?soundId: "slap"[\s\S]*?id: "right"[\s\S]*?soundId: "smack"/,
    "both visible slap hands must be built into the face geometry",
  );
  assert.match(app, /buildHitGeometry\(layout, pose\)[\s\S]*?drawHands\(drawing, motion\)[\s\S]*?drawHandles\(drawing\)/);
  assert.match(app, /pointerDrag = \{[\s\S]*?type: "hand"[\s\S]*?soundId: hand\.soundId/);
  assert.match(app, /triggerSound\(drag\.soundId, velocity, handStrikeConfiguration\(drag\.handId\)\)/);

  const tineBank = app.match(
    /const TOOTH_TINE_PROFILES = Object\.freeze\(\[([\s\S]*?)\]\.map\(/,
  )?.[1] ?? "";
  const tineProfiles = [...tineBank.matchAll(/\[(\d+),\s*([\d.]+)\]/g)]
    .map(([, frequencyHz, brightness]) => ({
      frequencyHz: Number(frequencyHz),
      brightness: Number(brightness),
    }));
  assert.equal(tineProfiles.length, 12, "every non-gap tooth size needs a stable tine profile");
  assert.equal(new Set(tineProfiles.map(({ frequencyHz }) => frequencyHz)).size, 12);
  assert.deepEqual(
    tineProfiles.map(({ frequencyHz }) => frequencyHz),
    [132, 164, 203, 247, 292, 341, 397, 456, 518, 579, 638, 699],
    "the twelve visible teeth must request clearly separated pitches across 132–699 Hz",
  );
  assert.ok(tineProfiles.every(({ frequencyHz, brightness }) => (
    frequencyHz >= 132 && frequencyHz <= 699 && brightness > 0 && brightness < 1
  )));
  assert.ok(
    new Set(tineProfiles.slice(1).map(({ frequencyHz }, index) => (
      frequencyHz - tineProfiles[index].frequencyHz
    ))).size > 5,
    "the teeth must remain irregular pieces of dry wood rather than an even keyboard",
  );
  assert.match(
    app,
    /const toothCount = TOOTH_TINE_PROFILES\.length \+ 1;[\s\S]*?const missingFrontIncisor = Math\.floor\(toothCount \/ 2\);[\s\S]*?for \(let tooth = 0; tooth < toothCount; tooth \+= 1\) \{[\s\S]*?if \(tooth === missingFrontIncisor\) continue;[\s\S]*?const profileIndex = tooth < missingFrontIncisor \? tooth : tooth - 1;[\s\S]*?toothTines\.push\(\{[\s\S]*?toothIndex: profileIndex,[\s\S]*?frequencyHz: profile\.frequencyHz/,
    "thirteen upper cells must expose twelve one-to-one wood tines around the missing FWEE incisor",
  );
  assert.match(
    app,
    /const teethHeight = clamp\(liveOpening \* 0\.52, 7, ry \* 0\.12\)/,
    "the visible tooth row must retain useful height even at a compact mouth opening",
  );
  assert.match(app, /function toothTineAtPoint\(point\)/);
  assert.match(
    app,
    /function triggerToothTine\([\s\S]*?position = clamp\([\s\S]*?triggerSound\("tlik", velocity, null, \{ toothTine \}\)/,
  );
  assert.match(
    app,
    /function postStrike\([\s\S]*?frequencyHz: clamp\([\s\S]*?brightness: clamp\([\s\S]*?\{ toothTine \}/,
  );
  const toothLayerSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// Tooth paint is clipped to the one oral cavity"),
    drawFaceSource.indexOf("// One continuous tongue changes"),
  );
  assert.match(
    toothLayerSource,
    /context\.clip\(\);[\s\S]*?const toothFill[\s\S]*?toothTines\.push\([\s\S]*?context\.restore\(\);[\s\S]*?const upperLipOcclusionWidth[\s\S]*?context\.strokeStyle = lipGradient[\s\S]*?context\.stroke\(\)/,
    "teeth must paint inside the oral clip before the upper lip is repainted over them",
  );
  assert.match(
    drawFaceSource,
    /toothGapGeometry = \{[\s\S]*?width: toothCellWidth,[\s\S]*?height: teethHeight/,
  );
  assert.match(app, /function toothWhistleGapAtPoint\(point\)/);
  assert.match(app, /soundId: "whistle"[\s\S]{0,180}?label: "FWEE"/);
  assert.doesNotMatch(app, /TAP TEETH|DRY WOOD\s+\/\s+GAP|LIPS?\s*·\s*/i);
  assert.match(html, /dry (?:dead-)?wood tines/i);

  const sideHairGeometrySource = app.slice(
    app.indexOf("function sideSpaghettiHairGeometry("),
    app.indexOf("function appendHeadSilhouette("),
  );
  assert.match(
    sideHairGeometrySource,
    /const lengthKey = side < 0 \? "leftHairLength" : "rightHairLength";[\s\S]*?const angleKey = side < 0 \? "leftHairAngle" : "rightHairAngle"/,
    "each side must select its own independent length and angle controls",
  );
  assert.match(
    sideHairGeometrySource,
    /Roots tuck behind the lower side silhouette[\s\S]*?const rootX = cx \+ side \* rx \* 0\.8;[\s\S]*?const rootY = cy - ry \* 0\.34;/,
    "delay hair must emerge from behind the lower side skull",
  );
  assert.match(
    sideHairGeometrySource,
    /const angleRadians = angleAmount \* 0\.62;[\s\S]*?const directionX = side \* Math\.cos\(angleRadians\);[\s\S]*?const directionY = Math\.sin\(angleRadians\);[\s\S]*?const rawLength = rx \* \(0\.08 \+ lengthAmount \* 1\.02\)/,
    "angle must rotate delay time while length independently controls radial echo amount",
  );
  assert.doesNotMatch(
    sideHairGeometrySource,
    /earSpread|silliness|\bnow\b|Math\.random/,
    "ear motion, animation, and randomness must not silently move the delay-hair handles",
  );
  const buildHairGeometry = Function(
    "cssWidth",
    "cssHeight",
    "clamp",
    `return (${sideHairGeometrySource.trim()});`,
  );
  const hairGeometry = buildHairGeometry(1_200, 800, clamp);
  const hairLayout = { cx: 600, cy: 400, rx: 250, ry: 300 };
  const shortLeft = hairGeometry(hairLayout, {
    ...HICCUP_HEAD_DEFAULTS,
    leftHairLength: 0,
    leftHairAngle: 0,
  }, -1);
  const longLeft = hairGeometry(hairLayout, {
    ...HICCUP_HEAD_DEFAULTS,
    leftHairLength: 1,
    leftHairAngle: 0,
  }, -1);
  const longRight = hairGeometry(hairLayout, {
    ...HICCUP_HEAD_DEFAULTS,
    rightHairLength: 1,
    rightHairAngle: 0,
  }, 1);
  assert.ok(longLeft.length > shortLeft.length * 3);
  assert.ok(
    Math.abs(shortLeft.rootX - hairLayout.cx) >= hairLayout.rx * 0.78
      && Math.abs(shortLeft.rootX - hairLayout.cx) <= hairLayout.rx * 0.82,
    "the hair root must sit just inside the side-skull envelope",
  );
  assert.ok(
    shortLeft.length <= hairLayout.rx * 0.1,
    "minimum hair must stay close to the head rather than floating away from it",
  );
  assert.ok(longLeft.tipX < hairLayout.cx - hairLayout.rx);
  assert.ok(longRight.tipX > hairLayout.cx + hairLayout.rx);
  assert.equal(longLeft.tipY, longLeft.rootY);
  assert.equal(longRight.tipY, longRight.rootY);

  const sideHairPaintSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// Each side owns its own polar spaghetti control"),
    drawFaceSource.indexOf("// Ears are stereo controls"),
  );
  assert.match(sideHairPaintSource, /for \(const side of \[-1, 1\]\)/);
  assert.match(sideHairPaintSource, /const strandCount = compactHair \? 7 : 9/);
  assert.match(
    sideHairPaintSource,
    /exterior clip hides only the short root section tucked behind the skull[\s\S]*?context\.rect\(-cssWidth, -cssHeight, cssWidth \* 3, cssHeight \* 3\);[\s\S]*?appendHeadSilhouette\(context, layout, pop, slap\);[\s\S]*?context\.clip\("evenodd"\);[\s\S]*?for \(const side of \[-1, 1\]\)/,
    "hair must paint outside an even-odd head mask so its roots emerge from slightly behind the outline",
  );
  assert.match(
    sideHairPaintSource,
    /const irregular = Math\.sin\([\s\S]*?const strandAngle = hair\.angleRadians[\s\S]*?const directionX = side \* Math\.cos\(strandAngle\)[\s\S]*?context\.lineTo\([\s\S]*?context\.lineTo\(tipX, tipY\)/,
    "the asymmetrical strands must be deterministic straight rays controlled by their side's angle",
  );
  assert.doesNotMatch(sideHairPaintSource, /quadraticCurveTo|bezierCurveTo|Math\.random/);
  const hairStrokeWidths = [...sideHairPaintSource.matchAll(
    /context\.lineWidth = \(compactHair \? ([\d.]+) : ([\d.]+)\)/g,
  )].map(([, compactWidth, desktopWidth]) => [Number(compactWidth), Number(desktopWidth)]);
  assert.ok(
    hairStrokeWidths.length >= 2
      && hairStrokeWidths[0][0] >= 6
      && hairStrokeWidths[0][1] >= 7
      && hairStrokeWidths[1][0] >= 3.5,
    "the side rays need a thick spaghetti outline and a clearly visible colored core",
  );

  const earTetherSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// Each ear has its own short elastic tether"),
    drawFaceSource.indexOf("// Each side owns its own polar spaghetti control"),
  );
  assert.match(earTetherSource, /const earSpread = clamp\(pose\.earSpread\)/);
  assert.match(earTetherSource, /for \(const side of \[-1, 1\]\)/);
  assert.match(
    earTetherSource,
    /const tetherHeadX = cx \+ side[\s\S]*?const tetherHeadY = earY;[\s\S]*?const tetherEarX = earX;[\s\S]*?const tetherEarY = earY;[\s\S]*?const tetherTurns = [^;]*earSpread[\s\S]*?const tetherAmplitude = [^;]*earSpread/,
    "each ear needs its own strictly horizontal coil back to the adjacent head edge",
  );
  assert.match(
    earTetherSource,
    /const tetherSegments = compactHair \? 18 : 24[\s\S]*?context\.moveTo\(tetherHeadX, tetherHeadY\)[\s\S]*?Math\.sin\(progress \* tetherTurns \* Math\.PI \* 2\) \* tetherAmplitude/,
  );
  assert.doesNotMatch(earTetherSource, /hairDelay|stereoSpring|LeftEarX|RightEarX/);

  const handleGeometrySource = app.slice(
    app.indexOf("  handles = ["),
    app.indexOf("  const handRadius", app.indexOf("  handles = [")),
  );
  assert.equal((handleGeometrySource.match(/key: "leftHairLength"/g) ?? []).length, 1);
  assert.equal((handleGeometrySource.match(/key: "rightHairLength"/g) ?? []).length, 1);
  assert.equal((handleGeometrySource.match(/lengthKey: "leftHairLength"/g) ?? []).length, 1);
  assert.equal((handleGeometrySource.match(/lengthKey: "rightHairLength"/g) ?? []).length, 1);
  assert.equal((handleGeometrySource.match(/angleKey: "leftHairAngle"/g) ?? []).length, 1);
  assert.equal((handleGeometrySource.match(/angleKey: "rightHairAngle"/g) ?? []).length, 1);
  assert.equal((handleGeometrySource.match(/key: "earSpread"/g) ?? []).length, 2);
  assert.match(
    handleGeometrySource,
    /id: "left-hair"[\s\S]{0,260}?lengthKey: "leftHairLength"[\s\S]{0,220}?angleKey: "leftHairAngle"[\s\S]{0,260}?feature: "hair"[\s\S]*?id: "right-hair"[\s\S]{0,260}?lengthKey: "rightHairLength"[\s\S]{0,220}?angleKey: "rightHairAngle"/,
  );
  assert.match(
    handleGeometrySource,
    /id: "left-ear"[\s\S]{0,220}?key: "earSpread"[\s\S]{0,260}?feature: "ear"[\s\S]*?id: "right-ear"[\s\S]{0,220}?key: "earSpread"/,
  );
  assert.match(
    app,
    /const handRadius = clamp\(Math\.min\(rx, ry\) \* 0\.175, 27, 57\)/,
    "both slap hands must remain twenty-five percent larger than the former 0.14-scale mitts",
  );

  const eyePaintSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// Two large matched circular eyes"),
    drawFaceSource.indexOf("// One oversized glossy clown-red circle"),
  );
  assert.match(eyePaintSource, /const eyeClosure = clamp\(Number\(pose\.eyeClosure\) \|\| 0\)/);
  assert.match(
    eyePaintSource,
    /const eyeRadius = Math\.min\(rx, ry\) \* 0\.235[\s\S]*?const eyeRx = eyeRadius;[\s\S]*?const baseEyeRy = eyeRadius;/,
    "both eyes must share one enlarged circular geometry",
  );
  assert.match(eyePaintSource, /const eyeRy = Math\.max\(2\.2, baseEyeRy \* \(1 - eyeClosure \* 0\.92\)\)/);
  assert.match(
    app,
    /type: "eye-2d"[\s\S]{0,420}?startClosure: state\.eyeClosure[\s\S]*?pointerDrag\.type === "eye-2d"[\s\S]*?queueCanvasStateUpdates\(\{ eyeDivergence: divergence, eyeClosure: closure \}\)/,
    "vertical eye dragging must control visual lid closure while outward dragging controls reverb",
  );
  assert.match(app, /Number\(value\) < -0\.005[\s\S]{0,80}?`\$\{amount\}% crossed`/);
  assert.match(app, /label: "REVERB ↔ · LIDS ↓"/);
  assert.doesNotMatch(app, /(?:ROBOT|GATE) ↔ REVERB/);

  const sequenceLengthSource = app.slice(
    app.indexOf("function setSequenceLength("),
    app.indexOf("function buildPadGrid("),
  );
  assert.doesNotMatch(
    sequenceLengthSource,
    /stopSequence\(/,
    "changing the number of steps must not stop an already playing sequence",
  );

  const drawHandlesSource = app.slice(
    app.indexOf("function drawHandles("),
    app.indexOf("function drawHands("),
  );
  assert.match(drawHandlesSource, /const revealed = selected \|\| hovered/);
  assert.match(drawHandlesSource, /context\.arc\([\s\S]*?context\.stroke\(\)/);
  assert.doesNotMatch(drawHandlesSource, /strokeRect/);
  assert.ok((drawHandlesSource.match(/context\.arc\(/g) ?? []).length >= 2);
  assert.doesNotMatch(
    drawHandlesSource,
    /context\.fill\(\)/,
    "parameter badges and their hover labels must stay transparent and outline-only",
  );
  assert.match(
    drawHandlesSource,
    /if \(revealed\) \{[\s\S]*?roundedRect\([\s\S]*?context\.stroke\(\)[\s\S]*?context\.strokeText\([\s\S]*?context\.fillText\(/,
    "handle text must appear only on hover or active drag without a filled black label box",
  );

  assert.match(app, /\{ key: "tongueOut", format: formatPercent \}/);
  assert.match(
    app,
    /key: "tongueOut"[\s\S]{0,180}?label: "TONGUE OUT ↕"[\s\S]{0,180}?feature: "tongue"/,
  );
  assert.match(html, /id="tongueOut"[^>]*min="0"[^>]*max="1\.6"/);

  assert.match(app, /\{ key: "leftBrow", format: formatPercent \}/);
  assert.match(app, /\{ key: "rightBrow", format: formatPercent \}/);
  assert.match(
    app,
    /function browPerformanceGain\([\s\S]*?0\.35 \+ normalized \* 1\.3[\s\S]*?1 \+ \(normalized - 0\.5\) \* 0\.5/,
    "the brow performance range must stay neutral at center and bounded from 0.35 to 1.25",
  );
  assert.match(app, /function browSequenceGain\([\s\S]*?Math\.cos\([\s\S]*?leftGain[\s\S]*?rightGain/);
  assert.match(
    app,
    /function scheduleSequence\(\)[\s\S]*?const sequencedVelocity = clamp\([\s\S]*?browSequenceGain\([\s\S]*?postStrike\(/,
  );
  const manualTriggerSource = app.slice(
    app.indexOf("async function triggerSound"),
    app.indexOf("function toothTineAtPoint"),
  );
  assert.doesNotMatch(
    manualTriggerSource,
    /browSequenceGain/,
    "eyebrows must contour the loop without changing manual pad strikes",
  );
  assert.match(
    app,
    /key: "leftBrow"[\s\S]{0,180}?label: "LOOP A"[\s\S]*?key: "rightBrow"[\s\S]{0,180}?label: "LOOP B"/,
  );
  assert.match(html, /id="leftBrow"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /id="rightBrow"[^>]*min="0"[^>]*max="1"/);

  const browPaintSource = drawFaceSource.slice(
    drawFaceSource.indexOf("const brow = eyebrowGeometry"),
    drawFaceSource.indexOf("// Raise the nasal resonator"),
  );
  const browWidths = [...browPaintSource.matchAll(
    /context\.lineWidth = ([\d.]+) \+ goofballEnergy \* ([\d.]+)/g,
  )].map(([, base, boost]) => ({ base: Number(base), boost: Number(boost) }));
  assert.equal(browWidths.length, 2, "each eyebrow needs a dark body and bright inset stroke");
  assert.ok(
    browWidths[0].base >= 7 && browWidths[1].base >= 4.5,
    "both eyebrow passes must remain clearly thick at rest",
  );
  assert.ok(browWidths.every(({ boost }) => boost > 0));
});

test.skip("Hiccup Head fills its canvas with a large outlined, translucent-checker goofball head", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const drawFaceSource = app.slice(
    app.indexOf("function drawFace("),
    app.indexOf("function drawWaveform("),
  );
  const headOutlineSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// Restore opaque stroke state"),
    drawFaceSource.indexOf("// Two large matched circular eyes"),
  );

  assert.match(app, /getContext\("2d", \{ alpha: false,/);
  assert.match(
    drawFaceSource,
    /context\.save\(\);[\s\S]{0,260}?context\.globalAlpha = 1;[\s\S]{0,180}?context\.globalCompositeOperation = "source-over"/,
    "each face paint pass must begin from opaque source-over canvas state",
  );
  assert.match(
    headOutlineSource,
    /checker skin with no opaque base fill/i,
    "the head must retain a strong outline without an opaque base coat",
  );
  assert.match(
    headOutlineSource,
    /context\.strokeStyle = "rgba\(232, 142, 225, 0\.96\)";[\s\S]*?context\.closePath\(\);\s*context\.stroke\(\);/,
    "one pink-purple contour must define the whole head",
  );
  assert.doesNotMatch(
    headOutlineSource,
    /(?:fillStyle|\.fill\(|create(?:Linear|Radial)Gradient)/,
    "the head silhouette itself may not regain a filler coat or background gradient",
  );
  assert.doesNotMatch(
    drawFaceSource,
    /faceBaseGradient|faceTintGradient|pastelRibbonWidth|Opaque pastel swirls|chalk-white|const paintColor/,
  );

  const skinCheckerSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// A translucent two-color checkerboard"),
    drawFaceSource.indexOf("// Restore opaque stroke state"),
  );
  assert.match(
    skinCheckerSource,
    /checkerboard supplies the skin without an opaque[\s\S]*?base fill[\s\S]*?appendHeadSilhouette\(context, layout, pop, slap\);[\s\S]*?context\.clip\(\)/,
    "checker skin must be clipped to the same deforming head silhouette without a base coat",
  );
  assert.match(
    skinCheckerSource,
    /const skinCheckerSize = clamp\(Math\.min\(rx, ry\) \* 0\.18, 22, 34\)[\s\S]*?if \(\(rowIndex \+ columnIndex\) % 2 === colorIndex\) \{[\s\S]*?context\.rect\(checkerX, checkerY, skinCheckerSize, skinCheckerSize\)/,
    "bounded square tiles must alternate by row and column rather than becoming stripes",
  );
  const skinCheckerPaletteStart = app.indexOf("const STOPPED_SKIN_CHECKER_COLORS");
  const skinCheckerPaletteEnd = app.indexOf("\nlet state =", skinCheckerPaletteStart);
  assert.ok(
    skinCheckerPaletteStart >= 0 && skinCheckerPaletteEnd > skinCheckerPaletteStart,
    "checker palette definitions must stay isolated from mutable runtime state",
  );
  const skinCheckerPaletteSource = app.slice(
    skinCheckerPaletteStart,
    skinCheckerPaletteEnd,
  );
  const checkerPaletteApi = Function(
    "HICCUP_HEAD_STEP_COUNT",
    `${skinCheckerPaletteSource}\nreturn {\n  stopped: STOPPED_SKIN_CHECKER_COLORS,\n  sequence: SEQUENCE_SKIN_CHECKER_COLORS,\n  forStep: skinCheckerColorsForStep,\n};`,
  )(HICCUP_HEAD_STEP_COUNT);
  const stoppedSkinCheckerColors = checkerPaletteApi.stopped.map((color) => {
    const match = color.match(/^rgba\((\d+), (\d+), (\d+), (0?\.\d+)\)$/);
    assert.ok(match, `stopped checker color ${color} must be rgba`);
    return match.slice(1).map(Number);
  });
  assert.equal(stoppedSkinCheckerColors.length, 2, "stopped skin needs one purple and one red checker color");
  assert.ok(
    stoppedSkinCheckerColors.some(([red, green, blue, alpha]) => (
      blue > red && red > green && alpha === 0.4
    )),
    "the skin needs an exactly forty-percent-opaque purple checker",
  );
  assert.ok(
    stoppedSkinCheckerColors.some(([red, green, blue, alpha]) => (
      red > blue && blue > green && alpha === 0.4
    )),
    "the skin needs an exactly forty-percent-opaque red checker",
  );
  assert.ok(
    stoppedSkinCheckerColors.every(([, , , alpha]) => alpha === 0.4),
    "both stopped checker colors must share the requested forty-percent opacity",
  );
  assert.equal(checkerPaletteApi.sequence.length, HICCUP_HEAD_STEP_COUNT);
  assert.equal(HICCUP_HEAD_STEP_COUNT, 64);
  const stepPaletteSignatures = [];
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    const palette = checkerPaletteApi.sequence[step];
    assert.equal(palette.length, 2, `step ${step + 1} needs exactly two checker colors`);
    assert.equal(Object.isFrozen(palette), true);
    assert.equal(checkerPaletteApi.forStep(step), palette);
    assert.equal(checkerPaletteApi.forStep(step + HICCUP_HEAD_STEP_COUNT), palette);
    const parsedColors = palette.map((color) => {
      const match = color.match(/^hsla\((\d+), 76%, 55%, (0?\.\d+)\)$/);
      assert.ok(match, `step ${step + 1} checker color ${color} must be bounded HSLA`);
      return { hue: Number(match[1]), alpha: Number(match[2]) };
    });
    assert.ok(parsedColors.every(({ alpha }) => alpha === 0.4));
    assert.equal(
      (parsedColors[1].hue - parsedColors[0].hue + 360) % 360,
      180,
      `step ${step + 1} checker colors must remain strongly contrasting`,
    );
    stepPaletteSignatures.push(palette.join("|"));
  }
  assert.equal(
    new Set(stepPaletteSignatures).size,
    HICCUP_HEAD_STEP_COUNT,
    "sequencer steps 1 through 64 each need one deterministic checker palette",
  );
  for (let sequenceLength = 1; sequenceLength <= HICCUP_HEAD_STEP_COUNT; sequenceLength += 1) {
    assert.equal(
      new Set(stepPaletteSignatures.slice(0, sequenceLength)).size,
      sequenceLength,
      `a ${sequenceLength}-step sequence needs deterministic visual variation at every step`,
    );
  }
  assert.equal(checkerPaletteApi.forStep(-1), checkerPaletteApi.stopped);
  assert.equal(checkerPaletteApi.forStep(Number.NaN), checkerPaletteApi.stopped);
  assert.doesNotMatch(
    skinCheckerPaletteSource,
    /nextStepTime|sequenceStepIntervalSeconds|postStrike|visualQueue|audioContext|state\.(?:tempo|swing)/,
    "palette lookup must remain pure visual data with no audio-timing dependency",
  );
  assert.match(
    drawFaceSource,
    /^function drawFace\(context, layout, pose, motion, now, checkerStep = -1\)/,
    "drawFace must receive the visual checker step as inert paint data",
  );
  assert.match(
    skinCheckerSource,
    /const skinCheckerColors = skinCheckerColorsForStep\(checkerStep\)/,
    "checker paint must use only the sampled visual step",
  );
  assert.doesNotMatch(
    skinCheckerSource,
    /visibleStep|sequencePlaying|nextStepTime|sequenceStepIntervalSeconds|postStrike|audioContext/,
    "checker painting must not reach back into playback or audio timing state",
  );
  const drawStageSource = app.slice(
    app.indexOf("function drawStage("),
    app.indexOf("function resizeCanvas("),
  );
  assert.match(
    drawStageSource,
    /flushVisualQueue\(now\);[\s\S]*?const checkerStep = sequencePlaying && visibleStep >= 0\s*\? visibleStep % sequenceLength\s*: -1;[\s\S]*?drawFace\(drawing, layout, pose, motion, now, checkerStep\)/,
    "the checker must sample the already-due visual playhead and wrap to every live 1–64-step length",
  );
  const checkerStepSelectionSource = drawStageSource.slice(
    drawStageSource.indexOf("// `visibleStep` is advanced"),
    drawStageSource.indexOf("drawToothWhistleJet("),
  );
  assert.doesNotMatch(
    checkerStepSelectionSource,
    /nextStepTime|sequenceStepIntervalSeconds|sequenceStep\s*=|absoluteStep|postStrike|audioContext/,
    "choosing a checker palette must never mutate or recompute audio timing",
  );
  const schedulerSource = app.slice(
    app.indexOf("function scheduleSequenceAhead("),
    app.indexOf("async function startSequence("),
  );
  assert.doesNotMatch(
    schedulerSource,
    /skinChecker|checkerStep/,
    "the audio lookahead scheduler must remain independent of checker colors",
  );
  assert.equal(
    (skinCheckerSource.match(/context\.fill\(\);/g) ?? []).length,
    1,
    "the checker loop may batch its tiles but may not add a separate solid base fill",
  );
  assert.match(
    skinCheckerSource,
    /context\.fillStyle = skinCheckerColors\[colorIndex\];\s*context\.fill\(\);/,
    "every skin fill must come from one of the two translucent checker colors",
  );
  assert.doesNotMatch(
    skinCheckerSource,
    /create(?:Linear|Radial)Gradient|skinBase|baseSkin|solidSkin/i,
    "checker skin may not hide an opaque base fill or gradient",
  );

  const noseSource = drawFaceSource.slice(
    drawFaceSource.indexOf("// One oversized glossy clown-red circle"),
    drawFaceSource.indexOf("const mouthPulse"),
  );
  assert.match(noseSource, /const noseRadius = Math\.min\(rx, ry\) \* \(0\.135 \+ pose\.nasalMix \* 0\.022\)/);
  assert.match(noseSource, /context\.fillStyle = "#FF0000"/);
  assert.match(
    noseSource,
    /context\.arc\(noseX, noseY, noseRadius, 0, Math\.PI \* 2\);[\s\S]*?context\.fill\(\);[\s\S]*?context\.stroke\(\);/,
    "the nose must be one visibly filled and outlined circle",
  );
  assert.match(
    noseSource,
    /noseX - noseRadius \* 0\.38[\s\S]*?noseRadius \* 0\.17/,
    "the circular nose must retain a lightweight glossy highlight",
  );
  assert.doesNotMatch(
    noseSource,
    /nostril|context\.ellipse\(|fillRect|strokeRect/i,
    "the red circle must stay clean instead of regaining nostrils or square geometry",
  );

  const mouthShapeSource = drawFaceSource.slice(
    drawFaceSource.indexOf("const mouthPulse"),
    drawFaceSource.indexOf("// One continuous tongue changes"),
  );
  assert.match(
    mouthShapeSource,
    /const mouthWidth = rx \* clamp\([\s\S]*?Math\.pow\(goofballEnergy, 1\.35\) \* 0\.34[\s\S]*?0\.1,[\s\S]*?0\.96/,
    "increasing silliness must be able to contract the one mouth to a small valve",
  );
  assert.match(
    mouthShapeSource,
    /const mouthExpansion = clamp\([\s\S]*?liveOpening[\s\S]*?mouthWidth[\s\S]*?const lipThickness = ry \* clamp\([\s\S]*?\* \(1 - mouthExpansion \* 0\.66\)/,
    "lip thickness must decrease as the mouth grows wider and more open",
  );

  const lipPaintSource = mouthShapeSource.slice(
    mouthShapeSource.indexOf("const lipGradient"),
    mouthShapeSource.indexOf("// One oral opening inside"),
  );
  const lipGradientColors = [...lipPaintSource.matchAll(
    /lipGradient\.addColorStop\([^,]+, "rgba\((\d+), (\d+), (\d+), ([\d.]+)\)"\)/g,
  )].map(([, red, green, blue, alpha]) => [red, green, blue, alpha].map(Number));
  assert.equal(lipGradientColors.length, 3, "the lip mass needs a dimensional green gradient");
  assert.ok(
    lipGradientColors.every(([red, green, blue, alpha]) => (
      green > red && green > blue && alpha >= 0.85 && alpha < 1
    )),
    "every main lip stop must remain green and nearly opaque",
  );
  assert.match(
    lipPaintSource,
    /Thin translucent purple and blue ribbons[\s\S]*?context\.clip\(\);[\s\S]*?context\.lineWidth = clamp\(lipThickness \* 0\.22, 1\.1, 2\.6\)/,
    "thin decorative stripes must stay clipped inside the green lip mass",
  );
  const lipStripeColors = [...lipPaintSource.matchAll(
    /"rgba\((\d+), (\d+), (\d+), (0?\.\d+)\)"/g,
  )].map(([, red, green, blue, alpha]) => [red, green, blue, alpha].map(Number));
  assert.ok(
    lipStripeColors.some(([red, green, blue, alpha]) => (
      blue > green && red > green && alpha > 0.2 && alpha < 0.6
    )),
    "the lips need one semi-transparent purple stripe",
  );
  assert.ok(
    lipStripeColors.some(([red, green, blue, alpha]) => (
      blue > green && green > red && alpha > 0.2 && alpha < 0.6
    )),
    "the lips need one semi-transparent blue stripe",
  );
  assert.doesNotMatch(
    mouthShapeSource,
    /fillText|strokeText|TAP TEETH|DRY WOOD/,
    "no static words may cover the lips, teeth, or tongue",
  );

  const layoutStart = app.indexOf("function faceLayout(");
  const layoutEnd = app.indexOf("\nfunction telemetryNumber", layoutStart);
  assert.ok(layoutStart >= 0 && layoutEnd > layoutStart);

  const layoutSource = app.slice(layoutStart, layoutEnd).trim();
  const buildLayout = Function(
    "state",
    "cssWidth",
    "cssHeight",
    "clamp",
    `return (${layoutSource});`,
  );
  for (const [cssWidth, cssHeight] of [[390, 390], [680, 500], [1_200, 800]]) {
    const layout = buildLayout(
      HICCUP_HEAD_DEFAULTS,
      cssWidth,
      cssHeight,
      clamp,
    )(HICCUP_HEAD_DEFAULTS);
    assert.ok(Number.isFinite(layout.rx) && Number.isFinite(layout.ry));
    assert.ok(
      layout.rx * 2 >= cssWidth * (cssWidth <= 680 ? 0.6 : 0.48)
        && layout.ry * 2 >= cssHeight * 0.7,
      `the ${cssWidth}x${cssHeight} face must occupy the canvas instead of shrinking into a diagram`,
    );
  }
  assert.match(layoutSource, /const boundaryScale = Math\.min\(cssHeight \* 0\.465, availableWidth \* widthScale\)/);
  assert.match(layoutSource, /const headScale = boundaryScale \* clamp\([\s\S]*?const ry = headScale/);
  assert.match(layoutSource, /const rx = headScale \* clamp\([\s\S]*?pose\.cheekVolume[\s\S]*?tractWarp/);
  const restingLayout = buildLayout(
    HICCUP_HEAD_DEFAULTS,
    390,
    390,
    clamp,
  )(HICCUP_HEAD_DEFAULTS);
  assert.ok(
    Math.abs(restingLayout.rx - restingLayout.ry) >= restingLayout.ry * 0.04,
    "the resting head should remain a visibly stretched oval rather than a forced circle",
  );
});

test.skip("all fifty-two Hiccup Head sounds own exactly one feature-safe face polka dot", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const layoutStart = app.indexOf("const FACE_SOUND_TRIGGER_LAYOUT = Object.freeze([");
  const layoutEnd = app.indexOf("\n]);", layoutStart);
  assert.ok(layoutStart >= 0 && layoutEnd > layoutStart, "the face trigger layout must be explicit");

  const layoutSource = app.slice(layoutStart, layoutEnd + 4);
  const layoutEntries = [...layoutSource.matchAll(
    /\{ soundId: "([^"]+)", slot: (\d+), zone: "([^"]+)"(?:, label: "([^"]+)")? \}/g,
  )].map(([, soundId, slot, zone, label]) => ({
    soundId,
    slot: Number(slot),
    zone,
    label,
  }));
  const expectedSoundIds = HICCUP_HEAD_SOUNDS.map(({ id }) => id);
  assert.equal(layoutEntries.length, HICCUP_HEAD_SOUNDS.length);
  assert.deepEqual(
    [...layoutEntries.map(({ soundId }) => soundId)].sort(),
    [...expectedSoundIds].sort(),
    "no sequencer sound may exist without a matching face target",
  );
  assert.equal(new Set(layoutEntries.map(({ soundId }) => soundId)).size, 52);
  assert.deepEqual(
    layoutEntries.map(({ slot }) => slot).sort((left, right) => left - right),
    Array.from({ length: 52 }, (_, slot) => slot),
    "the mixed face layout must allocate one unique slot per sound",
  );
  assert.deepEqual(
    layoutEntries.find(({ soundId }) => soundId === "whistle"),
    { soundId: "whistle", slot: 31, zone: "tooth-gap", label: "FWEE" },
  );
  assert.deepEqual(layoutEntries.find(({ soundId }) => soundId === "eef"), {
    soundId: "eef", slot: 0, zone: "upper-breath", label: undefined,
  });
  assert.deepEqual(layoutEntries.find(({ soundId }) => soundId === "hiccup"), {
    soundId: "hiccup", slot: 16, zone: "diaphragm-catch", label: undefined,
  });
  assert.deepEqual(
    layoutEntries.slice(-7).map(({ soundId, slot }) => ({ soundId, slot })),
    [
      { soundId: "klikklak", slot: 45 },
      { soundId: "rrrr", slot: 46 },
      { soundId: "lrroll", slot: 47 },
      { soundId: "lalatrip", slot: 48 },
      { soundId: "hiccuplong", slot: 49 },
      { soundId: "zzzz", slot: 50 },
      { soundId: "ehyeah", slot: 51 },
    ],
  );

  assert.match(
    app,
    /FACE_SOUND_TRIGGER_LAYOUT\.length !== HICCUP_HEAD_SOUNDS\.length[\s\S]{0,260}?HICCUP_HEAD_SOUNDS\.some\(\(\{ id \}\) => !faceSoundTriggerIds\.has\(id\)\)/,
    "startup must reject missing, duplicate, or unknown face target mappings",
  );

  const dotSource = app.slice(
    app.indexOf("const FACE_TRIGGER_DOT_POSITIONS"),
    app.indexOf("let state ="),
  );
  const dots = [...dotSource.matchAll(
    /\b([a-z][a-z0-9]*): Object\.freeze\(\{ x: (-?[\d.]+), y: (-?[\d.]+), region: "([^"]+)" \}\)/g,
  )].map(([, soundId, x, y, region]) => ({
    soundId,
    x: Number(x),
    y: Number(y),
    region,
  }));
  assert.equal(dots.length, 52, "every sound must become one face polka dot");
  assert.equal(new Set(dots.map(({ soundId }) => soundId)).size, 52);
  assert.equal(new Set(dots.map(({ x, y }) => `${x}:${y}`)).size, 52);
  assert.deepEqual(
    [...dots.map(({ soundId }) => soundId)].sort(),
    [...expectedSoundIds].sort(),
  );
  assert.match(
    dotSource,
    /faceTriggerDotIds\.size !== HICCUP_HEAD_SOUNDS\.length[\s\S]*?HICCUP_HEAD_SOUNDS\.some\(\(\{ id \}\) => !faceTriggerDotIds\.has\(id\)\)/,
    "startup must reject a missing face dot",
  );

  // The safe bands deliberately leave the eyes, eyebrows, nose, lips, teeth,
  // tongue, ears, hair tips, and enlarged hands clear. Lower sounds form
  // cheek constellations instead of loading up the chin.
  assert.ok(dots.every(({ x, y }) => (
    (y <= -0.6 && Math.abs(x) <= 0.7)
      || (y <= -0.44 && Math.abs(x) >= 0.62)
      || (y >= -0.28 && y <= -0.02 && Math.abs(x) >= 0.34)
      || (y >= 0.02 && y <= 0.7 && Math.abs(x) >= 0.5)
  )), "every dot must occupy an anatomy-safe skin band");
  assert.ok(new Set(dots.map(({ region }) => region)).size >= 5);
  assert.ok(
    new Set(dots.map(({ y }) => y)).size >= 8,
    "polka dots must scatter over the face rather than form a few bottom rows",
  );
  assert.ok(dots.some(({ y }) => y < -0.8));
  assert.ok(dots.some(({ y }) => y >= 0.68));
  assert.ok(dots.filter(({ y }) => y > 0).every(({ region }) => /cheek/.test(region)));
  assert.doesNotMatch(app, /pearl|necklace/i);

  const hitGeometrySource = app.slice(
    app.indexOf("function buildHitGeometry("),
    app.indexOf("function drawHandles("),
  );
  assert.match(hitGeometrySource, /const dotRadius = compact \? 4\.6 : 5\.3/);
  assert.match(hitGeometrySource, /const dotHitRadius = compact \? 9 : 11/);
  assert.match(
    hitGeometrySource,
    /hotspots = HICCUP_HEAD_SOUNDS\.map\(\(sound, fallbackSlot\) => \{[\s\S]*?const dot = FACE_TRIGGER_DOT_POSITIONS\[sound\.id\][\s\S]*?r: dotRadius,[\s\S]*?hitR: dotHitRadius,[\s\S]*?kind: "dot",[\s\S]*?primary: true/,
    "all 52 runtime sounds must construct exactly one generous face-dot target",
  );

  const drawHotspotSource = app.slice(
    app.indexOf("function drawHotspot("),
    app.indexOf("function nearestHotspotAtPoint("),
  );
  assert.match(drawHotspotSource, /const hovered = hoveredHotspotSoundId === hotspot\.soundId/);
  assert.match(drawHotspotSource, /const visibleRadius = hotspot\.r \* \(1 \+ \(hovered \? 0\.35 : 0\) \+ amount \* 0\.22\)/);
  assert.match(
    drawHotspotSource,
    /if \(hovered\) \{[\s\S]*?roundedRect\([\s\S]*?context\.fillText\(hotspot\.label/,
    "trigger words must appear only for the one hovered dot and never rest on the face",
  );
  assert.match(
    app,
    /drawHands\(drawing, motion\)[\s\S]*?drawHandles\(drawing\)[\s\S]*?for \(const hotspot of hotspots\) drawHotspot\(drawing, hotspot, motion\[hotspot\.soundId\] \?\? 0\)/,
    "all 52 tappable dots must paint last so anatomy cannot cover them",
  );

  const padSource = app.slice(
    app.indexOf("function buildPadGrid("),
    app.indexOf("function makeVoiceOption("),
  );
  assert.match(padSource, /HICCUP_HEAD_SOUNDS\.map\(\(sound, index\) =>/);
  assert.match(padSource, /button\.type = "button"/);
  assert.match(padSource, /button\.dataset\.soundId = sound\.id/);
  assert.match(
    padSource,
    /button\.setAttribute\("aria-label", `\$\{sound\.label\}: \$\{sound\.subtitle\}\. Keyboard \$\{sound\.key\}\.`\)/,
    "each visible face circle needs a labeled keyboard-accessible button equivalent",
  );
  assert.match(padSource, /padGrid\.replaceChildren\(\.\.\.pads\)/);

  const pointerDownSource = app.slice(
    app.indexOf("function handlePointerDown("),
    app.indexOf("function handlePointerMove("),
  );
  const nearestSource = app.slice(
    app.indexOf("function nearestHotspotAtPoint("),
    app.indexOf("function colorWithAlpha("),
  );
  assert.match(
    nearestSource,
    /let nearest = null;[\s\S]*?let nearestDistance = Infinity;[\s\S]*?for \(const hotspot of hotspots\)[\s\S]*?distance >= nearestDistance[\s\S]*?return nearest/,
    "even expanded trigger halos must resolve to exactly one nearest sound",
  );
  assert.match(
    pointerDownSource,
    /const nearestHotspotCore = nearestHotspotAtPoint\(point, "r"\);[\s\S]*?const nearestHotspot = nearestHotspotAtPoint\(point, "hitR"\);[\s\S]*?if \(nearestHotspotCore\) \{\s*triggerSound\(nearestHotspotCore\.soundId,[\s\S]{0,120}?return;\s*\}/,
    "a visible trigger core must dispatch once before overlapping anatomy is considered",
  );
  assert.match(
    pointerDownSource,
    /if \(nearestHotspot\) \{\s*triggerSound\(nearestHotspot\.soundId,[\s\S]{0,120}?event\.preventDefault\(\);\s*\}/,
    "the generous invisible fallback must still dispatch at most one nearest target",
  );
  assert.match(
    app,
    /hoveredHotspotSoundId = nearestHotspotCore\?\.soundId[\s\S]*?!overHandle && !overHand \? nearestHoveredHotspot\?\.soundId/,
    "hover labels must not compete with draggable face features or hands",
  );
});

test.skip("persistent face-effect bypasses and voice assignment fallback stay independent", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
  ]);

  assert.match(html, /aria-label="Persistent effect bypasses"/);
  assert.match(
    html,
    /id="effectBypassHelp"[\s\S]*?independent of face presets, mutation, and reset/i,
  );
  for (const key of ["delay", "reverb", "nasal", "stereo"]) {
    assert.match(
      html,
      new RegExp(`id="${key}EffectButton"[^>]*aria-pressed="true"[\\s\\S]{0,100}?id="${key}EffectState"[^>]*>ON<`),
      `${key} needs one persistent, accessible effect switch`,
    );
  }

  const bypassDefinitionsStart = app.indexOf("const FACE_EFFECT_KEYS");
  const bypassDefinitionsEnd = app.indexOf("\nlet state =", bypassDefinitionsStart);
  const audioConfigurationStart = app.indexOf("function audioConfiguration(");
  const audioConfigurationEnd = app.indexOf(
    "\nfunction syncFaceEffectButtons(",
    audioConfigurationStart,
  );
  assert.ok(bypassDefinitionsStart >= 0 && bypassDefinitionsEnd > bypassDefinitionsStart);
  assert.ok(audioConfigurationStart >= 0 && audioConfigurationEnd > audioConfigurationStart);
  const baseFaceState = {
    leftHairLength: 0.72,
    leftHairAngle: -0.37,
    rightHairLength: 0.43,
    rightHairAngle: 0.58,
    eyeDivergence: 0.78,
    nasalMix: 0.66,
    earSpread: 0.81,
  };
  const bypassApi = Function(
    "sanitizeHiccupHeadState",
    "state",
    `${app.slice(bypassDefinitionsStart, bypassDefinitionsEnd)}\n${app.slice(audioConfigurationStart, audioConfigurationEnd)}\nreturn { effects: faceEffectEnabled, audioConfiguration };`,
  )((candidate) => ({ ...candidate }), baseFaceState);
  assert.equal(Object.isSealed(bypassApi.effects), true);
  assert.deepEqual(Object.keys(bypassApi.effects), ["delay", "reverb", "nasal", "stereo"]);
  Object.assign(bypassApi.effects, {
    delay: false,
    reverb: false,
    nasal: false,
    stereo: false,
  });
  const effectSnapshot = { ...bypassApi.effects };
  const bypassed = bypassApi.audioConfiguration();
  assert.equal(bypassed.leftHairLength, 0);
  assert.equal(bypassed.rightHairLength, 0);
  assert.equal(bypassed.leftHairAngle, baseFaceState.leftHairAngle);
  assert.equal(bypassed.rightHairAngle, baseFaceState.rightHairAngle);
  assert.equal(bypassed.eyeDivergence, 0);
  assert.equal(bypassed.eyeClosure, 0);
  assert.equal(bypassed.nasalMix, 0);
  assert.equal(bypassed.earSpread, 0);
  assert.deepEqual(bypassApi.effects, effectSnapshot);
  assert.deepEqual(baseFaceState, {
    leftHairLength: 0.72,
    leftHairAngle: -0.37,
    rightHairLength: 0.43,
    rightHairAngle: 0.58,
    eyeDivergence: 0.78,
    nasalMix: 0.66,
    earSpread: 0.81,
  });
  assert.equal(bypassApi.audioConfiguration({ eyeDivergence: -0.93 }).eyeDivergence, 0);
  Object.assign(bypassApi.effects, {
    delay: true,
    reverb: true,
    nasal: true,
    stereo: true,
  });
  assert.deepEqual(bypassApi.audioConfiguration(), baseFaceState);

  const persistentHelperStart = app.indexOf("function withPersistentFaceEffects(");
  const persistentHelperEnd = app.indexOf(
    "\nfunction createDefaultVoiceSlots(",
    persistentHelperStart,
  );
  assert.ok(persistentHelperStart >= 0 && persistentHelperEnd > persistentHelperStart);
  const persistentHelperApi = Function(
    "sanitizeHiccupHeadState",
    "state",
    `${app.slice(bypassDefinitionsStart, bypassDefinitionsEnd)}\n${app.slice(persistentHelperStart, persistentHelperEnd)}\nreturn { parameters: PRESET_INDEPENDENT_EFFECT_PARAMETERS, preserve: withPersistentFaceEffects };`,
  )(sanitizeHiccupHeadState, HICCUP_HEAD_DEFAULTS);
  const persistentParameterKeys = [
    "leftHairLength",
    "leftHairAngle",
    "rightHairLength",
    "rightHairAngle",
    "eyeDivergence",
    "nasalMix",
    "earSpread",
  ];
  assert.equal(Object.isFrozen(persistentHelperApi.parameters), true);
  assert.deepEqual(persistentHelperApi.parameters, persistentParameterKeys);
  const previousLiveState = sanitizeHiccupHeadState({
    ...HICCUP_HEAD_DEFAULTS,
    leftHairLength: 0.72,
    leftHairAngle: -0.37,
    rightHairLength: 0.43,
    rightHairAngle: 0.58,
    eyeDivergence: -0.78,
    nasalMix: 0.66,
    earSpread: 0.81,
    mouthOpening: 0.14,
  });
  const presetCandidate = sanitizeHiccupHeadState({
    ...HICCUP_HEAD_DEFAULTS,
    leftHairLength: 0.05,
    leftHairAngle: 0.91,
    rightHairLength: 0.96,
    rightHairAngle: -0.82,
    eyeDivergence: 0.64,
    nasalMix: 0.04,
    earSpread: 0.12,
    mouthOpening: 0.83,
  });
  const previousLiveSnapshot = { ...previousLiveState };
  const presetCandidateSnapshot = { ...presetCandidate };
  const preservedState = persistentHelperApi.preserve(presetCandidate, previousLiveState);
  for (const key of persistentParameterKeys) {
    assert.equal(
      preservedState[key],
      previousLiveState[key],
      `${key} must survive preset, mutation, and reset replacements`,
    );
  }
  assert.equal(
    preservedState.mouthOpening,
    presetCandidate.mouthOpening,
    "ordinary face anatomy must still come from the selected preset or mutation",
  );
  assert.deepEqual(previousLiveState, previousLiveSnapshot);
  assert.deepEqual(presetCandidate, presetCandidateSnapshot);

  const presetMutationResetSource = app.slice(
    app.indexOf("function setPreset("),
    app.indexOf("function populateSelects("),
  );
  assert.doesNotMatch(
    presetMutationResetSource,
    /faceEffectEnabled|toggleFaceEffect|FACE_EFFECT_KEYS/,
    "preset load, whole-face mutation, and reset must never rewrite persistent bypass state",
  );
  assert.match(
    presetMutationResetSource,
    /state = withPersistentFaceEffects\(hiccupHeadState\(preset\.id, transport\), state\)/,
    "preset selection must retain all seven live face-effect amounts",
  );
  assert.match(
    presetMutationResetSource,
    /state = withPersistentFaceEffects\(randomizeHiccupHeadState\(state\), state\)/,
    "whole-face mutation must retain all seven live face-effect amounts",
  );
  assert.match(
    presetMutationResetSource,
    /state = withPersistentFaceEffects\(\{ \.\.\.HICCUP_HEAD_DEFAULTS \}, state\);[\s\S]{0,160}?setPreset\(HICCUP_HEAD_DEFAULTS\.presetId/,
    "reset must snapshot the seven live amounts before loading its default preset",
  );
  assert.equal(
    (app.match(/faceEffectEnabled\[key\] = !faceEffectEnabled\[key\]/g) ?? []).length,
    1,
    "only an explicit effect-button action may toggle a bypass",
  );

  const liveSetterStart = app.indexOf("function setStateValue(");
  const liveSetterEnd = app.indexOf(
    "\nfunction flushPendingCanvasStateUpdate(",
    liveSetterStart,
  );
  assert.ok(liveSetterStart >= 0 && liveSetterEnd > liveSetterStart);
  const liveSetterSource = app.slice(liveSetterStart, liveSetterEnd);
  assert.doesNotMatch(
    liveSetterSource,
    /withPersistentFaceEffects/,
    "live controls must write their requested amount instead of restoring the old one",
  );
  const liveSetterApi = Function(
    "sanitizeHiccupHeadState",
    "initialState",
    `let state = sanitizeHiccupHeadState(initialState);\nconst CONTROL_SPECS = [];\nconst $ = () => null;\nconst updateRangeFill = () => {};\nconst graph = null;\nconst audioContext = { currentTime: 0 };\nlet configurationPosts = 0;\nconst postConfiguration = () => { configurationPosts += 1; };\nconst updateHud = () => {};\nconst announce = () => {};\n${liveSetterSource}\nreturn { setStateValue, setStateValues, getState: () => state, getConfigurationPosts: () => configurationPosts };`,
  )(sanitizeHiccupHeadState, previousLiveState);
  const individualLiveValues = {
    leftHairLength: 0.27,
    leftHairAngle: 0.31,
    rightHairLength: 0.84,
    rightHairAngle: -0.46,
    eyeDivergence: -0.52,
    nasalMix: 0.39,
    earSpread: 0.57,
  };
  for (const [key, value] of Object.entries(individualLiveValues)) {
    liveSetterApi.setStateValue(key, value);
    assert.equal(liveSetterApi.getState()[key], value, `${key} must remain directly tweakable live`);
  }
  const batchedLiveValues = {
    leftHairLength: 0.91,
    leftHairAngle: -0.73,
    rightHairLength: 0.19,
    rightHairAngle: 0.68,
    eyeDivergence: 0.44,
    nasalMix: 0.88,
    earSpread: 0.23,
  };
  liveSetterApi.setStateValues(batchedLiveValues);
  for (const [key, value] of Object.entries(batchedLiveValues)) {
    assert.equal(liveSetterApi.getState()[key], value, `${key} must remain canvas-tweakable live`);
  }
  assert.equal(
    liveSetterApi.getConfigurationPosts(),
    persistentParameterKeys.length + 1,
    "individual and paired live gestures must immediately post their audio configuration",
  );

  const availableVoiceSlotsStart = app.indexOf("function availableVoiceSlots(");
  const availableVoiceSlotsEnd = app.indexOf(
    "\nfunction voiceChoiceForSound(",
    availableVoiceSlotsStart,
  );
  const availableVoiceSlotsSource = app.slice(
    availableVoiceSlotsStart,
    availableVoiceSlotsEnd,
  );
  const slots = [
    { id: "wrong-solo", assignment: "aah", solo: true },
    { id: "exact", assignment: "doo", solo: false },
    { id: "all", assignment: "all", solo: false },
    { id: "other", assignment: "ooh", solo: false },
  ];
  const buildAvailableVoiceSlots = (voiceSlots, voiceCount = voiceSlots.length) => Function(
    "voiceSlots",
    "voiceCount",
    `${availableVoiceSlotsSource}\nreturn availableVoiceSlots;`,
  )(voiceSlots, voiceCount);
  let availableVoiceSlots = buildAvailableVoiceSlots(slots);
  assert.deepEqual(
    availableVoiceSlots("doo"),
    [slots[1], slots[2]],
    "compatible assignments must win over an incompatible solo",
  );
  slots[2].solo = true;
  assert.deepEqual(availableVoiceSlots("doo"), [slots[2]]);
  slots[1].assignment = "hee";
  slots[2].assignment = "hee";
  assert.deepEqual(
    availableVoiceSlots("doo"),
    [slots[0]],
    "no-compatible-slot fallback must choose the first active solo deterministically",
  );
  slots[0].solo = false;
  slots[2].solo = false;
  assert.deepEqual(
    availableVoiceSlots("doo"),
    [slots[0]],
    "without compatible or soloed slots the first active character must be retained",
  );
  assert.equal(availableVoiceSlots("doo")[0], availableVoiceSlots("doo")[0]);
  availableVoiceSlots = buildAvailableVoiceSlots(slots, 0);
  assert.deepEqual(availableVoiceSlots("doo"), []);
});

test("Hiccup Head keeps DSP safety and telemetry scans bounded on mobile", async () => {
  const processor = await readFile(new URL("src/hiccup-head-processor.js", root), "utf8");
  const faceSpaceSource = processor.slice(
    processor.indexOf("class FaceSpace"),
    processor.indexOf("function updateReflections"),
  );
  const processSubstepSource = processor.slice(
    processor.indexOf("  processSubstep(sourceFlow, noise)"),
    processor.indexOf("  measurePressureForBlock("),
  );

  const auditInterval = Number(
    processor.match(/const FINITE_AUDIT_INTERVAL_FRAMES = (\d+)/)?.[1],
  );
  const auditWindow = Number(
    processor.match(/const FACE_FINITE_AUDIT_WINDOW = (\d+)/)?.[1],
  );
  assert.ok(auditInterval >= 128, "the complete model audit must not run at audio rate");
  assert.ok(auditWindow >= 32 && auditWindow <= 512, "face delay auditing must use a bounded window");
  assert.match(faceSpaceSource, /scalarsAreFinite\(\)/);
  assert.match(faceSpaceSource, /auditFiniteWindow\(windowSize/);
  assert.match(faceSpaceSource, /finiteAuditBufferIndex/);
  assert.match(faceSpaceSource, /finiteAuditOffset/);
  assert.doesNotMatch(
    faceSpaceSource,
    /arraysAreFinite\(/,
    "the large ear and eye delay buffers must not be fully scanned in one frame",
  );
  assert.match(
    processor,
    /this\.tract\.isFinite\(\)[\s\S]{0,120}?this\.faceSpace\.auditFiniteWindow\(FACE_FINITE_AUDIT_WINDOW\)/,
  );
  assert.match(processor, /this\.finiteAuditCountdown = FINITE_AUDIT_INTERVAL_FRAMES/);

  assert.doesNotMatch(
    processSubstepSource,
    /measurePressureForBlock|targetPressure|this\.tractPressure \+=/,
    "telemetry pressure must not add another oral-tube scan to every propagation substep",
  );
  assert.match(
    processor,
    /process\(_inputs, outputs\)[\s\S]*?for \(let frame = 0; frame < left\.length; frame \+= 1\)[\s\S]*?this\.tract\.measurePressureForBlock\(left\.length\)/,
    "tract pressure should be measured once after each render quantum",
  );
  assert.match(
    processor,
    /measurePressureForBlock\(frameCount = 128\)[\s\S]*?1 - Math\.exp\([\s\S]*?-elapsedFrames \/ Math\.max\(1, this\.rate \* 0\.022\)/,
    "block-rate smoothing must preserve the pressure envelope's real-time constant",
  );

  for (const valveClass of [
    "PressureDrivenLipValve",
    "PressureDrivenTongueValve",
    "PressureDrivenThroatValve",
  ]) {
    const start = processor.indexOf(`class ${valveClass}`);
    const nextClass = processor.indexOf("\nclass ", start + 1);
    const valveSource = processor.slice(start, nextClass < 0 ? undefined : nextClass);
    assert.match(
      valveSource,
      /!enabled[\s\S]{0,180}?positionCm === 0[\s\S]{0,180}?velocityCmPerSecond === 0[\s\S]{0,180}?collisionFlow === 0[\s\S]{0,180}?return this\.apertureCm/,
      `${valveClass} needs an exact inactive-rest fast path`,
    );
  }
  assert.match(processor, /advanceInactive\(frame, plan, noise\)/);
  assert.match(
    processor,
    /_injectToothWhistle\(noise\)[\s\S]*?soundId !== "whistle"[\s\S]*?advanceInactive\([\s\S]*?return;[\s\S]*?const toothIndex/,
    "a closed tooth jet must return before oral pressure and tooth-index work",
  );
  assert.match(
    processor,
    /_advanceSeals\(noise\)[\s\S]*?!seal\.enabled[\s\S]*?!seal\.sealed[\s\S]*?seal\.releaseMemory === 0[\s\S]*?continue;[\s\S]*?const localPressure/,
    "fully inert seals must skip pressure-pocket work",
  );
});

test.skip("Hiccup Head worklet renders fifty-two distinct gestures through exactly one active mouth", async () => {
  const globalKeys = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originals = new Map(globalKeys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  let Processor = null;
  let processorName = null;

  Object.defineProperty(globalThis, "sampleRate", {
    configurable: true,
    writable: true,
    value: 48_000,
  });
  Object.defineProperty(globalThis, "AudioWorkletProcessor", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        this.messages = [];
        this.port = {
          onmessage: null,
          postMessage: (message) => this.messages.push(message),
        };
      }
    },
  });
  Object.defineProperty(globalThis, "registerProcessor", {
    configurable: true,
    writable: true,
    value: (name, Constructor) => {
      processorName = name;
      Processor = Constructor;
    },
  });

  try {
    await import(`../src/hiccup-head-processor.js?hiccup-head-test=${Date.now()}-${Math.random()}`);
    assert.equal(processorName, "hiccup-head-physical-model");
    assert.equal(typeof Processor, "function");

    const mobileAuditProbe = new Processor({
      processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
    });
    const faceDelayCellCount = mobileAuditProbe.faceSpace.finiteAuditBuffers
      .reduce((sum, buffer) => sum + buffer.length, 0);
    assert.ok(faceDelayCellCount > 30_000, "the face-space probe must cover the real delay memory");
    assert.equal(mobileAuditProbe.faceSpace.finiteAuditOffset, 0);
    assert.equal(mobileAuditProbe.faceSpace.auditFiniteWindow(128), true);
    assert.equal(
      mobileAuditProbe.faceSpace.finiteAuditOffset,
      128,
      "one audit call must advance by its bounded window, not scan every delay cell",
    );
    const auditedBuffer = mobileAuditProbe.faceSpace.finiteAuditBuffers[
      mobileAuditProbe.faceSpace.finiteAuditBufferIndex
    ];
    const corruptedOffset = mobileAuditProbe.faceSpace.finiteAuditOffset;
    auditedBuffer[corruptedOffset] = Number.NaN;
    assert.equal(
      mobileAuditProbe.faceSpace.auditFiniteWindow(1),
      false,
      "the rotating audit must still detect corruption when its window reaches it",
    );
    auditedBuffer[corruptedOffset] = 0;
    mobileAuditProbe.faceSpace.reset();

    let pressureMeasurementCalls = 0;
    let pressureMeasurementFrames = 0;
    const measurePressureForBlock = mobileAuditProbe.tract.measurePressureForBlock.bind(
      mobileAuditProbe.tract,
    );
    mobileAuditProbe.tract.measurePressureForBlock = (frameCount) => {
      pressureMeasurementCalls += 1;
      pressureMeasurementFrames += frameCount;
      measurePressureForBlock(frameCount);
    };
    mobileAuditProbe.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(pressureMeasurementCalls, 1);
    assert.equal(pressureMeasurementFrames, 128);

    const inactiveFrame = {
      soundId: "bop",
      lipFlutter: 0,
      tongueTrill: 0,
      throatRattle: 0,
    };
    for (const valve of [
      mobileAuditProbe.tract.lipValve,
      mobileAuditProbe.tract.tongueValve,
      mobileAuditProbe.tract.throatValve,
    ]) {
      const restingAperture = valve.apertureCm;
      assert.equal(valve.advance(inactiveFrame, null, 0, 0), restingAperture);
      assert.equal(valve.positionCm, 0);
      assert.equal(valve.velocityCmPerSecond, 0);
      assert.equal(valve.collisionFlow, 0);
    }

    const render = (
      soundId,
      blocks = 280,
      configuration = HICCUP_HEAD_DEFAULTS,
      voice = null,
    ) => {
      const processor = new Processor({
        processorOptions: { configuration },
      });
      processor._handleMessage({
        type: "strike",
        soundId,
        velocity: 0.86,
        ...(voice ? { voice } : {}),
      });
      const left = new Float32Array(blocks * 128);
      const right = new Float32Array(blocks * 128);
      let offset = 0;
      for (let block = 0; block < blocks; block += 1) {
        const blockLeft = left.subarray(offset, offset + 128);
        const blockRight = right.subarray(offset, offset + 128);
        assert.equal(processor.process([], [[blockLeft, blockRight]]), true);
        offset += 128;
      }
      return { processor, left, right };
    };

    const metrics = (channels) => {
      let energy = 0;
      let peak = 0;
      let audibleSamples = 0;
      for (const samples of channels) {
        for (const sample of samples) {
          assert.ok(Number.isFinite(sample), "worklet output must remain finite");
          energy += sample * sample;
          peak = Math.max(peak, Math.abs(sample));
          if (Math.abs(sample) > 1e-5) audibleSamples += 1;
        }
      }
      return {
        rms: Math.sqrt(energy / (channels.length * channels[0].length)),
        peak,
        audibleSamples,
      };
    };

    const normalizedDifference = (left, right) => {
      let difference = 0;
      let energy = 0;
      for (let index = 0; index < left.length; index += 1) {
        difference += (left[index] - right[index]) ** 2;
        energy += left[index] ** 2 + right[index] ** 2;
      }
      return Math.sqrt(difference / Math.max(1e-12, energy));
    };

    const maximumWindowRms = (channels, windowSize = 2_400) => {
      const boundedWindow = Math.min(windowSize, channels[0].length);
      let windowEnergy = 0;
      for (const channel of channels) {
        for (let index = 0; index < boundedWindow; index += 1) {
          windowEnergy += channel[index] ** 2;
        }
      }
      let maximumEnergy = windowEnergy;
      for (let index = boundedWindow; index < channels[0].length; index += 1) {
        for (const channel of channels) {
          windowEnergy += channel[index] ** 2 - channel[index - boundedWindow] ** 2;
        }
        maximumEnergy = Math.max(maximumEnergy, windowEnergy);
      }
      return Math.sqrt(maximumEnergy / (boundedWindow * channels.length));
    };

    const renders = new Map();
    const renderMetrics = new Map();
    const renderChannels = new Map();
    for (const soundId of SOUND_IDS) {
      const rendered = render(soundId);
      const result = metrics([rendered.left, rendered.right]);
      assert.ok(result.rms > 0.0005, `${soundId} must have audible body, not a vanishing trace`);
      assert.ok(result.peak > 0.008, `${soundId} must have a clear attack or body`);
      assert.ok(result.peak <= 0.721, `${soundId} must stay below the worklet limiter ceiling`);
      assert.ok(result.audibleSamples > 1_000, `${soundId} must render more than an impulse`);
      if (["aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle"].includes(soundId)) {
        assert.ok(result.rms > 0.02, `${soundId} needs sustained throat presence`);
        assert.ok(result.peak > 0.07, `${soundId} needs a present vocal onset`);
        assert.ok(result.audibleSamples > 10_000, `${soundId} needs a sustained physical body`);
      }
      const telemetryMessages = rendered.processor.messages.filter(({ type }) => type === "telemetry");
      const telemetry = telemetryMessages.at(-1);
      assert.equal(telemetry?.lastSoundId, soundId);
      assert.ok(Number.isFinite(telemetry?.peak));
      assert.ok(Number.isFinite(telemetry?.rms));
      assert.ok(telemetryMessages.length > 1);
      for (const message of telemetryMessages) {
        for (const field of [
          "gestureProgress",
          "gestureAmount",
          "tractPressure",
          "constrictionIndex",
          "constrictionDiameterCm",
          "velumOpening",
          "lipDiameterCm",
          "cheekDisplacement",
          "oralSectionCount",
          "dooPitch",
          "tongueOut",
          "earSpread",
          "leftHairLength",
          "rightHairLength",
          "leftHairAngle",
          "rightHairAngle",
          "leftHairDelayMs",
          "rightHairDelayMs",
          "leftHairFeedback",
          "rightHairFeedback",
          "leftHairMix",
          "rightHairMix",
          "hairDelay",
          "hairDelayMs",
          "hairFeedback",
          "hairMix",
          "stereoWidth",
          "stereoDelayMs",
          "eyeDivergence",
          "eyeReverbAmount",
          "eyeClosure",
          "glottalFrequencyHz",
          "vibratoRateHz",
          "vibratoDepthSemitones",
          "roughness",
          "subharmonicMix",
          "throatRattleApertureCm",
          "toothGapWidthCm",
          "toothGapHeightCm",
          "toothJetSlotHeightCm",
          "toothJetAreaCm2",
          "toothJetFlow",
          "toothJetSpeedMps",
          "toothWhistleFrequencyHz",
          "toothWhistleMode",
          "toothWhistleStrouhalNumber",
          "toothJetImpingementLengthM",
          "toothTineFlow",
          "toothTineFrequencyHz",
          "toothKnockFrequencyHz",
          "toothTinePosition",
          "toothTineBrightness",
          "toothTineIndex",
        ]) {
          assert.ok(Number.isFinite(message[field]), `${soundId} telemetry ${field} must be finite`);
        }
        assert.equal(message.missingTooth, HICCUP_HEAD_TOOTH_GAP_ANATOMY.missingTooth);
        assert.ok(message.oralSectionCount >= 8);
        assert.ok(
          message.activeGesture === false
            || message.activeGesture === true
            || message.activeGesture === ""
            || SOUND_IDS.includes(message.activeGesture),
          `${soundId} telemetry must identify at most one gesture`,
        );
      }
      assert.ok(
        telemetryMessages.every(({ activeVoices }) => activeVoices === 0 || activeVoices === 1),
        `${soundId} telemetry must never report layered mouths`,
      );
      assert.ok(
        telemetryMessages.some(({ voiceCharacterId }) => voiceCharacterId === "natural"),
        `${soundId} must report the one character currently retuning its tract`,
      );
      assert.equal("voices" in rendered.processor, false);
      assert.equal("voice" in rendered.processor, false);
      assert.equal("voicePool" in rendered.processor, false);
      assert.ok(rendered.processor.tract, `${soundId} must pass through the persistent tract`);
      renders.set(soundId, rendered.left);
      renderMetrics.set(soundId, result);
      renderChannels.set(soundId, [rendered.left, rendered.right]);
    }

    const sustainedVocalIds = [
      "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "moan", "lala",
    ];
    const sustainedRms = sustainedVocalIds.map((soundId) => renderMetrics.get(soundId).rms);
    assert.ok(sustainedRms.every((rms) => rms >= 0.018 && rms <= 0.11));
    assert.ok(
      Math.max(...sustainedRms) / Math.min(...sustainedRms) <= 3,
      "sustained vocals must share a close perceived-body range",
    );
    const sustainedWindowRms = sustainedVocalIds.map((soundId) => (
      maximumWindowRms(renderChannels.get(soundId))
    ));
    assert.ok(
      Math.max(...sustainedWindowRms) / Math.min(...sustainedWindowRms) <= 1.6,
      "sustained vocals must not hide a much louder fifty-millisecond burst",
    );
    assert.ok(renderMetrics.get("hum").peak < 0.25);
    assert.ok(renderMetrics.get("holler").peak < 0.32);
    assert.ok(
      renderMetrics.get("rattle").rms >= 0.022
        && renderMetrics.get("rattle").rms <= 0.032,
      "RATTLE must retain rough body after its requested 20–25% reduction",
    );
    assert.ok(renderMetrics.get("rattle").peak <= 0.3);
    assert.ok(
      renderMetrics.get("rattle").peak
        <= Math.max(renderMetrics.get("slap").peak, renderMetrics.get("smack").peak) * 1.2,
      "the loudest sustained rough vocal must stay near the hand-clap peak reference",
    );
    assert.ok(
      Math.max(...sustainedRms) <= renderMetrics.get("kick").rms * 1.3,
      "sustained vocals must not overwhelm the kick body",
    );
    assert.ok(renderMetrics.get("bop").rms >= 0.003 && renderMetrics.get("bop").rms <= 0.008);
    assert.ok(renderMetrics.get("bop").peak >= 0.07 && renderMetrics.get("bop").peak <= 0.15);
    assert.ok(renderMetrics.get("boop").rms >= 0.0035, "BOOP needs a selective body lift");
    assert.ok(renderMetrics.get("boop").peak >= 0.045, "BOOP needs a present rounded attack");
    assert.ok(renderMetrics.get("hiccup").rms >= 0.0037, "HIC needs a selective body lift");
    assert.ok(renderMetrics.get("hiccup").peak >= 0.08, "HIC needs an audible diaphragm catch");
    assert.ok(
      maximumWindowRms(renderChannels.get("hiccup")) >= 0.01,
      "the brief HIC catch-release must have present short-window energy",
    );
    for (const soundId of ["snare", "snap", "tomlo", "tomhi", "braap"]) {
      assert.ok(renderMetrics.get(soundId).rms >= 0.0035, `${soundId} needs percussive body`);
      assert.ok(renderMetrics.get(soundId).peak >= 0.05, `${soundId} needs a distinct transient`);
    }

    const openVoiceSoundIds = HICCUP_HEAD_SOUNDS.filter(({ id, family }) => (
      family.includes("vocal") && hiccupHeadPoseForSound(id).mouthOpening >= 0.16
    )).map(({ id }) => id);
    assert.deepEqual(openVoiceSoundIds, [
      "hee", "haw", "doo", "burp", "aah", "ooh", "wail", "yodel",
      "growl", "holler", "rattle", "grunt", "moan", "lala", "hiccup", "eef",
    ]);
    const voiceAudibilityConfigurations = [
      {
        id: "open-throat-preset",
        configuration: { ...hiccupHeadState("open-throat"), eyeClosure: 0 },
      },
      {
        id: "crossed-visual-preset",
        configuration: {
          ...hiccupHeadState("tin-grin"),
          eyeDivergence: -1,
          eyeClosure: 0,
        },
      },
      {
        id: "cavern-preset",
        configuration: { ...hiccupHeadState("cavern-gob"), eyeClosure: 0.18 },
      },
    ];
    const openVoiceResults = [];
    const configurationUseCounts = new Map(
      voiceAudibilityConfigurations.map(({ id }) => [id, 0]),
    );
    for (let soundIndex = 0; soundIndex < openVoiceSoundIds.length; soundIndex += 1) {
      const soundId = openVoiceSoundIds[soundIndex];
      for (let voiceIndex = 0; voiceIndex < HICCUP_HEAD_VOICE_CHARACTERS.length; voiceIndex += 1) {
        const character = HICCUP_HEAD_VOICE_CHARACTERS[voiceIndex];
        const voice = { characterId: character.id, ...character.settings };
        const configurationCase = voiceAudibilityConfigurations[
          (soundIndex + voiceIndex) % voiceAudibilityConfigurations.length
        ];
        configurationUseCounts.set(
          configurationCase.id,
          configurationUseCounts.get(configurationCase.id) + 1,
        );
        const voiced = render(soundId, 128, configurationCase.configuration, voice);
        const result = metrics([voiced.left, voiced.right]);
        const telemetry = voiced.processor.messages.filter(({ type }) => type === "telemetry");
        const label = `${soundId}/${character.id}/${configurationCase.id}`;
        assert.ok(result.rms >= 0.0009, `${label} must retain an audible continuous body`);
        assert.ok(result.peak >= 0.008, `${label} must retain a present onset`);
        assert.ok(result.peak <= 0.721, `${label} must remain below the worklet limiter ceiling`);
        assert.ok(
          telemetry.some(({ voiceCharacterId }) => voiceCharacterId === character.id),
          `${label} must not silently drop its assigned voice character`,
        );
        assert.ok(
          telemetry.some(({ activeVoices }) => activeVoices === 1),
          `${label} must activate the one persistent mouth`,
        );
        openVoiceResults.push({ soundId, characterId: character.id, ...result });
      }
    }
    assert.ok([...configurationUseCounts.values()].every((count) => count > 0));
    assert.equal(
      openVoiceResults.length,
      openVoiceSoundIds.length * HICCUP_HEAD_VOICE_CHARACTERS.length,
    );
    assert.ok(
      openVoiceResults.reduce((sum, { rms }) => sum + rms, 0) / openVoiceResults.length >= 0.008,
      "the complete open-voice collection needs modest overall presence",
    );
    assert.ok(
      Math.max(...openVoiceResults.filter(({ soundId }) => soundId === "rattle").map(({ peak }) => peak))
        <= 0.4,
      "RATTLE must stay controlled across every assigned voice and representative face",
    );

    const pffVoiceResults = HICCUP_HEAD_VOICE_CHARACTERS.map((character, voiceIndex) => {
      const configurationCase = voiceAudibilityConfigurations[
        voiceIndex % voiceAudibilityConfigurations.length
      ];
      const voice = { characterId: character.id, ...character.settings };
      const voiced = render("pff", 128, configurationCase.configuration, voice);
      const result = metrics([voiced.left, voiced.right]);
      const telemetry = voiced.processor.messages.filter(({ type }) => type === "telemetry");
      assert.ok(result.rms >= 0.0007, `PFRR/${character.id} must remain audible`);
      assert.ok(result.peak >= 0.008 && result.peak <= 0.32, `PFRR/${character.id} must stay present but soft-edged`);
      assert.ok(telemetry.some(({ voiceCharacterId }) => voiceCharacterId === character.id));
      return result;
    });
    assert.equal(pffVoiceResults.length, HICCUP_HEAD_VOICE_CHARACTERS.length);

    const fwee = render("whistle", 360);
    const fweeMetrics = metrics([fwee.left, fwee.right]);
    const fweeTelemetry = fwee.processor.messages.filter(({ type }) => type === "telemetry");
    assert.ok(fweeMetrics.rms > 0.001, "FWEE must have an audible pressure-driven body");
    assert.ok(fweeMetrics.peak > 0.01, "FWEE must radiate a clear tooth-edge tone");
    assert.ok(fweeMetrics.audibleSamples > 3_000, "FWEE must sustain beyond a click");
    assert.ok(
      fweeTelemetry.some(({ toothJetFlow }) => Math.abs(toothJetFlow) > 1e-7),
      "FWEE must inject measurable dental volume flow",
    );
    assert.ok(
      fweeTelemetry.some(({ toothJetSpeedMps }) => toothJetSpeedMps > 5),
      "FWEE must accelerate a real pressure-derived air jet",
    );
    assert.ok(
      fweeTelemetry.some(({ toothWhistleFrequencyHz }) => toothWhistleFrequencyHz > 500),
      "FWEE must report a coherent edge-tone frequency",
    );
    assert.ok(
      fweeTelemetry.every(({ activeVoices }) => activeVoices === 0 || activeVoices === 1),
      "the missing-tooth whistle must still use exactly one active tract",
    );
    assert.ok(fwee.processor.tract.toothJet, "FWEE source must live inside the persistent oral tract");
    assert.equal("voices" in fwee.processor, false);
    assert.equal("voicePool" in fwee.processor, false);

    const toothTineProbe = new Processor({
      processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
    });
    const tineMetadata = {
      frequencyHz: 421,
      position: 0.27,
      brightness: 0.9,
      toothIndex: 5,
    };
    toothTineProbe._handleMessage({
      type: "strike",
      soundId: "tlik",
      velocity: 0.92,
      toothTine: tineMetadata,
    });
    assert.deepEqual(toothTineProbe.queue[0].toothTine, tineMetadata);
    assert.ok(toothTineProbe.tract.toothTine, "tooth tines must ring inside the one oral tract");
    const tineLeft = new Float32Array(220 * 128);
    const tineRight = new Float32Array(220 * 128);
    let tinePeakFlow = 0;
    let tineWasActive = false;
    for (let block = 0; block < 220; block += 1) {
      toothTineProbe.process([], [[
        tineLeft.subarray(block * 128, (block + 1) * 128),
        tineRight.subarray(block * 128, (block + 1) * 128),
      ]]);
      tinePeakFlow = Math.max(tinePeakFlow, Math.abs(toothTineProbe.tract.toothTine.flow));
      tineWasActive ||= toothTineProbe.tract.toothTine.active;
    }
    const tineMetrics = metrics([tineLeft, tineRight]);
    assert.ok(tineWasActive && tinePeakFlow > 1e-7, "a tapped tooth must excite its cantilever modes");
    assert.ok(tineMetrics.peak > 0.01 && tineMetrics.audibleSamples > 1_000);
    assert.equal(toothTineProbe.tract.toothTine.frequencyHz, 421);
    assert.ok(
      Math.abs(toothTineProbe.tract.toothTine.resonantFrequencyHz - 346.96) < 0.2,
      "a requested tine profile must retain a recognizably ordered dull-wood pitch",
    );
    const toothRadius = Math.sqrt(toothTineProbe.tract.toothTine.radiusSquared[0]);
    const toothT60Seconds = Math.log(0.001)
      / (Math.log(toothRadius) * toothTineProbe.tract.toothTine.substepRate);
    assert.ok(
      toothT60Seconds >= 0.04 && toothT60Seconds <= 0.075,
      "the dry tooth knock must decay in tens of milliseconds rather than ring",
    );
    assert.equal(toothTineProbe.tract.toothTine.position, 0.27);
    assert.equal(toothTineProbe.tract.toothTine.brightness, 0.9);
    assert.equal(toothTineProbe.tract.toothTine.toothIndex, 5);
    assert.ok(
      toothTineProbe.messages.some((message) => (
        message.type === "telemetry"
        && message.toothTineFrequencyHz === 421
        && Math.abs(message.toothKnockFrequencyHz - 346.96) < 0.2
        && message.toothTinePosition === 0.27
        && message.toothTineBrightness === 0.9
        && message.toothTineIndex === 5
      )),
      "the selected irregular tine must remain visible in telemetry",
    );

    const flatTineProbe = new Processor({
      processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
    });
    const flatTineEvent = flatTineProbe._eventForMessage({
      soundId: "tlik",
      velocity: 0.8,
      toothTineHz: 718,
      toothTinePosition: 0.74,
      toothTineBrightness: 0.76,
      toothTineIndex: 9,
    });
    assert.deepEqual(flatTineEvent.toothTine, {
      frequencyHz: 718,
      position: 0.74,
      brightness: 0.76,
      toothIndex: 9,
    });
    assert.equal(
      flatTineProbe._eventForMessage({
        soundId: "whistle",
        velocity: 0.8,
        toothTine: tineMetadata,
      }).toothTine,
      null,
      "the missing-incisor FWEE event must not be replaced by a tooth tine",
    );

    const toothProfiles = [
      [132, 0.38], [164, 0.76], [203, 0.49], [247, 0.91],
      [292, 0.57], [341, 0.83], [397, 0.44], [456, 0.88],
      [518, 0.61], [579, 0.79], [638, 0.52], [699, 0.94],
    ];
    const toothRenders = [];
    const toothResonances = [];
    for (let toothIndex = 0; toothIndex < toothProfiles.length; toothIndex += 1) {
      const [frequencyHz, brightness] = toothProfiles[toothIndex];
      const tooth = new Processor({
        processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
      });
      tooth._handleMessage({
        type: "strike",
        soundId: "tlik",
        velocity: 0.92,
        toothTine: {
          frequencyHz,
          brightness,
          position: toothIndex / (toothProfiles.length - 1),
          toothIndex,
        },
      });
      const channel = new Float32Array(180 * 128);
      for (let block = 0; block < 180; block += 1) {
        tooth.process([], [[
          channel.subarray(block * 128, (block + 1) * 128),
          new Float32Array(128),
        ]]);
      }
      const result = metrics([channel]);
      assert.ok(result.peak > 0.008, `tooth ${toothIndex + 1} must make an audible knock`);
      assert.equal(tooth.tract.toothTine.frequencyHz, frequencyHz);
      toothRenders.push(channel);
      toothResonances.push(tooth.tract.toothTine.resonantFrequencyHz);
    }
    assert.equal(new Set(toothResonances.map((value) => value.toFixed(2))).size, 12);
    assert.ok(
      toothResonances.every((value, index) => index === 0 || value > toothResonances[index - 1]),
      "left-to-right requested pitches must remain ordered after crooked wood offsets",
    );
    assert.ok(toothResonances[0] >= 110 && toothResonances.at(-1) <= 570);
    for (let index = 1; index < toothRenders.length; index += 1) {
      assert.ok(
        normalizedDifference(toothRenders[index - 1], toothRenders[index]) > 0.12,
        `adjacent teeth ${index} and ${index + 1} must not collapse to one physical output`,
      );
    }

    for (let leftIndex = 0; leftIndex < SOUND_IDS.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < SOUND_IDS.length; rightIndex += 1) {
        const leftId = SOUND_IDS[leftIndex];
        const rightId = SOUND_IDS[rightIndex];
        assert.ok(
          normalizedDifference(renders.get(leftId), renders.get(rightId)) > 0.18,
          `${leftId} and ${rightId} must not collapse to the same rendered gesture`,
        );
      }
    }

    const neutralEffects = {
      ...HICCUP_HEAD_DEFAULTS,
      nasalMix: 0,
      earSpread: 0,
      leftHairLength: 0,
      rightHairLength: 0,
      leftHairAngle: 0,
      rightHairAngle: 0,
      eyeDivergence: 0,
      eyeClosure: 0,
    };
    const dryFace = render("doo", 420, neutralEffects);
    const openFace = render("doo", 420, {
      ...neutralEffects,
      earSpread: 1,
      eyeDivergence: 1,
    });
    const divergentEyes = render("doo", 420, {
      ...neutralEffects,
      eyeDivergence: 1,
    });
    const crossedEyes = render("doo", 420, {
      ...neutralEffects,
      eyeDivergence: -1,
    });
    const openNose = render("doo", 420, {
      ...neutralEffects,
      nasalMix: 1,
    });
    const wideEars = render("doo", 420, {
      ...neutralEffects,
      earSpread: 1,
    });
    const leftHairFast = render("doo", 420, {
      ...neutralEffects,
      leftHairLength: 1,
      leftHairAngle: -1,
    });
    const leftHairSlow = render("doo", 420, {
      ...neutralEffects,
      leftHairLength: 1,
      leftHairAngle: 1,
    });
    const rightHair = render("doo", 420, {
      ...neutralEffects,
      rightHairLength: 1,
      rightHairAngle: 0.75,
    });
    assert.ok(
      normalizedDifference(dryFace.left, openFace.left) > 0.75,
      "ear and eye movement must materially reshape the full-sequence output",
    );
    assert.ok(
      normalizedDifference(openFace.left, openFace.right) > 0.7,
      "stretched ears must create a real stereo delay rather than a label-only control",
    );
    assert.ok(
      normalizedDifference(dryFace.left, divergentEyes.left) > 0.18,
      "eye divergence alone must open an unmistakable physical room",
    );
    assert.ok(
      normalizedDifference(dryFace.left, crossedEyes.left) > 0.18,
      "inward eyes must open an audible bright plate",
    );
    assert.ok(
      normalizedDifference(dryFace.left, openNose.left) > 0.35,
      "nose height alone must strongly reroute sound through the nasal tube",
    );
    assert.ok(openNose.processor.tract.nose.opening > 0.95);
    assert.ok(wideEars.processor.faceSpace.earAmount > 0.99);
    assert.ok(wideEars.processor.faceSpace.stereoWidth > 1.89);
    assert.ok(wideEars.processor.faceSpace.stereoWidth <= 1.9);
    assert.equal(wideEars.processor.faceSpace.stereoDelayMs, 0);
    assert.equal(wideEars.processor.faceSpace.hairAmount, 0);
    assert.equal(wideEars.processor.faceSpace.hairFeedback, 0);
    assert.equal(wideEars.processor.faceSpace.hairMix, 0);
    assert.ok(normalizedDifference(wideEars.left, wideEars.right) > 0.7);
    assert.ok(leftHairFast.processor.faceSpace.earAmount < 0.000001);
    assert.equal(leftHairFast.processor.faceSpace.stereoWidth, 1);
    assert.equal(leftHairFast.processor.faceSpace.stereoDelayMs, 0);
    assert.ok(leftHairFast.processor.faceSpace.leftHairLength > 0.99);
    assert.ok(leftHairFast.processor.faceSpace.rightHairLength < 0.000001);
    assert.ok(leftHairFast.processor.faceSpace.leftHairDelayMs >= 4.4);
    assert.ok(leftHairFast.processor.faceSpace.leftHairDelayMs <= 4.6);
    assert.ok(leftHairSlow.processor.faceSpace.leftHairDelayMs >= 36.4);
    assert.ok(leftHairSlow.processor.faceSpace.leftHairDelayMs <= 36.6);
    assert.equal(
      leftHairFast.processor.faceSpace.leftHairFeedback,
      leftHairSlow.processor.faceSpace.leftHairFeedback,
      "hair angle may retime a side without changing its length-controlled feedback",
    );
    assert.equal(
      leftHairFast.processor.faceSpace.leftHairMix,
      leftHairSlow.processor.faceSpace.leftHairMix,
    );
    assert.ok(leftHairFast.processor.faceSpace.leftHairFeedback > 0.72);
    assert.ok(leftHairFast.processor.faceSpace.leftHairMix > 0.76);
    assert.ok(rightHair.processor.faceSpace.leftHairLength < 0.000001);
    assert.ok(rightHair.processor.faceSpace.rightHairLength > 0.99);
    assert.ok(rightHair.processor.faceSpace.rightHairDelayMs > 32);
    assert.ok(normalizedDifference(dryFace.left, leftHairFast.left) > 0.3);
    assert.ok(normalizedDifference(leftHairFast.left, leftHairSlow.left) > 0.3);
    assert.ok(normalizedDifference(dryFace.right, rightHair.right) > 0.3);
    assert.ok(openFace.processor.faceSpace.eyeAmount > 0.9);
    assert.ok(divergentEyes.processor.faceSpace.eyeReverbAmount > 0.9);
    assert.ok(crossedEyes.processor.faceSpace.eyeAmount < -0.9);
    assert.ok(crossedEyes.processor.faceSpace.eyeReverbAmount > 0.9);

    for (const closure of [0, 0.02, 0.08, 0.12, 0.18, 0.24, 0.28, 0.5, 1]) {
      const openCentered = new Processor({
        processorOptions: { configuration: neutralEffects },
      }).faceSpace;
      const crossedClosed = new Processor({
        processorOptions: { configuration: neutralEffects },
      }).faceSpace;
      const referenceConfiguration = {
        ...neutralEffects,
        eyeDivergence: 0,
        eyeClosure: 0,
      };
      const visualOnlyConfiguration = {
        ...neutralEffects,
        eyeDivergence: -1,
        eyeClosure: closure,
      };
      let accumulatedDifference = 0;
      for (let sample = 0; sample < 8_192; sample += 1) {
        const inputLeft = Math.sin(sample * 0.071) * 0.31
          + Math.sin(sample * 0.013) * 0.07;
        const inputRight = -inputLeft * 0.73 + Math.sin(sample * 0.031) * 0.025;
        openCentered.process(inputLeft, inputRight, referenceConfiguration);
        crossedClosed.process(inputLeft, inputRight, visualOnlyConfiguration);
        accumulatedDifference += Math.abs(crossedClosed.left - openCentered.left)
          + Math.abs(crossedClosed.right - openCentered.right);
      }
      assert.ok(crossedClosed.eyeAmount < -0.99);
      assert.ok(crossedClosed.eyeReverbAmount > 0.9);
      assert.ok(accumulatedDifference > 1, `plate/room output must be audible at closure ${closure}`);
      assert.ok(Math.abs(crossedClosed.eyeClosureAmount - closure) < 0.001);
      assert.equal(crossedClosed.scalarsAreFinite(), true);
    }

    const flutterProbe = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    flutterProbe._handleMessage({ type: "strike", soundId: "pff", velocity: 1 });
    const flutterApertures = [];
    for (let block = 0; block < 120; block += 1) {
      flutterProbe.process([], [[new Float32Array(128), new Float32Array(128)]]);
      flutterApertures.push(flutterProbe.tract.lipValve.apertureCm);
    }
    let flutterOpenings = 0;
    let flutterClosures = 0;
    for (let index = 1; index < flutterApertures.length; index += 1) {
      if (flutterApertures[index - 1] <= 0.002 && flutterApertures[index] > 0.002) flutterOpenings += 1;
      if (flutterApertures[index - 1] > 0.002 && flutterApertures[index] <= 0.002) flutterClosures += 1;
    }
    assert.ok(Math.max(...flutterApertures) > 0.03, "PFRR pressure must physically part the lip mass");
    assert.ok(Math.max(...flutterApertures) < 0.08, "PFRR must retain its softened lip travel");
    assert.equal(flutterOpenings, 4, "PFRR needs four soft pressure-driven lip partings");
    assert.equal(flutterClosures, 4, "PFRR needs four matching pressure-driven lip contacts");

    const silentFlutter = new Processor({
      processorOptions: { configuration: { ...HICCUP_HEAD_DEFAULTS, lungPressure: 0 } },
    });
    silentFlutter._handleMessage({ type: "strike", soundId: "pff", velocity: 1 });
    let silentFlutterAperture = 0;
    for (let block = 0; block < 120; block += 1) {
      silentFlutter.process([], [[new Float32Array(128), new Float32Array(128)]]);
      silentFlutterAperture = Math.max(
        silentFlutterAperture,
        silentFlutter.tract.lipValve.apertureCm,
      );
    }
    assert.ok(silentFlutterAperture < 0.0011, "PFRR lips cannot self-flutter without pressure");

    const toothJetProbe = new Processor({
      processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
    });
    const toothPlan = physicalVoiceParameters("whistle", HICCUP_HEAD_DEFAULTS, 1);
    const unpressurizedToothFrame = {
      ...hiccupHeadGestureFrame("whistle", 0.5, HICCUP_HEAD_DEFAULTS, 1),
      pressureDrive: 0,
    };
    let unpressurizedToothFlow = 0;
    for (let substep = 0; substep < 2_048; substep += 1) {
      unpressurizedToothFlow = Math.max(
        unpressurizedToothFlow,
        Math.abs(toothJetProbe.tract.toothJet.advance(
          unpressurizedToothFrame,
          toothPlan,
          0,
          substep % 2 ? 1 : -1,
        )),
      );
    }
    assert.ok(
      unpressurizedToothFlow < 1e-12,
      "the tooth-edge source cannot whistle without a pressure drop",
    );

    const pressurizedToothFrame = { ...unpressurizedToothFrame, pressureDrive: 0.9 };
    let pressurizedToothFlow = 0;
    for (let substep = 0; substep < 4_096; substep += 1) {
      pressurizedToothFlow = Math.max(
        pressurizedToothFlow,
        Math.abs(toothJetProbe.tract.toothJet.advance(
          pressurizedToothFrame,
          toothPlan,
          0,
          substep % 3 ? 0.7 : -0.8,
        )),
      );
    }
    assert.ok(pressurizedToothFlow > 1e-6);
    assert.ok(toothJetProbe.tract.toothJet.jetSpeedMps > 5);
    assert.ok(toothJetProbe.tract.toothJet.frequencyHz > 500);

    const tightSlap = render("slap", 300, {
      ...HICCUP_HEAD_DEFAULTS,
      cheekVolume: -0.3,
      cheekTension: 1.6,
      tractLengthM: 0.08,
      earSpread: 0,
    });
    const cavernSlap = render("slap", 300, {
      ...HICCUP_HEAD_DEFAULTS,
      cheekVolume: 1.9,
      cheekTension: -0.25,
      tractLengthM: 0.42,
      earSpread: 0,
    });
    const tightSmack = render("smack", 300, {
      ...HICCUP_HEAD_DEFAULTS,
      cheekVolume: -0.3,
      cheekTension: 1.6,
      tractLengthM: 0.08,
      earSpread: 0,
    });
    const cavernSmack = render("smack", 300, {
      ...HICCUP_HEAD_DEFAULTS,
      cheekVolume: 1.9,
      cheekTension: -0.25,
      tractLengthM: 0.42,
      earSpread: 0,
    });
    assert.ok(
      normalizedDifference(tightSlap.left, cavernSlap.left) > 0.35,
      "left-hand hit configuration must materially retune the cheek and mouth resonator",
    );
    assert.ok(
      normalizedDifference(tightSmack.left, cavernSmack.left) > 0.25,
      "right-hand hit configuration must materially retune the cheek and mouth resonator",
    );
    for (const soundId of ["slap", "smack"]) {
      const handProbe = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
      handProbe._handleMessage({ type: "strike", soundId, velocity: 1 });
      let contacts = [];
      for (let block = 0; block < 50; block += 1) {
        handProbe.process([], [[new Float32Array(128), new Float32Array(128)]]);
        const activeContacts = handProbe.tract.transients.filter(({ active }) => active);
        if (activeContacts.length > contacts.length) contacts = activeContacts.map((contact) => ({
          index: contact.index,
          strength: contact.strength,
          delaySeconds: contact.delaySeconds,
        }));
      }
      assert.ok(contacts.length >= 3, `${soundId} must schedule palm, finger, and skin-fold contacts`);
      assert.ok(new Set(contacts.map(({ index }) => index)).size >= 3);
      assert.ok(new Set(contacts.map(({ strength }) => Math.sign(strength))).size >= 2);
      assert.ok(contacts.some(({ delaySeconds }) => delaySeconds > 0));
    }

    const contoured = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    contoured._handleMessage({
      type: "strike",
      soundId: "doo",
      velocity: 0.9,
      delaySeconds: 0.03,
      configuration: {
        nasalMix: 0.84,
        dooPitch: 12,
        earSpread: 0.92,
        leftHairLength: 0.73,
        rightHairLength: 0.41,
        leftHairAngle: -0.38,
        rightHairAngle: 0.64,
        eyeDivergence: 0.76,
        eyeClosure: 0.22,
      },
    });
    assert.equal(contoured.queue.length, 1);
    assert.equal(contoured.queue[0].configurationSnapshot.dooPitch, 12);
    for (let block = 0; block < 24; block += 1) {
      contoured.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.equal(contoured.lastSoundId, "doo");
    assert.equal(contoured.configuration.nasalMix, 0.84);
    assert.equal(contoured.configuration.dooPitch, 12);
    assert.equal(contoured.configuration.earSpread, 0.92);
    assert.equal(contoured.configuration.leftHairLength, 0.73);
    assert.equal(contoured.configuration.rightHairLength, 0.41);
    assert.equal(contoured.configuration.leftHairAngle, -0.38);
    assert.equal(contoured.configuration.rightHairAngle, 0.64);
    assert.equal(contoured.configuration.eyeDivergence, 0.76);
    assert.equal(contoured.configuration.eyeClosure, 0.22);

    const queuedVoice = {
      characterId: "monster",
      pitchOffsetSemitones: -13,
      vibratoRateHz: 3.1,
      vibratoDepthSemitones: 1.4,
      breathiness: 0.28,
      roughness: 0.8,
      subharmonicMix: 0.7,
      tractScale: 1.16,
      modulation: {
        source: "triangle",
        target: "roughness",
        depth: 0.72,
        rateHz: 4.4,
        phase: 0.2,
      },
    };
    const voicedEvent = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    voicedEvent._handleMessage({
      type: "strike",
      soundId: "wail",
      velocity: 0.9,
      delaySeconds: 0.03,
      voice: queuedVoice,
    });
    assert.equal(voicedEvent.queue.length, 1);
    assert.deepEqual(voicedEvent.queue[0].voiceSnapshot, sanitizeHiccupHeadVoice(queuedVoice));
    queuedVoice.characterId = "helium";
    queuedVoice.pitchOffsetSemitones = 24;
    queuedVoice.modulation.depth = 0;
    assert.equal(voicedEvent.queue[0].voiceSnapshot.characterId, "monster");
    assert.equal(voicedEvent.queue[0].voiceSnapshot.pitchOffsetSemitones, -13);
    assert.equal(voicedEvent.queue[0].voiceSnapshot.modulation.depth, 0.72);
    for (let block = 0; block < 28; block += 1) {
      voicedEvent.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.equal(voicedEvent.lastSoundId, "wail");
    assert.equal(voicedEvent.gesture?.voiceSnapshot?.characterId, "monster");
    assert.equal(voicedEvent.gesture?.plan?.voiceCharacterId, "monster");
    assert.ok(
      voicedEvent.messages.some((message) => (
        message.type === "telemetry" && message.voiceCharacterId === "monster"
      )),
      "the chosen event character must remain visible while the one tract sounds",
    );

    const fresh = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    const freshLeft = new Float32Array(128);
    const freshRight = new Float32Array(128);
    fresh.process([], [[freshLeft, freshRight]]);
    assert.ok(freshLeft.every((sample) => sample === 0));
    assert.ok(freshRight.every((sample) => sample === 0));

    fresh._handleMessage({ type: "strike", soundId: "shh", velocity: 1 });
    let soundingSamples = 0;
    for (let block = 0; block < 64; block += 1) {
      const soundingLeft = new Float32Array(128);
      fresh.process([], [[soundingLeft, new Float32Array(128)]]);
      soundingSamples += soundingLeft.filter((sample) => Math.abs(sample) > 1e-6).length;
    }
    assert.ok(
      soundingSamples > 128,
      "PHSHSHK may begin behind a physical seal but must sound after pressure release",
    );
    fresh._handleMessage({ type: "silence" });
    const silentLeft = new Float32Array(128);
    const silentRight = new Float32Array(128);
    fresh.process([], [[silentLeft, silentRight]]);
    assert.ok(silentLeft.every((sample) => sample === 0));
    assert.ok(silentRight.every((sample) => sample === 0));

    const queued = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    queued._handleMessage({ type: "strike", soundId: "slap", velocity: 1, delaySeconds: 0.1 });
    queued._handleMessage({ type: "panic" });
    for (let block = 0; block < 50; block += 1) {
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      queued.process([], [[left, right]]);
      assert.ok(left.every((sample) => sample === 0));
      assert.ok(right.every((sample) => sample === 0));
    }

    const simultaneous = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    simultaneous._handleMessage({ type: "strike", soundId: "bop", velocity: 0.62 });
    simultaneous._handleMessage({ type: "strike", soundId: "slap", velocity: 0.94 });
    simultaneous.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(simultaneous.lastSoundId, "slap", "the strongest same-frame gesture owns the mouth");
    assert.equal(simultaneous.gesture?.soundId ?? simultaneous.gesture?.sound?.id, "slap");

    const tie = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    tie._handleMessage({ type: "strike", soundId: "tlik", velocity: 0.8 });
    tie._handleMessage({ type: "strike", soundId: "boop", velocity: 0.8 });
    tie.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(tie.lastSoundId, "tlik", "the earliest same-frame gesture wins a velocity tie");

    const retriggered = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    retriggered._handleMessage({ type: "strike", soundId: "shh", velocity: 0.9 });
    for (let block = 0; block < 12; block += 1) {
      retriggered.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.equal(retriggered.gesture?.soundId ?? retriggered.gesture?.sound?.id, "shh");
    const continuousTract = retriggered.tract;
    const oldGesture = retriggered.gesture;
    retriggered._handleMessage({ type: "strike", soundId: "bop", velocity: 0.9 });
    retriggered.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.equal(retriggered.gesture?.soundId ?? retriggered.gesture?.sound?.id, "bop");
    assert.notEqual(retriggered.gesture, oldGesture, "a new articulatory trajectory replaces the old one");
    assert.equal(
      retriggered.tract,
      continuousTract,
      "retriggering must retarget the same air column instead of constructing a second mouth",
    );
    assert.equal("voices" in retriggered, false);
    assert.equal("voice" in retriggered, false);
    assert.equal("voicePool" in retriggered, false);

    const preparationProbe = new Processor({
      processorOptions: { configuration: HICCUP_HEAD_DEFAULTS },
    });
    const preparationSeconds = SOUND_IDS.map((soundId) => {
      const event = preparationProbe._eventForMessage({ soundId, velocity: 0.9 });
      return (event.releaseFrame - event.startFrame) / 48_000;
    });
    assert.ok(Math.min(...preparationSeconds) >= 0.005);
    assert.ok(Math.max(...preparationSeconds) <= 0.025);
    assert.ok(
      new Set(preparationSeconds.map((seconds) => seconds.toFixed(4))).size >= 6,
      "live gestures need sound-specific anatomical preparation rather than one generic attack",
    );

    const click = new Processor({ processorOptions: { configuration: HICCUP_HEAD_DEFAULTS } });
    click._handleMessage({ type: "strike", soundId: "tlik", velocity: 0.9 });
    const sealedContacts = new Set();
    const negativeReleaseIndices = new Set();
    let minimumVacuum = 0;
    let firstAnteriorReleaseFrame = Number.POSITIVE_INFINITY;
    let firstRearReleaseFrame = Number.POSITIVE_INFINITY;
    for (let block = 0; block < 100; block += 1) {
      click.process([], [[new Float32Array(128), new Float32Array(128)]]);
      for (const seal of click.tract.seals) {
        if (seal.sealed) sealedContacts.add(seal.name);
        minimumVacuum = Math.min(minimumVacuum, seal.vacuumPressure ?? 0);
      }
      for (const transient of click.tract.transients) {
        if (!transient.active || transient.strength >= 0) continue;
        negativeReleaseIndices.add(transient.index);
        if (transient.index > click.tract.cheekJunction) {
          firstAnteriorReleaseFrame = Math.min(firstAnteriorReleaseFrame, block * 128);
        } else {
          firstRearReleaseFrame = Math.min(firstRearReleaseFrame, block * 128);
        }
      }
    }
    assert.ok(sealedContacts.has("primary"), "TLIK must form its anterior seal");
    assert.ok(sealedContacts.has("secondary"), "TLIK must form its rear seal");
    assert.ok(sealedContacts.has("tongueTip"), "TLIK must form curled-tip contact");
    assert.ok(minimumVacuum < -0.001, "TLIK must expand a negative-pressure oral pocket");
    assert.ok(negativeReleaseIndices.size >= 2, "TLIK must produce distinct signed releases");
    assert.ok(
      firstAnteriorReleaseFrame < firstRearReleaseFrame,
      "TLIK anterior contact must release before the rear tongue seal",
    );

    const noFlowConfiguration = { ...HICCUP_HEAD_DEFAULTS, lungPressure: 0 };
    const noFlow = new Processor({
      processorOptions: { configuration: noFlowConfiguration },
    });
    const turbulenceWithoutFlow = {
      ...hiccupHeadGestureFrame("shh", 0.4, noFlowConfiguration, 1),
      cheekImpulse: 0,
      jawImpulse: 0,
      suction: 0,
    };
    noFlow.tract.setArticulation(
      noFlowConfiguration,
      turbulenceWithoutFlow,
      physicalVoiceParameters("shh", noFlowConfiguration, 1),
      true,
    );
    for (let substep = 0; substep < 256; substep += 1) {
      assert.equal(
        noFlow.tract.processSubstep(0, substep % 2 ? 1 : -1),
        0,
        "a turbulence curve without pressure or flow must not synthesize free hiss",
      );
    }
    for (const pneumaticSoundId of ["bop", "boop", "pff"]) {
      const zeroAir = new Processor({
        processorOptions: { configuration: noFlowConfiguration },
      });
      zeroAir._handleMessage({ type: "strike", soundId: pneumaticSoundId, velocity: 1 });
      let zeroAirPeak = 0;
      for (let block = 0; block < 120; block += 1) {
        const channel = new Float32Array(128);
        zeroAir.process([], [[channel, new Float32Array(128)]]);
        for (const sample of channel) zeroAirPeak = Math.max(zeroAirPeak, Math.abs(sample));
      }
      assert.ok(
        zeroAirPeak < 1e-8,
        `${pneumaticSoundId} must not self-excite when lung pressure is zero`,
      );
    }

    const nasalOpenings = [0.39, 0.4].map((nasalMix) => {
      const configuration = { ...HICCUP_HEAD_DEFAULTS, nasalMix };
      const processor = new Processor({ processorOptions: { configuration } });
      const frame = hiccupHeadGestureFrame("bop", 0.25, configuration, 0.86);
      processor.tract.setArticulation(
        configuration,
        frame,
        physicalVoiceParameters("bop", configuration, 0.86),
        true,
      );
      return processor.tract.nose.targetOpening;
    });
    assert.ok(
      Math.abs(nasalOpenings[1] - nasalOpenings[0]) < 0.05,
      "nasal mutation must cross the human/alien region continuously",
    );

    const shortMouth = new Processor({
      processorOptions: {
        configuration: {
          ...HICCUP_HEAD_DEFAULTS,
          tractLengthM: HICCUP_HEAD_LIMITS.tractLengthM[0],
        },
      },
    });
    const longMouth = new Processor({
      processorOptions: {
        configuration: {
          ...HICCUP_HEAD_DEFAULTS,
          tractLengthM: HICCUP_HEAD_LIMITS.tractLengthM[1],
        },
      },
    });
    assert.ok(Number.isInteger(shortMouth.tract?.sectionCount));
    assert.ok(Number.isInteger(longMouth.tract?.sectionCount));
    assert.ok(shortMouth.tract.sectionCount >= 8);
    assert.ok(
      longMouth.tract.sectionCount > shortMouth.tract.sectionCount * 2.5,
      "physical tract length must materially change propagation delay, not just remap a formant EQ",
    );

    globalThis.sampleRate = 96_000;
    const highRateLongMouth = new Processor({
      processorOptions: {
        configuration: {
          ...HICCUP_HEAD_DEFAULTS,
          tractLengthM: HICCUP_HEAD_LIMITS.tractLengthM[1],
        },
      },
    });
    assert.ok(
      highRateLongMouth.tract.sectionCount > 280,
      "the longest oral tract must retain its propagation length at 96 kHz",
    );
    globalThis.sampleRate = 48_000;
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test.skip("Hiccup Head page, app, accessibility, catalogue, MIDI registry, and build wiring stay integrated", async () => {
  const [html, css, app, model, processor, readme, buildScript] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("scripts/build-site.sh", root), "utf8"),
  ]);

  assert.match(html, /<title>Hiccup Head · Morphazoid<\/title>/);
  assert.match(html, /face-percussion and beatbox physical model/i);
  assert.match(html, /<h1>HICCUP HEAD<\/h1>/);
  assert.doesNotMatch(html, /crazed clown beatbox/i);
  assert.doesNotMatch(html, /one face\s*(?:×|x)\s*one mouth/i);
  assert.match(html, /href="hiccup-head\.css\?v=hiccup-head-20260902-4"/);
  assert.match(html, /src="hiccup-head-app\.js\?v=hiccup-head-20260902-4"/);
  assert.match(html, /centered open eyes are dry[\s\S]*?bright plate[\s\S]*?dark cathedral/i);
  assert.match(
    html,
    /effect switches and their live face-controlled amounts are independent of face presets, mutation, and reset/i,
  );
  assert.doesNotMatch(html, /robot|tempo gate/i);
  assert.ok(
    html.indexOf("hiccup-head-stage") < html.indexOf("hiccup-head-sequencer"),
    "the selectable sequencer must follow the face visual",
  );
  assert.match(html, /id="stage"[\s\S]*?tabindex="0"[\s\S]*?aria-label=/);
  assert.match(html, /aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="sequenceGrid"[\s\S]*?role="grid"/);
  assert.match(html, /aria-rowcount="1"/);
  assert.match(html, /aria-colcount="16"/);
  assert.match(html, /Each step has one velocity trigger and a sound selector/i);
  assert.match(html, /beyond human ranges|beyond-human/i);
  assert.match(html, /id="padGrid"[\s\S]*?Fifty-two playable Hiccup Head sound pads/i);
  assert.match(html, /missing one upper front tooth/i);
  assert.match(html, /missing-front-tooth gap/i);
  assert.match(html, /FWEE[\s\S]*upper incisor (?:is )?missing/i);
  assert.match(html, /id="sequenceLength"[^>]*min="1"[^>]*max="64"[^>]*value="16"/);
  assert.doesNotMatch(html, /id="sequenceLengthNumber"/);
  assert.match(html, /id="sequenceLengthEntry"[^>]*type="number"[^>]*min="1"[^>]*max="64"[^>]*value="16"/);
  for (const length of [4, 8, 16, 24, 32, 64]) {
    assert.match(html, new RegExp(`data-sequence-length="${length}"`));
  }
  assert.doesNotMatch(html, /id="effectContourGrid"|hiccup-head-effect-contour/i);
  assert.doesNotMatch(html, /per-step face contours|draw their .* contours/i);
  assert.doesNotMatch(html, /preset loads its own face effects|Drag eyes, nose, ears|drag either hand to slap/i);
  assert.match(html, /id="voiceCount"[^>]*min="1"[^>]*max="8"[^>]*value="4"/);
  assert.match(html, /id="voiceSelectionMode"[\s\S]*?value="roundRobin"[\s\S]*?value="random"/);
  assert.match(html, /id="mutateVoicesButton"/);
  assert.match(html, /id="voiceRack"[^>]*role="list"/);
  assert.doesNotMatch(html, />SHHH</);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="playButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="audioError"[^>]*role="alert"/);
  assert.match(html, /id="liveStatus"[^>]*aria-live="polite"/);
  assert.match(html, /class="sr-only" id="canvasInstructions"/);
  for (const controlId of Object.keys(HICCUP_HEAD_LIMITS)) {
    assert.match(html, new RegExp(`for="${controlId}"`), `${controlId} needs a visible label`);
  }
  assert.match(html, /id="tempo"[^>]*max="520"/);
  for (const controlId of [
    "dooPitch", "earSpread", "leftHairLength", "rightHairLength",
    "leftHairAngle", "rightHairAngle", "eyeDivergence", "eyeClosure",
  ]) {
    assert.match(html, new RegExp(`id="${controlId}"`));
  }

  assert.match(css, /\.hiccup-head-workspace\s*\{[\s\S]*?grid-template-rows:/);
  assert.match(css, /\.hiccup-head-sequence-grid\s*\{[\s\S]*?repeat\(var\(--hiccup-head-sequence-steps, 32\),/);
  assert.match(css, /\.hiccup-head-sequence-grid\s*\{[\s\S]*?grid-template-rows:\s*24px minmax\(74px, auto\)/);
  assert.doesNotMatch(css, /repeat\(var\(--hiccup-head-sequence-sounds/);
  assert.match(css, /\.hiccup-head-step-slot\s*\{[\s\S]*?grid-template-rows:\s*40px 27px/);
  assert.match(css, /\.hiccup-head-step-sound-select\s*\{/);
  assert.doesNotMatch(css, /\.hiccup-head-effect-contour-grid/);
  assert.match(css, /\.hiccup-head-grid-scroll\s*\{[\s\S]*?overflow:/);
  assert.match(css, /\.hiccup-head-step-cell:focus-visible/);
  assert.match(css, /\.hiccup-head-voice-rack\s*\{[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.hiccup-head-voice-card/);
  assert.match(css, /\.hiccup-head-voice-solo\[aria-pressed="true"\]/);
  assert.match(css, /\.hiccup-head-voice-mod-(?:source|target)/);
  assert.match(css, /\.hiccup-head-voice-mod-(?:depth|rate)/);
  assert.match(css, /@media \(max-width:\s*680px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);

  assert.match(app, /from "\.\/src\/hiccup-head\.js\?v=hiccup-head-model-20260902-4"/);
  assert.match(app, /\.\/src\/hiccup-head-processor\.js\?v=hiccup-head-tract-20260902-4/);
  assert.match(processor, /from "\.\/hiccup-head\.js\?v=hiccup-head-model-20260902-4"/);
  assert.match(app, /"hiccup-head-physical-model"/);
  assert.match(app, /connectAudioOutput\(context, analyser/);
  assert.match(app, /function buildPadGrid\(\)/);
  assert.match(app, /HICCUP_HEAD_SOUNDS\.map\(\(sound, index\) =>/);
  assert.match(app, /button\.dataset\.padIndex = String\(index\)/);
  assert.match(app, /function buildSequenceGrid\(\)/);
  assert.match(app, /grid\.setAttribute\("aria-rowcount", "1"\)/);
  assert.match(app, /slot\.className = "hiccup-head-step-slot"/);
  assert.match(app, /selector\.className = "hiccup-head-step-sound-select"/);
  assert.match(app, /slot\.append\(cell, selector\)/);
  assert.match(app, /emptyOption\.value = ""[\s\S]*?emptyOption\.textContent = "—"/);
  assert.match(app, /const nextVelocity = currentEvent\?\.velocity \?\? 0\.72/);
  assert.match(app, /function setSequenceLength\(value,/);
  assert.doesNotMatch(app, /\[16, 32, 48, 64\]/);
  assert.match(app, /sequenceLength\s*=\s*clamp\([\s\S]{0,160}1,\s*HICCUP_HEAD_STEP_COUNT,?\s*\)/);
  assert.match(app, /document\.querySelectorAll\("\[data-sequence-length\]"\)/);
  assert.match(app, /--hiccup-head-sequence-steps/);
  assert.match(app, /for \(let step = 0; step < sequenceLength; step \+= 1\)/);
  assert.match(app, /sequenceStepIntervalSeconds\(state\.tempo, state\.swing, absoluteStep\)/);
  assert.doesNotMatch(app, /function buildEffectContourGrid\(|const EFFECT_LANES|effectContourGrid/);
  assert.match(
    app,
    /function initialize\(\)[\s\S]*?buildPadGrid\(\)[\s\S]*?buildVoiceRack\([\s\S]*?setSequenceLength\(/,
  );
  assert.match(app, /function buildVoiceRack\(/);
  assert.match(app, /HICCUP_HEAD_VOICE_CHARACTERS\.map/);
  assert.match(app, /className = "hiccup-head-voice-card"/);
  assert.match(app, /className = "hiccup-head-voice-solo"/);
  assert.match(app, /className = "hiccup-head-voice-mutate"/);
  assert.match(app, /className = "hiccup-head-voice-assignment"/);
  assert.match(app, /HICCUP_HEAD_VOICE_MODULATION_SOURCES\.map/);
  assert.match(app, /HICCUP_HEAD_VOICE_MODULATION_TARGETS\.map/);
  assert.match(app, /className = "hiccup-head-voice-mod-depth"/);
  assert.match(app, /className = "hiccup-head-voice-mod-rate"/);
  assert.match(app, /availableVoiceSlots/);
  assert.match(app, /\.filter\(\(slot\) => slot\.solo\)/);
  assert.match(app, /voiceSelectionMode === "random"/);
  assert.match(app, /voice:\s*voiceChoice\.voice/);
  assert.match(app, /setAttribute\("role", "gridcell"\)/);
  assert.match(app, /setAttribute\("aria-pressed", String\(level > 0\)\)/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /ArrowUp/);
  assert.match(app, /ArrowDown/);
  assert.match(app, /const pressedKey = String\(event\.key\)\.toLowerCase\(\)/);
  assert.match(app, /HICCUP_HEAD_SOUNDS\.find\(\(\{ key \}\) => String\(key\)\.toLowerCase\(\) === pressedKey\)/);
  assert.match(app, /let toothGapGeometry = null/);
  assert.match(app, /const toothCount = TOOTH_TINE_PROFILES\.length \+ 1/);
  assert.match(app, /const missingFrontIncisor = Math\.floor\(toothCount \/ 2\)/);
  assert.match(app, /if \(tooth === missingFrontIncisor\) continue/);
  assert.match(
    app,
    /\{ soundId: "whistle", slot: \d+, zone: "tooth-gap", label: "FWEE" \}/,
    "FWEE needs a visible primary circle in the complete face-trigger layout",
  );
  assert.match(
    app,
    /function toothWhistleGapAtPoint\(point\) \{[\s\S]{0,520}?gap\.x - gap\.width \* 0\.5[\s\S]{0,220}?gap\.y \+ gap\.height \+ verticalPadding/,
    "the actual missing incisor must remain an anatomical FWEE hit area",
  );
  assert.match(
    app,
    /if \(toothWhistleGapAtPoint\(point\)\) \{\s*triggerSound\("whistle",[\s\S]{0,130}?return;\s*\}/,
  );
  assert.match(app, /const nearestHotspot = nearestHotspotAtPoint\(point, "hitR"\)/);
  assert.match(app, /function drawToothWhistleJet\(/);
  assert.match(app, /type: "strike"/);
  assert.match(app, /type: "silence"/);
  assert.match(app, /function clearStepExcept\(step, soundId\)/);
  assert.match(app, /if \(next > 0\) clearStepExcept\(step, sound\.id\)/);
  assert.doesNotMatch(app, /soundAnimations/);
  assert.match(app, /function morphDisplayedPose\(target, now, isSpeaking\)/);
  assert.match(app, /type\s*(?:===|!==)\s*"telemetry"/);
  assert.match(app, /function drawHands\(context, motion\)/);
  assert.match(app, /const travel = 1 - \(1 - clamp\(active\)\) \*\* 2/);
  assert.match(app, /const palmX = hand\.x \+ \(hand\.targetX - hand\.x\) \* travel/);
  assert.match(app, /const palmY = hand\.y \+ \(hand\.targetY - hand\.y\) \* travel/);
  assert.match(app, /if \(travel > 0\.54\)[\s\S]*?const impact/);
  assert.match(app, /soundId: "slap"[\s\S]*soundId: "smack"/);
  assert.match(app, /pointerDrag\?\.type === "hand"/);
  assert.match(app, /pointerDrag = \{[\s\S]*?type: "hand"[\s\S]*?soundId: hand\.soundId/);
  assert.match(app, /triggerSound\(drag\.soundId, velocity, handStrikeConfiguration\(drag\.handId\)\)/);
  for (const feature of ["nose", "ear", "eye", "brow", "tongue"]) {
    assert.match(app, new RegExp(`feature: "${feature}"`));
  }
  for (const field of [
    "activeGesture",
    "gestureProgress",
    "gestureAmount",
    "tractPressure",
    "constrictionIndex",
    "constrictionDiameterCm",
    "velumOpening",
    "lipDiameterCm",
    "cheekDisplacement",
    "dooPitch",
    "tongueOut",
    "earSpread",
    "leftHairLength",
    "rightHairLength",
    "leftHairAngle",
    "rightHairAngle",
    "eyeDivergence",
    "eyeClosure",
  ]) {
    assert.match(app, new RegExp(`\\b${field}\\b`), `the face must consume ${field} telemetry`);
    assert.match(processor, new RegExp(`\\b${field}\\b`), `the tract must report ${field} telemetry`);
  }
  assert.match(processor, /\beyeReverbAmount\b/);
  assert.doesNotMatch(
    processor,
    /eyeGate|eyeRobot|eyeCrush|gateDuty|gateEnvelope|\b_crush\s*\(/,
    "crossed eyes and lid closure must not retain hidden audio processors",
  );
  assert.match(
    processor,
    /const eyeDistance = Math\.max\(Math\.abs\(this\.eyeAmount\), this\.eyeClosureAmount \* 0\.72\)[\s\S]*?const eyeCharacter = clamp\(\(this\.eyeAmount \+ 1\) \* 0\.5\)[\s\S]*?this\.left = roomLeft;[\s\S]*?this\.right = roomRight;/,
    "eye distance and direction must choose audible plate, room, and cathedral reverb",
  );
  assert.match(processor, /\boralSectionCount\b/);
  assert.match(processor, /\bstereoDelayMs\b/);
  assert.match(processor, /\bvoiceSnapshot\b/);
  for (const field of [
    "voiceCharacterId",
    "glottalFrequencyHz",
    "vibratoRateHz",
    "vibratoDepthSemitones",
    "roughness",
    "subharmonicMix",
    "throatRattleApertureCm",
  ]) {
    assert.match(processor, new RegExp(`\\b${field}\\b`));
  }
  assert.match(model, /one physical mouth/i);
  assert.match(model, /const exclusivePatternRows/);
  assert.match(processor, /this\.tract\s*=/);
  assert.match(processor, /this\.gesture\s*=/);
  assert.match(processor, /hiccupHeadGestureFrame(?:AtSample)?/);
  assert.match(processor, /hiccupHeadTargetOralDiameters/);
  assert.doesNotMatch(processor, /this\.voices\s*=/);
  assert.doesNotMatch(processor, /voicePool|voiceSlots/i);
  assert.match(processor, /activeVoices:/);
  assert.match(processor, /\bright\b/i);
  assert.match(processor, /\bleft\b/i);
  assert.match(processor, /reflection/i);
  assert.match(processor, /scatter/i);
  assert.match(processor, /nasal/i);
  assert.match(processor, /pressure/i);
  assert.match(processor, /turbulen/i);
  assert.match(processor, /lip(?:Valve|Aperture|Diameter|Closure)/i);
  assert.match(processor, /class FaceSpace/);
  assert.match(processor, /class PressureDrivenTongueValve/);
  assert.match(model, /export const HICCUP_HEAD_TOOTH_GAP_ANATOMY/);
  assert.match(model, /missingTooth:\s*"upper-left central incisor"/);
  assert.match(model, /toothJet:\s*\[\[0, 0\]/);
  assert.match(processor, /class PressureDrivenToothGapJet/);
  assert.match(processor, /Math\.sqrt\([\s\S]{0,100}?Math\.max\(0, pressurePa\)/);
  assert.match(processor, /_injectToothWhistle\(noise\)/);
  assert.match(processor, /this\.toothJet\.advance\(/);
  assert.match(
    processor,
    /this\.right\[[^\n]+\] \+= toothFlow \* 0\.72;[\s\S]{0,140}?this\.left\[[^\n]+\] \+= toothFlow \* 0\.28;/,
  );
  for (const field of [
    "missingTooth",
    "toothJetFlow",
    "toothJetSpeedMps",
    "toothWhistleFrequencyHz",
    "toothWhistleStrouhalNumber",
    "toothJetImpingementLengthM",
  ]) {
    assert.match(processor, new RegExp(`\\b${field}\\b`));
  }
  assert.match(processor, /class ToothTineResonator/);
  assert.match(processor, /const TOOTH_WOOD_MODE_COUNT = 2/);
  const woodOffsets = processor.match(
    /const TOOTH_WOOD_FREQUENCY_OFFSETS_HZ = Object\.freeze\(\[([\s\S]*?)\]\)/,
  )?.[1].match(/-?\d+(?:\.\d+)?/g).map(Number) ?? [];
  const woodDecayScales = processor.match(
    /const TOOTH_WOOD_DECAY_SCALES = Object\.freeze\(\[([\s\S]*?)\]\)/,
  )?.[1].match(/\d+(?:\.\d+)?/g).map(Number) ?? [];
  assert.equal(woodOffsets.length, 12);
  assert.equal(woodDecayScales.length, 12);
  assert.ok(new Set(woodOffsets).size >= 10, "each tooth needs crooked dry-wood stiffness");
  assert.ok(
    woodDecayScales.every((scale) => scale >= 0.75 && scale <= 1.15),
    "wood decay variation must remain short and bounded",
  );
  const toothWoodSource = processor.slice(
    processor.indexOf("class ToothTineResonator"),
    processor.indexOf("class OrganicMouthTract"),
  );
  assert.match(toothWoodSource, /for \(let mode = 0; mode < TOOTH_WOOD_MODE_COUNT; mode \+= 1\)/);
  assert.match(toothWoodSource, /const modeRatio = mode === 0 \? 1 : 1\.43 \+ toothCrookedness/);
  assert.match(
    toothWoodSource,
    /const baseDecaySeconds = \([\s\S]*?0\.044[\s\S]*?0\.022[\s\S]*?0\.012[\s\S]*?\) \* TOOTH_WOOD_DECAY_SCALES/,
    "the fundamental wood bend must die within roughly a tenth of a second",
  );
  assert.match(toothWoodSource, /const decaySeconds = baseDecaySeconds \* \(mode === 0 \? 1 : 0\.48\)/);
  assert.match(toothWoodSource, /const contactDecaySeconds = 0\.0075[\s\S]*?0\.0045[\s\S]*?0\.0025/);
  assert.match(toothWoodSource, /const contactCutoffHz = 620 \+ this\.brightness \* 760/);
  assert.doesNotMatch(processor, /TOOTH_TINE_MODE_RATIOS/);
  assert.match(processor, /plan\?\.toothTine/);
  assert.match(processor, /_injectToothTine\(noise\)/);
  assert.match(
    processor,
    /this\.right\[[^\n]+\] \+= tineFlow \* 0\.66;[\s\S]{0,140}?this\.left\[[^\n]+\] \+= tineFlow \* 0\.34;/,
  );
  for (const field of [
    "toothTineActive",
    "toothTineFlow",
          "toothTineFrequencyHz",
          "toothKnockFrequencyHz",
    "toothTinePosition",
    "toothTineBrightness",
    "toothTineIndex",
  ]) {
    assert.match(processor, new RegExp(`\\b${field}\\b`));
  }
  assert.match(processor, /radiatedCollisionFlow/);
  assert.match(processor, /collisionRadiationAlpha/);
  assert.match(
    processor,
    /const GESTURE_SOURCE_GAIN = Object\.freeze\(\{[\s\S]*?bop: 3,[\s\S]*?grunt: 1\.38,[\s\S]*?rrrr: 1\.24,[\s\S]*?lrroll: 1\.28,[\s\S]*?lalatrip: 1\.22,[\s\S]*?hiccuplong: 2\.5,[\s\S]*?zzzz: 1\.2,[\s\S]*?ehyeah: 1\.04,[\s\S]*?\}\)/,
  );
  assert.match(
    processor,
    /const GESTURE_OUTPUT_GAIN = Object\.freeze\(\{[\s\S]*?bop: 1\.15,[\s\S]*?pop: 2\.8,[\s\S]*?hiccup: 3,[\s\S]*?kiss: 2\.7,[\s\S]*?brush: 0\.72,[\s\S]*?klikklak: 1\.55,[\s\S]*?rrrr: 0\.92,[\s\S]*?lrroll: 0\.72,[\s\S]*?lalatrip: 0\.9,[\s\S]*?hiccuplong: 1\.35,[\s\S]*?zzzz: 1\.35,[\s\S]*?ehyeah: 0\.9,[\s\S]*?rattle: 0\.35,[\s\S]*?\}\)/,
  );
  assert.match(processor, /GESTURE_SOURCE_GAIN\[this\.sound\.id\] \?\? 1/);
  assert.match(processor, /GESTURE_OUTPUT_GAIN\[this\.gesture\?\.sound\.id\] \?\? 1/);
  assert.match(
    processor,
    /const VOCAL_FREQUENCY_FLOOR_HZ = Object\.freeze\(\{[\s\S]*?hee: 55,[\s\S]*?haw: 48,[\s\S]*?doo: 48,[\s\S]*?wail: 55,[\s\S]*?holler: 52,[\s\S]*?moan: 48,[\s\S]*?\}\)/,
    "open/modal voices need a restrained radiation floor across character mutations",
  );
  assert.doesNotMatch(
    processor,
    /VOCAL_FREQUENCY_FLOOR_HZ[\s\S]{0,420}?lala:/,
    "LA-LA must retain the odd low character of mutated voices instead of inheriting an open-vocal floor",
  );
  assert.match(processor, /pffTurbulenceMemory/);
  assert.match(processor, /lipSourceMemory/);
  assert.match(processor, /_scheduleHandContactIfNeeded\(frame, plan\)/);
  assert.match(processor, /Palm, fingers, and reflected skin fold/i);
  for (const field of ["handImpactBrightness", "handContactSpacingMs", "handTail"]) {
    assert.match(model, new RegExp(`\\b${field}\\b`));
    assert.match(processor, new RegExp(`\\b${field}\\b`));
  }
  assert.match(processor, /airflowDirection/);
  assert.match(processor, /configurationSnapshot/);
  assert.match(processor, /sanitizeHiccupHeadVoice/);
  assert.doesNotMatch(processor, /StateVariableBandpass/);
  assert.doesNotMatch(processor, /formantFrequenciesHz|formantBandwidthsHz|formantFilters/);

  const voiceTools = TOOL_GROUPS.find(({ id }) => id === "voice-synths")?.tools ?? [];
  assert.deepEqual(
    voiceTools.find(({ id }) => id === "hiccup-head"),
    { id: "hiccup-head", label: "Hiccup Head", href: "hiccup-head.html" },
  );
  const catalogEntry = instrumentById("hiccup-head");
  assert.equal(catalogEntry?.href, "hiccup-head.html");
  assert.equal(catalogEntry?.kind, "Monophonic physical beatbox sequencer");
  assert.equal(catalogEntry?.imageHref, "assets/instruments/hiccup-head.webp");
  assert.match(
    catalogEntry?.description ?? "",
    /40%-opaque,? step-shifting checkerboard polka-dot goofball face/i,
  );
  assert.match(catalogEntry?.description ?? "", /fifty-two exclusive gestures/i);
  assert.match(catalogEntry?.description ?? "", /missing-incisor FWEE/i);
  assert.match(catalogEntry?.description ?? "", /twelve pitched dead-wood teeth/i);
  assert.match(catalogEntry?.description ?? "", /open-throat and rough voices/i);
  assert.match(catalogEntry?.start ?? "", /one gesture per column/i);
  assert.match(
    catalogEntry?.start ?? "",
    /(?:any length from 1 through 64|1[–-]64) steps/i,
  );
  assert.match(catalogEntry?.start ?? "", /520 BPM/i);
  assert.match(catalogEntry?.start ?? "", /one to eight sequential voice characters/i);
  assert.match(catalogEntry?.start ?? "", /matched circular eyes move inward for bright plate reverb, outward for a dark cathedral/i);
  assert.match(catalogEntry?.start ?? "", /Persistent Delay, Reverb, Nasal, and Stereo switches and live amounts stay put/i);
  assert.doesNotMatch(catalogEntry?.start ?? "", /robot|bitcrush|tempo gate/i);
  assert.ok(catalogEntry?.features.includes("Pointer"));
  assert.ok(catalogEntry?.features.includes("Computer keys"));
  assert.deepEqual(catalogEntry?.tags.map(({ id }) => id), ["voice-synths", "sequencers"]);

  const midi = instrumentMidiCapabilityForId("hiccup-head");
  assert.equal(midi?.noteMode, "drums");
  assert.equal(midi?.computerKeyboardMode, "page");
  assert.equal(midi?.midiInput, true);
  assert.equal(midi?.midiOutput, true);

  for (const path of [
    "hiccup-head.html",
    "hiccup-head.css",
    "hiccup-head-app.js",
    "src/hiccup-head.js",
    "src/hiccup-head-processor.js",
    "assets/instruments/hiccup-head.webp",
  ]) {
    assert.match(
      buildScript,
      new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${path} must be copied and required by the site build`,
    );
  }
  assert.match(readme, /\*\*Hiccup Head\*\*/);
  assert.match(readme, /thirty-(?:seven|nine) playable gestures/i);
  assert.match(readme, /FWEE[\s\S]*missing upper-left central incisor/i);
  assert.match(
    readme,
    /freely adjustable (?:from )?(?:1 through 64 steps|1[–-]64-step length)/i,
  );
  assert.doesNotMatch(readme, /per-step face contours/i);
  assert.match(readme, /one to eight editable voice characters/i);
  assert.match(readme, /(?:same monophonic folds and tract|remaining a single mouth)/i);
  assert.match(readme, /520 BPM/i);
  assert.match(readme, /(?:visible hand|palm models?)/i);
  assert.match(
    readme,
    /Only outward eye motion changes audio by opening the room; crossed eyes and eyelid closure are visual only/i,
  );
  assert.match(readme, /live face-controlled amounts also stay put when presets, mutation, or reset/i);
  const hiccupReadmeStart = readme.indexOf("**Hiccup Head**");
  const hiccupReadmeEnd = readme.indexOf("\n\n", hiccupReadmeStart);
  const hiccupReadme = readme.slice(hiccupReadmeStart, hiccupReadmeEnd);
  assert.doesNotMatch(hiccupReadme, /robot|bitcrush|tempo gate/i);
  for (const label of [
    "PFRR", "FWEE", "HNNGH", "MMOAN", "LA-LA", "PB-PB", "SLRRP",
    "HIC!", "EEF!", "KSH", "SNAP", "TOM", "BRRAP",
  ]) {
    assert.match(readme, new RegExp(label.replace("!", "\\!"), "i"));
  }
  for (const source of [html, css, app, model, processor, readme, catalogEntry?.description ?? "", catalogEntry?.start ?? ""]) {
    assert.doesNotMatch(source, /pearl|necklace/i);
    const forbiddenFormerName = new RegExp(
      String.fromCharCode(104, 97, 109, 98, 111, 110, 101),
      "i",
    );
    assert.doesNotMatch(source, forbiddenFormerName);
  }
});

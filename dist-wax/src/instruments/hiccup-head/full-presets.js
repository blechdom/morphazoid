import {
  HICCUP_HEAD_VOICE_CHARACTERS, HICCUP_HEAD_VOICE_MODULATION_SOURCES,
  HICCUP_HEAD_VOICE_MODULATION_TARGETS,
  hiccupHeadState, hiccupHeadPattern, hiccupHeadSoundBank,
  hiccupHeadVoiceCharacter, sanitizeHiccupHeadVoice, clonePattern,
  sanitizeHiccupHeadState, HICCUP_HEAD_LIMITS, HICCUP_HEAD_SOUNDS, HICCUP_HEAD_SOUND_BANKS,
} from "./hiccup-head.js";
import { presetRandom, randomParameterValues, randomMonophonicRows } from "../../site/preset-random.js";

// Complete scenes cover all existing face and rhythm choices and all seven
// sound banks. Main scenes include effects and a built-in visual skin; local
// face/rhythm/skin selectors remain independent sub-presets.
const scenes = [
  ["rubber-party", "Rubber face · Mouth party", "rubber-face", "mouth-party", "natural-mouth", 118, 0.1],
  ["tongue-sprint", "Tin grin · Tongue virtuoso", "tin-grin", "tongue-mechanics", "tongue-workshop", 320, 0],
  ["chipmunk-boots", "Chipmunk box · Bops & cats", "chipmunk-box", "boots-cats", "tiny-cartoon", 164, 0.06],
  ["cavern-break", "Cavern gob · Cheeky break", "cavern-gob", "cheeky-break", "wet-rubber", 96, 0.2],
  ["tin-hands", "Tin grin · Two hands", "tin-grin", "two-hands", "tongue-workshop", 126, 0.04],
  ["air-rush", "PHSHK gremlin · Hush rush", "whisper-gremlin", "hush-rush", "air-pockets", 150, 0.02],
  ["vowel-choir", "Vowel engine · Open-air choir", "vowel-engine", "open-air", "open-throat", 60, 0],
  ["inside-out", "Inside-out singer · Sixteen faces", "inside-out", "sixteen-faces", "wet-rubber", 138, 0.12],
  ["slap-alpine", "Slap canyon · Alpine break", "slap-canyon", "alpine-break", "natural-mouth", 172, 0.04],
  ["feral-rude", "Feral baron · Nasty rolled & rude", "feral-baron", "rolled-and-rude", "rough-cellar", 190, 0.18],
  ["open-throat-tour", "Open throat · Throat tour", "open-throat", "throat-tour", "open-throat", 80, 0],
  ["head-hee-haw", "Head voice · HEE HAW", "head-voice", "hee-haw-loop", "tiny-cartoon", 112, 0.08],
  ["hummer", "Humming mask · Hummer step", "humming-mask", "hummer-step", "natural-mouth", 88, 0.04],
  ["rattle-house", "Rattle cave · Rough house", "rattle-cave", "rough-house", "rough-cellar", 156, 0.1],
  ["sloppy-tongue", "Sloppy oracle · Tongue parade", "sloppy-oracle", "tongue-parade", "tongue-workshop", 240, 0],
  ["slow-cellar", "Moan cellar · Grunt & moan", "moan-cellar", "grunt-and-moan", "rough-cellar", 48, 0.28],
  ["gap-tooth", "Rubber face · Gap-tooth FWEE", "rubber-face", "gap-tooth-fwee", "air-pockets", 132, 0.05],
  ["pink-atlas", "Open throat · Pink mouth atlas", "open-throat", "pink-mouth-atlas", "open-throat", 100, 0.02],
  ["sweet-humming", "Humming head · Sweet doo-wop", "humming-head", "doo-wop", "natural-mouth", 72, 0.05],
  ["pocket-beat", "Rubber face · Pocket backbeat", "rubber-face", "pocket-backbeat", "natural-mouth", 104, 0.08],
  ["rubber-skip", "Sloppy oracle · Rubber offbeats", "sloppy-oracle", "rubber-offbeats", "wet-rubber", 126, 0.18],
  ["tongue-breakbeat", "Tin grin · Tongue breaks", "tin-grin", "tongue-breaks", "tongue-workshop", 164, 0.05],
  ["half-time-breath", "Humming mask · Half-time huff", "humming-mask", "half-time-huff", "air-pockets", 82, 0.12],
  ["fwee-conversation", "Chipmunk box · FWEE answer", "chipmunk-box", "fwee-answer", "tiny-cartoon", 118, 0.06],
  ["mouth-crossbeat", "Open throat · Three-two mouth", "open-throat", "three-two-mouth", "natural-mouth", 136, 0.04],
];

// Explicit effect positions make the facial controls legible while touring.
// Negative eye divergence is plate, positive is cathedral; left/right lids
// remain independent high-pass/fuzz controls. No new DSP is introduced here.
const effectScenes = {
  dry: {
    decay: 0.62, earSpread: 0.22, nasalMix: 0.08,
    leftHairLength: 0, rightHairLength: 0, leftHairAngle: -0.78, rightHairAngle: -0.64,
    eyeDivergence: 0, eyeClosure: 0, leftEyeClosure: 0, rightEyeClosure: 0,
    leftBrow: 0, rightBrow: 0,
  },
  plate: {
    decay: 0.9, earSpread: 0.42, nasalMix: 0.14,
    leftHairLength: 0.12, rightHairLength: 0.16, leftHairAngle: -0.6, rightHairAngle: -0.4,
    eyeDivergence: -0.55, eyeClosure: 0, leftEyeClosure: 0, rightEyeClosure: 0,
    leftBrow: 0.25, rightBrow: 0,
  },
  cathedral: {
    decay: 1.45, earSpread: 0.74, nasalMix: 0.18,
    leftHairLength: 0.08, rightHairLength: 0.12, leftHairAngle: -0.7, rightHairAngle: -0.55,
    eyeDivergence: 0.7, eyeClosure: 0, leftEyeClosure: 0.08, rightEyeClosure: 0,
    leftBrow: 0.5, rightBrow: 0.25,
  },
  echo: {
    decay: 0.8, earSpread: 0.8, nasalMix: 0.1,
    leftHairLength: 0.48, rightHairLength: 0.64, leftHairAngle: -0.3, rightHairAngle: 0.32,
    eyeDivergence: -0.18, eyeClosure: 0, leftEyeClosure: 0, rightEyeClosure: 0.12,
    leftBrow: 0.25, rightBrow: 0.5,
  },
  fuzz: {
    decay: 1.12, earSpread: 0.5, nasalMix: 0.38,
    leftHairLength: 0.22, rightHairLength: 0.34, leftHairAngle: -0.45, rightHairAngle: 0.15,
    eyeDivergence: 0.24, eyeClosure: 0, leftEyeClosure: 0.35, rightEyeClosure: 0.64,
    leftBrow: 0.75, rightBrow: 0.5,
  },
  filtered: {
    decay: 0.72, earSpread: 0.62, nasalMix: 0.22,
    leftHairLength: 0.15, rightHairLength: 0.23, leftHairAngle: -0.65, rightHairAngle: -0.4,
    eyeDivergence: -0.32, eyeClosure: 0, leftEyeClosure: 0.62, rightEyeClosure: 0.08,
    leftBrow: 0, rightBrow: 0.25,
  },
  long: {
    decay: 1.65, earSpread: 0.88, nasalMix: 0.26,
    leftHairLength: 0.32, rightHairLength: 0.44, leftHairAngle: -0.25, rightHairAngle: 0.2,
    eyeDivergence: 0.5, eyeClosure: 0, leftEyeClosure: 0.16, rightEyeClosure: 0.2,
    leftBrow: 0.5, rightBrow: 0.75,
  },
};
const presentation = {
  "rubber-party": ["checker", "dry"],
  "sweet-humming": ["photo-1904", "plate"],
  "chipmunk-boots": ["food-portrait", "dry"],
  "cavern-break": ["cutout-collage", "cathedral"],
  "tin-hands": ["ascii", "echo"],
  "air-rush": ["ascii", "filtered"],
  "vowel-choir": ["photo-1904", "cathedral"],
  "inside-out": ["cutout-collage", "echo"],
  "slap-alpine": ["checker", "plate"],
  "feral-rude": ["wild-ink", "fuzz"],
  "open-throat-tour": ["photo-1904", "long"],
  "head-hee-haw": ["food-portrait", "echo"],
  hummer: ["checker", "plate"],
  "rattle-house": ["wild-ink", "fuzz"],
  "sloppy-tongue": ["food-portrait", "filtered"],
  "slow-cellar": ["wild-ink", "long"],
  "gap-tooth": ["checker", "dry"],
  "pink-atlas": ["cutout-collage", "plate"],
  "tongue-sprint": ["ascii", "dry"],
  "pocket-beat": ["checker", "dry"],
  "rubber-skip": ["food-portrait", "plate"],
  "tongue-breakbeat": ["ascii", "dry"],
  "half-time-breath": ["photo-1904", "plate"],
  "fwee-conversation": ["cutout-collage", "echo"],
  "mouth-crossbeat": ["checker", "dry"],
};

export function fullPresetVoiceSlots(bankId) {
  const bank = hiccupHeadSoundBank(bankId);
  return HICCUP_HEAD_VOICE_CHARACTERS.slice(0, 8).map((_, index) => {
    const character = hiccupHeadVoiceCharacter(bank.characterIds[index % bank.characterIds.length]);
    return {
      id: `voice-${index + 1}`, solo: false, assignment: "all",
      voice: sanitizeHiccupHeadVoice({
        characterId: character.id, ...character.settings,
        modulation: {
          source: HICCUP_HEAD_VOICE_MODULATION_SOURCES[index % HICCUP_HEAD_VOICE_MODULATION_SOURCES.length],
          target: HICCUP_HEAD_VOICE_MODULATION_TARGETS[index % HICCUP_HEAD_VOICE_MODULATION_TARGETS.length],
          depth: 0.18 + (index % 4) * 0.08, rateHz: 2.4 + index * 0.53, phase: (index * 0.173) % 1,
        },
      }),
    };
  });
}

export const HICCUP_HEAD_FULL_PRESETS = Object.freeze(scenes.map(([id, label, face, rhythm, bank, tempo, swing]) => {
  const pattern = clonePattern(hiccupHeadPattern(rhythm));
  const lastStep = Math.max(...Object.values(pattern).map(row => row.findLastIndex(value => value > 0)));
  const [visualSkinId, effectScene] = presentation[id];
  return Object.freeze({
    id, label,
    description: `${hiccupHeadSoundBank(bank).label}, ${effectScene} effects, ${visualSkinId} skin, complete face/voices and ${tempo} BPM. No automatic Audio, Play or camera.`,
    snapshot: {
      state: hiccupHeadState(face, { ...effectScenes[effectScene], patternId: rhythm, tempo, swing, level: 0.62 }),
      pattern, currentPatternId: rhythm, sequenceLength: Math.max(16, Math.ceil((lastStep + 1) / 16) * 16),
      currentSoundBankId: bank, voiceCount: 4, voiceSelectionMode: "round-robin",
      voiceSlots: fullPresetVoiceSlots(bank),
      faceEffectEnabled: { delay: effectScene !== "dry", reverb: effectScene !== "dry", nasal: true, stereo: true },
      eyebrowEmphasis: 0.7,
      visualSkinId,
    },
  });
}));

export function randomizeHiccupHeadPreset(current, random = Math.random) {
  const rng = presetRandom(random);
  const state = sanitizeHiccupHeadState({
    ...current.state, // IDs are provenance; every numeric musical field is rolled below.
    ...randomParameterValues({
      ...HICCUP_HEAD_LIMITS, lungPressure: [0.45, 1.05], tractLengthM: [0.09, 0.28],
      mouthOpening: [0.12, 1.2], leftEyeClosure: [0, 0.7], rightEyeClosure: [0, 0.65],
      leftHairLength: [0, 0.65], rightHairLength: [0, 0.65], decay: [0.4, 1.5],
      swing: [0, 0.35], humanize: [0, 0.2],
    }, rng),
    level: current.state.level, tempo: rng.integer(60, 240),
  });
  const sequenceLength = rng.integer(8, 64), voiceCount = rng.integer(1, 8);
  const solo = rng.unit() < 0.25 ? rng.integer(0, voiceCount - 1) : -1;
  const assignments = ["all", ...HICCUP_HEAD_SOUNDS.filter(sound => sound.voiceCapable).map(sound => sound.id)];
  return {
    state, sequenceLength, currentPatternId: "custom",
    pattern: randomMonophonicRows(HICCUP_HEAD_SOUNDS.map(sound => sound.id), 64, sequenceLength, rng),
    currentSoundBankId: rng.pick(HICCUP_HEAD_SOUND_BANKS).id,
    voiceCount, voiceSelectionMode: rng.pick(["round-robin", "random"]),
    voiceSlots: Array.from({ length: 8 }, (_, index) => ({
      id: `voice-${index + 1}`, solo: index === solo, assignment: rng.pick(assignments),
      voice: sanitizeHiccupHeadVoice({
        characterId: rng.pick(HICCUP_HEAD_VOICE_CHARACTERS).id,
        ...randomParameterValues({
          pitchOffsetSemitones: [-16, 16], vibratoRateHz: [0, 10], vibratoDepthSemitones: [0, 2.5],
          breathiness: [0.03, 0.68], roughness: [0, 0.75], subharmonicMix: [0, 0.65], tractScale: [0.88, 1.12],
        }, rng),
        modulation: {
          source: rng.pick(HICCUP_HEAD_VOICE_MODULATION_SOURCES), target: rng.pick(HICCUP_HEAD_VOICE_MODULATION_TARGETS),
          depth: rng.between(0, 0.65), rateHz: rng.between(0.1, 12), phase: rng.unit(),
        },
      }),
    })),
    faceEffectEnabled: Object.fromEntries(["delay", "reverb", "nasal", "stereo"].map(key => [key, rng.pick([true, false])])),
    eyebrowEmphasis: rng.between(0, 1),
    visualSkinId: rng.pick(["checker", "photo-1904", "food-portrait", "cutout-collage", "ascii", "wild-ink"]),
  };
}

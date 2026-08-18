import {
  frequencyFromSlider,
  sanitizeFmDrumVoice,
} from "./fm-drums.js";

export const FM_DRUM_MIDI_FIRST_NOTE = 36;
export const FM_DRUM_MIDI_PAD_COUNT = 16;

export const FM_DRUM_MACRO_LABELS = Object.freeze([
  "Tune",
  "Decay",
  "FM ratio",
  "FM index",
  "Pitch sweep",
  "Noise",
  "Tone",
  "Level",
]);

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

function boundedIndex(value, count) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < count ? index : -1;
}

function exponentialRange(position, minimum, maximum) {
  return minimum * ((maximum / minimum) ** clamp01(position));
}

export function fmDrumVoiceIndexForMidiEvent(event) {
  if (event?.type !== "noteOn" || Number(event.velocity) <= 0) return -1;
  if (event.logical?.type === "pad") {
    return boundedIndex(event.logical.index, FM_DRUM_MIDI_PAD_COUNT);
  }
  const note = Number(event.note);
  if (!Number.isInteger(note)) return -1;
  const index = note - FM_DRUM_MIDI_FIRST_NOTE;
  return index >= 0 && index < FM_DRUM_MIDI_PAD_COUNT ? index : -1;
}

export function fmDrumVelocityGain(velocity) {
  return Math.min(127, Math.max(0, Number(velocity) || 0)) / 127;
}

export function fmDrumMacroUpdate(index, normalizedValue) {
  const value = clamp01(normalizedValue);
  switch (boundedIndex(index, FM_DRUM_MACRO_LABELS.length)) {
    case 0: return Object.freeze({ key: "frequency", value: frequencyFromSlider(value) });
    case 1: return Object.freeze({ key: "decay", value: exponentialRange(value, 0.035, 3) });
    case 2: return Object.freeze({ key: "modRatio", value: 0.25 + value * 7.75 });
    case 3: return Object.freeze({ key: "modIndex", value: value * 20 });
    case 4: return Object.freeze({ key: "pitchBend", value: -1 + value * 9 });
    case 5: return Object.freeze({ key: "noise", value });
    case 6: return Object.freeze({ key: "tone", value });
    case 7: return Object.freeze({ key: "level", value });
    default: return null;
  }
}

export function createFmDrumMidiTriggerVoice(voice, velocityGain) {
  if (!voice) return null;
  const level = Math.min(1, Math.max(0, Number(voice.level) || 0));
  return sanitizeFmDrumVoice({
    ...voice,
    level: level * clamp01(velocityGain),
  });
}

export function fmDrumControlChangeAction(controller, midiValue) {
  const cc = Math.round(Number(controller));
  const value = Math.min(127, Math.max(0, Number(midiValue) || 0));
  const normalized = value / 127;
  if (cc === 7) return Object.freeze({ type: "master", value: normalized * 0.9 });
  const mappings = new Map([
    [16, { key: "frequency", value: frequencyFromSlider(normalized) }],
    [73, { key: "attack", value: exponentialRange(normalized, 0.001, 0.25) }],
    [72, { key: "decay", value: exponentialRange(normalized, 0.035, 3) }],
    [76, { key: "modRatio", value: 0.25 + normalized * 7.75 }],
    [71, { key: "modIndex", value: normalized * 20 }],
    [77, { key: "pitchBend", value: -1 + normalized * 9 }],
    [78, { key: "noise", value: normalized }],
    [74, { key: "tone", value: normalized }],
    [11, { key: "level", value: normalized }],
  ]);
  const update = mappings.get(cc);
  return update ? Object.freeze({ type: "voice", ...update }) : null;
}

export function fmDrumMidiAction(event) {
  const voiceIndex = fmDrumVoiceIndexForMidiEvent(event);
  if (voiceIndex >= 0) {
    return Object.freeze({
      type: "trigger",
      voiceIndex,
      velocityGain: fmDrumVelocityGain(event.velocity),
    });
  }
  if (event?.logical?.type === "macro") {
    const update = fmDrumMacroUpdate(event.logical.index, event.logical.normalized);
    return update ? Object.freeze({ type: "voice", ...update }) : null;
  }
  if (event?.type === "controlChange") {
    return fmDrumControlChangeAction(event.controller, event.value);
  }
  return null;
}

export function updateFmDrumVoiceFromMidi(voice, update) {
  if (!voice || update?.type !== "voice" || typeof update.key !== "string") return voice;
  return sanitizeFmDrumVoice({ ...voice, [update.key]: update.value });
}

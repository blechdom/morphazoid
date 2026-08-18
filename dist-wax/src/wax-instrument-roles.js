import { INSTRUMENTS } from "./instrument-catalog.js";
import {
  INSTRUMENT_MIDI_CAPABILITIES,
  instrumentMidiCapabilityForId,
} from "./instrument-midi-capabilities.js";

export const WAX_ROLE_IDS = Object.freeze({
  instrument: "instrument",
  audioFx: "audio-fx",
  midiFx: "midi-fx",
});

export const WAX_ROLE_DEFINITIONS = Object.freeze({
  [WAX_ROLE_IDS.instrument]: Object.freeze({
    id: WAX_ROLE_IDS.instrument,
    label: "WAX Instrument",
    input: "Track MIDI",
    output: "Audio",
    useWhen: "Play Morphazoid's built-in synth, sampler, drums, or sonification from a track.",
  }),
  [WAX_ROLE_IDS.audioFx]: Object.freeze({
    id: WAX_ROLE_IDS.audioFx,
    label: "WAX Audio FX",
    input: "Track audio",
    output: "Audio",
    useWhen: "Process audio already on the DAW track through a Morphazoid signal path.",
  }),
  [WAX_ROLE_IDS.midiFx]: Object.freeze({
    id: WAX_ROLE_IDS.midiFx,
    label: "WAX MIDI FX",
    input: "Track MIDI / host clock",
    output: "MIDI",
    useWhen: "Send a Morphazoid rhythm or score to a downstream software or hardware instrument.",
  }),
});

const AUDIO_FX_IDS = new Set(
  INSTRUMENT_MIDI_CAPABILITIES
    .filter(({ audioInput }) => audioInput)
    .map(({ id }) => id),
);

const HOST_SYNC_EXCLUDED_IDS = new Set([
  "fm-drums",
  "linear-drums",
  "sample-drums",
]);

const catalogueIds = new Set(INSTRUMENTS.map(({ id }) => id));
const missingIds = INSTRUMENTS
  .filter(({ id }) => !instrumentMidiCapabilityForId(id))
  .map(({ id }) => id);
const unknownIds = INSTRUMENT_MIDI_CAPABILITIES
  .filter(({ id }) => !catalogueIds.has(id))
  .map(({ id }) => id);
if (missingIds.length || unknownIds.length) {
  throw new Error([
    missingIds.length ? `Missing WAX roles: ${missingIds.join(", ")}` : "",
    unknownIds.length ? `Unknown WAX role ids: ${unknownIds.join(", ")}` : "",
  ].filter(Boolean).join(". "));
}

function summaryFor(instrument, noteMode, midiOutput) {
  if (noteMode === "processor") {
    return `Process a DAW track through ${instrument.label}'s live-input signal path.`;
  }
  if (noteMode === "drums") {
    return midiOutput
      ? "Use the built-in percussion, or send a control-shaped companion rhythm to another drum instrument."
      : "Play the built-in percussion from DAW notes and mapped controls.";
  }
  if (noteMode === "sequence") {
    return "Hear the built-in sonification, or route its initial control-shaped companion sequence to another instrument.";
  }
  if (midiOutput) {
    return "Play the built-in synth, or route a control-shaped geometry companion as MIDI notes.";
  }
  return "Play and automate the built-in sound engine from the DAW's MIDI track.";
}

function caveatFor(instrument, noteMode, midiOutput) {
  if (AUDIO_FX_IDS.has(instrument.id)) {
    return "Preview: confirm DAW track-input capture in your WAX host; the browser mic/file path may still need a page-specific adapter.";
  }
  if (instrument.id === "webgpu-303") {
    return "Preview: requires WebGPU support in WAX's embedded browser and should be host-tested before a session.";
  }
  if (instrument.status) {
    return midiOutput
      ? "The page is a work in progress and MIDI FX uses the universal companion, not exact internal events; verify timing and recall before a render."
      : "The page and its WAX mapping are works in progress; verify note timing and project recall before relying on a render.";
  }
  if (noteMode === "sequence") {
    return "MIDI FX currently uses the universal deterministic companion, not the page's exact internal audio events; verify note choice, gate, and timing.";
  }
  if (midiOutput) {
    return "MIDI FX currently uses the universal deterministic companion; exact page-event mirroring is a later native-adapter pass.";
  }
  return null;
}

export const WAX_INSTRUMENT_SUPPORT = Object.freeze(INSTRUMENTS.map((instrument) => {
  const midiCapability = instrumentMidiCapabilityForId(instrument.id);
  const { midiOutput, noteMode } = midiCapability;
  const recommended = noteMode === "processor"
    ? WAX_ROLE_IDS.audioFx
    : WAX_ROLE_IDS.instrument;
  const roles = [recommended];
  if (AUDIO_FX_IDS.has(instrument.id) && !roles.includes(WAX_ROLE_IDS.audioFx)) {
    roles.push(WAX_ROLE_IDS.audioFx);
  }
  if (instrument.id === "recursion") roles.push(WAX_ROLE_IDS.instrument);
  if (midiOutput) roles.push(WAX_ROLE_IDS.midiFx);

  return Object.freeze({
    id: instrument.id,
    recommended,
    roles: Object.freeze([...new Set(roles)]),
    audioInput: midiCapability.audioInput,
    midiInput: midiCapability.midiInput,
    midiInputMode: midiCapability.midiInputMode,
    computerKeyboardMode: midiCapability.computerKeyboardMode,
    midiOutput,
    hostSync: midiOutput && !HOST_SYNC_EXCLUDED_IDS.has(instrument.id),
    noteMode,
    summary: summaryFor(instrument, noteMode, midiOutput),
    caveat: caveatFor(instrument, noteMode, midiOutput),
  });
}));

const supportById = new Map(WAX_INSTRUMENT_SUPPORT.map((support) => [support.id, support]));

export function waxSupportForId(id) {
  return supportById.get(id) ?? null;
}

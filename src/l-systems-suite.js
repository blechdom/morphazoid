const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)));

export const L_SYSTEM_SUITE_MODES = freezeList([
  {
    id: "synth",
    label: "Synth",
    title: "L-System Synth",
    href: "l-system.html",
    accent: "#5fe8c4",
  },
  {
    id: "drums",
    label: "Drums",
    title: "L-System Drum Machine",
    href: "l-system-drums.html",
    accent: "#ffb86b",
  },
  {
    id: "mic",
    label: "Mic",
    title: "L-System Delay",
    href: "l-mic.html",
    accent: "#7db4ff",
  },
]);

export const L_SYSTEM_PLAYING_MODES = freezeList([
  {
    id: "continuous",
    label: "Continuous",
    title: "L-System Continuous",
    audioKind: "synth",
    accent: "#5fe8c4",
  },
  {
    id: "notes",
    label: "Notes",
    title: "L-System Notes",
    audioKind: "synth",
    accent: "#d7ef7f",
  },
  {
    id: "triggers",
    label: "Triggers",
    title: "L-System Triggers",
    audioKind: "drums",
    accent: "#ffb86b",
  },
  {
    id: "mic",
    label: "Mic",
    title: "L-System Mic",
    audioKind: "mic",
    accent: "#7db4ff",
  },
]);

const modeIds = new Set([
  ...L_SYSTEM_SUITE_MODES.map(({ id }) => id),
  ...L_SYSTEM_PLAYING_MODES.map(({ id }) => id),
]);
const parameter = (id, label, modes, notes = "") => Object.freeze({
  id,
  label,
  modes: Object.freeze(modes.filter((mode) => modeIds.has(mode))),
  notes,
});

export const L_SYSTEM_IDENTICAL_PARAMETERS = freezeList([
  parameter("presetId", "Grammar preset", ["continuous", "notes", "triggers", "mic"], "One L_SYSTEM_PRESETS source drives all playing modes."),
  parameter("iterations", "Iterations", ["continuous", "notes", "triggers", "mic"], "One range, preset max handling, and rebuild behavior."),
  parameter("angle", "Turn angle", ["continuous", "notes", "triggers", "mic"], "One degree value passed into traceLSystem()."),
  parameter("turnAsymmetry", "Turn asymmetry", ["continuous", "notes", "triggers", "mic"], "One skew value for left and right turns."),
  parameter("lengthScale", "Branch length taper", ["continuous", "notes", "triggers", "mic"], "One > and < turtle distance multiplier."),
  parameter("position", "Growth position", ["continuous", "notes", "triggers", "mic"], "One normalized traversal position survives mode switching."),
  parameter("speed", "Traversal speed", ["continuous", "notes", "triggers", "mic"], "One transport speed, 0 to 3 cycles per second in the combined app."),
  parameter("direction", "Traversal direction", ["continuous", "notes", "triggers", "mic"], "One forward/reverse phase direction."),
  parameter("traversalBehavior", "Traversal behavior", ["continuous", "notes", "triggers", "mic"], "One loop or ping-pong behavior."),
  parameter("structureMode", "Iteration playback", ["continuous", "notes", "triggers", "mic"], "One final, sequence, together, accumulate, and canon schedule."),
  parameter("playing", "Transport play state", ["continuous", "notes", "triggers", "mic"], "One visual/audio transport state."),
  parameter("audio", "Audio armed state", ["continuous", "notes", "triggers", "mic"], "One master audio enable flag with mode-specific engines muted or prepared."),
  parameter("level", "Master level", ["continuous", "notes", "triggers", "mic"], "One header level feeds synth, note strikes, drum output, and mic branch send."),
]);

export const L_SYSTEM_ANALOG_PARAMETERS = freezeList([
  parameter("pitchRange", "Pitch span", ["continuous", "notes", "mic"], "Continuous/Notes map it to oscillator octaves; mic maps it to branch playback-rate bend."),
  parameter("stereoSpread", "Stereo spread", ["continuous", "notes", "mic"], "Synth modes pan oscillator heads; mic pans delayed branch taps."),
  parameter("branchDepth", "Branch depth", ["continuous", "notes", "triggers", "mic"], "Continuous uses it for timbre drive, Triggers for row/character, Mic for delay taper."),
]);

export const L_SYSTEM_UNIQUE_PARAMETERS = Object.freeze({
  continuous: freezeList([
    parameter("pitchSource", "Pitch data", ["continuous"]),
    parameter("baseFrequency", "Trunk frequency", ["continuous"]),
    parameter("pitchRange", "Angle pitch scale", ["continuous"]),
    parameter("depthAmount", "Depth to timbre", ["continuous"]),
    parameter("soundMode", "Voice", ["continuous"]),
    parameter("modulationIndex", "Modulation depth", ["continuous"]),
    parameter("amplitudeEnvelope", "Branch amplitude envelope", ["continuous"]),
    parameter("adaptivePolyphony", "Voice ceiling", ["continuous"]),
  ]),
  notes: freezeList([
    parameter("noteStrikes", "One-shot synth strikes", ["notes"]),
    parameter("noteSubdivisions", "Subdivisions per branch", ["notes"]),
  ]),
  triggers: freezeList([
    parameter("subdivisions", "Subdivisions per branch", ["triggers"]),
    parameter("mappingMode", "Drum source", ["triggers"]),
    parameter("percussionStyle", "Percussion palette", ["triggers"]),
    parameter("pitchDepth", "Height pitch", ["triggers"]),
    parameter("anglePitchDepth", "Angle pitch", ["triggers"]),
    parameter("angleRange", "Angle range", ["triggers"]),
    parameter("characterDepth", "Character depth", ["triggers"]),
    parameter("drumMap", "Sixteen percussion voices", ["triggers"]),
  ]),
  mic: freezeList([
    parameter("inputTrim", "Input trim", ["mic"]),
    parameter("microphoneInput", "Microphone permission/input", ["mic"]),
    parameter("feedback", "Delay feedback", ["mic"]),
    parameter("interval", "Timing scale", ["mic"]),
    parameter("timeRatio", "Depth delay ratio", ["mic"]),
    parameter("micPitchRange", "Playback-rate bend", ["mic"]),
    parameter("micSpread", "Mic branch spread", ["mic"]),
    parameter("wet", "Branch send", ["mic"]),
  ]),
});

export const L_SYSTEM_CROSSOVER_PARAMETERS = freezeList([
  {
    id: "subdivisions-to-continuous-notes-mic",
    from: "triggers",
    parameter: "subdivisions",
    to: Object.freeze(["continuous", "notes", "mic"]),
    recommendation: "Use branch subdivisions as a note-event clock, trigger density, and mic tap-density reference.",
  },
  {
    id: "mapping-mode-to-notes-mic",
    from: "triggers",
    parameter: "mappingMode",
    to: Object.freeze(["notes", "mic"]),
    recommendation: "Expose depth x turn, position grid, and generation x phase as alternate note grouping and mic routing maps.",
  },
  {
    id: "pitch-source-to-notes-triggers-mic",
    from: "continuous",
    parameter: "pitchSource",
    to: Object.freeze(["notes", "triggers", "mic"]),
    recommendation: "Let Notes, Triggers, and Mic choose angle, height, depth, or progress as the primary tuning/rate source.",
  },
  {
    id: "sound-mode-to-notes",
    from: "continuous",
    parameter: "soundMode",
    to: Object.freeze(["notes"]),
    recommendation: "Treat sine, FM, PM, and Shepard as shared palettes for sustained voices and one-shot notes.",
  },
  {
    id: "envelope-to-notes-mic",
    from: "continuous",
    parameter: "amplitudeEnvelope",
    to: Object.freeze(["notes", "mic"]),
    recommendation: "Reuse the editable branch envelope for note articulation and mic descendant fade curves.",
  },
  {
    id: "structure-mode-to-mic",
    from: "continuous/notes/triggers",
    parameter: "structureMode",
    to: Object.freeze(["mic"]),
    recommendation: "Add final, sequence, together, accumulate, and canon generation playback to the delay tree.",
  },
  {
    id: "time-ratio-to-continuous-notes-triggers",
    from: "mic",
    parameter: "timeRatio",
    to: Object.freeze(["continuous", "notes", "triggers"]),
    recommendation: "Let depth timing taper alter sustained drift, note events, and trigger subdivision feel.",
  },
  {
    id: "pruning-to-continuous-notes-triggers",
    from: "mic",
    parameter: "pruningBias",
    to: Object.freeze(["continuous", "notes", "triggers"]),
    recommendation: "Use breadth/depth pruning as an explicit allocation strategy for dense canons, note bursts, and trigger storms.",
  },
  {
    id: "mutation-to-continuous-notes-triggers",
    from: "mic",
    parameter: "mutation",
    to: Object.freeze(["continuous", "notes", "triggers"]),
    recommendation: "Let rule mutation perturb turns, segment emphasis, and trigger probability without replacing the selected grammar.",
  },
  {
    id: "mix-presets-to-all-modes",
    from: "mic",
    parameter: "mixPreset",
    to: Object.freeze(["continuous", "notes", "triggers", "mic"]),
    recommendation: "Use mix presets to balance sustained branches, one-shot notes, drum triggers, and mic branch delay at comparable intensity.",
  },
]);

export function lSystemSuiteModeFor(id = "synth") {
  return L_SYSTEM_SUITE_MODES.find((mode) => mode.id === id) ?? L_SYSTEM_SUITE_MODES[0];
}

export function lSystemPlayingModeFor(id = "continuous") {
  return L_SYSTEM_PLAYING_MODES.find((mode) => mode.id === id) ?? L_SYSTEM_PLAYING_MODES[0];
}

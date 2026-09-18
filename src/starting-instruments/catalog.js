import { TEMPO_DEFAULTS, TEMPO_PRESETS } from "./tempo-tantrum.js";
import { TAPE_DEFAULTS, TAPE_PRESETS } from "./tape-worm.js";
import { SOUP_DEFAULTS, SOUP_PRESETS } from "./loop-soup.js";
import { HABIT_DEFAULTS, HABIT_PRESETS } from "./habit-habitat.js";
import { HOLLOW_DEFAULTS, HOLLOW_PRESETS } from "./hollowphonic.js";

const knob = (key, label, min, max, step, unit = "") => ({ key, label, min, max, step, unit });
export const STARTING_INSTRUMENTS = Object.freeze({
  "tempo-tantrum": {
    title: "Tempo Tantrum", subtitle: "coax a rhythm into agreement", accent: "#f4bb7e",
    description: "Three driven phase oscillators can lock to a pulse, slip, and recover after a nudge. Their own phase crossings make the rhythm.",
    hint: "Drag a bead around its orbit to disturb its phase; drag outward to detune it.",
    defaults: TEMPO_DEFAULTS, presets: TEMPO_PRESETS,
    controls: [knob("tempo", "Drive tempo", 40, 240, 1, " BPM"), knob("strength", "Pull into step", 0, 0.9, 0.01),
      knob("detune", "Restlessness", -0.6, 0.6, 0.01), knob("decay", "Body decay", 0.04, 0.8, 0.01, " s"),
      knob("driver", "Hear the drive", 0, 0.5, 0.01)],
    disclaimer: "A classical phase-locking experiment—not a simulation of a quantum time crystal.",
  },
  "tape-worm": {
    title: "Tape Worm", subtitle: "record loops · connect their continuations", accent: "#a4ddba",
    description: "An editable network of up to eight recorded loops: record in each center, drag loops, attach directed playback-head routes, and set independent exit, entry, and crossfade parameters.",
    hint: "● record · ▶/Ⅱ play/pause · M mute · S solo. Drag a letter to move its loop. Use the bent-arrow icon, then a destination letter, to connect.",
    defaults: TAPE_DEFAULTS, presets: TAPE_PRESETS,
    controls: [knob("speed", "Tape speed", 0.25, 2, 0.01, "×"),
      knob("departure", "All route exits", 0.02, 0.98, 0.01), knob("landing", "All route entries", 0, 0.95, 0.01)],
    disclaimer: "Up to eight mono tapes and 24 routes. One playback head transfers between tapes. Recordings are page-local and disappear on reload; no automatic graph analysis.",
  },
  "loop-soup": {
    title: "Loop Soup", subtitle: "lettered loops · editable audio routes", accent: "#eca6bd",
    description: "Up to eight independently controlled loops with center recording, play/pause, mute, solo, hold, and editable directed audio feeds with send level and tone controls.",
    hint: "● record · ▶/Ⅱ play/pause · M mute · S solo. Drag a letter to move its loop. The bent-arrow icon attaches an audio feed; scroll to reach other loops.",
    defaults: SOUP_DEFAULTS, presets: SOUP_PRESETS,
    controls: [knob("retention", "Retain each pass", 0, 1, 0.01), knob("feed", "Input write level", 0, 0.9, 0.01),
      knob("spill", "Route write level", 0, 0.7, 0.01)],
    disclaimer: "A bounded editable tape network. Hold preserves samples; Write enables saturated overdubbing. Memory is page-local and disappears on reload.",
  },
  "habit-habitat": {
    title: "Habit Habitat", subtitle: "play a path until it remembers", accent: "#aacaef",
    description: "Teach a six-node network your transitions, then hear deterministic weighted recall. Playback never teaches itself.",
    hint: "In Teach, tap the nodes in your desired order. In Recall, Play follows the learned paths.",
    defaults: HABIT_DEFAULTS, presets: HABIT_PRESETS,
    controls: [knob("tempo", "Recall tempo", 35, 240, 1, " BPM"), knob("follow", "Follow learned routes", 0, 1, 0.01),
      knob("learning", "Learning per gesture", 0.05, 1, 0.01), knob("decay", "Note decay", 0.04, 0.8, 0.01, " s")],
    disclaimer: "A learned transition network, not a biological model. Save memory stores routes in this browser, not recorded audio.",
  },
  hollowphonic: {
    title: "Hollowphonic", subtitle: "play the space the sound passes through", accent: "#c9b0ed",
    description: "Three coupled delay-line resonators reshape noise, a drone, or microphone input. Change cavity lengths and losses or strike the chambers directly.",
    hint: "Drag a chamber vertically to change its depth and resonance. Tap it to excite the same resonator.",
    defaults: HOLLOW_DEFAULTS, presets: HOLLOW_PRESETS,
    controls: [knob("depth", "Cavity depth", 0, 1, 0.01), knob("loss", "Wall damping", 0, 1, 0.01),
      knob("coupling", "Between chambers", 0, 1, 0.01), knob("mix", "Through the wall", 0, 1, 0.01)],
    disclaimer: "A coupled digital waveguide approximation, not a material simulation or an acoustic sum-rule demonstrator.",
  },
});

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
    title: "Tape Worm", subtitle: "one reader, unexpected continuations", accent: "#a4ddba",
    description: "One playback head crosses between two intact recordings at an editable splice. The source recordings are never overwritten by traversal.",
    hint: "Drag round OUT or diamond IN gates; both tapes share the gate settings. Click a tape to move the reader.",
    defaults: TAPE_DEFAULTS, presets: TAPE_PRESETS,
    controls: [knob("speed", "Tape speed", 0.25, 2, 0.01, "×"),
      knob("departure", "Leave at", 0.05, 0.95, 0.01), knob("landing", "Arrive at", 0, 0.85, 0.01)],
    disclaimer: "Working title. Two original synthetic phrases are preloaded. Recordings stay in this page's memory; reloading discards them.",
  },
  "loop-soup": {
    title: "Loop Soup", subtitle: "leave something in the pot", accent: "#eca6bd",
    description: "Three persistent tape loops retain and mix their contents. Hold stops writing, overdub adds sound, and a brush selectively erases the tapes.",
    hint: "Click a bowl to select it. Enable Erase brush and drag around its tape to remove sound.",
    defaults: SOUP_DEFAULTS, presets: SOUP_PRESETS,
    controls: [knob("retention", "Retain each pass", 0, 1, 0.01), knob("feed", "New ingredient", 0, 0.9, 0.01),
      knob("spill", "Spill into next bowl", 0, 0.7, 0.01)],
    disclaimer: "A bounded digital tape network. Hold preserves samples exactly; overdub is softly saturated. Memory is local to this page.",
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

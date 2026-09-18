// Performance notes shared by the authored page and live UI, not the engines.
export const INSTRUMENT_HELP = Object.freeze({
  "tempo-tantrum": {
    start: "Choose Soft agreement, enable Audio, and Play. Wait a few seconds, nudge Body 1, then listen as it returns to the pattern. Try No manners for slipping phases.",
    hear: "A short high tick is the external drive. Three lower tones sound when their own orbiting beads cross the top of their rings.",
    mechanism: "The bodies prefer one revolution per 2, 3, and 4 drive beats. Those target ratios are chosen, but note times come from continuously evolving phases. Coupling pulls them toward the drive; detuning pulls them away. They share a drive, not direct connections to one another.",
    visual: "Filled beads are the three body phases. Hollow markers show possible drive-aligned positions for each ratio. The central pulse is the drive. IN STEP means measured relative phase motion has settled; it does not mean all three bodies strike simultaneously.",
    limits: "Three fixed bodies, no recordings or graph. This is classical phase locking, not a physical or quantum time crystal. Ratios are not automatically discovered.",
    memory: "Presets retain body phases and individual detuning. Reset controls restores the three original phases and offsets but keeps Play and Audio unchanged.",
    keyboard: "Focus the stage. Left/right selects a body; Enter or 1–3 nudges it. Up/down changes its detuning. Space toggles Play.",
    reset: "Controls and body phases reset; Play and Audio retained.",
    controls: {
      tempo: "External drive rate. It is not the note rate of all three bodies.",
      strength: "How strongly the drive pulls each body toward a stable phase relationship. Zero releases the drive; the bodies still move.",
      detune: "Signed natural-rate offset shared by all bodies. Positive runs faster; negative runs slower. Radial drags add an individual offset.",
      decay: "Decay time of the three body tones, not the rate of motion.",
      driver: "Volume of the high drive tick. Turning it down does not stop the drive.",
    },
    presets: {
      "Soft agreement": "Stable locking region. Nudge one body and listen to it recover over a few seconds.",
      "On the edge": "Just outside the default locking range: slow slips make the relationship change.",
      "No manners": "Weak pull and large detuning. Expect drifting phases rather than a stable beat division.",
      "Slow recovery": "Slower drive, gentler correction, and longer tones.",
    },
  },
  "tape-worm": {
    start: "Enable Audio and Play to hear the two demo phrases. Drag a round OUT gate to change where the worm leaves; drag a diamond IN gate to change where it arrives.",
    hear: "One reader plays a single tape at a time. At the OUT gate it crossfades into the other tape's IN position. Tape A leans left; Tape B leans right.",
    mechanism: "Both tapes share the Leave at and Arrive at percentages. With splices bypassed, the current tape loops by itself—not both tapes together. Tape speed changes both duration and pitch. Moving a gate never edits the recording.",
    visual: "The cream worm is the playback head. Colored contours show recorded amplitude. Round OUT gates are departures; diamond IN gates are arrivals. Dashed arrows show cross-tape routes, not editable graph edges.",
    limits: "Exactly two mono recordings and one reader. No added play heads, moving record heads, free graph layout, onset detection, or automatic graph construction.",
    memory: "Choose Tape A/B before replacing it with a file or recording. Capture is limited to 12 seconds; Pause affects playback, not an active capture. Stop recording or Audio Off finishes capture. Reloading or leaving this page loses the recordings; there is no audio export yet.",
    keyboard: "Focus the stage. Left/right selects A/B; Enter or 1–2 puts the reader at that tape's start. Up/down moves the shared OUT gates. Arrive at has its own slider. Space toggles Play.",
    reset: "Controls reset and reader returned to Tape A. Recordings, Play, and Audio retained.",
    controls: {
      speed: "1× is original pitch and duration. 0.5× is twice as long and one octave lower; 2× is half as long and one octave higher.",
      departure: "Shared departure position on both recordings, measured clockwise from the top. Drag either round OUT gate.",
      landing: "Shared arrival position in the other recording. Drag either diamond IN gate. If it is beyond OUT, the head wraps around before leaving.",
    },
    presets: {
      "Two phrases": "Leaves at 72%, arrives at 8%, at original speed. The two demo phrases alternate.",
      "Tiny detours": "Short passages between closely placed gates.",
      "Slow worm": "Slower, lower-pitched tape playback with longer passages.",
      "Original loops": "Bypasses splices. Only the tape carrying the reader plays; click A or B to compare.",
    },
  },
  "loop-soup": {
    start: "Enable Audio and Play. Hold Bowl 1 while the other tapes keep changing. Turn the demo ingredient off, then try the erase brush on the held bowl.",
    hear: "Three loops play together, panned across the stereo field. A synthesized pluck is the optional new ingredient; microphone input can replace it.",
    mechanism: "The fixed loops last 0.75, 1.2, and 1.8 seconds. Each overdub pass mixes retained samples, new input, and spill from the previous bowl, with soft saturation. Spill travels 1 → 2 → 3 → 1. Hold stops all writing to that bowl but keeps its playback audible.",
    visual: "Contours show stored amplitude, cream dots show read/write positions, and arrows show spill direction. Density indicates recorded level, not the count of layers. The selected bowl has a thicker outline.",
    limits: "Three fixed tapes with fixed read/write motion. You cannot add or reposition heads, resize loops, draw new connections, or infer a graph. There is no file import or audio export.",
    memory: "Pause stops tape motion and overdubbing. Audio Off mutes and closes the mic, but running overdubs still evolve from stored audio and the demo source. Hold preserves samples exactly; 100% retention alone still passes through saturation. Erased regions can refill unless their bowl is held. Reloading loses all tape contents.",
    keyboard: "Focus the stage. Left/right selects a bowl; Enter or 1–3 toggles Hold/Overdub. With Erase brush enabled, up/down erases at that bowl's current head. Space toggles Play.",
    reset: "Parameters reset; tape contents, Hold states, Play, and Audio retained. Demo ingredient returns on.",
    controls: {
      retention: "Old audio kept per pass before saturation. 100% is not exact freeze: use Hold for that.",
      feed: "Amount of demo or microphone input written into every overdubbing bowl. Does not change the volume of existing tape.",
      spill: "Amount of the previous bowl's playback written into each overdubbing bowl. Hold blocks incoming spill.",
    },
    presets: {
      "Gentle simmer": "Moderate retention with a small amount of spill and a fresh pluck.",
      "Thick broth": "Strong retention and spill accumulate more material.",
      "Quick rinse": "Old layers decay quickly while fresh input dominates.",
      "Listen to the pot": "Turns off new input and spill. To prevent all sample changes as well, Hold the bowls.",
    },
  },
  "habit-habitat": {
    start: "Switch to Teach and play nodes 1 → 4 → 2 → 1 several times. Switch to Recall and Play. Raise Follow learned routes to favor your path.",
    hear: "Each node has a fixed pitched tone. In Teach, only your gestures sound. In Recall, Play sends one travelling event through the learned transition probabilities.",
    mechanism: "Consecutive manual visits strengthen a directed route. Repeating the same node does not create a self-route. Recall uses a seeded weighted choice, not a fixed step sequence, and never learns from its own playback.",
    visual: "Node colors identify tones. Thicker arrows mean stronger learned transitions. The cream route is the latest transition. Routes have direction; weaken one with the Forget brush or the From/To controls.",
    limits: "Six fixed nodes, no recording, no movable topology, and no automatic analysis of a phrase. A high Follow value favors learned routes; it does not guarantee a single path.",
    memory: "Save memory stores only route strengths in this browser. Recall saved memory restores those weights, not phase or sound settings. Presets do not erase learning. Reset controls restores the seeded walk and Recall mode while keeping route strengths. Forget all routes leaves a small baseline on each non-self route.",
    keyboard: "Focus the stage. Left/right selects a node; Enter or 1–6 plays/teaches it. Use From/To and Weaken route for keyboard-accessible forgetting. Space toggles automatic Recall.",
    reset: "Controls and walk reset to Recall; learned routes, Play, and Audio retained.",
    controls: {
      tempo: "Rate of automatic visits in Recall. Teach ignores this clock.",
      follow: "0% treats outgoing routes equally; 100% uses only their learned relative weights.",
      learning: "Weight added by each manual transition in Teach. Recall never learns.",
      decay: "Length of each node's tone.",
    },
    presets: {
      "Remember the route": "A balanced bias toward whatever routes you have taught.",
      "Wander": "Mostly equal-probability choices, with softer, longer tones.",
      "Strong habits": "Faster recall governed by the learned weight ratios.",
      "Slow recollection": "Slower visits and longer tones make the route easier to follow.",
    },
  },
  hollowphonic: {
    start: "Enable Audio and Play the noise source. Drag one chamber down to deepen it. Compare Wall bypass, then choose Strike the wall and tap a chamber.",
    hear: "Noise or a drone passes through three resonating delay lines. The direct and resonated signals interfere. A strike excites those same chambers.",
    mechanism: "A deeper chamber has a longer delay and a lower nominal resonance. Wall damping removes stored energy. Coupling transfers energy around 1 → 2 → 3 → 1. This is a digital waveguide approximation, not a simulation of a particular building or material.",
    visual: "Chamber depth follows the resonator setting; moving lines show stored signal activity. Hz readouts describe nominal delay resonances, not detected pitches.",
    limits: "Three fixed resonators. No recorded loops, graph analysis, or conservation-budget display. Bypass compares the unfiltered source at the same output stage; it is not bit-perfect pass-through.",
    memory: "Play runs the continuous source. Pause stops that source but leaves decaying resonances and manual strikes available. Silent · strikes only needs taps, not Play. Microphone is silent until explicitly enabled. Reset restores depths and turns bypass off; no recordings are stored.",
    keyboard: "Focus the stage. Left/right selects a chamber; Enter or 1–3 strikes it. Up/down changes depth. Space toggles the continuous source.",
    reset: "Chambers and controls reset; bypass off, noise selected, Play and Audio retained.",
    controls: {
      depth: "Overall depth. Individual drags add an offset; deeper means lower resonance.",
      loss: "Higher damping shortens ringing and reduces high-frequency energy in the feedback.",
      coupling: "Transfers feedback energy between chambers rather than keeping it within each chamber.",
      mix: "0% compares the source alone; 100% uses the resonated/interference output. Wall bypass overrides this mix.",
    },
    presets: {
      "Breathing chambers": "Noise through moderately damped chambers.",
      "Glass hallway": "Higher resonances, less damping, and stronger coupling.",
      "Soft wood": "A continuous drone through deeper, heavily damped chambers.",
      "Strike the wall": "Continuous source is off. Tap a chamber or press Enter to hear it ring.",
    },
  },
});

export function formatParameter(id, control, value) {
  if (control.unit) return `${Number(value).toFixed(control.step >= 1 ? 0 : 2)}${control.unit}`;
  if (id === "tempo-tantrum" && control.key === "detune") return `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
  return `${Math.round(value * 100)}%`;
}

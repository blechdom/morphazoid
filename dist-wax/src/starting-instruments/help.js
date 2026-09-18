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
    start: "Enable Audio and Play the demo. The red circle in A records your microphone. M mutes, S solos, and the triangle/pause icon starts or pauses the loop. Add a loop, then use the bent-arrow icon and a destination letter to connect.",
    hear: "One reader plays a single tape at a time. At an enabled OUT gate it crossfades into the destination IN position. Each loop has its own output level and pan.",
    mechanism: "Routes have independent exit, entry, crossfade and enable settings. The earliest eligible exit wins. If exits coincide, the reader alternates them in stable order. Paused destination loops are skipped. With no eligible route the current tape loops locally.",
    visual: "Letters are persistent loop names and drag handles. Round OUT and IN buttons are editable route gates. Arrow labels select route controls. The cream dot is the reader. Moving a letter changes layout only, never tape timing or recorded samples.",
    limits: "One reader, up to eight loops and 24 directed routes. Capture is one microphone recording at a time, up to 12 seconds. No automatic phrase analysis or graph generation. Two routes with identical endpoints are not duplicated; no self routes.",
    memory: "The red circle captures a replacement take, retaining the old tape until the red stop square is pressed. Short takes keep the old recording. Pause inside that loop pauses its reader and capture. Global Pause stops playback but does not stop capture. M and S affect listening, not the reader's route. Audio Off finalizes capture and releases the mic. Added loops are empty and linked after the last loop. Removing a loop deletes only its audio and attached routes. Reloading loses unsaved recordings.",
    keyboard: "Tab to each loop's letter; arrow keys move it (Shift moves faster). Native center buttons control recording, pause, mute, solo and reader placement. Use From/To and Attach route for keyboard connections. On the scrollable workspace, 1–8 selects a loop and Enter moves the reader there. Space controls global Play.",
    reset: "Controls and all gate defaults reset; loops, layout, audio and topology retained.",
    controls: {
      speed: "Varispeed: 0.5× doubles duration and lowers pitch by one octave; 2× halves duration and raises pitch.",
      departure: "Sets the exit position of ALL existing routes. To edit only one route use its OUT gate or Route controls.",
      landing: "Sets the entry position of ALL existing routes. To edit only one route use its IN gate or Route controls.",
    },
    presets: {
      "Two phrases": "Original-speed default gate positions. Existing loops and routes remain intact.",
      "Tiny detours": "Shorter passages: applies exit 28% and entry 10% to all routes.",
      "Slow worm": "Slower, lower playback with longer gate passages on the existing network.",
      "Original loops": "Bypasses all head transfers. The current tape loops by itself; use the reader-to-start icon to move to another.",
    },
  },
  "loop-soup": {
    start: "Enable Audio and Play. Hold A using its grid-shaped hold icon, add empty loop D, then use the bent-arrow icon on A and click D to feed it. M mutes, S solos, and the red circle records. Select the route to adjust send level and tone.",
    hear: "Lettered loops play simultaneously. The demo signal or microphone can be written into loops in Write mode. Directed routes also write filtered audio from source loops into destinations.",
    mechanism: "Each route has its own send level, low-pass tone and enable switch. Route write level scales all routes. Hold stops writing without stopping playback. Pause stops the selected loop's playback and writing. Solo isolates monitoring without changing the network's feeds; Mute also closes outgoing sends. All feedback is softly saturated and bounded.",
    visual: "A, B, C… are stable labels, not renumbered when a loop is removed. Drag a letter to move its loop. The opaque disc contains compact play/pause, record, M and S controls. Hover for full labels. The line arrow points to the destination; its button opens Route controls. The dot is the loop's read/write position and the contour shows stored amplitude.",
    limits: "Up to eight loops, 24 routes, and one 12-second microphone capture at a time. Routes carry audio, not travelling heads. No automatic recording-to-graph analysis. No self routes or duplicate endpoint pairs.",
    memory: "Record in a loop's center captures a replacement of the duration you perform, then puts that loop in Hold. Write resumes overdubbing. Pause inside the recording loop pauses capture; Stop installs it. Global Pause stops loop playback and overdubbing, not capture. Audio Off finalizes capture and closes the mic, but running Write loops still evolve from demo/audio feeds. Hold protects samples exactly. Moving or editing routes never clears audio. Removing a loop deletes it and its routes. Reloading loses unsaved recordings.",
    keyboard: "Tab to a loop letter; arrow keys move it. All center controls are native keyboard buttons. From/To and Attach route connect without dragging. The selected-loop controls expose level and pan. Scroll the workspace to reach every loop. Escape cancels connecting or the erase brush.",
    reset: "Parameters reset; recordings, Hold states, transport, layout and routes retained.",
    controls: {
      retention: "Retained audio per overdub pass, before saturation. Use Hold, not 100% retention, for exact freeze.",
      feed: "Level of microphone/demo input written into every unpaused Write loop. Zero disables new input writing without muting the existing tapes.",
      spill: "Scales all route sends into Write loops. Individual routes also have send level and tone. Hold or Pause blocks writing to a destination.",
    },
    presets: {
      "A": "Moderate retention, low route level and demo input.",
      "B": "High retention and stronger audio exchange between connected loops.",
      "C": "Low retention: fresh input replaces old layers more quickly.",
      "D": "No fresh input or route writing. Use Hold as well to prevent all changes to the stored samples.",
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

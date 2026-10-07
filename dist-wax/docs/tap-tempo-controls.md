# Tap tempo controls

Tap the small **Tap** button twice or more beside a tempo or speed control.
The second contact sets the rate; further contacts average the last four
intervals. A pause starts a new series. The slider/knob, its bounds, its
readout, preset handling, Audio, transport and output level retain their
existing ownership. Tapping changes only the selected rate.

BPM controls use one beat per tap. Cycle, step, rotation and travel controls
use one cycle, step, turn or displayed distance unit per tap. Direction is
preserved for signed rotation. Duration controls use the interval between taps.
Lattice density, curved sliders and dependent breath-rate controls are converted
through their existing physical scales. Values clamp to the existing range.

For tape/file/gesture playback and simulation time multipliers without a BPM,
**120 BPM = normal 1×**. Slower tapping slows playback; faster tapping speeds it
up. Their button tooltip states the reference. Acoustic Manifold retains its
logarithmic speed scale; the L-Systems timing multiplier retains its inverse
duration scale. This reference does not analyze beats in a recording.

## Test list

The buttons also follow controls rebuilt by dimensions, modes, voice selection
and preset UI. Rubixoids includes its shared clock and the active embedded
instrument. Some advanced controls appear only in their relevant mode.

| Instrument | Tap controls |
| --- | --- |
| [Acoustic Manifold](../acoustic-manifold.html) | `#gesture-speed` |
| [Mazes](../algorithmic-mazes.html) | `#speed` |
| [Algorithmic Sequencers](../algorithmic-sequencers.html) | `#tempo` |
| [Atomic Orbitals](../atomic-orbitals.html) | `#orbitalRate` |
| [Automatapoeia](../automatapoeia.html) | `#caRate` |
| [Boidzoid](../boidzoid.html) | `#speed` |
| [Candy Coil Delay](../candy-coil-delay.html) | `#speed` |
| [Charge Garden](../charge-garden.html) | `#physics-timeScale` |
| [Crab Loom · Morphazoid](../crab-loom.html) | `#speed` |
| [Creaturazoid · Morphazoid](../creaturazoid.html) | `#tempo` |
| [Digestazoid · Morphazoid](../digestazoid.html) | `#peristalsisRate` |
| [DJ Dijkstra](../dijkstra.html) | `#tempo` |
| [DNA Translator](../dna-translator.html) | `#dnaRate` |
| [Domino Run](../domino-run.html) | `#speed` |
| [Double Pendulum](../double-pendulum.html) | `#chaosSpeed` |
| [Drum Roll Please!](../drum-roll-please.html) | `#centerRate`, `#driftRate` |
| [Entanglement Dance](../entanglement-dance.html) | `#tempo` |
| [Escape Dust](../escape-dust.html) | `#stepRate` |
| [Escher](../escher-tessellation.html) | `#travelSpeed` |
| [Euclidean Pulse](../euclid.html) | `#tempo` |
| [Falling Forms](../falling-forms.html) | `#physics-timeScale` |
| [Fourier Epicycles](../fourier-epicycles.html) | `#fourierRate` |
| [Fractal Synthesis](../fractal-synthesis.html) | `#motionAngleTempo`, `#motionBranchTempo`, `#motionIndexTempo`, `#motionRootTempo`, `#motionScanTempo`, `#motionTurnsTempo`, `#rate` |
| [Gear Ratio Drums](../gear-ratio-drums.html) | `#gearSpeed` |
| [Geodesic Drift](../geodesic-drift.html) | `#physics-speed`, `#physics-timeScale` |
| [Gesticules](../gesticules.html) | `#tempo` |
| [3D Graph · Morphazoid](../graph-3d.html) | `#tempo` |
| [graph delay](../graph-delay.html) | `#micMotionSpeed`, `#nodeMotionSpeed` |
| [Graph Drum Machine](../graph-drum-machine.html) | `#nodeMotionSpeed`, `#tempo` |
| [Graph Synth](../graph-synth.html) | `#nodeMotionSpeed`, `#tempo` |
| [Graphs](../graphs.html) | `#nodeMotionSpeed`, `#tempo` |
| [Gravity Lens](../gravity-lens.html) | `#lensRate` |
| [Gravity Walk](../gravity-walk.html) | `#physics-timeScale` |
| [Habit Habitat · Morphazoid](../habit-habitat.html) | `#tempo` |
| [Hanoi Carillon](../hanoi.html) | `#tempo` |
| [Harmonicazoid · Morphazoid](../harmonica.html) | `#breathRateBpm` |
| [Head Shed · Morphazoid](../head-shed.html) | `#speed` |
| [Hiccup Head · Morphazoid](../hiccup-head.html) | `#tempo` |
| [Hocket Luigi · Morphazoid](../hocket-loom.html) | `#tempoBpm` |
| [Hybrinx · Morphazoid](../hybrinx.html) | `#gestureRate` |
| [Hyper Drum Machine](../hyper-drum-machine.html) | `#rotationXWSpeed`, `#rotationYWSpeed`, `#rotationZWSpeed`, `#speed` |
| [Hyper Rubix](../hyper-rubix.html) | `#rotationSpeed`, `#tempo` |
| [Hyper](../hyper-synth.html) | `#rotationXWSpeed`, `#rotationYWSpeed`, `#rotationZWSpeed`, `#speed` |
| [Jaw Harp · Morphazoid](../jaw-harp.html) | `#breathRateBpm`, `#repeatRateBpm` |
| [Jaw Jam · Morphazoid](../jaw-jam.html) | `#stepRate`, `#tempo` |
| [Julia](../julia.html) | `#speed` |
| [Julie Saw · Morphazoid](../julie-saw.html) | `#tempoBpm` |
| [Kinetic Hull](../kinetic-hull.html) | `#physics-speed`, `#physics-timeScale` |
| [Klein Bottle](../klein-bottle-synth.html) | `#rotationSpeed`, `#speed` |
| [L-system Delay](../l-mic.html) | `#interval` |
| [L-System](../l-system.html) | `#speed` |
| [L-System Drum Machine](../l-system-drum-machine.html) | `#speed` |
| [L-Systems](../l-systems.html) | `#micInterval`, `#micIntervalMs`, `#speed` |
| [Lattice](../lattice.html) | `#speed` |
| [Lattice Drum Machine](../lattice-drum-machine.html) | `#speed` |
| [Rattlesnake](../linear-drums.html) | `#sweepRate`, `#sweepSpeed` |
| [Linebreaker](../linebreaker.html) | `#scanRate` |
| [Lissajous Orbits](../lissajous-orbits.html) | `#lissajousRate` |
| [Loopini · Morphazoid](../loopini.html) | `#speed` |
| [Lumber Loops](../lumber.html) | `#delayRotationSpeed` |
| [Alpha-Beta Minimax](../minimax.html) | `#tempo` |
| [Möbius](../moebius-synth.html) | `#rotationSpeed`, `#speed` |
| [Fabric Filter](../moire-drone.html) | `#propagationSpeed` |
| [Monstroid](../monstroid.html) | `#tempo` |
| [Morphynx](../morphynx.html) | `#gestureRate` |
| [Mouthophones · Morphazoid](../mouthophones.html) | `#breathRateBpm`, `#gestureRateBpm` |
| [Neural Pulse](../neural-pulse.html) | `#neuralRate` |
| [N-Queens Backtracker](../nqueens.html) | `#tempo` |
| [Onset Atlas · Morphazoid](../onset-atlas.html) | `#speed` |
| [Feral Fairy Ferris Ferry](../orbital-ferris.html) | `#orbitalRate` |
| [Ouroboros](../ouroboros.html) | `#glissRate`, `#hitRate` |
| [Ouroboros Borealis](../ouroboros-borealis.html) | `#centerRate`, `#pitchGlissRate`, `#rhythmGlissRate` |
| [Ouroborousel](../ouroborousel.html) | `#centerRate`, `#glissRate` |
| [Ourorourobouroboros](../ourorourobouroboros.html) | `#centerRate`, `#glissRate` |
| [Packing Pressure](../packing-pressure.html) | `#physics-timeScale` |
| [Paths](../paths.html) | `#speed` |
| [Penrose Tilings](../penrose-tilings.html) | `#speed` |
| [Pink Trombonazoid · Morphazoid](../pink-trombonazoid.html) | `#speechRate` |
| [Playhead Paint](../playhead-paint.html) | `#playbackRate`, `#steadySpeed` |
| [Prime Sieve](../prime-sieve.html) | `#primeRate` |
| [Puggler the Punk Rock Jugger · Morphazoid](../puggler.html) | `#rideSpeed`, `#tempo` |
| [Quadruped · Morphazoid](../quadruped.html) | `#tempo` |
| [Rattlesnake Skin](../rattlesnake-skin.html) | `#glissRate`, `#tempo` |
| [Reaction-Diffusion](../reaction-diffusion.html) | `#reactionSpeed` |
| [Ricochet](../ricochet.html) | `#physics-rotationSpeed`, `#physics-timeScale` |
| [Rigidity](../rigidity.html) | `#physics-timeScale` |
| [Roach Synth](../roach-synth.html) | `#tempo` |
| [Rolling Measure](../rolling-measure.html) | `#physics-timeScale` |
| [Rubix Cube Sequencer](../rubix.html) | `#randomTwistSpeed`, `#tempo` |
| [Rubixoids](../rubixoids.html) | `#tempo` |
| [Sandy Syrup Delay](../sandy-syrup-delay.html) | `#speed` |
| [Shape Drum Machine](../shape-drum-machine.html) | `#rotationSpeed`, `#speed` |
| [Shape](../shape-synth.html) | `#rotationSpeed`, `#speed` |
| [Shapes](../shapes.html) | `#speed`, `[data-rotation-target="rotationMotion.readerPitch.speed"]`, `[data-rotation-target="rotationMotion.readerYaw.speed"]`, `[data-rotation-target="rotationMotion.x.speed"]`, `[data-rotation-target="rotationMotion.xw.speed"]`, `[data-rotation-target="rotationMotion.y.speed"]`, `[data-rotation-target="rotationMotion.yw.speed"]`, `[data-rotation-target="rotationMotion.z.speed"]`, `[data-rotation-target="rotationMotion.zw.speed"]`, `[data-rotation-target="rotationSpeed"]` |
| [Shepard–Risset](../shepard-risset.html) | `#speed`, `#sweepSpeed` |
| [SIMD 303](../simd-303.html) | `#timeScale`, `[role="slider"][data-param-key="timeScale"]` |
| [SIMD Chiptune](../simd-chiptune.html) | `#tempo`, `[role="slider"][data-param-key="tempo"]` |
| [SIMD Synth](../simd-synth.html) | `#bpm` |
| [Sliding Puzzle](../sliding-puzzle.html) | `#autoSlideSpeed`, `#tempo` |
| [Slippery Resynthesis](../slippery-resynthesis.html) | `#slipRate` |
| [Solid Drum Machine](../solid-drum-machine.html) | `#planePitchSpeed`, `#planeYawSpeed`, `#rotationXSpeed`, `#rotationYSpeed`, `#rotationZSpeed`, `#speed` |
| [Solid](../solid-synth.html) | `#planePitchSpeed`, `#planeYawSpeed`, `#rotationXSpeed`, `#rotationYSpeed`, `#rotationZSpeed`, `#speed` |
| [Spelling Synthesizer](../spelling-synthesizer.html) | `#readbackSpeed` |
| [Spider Synth](../spider-synth.html) | `#tempo`, `#travelSpeed` |
| [Spiral](../spiral.html) | `#loopSpeed`, `#speed` |
| [Spiral Drum Machine](../spiral-drum-machine.html) | `#loopSpeed`, `#speed` |
| [Splice Ring · Morphazoid](../splice-ring.html) | `#speed` |
| [srtuss WebGPU synth](../srtuss.html) | `#selectedVoiceRate` |
| [Striped Staircase](../striped-staircase.html) | `#speed` |
| [Surround for Safety](../surround-field.html) | `#orbitRate` |
| [Synaptic Resonance · Morphazoid](../synaptic-resonance.html) | `#rate` |
| [Synthesaurus](../synthesis.html) | `#tempo` |
| [Syrinx](../syrinx.html) | `#gestureRate` |
| [Syrinx UI · Morphazoid](../syrinx-ui.html) | `#gestureRate` |
| [Tape Worm · Morphazoid](../tape-worm.html) | `#speed` |
| [Tempo Tantrum · Morphazoid](../tempo-tantrum.html) | `#tempo` |
| [Tesselation](../tesselation.html) | `#speed` |
| [Throat Singing · Morphazoid](../throat-singing.html) | `#pulseRate` |
| [Tongued Beasts · Morphazoid](../tongued-beasts.html) | `#gestureRate` |
| [Vocalzoid](../vocalzoid.html) | `#bpm` |
| [Volumetric Rain](../wasm-garden.html) | `#rate` |
| [Wave Pool · Morphazoid](../wave-pool.html) | `#tempoBpm` |
| [WebGPU 303](../webgpu-303.html) | `#timeScale`, `[role="slider"][data-param-key="timeScale"]` |
| [WebGPU Chiptune](../webgpu-chiptune.html) | `#tempo`, `[role="slider"][data-param-key="tempo"]` |
| [Yoyodyne](../yoyodyne.html) | `#tempo` |

## Shared implementation

`createTapTempoButton()` from `src/ui/index.js` is a native momentary button.
Pass `onTempo(bpm)` to an instrument-owned setter. It does not create audio or
start transport. `mountTapTempoControl()` preserves an existing range and emits
its native `input` and `change` events. Custom Chiptune/303 ARIA knobs expose a
small owner setter through their existing parameter-update path.

`src/site/tap-tempo-targets.js` records explicit selectors and units. The global
navigation installer handles late/rebuilt controls, removes listeners and timers
when controls disappear, and initializes Rubixoids shadow views. A future native
control can opt in with `data-tap-tempo="bpm"` (or `hz`, `seconds`,
`milliseconds`) on a registered route, or call the mounting adapter directly.

`tap-tempo-controls.json` records reviewed source mappings and exclusions.
Independent synthesis oscillator/noise clocks, intensity, pitch intervals,
probabilities, bow force and wheel spin force are outside the tempo contract.
Candy Coil Delay's existing Tap range action retains its separate delay-span
behavior.

Run `node --test tests/tap-tempo.test.mjs` and
`npx playwright test e2e/tap-tempo.spec.mjs`. The browser checks include real
pointer/keyboard contacts, live audio-engine timing and continuity, phone
portrait/landscape, preset Custom state, signed rotation, replacement cleanup
and active shadow views. Listening and physical touch-device feel remain a
manual check.

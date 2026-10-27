# Browser MIDI master-level audit — 2026-10-25

## Result

**162 of 175 universal-control instrument routes** changed a master/output range
control in a Chromium browser probe: **137** for both channel/poly aftertouch and
CC11 expression, **25** for CC11 only. This is not a Note On velocity mapping in
those cases: controllers that emit pressure alongside notes can make it feel
like velocity is driving the master knob.

Synthesaurus and Rezoidinator reproduced the same problem before this pass; the
175-route probe ran **after their targeted fixes**, so they are in the no-master-
change group below, not the 162. Quadruped was then explicitly added to the targeted fixes: its pre-fix
observation remains in the table, and a separate fake-hardware regression now
checks the fix. Fractal Synthesis was subsequently fixed after a reported
key-release volume drop: plain Note Off preserved master in reproduction, but
zero channel/poly pressure and CC11 each set it to zero. Its page now consumes
those unsupported expression messages without changing the autonomous score or
master. **160 of the originally affected routes remain unchanged.**

## Method and boundaries

- Source baseline: `c3e96375` plus this pass's targeted changes.
- Enumerated catalogue/navigation routes whose capability uses the shared
  `universal-control` browser MIDI adapter; 175 routes loaded without page errors.
- Audio remained off. After initialization, called the real
  `applyBrowserMidiMessage()` with the route's declared support, allowing its
  cancelable page-owned listener to run **before** generic fallback.
- Probed channel pressure 19, poly pressure 102 on note 60, and CC11 value 51,
  channel 0, with no controller-profile macro override. Recorded native range
  values before/after each message and identified master/output controls by
  their ID, label and toolbar location.
- This proves browser control mutation, not audible gain, physical-controller
  behavior, all presets/modes, or every asynchronous startup condition. It does
  not evaluate outgoing MIDI, MIDI Learn, WAX, or native MIDI clients. No-master-
  change is **not** a certification that an instrument's MIDI implementation is
  complete or correct.
- Synthesaurus/Rezoidinator/Quadruped/Fractal Synthesis additionally have fake-hardware Web MIDI regression
  tests exercising the shared manager, plus actual worklet/PCM checks for the
  synthesis voice changes. No physical-device or human-listening pass performed.

## Why it happens

`src/browser-midi-adapter.js` uses these fallback search terms:

- CC11: `expression`, then `output`, then `level`.
- Channel/poly pressure: `pressure`, `intensity`, `force`, then `level`.

Without exact page ownership, a master knob is a valid match. Many breath/force
instruments have a more specific pressure destination, but CC11 still reaches
master output. **CC7 is different:** it intentionally means master volume.

A follow-up shared fix should prevent CC11/aftertouch from selecting master
output controls; per-note, per-strike or continuous-excitation expression must
then be owned by the appropriate instrument. Do not globally reinterpret every
processor as a pitched synthesizer, cut resonator tails on Note Off, or remove
explicit CC7/profile-macro control.

## Aftertouch AND CC11 move master/output (137)

| Instrument | Route | Master control |
| --- | --- | --- |
| Solid | `solid-synth.html` | `level` |
| Hyper | `hyper-synth.html` | `level` |
| Blobs | `blobs.html` | `level` |
| Graph Synth | `graph-synth.html` | `output` |
| Shape Drum Machine | `shape-drum-machine.html` | `output` |
| Solid Drum Machine | `solid-drum-machine.html` | `output` |
| Hyper Drum Machine | `hyper-drum-machine.html` | `output` |
| Graph Drum Machine | `graph-drum-machine.html` | `output` |
| Shapes | `shapes.html` | `level` |
| Rubixoids | `rubixoids.html` | `output` |
| L-Systems | `l-systems.html` | `level` |
| Graphs | `graphs.html` | `output` |
| Tesselation | `tesselation.html` | `level` |
| Trackazoid | `trackazoid.html` | `level` |
| Lattice | `lattice.html` | `level` |
| Spiral | `spiral.html` | `level` |
| Lattice Drum Machine | `lattice-drum-machine.html` | `output` |
| Spiral Drum Machine | `spiral-drum-machine.html` | `output` |
| Fractal Synthesis **(subsequently fixed)** | `fractal-synthesis.html` | `level` |
| L-System Drum Machine | `l-system-drum-machine.html` | `output` |
| L-System | `l-system.html` | `level` |
| Julia | `julia.html` | `level` |
| Striped Staircase | `striped-staircase.html` | `level` |
| Rattlesnake Skin | `rattlesnake-skin.html` | `output` |
| Rattlesnake | `linear-drums.html` | `output` |
| Karplus Strong | `karplus-strong.html` | `level` |
| Karplus Carpet | `karplus-carpet.html` | `level` |
| Dentaphone | `dentaphone.html` | `level` |
| Rubix Cube Sequencer | `rubix.html` | `output` |
| Sliding Puzzle | `sliding-puzzle.html` | `output` |
| Hocket Luigi | `hocket-loom.html` | `level` |
| Jaw Jam | `jaw-jam.html` | `level` |
| Hyper Rubix | `hyper-rubix.html` | `output` |
| WebGPU 303 | `webgpu-303.html` | `output` |
| Enveloper | `enveloper.html` | `level` |
| GPU Shader Synths | `webgpu-synths.html` | `output` |
| WebGPU Chiptune | `webgpu-chiptune.html` | `output` |
| srtuss Master | `srtuss.html` | `output` |
| Modular Shader Synth | `shader-synth-playground.html` | `output` |
| SIMD 303 | `simd-303.html` | `output` |
| SIMD Chiptune | `simd-chiptune.html` | `output` |
| SIMD Synth | `simd-synth.html` | `outputLevel` |
| SIMD Resonator | `simd-resonator.html` | `outputLevel` |
| Quadruped **(subsequently fixed)** | `quadruped.html` | `level` |
| Voicesaurus | `voicesaurus.html` | `level` |
| Spelling Synthesizer | `spelling-synthesizer.html` | `level` |
| Vocalzoid | `vocalzoid.html` | `level` |
| Lumber Loops | `lumber.html` | `level` |
| L-system Delay | `l-mic.html` | `level` |
| L-system Delay Rust | `l-mic-rust.html` | `level` |
| Graph Delay | `graph-delay.html` | `level` |
| Graph Delay Rust | `graph-delay-rust.html` | `level` |
| Shepard–Risset | `shepard-risset.html` | `level` |
| Drum Roll Please! | `drum-roll-please.html` | `level` |
| Slippery Resynthesis | `slippery-resynthesis.html` | `outputLevel` |
| Ouroborousel | `ouroborousel.html` | `level` |
| Ourorourobouroboros | `ourorourobouroboros.html` | `level` |
| Ouroboros | `ouroboros.html` | `level` |
| Ouroboros Borealis | `ouroboros-borealis.html` | `level` |
| Sandy Syrup Delay | `sandy-syrup-delay.html` | `outputLevel` |
| Candy Coil Delay | `candy-coil-delay.html` | `outputLevel` |
| Bifurcator | `bifurcator.html` | `level` |
| Cascading FM | `cascading-fm.html` | `level` |
| Cascading PM | `cascading-pm.html` | `level` |
| Cascading AM | `cascading-am.html` | `level` |
| Weierstrass | `weierstrass.html` | `output` |
| Fabric Filter | `moire-drone.html` | `outputLevel` |
| Puggler the Punk Rock Jugger | `puggler.html` | `level` |
| Gesticules | `gesticules.html` | `outputLevel` |
| Surround for Safety | `surround-field.html` | `level` |
| SPARTIAL | `spartial.html` | `level` |
| Automatapoeia | `automatapoeia.html` | `level` |
| Sorting | `algorithmic-sequencers.html` | `output` |
| Graphonic Calculator | `graphonic-calculator.html` | `level` |
| Witch | `witch.html` | `outputLevel` |
| Wobblini | `wobblini.html` | `level` |
| Staircase Studies | `striped-staircase-rust.html` | `level` |
| Vector Fractals | `vector-fractals.html` | `level` |
| Möbius | `moebius-synth.html` | `level` |
| Klein Bottle | `klein-bottle-synth.html` | `level` |
| Mazes | `algorithmic-mazes.html` | `level` |
| Paths | `paths.html` | `level` |
| Micromorph | `micromorph.html` | `outputLevel` |
| Playhead Paint | `playhead-paint.html` | `output` |
| Boidzoid | `boidzoid.html` | `level` |
| Gesturama | `gesturama.html` | `output` |
| Vector Flight | `vector-flight.html` | `level` |
| Wheel of Organs | `image-to-instrument-3.html` | `level` |
| Feral Fairy Ferris Ferry | `orbital-ferris.html` | `level` |
| Penrose Tilings | `penrose-tilings.html` | `level` |
| Yoyodyne | `yoyodyne.html` | `outputLevel` |
| Escher | `escher-tessellation.html` | `level` |
| Order Tones | `order-tones.html` | `level` |
| Bell Square | `bell-square.html` | `level` |
| Entanglement Dance | `entanglement-dance.html` | `level` |
| Annealogue | `annealogue.html` | `output` |
| Quantum Square Dance | `quantum-square-dance.html` | `level` |
| Ricochet | `ricochet.html` | `level` |
| Rigidity | `rigidity.html` | `level` |
| Gravity Walk | `gravity-walk.html` | `level` |
| Rolling Measure | `rolling-measure.html` | `level` |
| Falling Forms | `falling-forms.html` | `level` |
| Domino Run | `domino-run.html` | `level` |
| Charge Garden | `charge-garden.html` | `level` |
| Packing Pressure | `packing-pressure.html` | `level` |
| Geodesic Drift | `geodesic-drift.html` | `level` |
| Kinetic Hull | `kinetic-hull.html` | `level` |
| RISSET-MOIRE | `moire-organ.html` | `level` |
| Spring Choir | `spring-choir.html` | `level` |
| Gear Ratio Drums | `gear-ratio-drums.html` | `level` |
| Chladni Plate | `chladni-plate.html` | `level` |
| Prime Sieve | `prime-sieve.html` | `level` |
| Lissajous Orbits | `lissajous-orbits.html` | `level` |
| Pendulum Wave | `pendulum-wave.html` | `level` |
| Double Pendulum | `double-pendulum.html` | `level` |
| Reaction-Diffusion | `reaction-diffusion.html` | `level` |
| Atomic Orbitals | `atomic-orbitals.html` | `level` |
| DNA Translator | `dna-translator.html` | `level` |
| Fourier Epicycles | `fourier-epicycles.html` | `level` |
| Neural Pulse | `neural-pulse.html` | `level` |
| Gravity Lens | `gravity-lens.html` | `level` |
| Cantor Lock | `cantor-lock.html` | `level` |
| Escape Dust | `escape-dust.html` | `level` |
| Linebreaker | `linebreaker.html` | `level` |
| L-system Parametric Lab | `l-system-parametric-lab.html` | `level` |
| L-system Experiments | `l-system-experiments.html` | `level` |
| Fractal Delay | `fractal-delay.html` | `outputLevel` |
| Tempo Tantrum | `tempo-tantrum.html` | `level` |
| Tape Worm | `tape-worm.html` | `level` |
| Time Loom | `time-loom.html` | `level` |
| Loop Soup | `loop-soup.html` | `level` |
| Habit Habitat | `habit-habitat.html` | `level` |
| Hollowphonic | `hollowphonic.html` | `level` |
| 3D Graph | `graph-3d.html` | `level` |
| Tapezoid | `tapezoid.html` | `outputLevel` |
| Globule Damacy | `globule-damacy.html` | `output` |
| Loopini | `loopini.html` | `level` |

## CC11 moves master/output; aftertouch does not in this probe (25)

| Instrument | Route | Observed pressure destination |
| --- | --- | --- |
| Throatazoid | `throatazoid.html` | pressureSourceCount |
| Pink Trombonazoid | `pink-trombonazoid.html` | segmentIntensity |
| Throat Singer | `throat-singing.html` | sourcePressure |
| Monstroid | `monstroid.html` | Breath pressure depth |
| Jaw Harp | `jaw-harp.html` | pluckForce |
| Julie Saw | `julie-saw.html` | bowPressure |
| Hiccup Head | `hiccup-head.html` | lungPressure |
| Syrinx | `syrinx.html` | pressure |
| Tongued Beasts | `tongued-beasts.html` | Pressure modulation speed |
| Hybrinx | `hybrinx.html` | pressure |
| Creaturazoid | `creaturazoid.html` | pressure |
| Blowhole | `blowhole.html` | valveAperture |
| Digestazoid | `digestazoid.html` | gas |
| DJ Dijkstra | `dijkstra.html` | intensity |
| Mouthophones | `mouthophones.html` | breathPressure |
| Recursion | `recursion.html` | intensity |
| Wave Pool | `wave-pool.html` | paddleForce |
| Hanoi Carillon | `hanoi.html` | intensity |
| Alpha-Beta Minimax | `minimax.html` | intensity |
| N-Queens Backtracker | `nqueens.html` | intensity |
| Euclidean Pulse | `euclid.html` | intensity |
| Hyper-Syrinx | `hyper-syrinx.html` | Elephant Bellows lung pressure |
| Alien Larynx | `alien-larynx.html` | larynxFeedback |
| Morphynx | `morphynx.html` | pressure |
| Plasma Ball | `plasma-ball.html` | motion |

## No master/output movement observed (13)

- **Fixed in this pass:** Synthesaurus, Rezoidinator.
- Harmonica: pressure changed breath-attack time; CC11 changed breath pressure.
  The pressure mapping deserves its own review even though master was unchanged.
- Head Shed: all three messages changed `headLevel`, a head-level control, not
  the main master/output control. This is a separate possible mapping concern.
- Roach Synth, Spider Synth, Crab Loom, Freeze Point, Scatter Ghost, Exceptional,
  Splice Ring, Onset Atlas, Synaptic Resonance: no native range change observed.

Native-input and MIDI-disabled routes were excluded, not declared unaffected.

## Verification for this pass

- Three-instrument MIDI/gesture browser suite: 11 passed. Additional preservation,
  rearming and responsive checks: 24 passed (some MIDI cases overlap).
- Focused input-state and actual WASM/PCM checks passed, including pressure
  smoothing without ADSR retrigger, independent owners, 128-owner updates,
  release and return from an audition to the held note's expression.
- `npm run verify`: source checks passed; Node run reported 8,966 passed,
  2 failed, 6 skipped. Both failures were subsequently fixed and rerun:
  the exact Quadruped feature-amendment guard (20-test file passed) and the
  post-calibration WASM provenance manifest (check passed). No frozen baseline
  hashes were replaced. The end-to-end command was not repeated after those
  metadata-only corrections; `check:xyflow` and `check:wax-dist` passed separately.
- The shared browser MIDI suite passed its two input-path tests. Its inventory
  test has a pre-existing 186-versus-187 mismatch: the MIDI-disabled `blech-midi`
  capability is excluded by that test's route filter. The test, capability,
  catalogue and registry files are unchanged from the fresh-main base.
- Regenerated calibration retained all 94 factory source trims; output-gain
  differences were below 1e-15. All twelve demo-loop WAV hashes were unchanged.

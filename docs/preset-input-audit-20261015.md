# Preset row and mic-input audit (2026-10-15)

Base: origin/main eaa70f1c. Method: headless Chromium loaded all 188 catalogue pages and looked for the shared `.header-preset-controls` row (menu + next + dice), `input[type=file]`, `Input source` selects and sample options; cross-checked against a static import crawl. Static `registerHeaderPresets` hits are NOT trusted alone (e.g. `experiments-app.js` only registers for the `automata` experiment).

**57 of 188 entries have the preset/next/dice row; 131 do not.**

## A. Missing preset + next + dice

| Name | id | type | group | mic |
|---|---|---|---|---|
| Shape Drum Machine | `shape-drum-machine` | instrument | main |  |
| Solid Drum Machine | `solid-drum-machine` | instrument | main |  |
| Hyper Drum Machine | `hyper-drum-machine` | instrument | main |  |
| Graph Drum Machine | `graph-drum-machine` | instrument | main |  |
| Rubixoids | `rubixoids` | instrument | main |  |
| Graphs | `graphs` | instrument | main | mic |
| Tesselation | `tesselation` | instrument | main |  |
| Trackazoid | `trackazoid` | instrument | main |  |
| Spiral | `spiral` | instrument | main |  |
| Lattice Drum Machine | `lattice-drum-machine` | instrument | main |  |
| Spiral Drum Machine | `spiral-drum-machine` | instrument | main |  |
| L-System Drum Machine | `l-system-drum-machine` | instrument | main |  |
| Julia | `julia` | instrument | main |  |
| Striped Staircase | `striped-staircase` | instrument | main |  |
| Rattlesnake Skin | `rattlesnake-skin` | instrument | main |  |
| FM Drums | `fm-drums` | instrument | main |  |
| Rattlesnake | `linear-drums` | instrument | main |  |
| Sample Drums | `sample-drums` | instrument | main |  |
| Dentaphone | `object-forge` | instrument | main |  |
| Sliding Puzzle | `sliding-puzzle` | instrument | main |  |
| Hocket Luigi | `hocket-loom` | instrument | main |  |
| Jaw Jam | `jaw-jam` | instrument | main |  |
| Enveloper | `enveloper` | instrument | main |  |
| WebGPU 303 | `webgpu-303` | instrument | main |  |
| WebGPU Chiptune | `webgpu-chiptune` | instrument | main |  |
| GPU Shader Synths | `webgpu-synths` | instrument | main |  |
| srtuss Master | `srtuss` | instrument | main |  |
| Modular Shader Synth | `shader-synth-playground` | instrument | main |  |
| SIMD 303 | `simd-303` | instrument | main |  |
| SIMD Chiptune | `simd-chiptune` | instrument | main |  |
| SIMD Synth | `simd-synth` | instrument | main |  |
| Throatazoid | `throatazoid` | instrument | main | mic |
| Pink Trombonazoid | `pink-trombonazoid` | instrument | main |  |
| Throat Singing | `throat-singing` | instrument | main |  |
| Monstroid | `monstroid` | instrument | main |  |
| Harmonicazoid | `harmonica` | instrument | main |  |
| Julie Saw | `julie-saw` | instrument | main |  |
| Syrinx | `syrinx` | instrument | main |  |
| Tongued Beasts | `tongued-beasts` | instrument | main |  |
| Blowhole | `blowhole` | instrument | main |  |
| Digestazoid | `digestazoid` | instrument | main |  |
| Crickets | `crickets` | lab | main |  |
| Vocalzoid | `vocalzoid` | instrument | main |  |
| Lumber Loops | `lumber` | instrument | main | mic |
| Shepard–Risset | `shepard-risset` | instrument | main |  |
| Drum Roll Please! | `drum-roll-please` | instrument | main |  |
| Ouroborousel | `ouroborousel` | instrument | main |  |
| Ourorourobouroboros | `ourorourobouroboros` | instrument | main |  |
| Ouroboros | `ouroboros` | instrument | main |  |
| Ouroboros Borealis | `ouroboros-borealis` | instrument | main |  |
| Chaotic FM | `chaotic-fm` | instrument | main |  |
| Chaotic PM | `chaotic-pm` | instrument | main |  |
| Weierstrass | `weierstrass` | instrument | main |  |
| BLECH MIDI | `blech-midi` | lab | main |  |
| Surround for Safety | `surround-field` | instrument | main |  |
| SPARTIAL | `spartial` | instrument | main |  |
| Sorting | `sorting-algorithms` | instrument | main |  |
| Staircase Studies | `striped-staircase-rust` | instrument | WIP |  |
| Möbius | `moebius-synth` | instrument | WIP |  |
| Klein Bottle | `klein-bottle-synth` | instrument | WIP |  |
| Mazes | `algorithmic-mazes` | instrument | WIP |  |
| Paths | `paths` | instrument | WIP |  |
| Mouthophones | `breath-atlas` | instrument | WIP |  |
| Micromorph | `micromorph` | instrument | WIP | mic |
| Recursion | `recursion` | instrument | WIP | mic |
| Playhead Paint | `playhead-paint` | instrument | WIP |  |
| Boidzoid | `boidzoid` | instrument | WIP |  |
| Vector Flight | `vector-flight` | instrument | WIP |  |
| Gesturama | `gesturama` | instrument | WIP | mic |
| Wheel of Organs | `image-to-instrument-3` | instrument | WIP |  |
| Feral Fairy Ferris Ferry | `orbital-ferris` | instrument | WIP |  |
| Wave Pool | `wave-pool` | instrument | WIP |  |
| Penrose Tilings | `penrose-tilings` | instrument | WIP |  |
| Yoyodyne | `yoyodyne` | instrument | WIP |  |
| Alien Larynx | `alien-larynx` | instrument | WIP | mic |
| Hyper-Syrinx | `hyper-syrinx` | instrument | WIP |  |
| Morphynx | `morphynx` | instrument | WIP | mic |
| Escher | `escher-tessellation` | instrument | WIP |  |
| Plasma Ball | `plasma-ball` | instrument | WIP |  |
| Order Tones | `order-tones` | instrument | WIP |  |
| Bell Square | `bell-square` | instrument | WIP |  |
| Entanglement Dance | `entanglement-dance` | instrument | WIP |  |
| Quantum Square Dance | `quantum-square-dance` | instrument | WIP |  |
| Annealogue | `annealogue` | instrument | WIP |  |
| Gravity Walk | `gravity-walk` | instrument | WIP |  |
| Ricochet | `ricochet` | instrument | WIP |  |
| Rigidity | `rigidity` | instrument | WIP |  |
| Rolling Measure | `rolling-measure` | instrument | WIP |  |
| Falling Forms | `falling-forms` | instrument | WIP |  |
| Charge Garden | `charge-garden` | instrument | WIP |  |
| Packing Pressure | `packing-pressure` | instrument | WIP |  |
| Geodesic Drift | `geodesic-drift` | instrument | WIP |  |
| Kinetic Hull | `kinetic-hull` | instrument | WIP |  |
| RISSET-MOIRE | `moire-organ` | instrument | WIP |  |
| Chladni Plate | `chladni-plate` | instrument | WIP |  |
| Spring Choir | `spring-choir` | instrument | WIP |  |
| Gear Ratio Drums | `gear-ratio-drums` | instrument | WIP |  |
| Prime Sieve | `prime-sieve` | instrument | WIP |  |
| Lissajous Orbits | `lissajous-orbits` | instrument | WIP |  |
| Pendulum Wave | `pendulum-wave` | instrument | WIP |  |
| Double Pendulum | `double-pendulum` | instrument | WIP |  |
| Reaction-Diffusion | `reaction-diffusion` | instrument | WIP |  |
| Atomic Orbitals | `atomic-orbitals` | instrument | WIP |  |
| DNA Translator | `dna-translator` | instrument | WIP |  |
| Neural Pulse | `neural-pulse` | instrument | WIP |  |
| Fourier Epicycles | `fourier-epicycles` | instrument | WIP |  |
| Gravity Lens | `gravity-lens` | instrument | WIP |  |
| Cantor Lock | `cantor-lock` | instrument | WIP |  |
| Escape Dust | `escape-dust` | instrument | WIP |  |
| Linebreaker | `linebreaker` | instrument | WIP |  |
| Acoustic Manifold | `acoustic-manifold` | lab | WIP | mic |
| Adaptive Airway Lab | `adaptive-airway` | lab | WIP |  |
| Strophe Lab | `birdsong-lab` | lab | WIP |  |
| Nightingale Manifolds | `nightingale-manifold` | lab | WIP |  |
| Syrinx UI | `syrinx-ui` | lab | WIP |  |
| SIMD Audio Lab | `simd-lab` | lab | WIP | mic |
| Tempo Tantrum | `tempo-tantrum` | instrument | WIP |  |
| Tape Worm | `tape-worm` | instrument | WIP | mic |
| Loop Soup | `loop-soup` | instrument | WIP | mic |
| Habit Habitat | `habit-habitat` | instrument | WIP |  |
| Hollowphonic | `hollowphonic` | instrument | WIP | mic |
| 3D Graph | `graph-3d` | instrument | WIP |  |
| Crab Loom | `crab-loom` | instrument | WIP | mic |
| Freeze Point | `freeze-point` | instrument | WIP | mic |
| Scatter Ghost | `scatter-ghost` | instrument | WIP | mic |
| Exceptional | `exceptional` | instrument | WIP | mic |
| Head Shed | `head-shed` | instrument | WIP | mic |
| Splice Ring | `splice-ring` | instrument | WIP |  |
| Onset Atlas | `onset-atlas` | instrument | WIP |  |
| Synaptic Resonance | `synaptic-resonance` | instrument | WIP |  |
| Loopini | `loopini` | instrument | WIP | mic |

## B. Mic-input instruments: input-source coverage

Target: source pulldown (Mic / File / Built-in samples) + file upload + sample playback.

### Already complete (pulldown + upload + built-in samples)

- L-system Delay Rust (`micmic-rust`)
- Graph Delay Rust (`graph-delay-rust`)
- L-system Parametric Lab (`l-system-parametric-lab`)
- L-system Experiments (`l-system-experiments`)
- Fractal Delay (`fractal-delay`)
- SIMD Resonator (`simd-resonator`)
- Rezoidinator (`simd-resonator-rust`)
- Slippery Resynthesis (`slippery-resynthesis`)
- Sandy Syrup Delay (`sandy-syrup-delay`)
- Candy Coil Delay (`candy-coil-delay`)
- Synthesaurus (`synthesis`)

### Partial

- Recursion (`recursion`): Mic/File pulldown + upload, no built-in samples
- Fractal Synthesis (`fractal-signals`): file upload, no source pulldown/built-in samples
- Tape Worm (`tape-worm`): file upload only
- Loop Soup (`loop-soup`): file upload only
- Acoustic Manifold (`acoustic-manifold`): file upload + demo slices, no source pulldown
- Hollowphonic (`hollowphonic`): source pulldown (incl. Microphone), no file upload

### Mic only (no pulldown / upload / samples found)

- L-Systems (`l-systems`)
- Graphs (`graphs`) — also no presets
- Throatazoid (`throatazoid`) — also no presets
- Alien Larynx (`alien-larynx`) — also no presets
- Lumber Loops (`lumber`) — also no presets
- L-system Delay (`micmic`)
- Graph Delay (`graph-delay`)
- Fabric Filter (`moire-drone`)
- Micromorph (`micromorph`) — also no presets
- Gesturama (`gesturama`) — also no presets
- Morphynx (`morphynx`) — also no presets
- SIMD Audio Lab (`simd-lab`) — also no presets
- Crab Loom (`crab-loom`) — also no presets
- Freeze Point (`freeze-point`) — also no presets
- Scatter Ghost (`scatter-ghost`) — also no presets
- Exceptional (`exceptional`) — also no presets
- Head Shed (`head-shed`) — also no presets
- Loopini (`loopini`) — also no presets

### Needs a human look (static hit, no visible mic UI)

- Hiccup Head (`hiccup-head`)
- Tempo Tantrum (`tempo-tantrum`)
- Habit Habitat (`habit-habitat`)

Caveats: Input UI is detected from DOM at load; controls created only after Start/Audio, and instruments whose sample playback is a recorded-loop bank (Crab Loom, Freeze Point, Scatter Ghost, Exceptional, Head Shed, Loopini, Lumber), could be undercounted.

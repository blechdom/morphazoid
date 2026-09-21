# Full-instrument preset rollout: source inventory

This is the historical inventory from checkpoint `15980a9`, before implementation.
For the current partial implementation and its verification status, see
`full-instrument-preset-rollout.md`. The "Not migrated" column below records the
starting state, not the latest working tree.

Static hints only. Names do not prove preset existence, count, completeness, recall safety, or audible variety; no presets are applied.

Every row still needs an instrument-owned full-state/pattern/voice-bank review.
Zero candidate controls does **not** establish that an instrument has no presets.
A null full-preset count means not verified, not zero.

| Instrument | ID | Entry type | Candidate control IDs | Source files with preset hints | Status |
| --- | --- | --- | --- | ---: | --- |
| Shape | `shape-synth` | instrument | `percussionEnvelopePresets`, `percussionPresetPluck`, `percussionPresetNote`, `percussionPresetSustain`, `percussionPresetPad`, `cornerSwellToggle`, `amplitudeEnvelopePresets`, `amplitudePresetSegment`, `amplitudePresetPluck`, `amplitudePresetNote`, `amplitudePresetSustain`, `amplitudePresetPad`, `pitchCurvePresets` | 3 | Not migrated |
| Solid | `solid-synth` | instrument | None found in static HTML | 2 | Not migrated |
| Hyper | `hyper-synth` | instrument | None found in static HTML | 2 | Not migrated |
| Graph Synth | `graph-synth` | instrument | `graphPatchGrid`, `graphPatch-clearSteps`, `graphPatch-branchChoir`, `graphPatch-layeredGlass`, `graphPatch-haloRing`, `graphPatch-shortcutChorus`, `graphPatch-hubScatter`, `graphPatch-softMesh`, `graphPatch-islandSignals` | 4 | Not migrated |
| Shape Drum Machine | `shape-drum-machine` | instrument | None found in static HTML | 1 | Not migrated |
| Solid Drum Machine | `solid-drum-machine` | instrument | None found in static HTML | 1 | Not migrated |
| Hyper Drum Machine | `hyper-drum-machine` | instrument | None found in static HTML | 1 | Not migrated |
| Graph Drum Machine | `graph-drum-machine` | instrument | `graphPatchGrid`, `graphPatch-clearSteps`, `graphPatch-branchChoir`, `graphPatch-layeredGlass`, `graphPatch-haloRing`, `graphPatch-shortcutChorus`, `graphPatch-hubScatter`, `graphPatch-softMesh`, `graphPatch-islandSignals` | 4 | Not migrated |
| Shapes | `shapes` | instrument | `mainBankTab`, `formBankTab`, `rotationBankTab`, `mappingBankTab`, `triggerSoundBank` | 5 | Not migrated |
| L-Systems | `l-systems` | instrument | `preset`, `mixPreset` | 5 | Not migrated |
| Graphs | `graphs` | instrument | `graphPatchSelect`, `graphPatchGrid` | 7 | Not migrated |
| Tesselation | `tesselation` | instrument | None found in static HTML | 1 | Not migrated |
| Lattice | `lattice` | instrument | `playButton`, `playheadMotion`, `traversalDirection`, `patternDirection` | 2 | Not migrated |
| Spiral | `spiral` | instrument | None found in static HTML | 2 | Not migrated |
| Lattice Drum Machine | `lattice-drum-machine` | instrument | `playheadMotion`, `traversalDirection` | 1 | Not migrated |
| Spiral Drum Machine | `spiral-drum-machine` | instrument | None found in static HTML | 1 | Not migrated |
| L-System Drum Machine | `l-system-drum-machine` | instrument | `preset` | 3 | Not migrated |
| L-System | `l-system` | instrument | `preset` | 4 | Not migrated |
| Julia | `julia` | instrument | `preset` | 3 | Not migrated |
| Striped Staircase | `striped-staircase` | instrument | `viewPreset` | 2 | Not migrated |
| Rattlesnake Skin | `rattlesnake-skin` | instrument | `layerPreset` | 4 | Not migrated |
| FM Drums | `fm-drums` | instrument | `copyBank`, `downloadBank`, `saveBank` | 1 | Not migrated |
| Rattlesnake | `linear-drums` | instrument | `karplusMorphLow`, `karplusMorphLowMid`, `karplusMorphHighMid`, `karplusMorphHigh`, `presetBank` | 4 | Not migrated |
| Karplus Strong | `karplus-strong` | instrument | `presetGrid` | 3 | Not migrated |
| Karplus Carpet | `karplus-carpet` | instrument | `presetBank`, `presetGrid` | 4 | Not migrated |
| Sample Drums | `sample-drums` | instrument | `copyBank`, `downloadBank`, `saveBank` | 0 | Not migrated |
| Dentaphone | `object-forge` | instrument | `preset` | 2 | Not migrated |
| Rubix Cube Sequencer | `rubix` | instrument | `rubixPreset`, `soundBank`, `kitBankControls`, `acidBankControls`, `colorKey` | 2 | Not migrated |
| Sliding Puzzle | `sliding-puzzle` | instrument | `soundBank` | 2 | Not migrated |
| Hocket Luigi | `hocket-loom` | instrument | `presetSelect` | 3 | Not migrated |
| Hyper Rubix | `hyper-rubix` | instrument | `playbackPreset`, `sequencePattern`, `reseedPattern` | 3 | Not migrated |
| Jaw Jam | `jaw-jam` | instrument | `patternSelect`, `randomPatternButton`, `mutatePatternButton`, `clearPatternButton`, `stepVoice` | 4 | Not migrated |
| Enveloper | `enveloper` | instrument | `presetButtons` | 2 | Not migrated |
| WebGPU 303 | `webgpu-303` | instrument | `randomizePatch`, `mutatePatch`, `presetButtons`, `resetPatch` | 3 | Not migrated |
| WebGPU Chiptune | `webgpu-chiptune` | instrument | `previousPreset`, `nextPreset`, `patternTimingControls`, `randomizePatch`, `mutatePatch`, `presetButtons`, `patternControls`, `resetPatch` | 1 | Not migrated |
| GPU Shader Synths | `webgpu-synths` | instrument | `presetButtons`, `resetPatch` | 1 | Not migrated |
| srtuss Master | `srtuss` | instrument | `randomizePatch`, `mutatePatch`, `presetButtons` | 2 | Not migrated |
| Modular Shader Synth | `shader-synth-playground` | instrument | `clearPatch`, `xyflowGraphRoot`, `patchNodes`, `playgroundPlayButton`, `previousPatch`, `presetButtons`, `nextPatch`, `patchControls` | 0 | Not migrated |
| SIMD 303 | `simd-303` | instrument | `stagePresetSelect`, `recallStagePreset`, `saveUserPreset`, `deleteUserPreset`, `randomizePatch`, `mutatePatch`, `presetButtons`, `resetPatch` | 3 | Not migrated |
| SIMD Synth | `simd-synth` | instrument | `presetSelect`, `initPatch`, `undoPatch`, `randomPatch`, `savePreset`, `deletePreset` | 3 | Not migrated |
| SIMD Resonator | `simd-resonator` | instrument | `presetSelect` | 2 | Not migrated |
| Throatazoid | `throatazoid` | instrument | `presetButtons` | 3 | Not migrated |
| Pink Trombonazoid | `pink-trombonazoid` | instrument | None found in static HTML | 5 | Not migrated |
| Throat Singing | `throat-singing` | instrument | `styleButtons` | 4 | Not migrated |
| Monstroid | `monstroid` | instrument | `lungBanks`, `callPresetSelect`, `copyPresetButton` | 3 | Not migrated |
| Jaw Harp | `jaw-harp` | instrument | `harpSelect` | 3 | Not migrated |
| Harmonicazoid | `harmonica` | instrument | `presetSelect`, `performancePresetSelect`, `breathScore` | 3 | Not migrated |
| Julie Saw | `julie-saw` | instrument | `presetSelect` | 3 | Not migrated |
| Hiccup Head | `hiccup-head` | instrument | `patternSelect`, `nextPatternButton`, `randomPatternButton`, `clearPatternButton`, `presetSelect`, `nextFacePresetButton`, `soundBankSelect`, `nextSoundBankButton` | 3 | Not migrated |
| Syrinx | `syrinx` | instrument | None found in static HTML | 5 | Not migrated |
| Tongued Beasts | `tongued-beasts` | instrument | `viewportTonguePresets`, `viewportTonguePresetTrigger`, `viewportTonguePresetPopover` | 5 | Not migrated |
| Hybrinx | `hybrinx` | instrument | `viewportTonguePresets`, `viewportTonguePresetTrigger`, `viewportTonguePresetPopover`, `hybrinxTimelineScroll`, `hybrinxTimelineGutter` | 5 | Not migrated |
| Creaturazoid | `creaturazoid` | instrument | `mobileRandomPatternButton`, `patternSelect`, `nextPatternButton`, `randomPatternButton`, `clearPatternButton`, `presetSelect`, `nextPresetButton` | 4 | Not migrated |
| Quadruped | `quadruped` | instrument | `animalButtons` | 2 | Not migrated |
| Roach Synth | `roach-synth` | instrument | `viewPresets`, `posePreset`, `soundPreset`, `motionPreset` | 6 | Not migrated |
| Spider Synth | `spider-synth` | instrument | `specimenPreset`, `viewPresets`, `posePreset`, `soundPreset`, `motionPreset`, `webPreset` | 8 | Not migrated |
| Blowhole | `blowhole` | instrument | `callSelect`, `callButtons` | 3 | Not migrated |
| Digestazoid | `digestazoid` | instrument | `presetSelect`, `nextPresetButton` | 3 | Not migrated |
| Crickets | `crickets` | lab | `source-preset` | 4 | Not migrated |
| Vocalzoid | `vocalzoid` | instrument | `melodyPresets`, `openBankButtons`, `useLocalBank`, `removeBank` | 4 | Not migrated |
| Lumber Loops | `lumber` | instrument | `shapePreset`, `circlePreset`, `trianglePreset`, `squarePreset` | 2 | Not migrated |
| L-system Delay | `micmic` | instrument | `generationPresetGrid`, `generationPreset-pythagorean`, `generationPreset-bramble`, `generationPreset-venus`, `generationPreset-ivy`, `generationPreset-binary`, `generationPreset-coral`, `generationPreset-moss`, `generationPreset-plant`, `generationPreset-kelp`, `generationPreset-dragon`, `generationPreset-koch`, `generationPreset-clean`, `generationPreset-orchid`, `generationPreset-willow`, `generationPreset-mangrove`, `generationPreset-sequoia` | 5 | Not migrated |
| Graph Delay | `graph-delay` | instrument | `graphPatchGrid`, `graphPatch-clearSteps`, `graphPatch-lowLadder`, `graphPatch-branchChoir`, `graphPatch-glassCanopy`, `graphPatch-layeredGlass`, `graphPatch-rainLattice`, `graphPatch-twinBanks`, `graphPatch-haloRing`, `graphPatch-slowOrbit`, `graphPatch-shortcutChorus`, `graphPatch-hubScatter`, `graphPatch-softMesh`, `graphPatch-islandSignals`, `graphPatch-dustPaths` | 3 | Not migrated |
| Shepard–Risset | `shepard-risset` | instrument | `presetGrid` | 3 | Not migrated |
| Slippery Resynthesis | `slippery-resynthesis` | instrument | `presetGrid` | 3 | Not migrated |
| Drum Roll Please! | `drum-roll-please` | instrument | `presetGrid` | 3 | Not migrated |
| Ouroborousel | `ouroborousel` | instrument | `materialMode`, `presetGrid` | 3 | Not migrated |
| Ourorourobouroboros | `ourorourobouroboros` | instrument | `materialMode`, `presetGrid`, `bankWidthDown`, `bankWidthUp` | 3 | Not migrated |
| Ouroboros | `ouroboros` | instrument | `presetGrid` | 3 | Not migrated |
| Ouroboros Borealis | `ouroboros-borealis` | instrument | `presetGrid` | 3 | Not migrated |
| Sandy Syrup Delay | `sandy-syrup-delay` | instrument | `presetGrid` | 3 | Not migrated |
| Candy Coil Delay | `candy-coil-delay` | instrument | `presetGrid` | 3 | Not migrated |
| Recursive FM | `recursive-fm` | instrument | `presetButtons` | 3 | Not migrated |
| Recursive PM | `recursive-pm` | instrument | `presetButtons` | 3 | Not migrated |
| Chaotic FM | `chaotic-fm` | instrument | `presetButtons` | 3 | Not migrated |
| Chaotic PM | `chaotic-pm` | instrument | `presetButtons` | 3 | Not migrated |
| Cascading FM | `cascading-fm` | instrument | `presetButtons` | 3 | Not migrated |
| Cascading PM | `cascading-pm` | instrument | `presetButtons` | 3 | Not migrated |
| Weierstrass | `weierstrass` | instrument | `presetButtons` | 3 | Not migrated |
| Fabric Filter | `moire-drone` | instrument | `presetGrid` | 3 | Not migrated |
| Puggler the Punk Rock Jugger | `puggler` | instrument | `preset`, `pattern` | 1 | Not migrated |
| Surround for Safety | `surround-field` | instrument | None found in static HTML | 0 | Not migrated |
| Automatapoeia | `cellular-automata` | instrument | None found in static HTML | 5 | Not migrated |
| Sorting | `sorting-algorithms` | instrument | `presetButtons` | 3 | Not migrated |
| DJ Dijkstra | `dijkstra` | instrument | None found in static HTML | 2 | Not migrated |
| Möbius | `moebius-synth` | instrument | None found in static HTML | 2 | Not migrated |
| Klein Bottle | `klein-bottle-synth` | instrument | None found in static HTML | 2 | Not migrated |
| Mazes | `algorithmic-mazes` | instrument | None found in static HTML | 1 | Not migrated |
| Paths | `paths` | instrument | None found in static HTML | 1 | Not migrated |
| Mouthophones | `breath-atlas` | instrument | None found in static HTML | 3 | Not migrated |
| Spelling Synthesizer | `spelling-synthesizer` | instrument | None found in static HTML | 3 | Not migrated |
| Micromorph | `micromorph` | instrument | `presetGrid` | 3 | Not migrated |
| Recursion | `recursion` | instrument | None found in static HTML | 0 | Not migrated |
| Playhead Paint | `playhead-paint` | instrument | None found in static HTML | 3 | Not migrated |
| Boidzoid | `boidzoid` | instrument | None found in static HTML | 1 | Not migrated |
| Vector Flight | `vector-flight` | instrument | None found in static HTML | 2 | Not migrated |
| Gesturama | `gesturama` | instrument | `preset-select` | 1 | Not migrated |
| Wheel of Organs | `image-to-instrument-3` | instrument | `wheelPresetOriginal`, `wheelPresetClear`, `wheelPresetVelvet`, `wheelPresetHum`, `wheelPresetGlass`, `wheelPresetSpeech`, `wheelPresetGiant` | 2 | Not migrated |
| Feral Fairy Ferris Ferry | `orbital-ferris` | instrument | None found in static HTML | 5 | Not migrated |
| Wave Pool | `wave-pool` | instrument | `mutatePatternButton`, `clearPatternButton`, `presetSelect`, `presetButtons` | 3 | Not migrated |
| Penrose Tilings | `penrose-tilings` | instrument | None found in static HTML | 1 | Not migrated |
| Yoyodyne | `yoyodyne` | instrument | None found in static HTML | 1 | Not migrated |
| Hanoi Carillon | `hanoi` | instrument | None found in static HTML | 2 | Not migrated |
| Alpha-Beta Minimax | `minimax` | instrument | None found in static HTML | 2 | Not migrated |
| N-Queens Backtracker | `nqueens` | instrument | None found in static HTML | 2 | Not migrated |
| Euclidean Pulse | `euclid` | instrument | None found in static HTML | 2 | Not migrated |
| Alien Larynx | `alien-larynx` | instrument | `presetButtons` | 3 | Not migrated |
| Hyper-Syrinx | `hyper-syrinx` | instrument | `presetBank` | 2 | Not migrated |
| Morphynx | `morphynx` | instrument | `voicePresetSelect` | 5 | Not migrated |
| Escher | `escher-tessellation` | instrument | `preset` | 3 | Not migrated |
| Plasma Ball | `plasma-ball` | instrument | None found in static HTML | 1 | Not migrated |
| Order Tones | `order-tones` | instrument | None found in static HTML | 3 | Not migrated |
| Morphazoidical | `morphazoidical` | instrument | None found in static HTML | 2 | Not migrated |
| Bell Square | `bell-square` | instrument | None found in static HTML | 1 | Not migrated |
| Entanglement Dance | `entanglement-dance` | instrument | None found in static HTML | 1 | Not migrated |
| Quantum Square Dance | `quantum-square-dance` | instrument | None found in static HTML | 1 | Not migrated |
| Annealogue | `annealogue` | instrument | None found in static HTML | 1 | Not migrated |
| Gravity Walk | `gravity-walk` | instrument | None found in static HTML | 2 | Not migrated |
| Ricochet | `ricochet` | instrument | None found in static HTML | 2 | Not migrated |
| Rigidity | `rigidity` | instrument | None found in static HTML | 2 | Not migrated |
| Rolling Measure | `rolling-measure` | instrument | None found in static HTML | 2 | Not migrated |
| Falling Forms | `falling-forms` | instrument | None found in static HTML | 2 | Not migrated |
| Charge Garden | `charge-garden` | instrument | None found in static HTML | 2 | Not migrated |
| Packing Pressure | `packing-pressure` | instrument | None found in static HTML | 2 | Not migrated |
| Geodesic Drift | `geodesic-drift` | instrument | None found in static HTML | 2 | Not migrated |
| Kinetic Hull | `kinetic-hull` | instrument | None found in static HTML | 2 | Not migrated |
| RISSET-MOIRE | `moire-organ` | instrument | None found in static HTML | 5 | Not migrated |
| Chladni Plate | `chladni-plate` | instrument | None found in static HTML | 5 | Not migrated |
| Spring Choir | `spring-choir` | instrument | None found in static HTML | 5 | Not migrated |
| Gear Ratio Drums | `gear-ratio-drums` | instrument | None found in static HTML | 5 | Not migrated |
| Prime Sieve | `prime-sieve` | instrument | None found in static HTML | 5 | Not migrated |
| Lissajous Orbits | `lissajous-orbits` | instrument | None found in static HTML | 5 | Not migrated |
| Pendulum Wave | `pendulum-wave` | instrument | None found in static HTML | 5 | Not migrated |
| Double Pendulum | `double-pendulum` | instrument | None found in static HTML | 5 | Not migrated |
| Reaction-Diffusion | `reaction-diffusion` | instrument | None found in static HTML | 5 | Not migrated |
| Atomic Orbitals | `atomic-orbitals` | instrument | None found in static HTML | 5 | Not migrated |
| DNA Translator | `dna-translator` | instrument | None found in static HTML | 5 | Not migrated |
| Neural Pulse | `neural-pulse` | instrument | None found in static HTML | 5 | Not migrated |
| Fourier Epicycles | `fourier-epicycles` | instrument | None found in static HTML | 5 | Not migrated |
| Gravity Lens | `gravity-lens` | instrument | None found in static HTML | 5 | Not migrated |
| Cantor Lock | `cantor-lock` | instrument | None found in static HTML | 1 | Not migrated |
| Escape Dust | `escape-dust` | instrument | None found in static HTML | 1 | Not migrated |
| Linebreaker | `linebreaker` | instrument | `presetButtons` | 3 | Not migrated |
| Acoustic Manifold | `acoustic-manifold` | lab | `resynthesis-preset` | 4 | Not migrated |
| Adaptive Airway Lab | `adaptive-airway` | lab | `animalPreset` | 1 | Not migrated |
| Strophe Lab | `birdsong-lab` | lab | `source-preset` | 3 | Not migrated |
| Nightingale Manifolds | `nightingale-manifold` | lab | None found in static HTML | 2 | Not migrated |
| Syrinx UI | `syrinx-ui` | lab | None found in static HTML | 5 | Not migrated |
| SIMD Audio Lab | `simd-lab` | lab | `presetSelect` | 2 | Not migrated |
| Tempo Tantrum | `tempo-tantrum` | instrument | `preset` | 7 | Not migrated |
| Tape Worm | `tape-worm` | instrument | `preset` | 6 | Not migrated |
| Loop Soup | `loop-soup` | instrument | `preset` | 6 | Not migrated |
| Habit Habitat | `habit-habitat` | instrument | `preset` | 7 | Not migrated |
| Hollowphonic | `hollowphonic` | instrument | `preset` | 7 | Not migrated |

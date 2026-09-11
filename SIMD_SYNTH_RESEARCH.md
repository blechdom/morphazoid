# SIMD SYNTH research and design direction

## Decision

SIMD SYNTH should be a **fixed semi-modular performance instrument**, not a
free-cable modular canvas. Its main view should expose one readable signal path
with replaceable algorithms, a few explicit topology choices, reorderable effect
slots, and a compact source/destination modulation matrix:

```text
PLAY / MIDI / SEQUENCER
  -> GENERATORS + NOISE
  -> MIX / CROSS-MOD
  -> SHAPER
  -> DUAL-FILTER ROUTER
  -> VOICE AMP / PAN
  -> GLOBAL EFFECT SLOTS
  -> SAFETY LIMITER / OUTPUT
```

This keeps the instrument immediately playable while allowing its shader,
wavetable, phase-modulation, noise, resonator, filter, shaper, delay, and spatial
parts to be combined in materially different ways. Patch topology is shared by
all active voices; it does not diverge independently per SIMD lane.

## Signal-path and interaction precedents

- [Kilohearts Phase Plant](https://kilohearts.com/docs/phase_plant) separates
  macros, a generator stack, effect lanes, and a bottom modulation area. Its
  effect lanes can be serial or parallel, and it restricts audio-rate modulation
  to the generator area. This is the closest overall structural precedent.
- [Surge XT](https://surge-synthesizer.github.io/manual-xt/index.html) offers
  extensive combinations without cables. Sources can target Filter 1, both
  filters, or Filter 2, while one filter-configuration control selects serial,
  parallel, stereo, ring-modulated, wide, and feedback arrangements. Its
  modulation mode highlights valid targets and supplements direct manipulation
  with a detailed routing list.
- [Vital](https://vital.audio/) demonstrates fast source-to-control modulation:
  drag a source to a target, preview the result, and show animated modulation on
  the control itself.
- [Bitwig's unified modulation system](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)
  selects a source, shades valid targets, retains the target's base value, and
  visually distinguishes mono/global and poly/per-voice modulation. Bitwig also
  separates [control-rate modulation from audio-rate signals](https://www.bitwig.com/userguide/latest/on_grid_signals/).
- [Ableton Racks](https://www.ableton.com/en/manual/instrument-drum-and-effect-racks/)
  place serial devices inside parallel chains, then hide complexity behind
  essential macro controls and recallable variations.
- [VCV Rack polyphony](https://vcvrack.com/manual/PluginGuide) treats one cable
  as a bundle of as many as 16 voice channels. SIMD SYNTH can borrow the bundled
  voice model without borrowing the cable UI.

Applied to Morphazoid, the useful UI pattern is:

- one compact card per stage, with algorithm menu, bypass, reset, and a small
  set of high-leverage controls;
- an inline route control for dual-filter modes such as Serial, Parallel,
  Split/Stereo, Ring, and Feedback;
- a bottom source rail for envelopes, LFOs, random/sample-and-hold, sequencer
  lanes, key, velocity, and X/Y;
- use four always-readable source → destination → bipolar-depth rows in the
  first version; a later direct-drag gesture can mirror those same assignments
  on target controls without changing the patch format;
- keep preset, Init, Undo/Redo, Panic, output level, four performance macros,
  X/Y play, and MIDI/keyboard access visible. Do not require snapshot concepts
  such as "Set A" and "Set B" to understand basic play.

## SIMD precedents

- [SIMDsynth](https://github.com/seclorum/SIMDSynth) is an explicit SIMD proof
  with 16 voices, wavetable oscillators, unison, envelopes, LFOs, per-voice
  filters, and oversampling across x86 SSE and ARM NEON.
- Surge's [SIMD filter API](https://github.com/surge-synthesizer/sst-filters/blob/main/include/sst/filters%2B%2B/api.h)
  processes four lanes and uses masks for inactive voices.
- Vital's [`poly_float`](https://github.com/mtytel/vital/blob/main/src/synthesis/framework/poly_values.h)
  maps to eight AVX2 lanes or four SSE2/NEON lanes and is used inside a broader
  routed synthesizer engine.
- [Faust vector code generation](https://faustdoc.grame.fr/manual/compiler/)
  restructures DSP into simple loops that communicate through vectors. That
  supports fixed homogeneous stages rather than interpreting an arbitrary graph
  for every sample.
- WebAssembly defines a portable [128-bit SIMD `v128`](https://github.com/WebAssembly/spec/blob/main/proposals/simd/SIMD.md),
  including four packed `f32` lanes. [Emscripten's SIMD documentation](https://emscripten.org/docs/porting/simd)
  covers `-msimd128`, autovectorization, vector extensions, and explicit Wasm
  intrinsics.

No reviewed source demonstrated a mature browser SIMD modular synth with the
combined breadth requested here. Surge and Vital are the strongest broad synth
architectures; SIMDsynth is the clearest explicit SIMD synthesizer example.

## Morphazoid SIMD architecture

- Keep the DSP in one `AudioWorkletProcessor`. Its `process()` callback receives
  browser render quanta—currently 128 frames—and must finish within the real-time
  budget. See [MDN's AudioWorklet process documentation](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process)
  and Google's [AudioWorklet/Wasm design guidance](https://developer.chrome.com/blog/audio-worklet-design-pattern).
- Use structure-of-arrays voice state and inactive-lane masks. Pack four mono
  voices in an `f32x4`, or maintain separate left/right vectors for four stereo
  voices. SIMD is most useful across independent voices, unison members,
  oscillators, partials, grains, and filter-bank bands.
- Recursive filters have a time dependency, so their lanes should normally
  represent independent voices or bands rather than adjacent time samples.
- Keep structural routing patch-wide and resolve it outside inner sample loops.
  Compile only active modulation routes when a patch changes. Swap structures at
  a block boundary and briefly crossfade paths to avoid clicks.
- Preallocate voice, route, delay, and scratch memory. Do not allocate, rebuild
  UI objects, or send high-volume messages from the render loop. Smooth audible
  parameter changes.
- Oversample nonlinear oscillators, sync, folds, and shapers selectively instead
  of multiplying the cost of the complete graph.
- Native JavaScript typed arrays do not guarantee hardware SIMD. A truthful
  hardware-SIMD backend uses Wasm `v128`; a scalar or packed-JavaScript fallback
  should be identified separately in diagnostics and benchmarks.

## Licensing and provenance boundary

Surge XT and Vital are GPL-licensed, and other referenced projects retain their
own licenses. They are used here only as **architectural and interaction study**.
SIMD SYNTH must use original Morphazoid DSP, UI code, presets, names, and visual
assets unless a dependency is deliberately adopted with compatible licensing
and recorded in the repository's third-party notices. The signal-path patterns
above are inspiration, not permission to copy implementation code or product UI.

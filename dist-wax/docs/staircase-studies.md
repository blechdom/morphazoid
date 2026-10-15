# Staircase Studies

A separate Rust/WebAssembly instrument built from Striped Staircase's Mandelbrot
view. Open `/striped-staircase-rust.html`, enable **Audio**, then **Play**.
The original `/striped-staircase.html` and its sound remain available.

Start with **Contour**, turn on **Hold depth**, then compare **Harmonics** and
**Resonant body**. Release Hold and try **Stripe strikes**. Adjust **Depth speed**
to spread the strikes apart; **Register** tunes the sounding voice independently.
Drag to roam, wheel or pinch to zoom, or choose another location. The canvas also
accepts arrow keys to pan, +/− to zoom and Home to restore the selected view.

## Four interpretations

| Study | Measured source | Audible mapping |
| --- | --- | --- |
| Contour | Longest observed contour at the middle of the highlighted depth band | Centered horizontal and vertical contour coordinates become a repeating stereo waveform. Detail reveals sharper bends. |
| Harmonics | Escaped area in sixteen vertical slices of that depth band | Each slice weights one harmonic; Detail changes the spectral balance. The same field becomes a sustained spectrum. |
| Stripe strikes | Actual half-stripe crossings of escape depth | Each crossing excites a bounded set of decaying tones shaped by the current contour. Ring changes their decay. Holding depth stops new attacks. |
| Resonant body | Contour perimeter, location and turning | Length-derived tuning and geometric excitation drive resonances. Body changes their damping. This is an authored resonator, not a physical object recovered from the fractal. |

The highlighted outline is the measured contour used for sound, at the nearest
prepared depth. The background retains the original striped renderer. A study
switch preserves the depth, camera, transport and controls, and crossfades the
sound. These four buttons select algorithms, not complete presets. Body has no
destination in Contour or Harmonics and is disabled there. Palette is visual.

**Audio** arms/mutes output. **Play/Pause** starts/stops the journey and releases
the sound. **Hold depth** keeps the depth fixed while the continuous studies keep
sounding. Muting Audio leaves the journey running. **Reset study** restores the
initial view and voice and pauses playback, preserving Audio and output volume.
The site Record control captures the resulting stereo audio for comparisons.

MIDI uses Morphazoid's existing shared controller adapter: notes set Register
and start the latched journey; note-off leaves the sequence running. Explicitly
enable MIDI in Settings. Standard transport and labeled CC controls follow the
shared adapter. The canvas owns its navigation keys; there is no QWERTY piano or
MIDI-note output for these continuous studies. A MIDI reference note does not
quantize the measured geometry to a musical scale.

## Model and implementation boundaries

The worker samples `z ← z² + c` directly, using the original smooth escape-count
formula. It prepares 64 sliding depth bands and retains the longest measured
contour in each, sampled at 256 equal-arclength positions. Sixteen area bins,
perimeter, centroid and turning descriptors accompany each contour. Unescaped
samples are censored; they are never assigned an invented terminal contour.
Open contours retrace their measured path rather than closing across unknown
space. A view with no observed contour can be silent.

The sound is intentionally a finite interpretation. Small branches are omitted;
the longest branch can change identity between depth bands. Interpolation joins
prepared frames without claiming that they are the same object. The browser
uses a 112-column analysis grid with bounded row count. The GPU background uses
single precision while the worker uses double precision, so deep zoom can show
differences between the background and the measured overlay. This version does
not claim exact visual/audio agreement at arbitrarily deep zoom.

Rust owns the audio sample clock, depth motion, oscillators, attacks, smoothing
and output. An AudioWorklet runs the compiled module independently of animation
frames. The worker prepares field changes separately; the previous sound
continues until the latest view is ready, then the engine crossfades it. Rapid
view changes coalesce and stale worker results are discarded. Rendering is
pixel-budgeted and field recomputation is debounced during gestures.

Depth speed is normalized journeys per second (one way across the selected
range); the readout gives seconds per journey. Depth reverses at each end.
The spacing curve maps this normalized journey into escape-depth units. There
is no claim that these seconds are inherent physical time in the Mandelbrot set.
Register is an independent artistic frequency scale. This differs from the
later JavaScript Striped Resonance experiments; it is a smaller independent
comparison instrument, not a port of all 29 of their algorithms.

## Build and verification

`npm run build:staircase-wasm` builds the dependency-free Rust crate for
`wasm32-unknown-unknown`, then writes the WASM module and source/byte-hash manifest.
`npm run check:staircase-wasm` validates the committed module, ABI and hashes
without a Rust compiler. Rust source lives under
`src/instruments/striped-staircase-rust/rust/`; the browser bridge, worker and UI
live alongside it. This is Rust DSP in the browser, not a native plug-in.

Focused coverage lives in `tests/staircase-*.test.mjs` and
`e2e/striped-staircase-rust.spec.mjs`. Checks cover actual geometric input,
finite/bounded output, silence, pitch/control response, independent audio timing,
mode transitions, worker revisions, gestures, teardown and three viewport sizes.
The artwork is the existing Striped Staircase catalogue image; the renderer and
camera helpers are reused from that instrument without modifying its source.

Automated signal checks do not establish that these sounds capture what you
like about the image. Human listening and physical controller evaluation remain
the deciding next step. Compare the same held depth first, then compare motion,
so changes in geometry do not disguise differences between mappings.

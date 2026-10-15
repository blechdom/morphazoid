# Staircase Studies

A separate Rust/WebAssembly instrument built from Striped Staircase's Mandelbrot
view. Open `/striped-staircase-rust.html`, enable **Audio**, then **Play**.
The original `/striped-staircase.html` and its sound remain available.

Start with **Stripe rhythm**: white sustains notes, black releases them. Each
measured connected outline has its own pitch and stereo position. **Hold depth**
freezes a white chord or a black rest. Adjust **Depth speed** to change the
journey, **Register** to transpose the voices, and **Release** for the transition
into each rest. The controls are knobs: drag vertically, use Shift for fine
adjustment, or focus a knob and use the arrow keys. Tap sets Depth speed.
Use **Pitch reference** to compare Height, Frame X/Y and Relative turns.
**Pitch span** controls their interval range; **Voice limit** selects 1–512
measured components, starting at 256.
Drag to roam, wheel or pinch to zoom, or choose another location. The canvas also
accepts arrow keys to pan, +/− to zoom and Home to restore the selected view.

## Four interpretations

| Study | Measured source | Audible mapping |
| --- | --- | --- |
| Contour | Longest observed contour at the middle of the highlighted depth band | Centered horizontal and vertical contour coordinates become a repeating stereo waveform. Detail reveals sharper bends. |
| Harmonics | Escaped area in sixteen vertical slices of that depth band | Each slice weights one harmonic; Detail changes the spectral balance. The same field becomes a sustained spectrum. |
| Stripe rhythm | Connected contours at the scanned depth, with the original stripe parity and a selected voice budget | White holds one voice per measured component; black releases them. Pitch reference selects an absolute or history-based mapping. Horizontal centroid sets pan; contour length sets relative level. Detail adds overtones; Release sets the note-off smoothing. |
| Resonant body | Contour perimeter, location and turning | Length-derived tuning and geometric excitation drive resonances. Body changes their damping. This is an authored resonator, not a physical object recovered from the fractal. |

In Stripe rhythm, colored traces identify the measured voices, with bright dots
while their white gate is on and rings during a black rest. The readout shows
the number of voices and any components omitted by the selected voice limit. In the
other studies the single highlighted outline is the longest measured contour.
Traces use the nearest prepared depth; voice position and pitch interpolate.
The background retains the original striped renderer. A study
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

### Why branching did not make two notes before

The first Stripe strikes version kept only the longest outline and struck a
single bank of eight partials together on **both** stripe transitions. It did
not give the separate tendrils independent notes. Stripe rhythm now retains
separate measured components and gives each a voice. Neighboring depth samples
match components by centroid proximity and relative length to preserve voice
identity where possible. When one measured outline becomes two, both can sound.
New components receive distinct IDs; an offshoot inherits a parent reference
only when both centroid proximity and nearby sampled outline points support it.

All components at the same escape depth have the same stripe color, so they
share an on/off rhythm: branching creates a changing chord, not independent
polyrhythms. Different pitches and pan positions make the voices distinguishable.
Independent rhythmic paths would require a different scanning rule.

A change in component count is not proof of a mathematical bifurcation. Viewport
clipping, limited sampling and cells touching unescaped points can also separate
an outline. The matching is a visual continuity heuristic, not a reconstruction
of the fractal's branch ancestry. If more components are detected than the
selected voice limit, the longest are played and the omitted count is shown.

### Pitch references and subspiral exploration

Coordinates are the measured component's screen centroid: `x=0` is left and
`y=0` is top. Register supplies `base` in Hz. No musical scale quantization is
applied.

| Reference | Pitch rule |
| --- | --- |
| Height | `base × 2^(span × (0.5 − y))`. This is the previous mapping, with an adjustable span. |
| Frame X/Y | `base × 2^(span × ((0.5 − y) + (x − 0.5)) / 2)`. A fixed frame reference; rightward and upward motion raise pitch. |
| Relative turns | Each branch remembers its previous note position, travel heading and pitch offset. A new note adds `span × (signedTurn / π) × min(1, 8 × distance)` octaves to that previous offset. Clockwise screen turns raise pitch; counterclockwise turns lower it. |

Height and Frame X/Y follow the moving centroid continuously. Relative turns
updates at white note onsets or when a new component enters an already-white
stripe; its pitch holds between those events. A stationary component keeps its
pitch. The first note seeds from Frame X/Y; the first displacement establishes a
heading before turn-based intervals begin. An offshoot can inherit its parent's
previous note, heading and offset, even when the parent's voice slot is reused.
Simultaneous offshoots read the parent's previous note before that onset updates
it. The relative offset is bounded to four octaves above/below Register.

Dashed lines in Relative turns connect the reference used for the current note
to the component's current centroid. A small ring marks that reference. These
positions come from the Rust audio state. Hold does not accumulate new notes.
Changing the view, seeking a depth or switching pitch reference resets the
motion history; it does not restart the audio clock. Register and timbre changes
retain the history. The span ranges from 0–6 octaves; zero collapses pitch
intervals to Register. Reset restores Frame X/Y, span 3, and 256 voices.

This explores the motion of inferred branches and offshoots. It does not walk
every spiral curve or recover a mathematically exact hierarchy of subspirals.

### Voice capacity

32 was an implementation choice, not a Rust limit. This version supports up to
512 concurrent branch voices and starts at 256. Capacity, detected components,
and the analysis grid are distinct limits: increasing the voice budget does not
invent detail absent from the sampled image.

The benchmark script `node scripts/benchmark-staircase.mjs` records processing
times, upload bursts, host details and deadline overruns. Its Node/WASM results
are throughput measurements, not a guarantee for every browser or phone.
The expanded kernel skips inactive voices. On the development host (Intel Core
Ultra 9 285HX), held-note runs with 512 active voices measured roughly
1.04–1.66 ms at the 95th percentile across Frame X/Y and Relative turns. At 1024
active voices, these mappings measured about 2.57–3.10 ms; both missed the
2.67 ms deadline for at least some 128-sample blocks at 48 kHz. Earlier runs
show material timing variation with host load and scheduling. These results
establish neither a universal ceiling nor a promise
of glitch-free playback at 512. Use Voice limit to reduce demand on slower
devices. In the source repository, `docs/staircase-pitch-capacity-measurements.json`
retains the final workload and timing details separately from the earlier
baseline in `docs/staircase-capacity-measurements.json`.

The worker samples `z ← z² + c` directly, using the original smooth escape-count
formula. It prepares 64 sliding depth bands and retains up to the selected budget of measured
components per band for rhythm. The longest contour also supplies 256
equal-arclength positions for the other studies. Sixteen area bins,
perimeter, centroid and turning descriptors accompany each contour. Unescaped
samples are censored; they are never assigned an invented terminal contour.
Open contours retrace their measured path rather than closing across unknown
space. A view with no observed contour can be silent.

The sound is intentionally a finite interpretation. Sub-grid branches and
components beyond the voice limit are omitted; the longest branch used by other
studies can change identity between depth bands. Interpolation joins
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
`e2e/striped-staircase-*.spec.mjs`. Checks cover actual geometric input,
finite/bounded output, silence, pitch/control response, independent audio timing,
mode transitions, worker revisions, gestures, teardown and three viewport sizes.
The artwork is the existing Striped Staircase catalogue image; the renderer and
camera helpers are reused from that instrument without modifying its source.

Automated signal checks do not establish that these sounds capture what you
like about the image. Human listening and physical controller evaluation remain
the deciding next step. Compare the same held depth first, then compare motion,
so changes in geometry do not disguise differences between mappings.

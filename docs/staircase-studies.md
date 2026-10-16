# Staircase Studies

A separate Rust/WebAssembly instrument built from Striped Staircase's Mandelbrot
view. Open `/striped-staircase-rust.html`, enable **Audio**, then **Play**.
The original `/striped-staircase.html` and its sound remain available.

Start with **Stripe rhythm**: white sustains notes, black releases them.
**Block edges** gives each measured tendril two oscillators, one following each
marked boundary of the moving block; all voices stay centered. **Hold depth**
freezes a white chord or a black rest. Adjust **Depth speed** to change the
journey, **Register** to transpose the voices, and **Release** for the transition
into each rest. The controls are knobs: drag vertically, use Shift for fine
adjustment, or focus a knob and use the arrow keys. Tap sets Depth speed.
Use **Pitch paths** to compare Block edges with the earlier Branch centers.
**Base pitch reference** compares Height, Frame X/Y and Note-to-note turns.
**Pitch span** controls their interval range. **Voice limit** selects the
oscillator budget, starting at 256: Block edges uses two per tendril, up to
256 tendrils / 512 oscillators; Branch centers uses one per component.
Drag to roam, wheel or pinch to zoom, or choose another location. The canvas also
accepts arrow keys to pan, +/− to zoom and Home to restore the selected view.

Only the current viewport is analyzed and sonified. Zoom and pan rebuild the
sampled geometry from the new camera bounds; offscreen parts of the fractal are
not retained as hidden voices. The previous sound continues while the worker
prepares the new view, then crossfades into it. Frame X/Y pitch uses positions
within the new frame, so reframing can change both the selected voices and their
pitches. Zoom also changes what detail the fixed analysis grid can resolve.

## See and isolate the played paths

**Show voice paths** draws the route of each voice's sampled read point through
depth. A color identifies a tendril; its circle and diamond are the two persistent
edge voices. The diamond's trail is dashed. The brighter outline is the current
measured contour, while the fainter trail shows where its voice travels. Trails
break across missing geometry or identity changes. They do not invent a connection
between disconnected contours. Markers follow the same interpolated coordinates
as the audio; the current outline uses the nearest prepared depth.

Tap a marker or choose **Hear a tendril** to isolate its voices. Their pitches
continue following the selected mapping. **Hear all tendrils** restores the mix.
Focus preserves timing, voice phase, pitch history and the original mix weights;
it does not boost a quiet tendril. If that tendril leaves the sampled depth it
falls silent. Rebuilding the view clears focus because IDs belong to that view.
The mapped-tendril count still reports the complete field, and the readout names
the selected tendril separately.

**Show stripes as a time guide** only changes the background drawing. Switch it
off to see continuous escape-depth shading with the voice paths over it.
**Gate sound with stripes** independently adds the white/on and black/rest
pattern. Turn that gate off for continuous contour voices. Filled markers then
remain gate-open through black depths. Play, Audio, Hold and Release retain their
usual behavior; neither switch changes the scan clock or pitch mapping.

Each edge is a voice following a pitch contour, rather than one fixed frequency
for the stripe. Height, Frame X/Y and contour Turning update within a stripe.
**Note-to-note turns** is the exception: its history-based pitch holds between
note events. Its note history still advances at measured stripe onsets when the
audible stripe gate is off. **Contour study** acts above the base reference:
at full Turning or Forks, its pitch contribution replaces the base reference;
lower amounts blend the base reference back in. The control readout shows those
contributions. Unsupported geometry retains the documented fallback behavior.

## Five ways to follow the spiral

Inside **Stripe rhythm**, **Contour study** selects one focused mapping. **Original
edges** returns all five amounts to Off. The choices change only the five
amounts: they preserve the current view, depth, direction, Audio, Play, Hold,
output level, register, speed, pitch reference and tuning knobs. You can compare
at a held depth or keep the descent moving while switching.

| Choice | Geometry and sound | Tune it |
| --- | --- | --- |
| Turning pitch | Accumulated, consistently oriented boundary turning becomes a continuous pitch offset. | Turning amount; Turn range in octaves per measured turn. |
| Turn accents | Accumulated absolute boundary turning drives smooth accents within the white sustain. Faster measured turning makes faster accents. Black still releases. The markers pulse with this phase. | Accents amount; 1–32 accents per turn, starting at four. |
| Branching pitch | A conservatively tracked offshoot inherits its parent's pitch offset, then diverges according to its departure relative to the parent's local size. | Forks amount; Fork range. |
| Curvature color | Aspect-correct local bending increases the upper harmonics. Markers also brighten with the curvature amount. | Curvature amount; Bend sensitivity. |
| Endless descent | Octave-related tones crossfade through a fixed register window as contour turning advances. This is a Shepard illusion driven by measured motion. | Endless amount; Descend or Ascend. |

The five amount knobs can blend any combination. **Turning + forks + accents**
offers a starting blend. **Tune each mapping** exposes its range or sensitivity
and a **Hear alone** action. At full Turning or Forks, that mapping replaces
the original frame/history pitch offset; reducing the amount blends the original
reference back in. Accents and Curvature retain the boundary pitches. The two
edge voices remain centered, with optional white sustain and black release.
Hold freezes the geometry and its accent/Shepard motion while oscillators keep
sounding. There is no independent tempo or stereo animation behind these cues.

**Explore branching passage** selects Spiral arms, paired edges,
32 oscillators (up to sixteen tendrils), the default Stripe structure, Branching
pitch and depth 51/63, facing deeper. It preserves Audio, Play, Hold, speed, register, output volume and study
tuning. This gives a useful measured fork example on the desktop view; viewport
aspect and zoom affect which contours are visible. Choose Original edges to
compare the same passage. Use Hold or the Depth position knob to inspect it.

These mappings use sampled contour geometry. Their turning is not a fitted
spiral center or an exact winding number of the mathematical fractal. Local
curvature is measured on oriented outlines, not on the retraced playback
waveform. Fork evidence must survive topology/persistence checks; an apparent
split caused by clipping or missing samples is not automatically a musical
fork. Unsupported measurements retain a known voice's last reliable features;
a new unsupported voice retains its base boundary sound. Small unresolved
subspirals cannot supply invented turns. The feature table is prepared in the
worker; Rust interpolates it on the same clock as the notes.

The experiments build on continuous parameter mapping, including the
[Sonification Handbook's curvature-to-brightness example](https://sonification.de/handbook/chapters/chapter15/),
and [Risset's pitch and rhythm illusions](https://brahms.ircam.fr/fr/work/glissements-1).
The specific contour mappings here are artistic design choices. Their mechanical
tests do not establish that a listener can identify every simultaneous tendril.

## Four interpretations

| Study | Measured source | Audible mapping |
| --- | --- | --- |
| Contour | Longest observed contour at the middle of the highlighted depth band | Centered horizontal and vertical contour coordinates become a repeating stereo waveform. Detail reveals sharper bends. |
| Harmonics | Escaped area in sixteen vertical slices of that depth band | Each slice weights one harmonic; Detail changes the spectral balance. The same field becomes a sustained spectrum. |
| Stripe rhythm | Paired boundaries of the moving depth band, or connected contours at its middle | White holds the traced voices; black releases them. Block edges supplies two pitch paths per measured tendril; Branch centers supplies one. Pitch reference selects an absolute or history-based mapping. Voices stay centered; contour length sets relative level. Detail adds overtones; Release sets the note-off smoothing. |
| Resonant body | Contour perimeter, location and turning | Length-derived tuning and geometric excitation drive resonances. Body changes their damping. This is an authored resonator, not a physical object recovered from the fractal. |

In Stripe rhythm, colored traces identify the measured voices. Block edges marks
each pair with a circle and a diamond. Markers fill while their white gate is on
and become outlines during a black rest. The readout shows tendrils, oscillator
voices, components omitted by the voice budget, and incomplete edge pairs. In the
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

## Output level

Volume starts at 75%. Stripe rhythm compensates for the energy lost when many
independent voices are mixed, with a bounded geometry-based correction and
fixed makeup gain. Two edges share one tendril's level weight. Black rests and
release tails retain their envelopes; there is no automatic gain recovery
during silence. The existing soft shaper receives more drive, so the louder
sound can also have more harmonics. Volume remains a linear control after that
shaping.

The working target was roughly −12 LUFS for the default moving passage, not a
fixed loudness for every view or a universal mastering standard. Measurements
on 2026-10-15 used FFmpeg's
[`ebur128=peak=true` meter](https://ffmpeg.org/ffmpeg-filters.html#ebur128):

| Offline Rust render | Before, 48% Volume | After, 75% Volume | After true peak |
| --- | --- | --- | --- |
| Default moving passage, 20 s | −33.2 LUFS | −13.0 LUFS | −5.0 dBTP |
| Held default white stripe, 5 s | −26.5 LUFS | −12.6 LUFS | −5.8 dBTP |
| Dense double-spiral white stripe, 5 s | −37.1 LUFS | −12.2 LUFS | −6.1 dBTP |
| Branch centers moving, 20 s | −31.2 LUFS | −11.9 LUFS | −4.8 dBTP |

These renders use 48 kHz, 128-sample blocks, a 112-column analysis grid,
aspect 1.3788659793814433, 256-oscillator budget, Frame X/Y, Register 73 Hz,
Pitch span 3, Detail 0.55 and Release 0.35. The default view is Seahorse;
motion starts at depth 0.175 and advances at 0.035 journeys per second. The
dense case holds the white frame with the most measured voices. Repeating at
44.1 kHz gives the same moving LUFS and true peak to the displayed precision.

Actual browser Record captures measured −33.4 → −13.2 LUFS for the moving
passage and −26.5 → −12.2 LUFS for held white. The new browser peaks were
−5.0 and −5.8 dBTP respectively. Browser capture durations and start timing
vary slightly from the deterministic offline renders. Full-Volume probes at
44.1/48 kHz, maximum Detail and a 512-oscillator budget stayed below −2.1 dBTP
in the measured cases. These are observed peaks, not a true-peak limiter
guarantee for every possible geometry. No human listening judgment is implied.

The loudness calibration above measured WASM SHA-256
`5de8d38de0dcc884335a3c991cd3d7918b75738c36e27da9ce0b5b6be6979b20`.
To render the current build and retain WAVs, exact settings, source hashes,
table snapshots and meter logs, install FFmpeg and run:

```sh
node scripts/analyze-staircase-loudness.mjs --cases=default-moving,held-white,dense-white,centers-moving
```

The script prints a fresh temporary output directory with its report. Use
`--help` for explicit output paths, sample rates and parameter probes. It adds
no gain or normalization to the actual Rust output.

## Model and implementation boundaries

### Why branching did not make two notes before

The first Stripe strikes version kept only the longest outline and struck a
single bank of eight partials together on **both** stripe transitions. It did
not give the separate tendrils independent notes. Stripe rhythm now retains
separate measured components and gives each one or two voices. Branch centers
matches neighboring components by centroid proximity and relative length.
Block edges follows the previous cross-section's local contour anchor and checks
both boundary positions separately. A movement beyond 0.15 viewport heights
starts a new identity, preventing a voice from gliding across an unsupported
gap to a distant fragment. This is a conservative tracking tolerance, not proof
of mathematical continuity. The 64 prepared depths still approximate curved
travel with line segments. When one measured outline becomes two, both can sound.
New components receive distinct IDs; an offshoot inherits a parent reference
only when both centroid proximity and nearby sampled outline points support it.

All components at the same escape depth have the same stripe color, so they
share an on/off rhythm: branching creates a changing chord, not independent
polyrhythms. Different pitches make the voices distinguishable.
Independent rhythmic paths would require a different scanning rule.

A change in component count is not proof of a mathematical bifurcation. Viewport
clipping, limited sampling and cells touching unescaped points can also separate
an outline. The matching is a visual continuity heuristic, not a reconstruction
of the fractal's branch ancestry. Branch centers selects the longest components within the voice limit. Block
edges checks up to 256 middle contours, then selects the longest complete pairs
within the oscillator budget. Incomplete pairs do not consume that budget; the
readout reports incomplete and omitted components separately.

### Following the moving blocks

The underlying black/white stripes are fixed escape-depth bands. The dark block
that moves during Play is the highlighted window between two escape depths.
Block edges reads those two bounding curves; the original stripe parity at the
playhead still supplies the shared white-on/black-off gate.

For each measured middle contour, an anchor follows the nearest point on that
contour from the previous depth sample. If that point cannot supply both edges,
a bounded search along the same contour looks for a nearby usable cross-section.
New offshoots begin from their parent's reference. A local cross-section through the anchor finds the first bounding
curve on each side. The analysis accepts a pair only when both boundaries can
be reached through known sampled geometry. A censored cell, viewport edge, or
wrong intervening boundary makes the pair incomplete; it does not invent an edge
or connect across a neighboring curl.

Each oscillator reads its boundary intersection's X/Y position, rather than an
average of the block. At a new root, the local normal assigns the screen-left side the circle
and the other side the diamond, even before both edges become visible. Their curve identities then persist
through bends and pass to matching sides of offshoots when the parent's
orientation is known; screen-left/right is not re-sorted each frame. The colored boundary fragments and markers show the
geometry being read. Depth samples interpolate continuously, so the pitch
follows the moving points in Height and Frame X/Y. Hold freezes them.

Both oscillators share the tendril's gate and divide its level weight. They can
sound at different frequencies or meet in unison when the chosen pitch rule
assigns the same pitch to both positions. Increasing Pitch span exaggerates the
pitch intervals without introducing a musical scale. Source changes preserve
the running audio clock and transport; the newly prepared paths reset relative
note history when they arrive.

This is a local reading of sampled band boundaries. It does not recover a
mathematically exact centerline or hierarchy of every subspiral. The camera,
analysis resolution and unknown interior still limit which pairs can be traced.

### Pitch references and subspiral exploration

Coordinates are each marked boundary point in Block edges, or the measured
component's centroid in Branch centers: `x=0` is left and `y=0` is top.
Register supplies `base` in Hz. No musical scale quantization is
applied. X/Y affects pitch and note history; Stripe rhythm has no position-based
panning. Both output channels carry the same centered rhythm signal.

| Reference | Pitch rule |
| --- | --- |
| Height | `base × 2^(span × (0.5 − y))`. This is the previous mapping, with an adjustable span. |
| Frame X/Y | `base × 2^(span × ((0.5 − y) + (x − 0.5)) / 2)`. A fixed frame reference; rightward and upward motion raise pitch. |
| Relative turns | Each branch remembers its previous note position, travel heading and pitch offset. A new note adds `span × (signedTurn / π) × min(1, 8 × distance)` octaves to that previous offset. Clockwise screen turns raise pitch; counterclockwise turns lower it. |

Height and Frame X/Y follow the moving pitch point continuously. Relative turns
updates at white note onsets or when a component enters or returns to an already-white
stripe; its pitch holds between those events. A stationary component keeps its
pitch. The first note seeds from Frame X/Y; the first displacement establishes a
heading before turn-based intervals begin. Each edge has its own history. An offshoot can inherit its parent's
previous note, heading and offset, even when the parent's voice slot is reused.
Simultaneous offshoots read the parent's previous note before that onset updates
it. The relative offset is bounded to four octaves above/below Register.

Dashed lines in Relative turns connect the reference used for the current note
to the current pitch point. A small ring marks that reference. These
positions come from the Rust audio state. Hold does not accumulate new notes.
Changing the view, seeking a depth or switching pitch reference resets the
motion history; it does not restart the audio clock. Register and timbre changes
retain the history. The span ranges from 0–6 octaves; zero collapses pitch
intervals to Register. Reset restores Block edges, Frame X/Y, span 3, and a
256-oscillator budget.

This explores the motion of inferred branches and offshoots. It does not walk
every spiral curve or recover a mathematically exact hierarchy of subspirals.

### Voice capacity

32 was an implementation choice, not a Rust limit. This version supports up to
512 concurrent oscillator voices and starts at 256. Block edges reserves two
voices together for each selected tendril; an incomplete pair remains silent.
The budget selects complete pairs per prepared depth. Interpolation can briefly
overlap fading pairs, within the fixed 512-oscillator ceiling.
Capacity, detected components,
and the analysis grid are distinct limits: increasing the voice budget does not
invent detail absent from the sampled image.

The benchmark script `node scripts/benchmark-staircase.mjs` records processing
times, upload bursts, host details and deadline overruns. Its Node/WASM results
are throughput measurements, not a guarantee for every browser or phone.
The expanded kernel skips inactive voices. Measurements of the pitch-comparison
build, before removing position-based panning, ran on an Intel Core
Ultra 9 285HX. Held-note runs with 512 active voices measured roughly
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
formula. It prepares 64 sliding depth bands and retains measured
components within the selected oscillator budget. The longest contour also supplies 256
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

Audio timing takes precedence over display updates. White/black crossings are
evaluated for each audio sample, including while the main thread is stalled.
The display requests at most one outstanding snapshot; a single transferable
voice buffer is reused, and snapshots are filled only after rendering audio.
If the display stops requesting, diagnostic work stops while synthesis keeps
running. Normal audio blocks reuse their output views without creating slices.
Drawing is capped at 30 fps and backs off toward 10 fps when frames are costly.
Field analysis is dispatched before refreshing the GPU background. Replacing a
settled 64-frame field copies its prepared data directly; only an interrupted
crossfade requires the more expensive interpolated collapse.

The rhythm is not a metronomic pulse: progress moves at constant speed through
a nonlinear depth-spacing curve. With the default spacing curve of 1.7, stripe
crossings accelerate during descent and slow on the return. This relationship
is preserved; changes in rhythm caused by geometry are distinct from scheduling
delays. Worklet tests compare exact moving-stripe samples with frequent, absent
and stalled display requests. Browser recording tests check onset intervals
through main-thread stalls. These checks establish sample/graph timing, not
end-to-end hardware presentation; no physical loopback test was performed.

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

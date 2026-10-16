# Staircase Studies DSP

Dependency-free Rust `cdylib`/`rlib`, compiled to raw WebAssembly with no imports.
Build with `node scripts/build-staircase-wasm.mjs`; check the checked-in binary,
source hashes and exports with the same command plus `--check`. Native
`cargo test --manifest-path src/instruments/striped-staircase-rust/rust/Cargo.toml`
checks that processing and table recalls allocate/deallocate nothing. The
browser ABI is exercised by `node --test tests/staircase-dsp.test.mjs`.

This is an artistic sonification of sampled geometry. It does not model a
physical staircase, vibrating fractal material, or an exact Mandelbrot boundary.

## Raw ABI, version 3

- `stair_new(sampleRate: f64)` returns an opaque engine pointer; supported rates
  are 8–192 kHz. `stair_drop(engine)` releases it.
- `stair_alloc(bytes)` returns zeroed storage aligned to eight bytes.
  `stair_free(pointer, originalBytes)` releases caller-owned storage.
- `stair_table(engine, float32Pointer, floatCount, frameCount)` copies and
  sanitizes an entire prepared field; frames may be 0–64 and have stride 3616.
  A zero-frame table clears the field through the normal 60 ms crossfade.
- `stair_controls(engine, mode, baseHz, brightness, body, gain, scanSeconds)`
  sets the mapping (0–3), continuous base frequency (20–1200 Hz), brightness,
  body/ring and gain (0–1), and one-way depth traversal time (2–200 seconds).
  Pitch, timbre, gain and mode changes slew rather than resetting phases.
  Body controls release in mode 2 and modal damping in mode 3; it has no
  destination in modes 0/1 and the browser disables it there.
- `stair_pitch(engine, mapping, spanOctaves)` selects Height (0), Frame XY (1),
  or Relative Turns (2), with span 0–6 octaves. This affects branch voices in
  rhythmic mode. Changing mapping resets motion references; changing span,
  register, Detail or Release preserves them. Pitch remains continuous in
  frequency rather than being rounded to a musical scale.
- `stair_transport(engine, playing, enabled, hold)` updates three independent
  flags. Playing advances the depth. Enabled arms the output, while mute leaves
  the sample clock and playing depth running. Hold fixes depth without stopping
  synthesis. Pause and mute release output with a 12 ms exponential envelope,
  snapping to exact silence below 1e-9.
- `stair_seek(engine, depth, direction)` independently scrubs the normalized
  0–1 depth and sets direction to ±1. Ordinary control/transport packets never
  seek or reset oscillators.
- `stair_process(engine, leftFloat32Pointer, rightFloat32Pointer, frames)` writes
  up to 4096 stereo samples. Buffers must be valid, sufficiently large, separate
  caller-owned allocations. Rendering contains no allocations, table analysis,
  DOM, timers or JavaScript DSP.
- `stair_state(engine)` returns borrowed `float64` state storage of length
  `stair_state_len()` (12): elapsed samples, normalized depth, direction,
  playing, enabled, hold, mode, table frame count, white onset count,
  table crossfade progress, present branch count, and white gate (0/1).
  Present branches have interpolated presence greater than 0.5 and nonzero
  length; this count includes branches during black rests. The clock advances
  even while paused; depth does not.
- `stair_voice_capacity()` returns 512. `stair_voice_state(engine)` returns
  borrowed float64 storage of `capacity * 6` values, refreshed only when this
  export is called: branch ID, current frequency in Hz, reference X, reference
  Y, reference-valid (0/1), parent ID. The reference is the previous note used
  to calculate the **current** note interval, so an explanatory arrow can remain
  visible through the white stripe. It is not overwritten by the new note's
  position. Hosts should also use field presence to filter displayed voices.

Mutating functions return 1 on success and 0 on invalid lengths/null pointers.
The host must follow ownership and alignment rules; the raw pointer ABI does
not validate arbitrary addresses inside WebAssembly memory.

## Field descriptors

Each frame describes one depth along the original instrument's slide sweep:

| Offset | Content |
| --- | --- |
| 0–255 | 256 centered contour X samples, uniform in arc length |
| 256–511 | Corresponding Y samples, positive upward |
| 512–527 | 16 normalized vertical band-area bins, sum 1 when available |
| 528 | Actual band mass fraction |
| 529 | Contour perimeter divided by 8 and clamped to 0–1 |
| 530–531 | Signed viewport centroid |
| 532 | Valid contour (0/1) |
| 533 | Normalized contour turning roughness |
| 534 | Actual smooth escape-depth threshold |
| 535 | Original stripe period in escape-depth units |
| 536 | Paired-edge source flag: literal 1 groups adjacent edge weights; 0 keeps independent centers |
| 537–543 | Reserved zeros |
| 544–3615 | 512 branch slots, six values each: presence, centroid X, centroid Y, length/8, ID, parent ID |

Slot 536 is an additive ABI 3 extension: old zero-filled tables keep independent
center normalization. Only finite literal 1 enables pairs; other values become
zero. It is categorical and is read from the incoming table, without blending
the source flag across a field replacement.

Branch presence, centroids and length are normalized 0–1. Centroid X goes
left to right; centroid Y goes top to bottom. Absent slots retain position
metadata but have zero presence. Branch identity is matched between prepared
depth frames by the worker. IDs are categorical integers 1–32768, with zero
meaning none. Identity comes from the nearest depth frame; coordinates are
interpolated only when adjacent frames agree on the identity, preventing a
reused slot from creating a fictitious connecting path. Parent assignment is a
worker-side geometric approximation, not a proof of fractal ancestry.

The worker omits cells touching unescaped samples. Missing contour frames have
no audible signal; their threshold/period still describe the sweep. The longest
eligible path supplies the contour waveform in mode 0. Mode 2 instead uses all
prepared branch slots, capped at 512. Open paths traverse outward and back so
they do not gain a fictitious closing edge. Geometry is interpolated across 64
depth frames and across a 60 ms scene crossfade. Topology changes are therefore
an interpolation approximation. Source analysis belongs to the worker.

## Four mappings

0. **Contour trace:** the measured X/Y path is a stereo wavetable at the base
   frequency. Perimeter adjusts level; brightness low-passes the trace. Linear
   wavetable interpolation and output filtering reduce sharpness, but this is
   not an exactly band-limited geometric oscillator.
1. **Area spectrum:** actual occupied-area bins weight 16 harmonic sine
   partials, with brightness tilt and Nyquist fade. Their base is a continuous
   frequency without scale quantization. Centroid shifts stereo partial phase.
2. **Stripe rhythm:** white (`floor(threshold / period * 2) % 2 == 1`) sustains
   notes; black releases them. Each prepared branch has its own oscillator,
   centered equally in both output channels at a fixed 0.5 gain per channel.
   Position feeds pitch and note history only. The selected mapping supplies pitch:
   Height uses `baseHz * 2^(span * (0.5 - y))`; Frame XY uses
   `baseHz * 2^(span * ((0.5 - y) + (x - 0.5)) / 2)`.
   Presence times length determines relative level. Geometry power normalization
   keeps independent voices audible as branches split or merge; see below.
   Detail adds soft second and third harmonics.
   Release maps to 8–160 ms to -80 dB, followed by exact silence below 1e-9.
   Hold sustains white or remains silent in black. The stripe gate is shared
   because every contour in a depth frame has the same escape threshold: the
   branches have separate pitches, not independent rhythms.
   There is no independent beat scheduler or scale quantization. Scrubbing
   adopts the current white/black state without replaying skipped events.
   Scene replacement uses the incoming threshold directly, avoiding invented
   stripe runs between unrelated fields; voice geometry still crossfades.
3. **Resonant body:** perimeter, mass and turning roughness set eight damped
   inharmonic modes. Noise excitation follows a slow traversal of the same
   contour. Body controls damping and brightness controls the output filter.
   A fixed artistic gain calibration makes comparisons with the other modes
   practical; it is not a physical material model.

## Relative Turns and branch inheritance

A measured voice returning after an absent interval takes a new Relative turns
note from its own previous reference, even inside an already-white stripe.
Holding a present voice does not repeatedly advance that history.

The worker can supply one record per branch center or two records per measured
block-edge pair. Paired records carry the actual edge X/Y positions, half the
tendril's level weight, and persistent side identities. Tendril ID `t` maps to
oscillator IDs `2*t-1` and `2*t`; parent IDs use the same side mapping. Thus the
existing 512-oscillator capacity supports at most 256 paired tendrils. Both
records share the depth gate and stay centered. The raw ABI and DSP mapping
rules are identical for either pitch source; switching source installs a field
and resets references while preserving the sample clock and transport.

Each white onset is a note; a newly appearing branch also receives a note if
the current stripe is white. The first note uses Frame XY. The first nonzero
movement establishes a heading without adding an interval. Subsequent notes
compare the current displacement against the preceding displacement:

`nextOffset = previousOffset + signedTurn / pi * min(1, 8 * distance) * span`

Offsets are in octaves relative to the register, and are **clamped** to ±4
octaves. Positive turns are clockwise in screen coordinates (Y downward).
Straight movement adds no interval; shorter movements scale the interval down.
Displacements below 1e-6 normalized frame units leave heading and offset alone.
Pitch holds between notes, and stationary Hold does not advance note history.
Internally pitch history is normalized to Span, so Span retunes held notes as
well as controlling subsequent intervals. Span zero sounds the register while
preserving stored pitch history; geometric references can still advance on
later note events. Raising Span restores the mapped pitch, within the ±4-octave
limit. Register changes transpose every voice without changing its history.

An offshoot inherits its parent's last note position, heading and pitch offset
before calculating its first displacement. All events at one onset read the
previous ledger before any are committed, avoiding dependence on slot order.
The preallocated 32769-entry ledger retains parents even after their physical
voice slots are reused. If no valid parent reference exists, the new branch
starts from Frame XY. Seeking, changing the field, or switching pitch mapping
invalidates references by an epoch; the next note starts fresh, without treating
an unrelated scene jump as a turn. A scene's raw new coordinates feed this
ledger while audible geometry crossfades over 60 ms.

No callback, note event, diagnostic read or field recall allocates or frees
memory. Zero-target, silent voices skip waveform work. The browser can select
fewer than 512 branches; the capacity is a bounded implementation limit, not a
claim that every device can run all voices without a dropout.

For the browser's 64-frame tables, replacing a settled scene copies the current
table into the reserved previous table. An interrupted fade (or another frame
count) uses the existing interpolated collapse. Both paths preserve clocks and
the 60 ms crossfade. The JS worklet renders audio before servicing a requested
display snapshot and circulates one reusable voice buffer with the main thread;
stalled display consumers cannot queue unbounded snapshots.

## Level calibration

For branch weight `w = presence * length`, independent centers use predicted
power `sum(w²)`. Paired edges use `sum((wLeft + wRight)²)` so two coincident
half-weight edges reproduce their original center's level. Each weight is
divided by `max(0.08, sqrt(power), sum(w) / 4)`. This preserves attenuation as
geometry vanishes and caps the boost over the former amplitude normalization
at approximately 12 dB. The incoming frame's explicit paired-source flag selects
the grouping. It never infers pairing from adjacent IDs or matching geometry.

Stripe rhythm receives fixed ×6 makeup before the existing output filter and
soft shaper. All modes retain phases through switching and scene edits. Output
rejects DC, soft-shapes, then applies ×0.89 headroom, the smoothed user gain,
and transport gate. The browser defaults to 75% Volume. Volume remains a linear
output control after shaping; lowering it does not change saturation. The final
sample stays inside ±0.89 at full Volume for finite inputs.

This is fixed gain and geometry compensation, not an audio-following gain
controller: black rests and release tails do not cause gain recovery. The
existing soft shaper adds harmonics at the higher drive. It is not an
oversampled true-peak limiter, and a measured LUFS result is passage-specific.
See `docs/staircase-studies.md` and `scripts/analyze-staircase-loudness.mjs` for
measurement conditions and reproduction. Automated tests establish mechanical
safety and separation; listening is still required to judge timbre and usefulness.

## Blendable spiral studies

Two additional ABI 3 controls support visual inspection. `stair_focus(engine,
firstId, secondId)` isolates exact field-local voice IDs, with `(0, 0)` restoring
all voices. The second ID may be zero for a single center voice. Filtering happens
after shared normalization; other voices release without resetting their phase,
pitch history or clock. Mapped-voice diagnostics remain unfiltered. The host must
clear focus when changing fields, since IDs have meaning within one prepared view.
`stair_gate(engine, enabled)` defaults to 1. Setting it to 0 keeps rhythmic voices
sustained through black depths while preserving measured stripe state and
note-event history. Transport and geometry presence still control audibility.
Default focus and gate preserve the original PCM exactly.

The additive ABI 3 exports preserve the existing field, controls and 12-value
state. With all five amounts zero, processing produces the exact pre-studies
PCM; the regression suite pins a render from the previous binary.

`stair_features(engine, float32Pointer, floatCount, frameCount)` installs the
matching sidecar after `stair_table`, synchronously in the same worklet message.
It has `frameCount * 512 * 6` values, and its frame count must equal the installed
base field. Each oscillator record is `[id, signedTurns, forkOffset, curvature,
travelTurns, confidence]`. ID is a categorical integer 1–32768; turns are bounded
±1024, fork offset ±16, curvature/confidence 0–1 and absolute turn travel 0–2048.
Every successful base-table install clears the accepted sidecar, so omitting a
new sidecar cannot reuse a previous scene's motion.

Only matching IDs with positive confidence are accepted. Adjacent records are
interpolated only when both IDs match and both confidences are positive.
Confidence zero holds previously accepted same-ID geometry; a fresh unsupported
identity remains neutral. The worker measures consistently oriented local
contour tangent changes, not winding around an exactly known spiral center.
Certified local fork relationships are geometric evidence, not a proof of
Mandelbrot ancestry. New trusted child features seed their first pitch directly;
already-audible oscillators use separate short transition slews. Audio filters
may retain an outgoing sound briefly, but no previous identity's feature history
is assigned to a new identity.

`stair_studies(engine, turnAmount, turnSpan, accentAmount, accentRate,
forkAmount, forkSpan, curvatureAmount, curvatureDrive, endlessAmount,
endlessDirection)` sets five independently blendable studies. Amounts are 0–1;
turn span is 0–3 octaves/turn, accent rate 1–32 accents/turn, fork span 0–4,
curvature drive 0–4, and endless direction −1/+1. Control changes slew over an
18 ms time constant without seeking or resetting the sample clock.

- **Turning:** accumulated signed local turns contribute continuous pitch.
  **Forks:** the prepared parent-relative displacement contributes continuous
  pitch divergence. Together their settled octave offset is
  `baseOffset * (1 - max(turnAmount, forkAmount)) + clamp(turnAmount * turnSpan *
  signedTurns + forkAmount * forkSpan * forkOffset, -6, 6)`.
  Full amount replaces static XY/Height/Relative pitch influence; partial amounts
  retain it. Active geometry pitch is bounded to 20 Hz…0.42 times sample rate.
  This audible floor means sufficiently low descending curves flatten.
- **Turn accents:** geometric absolute turn travel sets the phase of a cosine
  gain shape. With amount `a`, mean `m = 1 - .325a`, and swing `s = .325a`, gain
  is `(m + s*cos(2π*travelTurns*accentRate)) / sqrt(m²+s²/2)`. Full amount retains
  approximately .49 gain at its trough and reaches 1.40 at its peak. Cycle power
  compensation does not chase the audio envelope or fill black rests.
- **Curvature:** measured curvature times drive raises local harmonic brightness
  and adds fourth/fifth partials with a small level compensation. Harmonics fade
  before Nyquist. Detail still controls the shared output filter, so low Detail
  can soften the new partials.
- **Endless descent/ascent:** an artistic Shepard illusion, driven by measured
  absolute turn travel rather than elapsed time or arbitrary depth. Three octave
  components use squared-sine windows with constant window power (9/8), divided
  by its square root. Internal component phases transfer between octave lanes at
  wraps; incoming/outgoing lanes have zero weight there. Low/high-frequency
  components fade at the audible/Nyquist limits. Linear dry/wet blending can
  produce a modest intermediate power dip. This is a perceptual construction,
  not evidence that the actual geometry descends endlessly.

White/black gating, paired weights, centered output, release, mute and transport
remain unchanged. Features refresh from the audio sample clock every 32 samples,
including during black rests; accents never become a free-running LFO. Hold
fixes geometry, with only existing short control/transition slews settling.
Voice diagnostics report the carrier pitch; Shepard octave components remain
internal partials of the same logical oscillator. Both paired edges remain
centered, and 512 logical oscillators remain the maximum.

The octave bank and curvature source evaluate harmonics from bounded sine/cosine
rotations and re-anchor them every geometry refresh. All buffers are allocated
when the engine is created. Native tests count allocations through a full blend
and table/feature installation; `tests/staircase-spiral-dsp.test.mjs` covers
precise mappings, confidence/identity isolation, live transitions, timing,
maximal hostile input, and real prepared geometry. These checks establish DSP
behavior, not a listener's judgment of musical quality.

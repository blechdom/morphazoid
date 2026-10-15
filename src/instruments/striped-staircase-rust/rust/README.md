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
| 536–543 | Reserved zeros |
| 544–3615 | 512 branch slots, six values each: presence, centroid X, centroid Y, length/8, ID, parent ID |

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
   notes; black releases them. Each prepared branch has its own oscillator and
   stereo position from centroid X. The selected mapping supplies pitch:
   Height uses `baseHz * 2^(span * (0.5 - y))`; Frame XY uses
   `baseHz * 2^(span * ((0.5 - y) + (x - 0.5)) / 2)`.
   Presence times length determines relative level; normalization bounds the
   sum as branches split or merge. Detail adds soft second and third harmonics.
   Release maps to 8–160 ms to -80 dB, followed by exact silence below 1e-9.
   Hold sustains white or remains silent in black. The stripe gate is shared
   because every contour in a depth frame has the same escape threshold: the
   branches have separate pitches and positions, not independent rhythms.
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

All modes retain phases through switching and scene edits. Output rejects DC
and uses a bounded soft limiter before the user's gain. The final sample is
strictly inside ±1 for finite inputs. Automated tests establish mechanical
safety and separation; listening is still required to judge timbre and usefulness.

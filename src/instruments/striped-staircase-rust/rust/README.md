# Staircase Studies DSP

Dependency-free Rust `cdylib`/`rlib`, compiled to raw WebAssembly with no imports.
Build with `node scripts/build-staircase-wasm.mjs`; check the checked-in binary,
source hashes and exports with the same command plus `--check`. Native
`cargo test --manifest-path src/instruments/striped-staircase-rust/rust/Cargo.toml`
checks that processing and table recalls allocate/deallocate nothing. The
browser ABI is exercised by `node --test tests/staircase-dsp.test.mjs`.

This is an artistic sonification of sampled geometry. It does not model a
physical staircase, vibrating fractal material, or an exact Mandelbrot boundary.

## Raw ABI, version 2

- `stair_new(sampleRate: f64)` returns an opaque engine pointer; supported rates
  are 8–192 kHz. `stair_drop(engine)` releases it.
- `stair_alloc(bytes)` returns zeroed storage aligned to eight bytes.
  `stair_free(pointer, originalBytes)` releases caller-owned storage.
- `stair_table(engine, float32Pointer, floatCount, frameCount)` copies and
  sanitizes an entire prepared field; frames may be 0–64 and have stride 672.
  A zero-frame table clears the field through the normal 60 ms crossfade.
- `stair_controls(engine, mode, baseHz, brightness, body, gain, scanSeconds)`
  sets the mapping (0–3), continuous base frequency (20–1200 Hz), brightness,
  body/ring and gain (0–1), and one-way depth traversal time (2–200 seconds).
  Pitch, timbre, gain and mode changes slew rather than resetting phases.
  Body controls release in mode 2 and modal damping in mode 3; it has no
  destination in modes 0/1 and the browser disables it there.
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
| 544–671 | 32 stable branch slots, four values each: presence, centroid X, centroid Y, length/8 |

Branch presence, centroids and length are normalized 0–1. Centroid X goes
left to right; centroid Y goes top to bottom. Absent slots retain position
metadata but have zero presence. Branch identity is matched between prepared
depth frames by the worker, rather than reassigning an oscillator every frame.

The worker omits cells touching unescaped samples. Missing contour frames have
no audible signal; their threshold/period still describe the sweep. The longest
eligible path supplies the contour waveform in mode 0. Mode 2 instead uses all
prepared branch slots, capped at 32. Open paths traverse outward and back so
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
   notes; black releases them. Each prepared branch has its own oscillator at
   `baseHz * 2^((0.5 - centroidY) * 3)` and stereo position from centroid X.
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

All modes retain phases through switching and scene edits. Output rejects DC
and uses a bounded soft limiter before the user's gain. The final sample is
strictly inside ±1 for finite inputs. Automated tests establish mechanical
safety and separation; listening is still required to judge timbre and usefulness.

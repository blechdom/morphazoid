# Additional synthesis engines

Engine IDs 39–46 live in `core/src/expanded.rs`. They extend the encyclopedia's
mechanism coverage; their inclusion does not mean all eight techniques were
invented after 1996. Historical sources and classifications are recorded in the
catalog. These are compact teaching instruments, not measured acoustic models.

Each engine receives the common note frequency, gate, envelope and sixteen
normalized parameter slots. Only its named slots are active. Coefficients update
at most every 32 samples and are reused when their inputs are unchanged. State
and delay storage are allocated at construction; `next`, `note_on` and `reset`
allocate no memory. The shared core owns the final ADSR, DC removal and output
level control.

| ID | Implemented mechanism | Practical limits |
| --- | --- | --- |
| 39 | A master phase resets a slave at the fractional crossing time. Natural saw/pulse edges and the reset's value jump receive a two-sample polynomial BLEP residual when correction is enabled. Partial reset, reset-phase jitter and envelope-driven slave ratio alter the actual oscillator state. | The correction reduces value-discontinuity aliasing; it does not remove every derivative discontinuity. Master and slave increments are capped at 0.45 cycles/sample. |
| 40 | A harmonic source supplies exact sine/cosine quadrature. Complex modulation shifts each source partial by the same signed Hz offset. Upper/lower balance and dry/wet balance mix the corresponding signals. | This is synthesis from an analytic source, not a general imported-audio Hilbert shifter. Components outside the supported frequency band are omitted; negative translated frequencies reflect in real output. |
| 41 | A finite periodic sum of scaled and translated Morlet-like, Mexican-hat/Ricker, or Haar mother functions. Scale count, spacing, coefficient decay, translation and motion change the bank. Chirp changes the smooth mother functions. | Arbitrary scales are not an orthonormal analysis/reconstruction transform. Packets narrower than the supported sample spacing are omitted. Haar has no chirp control dependency. |
| 42 | Twelve logarithmic bands of filtered independent noise approximate a target power slope `P(f) ∝ f^-alpha`. Additional low/high cuts, sample hold, resonant filtering and level motion operate on that signal. | This is a finite-band approximation. The Gaussian option sums six uniform variables; binary excitation uses two variance-normalized levels. Cutoffs and sample hold modify the final measured slope. |
| 43 | A decaying shake-energy reservoir controls the probability and energy of collisions. Particle count changes event statistics and particle gain. Collision contact energy excites four damped complex resonators; continuous shaking replenishes the reservoir while the gate is held. | The resonances describe an abstract container. Collision probability is bounded, contact energies accumulate quadratically, and resonator gain is normalized to prevent increasing Q from causing unbounded level growth. |
| 44 | Three time planes implement the two-dimensional finite-difference wave equation on a 6–16-node grid per side. Strike/pickup coordinates, a Gaussian strike footprint, aspect and damping affect the field. | The conservative bound `lambda_x² + lambda_y² ≤ 0.49` limits wave speed at extreme pitch/tension. Missing-neighbor values interpolate between a fixed ghost boundary and a free boundary. This is a membrane, without a plate-stiffness term. |
| 45 | Two to eight fractional delay paths feed a Householder mixing matrix. A convex blend with the identity controls coupling; strictly lossy feedback, damping, per-path allpasses, saturation and inversion act inside the network. A short pitched/noise burst supplies excitation. | The matrix blend is contractive. Delay length is bounded by preallocated storage, and the network is an abstract struck resonator. Intermediate inversion values reduce loop gain; the midpoint removes feedback. |
| 46 | Fourth-order Runge–Kutta integrates the actual Rössler equations in double precision. Audio observes a selected coordinate mixture after a Rodrigues rotation around the `(1,1,1)` axis. | Pitch controls nominal simulation time, not an exact fundamental. The total step is bounded and extra substeps enforce a maximum integration step. Some control combinations escape a bounded attractor; an escaped state restarts at the selected deterministic initial condition, without substituting noise or another equation. |

The Rössler equations are:

```text
x' = -y - z
y' = x + a*y
z' = b + z*(x - c)
```

`expanded_tests.rs` checks all 68 meaningful controls with their dependencies
enabled, reproducible reset, finite combined extremes at 8/48/192 kHz, additive
frequency translation and opposite-sideband rejection, fractional BLEP
correction, collision statistics, measured noise tilt, membrane CFL and decay,
FDN decay, the reference Rössler trajectory and rotation energy preservation.

A separate factory-fixture pass also rendered all 64 new factory presets for 1.5 seconds
each and found finite, non-silent output. A four-second noise measurement at
48 kHz, using averaged Hann-windowed spectra over 100–7000 Hz, gave power slopes
of +0.755 for blue, −0.082 for white, −1.003 for pink and −1.755 for brown. These
measurements substantiate the finite-band approximation; they are not claims of
an exact spectrum at every cutoff, sample rate or hold setting. Numerical checks
do not substitute for listening tests.

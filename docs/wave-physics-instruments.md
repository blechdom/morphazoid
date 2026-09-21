# Wave-physics instruments — contracts

Three new instruments. Each takes a wave phenomenon that has no representation
anywhere in the repository (verified: zero matches for localization/disorder,
exceptional point/PT-symmetry/non-Hermitian, or time reversal across all source),
and makes it playable with live microphone input.

All three follow `contracts/audio-transport-v1.md`: Audio is an explicit
icon-only masthead arm, separate from transport. All three record the performer
into the instrument's own structure, so the phenomenon acts on *your* sound.

---

## 1. Freeze Point — `freeze-point`

**Identity.** A lattice of coupled resonators with one disorder control that has
a threshold: below it your sound floods the grid, above it the grid freezes and
traps it in a few cells.

- **Primary action:** hold Record and sing/play into a cell, then move Disorder.
- **Immediate feedback:** energy visibly spreading or refusing to spread, and a
  wash that narrows into isolated ringing pockets.
- **Non-goals:** not a claim of Anderson-localization fidelity, no 3-D lattice,
  no non-Hermitian extension in this pass.

### Causal model

```
mic energy into a cell -> lattice site excitation -> coupled diffusion limited by
site-frequency disorder -> per-cell resonator gain -> spreading wash or trapped pocket
```

| Player input | Model quantity | DSP destination | Audible expectation | Visual |
| --- | --- | --- | --- | --- |
| Record into a cell | site excitation, 0-1 | cell resonator burst gain | struck cell speaks first | cell flares |
| Disorder | site-frequency spread, 0-3 (dimensionless) | detune per cell + coupling gate | below ~1.2 diffuse wash; above, narrow trapped ring | spread radius contracts |
| Coupling | inter-site transfer, 0-1 | neighbour send gain | more coupling widens the wash | link brightness |
| Damping | site loss, 0.2-8 s | resonator decay | shorter or longer tails | cell fade rate |

**Threshold is the identity.** The instrument must make a qualitative change
audible at a specific Disorder value, not a gradual dulling.

**Bounds:** lattice capped at 12x12 = 144 sites; at most 48 sounding cells;
per-frame excitation ceiling; all resonator gains normalised by active count.

**Research ledger:** localization threshold behaviour — *observed mechanism,
approximated*. Specific critical exponents — *explicit non-claim*.

---

## 2. Scatter Ghost — `scatter-ghost`

**Identity.** Sing into a chamber of scatterers and hear ruin; press Reverse and
your phrase walks back out of the mush and refocuses at a point you can move.

- **Primary action:** Record a phrase, listen to it scattered, press Reverse.
- **Immediate feedback:** the scattered smear, then the refocus snapping into
  place at the focus marker.
- **Non-goals:** no measured room impulse responses, no true multiple-scattering
  solver, no claim of ultrasound-grade refocusing.

### Causal model

```
mic phrase -> convolution with a scatterer-derived impulse response -> smear;
time-reversed replay through the same response -> coherent refocus at the source point
```

| Player input | Model quantity | DSP destination | Audible expectation | Visual |
| --- | --- | --- | --- | --- |
| Drag scatterers | path set, 8-40 delays | IR tap times/gains | different smear character | obstacle positions |
| Focus point | source coordinate | IR recomputation | refocus sharpens at that point | focus marker |
| Reverse | replay direction | buffer reversal + reconvolution | mush reassembles into the phrase | wavefront collapses inward |
| Mismatch | scatterer perturbation after recording | IR divergence | refocus degrades audibly | moved obstacles highlighted |

**The teaching moment:** moving one scatterer *after* recording degrades the
refocus. That proves the smear was information, not noise.

**Bounds:** IR length capped at 1.5 s; 40 taps maximum; recording capped at 6 s;
convolution via a single `ConvolverNode` per direction.

**Research ledger:** time-reversal refocusing — *observed mechanism, simplified
to a sparse-tap model*. Sharpness limits — *explicit non-claim*.

---

## 3. Exceptional — `exceptional`

**Identity.** Two coupled resonators with balanced gain and loss. Tune toward the
exceptional point and the two partials of your sound do not merely converge —
they merge, and the instrument becomes almost too sensitive to play.

- **Primary action:** strike or sing, then move Gain/Loss balance toward the EP.
- **Immediate feedback:** two audible partials sliding together and fusing into a
  single mode; response amplitude rising sharply near the point.
- **Non-goals:** not a PT-symmetric metamaterial simulation, no exceptional
  points of order above 2, no claim about non-Hermitian topology.

### Causal model

```
mic excitation -> two coupled damped/amplified modes -> eigenvalue splitting that
collapses as gain-loss balance approaches the coupling -> partial spacing and
response magnitude
```

| Player input | Model quantity | DSP destination | Audible expectation | Visual |
| --- | --- | --- | --- | --- |
| Balance | gain-loss asymmetry, 0-2x coupling | mode eigenvalues | partials converge then fuse | eigenvalue dots meeting |
| Coupling | kappa, 1-200 Hz | mode split width | wider split, EP further out | link thickness |
| Centre | mean frequency, 60-2000 Hz | both resonators | register | vertical position |
| Nudge | perturbation epsilon | detune injection | response scales as sqrt(epsilon) near the EP | dot displacement |

**The identity is the square root.** Away from the EP a nudge moves the sound in
proportion; near it the same nudge moves it enormously. That asymmetry of feel is
the instrument.

**Bounds:** gain strictly below the self-oscillation threshold with a hard
limiter; balance clamped short of divergence; decay capped at 12 s.

**Research ledger:** eigenvalue coalescence and sqrt sensitivity — *observed
mechanism from the standard 2x2 non-Hermitian form*. Acoustic realisability —
*explicit non-claim*.

---

## Shared

- `src/wave-lab-shell.js` — Audio arm honouring the icon contract, shared output
  manager connection, microphone arm/release, recording buffer, teardown on
  `pagehide`.
- Microphone constraints: echo cancellation, noise suppression and AGC all off.
- Every page monitors live input on a dry path. A recorder that cannot hear
  itself is unusable, and Lumber Loops ships with that path muted
  (`lumber-app.js:1334`).
- Registration: `src/site/instrument-registry.js` Works-in-progress group,
  `src/instrument-catalog.js`, and `src/instrument-midi-capabilities.js` with
  `audioInput` true and a `processor` note mode.

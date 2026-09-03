# Digestazoid research and synthesis design

Digestazoid is a playable, stateful physical-model instrument. It is not a
sample player and it is not a medical simulator. Its sounds emerge from a
bounded network of compliant chambers, travelling constrictions, gas/liquid
slugs, viscosity-weighted flow, resonant events, and two pressure-driven soft
outlets.

The useful abstraction is:

```text
gesture / touch
  → gas amount + imposed volume + compartment pressure
  → hysteretic valve, wall pulse, bubble, or viscous slug
  → jet-noise / flow-change excitation
  → outlet + abdominal wall resonances
  → room, stethoscope, or inside-tube listening filter
```

This preserves physical cause and effect without pretending that a browser is
running a validated three-dimensional multiphase digestive-fluid simulation.

## Morphazoid lineage

- Jaw Harp contributes signed-pressure excitation, compliant resonant material,
  and pull/release interaction.
- Pink Trombonazoid and Hybrinx contribute persistent travelling-wave anatomy
  and the separation of a body from a time-varying gesture.
- Hiccup Head contributes pressure-driven lip and throat valves whose state is
  retained between gestures.
- Monsterzoid contributes a bounded compliant pressure network with media,
  valves, flow, and back pressure.
- Creaturezoid contributes the principle that a new gesture retargets one
  living body rather than layering another independent synth voice.

Digestazoid does not import those large processors. It uses small purpose-built
worklet-safe primitives so the gut topology remains distinct from a vocal tract.

## Recording analysis

Recordings are offline calibration references only. No recording is bundled,
streamed, convolved, granulated, or played by the instrument.

### Annotated medical bowel sounds

The primary calibration set is Zahra Mansour's **Bowel sounds signal** dataset
([Figshare item](https://figshare.com/articles/media/Bowel_sounds_signal/28595741),
[DOI](https://doi.org/10.6084/m9.figshare.28595741.v1)), published under CC BY
4.0. Its annotation vocabulary is especially useful for synthesis:

- SB: single burst / solitary click;
- MB: multiple burst / repeated clicks;
- CRS: continuous random sound / crepitating sweep;
- HS: harmonic sound / whistling sweep.

One complete mono, 48 kHz, 24-bit recording (`record_080524002_2.wav`) was
measured together with its annotation file: 465.048 seconds and 263 accepted
SB/MB/CRS/HS events. Each labeled interval was DC-centered, Hann-windowed, and
measured from 25–3000 Hz after a 16 kHz analysis resample. The values below are
Q1 / median / Q3. Peak frequency is the strongest FFT bin; centroid and 85%
rolloff reflect the contact microphone, body path, and capture chain as well as
the underlying source.

| Class | n | duration ms | peak Hz | centroid Hz | 85% rolloff Hz |
|---|---:|---:|---:|---:|---:|
| SB | 119 | 96 / **120** / 145 | 41 / **78** / 236 | 143 / **182** / 246 | 219 / **309** / 367 |
| MB | 83 | 1181 / **1445** / 1957 | 32 / **50** / 108 | 137 / **147** / 214 | 223 / **236** / 333 |
| CRS | 56 | 397 / **662** / 940 | 50 / **252** / 330 | 210 / **253** / 301 | 321 / **367** / 413 |
| HS | 5 | 193 / **193** / 322 | 313 / **322** / 324 | 264 / **324** / 373 | 328 / **336** / 496 |

HS has only five events in this file, so its narrow peak should be treated as a
useful target for this recording, not a population estimate. Digestazoid maps
these four families to isolated wall/bubble pulses, clustered pulses, irregular
sweeps, and short chirped resonances respectively.

A second historical reference is Wellcome Collection's 1963 **Bowel sounds**
recording ([catalog record](https://wellcomecollection.org/works/edcaa6qa)), a
17-minute public-domain clinical teaching tape with narration and multiple bowel
examples. It is retained as a listening reference, but its continuous spectrum
was not used for numerical tuning because the spoken explanation dominates a
blind whole-file measurement.

Published context agrees that bowel audio is primarily transient. The open
review [Computerized bowel sound analysis](https://link.springer.com/article/10.1186/s12938-019-0646-1)
reports most useful energy in roughly 100–500 Hz with little above 1500 Hz,
while the ultrasound/videofluoroscopy study
[Oscillating gas bubbles as the origin of bowel sounds](https://pubmed.ncbi.nlm.nih.gov/21793334/)
observed 1.5–7.2 mm gas bubbles and 258–1078 Hz sounds with the expected inverse
radius relationship.

### Sound-effect references

Three licensed Freesound previews were measured as deliberately non-medical
performance targets:

- InspectorJ, **Whoopee Cushion, Long, A.wav**
  ([source](https://freesound.org/people/InspectorJ/sounds/402628/), CC BY 4.0);
- Breviceps, **Burp!**
  ([source](https://freesound.org/people/Breviceps/sounds/444496/), CC0);
- lucidrib, **Fart sound. Quick.**
  ([source](https://freesound.org/people/lucidrib/sounds/712681/), CC0).

The compressed previews were downmixed to mono and analyzed at 16 kHz. A
46 ms Hann frame with 10 ms hop supplied active-frame peak tracks. Effective
activity used a conservative 10 ms RMS threshold, so it excludes leading and
trailing room silence.

| Recording | file duration | effective activity | global spectral peak | active-frame peak Q1 / median / Q3 |
|---|---:|---:|---:|---:|
| whoopee cushion | 1.641 s | ~0.85 s | 318 Hz | 328 / **391** / 453 Hz |
| short burp | 0.607 s | ~0.18 s | 131 Hz | 141 / **625** / 656 Hz |
| quick fart | 4.298 s | ~0.22 s | 298 Hz | 297 / **297** / 367 Hz |

The burp's low global peak plus brighter active-frame peaks argues for a low
reservoir/tract component combined with a short broadband mouth release. The
whoopee cushion's moving 328–453 Hz track is used as the center of the comic
high-tension valve range; lower-tension presets can be substantially deeper.

The physical interpretation is supported by the JASA abstract
[Physics of flatulence](https://doi.org/10.1121/10.0007996): pitch is generated
by vibrating soft outlet tissue, analogous to lip buzzing. A University of Iowa
[whoopee-cushion gas demonstration](https://instructional-resources.physics.uiowa.edu/3b3050-sound-helium-and-co2)
also separates source from filter: changing gas leaves the cushion's source
pitch nearly fixed, while an attached tube changes the radiated timbre.

### Heart / internal body pulse

PhysioNet/CinC Challenge 2016 example `training-a/a0001.wav` from the
[public heart-sound corpus](https://physionet.org/content/challenge-2016/1.0.0/)
was measured only to calibrate the optional low body-pulse nudge. The 35.666 s,
2 kHz mono example produced an envelope autocorrelation estimate of 0.98 s per
cycle, or 61.2 BPM. Its strongest whole-recording component was ~26 Hz, centroid
~46 Hz, and 85% rolloff ~66 Hz. Digestazoid therefore uses a quiet low double
impulse at 61 BPM. It is an animation and tissue-coupling ingredient, not a
heart auscultation or diagnosis feature.

## Physical references and shipped approximations

### Compliant gas reservoirs

The ideal-gas reference for a fast closed squeeze is the adiabatic tendency
\(PV^\gamma = \mathrm{constant}\), with \(\gamma \approx 1.4\) for air. Digestazoid does
not solve that equation in physical units. Its shipped control-rate model uses
a bounded normalized proxy: quadratic wall stretch, available gas headspace,
liquid/sludge occupancy, compliance, imposed compression, and pulse pressure.
Volume and pressure are clamped before every division.

Latex and soft tissue do not behave as linear springs over large inflation. The
open [balloon inflation study](https://link.springer.com/article/10.1007/s10659-021-09823-x)
shows the initial pressure maximum, soft middle region, and large-stretch
stiffening. That finding motivates the compliant Inflate/Deflate interaction,
but the current normalized curve does not claim to reproduce balloon
snap-through or latex hysteresis quantitatively.

### Pressure-driven soft valves

The motivating lip/reed reference is a projected mass–spring–damper gap:

\[
m\ddot h+c\dot h+k(h-h_0)=A_{eff}\Delta P,\qquad h\ge 0
\]

and a regularized orifice flow:

\[
U=C_d A\sqrt{2/\rho}\;\frac{\Delta P}
{(\Delta P^2+P_\epsilon^2)^{1/4}}.
\]

Near zero this regularized form is linear instead of having the infinite
derivative of an ideal square-root law; at larger gradients it approaches
signed square-root flow. The laminar-to-turbulent motivation follows
[NISTIR 6056](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir6056.pdf).

The shipped network is deliberately simpler. Each valve has different opening
and closing pressure thresholds, a smoothed nonnegative aperture, one-way
square-root flow, and decaying manual kick/pinch state. At audio rate a
pressure-gated phase oscillator changes aperture, pitch, harmonic fold, and jet
noise with reservoir drive and rubberiness. It is a stable perceptual
approximation of flutter, not a finite-mass contact solver, and it does not feed
resonator pressure back into a simulated tissue gap.

### Bubble modes

The nonlinear physical starting point for the radius of an isolated spherical
bubble is the Rayleigh–Plesset family of equations. In a common incompressible
form,

\[
\rho\left(R\ddot R+\frac{3}{2}\dot R^2\right)
=p_B-p_\infty-\frac{2\sigma}{R}-\frac{4\mu\dot R}{R}.
\]

For a vapor bubble, the interface also needs heat and mass transfer; the
[Caltech bubble-dynamics treatment](https://media.library.caltech.edu/CaltechBOOK:1995.001/chap2.htm)
shows why the thermal boundary problem makes literal boiling substantially more
than a gas-bubble oscillator. Digestazoid does not integrate Rayleigh–Plesset at
audio rate: the equation becomes stiff near collapse and would be both costly
and alias-prone in a browser worklet.

After a small disturbance, a free gas bubble can instead be approximated as a
damped oscillator. The Minnaert starting point is

\[
f_0=\frac{1}{2\pi R}\sqrt{\frac{3\gamma P_0}{\rho_l}}
\approx \frac{3.26}{R}\;\text{Hz},
\]

where radius (R) is metres. Confinement, viscosity, nonspherical slugs, and
soft tissue loading shift this value, so the radius control is physical but not
presented as an exact in-vivo ruler. In the shipped musical calibration,
`f = 322 × 8 / sizeMm`, bounded to 52–2576 Hz. The 8 mm control position is
therefore tied to the measured 322 Hz HS reference rather than asserted as a
literal free-water radius measurement.

Digestazoid now uses a fixed 28-slot bubble bank. Each slot is preallocated and
has one of three stable audio-rate responses:

- a submerged, inverse-size ring with a dirty nucleation click;
- a fast-rising neck/open-cavity chirp followed by broadband surface rupture;
- a large, slow, asymmetric viscous glug whose clean radial tone is heavily
  suppressed.

The **Bubble** gesture schedules a four-part emergence rather than one polite
sinusoid. **Burble** schedules 7–10 unequal, staggered underwater and surface
events. **Burple** favors several large glugs and delayed openings. Continuous
digestion adds a bounded stochastic seethe whose rate rises with gas, liquid,
wetness, and turbulence and falls sharply with viscosity. All active pockets
also drive shared 43 Hz body and 27 Hz abyss modes, a deliberately cheap proxy
for the fuller low-frequency content produced by coupled bubble clouds in
[SIGGRAPH 2023's coupled-bubble work](https://graphics.stanford.edu/papers/coupledbubbles/).

The event shapes and size statistics borrow the practical logic of
[Physically Based Models for Liquid Sounds](https://persianney.com/kvdoelcsubc/publications/prep04.pdf)
without claiming that this bounded perceptual model solves a multiphase fluid.

### Boiling, bubbling, fizzing, and glugging

These processes are related but not interchangeable:

- **Boiling** is a population of vapor-bubble lifecycles: wall nucleation,
  thermal growth, necking/departure or coalescence, and either collapse or
  survival to the surface. A synchronized 2026 experiment found departure and
  necking-induced liquid inrush to be its dominant sound source, and found
  vapor bubbles weaker and lower in frequency than equivalently sized injected
  gas bubbles ([International Journal of Heat and Mass Transfer](https://doi.org/10.1016/j.ijheatmasstransfer.2026.128508)).
  Consequently a convincing real-time boiling sound is an event scheduler
  feeding many damped voices, not one continuous noise or oscillator.
- **Injected or entrained gas bubbling** most directly fits the familiar
  Minnaert ring. A rising pocket can chirp upward as the effective surrounding
  water mass falls near the surface. The van den Doel model above supplies the
  practical damped, rising single-bubble response and stochastic population
  strategy used here.
- **Effervescence** is dominated after film rupture by a changing open cavity,
  which behaves more like an upward-drifting Helmholtz resonator than a closed
  Minnaert bubble. High-speed image/audio experiments model a glass of fizz as
  a population of those open resonators
  ([Physical Review Fluids](https://doi.org/10.1103/PhysRevFluids.6.013604)).
- **Glugging** is a much slower alternation between liquid discharge and gas
  admission set by the compressibility of the trapped gas. Digestazoid uses
  that alternation as a lumpy amplitude/envelope process; it does not mistake
  the few-hertz glug cycle for the audible pitch of each gas pocket
  ([Journal of Fluid Mechanics](https://doi.org/10.1017/S002211200400936X)).

The **Seethe / turbulence** control therefore does not pretend to be a
temperature dial. It is a playable event-density and rupture-irregularity
control inspired by boiling. A literal temperature/heat-flux model would also
need nucleation-site and thermal-growth state.

### Gut walls and event families

Wall motion uses bounded spring–damper state, and foreground events excite four
damped abdominal modes. This follows the approach in
[A mathematical model of bowel sound generation](https://doi.org/10.1121/1.5080528),
whose perceptually useful dimensions are component frequency, pressure index,
component count, and component interval. SB, MB, CRS, and HS share one event
path; their packet shape, noise, damping, and chirp differ. A new deliberate
gesture replaces the current foreground event, while the chamber, wall, fluid,
valve, and resonator state remains persistent.

### Sludge and viscous slugs

Yield-stress fluid suggests a useful fuller model in which material accumulates
gas/pressure until a threshold is crossed:

\[
\dot g=q_{in}-q_{leak},\qquad
g>\theta_{yield}\Rightarrow g\leftarrow g-\Delta g.
\]

Experiments on
[bubbles in yield-stress fluid](https://www.cambridge.org/core/journals/journal-of-fluid-mechanics/article/growth-and-stability-of-bubbles-in-a-yield-stress-fluid/B7979413F101E9BE49860F3759342604)
motivate the falling-and-recovering threshold in that equation. The shipped
control-rate model still does not keep an explicit yield-memory variable:
viscosity lowers material mobility, darkens and shortens slosh, lowers the
automatic bubble rate, and biases releases toward sparse large glugs. At audio
rate this shifts the aggregate away from frequent clean rings and toward
aperture-like rupture, conduit resonance, and delayed deflation. This follows viscous-fluid
burst experiments in which bubble vibration dominates below about 1 Pa·s,
whereas aperture growth and air-column resonance dominate above it
([Journal of Geophysical Research](https://doi.org/10.1029/2009JB006828)).

The especially filthy character is therefore closer to non-Newtonian or
volcanic degassing than to a saucepan of clear water. Experiments on elongated
bubbles at a non-Newtonian surface relate their duration and pitch to a changing
open cavity and explicitly connect the phenomenon to lava and foam acoustics
([Divoux et al.](https://arxiv.org/abs/0807.0094)). Other experiments show that
steady gas feed through such material can alternate between separate bubble
release and a winding open flue, with material memory affecting the regime
([intermittent outgassing study](https://arxiv.org/abs/0810.3095)). Digestazoid
borrows the clustered-versus-leaking behavior, but not yet the paper's explicit
rheological memory equation.

### Cavities, tubes, and listening position

The reference relation for a stomach/outlet cavity is Helmholtz resonance:

\[
f_H=\frac{c}{2\pi}\sqrt{\frac{A}{V L_{eff}}}.
\]

The source/filter split is important: tissue state sets flutter pitch, while
cavity volume, aperture, and path length color that source. The practical
formula and its end-correction limitations are summarized by
[UNSW Music Acoustics](https://www.phys.unsw.edu.au/~jw/Helmholtz.html).
Digestazoid currently approximates this coloring with fixed, damped body/outlet
modes and listening filters; it does not continuously recalculate a Helmholtz
frequency from anatomical units.

The three listening modes alter only radiation/filtering:

- **outside the body** emphasizes broad abdominal radiation and outlet sound;
- **stethoscope contact** emphasizes the measured 50–500 Hz internal event band;
- **inside the tube** exposes flow, bubble, and valve excitation with less body
  attenuation.

## Runtime and safety decisions

- One AudioWorklet owns the complete persistent body.
- Slow reservoir/peristalsis state advances at a fixed bounded control rate;
  audible outlet and resonator state advances per sample.
- Every public state and message is finite-checked and clamped.
- Valve frequency, aperture, pressure, flow, bubble size, damping, and resonator
  pole radius all have explicit safe ranges.
- One foreground bowel/wall event remains active at a time, while a separate
  fixed 28-slot bubble bank permits a finite burble cloud. When full, it steals
  the oldest slot rather than allocating memory or growing without bound.
- Seeded random excitation is deterministic.
- A DC blocker removes asymmetric flow offset and a final soft limiter bounds
  hostile combinations.
- Silence clears external drive and event radiation while the muted physical
  state continues its bounded decay; Reset deliberately rebuilds the body.
- Telemetry is rate-limited to approximately 20 Hz.

## Scientific limitation

There is strong evidence for the phenomena motivating this hybrid—soft-tissue
flutter, compliant pressure storage, bubble oscillation, gut-wall pulses,
yield-stress flow, and cavity/tube filtering—but no single validated model
unifies them into a complete audible human digestive tract. Digestazoid uses
bounded perceptual approximations of those phenomena and is therefore a
physically grounded musical model. It must not be used to identify normal or
pathological bowel, heart, reflux, or respiratory conditions.

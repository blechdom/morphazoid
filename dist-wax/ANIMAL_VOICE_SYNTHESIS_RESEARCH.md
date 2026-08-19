# Physical Animal-Voice Synthesis for Morphazoid

Research and implementation brief, 18 August 2026

## Decision in one paragraph

Do not build one rescaled “animal larynx.” Build a small family of interchangeable, pressure-driven sources and connect them to Morphazoid's existing branching vocal-tract waveguide. The useful minimum is: a two-mass tissue oscillator for mammals and many reptiles, a bilateral nonlinear syrinx for birds, a pressure-driven membrane source with multimodal radiation for frogs, and a jet whistle for mouse-like ultrasonic calls. Drive those sources with time-varying call gestures—pressure, tension, adduction, articulation and left/right balance—rather than treating each animal as a static timbre preset. Morphazoid already has most of the filter/radiator machinery; its largest missing pieces are self-oscillating sources, source–tract feedback, and true propagation-length control.

The intended target is a physically informed, playable instrument. It should preserve the important cause-and-effect relationships of an animal voice without claiming to be a finite-element anatomical simulator.

## What the current Syrinx page implements

The playable [`syrinx.html`](./syrinx.html) page is a reduced real-time implementation of this brief, separate from Throatazoid. It provides four source equations (two-mass tissue, bilateral syringeal labia, frog membrane, and impinging-jet whistle), a true propagation-length variable-area tube with species-informed diameter priors, signed source–tract pressure feedback, and a two-mode radiation filter. The modal filter represents family-specific OEC/beak, sac/head, pharyngeal, or body radiation; it is not yet an explicit side-branch waveguide and the page labels it accordingly.

Each animal has a permanently locked, species-informed playable range. Some anchors are direct measurements (notably lion/tiger and elephant excised larynges, ex-vivo bird phonation, frog pressure regimes, and mouse jet-whistle physiology); other animals use clearly labeled body-size or tract priors. The models are not individualized anatomical reconstructions. Mouse ultrasonic trajectories are explicitly mapped to audible frequency while retaining their jet-mode timing and jumps.

## Why several models are necessary

The vertebrate source–filter framework is the right common vocabulary: a sound source creates periodic or turbulent energy, and airways and radiating structures reshape its spectrum. It is not, however, one universal organ. The current comparative review by Fitch and colleagues is the best starting reference and also explains why human speech-analysis defaults often fail on animal sounds: [Formant analysis of vertebrate vocalizations](https://doi.org/10.1186/s12915-025-02188-w). For mammals specifically, see [Taylor and Reby's source–filter review](https://doi.org/10.1111/j.1469-7998.2009.00661.x).

| Family | Physical source | Important filter/radiator | Recommended real-time model |
| --- | --- | --- | --- |
| Most mammals | Laryngeal vocal folds; sometimes vocal membranes or ventricular folds contribute | Pharynx, mouth, nose and sometimes air sacs | One or two asymmetric two-mass oscillators into a variable-area waveguide |
| Birds | Paired labia in the syrinx, often independently controlled on the two bronchial sides | Bronchi, trachea, oropharyngeal–esophageal cavity and beak | One or two nonlinear oscillators plus tract delay and beak/OEC articulation |
| Frogs | Laryngeal vocal membranes driven by pulmonary pressure | Closed mouth, head, vocal sac, body and tympana can all radiate | Nonlinear tissue oscillator plus a measured modal radiation bank |
| Crocodilians and many reptiles | Laryngeal tissue source | Oral/pharyngeal tract | Two-mass source and waveguide, with species geometry |
| Mouse-like ultrasonic vocalization | Glottal jet impinging on a laryngeal wall, not vibrating vocal folds | Laryngeal/pharyngeal geometry | Jet whistle with discrete modes and jumps |
| Insects, fish and odontocetes | Stridulation, swim bladder, phonic lips or other mechanisms | Species-specific | Separate click, pulse, friction, impact or whistle modules—not a larynx preset |

This separation also creates musically useful hybrids: a syrinx source through a mammalian tract can be a valid Morphazoid sound even though it should not be labeled as a biological reconstruction.

## Recommended signal architecture

```text
call / performance gesture
    ├── subglottal or bronchial pressure
    ├── tissue tension / effective mass
    ├── adduction / rest opening
    ├── left-right balance and detuning
    └── tract, mouth, beak and cavity motion
                    │
                    ▼
       selectable source model bank
       ├── LF pulse (cheap compatibility source)
       ├── two-mass larynx
       ├── left + right syrinx oscillators
       ├── frog membrane oscillator
       ├── jet whistle
       └── turbulent / transient source
                    │ volume flow
                    ▼
      glottal junction ↔ variable-area waveguide
                    │        ├── nasal / air-sac / OEC branches
                    │        └── supraglottal pressure feedback
                    ▼
          mouth / beak / sac radiation
                    ▼
         body resonance and environment
```

Keep morphology and gesture independent. Morphology describes the instrument—tissue masses, stiffness ranges, tract length, area profile and side cavities. A gesture describes one call—parameter trajectories over time. That distinction makes calls editable and lets one anatomy perform many vocalizations.

## Fit with the existing Throatazoid engine

The current [`throatazoid-tract-processor.js`](./src/throatazoid-tract-processor.js) is already a strong tract foundation:

- a 44-section root-plus-mouth bidirectional volume-flow waveguide;
- area-discontinuity scattering, passive loss and glottal/lip reflections;
- multiple mouths, nasal branches, constrictions, frication and stop transients;
- a pressure manifold and multiple controllable pressure “glands”; and
- two substeps per audio sample, which provides useful waveguide resolution.

The current source is the main limitation. [`createInternalExciter`](./throatazoid-app.js) creates a Web Audio oscillator outside the physical-tract worklet. [`glottalHarmonics`](./src/throatazoid.js) gives it a useful LF-style periodic waveform, but its frequency is imposed and it does not begin oscillating because pressure crosses a phonation threshold. More importantly, the upstream oscillator cannot receive instantaneous supraglottal pressure from the tract. This prevents the source–filter coupling that produces jumps, subharmonics and unstable regimes in many real calls.

There is also a length-control issue. The root and mouth arrays always contain 44 propagating sections. `bodyLength` currently changes diameter profiles and visual/macro scaling, not the wave propagation delay. Interpreting one section as one substep at 48 kHz gives roughly

\[
\frac{343\ \mathrm{m/s}}{2\times 48{,}000\ \mathrm{s^{-1}}}=3.57\ \mathrm{mm},
\]

or about 15.7 cm across 44 sections. That is a human-scale tract. A real animal-size control must vary active section count, use fractional delay lines, or resample the area function into a waveguide whose total propagation delay represents the requested physical length. Large-animal tracts need more delay than the present fixed array can provide.

The architectural change is therefore specific: generate the pressure-driven source inside the same `AudioWorkletProcessor` as the tract, inject volume flow at the glottal/source junction, and return the local supraglottal pressure to the oscillator on every oversampled step. Keep the present oscillator path as a stable “LF / legacy” source option.

## Core physical models

### 1. Tract and source–filter baseline

In the frequency-domain shorthand,

\[
Y(\omega)=S(\omega)H(\omega),
\]

where the source spectrum \(S\) is shaped by the tract/radiator transfer function \(H\). The time-domain system should allow two-way coupling instead of assuming this product is always one-way.

For a uniform tube closed at the source and open at the mouth,

\[
F_n=\frac{(2n-1)c}{4L},\qquad
\Delta F=\frac{c}{2L},
\]

where \(c\) is about 343–350 m/s and \(L\) is tract length. These are useful sanity checks, not a replacement for the variable-area tract. Side cavities and constrictions add poles and zeros, and actual tissue boundaries add loss.

For adjacent lossless tube sections, the current engine's area scattering follows the Kelly–Lochbaum family. A pressure-wave reflection convention is commonly written

\[
r_i=\frac{A_i-A_{i+1}}{A_i+A_{i+1}},
\]

with the sign reversed under some flow-wave conventions. Clamp \(|r_i|<1\) and include frequency-dependent or distributed loss. A practical precedent for mammal effects is Wilkinson and Reiss's variable-radius waveguide and recording-derived reflection coefficients: [A physical model of mammalian vocalisation](https://www.eecs.qmul.ac.uk/~josh/documents/2016/wilkinson%20reiss%20-%202016.pdf).

### 2. Mammal and reptile tissue source

The two-mass vocal-fold model is the best first physical source: inexpensive enough for real time, capable of self-oscillation, and extensible into nonlinear regimes. Its canonical mechanical core is

\[
m_i\ddot{x}_i+r_i\dot{x}_i+k_i x_i+k_c(x_i-x_j)+F_{\mathrm{collision},i}
=F_{\mathrm{air},i},\qquad i\in\{1,2\}.
\]

The two displacements control upper and lower glottal areas. A quasi-steady flow approximation is

\[
U_g=C_d A_g\sqrt{\frac{2\max(P_{\mathrm{sub}}-P_{\mathrm{supra}},0)}{\rho}},
\]

with flow separation, collision and turbulence terms added around closure. Inject \(U_g\), not an arbitrary audio waveform, into the waveguide. The canonical source is [Ishizaka and Flanagan's two-mass model](https://doi.org/10.1002/j.1538-7305.1972.tb02651.x). Left/right detuning or a second coupled pair creates asymmetric vibration and gives access to period multiplication, biphonation and chaos; see the [asymmetric two-mass analysis](https://pubmed.ncbi.nlm.nih.gov/7699169/) and [nonlinear mammalian voice review](https://doi.org/10.1537/ase.171130).

Useful control relationships are:

- pressure raises amplitude and eventually crosses an onset threshold, but may also change register;
- stiffness/tension and lower effective mass generally raise \(F_0\);
- adduction changes onset pressure, leakage and open quotient;
- collision stiffness changes high-frequency energy and harshness;
- left/right asymmetry can move a stable oscillation through subharmonic and chaotic regimes; and
- longer tissue and longer tracts are separate controls: tissue scale changes source pitch, tract length changes resonance spacing.

Real anatomy supplies useful bounds. Excised lion/tiger larynges show low onset pressures and large, soft folds suited to low-frequency, spectrally dense calls: [Herbst et al.](https://doi.org/10.1371/journal.pone.0027029). Excised elephant larynges demonstrate very low self-sustained oscillation plus period multiplication and irregular regimes: [Herbst et al.](https://doi.org/10.1126/science.1219712). An alligator study is a particularly useful anatomy-to-two-mass template for reptiles: [Riede et al.](https://doi.org/10.1242/jeb.117101).

### 3. Bird syrinx source

Birds do not use a larynx as their main sound source. The syrinx sits at the bronchial split and can provide two independently controlled sound generators. Pressure, labial tension and adduction are the correct performance dimensions; ex-vivo evidence across bird groups supports a shared myoelastic-aerodynamic mechanism: [Elemans et al.](https://doi.org/10.1038/ncomms9978).

A small nonlinear oscillator is the best first implementation. One well-studied normal form is

\[
\dot{x}=y,
\]

\[
\dot{y}=\gamma^2[-\alpha(t)-\beta(t)x+x^2-x^3]
-\gamma(1+x)xy.
\]

Here \(x\) represents labial displacement, \(\alpha\) is pressure-related, \(\beta\) is tension-related and \(\gamma\) controls the time scale. A trajectory through the \((\alpha,\beta)\) plane crosses oscillation boundaries and produces syllables without explicitly drawing an audio-frequency pitch curve. The formulation and an automatic reconstruction workflow are documented by [Alonso et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4737419/); an accessible reference implementation and physical-model explanation are in [WaveSongs](https://wavesongs.github.io/contents/PhysicalModel.html).

Another minimal syrinx oscillator is

\[
\dot{x}=y,\qquad
\dot{y}=-kx-cx^2y+by-f_0,
\]

where \(b\) represents net excitation/pressure, \(k\) stiffness, \(f_0\) rest offset/adduction and \(c\) nonlinear saturation. It gives a very low-cost onset boundary and even-harmonic control; see [Laje, Gardner and Mindlin](https://doi.org/10.1103/PhysRevE.65.051921). For a more physical Bernoulli-driven flapping model coupled to two delay tubes, see [Gardner et al.](https://doi.org/10.1103/PhysRevLett.87.208101).

Instantiate two oscillators for left and right syringeal sides. Expose balance, independent tension, onset pressure, detune and weak coupling. Sum them only after each has interacted with its bronchial impedance. This produces genuine two-frequency biphonation rather than an effects-layer imitation.

Bird articulation should separately control tracheal length, beak gape and an OEC side cavity. Beak closure can strongly attenuate upper bands, while OEC and beak motion can track source frequency. Evidence and useful parameter ranges are available in studies of [beak gape](https://doi.org/10.1242/jeb.01378), [OEC resonance tracking](https://pmc.ncbi.nlm.nih.gov/articles/PMC1459391/) and a [micro-CT/acoustic model of sparrow articulation](https://doi.org/10.1098/rsif.2022.0728).

### 4. Frog source and radiation

A frog preset is not just a mammal oscillator with a large tremolo. Use a pressure-driven self-oscillating membrane source and give pressure enough range to cross silence, periodic sound, mode locking, jumps and noisy regimes. Excised treefrog measurements connect pressure, flow, amplitude and \(F_0\): [Gridi-Papp et al.](https://doi.org/10.1155/2014/198069). An ultrasonic frog experiment directly shows pressure-driven subharmonics, jumps and chaos: [Suthers et al.](https://doi.org/10.1242/jeb.02594).

The closed mouth, inflated vocal sac, head and tympana form a distributed radiator. Model them initially as a small bank of measured, damped modes whose gains depend on sac inflation and posture. Do not universally label the sac a Helmholtz resonator: a heliox experiment rejected that simple account in the tested species [Rand and Dudley](https://doi.org/10.1086/physzool.66.5.30163824). Closed-mouth spectral concentration and radiation are measured by [Gridi-Papp](https://doi.org/10.1121/1.2897001), and tympanic radiation is demonstrated by [Purgue](https://doi.org/10.1007/s003590050127).

### 5. Jet whistle, noise and transient sources

Mouse ultrasonic calls are best modeled as a glottal jet impinging on the thyroid wall. A useful first control relationship is the Strouhal scaling

\[
St=\frac{fd}{U},
\]

where jet speed \(U\), characteristic jet dimension \(d\) and geometry select stable modes. Use pressure to control jet speed, geometry to control the feedback distance and an explicit integer/mode state to create frequency jumps. The physical evidence is in [Mahrt et al.](https://doi.org/10.1016/j.cub.2016.08.032) and a later [three-dimensional validation study](https://pmc.ncbi.nlm.nih.gov/articles/PMC8742360/).

Authentic 70 kHz output cannot exist in a 48 kHz audio graph. Offer two modes:

1. an offline/high-rate renderer at 192 kHz or above for scientific-bandwidth output; and
2. a clearly labeled audible mapping that divides or heterodynes the ultrasonic trajectory while retaining its timing, jumps and modulation.

Retain the existing filtered-noise and stop-transient paths. They are needed for breathiness, hiss, turbulence, barks, clicks and attacks even when a tissue source is active.

## Instrument controls and morphing rules

Use a compact physical macro layer and keep model-specific parameters accessible in an advanced panel.

| Morphazoid control | Physical interpretation | Existing-control migration |
| --- | --- | --- |
| `BREATH` | Subglottal/bronchial pressure and turbulent flow | Split the present intensity/breath behavior into pressure and leak/noise |
| `TENSION` | Tissue stiffness/stress; primary source pitch influence | Replace imposed `exciterPitch` where a physical source is selected |
| `ADDUCTION` | Rest opening, phonation threshold and open quotient | Derive from `exciterTenseness` initially, then expose separately |
| `SOURCE SCALE` | Tissue length/mass, independent of tract | Split out of the current `bodyLength` macro |
| `TRACT LENGTH` | Propagation delay and approximate formant spacing | Make `bodyLength` change delay/active length, not only diameter |
| `ARTICULATION` | Time-varying tube areas, tongue/constriction and mouth/beak gape | Reuse the existing mouths, tongues and constrictions |
| `SIDE CAVITY` | Nose, air sac, OEC or sac/head modal coupling | Generalize the existing nasal branch structure |
| `ASYMMETRY` | Left/right detune, mass/stiffness mismatch, nonlinear roughness | Replace “growl as effect” with a path through oscillator regimes |
| `SOURCE BALANCE` | Syrinx side balance or paired-fold weighting | Reuse voice/mouth routing where practical |
| `GESTURE RATE` | Time scaling of an entire call trajectory | New call-level control |

Morphing must respect parameter geometry:

- interpolate frequency, stiffness, mass, length and area ratios in logarithmic space;
- represent pitch trajectories in cents or log frequency;
- keep tube areas positive and smooth area functions before updating reflections;
- smooth pressure and adduction at audio/control rate, while preserving intended sharp call attacks;
- crossfade between incompatible topologies or source families instead of interpolating their internal state;
- when changing tract length, preserve traveling-wave state through resampling or crossfade two waveguides; and
- expose a “biological lock” that clamps morphology and gesture to evidence-backed or clearly labeled species priors. The Syrinx page keeps this lock on permanently; deliberate hybrids belong in a separate experimental mode.

## Call gestures, not static presets

A preset should contain a morphology plus one or more gestures. A practical interchange format is:

```json
{
  "id": "mammal-low-roar",
  "sourceModel": "twoMass",
  "morphology": {
    "tractLengthM": 0.42,
    "areaProfile": [0.18, 0.22, 0.31, 0.48, 0.72],
    "sourceScale": 0.82,
    "sideCavities": [
      { "type": "airSac", "coupling": 0.28, "damping": 0.42 }
    ]
  },
  "gesture": {
    "durationMs": 1150,
    "pressure": [[0, 0], [0.08, 0.72], [0.72, 0.88], [1, 0]],
    "tension": [[0, 0.24], [0.55, 0.19], [1, 0.22]],
    "adduction": [[0, 0.55], [0.12, 0.82], [1, 0.62]],
    "mouthOpening": [[0, 0.18], [0.35, 0.72], [1, 0.9]],
    "sourceBalance": [[0, 0.48], [1, 0.56]]
  },
  "variation": { "timing": 0.03, "drift": 0.02, "seed": 8341 }
}
```

Normalized curve time is 0–1. Keep randomness deterministic by seed so a preset is reproducible.

Starter recipes:

| Call | Gesture design |
| --- | --- |
| Howl | Smooth pressure onset; stable two-mass regime; slow tension contour; mild vibrato; gradually changing mouth area |
| Bark | Fast pressure impulse; brief adduction; rapid mouth opening; noise/transient at release; optional register jump |
| Roar/growl | Large source scale, long tract, high pressure, low tension and controlled left/right asymmetry crossing a period-doubling boundary |
| Purr-like sound | Very low-frequency soft-tissue mode with alternating egressive/ingressive amplitude gating; do not synthesize it as ordinary audio-rate pitch alone |
| Bird syllable | A pressure/tension trajectory that enters and exits the oscillator's active region; beak/OEC movement coordinated with the source |
| Bird biphonation | Two syrinx sides with independent tension paths and balance; weak coupling rather than ring modulation |
| Frog trill | Repeated pressure pulses into a membrane source; closed-mouth/sac modal radiation; pressure-dependent mode changes |
| Mouse USV | Jet speed ramp plus discrete whistle-mode changes; render high-rate or use an explicitly audible mapping |

## Source API and DSP placement

A source contract should exchange physical quantities and avoid allocation in the audio callback:

```js
// Conceptual interface; values are preallocated scalars or typed arrays.
source.prepare(sampleRate, oversampleFactor);
source.setMorphology(morphology);
source.setControls(pressure, tension, adduction, asymmetry, balance);
const { volumeFlow, turbulence } = source.processStep(supraglottalPressure);
source.reset();
```

Recommended processing order for each oversampled step:

1. advance smoothed gesture controls;
2. read subglottal pressure and the previous source-junction return pressure;
3. integrate source states with a stable method;
4. resolve collision, clamp minimum area and compute volume flow;
5. inject flow and local turbulence into the source junction;
6. propagate/scatter the tract and its side branches; and
7. feed the new junction pressure back on the next substep.

Oversample nonlinear collision/source calculations by 4–8× initially, then profile. The tract can remain at its current effective rate if the interfaces are properly low-pass filtered. Bound all energy-producing terms, constrain passive reflection magnitudes, remove denormals and reset a model if any state becomes non-finite.

Generalize a nasal branch into a `sideCavity` object with topology, attachment index, neck area/length or modal frequencies, damping and radiation gain. Air sacs can shift resonances and modify source impedance rather than merely adding reverb; see [Riede et al. on vocal air sacs](https://pmc.ncbi.nlm.nih.gov/articles/PMC2677336/).

## Implementation sequence

### Phase 1 — make the present engine physically scalable

- Define `sourceModel`, morphology and gesture schemas.
- Move or duplicate the LF source into the worklet behind the source interface.
- Add true tract-length control with variable active delay or fractional delays.
- Add deterministic gesture interpolation and seeded variation.
- Measure current CPU, latency and output levels as regression baselines.

Exit criterion: LF and noise sources can play old presets through the new interface; doubling tract length approximately halves uniform-tube resonance spacing.

### Phase 2 — mammal/reptile source

- Implement one collision-safe two-mass oscillator with pressure onset.
- Feed supraglottal pressure back from the waveguide.
- Add asymmetry and optional paired oscillators.
- Generalize side cavities and add passive losses.
- Ship a small set of morphology-plus-gesture presets: howl, bark, roar and reptile bellow.

Exit criterion: the source falls silent below threshold, starts from numerical noise/seed excitation above it, and reaches subharmonic regimes through parameter motion without an effects-layer oscillator.

### Phase 3 — avian, frog and whistle families

- Add two syringeal normal-form oscillators and bilateral bronchial routing.
- Add beak/OEC articulation.
- Reuse the nonlinear integrator for a frog source and add sac/head/tympanic modal radiation.
- Add the jet-whistle mode state and high-rate/offline option.

Exit criterion: bird syllables arise from pressure/tension paths; biphonation comes from two sources; frog and whistle presets retain their characteristic transitions under control changes.

### Phase 4 — fitting and authoring tools

- Import annotated target recordings and store provenance/license metadata.
- Extract target features and fit gesture curves offline.
- Export only compact morphology/gesture JSON to the browser instrument.
- Add a gesture editor over the existing specimen/tract UI.

[Hagiwara et al.](https://arxiv.org/abs/2210.10857) showed that modular synthesizer parameters can be fitted to animal sounds with multi-resolution spectral objectives, and found evolutionary search more effective than the tested gradient methods. Use that as an offline authoring pattern, not an audio-thread dependency.

## Analysis and validation protocol

1. Collect 20–50 clean examples for each species/call class. Hold out complete individuals, not random clips from the same individual.
2. Preserve original bandwidth and record all analysis settings. Use both short STFT windows for attacks/jumps and long windows for harmonic and low-\(F_0\) resolution.
3. Annotate duration/envelope, \(F_0\), AM/FM rates, harmonic amplitudes, spectral slope, centroid, HNR/noise, pulses, jumps, subharmonics, biphonation and chaotic intervals.
4. Estimate tract length from anatomy before fitting formants. Predict plausible resonance spacing from \(c/(2L)\), then inspect several LPC orders manually. High-\(F_0\), sparse and chaotic calls can cause LPC to label harmonics as formants.
5. Fit timing/envelope first, source controls second, tract/cavity parameters third and transitions last.
6. Optimize multi-resolution log-spectral distance plus feature losses. Do not make sample-by-sample waveform phase the primary score.
7. Report \(F_0\) error in cents, resonance error, envelope/duration error, AM/FM error, spectrogram correlation and nonlinear-event counts.
8. Sweep the full control range. Verify finite bounded output, onset threshold, stable silence, monotonic trends within stable regimes and absence of zipper noise or aliasing.
9. Finish with blinded listening tests for naturalness, species/call identification and instrument qualities: continuity, controllability and repeatability.

Suggested tools are [Praat](https://praat.org/) for spectrogram, pitch, LPC and source–filter experiments; [BioSound/soundsig](https://github.com/theunissenlab/soundsig) for programmatic acoustic features; and [AVGN](https://github.com/timsainb/avgn) for organizing, clustering and interpolating animal syllables. Praat's [formant-analysis cautions](https://praat.org/manual/FAQ__Formant_analysis.html) are especially relevant.

Minimum automated DSP tests:

- deterministic output for a fixed seed and gesture;
- no NaN/Infinity or runaway energy at every parameter extreme;
- silence below phonation onset and decay after pressure release;
- increased stiffness raises \(F_0\) within one stable register;
- doubled physical tract length approximately halves resonance spacing;
- a side cavity creates the expected pole/zero or modal change;
- left/right sources generate two independent spectral tracks;
- no audio-thread allocation after initialization; and
- CPU and peak level budgets hold for the maximum source/tract count.

## Reference recordings and licensing

Reference recordings should constrain and evaluate the synthesizer; they do not need to ship inside it. For any commercial or public sound pack, prefer CC0/CC BY recordings or get written permission. Keep a machine-readable manifest with recording URL, recordist, species/individual, conditions, license version, attribution and every derived edit.

| Resource | Best use | Reuse note |
| --- | --- | --- |
| [Museum für Naturkunde Animal Sound Archive](https://www.museumfuernaturkunde.berlin/en/research/collection/animal-sound-archive/) | Cross-taxon search, including controlled recordings | License varies per recording; filter for high quality and suitable CC terms |
| [Zebra finch vocal repertoire](https://doi.org/10.6084/m9.figshare.11905533) | Clean, annotated syrinx/call fitting | CC BY 4.0 |
| [Guinea baboon vocalizations](https://doi.org/10.5281/zenodo.8239697) | Several mammal call classes and individuals | CC BY 4.0; automatically segmented subset contains errors/noise |
| [Xeno-canto](https://xeno-canto.org/) and its [API](https://xeno-canto.org/explore/api) | Broad discovery and behavioral metadata | Per-recording licenses; many recordings are NC or SA; retain attribution |
| [Macaulay Library](https://support.ebird.org/en/support/solutions/articles/48001064551-using-and-requesting-media) | High-quality reference and biological metadata | Copyright normally remains with recordist; request research/commercial rights as needed |
| [Watkins Marine Mammal Database](https://cis.whoi.edu/science/B/whalesounds/masterFiles.cfm) | Marine mammal comparison and non-laryngeal source study | Personal/academic terms; commercial reuse prohibited |
| [Alaskan humpback “whup” examples](https://doi.org/10.5061/dryad.ht76hdrn0) | Small, clear and easily reusable test set | CC0 1.0 |

Avoid training/fitting directly on compressed, reverberant field recordings when a clean captive or close-mic example exists. Use noisy field recordings later as robustness tests.

## Reference implementations and license boundary

| Project | What to learn from it | License implication |
| --- | --- | --- |
| [Pink Trombone](https://www.imaginary.org/program/pink-trombone) | 44-section interactive tract and articulation | MIT/Expat; already credited in Morphazoid's third-party notices |
| [sndkit](https://github.com/PaulBatchelor/sndkit) | Self-contained C89 LF glottis and tract algorithms; useful for comparison and tests | Tangled output is dual MIT/Unlicense; documentation is CC0 |
| [Voc](https://github.com/PaulBatchelor/voc) | Portable Pink-Trombone-derived glottis and tract implementation | Archived; core CWEB is MIT and generated C is public domain |
| [STK](https://github.com/thestk/stk) | Lightweight real-time formant synthesis fallback, especially `VoicForm` | Permissive STK license; it is an acoustic approximation, not an anatomical model |
| [WaveSongs](https://github.com/wavesongs/wavesongs) | Bird motor gestures, nonlinear source and delay-line/OEC structure | GPL-3.0; excellent executable reference, but do not copy code into an MIT-distributed core without accepting GPL obligations |
| [Lyrebird DSP contract](https://github.com/sha5b/Lyrebird/blob/main/docs/08-implementation.md) | Explicit browser `AudioWorklet` syrinx integration, oversampling and parameter calibration | Project code/prose is CC BY-NC-SA 4.0 and noncommercial; reference only for a commercial build |
| [soundgen](https://pmc.ncbi.nlm.nih.gov/articles/PMC6478631/) | High-level harmonic/noise animal-call generation and nonlinear-event controls | R package is GPL; use ideas/paper as reference |
| [Praat](https://praat.org/) | Analysis, inverse filtering and source–filter resynthesis | GPL; suitable as an external authoring tool |
| [BioSound/soundsig](https://github.com/theunissenlab/soundsig) | Reproducible acoustic feature extraction | MIT |
| [AVGN](https://github.com/timsainb/avgn) | Syllable segmentation and learned latent organization | MIT |

Equations and scientific findings can guide a fresh implementation, but source code remains governed by its license. Record the provenance of any implementation consulted and keep production code independently authored when licenses are incompatible.

## Short reading order

1. [Fitch et al. 2025](https://doi.org/10.1186/s12915-025-02188-w) for comparative source–filter analysis and its traps.
2. [Ishizaka and Flanagan 1972](https://doi.org/10.1002/j.1538-7305.1972.tb02651.x) for the canonical two-mass source.
3. [Gardner et al. 2001](https://doi.org/10.1103/PhysRevLett.87.208101) and [Laje et al. 2002](https://doi.org/10.1103/PhysRevE.65.051921) for controllable bird nonlinear sources.
4. [Wilkinson and Reiss 2016](https://www.eecs.qmul.ac.uk/~josh/documents/2016/wilkinson%20reiss%20-%202016.pdf) for mammalian effects through a physical waveguide.
5. [Tokuda 2018](https://doi.org/10.1537/ase.171130) and [Fitch et al. 2002](https://www.ece.uvic.ca/~bctill/papers/numacoust/Fitch_etal_2002.pdf) for why subharmonics, biphonation and chaos belong in the source model.
6. [Hagiwara et al. 2022](https://arxiv.org/abs/2210.10857) for fitting modular synthesis controls to target animal recordings.

## Bottom line

Morphazoid should evolve from “periodic exciter into an animal-shaped tract” to “gesture-controlled physical source coupled to a morphable tract.” The existing waveguide, branching paths, pressure controls and visual anatomy make this an incremental architectural extension rather than a rewrite. Implement true tract length and one self-oscillating two-mass source first; they unlock the largest improvement. Then add dual syrinx, frog radiation and jet-whistle modules as distinct source/radiator families.

# Synthesaurus

The [Synthesaurus](../synthesis.html) is a compact listening laboratory with
53 synthesis methods and 17 stereo processors, with eight presets per entry (560 total),
148 guided studies, and 4–16 meaningful controls per entry. Its organization follows actual sound-generation families discussed in
Curtis Roads’s *The Computer Music Tutorial* (1996), with additional established
techniques, later DSP developments, and learned sound-generation families. It is a
teaching implementation of those principles, not a transcription of the book’s
examples or a complete historical taxonomy.

Enable **Audio**, then choose a method or preset to hear one audition note.
The top **Input** menu defaults to **Synthesizer**, which can feed an optional
stereo processor. Mic/audio in, audio files, sample loops and test signals instead
feed the processor directly; their unused synthesis, arpeggiator and tuning controls
are hidden. Method-specific preset menus have a **Next** tour. The top dice
randomizes the whole musical instrument; local synthesis/arpeggiator dice change
parameters within the chosen method. Processor selection has no dice. Each
section remembers its edits and tour position while the page stays open. Output
and running Play remain under the performer's control. Notes and strikes can also be
played directly. Tempo spans 10–1,200 BPM. Direct-note playback repeats attacks for
strike methods and zero-sustain envelopes, or holds sustained methods. Complete
presets can recall tempo; live Audio and transport remain performer-owned.
The mixed preset tour also includes 37 bundled sample-processing scenes:
drums through comb filtering or bit reduction, bass through auto-wah or saturation,
chorused and phased keys, echoing strings and arpeggios, robotic or shifted voice
syllables, telephone-band speech, and reverberant birdsong. Each recalls its sample,
processor and wet mix with Loop enabled. Select a scene, enable Audio, and press
Play; changing scenes while playing keeps Play and the output volume in place.
The expanded bank adds animal recordings, meme-style effects, tabla and toy
gamelan, and original synthesized phrases across classical, rock, country, jazz,
dub, disco, chiptune and other styles. See [sample choices and credits](processing-input-samples.md).
The main dice also chooses sample loops on one in five draws. It combines any
of the 34 bundled recordings or rendered loops with fresh processor settings,
keeps a dry component audible, and enables looping without opening a file picker
or microphone. Audio arming, Play and master output remain unchanged.
Drag the added ADSR graph's A/D/R handles for time and S for sustain level.
Native decay, excitation and window parameters are grouped separately and explained
per method; the added envelope is not a claim about every historical instrument.
Rotary controls support exact-value entry. Discrete algorithms use menus; graphs
and X/Y controls exclusively own their displayed parameters. Sequence pitch can use
quantized tuning degrees, a continuous tuning contour or authored intervals.
The oscilloscope overlays the waveform on live frequency bars; **Spectrum overlay**
toggles those bars. The spectrogram shows how frequency content changes over time.
Both displays stay visible in a compact mobile dock while controls scroll. Some methods
make pitch ambiguous, and a nominal frequency need not equal the perceived pitch.

The [collected reference](../synthesaurus-reference.html) describes control-surface
sources, amplitude models, signal routing, sample provenance, historical dates and
implementation limits. Gesture scores, voltage stages and Euclidean pulse rings
are directly editable; other sequence families expose mechanism-specific readouts
beside their controls, with a separate optional note-output monitor.

The eight presets per method are reproducible starting points. They include
simple references, sustained textures, short transients, high and low registers,
and method-specific contrasts. The antialiasing banks intentionally contain
matched-pitch comparisons with only the algorithm changed. A preset’s listening
cue describes the intended relationship; it is not a claim of perceptual testing.
Presets and randomization preserve the master output level. Audio starts off.

## How the methods are classified

The dropdown groups synthesis and processing by mechanism. Historical dates now appear in the method dropdown and beside its label.
The source and qualification appear under Method notes & sources. These are
historical milestones: some identify a paper, a named implementation or an
approximate period. **By 1996** means the family was documented by Roads, not
invented in 1996. A software exemplar's date is not the age of every underlying
DSP operation. The structured source is `src/instruments/synthesis/chronology.js`. Several added techniques predate 1996 and fill omissions
in the original demo list; they are not presented as recent inventions.

- **Sample and grain synthesis:** sample playback, granular synthesis, and
  descriptor-based corpus concatenation. The latter selects actual analyzed
  fragments; it does not stand for a large external sound library.
- **Oscillators and waveform construction:** wavetable, Walsh functions,
  multiple-wavetable/vector, wave terrain, waveform segments, graphic waveform,
  scanned synthesis, alias-reduced oscillators, hard sync, and Rössler chaos.
  Scanned synthesis separates the physical model’s movement from its audio-rate
  readout. Rössler synthesis integrates a deterministic nonlinear system; it is
  not a stochastic noise generator and its nominal frequency is a time scale.
- **Additive and spectral synthesis:** additive partials, discrete summation
  formulas, phase-vocoder analysis–resynthesis, PADsynth, and multiscale wavelets.
  Additive retains eight gains and adds stretch, tilt, phase, offset and motion.
  Wavelets combine translations and scales of Morlet, Mexican-hat or Haar
  mothers; this finite synthesis bank does not claim an orthonormal analysis
  transform. PADsynth constructs broadened harmonic bands before inverse FFT.
- **Filtering and source–filter synthesis:** subtractive and LPC. Subtractive
  offers filter response, cutoff-envelope depth, drive and pulse width. LPC
  derives all-pole coefficients from sound and exposes order, pre-emphasis, pole
  radius and analysis length as well as excitation controls.
- **Modulation and phase shaping:** AM, ring modulation, FM, PM, phase distortion,
  vector phaseshaping, and single-sideband modulation/frequency shifting. FM and
  PM overlap mathematically for suitable signals; the demos expose their
  frequency and phase viewpoints. Frequency shifting translates spectral
  components by an additive offset, changing harmonic relationships.
- **Nonlinear waveshaping:** transfer-function shaping and antiderivative
  antialiasing (ADAA). ADAA and the alias-reduced oscillator/hard-sync options are
  implementation techniques within their source families. They reduce particular
  artifacts, can change high-frequency response, and do not promise alias-free
  output. Their comparison presets keep all other settings matched.
- **Physical models and resonators:** mass–spring, modal, nonlinear-excited
  waveguide, Karplus–Strong, stochastic particle shaker, two-dimensional
  finite-difference membrane, and feedback delay network (FDN) resonator. These
  are small teaching models with bounded numerical state. The shaker uses
  probabilistic collisions and damped resonances, the membrane propagates waves
  over a grid, and the FDN circulates an excitation through coupled lossy delays.
  Material and instrument words describe intended timbral behaviors, not
  calibrated measurements. The FDN is an abstract resonator, not a measured room.
- **Formant and pulse synthesis:** FOF, VOSIM, window-function formants and
  pulsars. FOF demonstrates one principle associated with CHANT rather than a
  complete CHANT implementation. Pulsar synthesis was already addressed in the
  original book. Pulse windows, onset/shape, phase, formant relationships and
  timing variation now have method-specific controls.
- **Noise and stochastic synthesis:** correlated noise modulation, bounded
  dynamic stochastic breakpoints, and colored/1/f noise. Dynamic stochastic
  synthesis demonstrates the random-walk principle associated with Xenakis; it
  does not reproduce a particular GENDY score. Colored noise uses finite-band
  approximations to spectral slopes, not an infinite exact scale-free process.
- **Neural and learned synthesis:** compact locally trained autoregressive,
  autoencoder, DDSP-controller and diffusion teaching models. The cited WaveNet,
  RAVE, DDSP and DiffWave publications identify the wider families. The page does
  not bundle those projects’ pretrained models or synthesize unrestricted text
  prompts. Added history/rate, latent-orbit, partial/noise and sampling controls
  act on inference and synthesis; they are not claims of newly trained
  conditioning inputs. See [model provenance](synthesis-neural-models.md).

These categories overlap. For example, scanned synthesis contains a physical
model but produces sound by scanning a waveform, while LPC combines analysis
with source–filter synthesis. The menu chooses one useful home per technique.

See the [historical and esoteric coverage research](synthesis-historical-research.md)
for Bell Labs singing, programmable sound chips, the original Karplus–Strong drum
variant, PAF, wavesets, automata, iterated maps, SMS, PCA and PSOLA. It distinguishes
existing demonstrations from proposed additions and records source-access limits.

## Sources and analysis

Sampling, granular, LPC, phase vocoder and corpus synthesis can use a local
audio file. The source is shared among those methods and stays in the browser.
The engine accepts at most 262,144 mono samples, approximately 5.46 seconds at
48 kHz. The browser prepares the source at the active engine sample rate.
The built-in source and corpus are generated locally; they are not archival
recordings or third-party samples. LPC derives a spectral model from source
windows, the phase vocoder uses FFT magnitudes and phase evolution, and corpus
selection uses descriptors measured from fragments.

Uploaded sound is runtime state, separate from a preset. A preset recalls
synthesis controls and envelopes while keeping the current source. The default
LPC models and generated corpus demonstrate the mechanism without implying
speech recognition, text-to-speech, a comprehensive phoneme inventory, or a
large external sound database.

## Singing loop controls

The Singing input has independent text and melody controls above its piano roll.
Text presets and the text dice offer short word phrases, open vowels and mouth
percussion. They fit the current melody's syllable slots while preserving its
pitches, timing and rests. Sinsy uses kana; the Csound vowel engines omit mouth
percussion because they render vowels only.

Five melody presets set pitches and lengths together. Separate pitch and note
length dice preserve the other axis and the lyrics, including an unapplied text
draft. Pitches stay in a moderate vocal range with repeated short motifs; lengths
fit ordinary two- or four-bar loops where the existing score allows it. These
controls preserve voice settings, output level, Audio arming and Play state.

## Engine and state contract

The browser sends a stable numeric method ID, sixteen normalized parameters,
frequency and ADSR values to the Rust engine. Each method exposes its 8–16 active
controls; unused slots are zero. IDs 0–38 retain the previous assignments, and
IDs 39–46 add hard sync, SSB, wavelets, colored noise, particle collisions,
membrane, FDN and Rössler respectively. The parameter inventory below is in
engine order. Displayed ranges map linearly unless marked logarithmic. Integer
counts are rounded except the legacy DSF partial count, VOSIM pulse count and stochastic breakpoint count,
which follow the engine’s floor quantization; named discrete menus and continuous shape blends are kept
distinct. Percent metadata and numeric inputs use displayed physical percentages,
while the audio engine still receives normalized 0–1 values.

Frequency is bounded to 20–8,000 Hz. Attack is 0.001–12 seconds, decay 0.002–12
seconds, release 0.003–16 seconds, and sustain 0–1. Engine sample rate and model
stability can impose additional effective frequency limits. Envelopes control
output articulation; internal damping and resonator decay also control the
sound. Very long attacks can hide short physical-model excitations, so the
struck-model presets use fast attacks.

Saved state is version 2 and sanitized before use. Version 1 retains its original
four controls (eight for additive and graphic waveform), converts widened ranges
through their original physical values, then initializes newly exposed slots to
preserving engine defaults. DSF/VOSIM/stochastic retain their actual legacy floor counts. Old padded zeros are not treated as
new synthesis settings. Version 2 retains all active controls. State contains no
live AudioContext, device, playback-clock or uploaded-buffer objects. A preset
has no master-volume field. The starting output is 0.7 with a maximum of 1.
Fixed per-preset gain calibration balances the factory bank before the shared
output protection stage; it does not follow or lift decaying tails.
Presets preserve output, transport, repeat settings and the loaded source.

Rust DSP is the synthesis layer. WebAssembly is its browser execution format;
CLAP is a native plugin interface and CPAL is a native/device audio interface.
They are different host boundaries, not interchangeable browser synthesis
libraries. See the implementation/build documentation for the supported target
commands and artifacts.

## References

1. Curtis Roads, [*The Computer Music Tutorial*](https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/),
   MIT Press, 1996. Broad synthesis and analysis–resynthesis reference. No book
   example code, scanned figures, or quoted passages are bundled.
2. Bill Verplank, Max Mathews and Rob Shaw, scanned synthesis, late 1990s–2000.
   [Historical overview with references](https://en.wikipedia.org/wiki/Scanned_synthesis).
3. Diemo Schwarz, [“Concatenative Sound Synthesis: The Early Years”](https://doi.org/10.1162/comj.2006.30.3.5),
   *Computer Music Journal* 30(3), 2006. Corpus-based musical sound mosaicing has
   older concatenative speech-synthesis predecessors.
4. Paul Nasca, [PADsynth algorithm](https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm),
   2005. Frequency-domain harmonic-band construction and inverse FFT.
5. Jari Kleimola, Victor Lazzarini, Joseph Timoney and Vesa Välimäki,
   [“Vector Phaseshaping Synthesis”](https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf),
   DAFx 2011. The publication describes both control-rate and audio-rate phase
   map manipulation; the page’s modulation control demonstrates a bounded range.
6. Aäron van den Oord et al., [“WaveNet: A Generative Model for Raw Audio”](https://arxiv.org/abs/1609.03499),
   2016. Autoregressive neural audio family reference.
7. Antoine Caillon and Philippe Esling, [“RAVE: A Variational Autoencoder for Fast
   and High-Quality Neural Audio Synthesis”](https://arxiv.org/abs/2111.05011),
   2021. Learned latent-space audio family reference.
8. Jesse Engel et al., [“DDSP: Differentiable Digital Signal Processing”](https://arxiv.org/abs/2001.04643),
   2020. Learned control of differentiable DSP blocks.
9. Zhifeng Kong et al., [“DiffWave: A Versatile Diffusion Model for Audio Synthesis”](https://arxiv.org/abs/2009.09761),
   2020. Diffusion audio family reference.
10. Vesa Välimäki et al., [“Alias-Suppressed Oscillators Based on Differentiated
    Polynomial Waveforms”](https://doi.org/10.1109/TASL.2009.2026507),
    *IEEE Transactions on Audio, Speech, and Language Processing*, 2010.
11. Julian D. Parker, Vadim Zavalishin and Efflam Le Bivic,
    [“Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time
    Convolution”](https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf),
    DAFx 2016. Antiderivative-based averaging of nonlinear transfer functions.

12. Eli Brandt, [“Hard Sync Without Aliasing”](https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf),
    ICMC 2001. Hard sync is older; the paper concerns digital reset correction.
13. Miller Puckette, [*The Theory and Technique of Electronic Music*](https://msp.ucsd.edu/techniques/latest/book.pdf),
    frequency shifting and quadrature networks.
14. Stéphane Mallat, [“A theory for multiresolution signal decomposition: the wavelet
    representation”](https://doi.org/10.1109/34.192463), 1989. Also Vetterli,
    Kovačević and Goyal, [*Foundations of Signal Processing*](https://www.fourierandwavelets.org/FSP_v1.1_2014.pdf),
    for scale/translation wavelet construction.
15. Richard Voss and John Clarke, [“‘1/f noise’ in music: Music from 1/f noise”](https://doi.org/10.1121/1.381721), 1978.
16. Perry Cook, [“Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive
    Sounds”](https://doi.org/10.2307/3681012), 1997. See also author-maintained
    [STK Shakers documentation](https://ccrma.stanford.edu/software/stk/classstk_1_1Shakers.html).
17. Stefan Bilbao, [*Numerical Sound Synthesis*](https://doi.org/10.1002/9780470749012),
    2009. Finite-difference modeling and stability of musical systems.
18. Julius O. Smith, [*Feedback Delay Networks*](https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html),
    *Physical Audio Signal Processing*. See also the
    [digital waveguide mesh discussion](https://ccrma.stanford.edu/~jos/pasp/Digital_Waveguide_Mesh.html).
19. Otto E. Rössler, [“An equation for continuous chaos”](https://doi.org/10.1016/0375-9601(76)90101-8), 1976.

References support the synthesis principles, not a claim that every demo
reproduces its referenced system. Source titles and publication metadata were
checked, with author-hosted full text used where available. No book example
code, scanned illustrations or large pretrained model weights are bundled.

## Mechanisms and research boundaries

The additions were selected for distinct mechanisms that can be demonstrated in
a small instrument. They extend this catalog's coverage; the dates below do not
assert that all eight are developments after Roads's first edition.

| Addition | Principle used by the demo | Research source and limits |
| --- | --- | --- |
| Hard sync | A master phase wrap resets a faster slave; slave ratio and reset phase reshape the repeating waveform. Optional correction treats reset discontinuities. | [Brandt, 2001](https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf), author-hosted paper retrieved. Hard sync is older than this paper. Correction reduces specific aliases; the demo does not claim completely band-limited output. |
| Single-sideband / frequency shifting | The quadrature relationship `Re[(x+iH{x}) exp(i2πΔft)]` motivates selected-sideband construction. A known synthetic source can generate quadrature components directly. | [Puckette, frequency-shifting discussion](https://msp.ucsd.edu/techniques/latest/book.pdf), author-hosted text retrieved. The demo uses a synthetic source, not a general-purpose uploaded-audio Hilbert transformer. Negative translated frequencies reflect in a real-valued output; this is not ordinary pitch scaling. |
| Multiscale wavelets | Combine translated/scaled mother functions: `Σ a[j,k] · 2^(j/2) · ψ(2^j t−k)`. Multiple scales contribute different resolutions of localized detail. | [Mallat, 1989](https://doi.org/10.1109/34.192463), publication metadata checked; [Vetterli, Kovačević and Goyal](https://www.fourierandwavelets.org/FSP_v1.1_2014.pdf), author-hosted text retrieved. The finite periodic bank is a synthesis application, not a promise of perfect-reconstruction or an orthonormal transform. |
| Colored / 1/f noise | Target spectral power slopes follow `P(f) ∝ f^(−α)` over a finite band; filtering and resonance shape random excitation. | [Voss and Clarke, 1978](https://doi.org/10.1121/1.381721), exact publication metadata verified; publisher full text was inaccessible. The real-time model approximates the slope and has finite bandwidth, state and sample rate. |
| Particle shaker | A decaying energy reservoir drives probabilistic collisions; each collision excites damped resonances. Particle population and contact characteristics alter the events. | [Cook, PhISM, 1997](https://doi.org/10.2307/3681012), metadata verified; JSTOR full text was inaccessible. The [STK Shakers documentation](https://ccrma.stanford.edu/software/stk/classstk_1_1Shakers.html) was retrieved. This is a small collision/resonator model, not measured material data or sampled percussion. |
| Two-dimensional membrane | A grid approximates the wave equation using the current/previous displacement and neighboring nodes. Strike, pickup, aspect and boundary behavior select different modal mixtures. | [Bilbao, 2009](https://doi.org/10.1002/9780470749012), metadata verified; book full text was not retrieved. [Smith's waveguide-mesh discussion](https://ccrma.stanford.edu/~jos/pasp/Digital_Waveguide_Mesh.html) was retrieved. Numerical time/space steps must obey stability limits; the small grid is not a calibrated membrane or a stiff-plate model. |
| FDN resonator | Delay outputs feed a mixing network, damping and feedback: `d_i = excitation_i + g_i Σ A_ij LP(v_j)`. Delay relationships and losses determine the resonant spectrum. | [Smith, Feedback Delay Networks](https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html), retrieved. FDNs have a long reverberation history; here they are excited as a synth resonator. A lossy bounded network does not imply a particular measured room. |
| Rössler oscillator | Integrate `x′=−y−z`, `y′=x+a·y`, `z′=b+z·(x−c)` and project the three state coordinates to audio. | [Rössler, 1976](https://doi.org/10.1016/0375-9601(76)90101-8), exact title/year metadata verified; full text was not retrieved. This is deterministic nonlinear motion. Some regimes are more regular, and the nominal frequency is a time scale rather than guaranteed musical pitch. |

Further research could add phase-coupled oscillator networks (where oscillator
phases interact and synchronize) and wave-digital circuit models. The latter
uses wave variables, passive junction scattering and reactive state; see
[Fettweis, “Wave digital filters: Theory and practice,” 1986](https://doi.org/10.1109/PROC.1986.13458)
(publication metadata verified). Neither framework is implemented in this
version. A detuned oscillator bank alone would not demonstrate phase coupling,
and a memoryless transfer function alone would not demonstrate a circuit model.

See [new-engine implementation and numerical limits](synthesis-expanded-engines.md) for the eight added engines.

## Parameter inventory

| ID | Method | Parameters in engine order |
| --- | --- | --- |
| 0 | Sampling / sample playback | Position: 0%–100%; Loop length: 3%–100%; Rate variation: 0%–100%; Direction: Forward / Reverse; Start jitter: 0–1; Loop crossfade: 0 samples–256 samples; Fine tune: -100 cents–100 cents; Sample interpolation: 0–1 |
| 1 | Wavetable synthesis | Shape: 0%–100%; Brightness: 0%–100%; Pulse width: 5%–95%; Interpolation: 0%–100%; Table resolution: 16 samples–2048 samples (log); Phase offset: 0 cycles–1 cycles; Wavefold: 0–1; Unison mix: 0–1 |
| 2 | Additive synthesis | Partial 1: 0%–100%; Partial 2: 0%–100%; Partial 3: 0%–100%; Partial 4: 0%–100%; Partial 5: 0%–100%; Partial 6: 0%–100%; Partial 7: 0%–100%; Partial 8: 0%–100%; Harmonic stretch: 1–1.8; Spectral tilt: -24 dB/oct–24 dB/oct; Odd / even bias: -1–1; Partial detune: 0 cents–60 cents; Phase spread: 0 cycles–1 cycles; Partial offset: -1–1; Partial motion: 0–1; Motion rate: 0.1 Hz–12 Hz |
| 3 | Walsh-function synthesis | Basis order: 1–16; Odd / even: 0%–100%; Sequency: 1–8; Smoothing: 0%–100%; Phase offset: 0 cycles–1 cycles; Basis gap: 1–16; Sequency motion: 0–8; Motion rate: 0.1 Hz–10 Hz |
| 4 | Multiple-wavetable / vector synthesis | Vector X: 0%–100%; Vector Y: 0%–100%; Detune: 0 cents–40 cents; Drift: 0%–100%; Vector orbit: 0–1; Orbit rate: 0.02 Hz–10 Hz; Corner A waveform: 0–3; Corner B waveform: 0–3; Corner C waveform: 0–3; Corner D waveform: 0–3 |
| 5 | Wave-terrain synthesis | X radius: 5%–100%; Y radius: 5%–100%; Path ratio: 0.25 ×–4 ×; Terrain height: 0%–100%; Surface ripples: 1–12; X offset: -1–1; Y offset: -1–1; Terrain rotation: 0 degrees–360 degrees |
| 6 | Granular synthesis | Grain size: 1 ms–500 ms; Density: 1 /s–200 /s; Position spray: 0%–100%; Pitch spread: 0 st–24 st; Source position: 0–1; Scan speed: -2 ×–2 ×; Reverse probability: 0–1; Grain window: Hann / Triangle / Blackman |
| 7 | Subtractive synthesis | Cutoff: 20 Hz–20000 Hz (log); Resonance: 0%–100%; Wave shape: 0%–100%; Noise: 0%–100%; Filter mode: Lowpass / Bandpass / Highpass / Notch; Cutoff envelope: -8 octaves–8 octaves; Filter drive: 1–12; Pulse width: 0.02–0.98 |
| 8 | Linear predictive coding (LPC) | Model / vowel: 0%–100%; Breath: 0%–100%; Analysis spectral scale: 0.65 ×–1.7 ×; Excitation shape: 0%–100%; Model order: 2 poles–24 poles; Pre-emphasis: 0–0.98; Pole radius: 0.94–0.9995; Analysis length: 128 samples–2048 samples (log) |
| 9 | Amplitude modulation (AM) | Frequency ratio: 0.0625 ×–32 ×; Depth: 0%–100%; Modulator shape: 0%–100%; Bias: 0%–100%; Carrier shape: 0–3; Modulator phase: 0 cycles–1 cycles; Carrier harmonic: 1–8; Modulator offset: -24 Hz–24 Hz |
| 10 | Ring modulation | Frequency ratio: 0.0625 ×–32 ×; Carrier shape: 0%–100%; Modulator shape: 0%–100%; Offset: 0%–100%; Carrier transpose: -24 semitones–24 semitones; Modulator phase: 0 cycles–1 cycles; Rectification: 0–1; Input drive: 1–8 |
| 11 | Frequency modulation (FM) | Frequency ratio: 0.0625 ×–32 ×; Index: 0–32; Feedback: 0%–100%; Index envelope: 0%–100%; Second operator ratio: 0.1–12; Second operator depth: 0–8; Parallel / serial: 0–1; Feedback delay: 1 samples–64 samples |
| 12 | Phase modulation (PM) | Frequency ratio: 0.0625 ×–32 ×; Phase depth: 0 rad–32 rad; Feedback: 0%–100%; Modulator shape: 0%–100%; Second operator ratio: 0.1–12; Second operator depth: 0–8; Parallel / serial: 0–1; Feedback delay: 1 samples–64 samples |
| 13 | Phase-distortion synthesis | Breakpoint: 2%–98%; Distortion amount: 0%–100%; Resonance: 1 ×–8 ×; Pulse character: 0%–100%; Phase offset: 0 cycles–1 cycles; Second breakpoint: 0.02–0.98; Second distortion: 0–1; Resonance damping: 0–1 |
| 14 | Waveshaping | Drive: 1 ×–12 ×; Fold: 0%–100%; Asymmetry: -1–1; Transfer shape: 0%–100%; Source waveform: 0–3; Shaping mix: 0–1; Fold multiplier: 1–8; Quantization: 4 bits–24 bits |
| 15 | Discrete summation formulas (DSF) | Partial spacing: 0.03125 ×–16 ×; Rolloff: 0%–98%; Partial count: 1–256; Odd / even: 0%–100%; Carrier offset: -2 partials–2 partials; Spacing phase: 0 cycles–1 cycles; Partial phase step: 0 degrees–180 degrees; Spacing fine tune: -50 cents–50 cents; Partial count multiplier: 1–8 |
| 16 | Physical modeling: mass–spring | Stiffness: 0%–100%; Damping: 0%–100%; Strike position: 0%–100%; Mass gradient: 0%–100%; Spring nonlinearity: 0–2; Tension envelope: -2 octaves–2 octaves; Pickup position: 0–1; Clamped / free ends: 0–1; Strike width: 0.01–0.4; Mass count: 8–32 |
| 17 | Modal synthesis | Inharmonicity: 0%–100%; Modal decay: 0.01 s–30 s; Strike position: 0%–100%; Brightness: 0%–100%; Mode count: 1–16; Mode detune: 0 cents–50 cents; Decay tilt: -2–2; Partial tilt: -2–2; Strike hardness: 0–1; Strike noise: 0–1 |
| 18 | Digital waveguide / nonlinear excitation | Pressure: 0%–100%; Reed stiffness: 0%–100%; Loss: 0%–100%; Bore character: 0%–100%; Reed opening: 0.1–1.2; Reed curve: 0.5–2; Pressure vibrato: 0–0.1; Vibrato rate: 0.1 Hz–12 Hz; Breath noise: 0–0.3; Reed lower limit: -1–0 |
| 19 | Karplus–Strong synthesis | Damping: 0%–100%; Decay: 0.01 s–30 s; Pick position: 2%–98%; Excitation color: 0%–100%; String dispersion: 0–0.8; Feedback inversion: 0–1; Excitation length: 0.1–1; Noise / displacement: 0–1; Pick noise burst: 0 ms–20 ms |
| 20 | FOF / CHANT formant synthesis | Formant: 80 Hz–12000 Hz; Bandwidth: 30 Hz–600 Hz; Grain decay span: 3 τ–8 τ; Second formant: 0%–100%; Grain onset: 0.1 ms–10 ms; Second formant ratio: 1–4; Grain phase: 0 cycles–1 cycles; Formant jitter: 0–0.4 |
| 21 | VOSIM | Formant: 80 Hz–12000 Hz; Pulses: 1–32; Damping: 0%–100%; Silence: 0%–100%; Pulse curvature: 0.2–4; Alternating pulses: 0–1; Formant chirp: -24 semitones–24 semitones; Cycle jitter: 0–1 |
| 22 | Window-function formant synthesis | Formant: 80 Hz–12000 Hz; Window width: 0%–100%; Window skew: 0%–100%; Second formant: 0%–100%; Window: Gaussian → Hann → triangle: 0–2; Carrier phase: 0 cycles–1 cycles; Second formant ratio: 1–5; Window drift: 0–1 |
| 23 | Waveform-segment synthesis | Breakpoint: 5%–95%; Segment level: -1–1; Curvature: 0%–100%; Steps: 2–32; Start level: -1–1; End level: -1–1; Return curvature: -2–2; Rectification: 0–1 |
| 24 | Graphic waveform synthesis | Point 1: -1–1; Point 2: -1–1; Point 3: -1–1; Point 4: -1–1; Point 5: -1–1; Point 6: -1–1; Point 7: -1–1; Point 8: -1–1; Midpoint 1 offset: -1–1; Midpoint 2 offset: -1–1; Midpoint 3 offset: -1–1; Midpoint 4 offset: -1–1; Midpoint 5 offset: -1–1; Midpoint 6 offset: -1–1; Midpoint 7 offset: -1–1; Midpoint 8 offset: -1–1 |
| 25 | Noise modulation | Depth: 0%–100%; Noise rate: 0.2 Hz–2000 Hz (log); Correlation: 0%–100%; AM → FM: 0%–100%; Carrier shape: 0–3; Depth envelope: -1–1; Noise distribution: Uniform / Gaussian / Binary; Noise seed: 0–1 |
| 26 | Dynamic stochastic synthesis | Amplitude step: 0%–100%; Duration step: 0%–100%; Breakpoints: 3–32; Distribution: 0%–100%; Interpolation: linear → cosine → cubic: 0–2; Time scale: 0.25–4 (log); Waveform elasticity: 0–1; Duration ceiling: 1–8; Random seed: 0–1 |
| 27 | Pulsar synthesis | Duty: 2%–100%; Pulsaret formant: 1 ×–12 ×; Scatter: 0%–100%; Window: 0%–100%; Pulsaret phase: 0 cycles–1 cycles; Pulse masking: 0–1; Pulsaret damping: 0–10; Pulsaret skew: 0.1–4 |
| 28 | Phase-vocoder analysis–resynthesis | Time stretch: 0.25 ×–4 × (log); Transpose: -12 st–12 st; Spectral tilt: -1–1; Phase diffusion: 0%–100%; Source offset: 0%–100%; Freeze analysis: Moving / Frozen; Low frequency: 20 Hz–24000 Hz (log); High frequency: 20 Hz–24000 Hz (log); Spectral gate: 0%–100%; Phase locking: 0%–100% |
| 29 | Scanned synthesis | Stiffness: 0%–100%; Damping: 0%–100%; Scan shape: 0%–100%; Mass gradient: 0%–100%; Model update stride: 8 samples–128 samples; Centering force: 0–0.004; Scan offset: 0 cycles–1 cycles; Bow force: 0–0.05 |
| 30 | Corpus-based concatenative synthesis | Target brightness: 0%–100%; Target noisiness: 0%–100%; Fragment length: 20 ms–250 ms; Continuity: 0%–100%; Descriptor sharpness: 0–8; Fragment overlap: 0–0.95; Fragment window: Hann / Triangle / Blackman; Reverse probability: 0–1 |
| 31 | PADsynth | Bandwidth: 2 cents–90 cents; Harmonic rolloff: 0%–100%; Bandwidth scaling: 0%–100%; Band profile: 0%–100%; Harmonic count: 1 partials–96 partials; Harmonic stretch: 0.8–1.2; Odd / even balance: 0%–100%; Phase seed: 0%–100%; Bandwidth multiplier: 0.1 ×–10 × (log) |
| 32 | Vector phaseshaping | Horizontal breakpoint: 2%–98%; Vertical breakpoint: 0.02–1.98; Modulation depth: 0%–100%; Modulation rate: 0.1 Hz–20 Hz; Motion: sine → triangle → saw: 0–2; Motion phase: 0 cycles–1 cycles; Vertical motion: 0–1; Vertical motion ratio: 0.25–4 |
| 33 | Neural autoregressive synthesis | Timbre: 0%–100%; Texture: 0%–100%; Contour: 0%–100%; Temperature: 0%–100%; History amount: 0%–150%; Prediction rate: 3000 Hz–24000 Hz (log); History stride: 1 samples–8 samples; Sampling seed: 0%–100% |
| 34 | Neural latent-space synthesis | Latent X: -1–1; Latent Y: -1–1; Latent Z: -1–1; Latent W: -1–1; Latent spread: 0 ×–2 ×; Orbit depth: 0%–100%; Orbit rate: 0.01 Hz–8 Hz (log); Orbit plane: XY / XZ / XW / YZ / YW / ZW |
| 35 | Differentiable DSP (DDSP) | Brightness: 0%–100%; Odd / even: 0%–100%; Formant: 0%–100%; Noise: 0%–100%; Partial count: 1 partials–8 partials; Harmonic stretch: 0.8–1.2; Noise color: -1–1; Attack brightness: 0%–100%; Attack color time: 0.005 s–2 s (log) |
| 36 | Diffusion-based synthesis | Timbre: 0%–100%; Harmonic shape: 0%–100%; Denoising steps: 4 steps–20 steps; Variation: 0%–100%; Condition contrast: 0 ×–2 ×; Residual noise: 0%–80%; Sampling stochasticity: 0%–100%; Regeneration rate: 0 Hz–4 Hz |
| 37 | Alias-reduced oscillators | Algorithm: Naïve / PolyBLEP / DPW / MinBLEP; Pulse width: 5%–95%; Saw → square: 0%–100%; Drive: 1 ×–4 ×; Quantization: 4 bits–24 bits; Dither: 0–1; Phase offset: 0 cycles–1 cycles; Oversampling: 1× / 2× / 4× |
| 38 | Antiderivative antialiasing (ADAA) | Drive: 1 ×–12 ×; Asymmetry: -1–1; ADAA mix: 0%–100%; Transfer shape: 0%–100%; Sine / saw source: 0–1; Shaping mix: 0–1; Pre-emphasis: 0–1; Input quantization: 4 bits–24 bits |
| 39 | Hard-sync oscillator | Slave ratio: 1–32; Slave waveform: Sine / Saw / Pulse; Pulse width: 0.02–0.98; Reset phase: 0–1; Sync envelope: -24 semitones–24 semitones; Sync depth: 0–1; Sync jitter: 0–1; Antialias sync: Off / On |
| 40 | Single-sideband modulation / frequency shifting | Frequency shift: -4000 Hz–4000 Hz; Modulator ratio: 0.1–16; Upper / lower: 0–1; Modulator harmonics: 1–32; Harmonic rolloff: 0–1; Sideband mix: 0–1; Modulator phase: 0 cycles–1 cycles; Shift motion: 0 Hz–2000 Hz |
| 41 | Multiscale wavelet synthesis | Wavelet family: Morlet / Mexican hat / Haar; Scale count: 1–8; Scale spacing: 1.25–4; Scale decay: 0–1; Wavelet width: 0.025–0.5; Wavelet translation: 0–1; Scale motion: 0–1; Wavelet chirp: 0–10 |
| 42 | Colored / 1/f noise synthesis | Spectral exponent: -2–2; Low cut: 20 Hz–2000 Hz (log); High cut: 200 Hz–20000 Hz (log); Distribution: Uniform / Gaussian / Binary; Sample hold: 1 samples–64 samples; Resonance frequency: 100 Hz–8000 Hz (log); Resonance: 0–1; Level flutter: 0–1 |
| 43 | Stochastic particle shaker | Particle count: 2–256 (log); Collision rate: 0.01–1; Mode spread: 0–1; Energy decay: 0.05 s–4 s (log); Resonance Q: 1–100 (log); Continuous shake: 0–1; Contact noise: 0–1; Contact brightness: 20 Hz–20000 Hz (log) |
| 44 | Two-dimensional finite-difference membrane | Membrane tension: 0–1; Damping: 0–1; Strike X: 0–1; Strike Y: 0–1; Aspect ratio: 0.5–2; Pickup X: 0–1; Pickup Y: 0–1; Clamped / free: 0–1; Strike hardness: 0–1; Grid resolution: 6–16 |
| 45 | Feedback delay network resonator | Network size: 0.002 s–0.2 s (log); Decay: 0.05 s–10 s (log); Damping: 0–1; Diffusion: 0–1; Delay lines: 2–8; Delay dispersion: 0–1; Injection position: 0–1; Noise excitation: 0–1; Feedback saturation: 0–1; Feedback inversion: 0–1 |
| 46 | Rössler chaotic synthesis | Rössler a: 0.05–0.5; Rössler b: 0.05–1; Rössler c: 2–16; Time scale: 0.2–2; Output: X → Y → Z: 0–2; Projection rotation: 0–360; Minimum integration substeps: 1–8; Initial state: 0–1 |


## Historical additions and input processing

The six additional synthesis paths are cascade/parallel formant voice, integer-divider PSG pulse, clocked LFSR noise, DPCM decoding, curated bytebeat formulas and a Chebyshev coefficient bank. They demonstrate their actual recurrences and signal paths. The voice is newly generated educational audio; it is not the original Bell Labs “Daisy Bell” recording or its exact synthesizer.

The separate stereo bank covers biquad EQ, state-variable and nonlinear ladder filters, short FIR convolution, comb filtering, delay, flanger/chorus, phaser, FDN reverb, ADAA saturation, bit/sample reduction, compression, expansion/gating, envelope filtering, Hilbert frequency shifting and eight-band vocoding. Each has eight presets using repeatable test sources. Play opens the source; Stop closes it while effect tails decay. Preset selection gives a three-second audition when Play is off. Audio arming remains separate.

Load a local file or explicitly start microphone/line capture for processors. The sample-based synthesis paths can also capture two seconds of microphone audio. Audio off, Stop input and navigation release capture; a cancelled permission request closes any stream granted later. Microphone processing follows the shared input-device settings. Files are local, bounded to 120 seconds for stereo processing or 262,144 mono samples for synthesis. No microphone or recording is included in saved preset state.

The guided studies load a named preset and any stated setup values, then expose exact one-control comparisons. The [implementation audit](synthesaurus-coverage.md) explains the original 47 models in detail. The [coverage inventory](synthesaurus-inventory.md) separates implemented, simplified and missing techniques. This is a growing compendium, not a claim of exhaustive DSP coverage.

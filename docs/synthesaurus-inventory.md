# Synthesaurus: coverage and listening guide

Synthesaurus contains **69 playable entries: 53 synthesis demonstrations and 16 audio processors**, with **552 presets and 146 guided touchstones**. It brings together sound generators, analysis–resynthesis methods, historical digital mechanisms, effects and implementation comparisons. These categories overlap; the entry count does not imply 69 unrelated DSP primitives.

This inventory describes the implemented bank and substantial areas for further coverage. It is a practical compendium, not an exhaustive catalog of every DSP algorithm.

## Synthesis and resynthesis

The 53 synthesis entries cover these areas:

| Area | Implemented demonstrations |
| --- | --- |
| Sampled and constructed waveforms | Sampling, wavetable, multiple-wavetable/vector synthesis, wave terrain, waveform segments and graphic waveforms. |
| Spectral construction and modulation | Additive synthesis, Walsh functions, discrete summation formulas, multiscale wavelets, AM, ring modulation, FM, PM, phase distortion, waveshaping, Chebyshev harmonic waveshaping, vector phaseshaping, hard sync and single-sideband modulation. |
| Filtering and formants | Subtractive synthesis, LPC, FOF/CHANT, VOSIM, window-function formants and cascade/parallel formant voice. |
| Grains and spectral resynthesis | Granular synthesis, pulsar synthesis, phase-vocoder analysis–resynthesis, corpus-based concatenative synthesis and PADsynth. |
| Physical models and resonators | Mass–spring, modal, nonlinear-excited waveguide, Karplus–Strong, scanned synthesis, stochastic particle shaker, finite-difference membrane and FDN resonator. |
| Stochastic and chaotic sources | Noise modulation, dynamic stochastic synthesis, colored/1/f noise and Rössler synthesis. |
| Learned synthesis | Compact neural autoregressive, latent-space, differentiable-DSP and diffusion demonstrations. |
| Historical digital mechanisms | Clock-divider PSG pulse, clocked LFSR noise, one-bit delta/DPCM playback and bytebeat. |
| Implementation comparisons | Alias-reduced oscillators and antiderivative antialiasing. |

The historical additions expose specific mechanisms and testable behavior:

| Demonstration | Implemented behavior and scope | Listening comparison |
| --- | --- | --- |
| Cascade/parallel formant voice | A glottal-flow pulse derivative, aspiration and a separate frication branch drive four prescribed resonances. This is a small acoustic voice model, not the complete Klatt system or a reconstruction of the Bell Labs 1961 performance. [Klatt][klatt]; [KlattGrid][klattgrid] | Compare Ah, Ee and Oo at fixed pitch, then compare the same formants in cascade and parallel connections. |
| Clock-divider PSG pulse | An integer timer advances four eight-step duty patterns. Stepped envelopes and an approximate logarithmic level law are separate teaching extensions. This is not a cycle-accurate console emulator. [NES pulse][psg]; [AY datasheet][ay] | Compare duty spectra and discrete pitch steps. Actual frequency follows `clock / [16 × (timer + 1)]`. |
| Clocked LFSR noise | Documented 15-bit long/short XOR recurrences and a separate maximal 7-bit recurrence, with selectable state-bit readout. [NES noise][lfsr] | Compare long noise-like and short metallic sequences. The 7-bit recurrence repeats after 127 states; the documented 15-bit short mode can repeat after 93 or 31 states. |
| One-bit delta/DPCM playback | Generated mathematical fixtures are encoded into bits and reconstructed through a bounded 7-bit accumulator. Encoder and decoder steps can differ. No game ROM or archival recording is included. [NES DMC][dpcm] | At the historical step setting, bits change the accumulator by ±2 when bounds allow. Compare a fast sine with a larger matched step to hear slope overload and coarse reconstruction. |
| Bytebeat | Curated integer expressions use a wrapping 32-bit counter, with explicit clock, shifts, masks and output resolution. The named practice is documented in 2011. [Viznut][bytebeat] | An 8-bit counter saw at 8,000 updates per second repeats at 31.25 Hz. Other expressions expose evolving rhythmic patterns. |
| Chebyshev harmonic waveshaping | A weighted T1–T8 polynomial bank processes a bounded sinusoid, with input index independent of amplitude ADSR. [Csound GEN13][chebyshev] | At unit index and zero bias, `Tn(cos θ) = cos(nθ)`. T5 turns 220 Hz into 1,100 Hz; reducing the index changes the harmonic mixture. |

Physical models are compact teaching models rather than calibrated replicas of particular instruments or materials. The neural entries use locally trained, documented compact models; references to research families do not imply that the full published architectures or pretrained weights are bundled. See [the neural model notes](synthesis-neural-models.md).

## Audio processing

All 16 entries below process the selected audio input. Their implemented limits are explicit:

| Processor | Implemented behavior | Current limits |
| --- | --- | --- |
| Biquad filter / EQ | An adjustable second-order IIR section shapes amplitude and phase with low-pass, high-pass, band-pass, notch, allpass, bell and shelf responses. | One biquad section, not a multiband parametric equalizer. Allpass needs a phase or dry/wet comparison to reveal its action. |
| State-variable filter | A topology-preserving state-variable filter derives low-pass, band-pass, high-pass and notch outputs from two coupled integrator states. | One two-pole state-variable section with nonlinear input drive; no circuit-component model. |
| Nonlinear ladder filter | Four nonlinear low-pass stages and a resonant feedback loop form a ladder-inspired filter, with selectable second- or fourth-stage output. | An oversampled ladder-inspired model, not a measured transistor-ladder circuit recreation. |
| Windowed-sinc FIR filter | A symmetric 127-tap windowed-sinc kernel convolves the input to make finite-impulse-response low-pass, high-pass and band-pass filters. | 127 taps and three built-in windows; no user impulse response or long partitioned convolution. The symmetric kernel delays the wet path by 63 samples; dry mixing can cancel frequencies. |
| Feedback / feedforward comb | A short delay combined with direct and recirculated input creates regularly spaced peaks and notches. | One damped delay loop per channel; this is a filter/resonator, not a calibrated acoustic object. |
| Stereo feedback delay | A stereo delay stores incoming samples, returns them later, and optionally feeds damped echoes into either channel. | Up to two seconds of nominal delay plus stereo offset. Changing delay moves pitch; no time-stretching delay interpolation. |
| Flanger / chorus | A slowly changing delay creates pitch modulation; combining it with direct input produces flanging or chorus. | One modulated delay per channel; stereo phase offsets the modulation. This is not a multi-voice ensemble model. |
| Allpass phaser | Cascaded allpass filters rotate phase. Dry/wet mixing turns that phase rotation into moving spectral notches. | Two to twelve first-order allpass stages. A fully wet allpass changes phase more than steady-state magnitude. |
| Feedback delay network reverb | A feedback delay network diffuses incoming sound into many recirculating returns with frequency-dependent losses. | An abstract FDN, not a measured room or plate impulse response; long tails continue after input stops. |
| Antialiased saturation | A nonlinear transfer adds harmonics. First-order antiderivative antialiasing reduces spectral folding from the transfer. | Tanh, hard clipping and cubic transfer only. ADAA reduces aliasing but does not eliminate it at every input frequency. |
| Bit depth / sample-rate reduction | Independent amplitude quantization and sample holding reduce bit depth and effective update rate, with optional dither and output filtering. | An educational quantizer and sample holder; not an exact emulation of a particular converter or game console. |
| Compressor | An amplitude detector controls downward gain above a threshold, with ratio, knee, attack, release and makeup gain. | Feedforward peak/RMS dynamics without lookahead, external sidechain, multiband splitting or true-peak detection. |
| Downward expander / gate | An amplitude detector reduces gain below a threshold, with limited attenuation, hold time and independent opening/closing rates. | A downward expander with a gain floor; not upward compression, spectral denoising or a source separator. |
| Envelope-following filter | An envelope follower turns incoming amplitude into a resonant filter cutoff gesture. | One resonant low-pass filter driven by a level envelope; no pitch tracking or audio-to-MIDI analysis. |
| Hilbert frequency shifter | A finite Hilbert quadrature pair and complex modulation translate every input component by a fixed number of hertz. | 63-tap Hilbert approximation with 31-sample group delay; sideband suppression is finite, especially near the band edges. |
| Eight-band vocoder | Eight analysis-band envelopes from the input control eight bands of an internal pulse/saw/noise carrier. | Eight bands and an internal carrier; limited articulation, not LPC or a speech recognizer. Noise adds to the periodic carrier rather than replacing it. External carrier input is not yet supported. |

The FIR entry implements **127-tap filtering**, not arbitrary impulse-response loading. The Hilbert shifter implements a **63-tap quadrature approximation** on actual input, and the vocoder implements **eight input-analysis bands with an internal carrier**. These are working processors with defined scope; long IR convolution, an external carrier bus and general spectral processing remain separate gaps.

## Inputs and observation

Processors accept microphone/line input, a local audio file or generated fixtures: **sine, two-tone, noise, impulse train, pulse/saw, drum pattern and voiced phrase**. External audio feeds the processor. Input and output levels, wet/dry mixing and bypass support comparisons.

The waveform view, logarithmic spectrum and spectrogram connect control gestures with audible results. A dedicated transfer-function, group-delay or coherence analyzer is not part of the current bank.

Useful first comparisons include:

- **Frequency shift versus pitch ratio:** the 220/330 Hz two-tone fixture shifted by +100 Hz becomes approximately 320/430 Hz. Its 110 Hz spacing remains unchanged.
- **Phaser versus flanger:** both sweep notches, but one uses allpass phase rotation and the other a moving delay. Stop modulation and compare the notch pattern.
- **Bit depth versus update rate:** lower word length with update rate held high, then restore word length and lower update rate. These operations introduce different errors.
- **FIR versus IIR:** compare transition bands and phase behavior, remembering the FIR's 63-sample wet-path delay. Mixing it with undelayed dry input can cancel frequencies.
- **Compressor attack:** keep threshold and ratio fixed while changing attack time on the drum fixture. Listen to the onset separately from the sustained level.

## Important techniques still missing

Similar-sounding presets do not establish that another algorithm has been implemented. The following additions require distinct state models, representations or routing.

### Synthesis and resynthesis gaps

| Technique | What is missing | Useful future touchstone |
| --- | --- | --- |
| **Kelly–Lochbaum vocal tract** | Traveling waves and scattering junctions derived from tube areas, with glottal and lip boundaries. The current voice prescribes resonances directly and has no tract geometry. [Tube junctions][kelly] | Hold pitch fixed while changing vowel geometry or tract length. |
| **Nonlinear bowed string** | A bow/string friction junction coupled to traveling-wave string paths. The existing reed-like waveguide uses a different exciter. [Bowed strings][bowed] | Compare stable bowing and noisy stick-slip regimes, then remove bow motion and observe decay. |
| **Probabilistic Karplus–Strong drum** | The original random-sign feedback recurrence. Deterministic feedback polarity in the current string does not implement that probability-controlled variant. [Original paper][ks] | Compare probability endpoints with the noisy middle region. |
| **Direct iterated-map synthesis** | A specified discrete recurrence with explicit iteration and readout clocks. Rössler synthesis integrates a continuous differential equation. [Truax bibliography][maps] | Sweep through fixed points, period doubling and irregular motion while viewing the state. |
| **Waveset resynthesis** | Source segmentation at defined zero crossings, followed by repetition, reordering, reversal or substitution. Constructed waveform segments are a different operation. [Wishart][wishart]; [CDP][wavesets] | Repeat pseudo-cycles from a sine and then a complex source, revealing why wavesets are not always pitch periods. |
| **Pitch-synchronous overlap-add (PSOLA)** | Source pitch marks, period-relative windows and independently scheduled synthesis epochs, with voiced/unvoiced handling. Ordinary grains do not guarantee pitch synchronization. [Original paper][psola] | Change pitch with duration fixed, then duration with pitch fixed. |
| **Spectral Modeling Synthesis (SMS)** | Tracked sinusoidal components and a stochastic residual derived from the same analyzed source. Adding unrelated noise to additive tones is insufficient. [Serra and Smith][sms]; [coauthor explanation][smsbook] | Recombine both branches, then isolate coherent partials and residual noise. |
| **Phase-aligned formant synthesis (PAF)** | Puckette's specific nonlinear construction and carrier phase alignment. FOF and windowed-formant generators use different constructions. [Original reprint][paf] | Sweep a formant through harmonic boundaries and inspect continuity. |
| **PCA harmonic-envelope synthesis** | A learned linear basis of analyzed harmonic amplitude trajectories, with documented reconstruction and extrapolation. The current neural latent decoder is nonlinear. [Original paper][pca] | Increase retained components and compare reconstruction error and attack character. |
| **Cellular-automaton waveform evolution** | A documented cell rule that evolves waveform data, with separate evolution/readout clocks. A note-selecting automaton is a sequencer. Faithful LASy reproduction also requires its original rule details. [Chareyron][lasy] | Freeze evolution and scan a row, then resume evolution at different rates. |
| **Reactive wave-digital circuit models** | Circuit state and wave-variable scattering for specified reactive and nonlinear components. A static transfer curve does not provide this circuit model. [Fettweis][wdf] | Compare small-signal response and passive decay with the specified circuit. |

### Processing and routing gaps

| Capability | Present boundary | Useful next demonstration |
| --- | --- | --- |
| **Arbitrary and partitioned IR convolution** | The FIR designs its own short kernel; it cannot load a room response or run long partitioned convolution. | A delta IR gives identity; an impulse reproduces the selected IR. [Convolution][convolution] |
| **General spectral effects** | The synthesis phase vocoder resynthesizes a prepared source. There is no common live-input STFT bank for freeze, masks, blur, gating or arbitrary spectral transformations. | Unity and zero masks, then frozen-magnitude and phase experiments. [Puckette][puckette] |
| **Spectral cross-synthesis and external-carrier vocoding** | The eight-band vocoder has an internal carrier. No independent second audio-input bus or two-source STFT timbre-stamping processor is exposed. | Transfer one signal's spectral envelope to another, with independently audible modulator and carrier. |
| **General pitch/time processing** | Sampling and the source-based phase vocoder expose related transformations; no shared input processor compares PSOLA, waveform-similarity and phase-coherent methods. | Compare onset preservation, latency and duration at the same transposition ratio. |
| **External sidechains** | Dynamics processors detect their own input. | A drum signal controls an independent sustained signal's gain. |
| **Lookahead and true-peak limiting** | The compressor has no lookahead or reconstructed-peak detector. Output safety limiting is not a separate limiter study. | Isolated peaks expose latency, gain recovery and intersample peaks. |
| **Multiband dynamics and crossovers** | No complementary band-split/recombine network is exposed. | Verify unity-gain recombination, then compress bands independently. |
| **Transient shaping** | Compressor timing affects transients, but there is no dedicated fast/slow-envelope transient shaper. | Separate attack enhancement from sustained-level change. |
| **Input AM/ring modulation** | AM and ring modulation are source demonstrations, not separate processors for arbitrary external input. | A single tone and sine modulator reveal the predicted sidebands. |
| **Additional reverberator architectures** | FDN reverb is implemented; a separate Schroeder comb/allpass or Moorer comparison is not. | Compare echo density, diffusion and decay using the same impulse. [Schroeder structures][schroeder] |
| **Spatial processing** | Several effects produce stereo output, but no dedicated panner, mid/side matrix, HRTF/binaural processor or ambisonic encoder/decoder is exposed. | Verify panning endpoints and mid/side round-trip identity before adding spatial datasets or speaker layouts. |
| **Conversion and reconstruction laboratories** | Individual entries contain dither, quantization, interpolation and clocked sources. Dedicated PWM/PDM encoding, error-feedback noise shaping and general resampling comparisons are absent. | Reconstruct the same sine from pulse width, pulse density and multilevel PCM while varying clock and filter separately. [TI PWM note][pwm] |

Larger learned generators also remain outside the bank. A full adversarial, invertible-flow or codec-token system requires its actual architecture, trained artifacts, data provenance and evaluation. A compact teaching model cannot establish those capabilities through labels or presets alone.

## Naming and historical scope

| Term | Treatment in this compendium |
| --- | --- |
| Phase distortion | Already represented, including the waveform-construction principle associated with Casio instruments. A brand label alone does not define another family. |
| Vector synthesis | Multiple-wavetable mixing, distinct from vector **phaseshaping**. |
| BLEP, DPW, oversampling and ADAA | Numerical approaches to alias reduction within existing generation or nonlinear-processing methods. |
| Virtual analog and zero-delay feedback | Modeling or solution approaches; identify the oscillator, filter, circuit or exciter being modeled. |
| Unison, supersaw and ensemble | Oscillator-bank or routing configurations whose voice structure and implementation should be stated. |
| “8-bit,” retro and lo-fi | Descriptions spanning clock rate, register precision, waveform storage, DAC resolution, encoding and analog output. An 8-bit CPU does not imply an 8-bit audio DAC. |
| Physical modeling | A broad family. Bow junctions, reed models and membrane equations are distinct models; material presets alone do not create new methods. |
| AI or neural synthesis | The actual model and learning procedure determine the method. A research citation does not imply use of that pretrained system. |

Historical references establish the cited mechanism, publication or hardware behavior. A later manual can clarify an algorithm without proving its first invention date. The voice and chip demonstrations are educational implementations, not claims to reproduce archival performances or every hardware quirk.

## Sources and further reading

Original papers, author accounts and manufacturer documents include [Karplus–Strong 1983][ks], [PSOLA 1989][psola], [PCA envelope synthesis 1990][pca], [Wishart's *Audible Design* 1994][wishart], [Puckette's PAF reprint 1995][paf], [Viznut's bytebeat account 2011][bytebeat], [ADAA 2016][adaa], the [AY datasheet][ay] and the [TI PWM application note][pwm].

The original publication records for [Dudley's *Remaking Speech* (1939)][dudley], [Klatt's cascade/parallel synthesizer (1980)][klatt], [Serra and Smith's SMS paper (1990)][sms], [Chareyron's LASy paper (1990)][lasy] and [Fettweis's wave-digital-filter paper (1986)][wdf] were verified. Full original texts were not retrieved for all of these records. The SMS explanation uses a retrieved coauthor chapter; the voice implementation also uses the [Praat KlattGrid manual][klattgrid], which explicitly describes a later superset.

The PCA paper is by **Robert G. Laughlin, Barry D. Truax and Brian V. Funt**. Its original text was retrieved and read. The direct-map historical lead is an author bibliography rather than a claim to reproduce the original program.

Author textbooks and maintained technical references provide the practical DSP details:

- Miller Puckette, [*The Theory and Technique of Electronic Music*][puckette]: waveform construction, modulation, filters, delays and Fourier processing.
- Julius O. Smith: [tube junctions][kelly], [bowed strings][bowed], [flanging][flanger], [phasing][phaser], [Schroeder reverberators][schroeder], [FDNs][fdn], [windowed FIR design][fir] and [analytic signals/Hilbert transforms][hilbert].
- Robert Bristow-Johnson, [*Audio EQ Cookbook*, W3C adaptation][rbj].
- Vadim Zavalishin, *The Art of VA Filter Design*: topology-preserving structures and nonlinear filter design.
- Csound, [GEN13 Chebyshev construction][chebyshev].
- NESdev, [pulse sequencing][psg], [LFSR noise][lfsr] and [DMC delta decoding][dpcm]: maintained hardware documentation.
- Giannoulis, Massberg and Reiss, *Digital Dynamic Range Compressor Design—A Tutorial and Analysis*, JAES 60(6), 399–408 (2012). The bibliographic citation is retained; a working original full-text download was not verified for this inventory.

[klatt]: https://doi.org/10.1121/1.383940
[klattgrid]: https://www.fon.hum.uva.nl/praat/manual/KlattGrid.html
[kelly]: https://ccrma.stanford.edu/~jos/pasp/Kelly_Lochbaum_Scattering_Junctions.html
[psg]: https://www.nesdev.org/wiki/APU_Pulse
[lfsr]: https://www.nesdev.org/wiki/APU_Noise
[dpcm]: https://www.nesdev.org/wiki/APU_DMC
[ay]: https://map.grauw.nl/resources/sound/generalinstrument_ay-3-8910.pdf
[bytebeat]: https://countercomplex.blogspot.com/2011/10/algorithmic-symphonies-from-one-line-of.html
[chebyshev]: https://csound.com/docs/manual/GEN13.html
[ks]: https://users.soe.ucsc.edu/~karplus/papers/digitar.pdf
[paf]: https://msp.ucsd.edu/Publications/jaes95.ps
[wishart]: https://www.trevorwishart.co.uk/AUDIBLE_DESIGN.pdf
[wavesets]: https://www.composersdesktop.com/docs/html/cdistort.htm
[maps]: https://www.sfu.ca/~truax/cvpub.html
[lasy]: https://doi.org/10.2307/3680789
[sms]: https://doi.org/10.2307/3680788
[smsbook]: https://www.dsprelated.com/freebooks/sasp/Spectral_Modeling_Synthesis.html
[pca]: https://www.cs.sfu.ca/~funt/LaughlinTruaxFunt1990.pdf
[psola]: https://www.isca-archive.org/eurospeech_1989/charpentier89_eurospeech.pdf
[puckette]: https://msp.ucsd.edu/techniques/latest/book.pdf
[rbj]: https://www.w3.org/TR/audio-eq-cookbook/
[schroeder]: https://www.dsprelated.com/freebooks/pasp/Schroeder_Reverberators.html
[fdn]: https://www.dsprelated.com/freebooks/pasp/Feedback_Delay_Networks_FDN.html
[convolution]: https://ccrma.stanford.edu/~jos/sasp/Overlap_Add_OLA_STFT_Processing.html
[phaser]: https://www.dsprelated.com/freebooks/pasp/Phasing.html
[flanger]: https://www.dsprelated.com/freebooks/pasp/Flanging.html
[bowed]: https://www.dsprelated.com/freebooks/pasp/Bowed_Strings.html
[wdf]: https://doi.org/10.1109/PROC.1986.13458
[dudley]: https://doi.org/10.1121/1.1916020
[pwm]: https://www.ti.com/lit/an/spraa88a/spraa88a.pdf
[fir]: https://ccrma.stanford.edu/~jos/sasp/Window_Method_FIR_Filter.html
[hilbert]: https://ccrma.stanford.edu/~jos/mdft/Analytic_Signals_Hilbert_Transform.html
[adaa]: https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf

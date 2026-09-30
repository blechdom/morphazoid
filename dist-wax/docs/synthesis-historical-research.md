# Historical and esoteric synthesis: coverage and research

Research checked 29 September 2026 against Synthesaurus's 47-method catalog.
This is a coverage map and a set of proposed demonstrations. The research entries
below are not additional implemented engines. Dates identify the cited work or
hardware lineage; they do not establish that a technique was absent from Curtis
Roads's 1996 *The Computer Music Tutorial*.

## Answers about the current page

| Asked about | Current coverage |
| --- | --- |
| Karplus–Strong | Present under **Physical models and resonators**, with eight presets and nine controls: damping, decay, pick position, excitation color, dispersion, feedback inversion, excitation length, noise/displacement mix, and pick-noise burst. |
| 8-bit sound | Partly represented by waveforms, sampling and 4–24-bit quantization controls. There is no dedicated clocked PSG, LFSR, delta-decoder or one-bit-output demonstration. |
| Bell Labs “Daisy Bell” voice | No explicit articulatory singing voice or phoneme/melody sequence. LPC, FOF, VOSIM and the instrumental waveguide illustrate related acoustics through different mechanisms. |
| Earlier and less familiar digital methods | Walsh functions, DSF, wave-terrain, waveform segments, FOF/CHANT, VOSIM, stochastic synthesis and several other older families are already present. They should receive useful historical comparisons without being counted again under new names. |

## Bell Labs and the different ways to synthesize a voice

The Library of Congress identifies the Bell Labs **1961** “Daisy Bell” recording
with Max Mathews, John L. Kelly, Jr., and Carol Lochbaum. Kelly and Lochbaum
programmed the vocal; Mathews supplied the accompaniment. The [LOC essay][daisy]
and [Computer History Museum account][chm-voice] support that attribution.

A **Kelly–Lochbaum-style articulatory singer** would be a substantial addition.
Its acoustic model divides the vocal tract into short tubes, propagates waves
between them, and computes scattering at changes of cross-sectional area or
impedance. Glottal excitation, tract losses and lip radiation complete the basic
voice. A changing area function and timed voicing/frication gestures are needed
for syllables; a melody alone only makes a sustained vowel sing. The
[Stanford technical account][kelly] supplies the scattering equations. An exact
reconstruction of the archived performance would also require original voice
parameters, timing and accompaniment data, which this research did not recover.

**Klatt-style cascade/parallel formant synthesis** is a separate useful lesson.
It specifies acoustic resonances and source branches directly, rather than
starting from a tube geometry. Cascaded formants multiply their filter responses;
parallel formants are independently weighted and summed. Voicing, aspiration,
frication and nasal resonances/antiresonances help produce speech. Klatt's
[1980 publication][klatt] predates the book. [Praat's KlattGrid][klattgrid] is a
retrieved implementation reference, but describes a superset of the later
Klatt & Klatt 1990 system, not a verbatim implementation of the 1980 program.

The existing **LPC** demo fits an all-pole filter to audio; **FOF** builds formant
spectra from sinusoidal bursts; **VOSIM** uses groups of damped sine-squared
pulses. Similar vowel-like results do not imply the same algorithm or historical
program. LPC's [Atal–Hanauer 1971 paper][lpc] is not evidence that the 1961
recording used that later analysis procedure.

| Proposed voice demo | Controls with a direct acoustic role |
| --- | --- |
| Articulatory vocal tract | F0; glottal pulse/open quotient; source tilt; tract length; vowel/section-area controls; losses; lip radiation; breath/frication; vowel transitions; consonant timing; phrase tempo. |
| Cascade/parallel formants | F0; F1/F2/F3 and bandwidths; branch levels; topology; aspiration/frication; spectral tilt; nasal pole/zero; independent formant and pitch trajectories. |

Machine names in later “Daisy Bell” accounts conflict. Mathews's contemporary
[1961 acoustic-compiler paper][music3] directly identifies an IBM 7090 for that
compiler. It does not resolve which machine rendered every component of the
recording. “Bell Labs, 1961” is the supported public label here.

## What “8-bit” should expose

An eight-bit CPU does not imply an eight-bit audio DAC. Historical machines used
binary pulse outputs, four-bit waveform memories, seven-bit output accumulators,
and frequency/pulse-width registers wider than eight bits. Bit depth, sample
clock, oscillator architecture and analog output circuitry are separate things.

| Mechanism and historical example | Gap or relationship to current methods | Proposed controls |
| --- | --- | --- |
| **Clock-divider pulse synthesis / PSG**, including NES-style timer/duty sequencing | Pulse waves exist, but an integer timer and a clock-driven pattern are missing. [NESdev][nes-pulse] documents the pitch relation and four duty patterns. | Clock; timer register; duty pattern; nearest-note/cents display; register sweep; phase reset; level. |
| **Clocked LFSR noise**, e.g. NES and Game Boy long/short sequences | Missing. Binary random noise and Walsh functions are different processes. Short feedback-register periods can be pitched or metallic. [NESdev][nes-noise] and [Pan Docs][gb-audio] document the recurrences. | Clock/divider; valid width/tap modes; seed/reset; long/short sequence; level envelope; short bit-history display. |
| **Clocked, stepped amplitude envelopes**, e.g. AY-3-8910 | Smooth ADSR is present; a repeating 16-level hardware envelope and its nonlinear DAC law are not. At high rates the envelope becomes audible modulation. [Original AY datasheet][ay]. | Envelope period; shape; retrigger; fixed/envelope level; tone/noise routing; documented or explicitly approximate level law. |
| **Small low-bit wavetable**, e.g. Game Boy's 32 × 4-bit wave RAM | Wavetable synthesis is present, but this constrained memory/clock/DAC combination is not. [Pan Docs][gb-audio]. | Table samples; code resolution; timer; waveform templates; phase; held/interpolated output comparison. |
| **Low-bit PCM / direct DAC playback** | Sampling and quantization are partly present. A dedicated comparison should separate amplitude word length from sample/write rate. The NES DMC also permits direct seven-bit DAC writes. [NESdev][nes-dmc]. | Sample; bit depth; sample rate; input level; dither; hold/reconstruction filtering; looping. |
| **Delta modulation / DPCM sample playback** | Missing decoder. In the NES example, each stored bit moves a seven-bit accumulator up or down by two; it is not an amplitude sample. [NESdev][nes-dmc]. | Bit clock; initial level; source/bitstream; loop/reset; fixed historical step versus generic step; decoded/reference comparison. |
| **Software-timed one-bit speaker synthesis**, e.g. ZX Spectrum beeper | Ordinary pulse oscillators exist; explicit instruction/clock-timed output is missing. The [ROM disassembly][spectrum] shows the speaker-bit toggle and output instruction. | Clock; integer timing; transition pattern; pitch; duty; level; optional reconstruction filter. |
| **SID-inspired hybrid architecture** | Many ingredients already exist: oscillators, sync, ring modulation, envelopes and filtering. A chip-constrained combined patch would be an architecture study. The SID includes analog filtering and conversion, so it is not an entirely digital eight-bit signal path. [Original MOS archive][sid], [reSID][resid]. | Frequency register; pulse-width code; waveform; sync/ring routing; filter routing/cutoff/resonance; envelope. |

A **PWM DAC** varies the duty of a carrier to encode a lower-frequency signal;
a **PDM** stream represents that signal by local bit density. Both differ from
using a pulse wave directly as the musical oscillator. They make useful
encoding/reconstruction comparisons, but should not be retroactively attributed
to every old beeper. The [TI PWM application note][pwm] and [PDM vendor guide][pdm]
explain the conversion mechanisms; the latter is a modern reference.

**Bytebeat** is another actual gap: an integer sample counter feeds arithmetic
and bitwise expressions, whose output becomes audio. Formula, clock, masks,
shifts and wrap semantics are meaningful controls. [Viznut's primary account][bytebeat]
dates his initial video to 26 September **2011**. Its low-bit sound does not make
that named practice a pre-1996 chip technique.

A generic demonstration of these mechanisms should be labeled accordingly.
Cycle-accurate console behavior, individual SID revisions and measured analog
DAC/filter characteristics require additional implementation and validation.

## Earlier, less familiar algorithms and variants

| Technique | Historical evidence and mechanism | Present coverage and useful extension |
| --- | --- | --- |
| **Probabilistic Karplus–Strong drums** | The [original 1983 paper][ks], p. 46, describes a random sign choice in the feedback recurrence and dates its discovery to 1979. Its blend probability moves between plucked strings and noisy drums. | The string family is present. Current feedback inversion is a continuous gain/polarity control, not that random sign choice. Add probability, seed, delay length, damping and excitation controls to demonstrate the original variant. |
| **Chebyshev/polynomial waveshaping** | The identity `Tₙ(cos θ) = cos(nθ)` lets polynomial coefficients specify harmonics for an appropriately normalized sinusoidal input. LeBrun's 1979 waveshaping paper is cited in [Puckette's author text][puckette-book]; [Csound GEN13][chebyshev] documents the construction. | Waveshaping exists, but an explicitly editable coefficient/harmonic bank does not. Useful controls are coefficients, drive/index envelope, DC term, input phase and normalization. Changing input amplitude changes the harmonic relationships. |
| **Phase-aligned formant synthesis (PAF)** | Puckette's [1995 original paper/reprint][paf] describes formant frequency, bandwidth and amplitude control through nonlinear shaping and phase-aligned carrier construction. | Related windowed formants exist, but not this explicit generator. Expose F0, formant center, bandwidth, gain, pulse/noise character and independent trajectories; keep carrier phases aligned through formant movement. |
| **Waveset resynthesis and distortion** | Wishart's author-hosted [*Audible Design*][wishart] has a visually verified 1994 title/copyright page and waveset entries. [CDP's maintained manual][wavesets] details zero-crossing-defined pseudo-cycles, repetition, interpolation, reversal, shuffling, substitution and harmonic operations. | Missing source-derived segmentation. The current waveform-segment demo constructs a cycle from control points. A waveset demo would extract cycles from sound and expose group size, repeat count, order, interpolation, transposition and selection thresholds. Not every pseudo-cycle is a true fundamental period. |
| **Linear Automata Synthesis (LASy)** | Chareyron's [1990 paper][lasy] explicitly describes cellular automata evolving synthesized waveforms. Publication metadata and the author abstract were retrieved; the full original paper was inaccessible. | A different waveform-evolution mechanism from the current scanned mass–spring model or Rössler ODE. Expose cell states, rule/neighborhood, boundaries, evolution clock and readout clock. Recover the precise LASy rule before claiming a faithful implementation; an automaton merely choosing notes would be a sequencer instead. |
| **Direct iterated-map synthesis** | Truax's [author bibliography][truax] documents his 1990 sound-synthesis study; Choi's [1994 repository abstract][choi] explicitly describes sound from iterative and continuous chaotic models. | Discrete state recurrence is missing even though continuous Rössler synthesis is present. Controls include map parameters, initial state, iteration/audio-rate ratio, observation coordinate and interpolation. Fixed points, periodic windows and escaped trajectories need explicit handling. Dates of mathematical equations alone do not establish dates of audio use. |
| **Spectral Modeling Synthesis (SMS)** | Serra and Smith's [1990 deterministic-plus-stochastic model][sms-paper] separates tracked sinusoidal components from a modeled residual. [Smith's explanatory chapter][sms] was read. | A specific analysis/resynthesis hybrid. Manual additive synthesis and the existing phase vocoder do not implement this decomposition. Expose tracking threshold/continuity, sinusoidal/residual balance, noise-envelope resolution, and independent pitch/time transformations. Adding unrelated noise to additive tones would not suffice. |
| **PCA harmonic-envelope synthesis** | Laughlin, Truax and Funt's [original 1990 paper][pca] learns principal-component bases from analyzed harmonic amplitude envelopes and reconstructs timbres by additive synthesis. The original full paper was retrieved and read. | A learned **linear** representation, distinct from the current neural decoder. Controls can include basis scores, retained component count, envelope duration, source/basis bank and partial range. Reconstruction needs a documented treatment of nonnegative amplitudes and extrapolation. |
| **Pitch-synchronous overlap-add (PSOLA)** | Charpentier and Moulines's [original 1989 paper][psola] uses labeled source pitch periods and independently placed synthesis periods, allowing pitch and duration control. | A narrower sampling/resynthesis method. The existing granular engine does not detect pitch marks or schedule grains against those epochs. Controls include pitch, source-time progression, pitch-period-relative window length, source units and voiced/unvoiced handling. FOG-like grains alone do not guarantee PSOLA's pitch synchronization. |

These are different levels of classification: automata and iterated maps introduce
state-evolution mechanisms; SMS, PCA and PSOLA introduce specific representations
or reconstruction procedures within existing broad synthesis families.

**Circuit models using wave digital filters** are also a technically useful future
addition. [Fettweis 1986][wdf-paper] dates the general filter framework, while
[Smith's account][wdf] explains wave-variable circuit modeling. This pass did not
verify a pre-1996 musical-synthesis application date, so the framework date is not
presented as the invention of a particular synth. A real implementation would need
reactive state and circuit scattering, rather than a memoryless distortion curve.

Ordinary **feedback FM/PM** already has feedback and delay controls in the page.
Likewise, published nonlinear exciter/delayed-resonator models can overlap the
existing waveguide family. Separate names do not automatically justify another
method entry.

## Historical systems that should not inflate the family count

**MUSIC I / the MUSIC languages.** The [Computer History Museum][chm-music]
dates Mathews's demonstrated MUSIC program to 1957. The primary MUSIC III-era
[acoustic-compiler paper][music3] describes stored functions, unit-generator
connections, envelopes, vibrato, additive combinations, score-controlled notes
and a bandwidth-controlled random generator. Those source principles are largely
present already. A few annotated fixed patches would teach this lineage more
accurately than an invented “MUSIC synthesis” waveform family. The retrieved
1961 implementation details should not be assigned to MUSIC I without its listing.

**UPIC / graphical score-driven synthesis.** The [Xenakis archive][upic] dates
the first UPIC to 1977 and describes drawing as control over musical structure
and sound. The current graphic-waveform editor covers only one small aspect.
Drawing a time–pitch trajectory, an amplitude shape and a waveform is an
interface/architecture extension, not a new universal DSP primitive.

**FOG.** [Csound's manual][fog] documents sampled grains with FOF-derived timing
and envelopes, useful for exposing the relationship between vocal bursts and
granular sampling. Its listed Csound release is May 1997; that is not proof of
an earlier invention date. This research does not place FOG in the verified
pre-1996 table. A version-release date and an algorithm's first appearance must
be checked separately.

## Source notes

Primary works or original scans read: Karplus–Strong 1983; Puckette's PAF
reprint of the 1995 article; Mathews 1961; PCA 1990; PSOLA 1989; original AY
and MOS SID documents.
Wishart's 1994 title page and waveset index were visually read from the
booklet-ordered scan; the detailed operation descriptions above use CDP's manual.
Institutional/maintainer documentation supplies the chip and vocal-tract
mechanisms. Klatt 1980 and Atal–Hanauer 1971 publication metadata were verified,
but their original full texts were not retrieved. LASy is supported by publication
metadata and its author abstract; the direct-map dates by an author bibliography
and a primary repository abstract. SMS uses verified original publication metadata
and a retrieved coauthor explanation. No historical recording,
commercial ROM or book illustration has been added to the instrument.

[daisy]: https://www.loc.gov/static/programs/national-recording-preservation-board/documents/DaisyBell.pdf
[chm-voice]: https://www.computerhistory.org/revolution/computer-graphics-music-and-art/15/221
[chm-music]: https://www.computerhistory.org/revolution/computer-graphics-music-and-art/15/222
[kelly]: https://ccrma.stanford.edu/~jos/pasp/Kelly_Lochbaum_Scattering_Junctions.html
[klatt]: https://doi.org/10.1121/1.383940
[klattgrid]: https://www.fon.hum.uva.nl/praat/manual/KlattGrid.html
[lpc]: https://doi.org/10.1121/1.1912679
[music3]: https://archive.org/download/bstj40-3-677/bstj40-3-677.pdf
[nes-pulse]: https://www.nesdev.org/wiki/APU_Pulse
[nes-noise]: https://www.nesdev.org/wiki/APU_Noise
[gb-audio]: https://gbdev.io/pandocs/Audio_Registers.html
[nes-dmc]: https://www.nesdev.org/wiki/APU_DMC
[ay]: https://map.grauw.nl/resources/sound/generalinstrument_ay-3-8910.pdf
[spectrum]: https://skoolkit.ca/disassemblies/rom/asm/949.html
[sid]: https://www.zimmers.net/anonftp/pub/cbm/documents/chipdata/6581.zip
[resid]: https://github.com/libsidplayfp/resid/blob/master/README
[pwm]: https://www.ti.com/lit/an/spraa88a/spraa88a.pdf
[pdm]: https://learn.adafruit.com/adafruit-pdm-microphone-breakout/overview
[bytebeat]: https://countercomplex.blogspot.com/2011/10/algorithmic-symphonies-from-one-line-of.html
[ks]: https://users.soe.ucsc.edu/~karplus/papers/digitar.pdf
[puckette-book]: https://msp.ucsd.edu/techniques/latest/book.pdf
[chebyshev]: https://csound.com/docs/manual/GEN13.html
[paf]: https://msp.ucsd.edu/Publications/jaes95.ps
[wishart]: https://www.trevorwishart.co.uk/AUDIBLE_DESIGN.pdf
[wavesets]: https://www.composersdesktop.com/docs/html/cdistort.htm
[upic]: https://www.centre-iannis-xenakis.org/cix_upic_presentation
[fog]: https://csound.com/docs/manual/fog.html

[lasy]: https://doi.org/10.2307/3680789
[truax]: https://www.sfu.ca/~truax/cvpub.html
[choi]: https://repository.gatech.edu/handle/1853/50873
[sms-paper]: https://doi.org/10.2307/3680788
[sms]: https://ccrma.stanford.edu/~jos/sasp/Spectral_Modeling_Synthesis.html
[pca]: https://www.cs.sfu.ca/~funt/LaughlinTruaxFunt1990.pdf
[psola]: https://www.isca-archive.org/eurospeech_1989/charpentier89_eurospeech.pdf
[wdf-paper]: https://doi.org/10.1109/PROC.1986.13458
[wdf]: https://www.dsprelated.com/freebooks/pasp/Wave_Digital_Filters.html

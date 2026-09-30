# Synthesaurus: audit of the original 47 playable methods

102 guided experiments cover 47 actual DSP paths and reference the existing factory bank. All 411 control ranges remain available. These are teaching implementations; 47 menu entries are not 47 disjoint synthesis families.

The most substantial depth limits are the miniature neural models, single-frame LPC, fixed-size offline phase vocoder, two-descriptor/48-segment corpus, internal-source SSB, and fixed low-order physical/topological models. New presets alone do not remove those limits.

## 0: Sampling / sample playback

Working sample-playback core. One mono source is read through a movable looping region; playback increment supplies transposition, reversal and slow rate variation. Nearest/linear reads, start jitter and a boundary fade are implemented.

- The built-in source is original procedural audio, not a recorded instrument. Uploads share a 262144-sample mono buffer.
- Loop crossfade is currently a fade to zero at each boundary, not an equal-power overlap between loop ends. Playback speed changes pitch and duration together.

**Tape-speed pitch and duration** — preset `whole-phrase`. Hold a note. Compare Frequency 220, 110 and 440 Hz with Rate variation at zero and a full forward loop.

Listen: Halving playback rate lowers every pitch an octave and doubles source-event duration; doubling reverses both changes.

**A slice becomes an oscillator** — preset `tiny-bright-loop`. Hold at 220 Hz. Sweep Loop length from 25% to 3%, then move Position through 0%, 50% and 90%.

Listen: Short repetitions expose a loop pitch and the timbre of the selected region; moving the region changes the repeated waveform.

**Reverse the internal event shape** — preset `backward-bloom`. Hold the same pitch and switch Direction between Forward and Reverse. Keep Rate variation at zero to isolate reversal.

Listen: The source event develops backwards while the common ADSR still moves forwards.

New DSP needed for greater depth: True overlapping loop crossfades; independent time/pitch manipulation belongs to granular or phase-vocoder processing. Multisample key/velocity zones would need a sampler architecture.

## 1: Wavetable synthesis

Working four-table oscillator. Four 2048-point tables contain sine, triangle, saw and square shapes, generated with up to 64 harmonics. Continuous shape interpolation, phase warping, lower table resolution, filtering, folding and a detuned voice are real.

- Only four built-in shapes are present; arbitrary wavetable import and scanned multi-frame tables are absent.
- These are fixed harmonic-limited tables, not a pitch-dependent mipmap bank. Reduced Table resolution quantizes phase rather than rebuilding a smaller table; interpolation cannot remove those deliberate phase steps. Warping/folding can add aliases.

**Sine, triangle, saw, square** — preset `round-fundamental`. Hold 220 Hz with Brightness 100%, Pulse width 50%, Wavefold and Unison mix zero. Move Shape through 0%, 33.333%, 66.667% and 100%.

Listen: A sine has one line; triangle/square emphasize odd harmonics; saw adds both odd and even harmonics.

**Coarse phase sampling leaves steps** — preset `stepped-high-note`. Hold 880 Hz with Interpolation 100%. Compare Table resolution 2048, 128, 32 and 16 samples while watching the waveform and spectrum.

Listen: Lower Table resolution deliberately quantizes phase and creates visible plateaus plus additional high-frequency components. Interpolation within the underlying 2048-point table does not remove these coarse phase steps.

New DSP needed for greater depth: User/multi-frame wavetable loading and pitch-dependent band-limited table preparation.

## 2: Additive synthesis

Working eight-partial additive bank. Eight independent phase accumulators and amplitudes form a sinusoidal bank. Stretch, offset, detune, tilt, odd/even weighting, phase spread and slow amplitude motion alter the actual partials.

- There are eight directly editable amplitudes, not hundreds of arbitrary partial trajectories. Above-band partials are omitted.
- The summed amplitudes are normalized when their sum exceeds one, so adding a partial can lower existing partial levels.

**Build a harmonic tone one partial at a time** — preset `single-sine`. Hold 220 Hz; keep Partial 1 at 100%. Add Partial 2 at 50%, Partial 3 at 33.333% and Partial 4 at 25%.

Listen: Each raised amplitude adds a line at an integer multiple of 220 Hz. The waveform changes as those sinusoids sum.

**Missing fundamental versus an octave shift** — preset `missing-fundamental`. Hold 220 Hz. Compare Partial 1 at 0% and 100%. Then return it to zero and mute Partials 3, 5 and 7 to leave the even series.

Listen: With harmonics 2 and 3 together, the ear may infer the absent 220 Hz fundamental. Keeping only even harmonics instead supports an octave-higher repetition.

**Phase changes shape more than the line spectrum** — preset `eight-part-saw`. Hold 220 Hz with detune and partial motion zero. Sweep Phase spread from 0 to 1 cycle.

Listen: Relative phase reorganizes peaks in the oscilloscope while a stationary magnitude spectrum retains the same harmonic locations and approximately the same amplitudes.

New DSP needed for greater depth: Arbitrary partial-frequency/envelope trajectories and sinusoidal analysis/tracking for resynthesis.

## 3: Walsh-function synthesis

Working two-basis Walsh construction. Gray-coded Walsh sign functions are evaluated on a 1024-position phase grid. The output interpolates two selected basis functions, with sequency/order motion and a smoothing pole.

- The Odd / even control crossfades two Walsh functions; it is not a full independently weighted Walsh expansion.
- Basis order/sequency are discrete choices. Smoothing is a simple low-pass operation, not an alias-free reconstruction filter.

**Sequency is not sinusoidal harmonic number** — preset `binary-reed`. Hold 173 Hz, set Smoothing and Sequency motion to zero, then compare Basis order 1, 4, 8 and 16 with Sequency 1.

Listen: Increasing Walsh order adds sign changes and reorganizes many Fourier harmonics at once.

**Smooth the binary edges** — preset `checker-buzz`. Hold the preset and sweep Smoothing from 0% to 95%, leaving the basis controls fixed.

Listen: Rectangular transitions round off and upper spectral energy decreases without changing the selected basis sequence.

New DSP needed for greater depth: An independently weighted Walsh basis bank and inverse Walsh analysis/resynthesis.

## 4: Multiple-wavetable / vector synthesis

Working four-corner vector mixer. Bilinear X/Y mixing combines four continuously selectable built-in waveforms. Two corners use detuned phase accumulators; drift and quadrature motion move the mix coordinates.

- Corners use the same four analytic/table shapes, not four independently loaded multisamples or evolving wavetable sequences.
- Vector motion is an internal sine orbit with clamping at the square boundary.

**Read the four vector corners** — preset `pure-corner`. Hold 220 Hz with Drift, Vector orbit and Detune zero. Visit X/Y=(0, 0), (100, 0), (100, 100), (0, 100), then (50, 50).

Listen: The X/Y position changes source balance while nominal note pitch remains fixed.

**Separate timbral motion from beating** — preset `slow-vector-cloud`. Hold a note. Set Drift zero, Vector orbit 0.4 and Orbit rate 0.2 Hz; compare Detune 0 and 20 cents.

Listen: With zero detune, orbiting changes the spectrum. Added detune introduces beating on top of that motion.

New DSP needed for greater depth: Independent corner source slots and a programmable vector-envelope trajectory.

## 5: Wave-terrain synthesis

Working analytic wave-terrain model. Two phase-driven coordinates trace a rotated, offset elliptical/Lissajous path across a fixed nonlinear two-dimensional trigonometric surface.

- The terrain is one hard-coded analytic surface; height changes its spatial frequency/shape rather than loading a measured heightmap.
- Nonlinear coordinate-to-amplitude mapping can create high-frequency components; there is no general antialiasing of the terrain.

**Trajectory size reads more surface detail** — preset `small-round-orbit`. Hold 173 Hz. Set Path ratio 1 and offsets zero; sweep X radius and Y radius together from 10% to 90%.

Listen: A wider path crosses more ripples, producing a denser spectrum without adding another oscillator bank.

**Rational and noninteger paths** — preset `uneven-orbit-bell`. Hold 173 Hz with the radii fixed. Compare Path ratio 1, 1.5, 1.4142 and 2.

Listen: Simple ratios retrace a short path; a noninteger ratio lengthens or complicates the waveform repetition.

New DSP needed for greater depth: User-defined/loaded terrain functions or heightfields with suitable interpolation and antialiasing.

## 6: Granular synthesis

Working sampled granular engine. A pool of 128 windowed grains reads the mono source, with independent grain length, launch density, source scan, position spray, pitch scatter and probabilistic reversal.

- Launches are regularly timed; random position/pitch does not make the scheduler itself asynchronous.
- There is no per-grain stereo position, arbitrary grain-envelope editor or independent voice-pool scheduling API. Pool size and source length are bounded.

**From isolated grains to a cloud** — preset `sparse-grains`. Hold 220 Hz. Set Grain size 80 ms, Scan speed zero and both spreads zero. Increase Density from 2 to 20 to 100 grains/s.

Listen: At low density each windowed fragment is exposed; overlap fuses events into texture.

**Freeze position without freezing pitch** — preset `frozen-cloud`. Hold 220 Hz, set Scan speed zero, then move Source position from 0.2 to 0.8. At a fixed position compare Pitch spread 0 and 12 semitones.

Listen: Zero scan speed reuses a fixed neighborhood while grains continue playing; pitch scatter spreads their spectral locations.

**Time localization broadens the spectrum** — preset `fine-sand`. Hold 220 Hz at Density 120/s and Pitch spread zero. Compare Grain size 100, 20 and 2 ms.

Listen: Shortening grains from tens of milliseconds toward one millisecond reduces recognizable source structure and broadens the spectrum.

New DSP needed for greater depth: Asynchronous/Poisson or user-pattern grain timing; stereo grain spatialization and live circular-buffer granulation.

## 7: Subtractive synthesis

Working source/filter subtractive voice. Sine/saw/pulse and noise feed a state-variable filter with low-pass, band-pass, high-pass and notch outputs, resonance, input drive and an envelope-to-cutoff mapping.

- This is one filter topology; it does not emulate every ladder, diode or zero-delay-feedback circuit.
- Filter response and source antialiasing have numerical limits near Nyquist. No general external-audio input is connected to this voice.

**Cutoff removes harmonics; resonance emphasizes its edge** — preset `open-saw-lead`. Hold 110 Hz. Select Lowpass, set Cutoff envelope zero and Resonance 10%; sweep Cutoff 10000→200 Hz. Repeat at Resonance 75%.

Listen: The low-pass removes upper harmonics as cutoff falls; resonance adds a peak around the moving cutoff.

**Four filter responses on the same broadband source** — preset `breathing-noise`. Hold a note with Noise 100%, Cutoff 1500 Hz and Cutoff envelope zero. Compare all four Filter mode choices.

Listen: Low-pass keeps the bottom, high-pass keeps the top, band-pass isolates a region and notch removes a region.

**Spectral attack independent of loudness attack** — preset `muted-saw-bass`. Retrigger the same 110 Hz note. Keep base Cutoff at 250 Hz and compare Cutoff envelope 0, 3 and 6 octaves.

Listen: A positive cutoff envelope opens the filter during the note attack, then the common envelope closes it toward the base cutoff.

New DSP needed for greater depth: Alternative filter topologies/true circuit models and an external-audio source route.

## 8: Linear predictive coding (LPC)

Real single-frame LPC analysis and synthesis. Autocorrelation and Levinson–Durbin estimate 2–24 all-pole coefficients from a selected, Hann-windowed source frame. Pre-emphasis, analysis stride and pole-radius contraction alter the model; pulse/saw/noise excite its recursive filter.

- Model / vowel selects source position, not a named phoneme. The default source is synthetic.
- Only one frame is modeled at a time; there is no time-varying speech analysis, residual-excitation extraction, formant tracking, articulatory model or LPC codec.

**One spectral envelope, voiced or whispered** — preset `dark-voiced-model`. Hold 137 Hz, keep Model / vowel and Analysis spectral scale fixed, and sweep Breath from 0% to 100%.

Listen: The harmonic comb becomes noisy while the resonant spectral envelope remains recognizable.

**Model order controls spectral detail** — preset `bright-voiced-model`. Hold 137 Hz with Breath zero. Compare Model order 2, 8, 16 and 24 poles; then compare Pole radius 0.96 and 0.995.

Listen: Few poles give a broad fit; more poles can resolve more resonant detail from the same analyzed frame.

**Analysis stride is not an anatomical vocal tract** — preset `long-tract`. Hold pitch at 137 Hz and compare Analysis spectral scale 0.65, 1 and 1.7 while leaving the frame position fixed.

Listen: Changing analysis spectral scale moves the source content sampled by the analysis and hence the fitted resonances; it is not a physical tube-length control.

New DSP needed for greater depth: Streaming frame analysis/coefficient interpolation, pitch/voicing estimation and residual resynthesis for intelligible speech.

## 9: Amplitude modulation (AM)

Working amplitude modulation voice. A carrier is multiplied by an offset sine-to-square modulator; ratio, absolute-Hz offset, depth, bias and carrier harmonics independently affect the product.

- At low Bias the multiplier can be bipolar, so this panel overlaps ring modulation rather than representing only positive tremolo.
- The carrier has no independent sample input; a rich or high-frequency modulator can introduce aliases.

**Tremolo becomes audio-rate sidebands** — preset `slow-tremolo-edge`. Hold 110 Hz with sine carrier/modulator, Bias 100%, Depth 100% and Modulator offset 0 Hz. Compare Frequency ratio 0.0625, 0.25 and 1.

Listen: Slow modulation is heard as level pulsing; faster modulation creates separate sum/difference spectral lines.

**Carrier and the first sideband pair** — preset `dry-carrier`. Hold 220 Hz, set Frequency ratio 0.5, Bias 100% and sine shapes. Sweep Depth 0→100%.

Listen: At ratio 0.5 the 220 Hz carrier acquires components at 110 and 330 Hz as depth increases; the bias preserves carrier energy.

New DSP needed for greater depth: External carrier/modulator routing and arbitrary operator graphs.

## 10: Ring modulation

Working bipolar product/ring modulation. An independently transposed sine-to-saw carrier is multiplied by a sine-to-square modulator. Offset restores carrier content; rectification and drive add further nonlinear shaping.

- Both signals are internally generated, so this is not yet a ring-modulation processor for microphone or files.
- Offset, rectification and drive change the simple product identity; use neutral values for the textbook sideband demo.

**Two inputs, sum and difference without a carrier** — preset `two-sine-sidebands`. Hold 440 Hz. Set Frequency ratio 0.25, both shapes to sine, Offset zero, Carrier transpose zero, Rectification zero and Input drive 1.

Listen: With a 440 Hz carrier and a 110 Hz modulator the product has components at 330 and 550 Hz; the original 440 Hz line is absent.

**DC offset restores the carrier** — preset `carrier-restored`. Hold 440 Hz with Frequency ratio 0.25 and sine shapes. Compare Offset 0%, 50% and 100%.

Listen: A nonzero modulator offset brings the carrier line back alongside the sidebands, connecting ring modulation with biased AM.

New DSP needed for greater depth: External audio/modulator routing and independent source selection.

## 11: Frequency modulation (FM)

Working direct-FM oscillator network. The carrier phase increment is modulated directly by a sine operator; negative increments are permitted. A second operator can act in parallel/serial, with delayed feedback and an exponentially falling index contribution.

- There are three oscillatory components with one fixed routing blend, not an arbitrary multi-operator algorithm editor or a full commercial FM architecture.
- High index, ratios and feedback can alias. Index envelope is a fixed exponential influence rather than an independent ADSR.

**Index distributes energy into FM sidebands** — preset `pure-starting-tone`. Hold 220 Hz with Frequency ratio 1, Feedback zero, Index envelope zero and Second operator depth zero. Compare Index 0, 1, 2.405 and 5.

Listen: Increasing index produces more sidebands at carrier plus/minus integer multiples of the modulator; carrier amplitude does not increase monotonically.

**Harmonic versus inharmonic ratio** — preset `inharmonic-bell`. Retrigger 220 Hz at Index 4 with Feedback and second-operator depth zero. Compare Frequency ratio 1, 2 and 1.4142.

Listen: Integer ratios align sidebands with a harmonic grid; a noninteger ratio produces a more bell-like inharmonic set.

**Bright attack, simpler tail** — preset `electric-tine`. Retrigger the preset. Set Index 6 and compare Index envelope 0% versus 100%.

Listen: A large initial index can decay while pitch and the common amplitude envelope remain otherwise unchanged.

New DSP needed for greater depth: Independent per-operator envelopes/routings and oversampled or more comprehensively band-limited nonlinear feedback.

## 12: Phase modulation (PM)

Working phase-modulation oscillator network. The carrier phase argument receives modulator, second-operator and delayed-feedback terms. The first modulator continuously changes from sine to triangle.

- PM and FM are related modulation formulations; they are not unrelated families. Fixed sinusoidal cases can have equivalent steady spectra, while changing envelopes and non-sinusoidal modulators differ.
- This is a limited operator network without independent per-operator ADSRs or anti-alias guarantees.

**Phase depth produces the sideband family** — preset `plain-phase-reference`. Hold 220 Hz with Frequency ratio 1, Feedback zero, Modulator shape zero and Second operator depth zero. Compare Phase depth 0, 1, 2.405 and 5 radians.

Listen: Increasing phase depth adds sideband pairs at the modulator spacing. At a fixed sinusoidal modulation, compare its spectral structure with the FM touchstone.

**The shape of phase motion matters** — preset `bent-triangle`. Hold 220 Hz at Frequency ratio 2 and Phase depth 3 radians, with Feedback and Second operator depth zero. Sweep Modulator shape from 0% to 100%.

Listen: Triangle modulation changes within-cycle phase velocity and the sideband distribution even at the same depth and ratio.

New DSP needed for greater depth: A general operator graph with operator-specific articulation and controlled oversampling.

## 13: Phase-distortion synthesis

Working breakpoint phase-distortion model. A cosine reads a piecewise-linear phase map, optionally warped a second time; resonance multiplier, window and damping add a formant-like variant.

- The map is a compact phase-distortion construction, not an emulation of a particular instrument’s complete architecture.
- The resonance and window controls make this more than a pure two-segment phase warp; high settings are not generally band-limited.

**Bend phase while keeping period** — preset `unbent-reference`. Hold 220 Hz with Resonance 1, Pulse character zero and Second distortion zero. Set Distortion amount 100%; compare Breakpoint 50%, 10% and 90%.

Listen: Changing the breakpoint compresses part of the phase cycle and expands another, adding harmonics without changing the master period.

**Windowed phase resonance** — preset `resonant-synthetic-vowel`. Hold 137 Hz. Compare Resonance 1, 3 and 6 with Pulse character 100%; then compare Resonance damping 0 and 0.6.

Listen: More internal cosine cycles emphasize an upper region; the pulse window and damping change its bandwidth and edge.

New DSP needed for greater depth: Arbitrary phase-transfer curves, more breakpoints and antialiasing appropriate to phase-map corners.

## 14: Waveshaping

Working nonlinear transfer-function voice. A built-in source passes through sine/tanh transfer curves and reflected wavefolding with input bias, wet mix and optional output quantization.

- Transfer shape interpolates two supplied functions rather than accepting arbitrary transfer tables or Chebyshev coefficients.
- Direct waveshaping can alias; the ADAA panel demonstrates an alternative for two other supported transfer functions.

**Symmetry determines odd and even harmonics** — preset `hard-odd-harmonics`. Hold 220 Hz with sine Source waveform, Fold zero and Transfer shape 100%. Set Drive 5; compare Asymmetry 0 and 0.4.

Listen: Symmetric shaping of a sine emphasizes odd harmonics; shifting the input breaks symmetry and adds even components.

**Folding creates new turning points** — preset `folded-sine-lead`. Hold 220 Hz with sine Source waveform, Asymmetry zero and Fold 100%. Compare Drive 1, 3 and 7 while watching the waveform.

Listen: Wavefolding reflects large excursions back into the range, adding reversals and a different harmonic pattern from saturation.

New DSP needed for greater depth: User-defined/Chebyshev transfer functions and appropriate antialiasing for those functions.

## 15: Discrete summation formulas (DSF)

Working closed-form finite sinusoidal sum. A finite geometric series of complex sinusoids implements DSF in constant work per sample, with geometric rolloff, spacing, alternate-component mix, phase and a 1–8 count multiplier.

- Direct count 1–256 becomes at most 2048 with the multiplier; the actual count is reduced to omit above-band components.
- The amplitudes follow a geometric law, so this is not an arbitrary additive spectrum editor.

**Geometric rolloff changes brightness** — preset `falling-harmonic-comb`. Hold 110 Hz at Partial spacing 1, Partial count 64 and multiplier 1. Compare Rolloff 20%, 70% and 95%.

Listen: A larger geometric radius retains more high components; count alone has little effect when the higher terms are already tiny.

**Spacing is independent of carrier offset** — preset `wide-metal-spacing`. Hold 173 Hz at Partial count 12 and Rolloff 85%. Compare Partial spacing 1, 1.5 and 2.4142, then Carrier offset 0 and 0.5 partials.

Listen: Changing the spacing moves the gaps between neighboring components while carrier offset translates the series origin.

New DSP needed for greater depth: Additional closed-form spectral families if desired; arbitrary independent partials belong in an expanded additive bank.

## 16: Physical modeling: mass–spring

Working nonlinear mass–spring chain. An 8–32-mass one-dimensional chain advances by two symplectic substeps per sample. Coupling, bounded cubic nonlinearity, damping, mass gradient, end constraints and spatial strike/pickup affect the state.

- An abstract chain, not a measured bar/string or a complete physical-modeling library. Numerical stiffness and displacement are bounded.
- The pickup includes a mirrored secondary point rather than one calibrated displacement sensor.

**Excitation and observation select modes** — preset `balanced-elastic-bar`. Retrigger 110 Hz with Mass gradient 0 and Pickup position 0.32. Compare Strike position 50%, 20%, 5%; then hold the strike fixed and move Pickup position 0.2→0.7.

Listen: Moving strike or pickup changes which spatial motions are strongly excited or heard while the chain remains unchanged.

**Loss versus nonlinear stiffness** — preset `rigid-bright-bar`. Retrigger. First compare Damping 5%, 30%, 70% with Spring nonlinearity 0; restore low damping and compare Spring nonlinearity 0 and 1.5.

Listen: Damping shortens vibration. Spring nonlinearity changes the motion itself and can make its spectrum depend on excitation strength.

New DSP needed for greater depth: Arbitrary connection topology, measured material parameters and energy-consistent contact/friction models.

## 17: Modal synthesis

Working 16-mode struck resonator. Up to 16 damped complex oscillators carry independent modal state. Frequency dispersion, per-mode decay/tilt and position-dependent initial excitation determine the ringing mixture.

- Mode frequencies/decays follow supplied laws; arbitrary measured modal datasets cannot be loaded.
- Excitation is an initial state update, not continuous bowing or external acoustic input.

**Harmonic series becomes an inharmonic object** — preset `harmonic-resonator`. Retrigger 173 Hz with Mode count 8, Mode detune 0 and Modal decay 2 s. Compare Inharmonicity 0%, 30%, 80%.

Listen: Harmonic modes sound pitch-centered; increased inharmonicity spreads upper modes into a metallic pattern.

**A nodal strike suppresses modes** — preset `center-muted-chime`. Retrigger 173 Hz with Inharmonicity 0, Mode count 12 and Strike noise 0. Compare Strike position 50% and 20%.

Listen: At the center, even-numbered modes receive little positional excitation; an off-center strike restores a different mixture.

New DSP needed for greater depth: Measured modal-data import, external excitation and nonlinear mode coupling.

## 18: Digital waveguide / nonlinear excitation

Working nonlinear reed/delay-loop model. A fractional delay models a traveling-wave round trip. A nonlinear reed pressure/flow approximation supplies energy; reflection, loss, bore smoothing and breath pressure/noise complete the loop.

- One lumped reed/bore abstraction, not calibrated wind instruments. Bore character is a smoothing mix, not a measured bore profile.
- Pressure includes the common envelope and output is also enveloped. Oscillation thresholds are real interacting parameter effects.

**Blowing changes a nonlinear feedback system** — preset `gentle-reed`. Hold 173 Hz with factory reed/loss settings. Compare Pressure 35%, 50%, 70%, 90%; keep output level fixed.

Listen: Pressure can change oscillation strength and harmonic balance; it is not merely output volume.

**Reed and loss act inside the loop** — preset `clear-pipe-line`. Hold 173 Hz at Pressure 70%. Compare Loss 5%, 30%, 60%; restore 15% Loss, then compare Reed stiffness 20% and 80%.

Listen: Increasing loop loss softens resonance and may stop sustained oscillation; reed stiffness changes energy input.

New DSP needed for greater depth: Segmented bore scattering, tone holes/radiation and alternative lip/jet/bow boundary models.

## 19: Karplus–Strong synthesis

Working extended Karplus–Strong loop. Noise/displacement fills a fractional delay loop. Low-pass loss, frequency-related decay, first-order allpass dispersion, feedback polarity and a pick-noise burst shape its response.

- One abstract string loop, without frets, bridge/body coupling or sympathetic strings.
- Feedback inversion passes through zero feedback at its midpoint; it is not a pure phase rotation.

**Short excitation, long resonant response** — preset `natural-string-pluck`. Retrigger 173 Hz with Decay 3 s. Compare Damping 5%, 40%, 85%, keeping excitation fixed.

Listen: The loop recirculates initial excitation; loss changes spectral decay and apparent material.

**Pluck position creates spectral notches** — preset `hollow-center-pluck`. Retrigger 173 Hz with Noise / displacement 0, Excitation length 1 and String dispersion 0. Compare Pick position 50%, 20%, 5%.

Listen: A center displacement pluck suppresses part of the harmonic series; an edgeward pluck excites a brighter mixture.

**Dispersion changes resonance spacing** — preset `long-wire`. Retrigger with low damping and Feedback inversion 0. Compare String dispersion 0, 0.3, 0.7.

Listen: An allpass inside the loop changes phase delay by frequency, shifting upper resonances away from ideal harmonic alignment.

New DSP needed for greater depth: Coupled strings/body resonances and physically calibrated frequency-dependent loss/dispersion.

## 20: FOF / CHANT formant synthesis

Working FOF-style formant-grain generator. Fundamental-period launches create overlapping exponentially decaying sine bursts with a finite attack. Formant, bandwidth, duration in decay constants and a second related formant shape the sum.

- Two related formants, not a complete multi-formant CHANT voice with independent trajectories and articulation rules.
- Active grains use current formant controls; onset is a linear ramp and finite support differs from particular historical CHANT implementations.

**Separate pitch from formant center** — preset `open-low-vowel`. Hold 137 Hz with Bandwidth 100 Hz and Second formant 0. Compare Formant 500, 1000, 2000 Hz. Then hold Formant 1000 Hz and compare note pitches 110 and 220 Hz.

Listen: Harmonic spacing follows note frequency; the strongest spectral region follows formant frequency.

**Bandwidth is related to grain decay** — preset `narrow-singing-band`. Hold 137 Hz at Formant 1000 Hz and Grain decay span 6 time constants. Compare Bandwidth 40, 150, 500 Hz.

Listen: Narrow bandwidth produces longer ringing bursts and a tighter spectral region; broad bandwidth shortens bursts and spreads energy.

**Hear individual formant grains** — preset `separated-vocal-pulses`. Set Frequency 20 Hz and Formant 800 Hz. Compare Grain onset 0.1 and 8 ms, then raise Frequency to 100 Hz to hear fusion.

Listen: At low repetition rate, each damped sine burst becomes an event rather than a fused vowel-like tone.

New DSP needed for greater depth: Four or more independent formants, glottal/noise articulation and time-varying vowel trajectories.

## 21: VOSIM

Working VOSIM-style pulse packets. Each fundamental period contains a damped packet of squared-sine pulses followed by silence. Count, damping, curvature, chirp and alternating polarity modify the train.

- A compact VOSIM variant, not a copy of a complete historical voice synthesizer. Packets can be truncated by the available fundamental period.
- The implementation uses multiplicative per-pulse damping with optional polarity/curvature extensions.

**Build a packet of squared-sine pulses** — preset `single-pulse-whistle`. Hold 50 Hz at Formant 1000 Hz, Damping 20%, Silence 0 and Pulse curvature 1. Compare Pulses 1, 4, 12.

Listen: More pulses lengthen the packet and concentrate its formant structure; the scope reveals the sub-pulses.

**Silence and within-packet loss differ** — preset `gapped-vocal-rhythm`. Hold 50 Hz at Formant 1000 Hz and Pulses 8. Compare Silence 0% and 80%; restore 0% and compare Damping 10% and 80%.

Listen: Silence changes available gap/truncation; Damping changes the heights of successive pulses.

New DSP needed for greater depth: Multiple independently articulated VOSIM streams and explicit packet scheduling beyond a single fundamental-period window.

## 22: Window-function formant synthesis

Working windowed-formant oscillator. A Gaussian/Hann/triangle window multiplies one or two sinusoids inside each fundamental cycle, with movable center, width, phase and drift.

- A finite periodic construction rather than arbitrary STFT or FOF analysis/resynthesis.
- Window width/center interact with the cycle boundary; large drift can truncate effective packet support.

**Longer time window, narrower spectrum** — preset `narrow-spectral-band`. Hold 110 Hz at Formant 1200 Hz, Window skew 50%, Second formant 0 and Gaussian window. Compare Window width 90%, 35%, 8%.

Listen: A wide time window concentrates energy around the formant; a short one broadens it.

**Window shape controls spectral skirts** — preset `rounded-vowel-window`. Hold 110 Hz at Formant 1200 Hz, Window width 50% and Second formant 0. Compare Window selector 0, 1, 2.

Listen: Gaussian, Hann and triangle windows produce different side-lobe/edge behavior at the same nominal width.

New DSP needed for greater depth: Arbitrary independently scheduled windowed sinusoid atoms and independent multi-formant trajectories.

## 23: Waveform-segment synthesis

Working two-segment waveform construction. A quantized phase ramp traverses two power-curved segments with adjustable endpoints and join. Rectification further transforms the result.

- Two amplitude segments and 2–32 phase steps, not an arbitrary breakpoint/function language.
- Steps and joins are not band-limited. Curvature is an exponent, not a guaranteed monotonic softness control.

**Move the join while holding the period** — preset `balanced-bent-ramp`. Hold 220 Hz with Steps 32 and Rectification 0. Compare Breakpoint 50%, 15%, 85%, keeping endpoints fixed.

Listen: The waveform becomes asymmetric and redistributes harmonics while cycle length remains constant.

**Quantize phase, not output amplitude** — preset `stepped-staircase`. Hold 220 Hz and compare Steps 32, 8, 4, 2 while watching the scope; keep level/curvature controls fixed.

Listen: Fewer Steps create longer horizontal plateaus on the underlying curve.

New DSP needed for greater depth: Arbitrary breakpoint curves and antialiasing of corners/steps.

## 24: Graphic waveform synthesis

Working editable single-cycle waveform. Eight main amplitudes plus eight relative midpoint offsets define a periodic piecewise-linear waveform whose last segment wraps to its first point.

- A 16-knot single cycle, not arbitrary-resolution drawing, image-to-sound or graphical-score synthesis.
- Interpolation is linear and does not provide a complete band-limited playback system.

**Connected amplitudes define a waveform** — preset `drawn-sine`. Hold 220 Hz. Compare Point 3 at 1, 0, -1; restore 1 and compare Midpoint 3 offset 0 and 0.8.

Listen: Changing one point creates a localized deviation and introduces further harmonics.

**Break the symmetry of two hills** — preset `double-hill`. Hold 220 Hz. Set Point 3 to 1 and move Point 7 from 1 to 0, leaving the other points fixed.

Listen: Repeated half-cycle shapes emphasize the second harmonic; breaking their symmetry restores lower-period structure.

New DSP needed for greater depth: Arbitrary-resolution editing/import and band-limited table generation; image/spectrogram synthesis requires different DSP.

## 25: Noise modulation

Working stochastic AM/FM modulation. A held random process is smoothed for correlation and applied to amplitude or oscillator frequency. Rate, distribution, seed and envelope-dependent depth are explicit.

- AM → FM crossfades two modulation outputs rather than changing one connection continuously.
- Gaussian excitation approximates normal noise by summing uniform variables; arbitrary stochastic processes are absent.

**Correlated drift versus independent jumps** — preset `random-pitch-drift`. Hold 220 Hz with AM → FM 100%, Depth 3% and Noise rate 2 Hz. Compare Correlation 0%, 90%, 99%.

Listen: Strong correlation creates smoother pitch wandering; less correlation produces sharper steps.

**Move random modulation into the audio band** — preset `rough-amplitude-hiss`. Hold 220 Hz with AM → FM 0%, Depth 70% and Correlation 0. Compare Noise rate 2, 100, 1500 Hz.

Listen: Slow random amplitude motion becomes spectral broadening/noise around the carrier as update rate rises.

New DSP needed for greater depth: Additional random-process laws, simultaneous independent AM/FM paths and external carrier/modulator inputs.

## 26: Dynamic stochastic synthesis

Working dynamic-stochastic breakpoint model. A cyclic 3–32-point waveform undergoes bounded amplitude/duration walks. Uniform-to-heavy-tailed amplitude variation, interpolation and attraction to a sine contour shape its evolution.

- GENDY-inspired, not a reproduction of a particular Xenakis score or every GENDY variant.
- Amplitude reflects while duration clamps; the two probability laws are not independently selectable from a full distribution library.

**Amplitude walks change shape; duration walks change timing** — preset `stable-polygon-drone`. Hold with Waveform elasticity 0. Set Duration step 0% and raise Amplitude step 0→30%; then set Amplitude step 10% and raise Duration step 0→40%.

Listen: With duration fixed, amplitude variation reshapes the cycle; duration variation also disturbs timing and apparent pitch.

**Few moving points expose the mechanism** — preset `three-point-lurch`. Hold 110 Hz with Amplitude step 25% and Duration step 10%. Compare Breakpoints 3, 8, 24, then Interpolation 0 and 2.

Listen: Three points reveal individual large changes; a larger population gives finer, denser motion.

New DSP needed for greater depth: Additional stochastic recurrences/distributions and independent amplitude/duration boundary rules.

## 27: Pulsar synthesis

Working pulsaret-plus-silence oscillator. Each period contains a windowed sinusoidal pulsaret and a silent remainder. Duty, internal cycles, random duty variation, masking, damping and skew shape the train.

- Pulsaret shape is a sinusoid with an internal-cycle multiplier, not an arbitrary sample/wavetable.
- Scatter changes duty and masking drops pulses; the underlying repetition clock stays regular.

**Separate repetition clock and pulsaret duration** — preset `continuous-pulsaret`. Hold 110 Hz with Scatter 0, Pulse masking 0, Window 100% and Pulsaret formant 1. Compare Duty 100%, 50%, 20%, 5%.

Listen: Shortening the active part broadens/shifts formant structure while repetition rate stays fixed.

**Expose and omit individual pulsarets** — preset `sparse-low-knocks`. Set Frequency 20 Hz, Duty 20%, Scatter 0 and Pulsaret formant 4. Compare Pulse masking 0 and 0.7.

Listen: At 20 Hz individual events become perceptible; masking removes events without changing surviving shapes.

New DSP needed for greater depth: Arbitrary pulsarets, asynchronous scheduling and independent pulsaret/formant envelopes.

## 28: Phase-vocoder analysis–resynthesis

Real bounded offline phase-vocoder resynthesis. A 512-point Hann STFT stores 64 analysis frames with phase-derived instantaneous frequencies. A 128-sample-hop overlap-add resynthesizer moves/freezes frames, remaps bins, filters/gates bands and applies local phase locking/diffusion.

- Fixed-size offline analysis, with no live STFT input. A long uploaded file is represented by only 64 frames.
- Pitch remapping rounds to output bins and phase locking is local; this is not a transparent modern transient-preserving stretcher.

**Time stretch without tape-speed pitch shift** — preset `analysis-reference`. Hold 220 Hz with Transpose 0 and Phase diffusion 0. Compare Time stretch 0.5, 1, 4; restore 1 and compare Transpose-12, 0, 12 semitones.

Listen: Frame travel changes event duration while spectral pitch stays approximately fixed; transpose moves pitch separately.

**Freeze a spectrum while phases continue** — preset `diffuse-frozen-texture`. Hold 220 Hz. Set Freeze analysis to Frozen and Source offset 40%; compare Phase diffusion 0% and 80%, then move Source offset 20%→70% while frozen.

Listen: Frozen analysis stops frame travel while synthesis oscillations continue. Phase diffusion weakens temporal coherence.

New DSP needed for greater depth: Streaming analysis, variable/multiresolution windows, fractional-bin remapping and stronger transient/phase-coherence handling.

## 29: Scanned synthesis

Working scanned mass–spring waveform. A slowly updated 64-mass ring evolves a waveform; an independent audio-rate trajectory reads it. Stiffness, damping, mass gradient, centering and localized bow-like drive change the evolution.

- Fixed ring topology and linear-to-cosine trajectory; arbitrary matrices, paths and initial shapes are absent.
- Model update stride is in samples, so its physical update rate changes with host sample rate unless the stride is adjusted.

**Separate shape dynamics from readout pitch** — preset `slow-elastic-scan`. Hold 173 Hz with Damping 10% and Bow force 0. Compare Stiffness 10%, 40%, 80%, keeping Frequency and Scan shape fixed.

Listen: Stiffness speeds spectral evolution while the audio readout period stays at the held note frequency.

**Another trajectory reads the same evolving shape** — preset `sharp-scan-reed`. Hold 173 Hz with physical controls fixed. Compare Scan shape 0% and 100%, then Scan offset 0 and 0.25 cycle.

Listen: Nonuniform scan motion spends different time in different parts of the model, changing waveform and harmonics.

New DSP needed for greater depth: Arbitrary connection matrices, initial-shape loading, scan paths and model clock in physical units.

## 30: Corpus-based concatenative synthesis

Working small descriptor-guided concatenator. Forty-eight equal source segments receive brightness and one-step-correlation noisiness descriptors. A distance cost with continuity/randomness chooses windowed fragments with overlap/reversal.

- Descriptors select material rather than directly filtering it. Descriptor sharpness 0 removes descriptor influence.
- One source split into 48 equal segments and two simple descriptors; no multi-file corpus, onset segmentation, target-audio analyzer or sequence optimizer.

**Search for timbre instead of specifying partials** — preset `dark-tonal-mosaic`. Hold 220 Hz with Descriptor sharpness 4 and Continuity 20%. Compare Target brightness 0% and 100%, then Target noisiness 0% and 100%.

Listen: Target brightness selects different fragments; target noisiness prefers noisy material rather than adding output noise.

**Continuity and overlap change different parts of a join** — preset `cut-up-syllables`. Hold 220 Hz at Fragment length 100 ms. Compare Continuity 0% and 95%; restore 30% and compare Fragment overlap 0 and 0.8.

Listen: Continuity favors neighboring source regions; overlap blends fragments in time.

New DSP needed for greater depth: Multi-file indexing, richer descriptors, segmentation, target following and globally optimized concatenation.

## 31: PADsynth

Working PADsynth spectrum-to-table generator. Up to 96 harmonic-centered magnitude bands receive random phase and an 8192-point inverse FFT. Bandwidth, profile, scaling, harmonic stretch/balance and seed affect the loop.

- One finite periodic table, not unbounded stochastic texture or a stereo multi-table instrument.
- The table is prepared around 220 Hz and transposed on playback; bandwidths transpose too. FFT resolution and above-band omission limit narrow/high partials.

**Broaden harmonics into ensemble bands** — preset `narrow-harmonic-organ`. Hold 173 Hz with Bandwidth multiplier 1 and Harmonic count 32. Compare Bandwidth 2, 20, 80 cents.

Listen: Narrow bands resemble stable harmonic lines; wider bands create beating and ensemble texture.

**Phase seed changes temporal structure** — preset `wide-string-ensemble`. Hold 173 Hz with spectral controls fixed. Compare Phase seed 0%, 25%, 50%, 75%; inspect scope and averaged spectrum.

Listen: Random phase changes the waveform/fluctuation pattern while preserving the designed magnitude-band recipe.

New DSP needed for greater depth: Pitch-dependent/stereo tables, configurable larger FFTs and independent spectral profiles.

## 32: Vector phaseshaping

Working single-vector phase map. A two-segment phase map passes through a movable horizontal/vertical point; vertical can exceed one. Independent slow horizontal/vertical motion animates its cosine readout.

- One breakpoint vector; the source paper also describes multi-vector maps and further antialiasing.
- The central factory preset is a UI-center reference, not phase identity. At Horizontal 50%, identity requires Vertical 0.5.

**Find identity, then add phase travel** — preset `neutral-phase-vector`. Hold 220 Hz with Modulation depth 0 and Vertical motion 0. Set Horizontal breakpoint 50%; compare Vertical breakpoint 0.5, 1, 1.8.

Listen: At horizontal 0.5/vertical 0.5 the straight map yields a sinusoid; vertical above 1 adds extra phase travel before returning to the endpoint.

**Move the two vector coordinates independently** — preset `slow-moving-phase-pad`. Hold 220 Hz at Modulation rate 0.3 Hz and Vertical motion ratio 1. Compare Modulation depth 0% and 70%, then Vertical motion 0 and 0.6.

Listen: Horizontal movement changes segment durations; vertical movement changes phase excursion.

New DSP needed for greater depth: Multiple vectors and the alias-suppression techniques of the full vector-phaseshaping work.

## 33: Neural autoregressive synthesis

Genuine trained miniature autoregressive model. A 241-parameter 8→24→1 network predicts waveform samples from two previous predictions, phase conditions and three learned timbre conditions; temperature adds Gaussian sampling. Prediction clock 3–24 kHz is interpolated to host rate.

- A small periodic-sound teaching model trained on original synthetic data, not WaveNet or a speech/music generator.
- History stride/gain are experimental inference settings outside the original stride-one training task. Prediction bandwidth and training pitch coverage are limited.

**Ask the learned predictor for another timbre** — preset `clean-dark-prediction`. Hold 220 Hz with Temperature 0%, History amount 100% and Prediction rate 12000 Hz. Sweep Timbre 0%→100% while retaining the other learned conditions.

Listen: The same recurrent sample predictor generates a different harmonic shape when its condition changes.

**Deterministic prediction versus sampled variation** — preset `warm-uncertain-pad`. Hold 220 Hz. Compare Temperature 0%, 30%, 70%; at 70% retrigger with Sampling seed 0% and 50%.

Listen: Temperature perturbs each predicted sample; changing the seed affects variation only when temperature is active.

New DSP needed for greater depth: Larger temporal receptive fields, richer recorded training data and continuous full-band audio models.

## 34: Neural latent-space synthesis

Genuine trained miniature latent decoder. A learned four-dimensional latent vector decodes through 4→32→64 layers to a periodic waveform. A jointly trained encoder exists in source/tests; runtime provides band-limited table playback and latent-orbit control.

- This is a 64-sample periodic autoencoder, not RAVE or a continuous audio autoencoder. No live input is encoded by this panel.
- Coordinates span learned percentile ranges; arbitrary combinations/spread can leave well-supported training regions.

**One learned coordinate is a timbral direction** — preset `latent-center`. Hold 220 Hz with Y/Z/W 0, Latent spread 1 and Orbit depth 0. Compare Latent X-1, 0, 1.

Listen: Moving X changes the decoded waveform at fixed pitch; X is learned, not a manually labeled oscillator coefficient.

**Travel through the decoder space** — preset `y-to-z-diagonal`. Hold 220 Hz. Set Orbit planeYZ, Orbit rate 0.2 Hz and compare Orbit depth 0% and 50%.

Listen: An orbit changes actual latent coordinates and decoded spectral shape, rather than applying vibrato to a fixed sound.

New DSP needed for greater depth: Streaming audio encoder/decoder, larger training corpus, temporal latent state and full-band synthesis.

## 35: Differentiable DSP (DDSP)

Genuine trained miniature DDSP controller. A 345-parameter 4→24→9 network predicts eight harmonic amplitudes and one noise amplitude; differentiable waveform synthesis was inside its training loss. Runtime uses the learned controller plus a harmonic/noise bank.

- This is a small original DDSP teaching model, not the full Google DDSP package or recorded-instrument timbre transfer.
- Only eight harmonics and four learned conditions are modeled; stretch, color and attack extensions do not add newly trained conditioning dimensions.

**A network controls the harmonic bank** — preset `dark-learned-harmonics`. Hold 220 Hz at Partial count 8, Harmonic stretch 1 and Noise 0%. Compare Brightness 0%, 50%, 100%.

Listen: Brightness changes amplitudes inferred by the learned controller; it does not simply turn one output low-pass filter.

**Learned harmonic balance and noise contribution** — preset `odd-learned-reed`. Hold 220 Hz. Compare Odd / even 0% and 100%; return 50% and compare Noise 0% and 100%.

Listen: Odd/even conditioning changes predicted harmonic weighting; noise conditioning changes the model’s noise branch.

New DSP needed for greater depth: Audio feature extraction/encoding, recorded-data training, richer harmonic/noise representations and time-varying resynthesis.

## 36: Diffusion-based synthesis

Genuine trained miniature diffusion frame model. An 8512-parameter denoiser predicts clean 64-sample frames during 4–20 DDIM reverse steps. Conditions, seed, endpoint, stochasticity and regeneration affect generated periodic waveforms.

- Periodic 64-sample generation, not DiffWave speech or unrestricted long-form/text-to-audio synthesis.
- Every normal step-count setting reaches the clean endpoint; fewer steps do not mean a defined amount of leftover noise. Condition contrast uses a neutral-conditioned reference, not a trained unconditional branch.

**Compare reverse-step approximations at one seed** — preset `denoised-dark-frame`. Hold 220 Hz with Residual noise 0%, Sampling stochasticity 0%, Regeneration rate 0 and fixed Variation. Compare Denoising steps 4, 8, 20.

Listen: Step count changes the reverse trajectory and resulting frame; differences need not be a monotonic noise-to-clean ladder.

**Residual endpoint and repeated regeneration** — preset `alternate-noise-seed`. Hold 220 Hz. Compare Residual noise 0% and 60%; return 0%, then compare Regeneration rate 0 and 1 Hz with Sampling stochasticity 50%.

Listen: An earlier endpoint retains more noise-like frame structure; regeneration replaces the periodic frame with newly generated variants.

New DSP needed for greater depth: Long-context audio diffusion, conditioning encoders, larger models/training data and streaming temporal generation.

## 37: Alias-reduced oscillators

Working comparison of four oscillator algorithms. Naive saw/pulse, polyBLEP, differentiated polynomial waveform and short minimum-phase BLEP correction are separate code paths. Quantization, dither, drive and 1×/2×/4× internal sampling are explicit.

- These reduce different aliases; none guarantees alias-free output under every pitch, pulse width or nonlinear drive.
- The oversampling path averages sub-samples rather than providing a full high-order decimation filter.

**Matched saw alias comparison** — preset `high-na-ve-saw`. Hold 1907 Hz with Saw → square 0%, Drive 1, Quantization 24 bits, Dither 0 and Oversampling 1×. Compare Algorithm Naive, PolyBLEP, DPW and MinBLEP.

Listen: At the same non-harmonically convenient high note, correction reduces folded components unrelated to the intended harmonic ladder.

**Narrow pulses challenge discontinuity correction** — preset `na-ve-narrow-pulse`. Hold 1907 Hz with Saw → square 100%, Pulse width 10%, Drive 1 and Oversampling 1×. Compare Algorithm Naive, PolyBLEP and MinBLEP.

Listen: A narrow pulse has strong high-frequency content; corrected algorithms reduce edge aliases while preserving the intended pulse spectrum.

New DSP needed for greater depth: Higher-order correction, stronger antialias resampling and matched spectral benchmarking across pitch/control modulation.

## 38: Antiderivative antialiasing (ADAA)

Working first-order antiderivative antialiasing. Exact antiderivatives of tanh and x/sqrt(1+x²) form a divided-difference ADAA output, with a near-zero-difference fallback. Direct/ADAA mix, bias, drive and pre-emphasis are implemented.

- Only two supported transfer functions and first-order ADAA are present; this is not a universal distortion antialiaser.
- ADAA also changes delay/frequency response, so audible differences are not exclusively alias removal.

**Same nonlinearity, direct versus ADAA** — preset `high-direct-saturation`. Hold 1487 Hz with Drive 9, Asymmetry 0, Sine / saw source 0, Shaping mix 1 and Input quantization 24 bits. Compare ADAA mix 0% and 100%.

Listen: At high pitch and drive, ADAA changes the folded spectrum while retaining the intended saturation family.

**Compare asymmetric clipping at matched settings** — preset `biased-direct-clipping`. Hold 1487 Hz at Asymmetry 0.4 and Drive 7. Compare ADAA mix 0% and 100%, then compare Transfer shape 0% and 100% with ADAA enabled.

Listen: Bias creates even harmonics; the ADAA comparison should keep that bias and the transfer curve unchanged.

New DSP needed for greater depth: Higher-order ADAA, compensation and antiderivatives for other transfer functions.

## 39: Hard-sync oscillator

Working fractional-event hard-sync oscillator. A master wrap resets a faster slave at the fractional crossing time. Sine/saw/pulse slave shapes, reset depth/phase, jitter, envelope-driven ratio and value-jump BLEP correction are real.

- Correction handles value discontinuities, not every derivative discontinuity. Master/slave increments are bounded.
- This is an oscillator model, not a full emulation of any named analog synthesizer.

**Sweep the slave while the master anchors repetition** — preset `classic-synced-saw`. Hold 173 Hz with Slave waveform Saw, Sync envelope 0, Sync depth 1 and Sync jitter 0. Sweep Slave ratio 1→2.3→5.7→10.

Listen: At full sync, the slave shape changes strongly while the master fixes the repeat period.

**Correct the same reset event** — preset `direct-reset-comparison`. Hold the preset at its existing pitch and compare Antialias sync Off and On; keep ratio, waveform and reset phase fixed.

Listen: Toggling correction changes folded high-frequency artifacts without changing the intended master/slave settings.

New DSP needed for greater depth: Higher-order discontinuity correction and more general oscillator-routing/circuit models.

## 40: Single-sideband modulation / frequency shifting

Working analytic-source single-sideband synthesis. Exact sine/cosine quadrature for a 1–32-harmonic source permits additive-Hz translation. Upper/lower and dry/wet blends mix analytic modulation products.

- No Hilbert/analytic transform is applied to imported audio: this is an internal source, not yet a general frequency-shifting effect.
- Modulator ratio/harmonics actually describe the source harmonic bank. Out-of-band translated components are omitted.

**Frequency translation is not transposition** — preset `unshifted-harmonic-source`. Hold 220 Hz with Modulator ratio 1, Modulator harmonics 4, Upper / lower 0, Sideband mix 1 and Shift motion 0. Compare Frequency shift 0 and 100 Hz.

Listen: Adding 100 Hz changes 220/440/660/880 Hz to 320/540/760/980 Hz; the spacing stays 220 Hz and harmonic ratios change.

**Dry plus slightly shifted creates beating** — preset `near-zero-beating`. Hold 220 Hz with Frequency shift 2 Hz and Shift motion 0. Compare Sideband mix 1 and 0.5; then compare Frequency shift 2 and 10 Hz.

Listen: A tiny additive shift produces a common beating offset across source partials, unlike proportional detuning.

New DSP needed for greater depth: A broadband analytic-signal/Hilbert path for arbitrary external input.

## 41: Multiscale wavelet synthesis

Working finite multiscale wavelet construction. Periodic sums of scaled/translated Morlet-like, Ricker and Haar mother functions use configurable scale count, spacing, decay, translation, motion and optional chirp.

- Arbitrary scales are not an orthonormal wavelet transform or an invertible audio analysis/reconstruction system.
- Sub-sample packets are omitted. Haar has no chirp dependency; chirped Ricker is a modified mother function.

**Add finer localized scales** — preset `one-scale-morlet-pulse`. Hold 110 Hz with Wavelet family Morlet, Scale spacing 2, Wavelet width 0.25 and Scale motion 0. Compare Scale count 1, 3, 6.

Listen: More scales add localized high-frequency detail to a broader packet; coarse/fine structure is visible in the scope.

**Mother wavelet determines local shape** — preset `mexican-hat-layers`. Hold 110 Hz with Wavelet chirp 0 and Scale count 3. Compare Wavelet family Morlet, Mexican hat/Ricker and Haar; keep width/spacing fixed.

Listen: Morlet oscillates within a smooth envelope, Ricker has a central lobe and side lobes, and Haar has abrupt opposite-sign steps.

New DSP needed for greater depth: Wavelet analysis/inverse reconstruction of actual source audio and independent editable scale/translation coefficients.

## 42: Colored / 1/f noise synthesis

Working finite-band colored-noise synthesis. Twelve logarithmic bands of independent filtered noise approximate power slope P(f)∝f^-alpha. Distribution, sample hold with variance compensation, band limits, resonance and flutter alter the result.

- A finite-band approximation, not an exact 1/f process over every frequency/time scale. Cutoffs and sample hold modify final slope.
- Gaussian excitation sums six uniforms; binary excitation is variance-normalized two-level noise, not a chip LFSR.

**White, pink and brown describe spectral slope** — preset `white-noise-reference`. Hold with Sample hold 1, Low cut 20 Hz, High cut 20000 Hz and Resonance 0. Compare Spectral exponent 0, 1, 2, then-1 for blue.

Listen: White is roughly flat power density; pink favors lower octaves and brown more strongly emphasizes slow motion.

**Distribution and hold are different controls** — preset `held-binary-crackle`. Hold with Spectral exponent 0 and Resonance 0. Compare Distribution Uniform and Binary at Sample hold 1; keep Binary and compare Sample hold 1, 8, 32.

Listen: Binary excitation changes amplitude statistics; holding samples creates longer steps and a changed high-frequency spectrum.

New DSP needed for greater depth: Other exact/long-memory stochastic constructions and explicit chip/register noise generators.

## 43: Stochastic particle shaker

Working physically informed stochastic shaker. A decaying energy reservoir controls random collision probability/energy; four damped complex resonators represent an abstract container. Particle count, contact spectrum, Q and continuous replenishment affect real state.

- A probabilistic collision/resonator model, not a geometric simulation of individual particles.
- Collision statistics depend on RNG state/sample rate. Factory trims use sampled rate/state headroom, not an absolute bound over every sequence.

**Sparse collisions become a dense shake** — preset `sparse-beads`. Retrigger with Continuous shake 0 and Energy decay 1 s. Compare Particle count 4, 32, 128 at Collision rate 0.2, then compare Collision rate 0.05 and 0.8.

Listen: Particle count and collision rate alter event density and overlap; they are not simply noise volume.

**Replenish energy versus strike and decay** — preset `continuous-shake-gesture`. Hold a note with the common Sustain at 100%. Compare Continuous shake 0, 0.3, 0.8; then release the note and hear the reservoir decay.

Listen: Without replenishment collisions run down; continuous shaking sustains their energy while the gate remains held.

New DSP needed for greater depth: Additional contact/body models, independent container modes or geometric particle interaction if that is the intended study.

## 44: Two-dimensional finite-difference membrane

Working two-dimensional finite-difference membrane. A 6–16-node-per-side grid uses three time planes to solve a damped 2 D wave equation. Gaussian strike, bilinear pickup, aspect, boundary blend and tension affect the field.

- A small abstract membrane, not a calibrated drum or stiff plate. No bending-stiffness term or acoustic radiation model is implemented.
- A conservative CFL bound limits effective speed at extreme tension/pitch; grid resolution changes dispersion and the represented spatial modes.

**Strike and pickup select two-dimensional modes** — preset `central-low-membrane`. Retrigger 97 Hz with Strike X/Y 0.5 and factory pickup. Compare Strike X 0.5 and 0.2; then keep strike fixed and move Pickup X 0.3→0.7.

Listen: Center and off-center strikes excite different spatial symmetries; pickup location changes which modes are observed.

**Strike width selects spatial detail** — preset `wide-soft-mallet`. Retrigger 97 Hz at a fixed strike/pickup position. Compare Strike hardness 0.1, 0.5, 0.95; then compare Aspect ratio 1 and 1.7.

Listen: A broad soft strike suppresses fine spatial detail; a harder narrow strike excites more high modes.

New DSP needed for greater depth: Stiff-plate terms, higher-order grids, material calibration and radiation/contact coupling.

## 45: Feedback delay network resonator

Working feedback-delay-network resonator. Two to eight fractional delays use Householder mixing blended with identity, lossy feedback, damping, allpass dispersion, saturation and polarity. A short pitched/noise burst excites the network.

- An internally struck resonator, not a general external-input reverberator. Storage bounds common network size while preserving path ratios.
- Intermediate Feedback inversion reduces gain; its midpoint removes feedback. It is not an allpass phase knob.

**Separate delay tones become a mixed resonator** — preset `few-coupled-delay-tones`. Retrigger 173 Hz with Delay lines 4, Decay 2 s and Feedback inversion 0. Compare Diffusion 0, 0.5, 1 while holding Network size fixed.

Listen: With weak mixing, individual loop responses remain apparent; stronger diffusion distributes excitation among paths.

**Size, decay and damping are independent dimensions** — preset `long-metal-chamber`. Retrigger 173 Hz at Decay 3 s. Compare Network size 0.01, 0.05, 0.15 s; then hold size 0.05 s and compare Damping 0.1 and 0.8.

Listen: Size changes path delays/resonance density; decay controls persistence and damping removes high frequencies from repeated circulation.

New DSP needed for greater depth: External input/radiation routing, alternative matrices and frequency-dependent decay design for a full reverb processor.

## 46: Rössler chaotic synthesis

Working numerical Rössler-system sonification. Fourth-order Runge–Kutta integrates the actual three-state Rössler ODE in double precision. Coordinate mix/rotation maps state to audio; adaptive substeps and escape resets bound numerics.

- Frequency controls nominal simulation speed, not an exactly tuned fundamental. Some settings are subsonic, periodic or escaping rather than chaotic.
- Escape handling restarts the initial condition; this is not a universal chaos generator or physical acoustic model.

**Observe the same system from another coordinate** — preset `classic-chaotic-orbit`. Hold the preset with Projection rotation 0. Compare Output X, Y and Z by values 0, 1, 2; then compare Projection rotation 0 and 90 degrees.

Listen: X, Y and Z have different waveform statistics; changing observation does not change the underlying equations.

**Integration speed differs from oscillator pitch** — preset `slow-irregular-drone`. Hold Frequency 132.5 Hz with equation parameters fixed. Compare Time scale 0.5, 1, 1.5; retrigger to compare the same initial condition.

Listen: Time scale accelerates the nonlinear trajectory, moving irregular spectral features; the result is not a guaranteed equal-tempered note.

New DSP needed for greater depth: Other specified maps/ODEs, coupled systems and analysis of attractor regime/sonification scaling.

## Source and validation limits

All referenced preset IDs exist and every structured physical gesture lies within the current control range. Actual DSP branches/analysis/inference were read. No new listening claims or sample renders were made for this content audit; prior factory level evidence remains separate.

Author-hosted Puckette, Brandt and vector-phaseshaping PDFs were retrieved and text-extracted; PADsynth and Csound FOF/VOSIM/GENDY manuals were retrieved; neural-family abstracts were retrieved, not full model replications. Roads full text and several other family papers were not retrieved in this audit. Two attempted Stanford URLs returned404; no claims depend on those URLs.

- puckette: [Miller Puckette, The Theory and Technique of Electronic Music](https://msp.ucsd.edu/techniques/latest/book.pdf). retrieved.
- roads: [Curtis Roads, The Computer Music Tutorial (1996)](https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/). Citation retained; full source was not retrieved in this audit.
- fof: [Csound reference implementation: fof](https://csound.com/docs/manual/fof.html). retrieved.
- vosim: [Csound reference implementation: vosim](https://csound.com/docs/manual/vosim.html). retrieved.
- gendy: [Csound reference implementation: gendy](https://csound.com/docs/manual/gendy.html). retrieved.
- scanned-manual: [Csound reference implementation: scanu](https://csound.com/docs/manual/scanu.html). Citation retained; full source was not retrieved in this audit.
- padsynth: [Paul Nasca, PADsynth algorithm (2005)](https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm). retrieved.
- hardsync: [Eli Brandt, Hard Sync Without Aliasing (2001)](https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf). retrieved.
- vps: [Kleimola et al., Vector Phaseshaping Synthesis (2011)](https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf). retrieved.
- wavenet: [van den Oord et al., WaveNet (2016): family reference](https://arxiv.org/abs/1609.03499). retrieved.
- rave: [Caillon & Esling, RAVE (2021): family reference](https://arxiv.org/abs/2111.05011). retrieved.
- ddsp: [Engel et al., DDSP (2020): family reference](https://arxiv.org/abs/2001.04643). retrieved.
- diffwave: [Kong et al., DiffWave (2020): family reference](https://arxiv.org/abs/2009.09761). retrieved.
- blep: [Välimäki et al., Alias-Suppressed Oscillators Based on Differentiated Polynomial Waveforms (2010)](https://doi.org/10.1109/TASL.2009.2026507). Citation retained; full source was not retrieved in this audit.
- adaa: [Parker, Zavalishin & Le Bivic, Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution (2016)](https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf). Citation retained; full source was not retrieved in this audit.
- corpus: [Schwarz, Concatenative Sound Synthesis: The Early Years (2006)](https://doi.org/10.1162/comj.2006.30.3.5). Citation retained; full source was not retrieved in this audit.
- wavelet: [Mallat, A theory for multiresolution signal decomposition: the wavelet representation (1989)](https://doi.org/10.1109/34.192463). Citation retained; full source was not retrieved in this audit.
- colored: [Voss & Clarke, 1/f noise in music (1978)](https://doi.org/10.1121/1.381721). Citation retained; full source was not retrieved in this audit.
- shaker: [Cook, Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds (1997)](https://doi.org/10.2307/3681012). Citation retained; full source was not retrieved in this audit.
- membrane: [Bilbao, Numerical Sound Synthesis (2009)](https://doi.org/10.1002/9780470749012). Citation retained; full source was not retrieved in this audit.
- fdn: [Julius O. Smith, Feedback Delay Networks (FDN)](https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html). Citation retained; full source was not retrieved in this audit.
- rossler: [Rössler, An equation for continuous chaos (1976)](https://doi.org/10.1016/0375-9601(76)90101-8). Citation retained; full source was not retrieved in this audit.

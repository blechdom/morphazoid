# Rezoidinator

Rezoidinator combines a playable modal body, audio processing, reverberation and
FFT resynthesis. Find it beside **SIMD Resonator** in **SIMD Audio**.
The display name changed from Rust Resonator; its `simd-resonator-rust` URL,
catalogue ID and saved-state keys stay compatible.
Audio starts off. **Use** opens on **Instrument body modeling**. Select an
**Excite** shape, enable Audio, then tap or drag the body or press the compact
trigger. With Body enabled, horizontal position sets excitation position and
vertical position sets hardness. With Body off, those axes control excitation
strength and burst length. Arrow keys edit the same controls; Enter or Space
triggers the selected excitation. The original instrument and SIMD Audio Lab retain
their existing engines. Output runs from 0% to 100%, where 100% is unity master
gain; it is independent of presets and the signal-path mix.

## Waves and spectrum span

The Rust scalar and `f32x4` SIMD kernels support 32–4,096 simultaneous damped
quadrature oscillators, in steps of four. The default is 512. **Waves** controls
the actual oscillator count. **Spectrum span** (8–512 modal orders) controls
their spectral extent independently: adding waves inside the same span creates
a denser body instead of sending most extra modes above Nyquist. It is a
modal-synthesis instrument, not a validated physical material simulation.

For mode index `i`, fractional order is `1 + i * (span - 1) / (waves - 1)`.
The original stiffness, irregularity, hardness rolloff, decay and stereo formulas
are evaluated at that order. Frequencies above `0.44 * sampleRate` are muted;
the body readout reports both allocated and audible modes. Excitation-energy
normalization uses audible coefficients rather than the number of muted modes.
When `waves = span <= 128`, the original coefficients and normalization match.

Twenty full presets include twelve original scenes and eight dense scenes up
to 4,096 waves. Presets and Dice also include spatial target, pattern, span,
offset, motion and rate. Preset/Next/Dice controls preserve Audio, output level,
input trim, selected source, an already playing sample, Surround enable, speaker
layout, stereo preview and recording. The separate **Material**
menu retains FFT settings. Reset restores the default body and clears its tail;
it retains live input and Audio. Changing modes clears removed oscillator states
so increasing the count cannot revive an old tail.
Modal edits fade the body down for one audio block, apply the new coefficients,
then fade it up for one block. FFT processing and sample playback continue
through that transition.

## Uses, sources and combinations

**Use** selects an application of the instrument. The **Body**, **Process**,
**FFT** and **Reverb** switches combine its actual signal stages. Source selection
is independent: microphone/line input, a local audio file, looping samples and
the built-in excitation can feed every use. Changing a use, character or sound
preset does not restart an already playing sample or request microphone access.

| Use | Audible operation | Useful combination |
| --- | --- | --- |
| Instrument body modeling | A driving signal excites the bank's damped resonances. Material presets change their spacing, weighting and decay. | Add FFT for the source's spectral detail, or Reverb for a separate tail. |
| Audio processing | A lowpass, highpass or bandpass filter and saturation shape the incoming sound. Filter bypass retains the drive stage. | Process before the body or FFT to change what excites or enters it. |
| Reverberation | A separate feedback-delay network makes multiple recirculating, damped returns from the input. | Place the body, FFT or both into the reverberant space. |
| Resynthesis | Windowed FFT analysis and inverse-FFT reconstruction reshape the source's spectrum. | Blend with the body for recognizable input plus ringing, then add Reverb. |

The order is **Source → optional Process → Body/FFT blend → optional Reverb →
Wet/dry**. Body and FFT are parallel responses; they are not applied in sequence.
Body mix blends the processed source toward the modal body; FFT mix blends that
result toward spectral reconstruction. Their enable switches smoothly bypass
the corresponding contribution. With both off, the processed source passes
through to the optional reverb. Wet/dry blends the complete result with the raw
source. The small signal-path readout follows the enabled stages.

These labels describe uses, not mutually exclusive scientific categories.
Resonant filtering is already audio processing, and a dense modal bank with
long decay can have a reverberant character. The dedicated Reverb stage adds a
different mechanism: a feedback-delay network that can also process the source
without the body. Material and room characters are expressive approximations,
not measurements of particular objects or spaces.

The Use menu changes enabled stages and their balances. It retains each stage's
sound controls, excitation and spatial settings. Reverb characters include
Short room, Dark chamber, Bright tail, Long hall and Dark cloud; they change only
reverb time, damping and mix. Resynthesis characters include Clear detail, Fast
transients, Broad bands, Spectral fog and Narrow radio; they change only FFT
settings. Full presets and Dice own all musical settings, including these stages
and the excitation. Older saved modal/FFT snapshots migrate with their original
FFT settings and an impulse excitation. Audio arming, source, transport, input
trim, output level, speaker layout and recording remain session state.

## Excitation and input

The shared microphone gain → meters → mic strip sits in the menubar on desktop
and beside presets on mobile. Input-source selection, the sample menu, file
chooser, Play/Stop and looping controls live in the side panel. Microphone trim
affects capture only; it does not change file or sample gain. The compact trigger
and direct body gesture use the selected **Excite** shape, including while a
microphone, file or sample is playing.

| Excite shape | Driving signal |
| --- | --- |
| Short impulse | One nonzero sample. Duration does not apply. |
| White noise burst | Noise with a short attack and smooth burst envelope. |
| Pink noise burst | A similar burst with an approximate low-frequency spectral tilt. |
| Pluck | Filtered noise with a rapidly falling envelope. |
| Soft strike | A smooth, rounded contact pulse. |
| Hard / bell strike | A more asymmetric contact pulse with a sharper effective attack. |

Strength and duration change the contact event; the body's frequencies and
decays determine the resulting ringing pitches. A bell-like result requires a
suitable body, not just a hard strike. These are synthesized force/noise shapes,
not recordings or complete nonlinear plectrum/hammer simulations. Eight events
can overlap; additional triggers reuse the oldest event slot. Duration-aware
level scaling bounds burst energy, while longer smooth contacts naturally excite
less high-frequency energy. Excitation joins the source stream before processing,
so it reaches FFT resynthesis and reverb as well as the Rust body. Initial zero
history keeps a first impulse from disappearing at an FFT window's endpoint.

Mic/line, the shared sample menu, and local audio files feed the
phase-preserving FFT/overlap-add path and the modal body when enabled. Audio gates output
independently of microphone capture. Sample playback can loop. Audio off, page
departure, and hidden-page handling cancel pending input work; microphone tracks
are released. Sound presets never request a microphone or restart a sample.

The FFT retains 256–4,096-sample frames, four window shapes, 16–128 envelope
bands, overlap, memory, detail, drive, gate and frequency bounds. FFT mix
blends the body/source response with phase-preserved spectral reconstruction. These
FFT operations remain JavaScript in the AudioWorklet; the oscillator bank is
Rust. JavaScript prepares coefficients outside the render callback. No server,
CPAL, shared memory, or browser audio worker threads are required.

The FFT path includes the original instrument’s later continuity improvements:
a bounded overlap-normalization floor and startup ramp, smoothed gain/detail/
gate changes, and a warmed spare FFT bank with a 24 ms crossfade when frame,
window, hop, band or frequency topology changes. Stopping input preserves the
existing overlap tail. Two banks and one latest queued configuration bound
rapid edits.

## Processing and reverberation

The source processor uses a smoothed state-variable filter and a normalized
hyperbolic-tangent drive. Filter type, cutoff and drive remain editable with
any body/FFT combination. Turning Process off bypasses the stage; the filter's
Bypass option removes filtering while leaving saturation available.

Reverb has four fixed, differently sized delay lines for each stereo channel
and each of the sixteen possible spatial buses. A four-way Householder mixing
matrix couples the lines within each bus. Lowpass damping and delay-dependent
feedback gains make their energy decay; Time sets the nominal 60 dB decay time
before frequency-dependent damping. The lengths remain fixed while Time and
Damping change, avoiding pitch modulation from moving delay taps. This is an
abstract feedback-delay-network reverberator, not convolution with a measured
room and not an exact Schroeder comb/allpass implementation.

Body and FFT feed this reverb after their blend. In surround, each bus has its
own network, with different delay lengths between buses. A small additional
send from the pre-reverb composite excites those spatial returns, allowing a
mono source to make a surrounding tail. Dry input remains at the stationary
origin. The reverb is bounded, smooths live controls, keeps fixed allocated
buffers and clears with Reset or Audio teardown. Disabling it crossfades back
to the direct blend rather than stopping the source.

## Surround

Surround distributes sound before it becomes a finished stereo mix. The Rust
kernel routes each modal oscillator into a neighboring pair of logical buses
with equal-power gains. The FFT maps each shaped complex bin by its logarithmic
position among the analysis bands, then performs a separate inverse FFT and
overlap-add reconstruction for each bus. Two real speaker transforms are packed
into each complex inverse transform, preserving independent outputs while
reducing the transform count. Up to sixteen logical buses carry
independent material; the physical output layout determines the speaker count.
The ordinary stereo render remains available independently. A shared gain
bound preserves relative speaker levels, limits each bus to 0.95, and limits
their absolute sum to 0.95×√2; the 0.7-gain stereo preview remains below full scale
at unity master volume.

**Target** chooses the modal body, FFT reconstruction or both. The unselected
component remains audible at a stationary position. **Pattern** sets ascending,
descending, alternating or scattered placement; **Span** covers zero to four
turns around the field and **Offset** rotates it by zero to one turn. **Motion**
enables rotation at **Rate**, from −1 to +1 turns per second. These are musical
parameters included in presets and Dice. Surround enable, physical layout,
monitoring and recording remain session settings.

The speaker layouts reuse SPARTIAL’s four-speaker ring, eight-speaker circle,
sixteen-speaker ring, 4:1 surround, 7:4:1 surround and eight-speaker cube. LFE channels remain in
the physical layout but are silent. Speaker routing requires an output device
that exposes enough channels to the browser. If it does not, or **Stereo
preview** is selected, an azimuth-based stereo preview keeps the field audible.
Stereo remains the default. Physical speaker wiring and surround listening have
not been tested in this implementation pass.

## Multichannel recording

The Surround section records its channel output independently of the shared
menubar stereo recorder. It reuses SPARTIAL’s output-recorder and export path:
24-bit multichannel PCM WAV, matching mono stems in a ZIP or supported folder
export, and channel-map metadata. The recording uses the selected speaker
layout even when the hardware is playing its stereo preview. Speaker
layout and channel metadata remain fixed for a take. The shared OutputRecorder
128 MiB memory cap and corresponding channel-count/sample-rate duration bound
apply; recording does not create an unbounded buffer.

## Implementation and capacity

`src/instruments/simd-resonator-rust/rust/kernel.rs` ports the original
AssemblyScript recurrence, using four-frame tiles and `f32x4` operations to keep
mode state in registers. The original scalar implementation is the parity
reference; Volumetric Rain's existing Rust modal bank informed the tiled loop.
Both ABI v2 builds have fixed 384 KiB memory per kernel instance and no imports
or render allocations. The FFT path uses two preallocated JavaScript banks,
each with sixteen channel overlap-add buffers (about 4 MiB total for those
buffers). Audio processing does not allocate per sample.
Unsupported SIMD falls back to the Rust scalar build. **Engine details** also
allows selecting scalar explicitly; `?scalar=1` loads only that build.

Rust does not increase WASM's four-float SIMD lane width or create more CPU
threads. The increased capacity comes from a larger bounded bank and its dense
spectral mapping. Real-time performance remains device-dependent. Start with
512 waves and reduce Waves if playback breaks up. Visuals are capped at 30 fps,
1.5 pixel ratio and 40 representative strands; all selected modes still render
on the audio thread.

Before the surround extension, on the development ARM64 host, warm Node v22
stereo kernel measurements at 48 kHz
were approximately 8 µs per 128-frame block for 128 Rust SIMD modes, 247 µs for
4,096 Rust SIMD modes, and 1,010 µs for 4,096 Rust scalar modes. The original
128-mode SIMD kernel was approximately 8 µs. These measurements exclude FFT,
browser scheduling, output devices and UI; they are not a universal speedup or
mobile real-time guarantee. The browser's Engine details measures FFT and modal
processing time as well as the modal kernel alone. Where a high-resolution worklet
clock is unavailable, the readout is explicitly approximate.

A separate pre-surround full-processor run on Node v22.23.2/Linux ARM64 used continuous input,
repeated strikes, a 4,096-sample FFT and 512-sample hop at 48 kHz. Across 1,024
measured callbacks after warmup, 4,096-wave SIMD averaged 297 µs, with 467 µs at
the 99th percentile and a 1,011 µs maximum. Scalar averaged 1,064 µs, with a
1,719 µs maximum. All measured callbacks fit the 2,667 µs block budget and all
output samples were finite. This measures the complete synchronous processor
call, including telemetry cloning, but excludes browser scheduling, actual
message transport, devices, UI and configuration-message preparation. These
figures describe the earlier stereo engine and do not establish the added
multichannel workload’s performance.

The [surround callback measurements](rezoidinator-surround-measurements.json)
cover the complete synchronous processor with continuous input, spatial motion,
its independent stereo output and sixteen surround channels. On Node 22.23.2/
Linux ARM64, 512 modes with a 1,024-sample FFT had a 389 µs 95th percentile using
SIMD. At 4,096 modes, a 4,096-sample FFT and 512-sample hop, SIMD measured 951 µs
median, 1,917 µs 95th percentile and 2,263 µs maximum in the reported run. Scalar
measured 2,122 µs median, 3,093 µs 95th percentile and 3,455 µs maximum for that same
largest configuration: **scalar exceeded the 2,667 µs audio-block budget**.
Reduce Waves, FFT frame size/overlap or speaker count when playback breaks up,
especially with scalar. The default remains 512 waves. These measurements
exclude browser scheduling, message serialization, devices, UI, recording and
FFT topology transitions; repeated runs showed occasional scheduling outliers.
They do not establish physical-device real-time performance. Those measurements
precede the added source processing and feedback-delay reverb; they do not
measure the new combined workload.

## Model references

The implementation is original code. These author-hosted chapters from Julius
O. Smith III, *Physical Audio Signal Processing* (W3K Publishing, 2010), support
the mechanism descriptions and explain where this instrument uses approximations:

- [Modal Representation](https://ccrma.stanford.edu/~jos/pasp/Modal_Representation.html): a driving signal feeding parallel resonant modes.
- [Force-Pulse Synthesis](https://ccrma.stanford.edu/~jos/pasp/Force_Pulse_Synthesis.html): pulse duration and amplitude control impact brightness. Rezoidinator offers shaped pulses rather than a nonlinear hammer collision.
- [Excitation Synthesis](https://ccrma.stanford.edu/~jos/pasp/Excitation_Synthesis.html) and [Pluck Modeling](https://ccrma.stanford.edu/~jos/pasp/Pluck_Modeling.html): filtered-noise excitation and the more detailed physical plectrum model, respectively. The Pluck option here is a transient approximation.
- [Feedback Delay Networks](https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html) and [Householder Feedback Matrix](https://ccrma.stanford.edu/~jos/pasp/Householder_Feedback_Matrix.html): recirculating delay lines, orthogonal mixing and the balanced four-line matrix.
- [Schroeder Reverberators](https://ccrma.stanford.edu/~jos/pasp/Schroeder_Reverberators.html): the related historical comb/allpass approach, useful for distinguishing reverb architectures.

## Build and verification

Run `npm run build:rust-resonator-wasm` with stable Rust and the
`wasm32-unknown-unknown` target installed. Both checked-in artifacts have exact
source/build hashes and ABI checks; `npm run check:rust-resonator-wasm` needs no
Rust installation. `node scripts/benchmark-rust-resonator.mjs` measures kernel
cost separately from the browser callback.

Automated checks cover original/Rust and scalar/SIMD waveform parity, high-mode
contribution, fixed memory, finite output, reset and callback behavior. Human
listening and physical-device acceptance remain unperformed. Browser coverage
includes the full preset tour with continuous input, maximum waves and FFT
overlap, scalar fallback, delayed startup/cancellation, source looping and file
replay, and control reachability at desktop, phone portrait and phone landscape
sizes.

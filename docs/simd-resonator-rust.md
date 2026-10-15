# Rezoidinator

Rezoidinator is an independent development of the SIMD Resonator's struck modal body
and FFT input instrument. Find it beside **SIMD Resonator** in **SIMD Audio**.
The display name changed from Rust Resonator; its `simd-resonator-rust` URL,
catalogue ID and saved-state keys stay compatible.
Audio starts off. Enable Audio and pluck or drag the body; horizontal position
sets excitation position and vertical position sets hardness. Arrow keys edit
the position/hardness, and Enter or Space plucks. The original instrument and
SIMD Audio Lab retain their existing engines.

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
layout, stereo preview and recording. The separate **Body only**
menu retains FFT settings. Reset restores the default body and clears its tail;
it retains live input and Audio. Changing modes clears removed oscillator states
so increasing the count cannot revive an old tail.
Modal edits fade the body down for one audio block, apply the new coefficients,
then fade it up for one block. FFT processing and sample playback continue
through that transition.

## Input and processing

The shared microphone gain → meters → mic strip sits in the menubar on desktop
and beside presets on mobile. Input-source selection, the sample menu, file
chooser, Play/Stop and looping controls live in the side panel. Microphone trim
affects capture only; it does not change file or sample gain. The compact Pluck
action and direct body gesture excite the modal bank independently of input.

Mic/line, the shared sample menu, and local audio files feed the
phase-preserving FFT/overlap-add path and the modal body. Audio gates output
independently of microphone capture. Sample playback can loop. Audio off, page
departure, and hidden-page handling cancel pending input work; microphone tracks
are released. Sound presets never request a microphone or restart a sample.

The FFT retains 256–4,096-sample frames, four window shapes, 16–128 envelope
bands, overlap, memory, detail, drive, gate and frequency bounds. **Resynth**
mixes the modal response with phase-preserved spectral reconstruction. These
FFT operations remain JavaScript in the AudioWorklet; the oscillator bank is
Rust. JavaScript prepares coefficients outside the render callback. No server,
CPAL, shared memory, or browser audio worker threads are required.

The FFT path includes the original instrument’s later continuity improvements:
a bounded overlap-normalization floor and startup ramp, smoothed gain/detail/
gate changes, and a warmed spare FFT bank with a 24 ms crossfade when frame,
window, hop, band or frequency topology changes. Stopping input preserves the
existing overlap tail. Two banks and one latest queued configuration bound
rapid edits.

## Surround

Surround distributes sound before it becomes a finished stereo mix. The Rust
kernel routes each modal oscillator into a neighboring pair of logical buses
with equal-power gains. The FFT maps each shaped complex bin by its logarithmic
position among the analysis bands, then performs a separate inverse FFT and
overlap-add reconstruction for each bus. Up to sixteen logical buses carry
independent material; the physical output layout determines the speaker count.
The ordinary stereo render remains available independently.

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

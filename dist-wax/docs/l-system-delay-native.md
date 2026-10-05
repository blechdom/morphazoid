# L-system Delay Rust: browser audio and native comparison

The published **[L-system Delay Rust](https://morphazoid.com/l-mic-rust.html)**
runs its Rust audio engine as WebAssembly inside a browser AudioWorklet. It needs
no local Rust executable or Morphazoid proxy. The original JavaScript instrument
remains at `/l-mic.html`. Both keep their own route and settings.

The Rust page retains all sixteen original presets plus ten additional scenes,
eleven grammars, the original slider curves, mastering controls and audio-clock
branch animation. Microphone input is selected by default. The header contains
input trim, the microphone switch and meters; the test-tone shortcut has been
removed. An optional audition source remains inside the lower **Input** section.

## Play the browser instrument

Open the published instrument in a browser supporting WebAssembly, AudioWorklet
and microphone capture. Click the microphone switch and allow access, then enable
**Audio** to hear the recursive delays. Microphone capture and Audio are separate:
input can be captured and metered while output remains off. Enabling Audio with
microphone selected can also request capture as part of that explicit action.
Nothing starts capture or audible output on page load, preset selection or MIDI
enablement. Device selection uses Morphazoid's browser audio-input settings.

For local development, the usual static development server is sufficient:

```sh
npm run dev
```

Open the printed localhost URL and choose **L-system Delay Rust**. The browser
loads the committed `assets/wasm/l-system-delay.wasm`; compiling Rust is not
required to play the instrument. To rebuild the engine after Rust source edits:

```sh
rustup target add wasm32-unknown-unknown
node scripts/build-l-system-delay-wasm.mjs
```

The Rust source remains in
[the instrument workspace](https://github.com/blechdom/morphazoid/tree/main/src/instruments/micmic/rust).
The browser controls retain their existing `src/instruments/micmic/native/` paths
for compatibility. A worker compiles the tree independently of rendering, and an
AudioWorklet processes the microphone, granular delays, stereo mix and mastering.
Graphics consume the actual audio sample clock and recorded input-envelope
history. Rendering stalls do not schedule or trigger sound.

The default thirteen-generation Pine requests 16,382 descendants, each with its
own pitch and delay. That number is a topology, not a voice ceiling. Automatic
adaptation measures audio processing work and probes toward the full requested
eligible count, backing off when deadlines are threatened and retrying when
conditions improve. An optional user cap is the only musical count ceiling;
memory availability and real processing capacity still constrain playback.
Browser performance must be measured on the actual device. The historical CPAL
benchmarks below do not establish a sustainable browser voice count.

Drag horizontally to change Time fold and vertically to change Branch angle;
arrow keys provide the same controls, with Shift for finer changes. Presets and
randomization preserve Audio and input policy. Mastering presets preserve the
tree and live recording. Hiding or leaving the page mutes output and releases
microphone capture; returning requires an explicit restart.

The audio engine shares the Rust granular pool, original input cleanup and
mastering model with the native implementation. It retains a 40-second mono
history, stereo branch panning and smoothed live pitch, pan, gain and delay
changes. It does not add independent duration stretching or the optional Silky
spectral renderer. WAX host audio buses remain unverified for this route;
ordinary browser playback does not imply DAW track-input integration.

## Original interface and continuous edits

The native page uses the original `l-mic.html` sections, shared site styles,
`micmic.css`, generation colors, all sixteen original full presets and slider mappings.
The twenty-six-scene bank adds Cedar, Quaking Aspen, Juniper, Baobab, Foxglove,
Lotus, Acacia, Lichen, Moonflower and Horsetail.
The main preset menu contains all 26 scenes in the former button order. Each
selection restores the complete grammar, growth, pruning, stereo spread, mix,
mastering and original factory output level. The separate growth-button grid is
removed. **Reload selected preset** uses the same complete recall. Missing mix
or mastering fields in older scene data use defaults rather than inheriting
another scene. Microphone capture, Audio, recorded history and device policy
remain live. Pending edits cannot replace a completed recall; musical controls
are temporarily unavailable while the scene is being installed.
Negative original pruning values remain exact preset data; both engines treat
them as breadth first.
Four new Pine scenes request fourteen to sixteen generations, while six
new scenes cover the additional curve grammars. Actual audio admission remains
device measured rather than guaranteed by a preset.
Choose consumes Morphazoid's current shared catalogue, with the Rust entry beside
the original. Time fold retains its piecewise 1–50, 50–1,000 and 1,000–3,000 ms
mapping. Native input, diagnostics and the optional voice cap use the same control
styles. Audio remains explicitly armed.

The drawing follows local control values on animation frames and interpolates
the preview over 120 ms. Its fit stays fixed during a gesture and settles
afterward, instead of waiting for returned HTTP geometry or repeatedly snapping
to new bounds. Control requests carry the latest values and return lightweight
status. Obsolete replies cannot replace a newer gesture. Classic grammar previews
use the same generation ordering and connected pruning as the native audio model.
Availability and amplitude have separate visual meanings. Every available
branch stays colored at silence; unavailable branches remain grey. All branches
use the same constant stroke width and opacity, including the input root.
Signal amplitude changes wave deflection only, without blinking or clipping the
connected line. On supported hardware, WebGL2 caches the tree and computes wave bends in a
vertex shader, drawing thin ribbons and round endpoints. A separate transparent
Canvas retains the original gestures, focus and annotations. Known software
GPU backends and unavailable WebGL2 contexts use the complete Canvas renderer;
context loss also falls back and restoration rebuilds the GPU resources.
Canvas paths are batched by their generation palette.

For a controlled graphics trial, use `/l-mic-rust.html?renderer=webgl2` to force
WebGL2, and `/l-mic-rust.html?renderer=canvas` for the reference. Both use the same
Rust/WASM audio engine, voice admission, presets, sample clock and 30/15/8 fps
audio-pressure policy. Graphics do not impose another audio voice ceiling.
Software-rendered browser checks validate shader parity and lifecycle; they do
not establish hardware GPU frame rates or increased audio polyphony.

The first
2,048 priority ranks expose actual rendered tap RMS with stable pool slots.
On short acoustic transits (100 ms or less), this measured output drives the
entire branch response rather than predicting it from input history. This
includes all 511 taps of the Staghorn Coral factory scene. Granular taps that
have not produced audio remain quiet even when captured input is present.
Graphics reduce frame rate and curve resolution under load, retaining at least
five curve intervals per animated branch, matching the original minimum, so
dense patterns never collapse to an endpoint-only straight line. Every branch
length receives continuous visual magnification: faint normalized tap energy
can still produce a visible wave, with an 8–16 CSS pixel maximum deflection.
The carrier and fixed branch connections retain the original wave structure.
The curve is an activity illustration rather than a literal sample waveform.
Rust records a bounded 40-second input-envelope history at 100 Hz, using the
original RMS/peak response and 160 ms release. Drawing interpolates that history
against the native sample clock; its moving carrier also follows pitch rate.
Long edges retain this spatial illustration in their interior, smoothly
anchoring the final fifth to the actual tap response. Unmetered preview slots
retain the history-derived illustration; this is a transit estimate rather
than a measurement of their granular output. Silence produces no bend. The
display keeps input history independently of topology revisions and individual
tap snapshots, including through two seconds of polling or Canvas jitter,
and extrapolates only the original release beyond the latest input sample.
Only the historical illustration uses admitted-generation gain normalization;
measured tap RMS already includes that normalization and is not attenuated again.
This display mapping changes neither audio gain nor compression and adds no
motion at zero input.

Pool timing edits preserve the current two-head crossfade, remember the newest
delay, then fade to that target when the current 65 ms fade completes. Returning
to the source reverses the active mix continuously. This avoids replacing an
audible head every time a slider event arrives while retaining fixed-head pitch
behavior. The ordinary scene/CLI render path remains unchanged. In a repeatable
173 Hz, 60 Hz-control sweep, the maximum adjacent output step dropped from
0.01137977 to 0.00389200, below the continuous carrier/fade bound of 0.00416380.
This measures transition continuity; human listening remains separate.

Gains normalize by the selected voices in each generation, matching the original
pruning behavior. Descendants and Original voice have independent levels. Input
pause smoothly gates new recording while existing delayed history continues.
The output knob retains the original square-root gain mapping and 20 ms slew;
wet level retains the original depth-dependent normalization. Native capture
now reproduces the original 55 Hz input highpass, and the unsaturated dry path
joins the wet path before compression and the 0.94 ceiling. The compressor
uses the same threshold, knee, ratio, attack, release and 6 ms lookahead, with
automatic makeup gain. Its envelope curve approximates browser dynamics; the
browser WaveShaper's optional 2x reconstruction is not reproduced. The
[Web Audio specification](https://www.w3.org/TR/webaudio/#DynamicsCompressorNode)
defines the processing contract. This improves routing parity without claiming
bit-exact overall browser sound.

## Mastering controls

The bottom of the control panel exposes input cleanup, stereo output filters and
compression. **Original** retains the prior sound: input HPF at 55 Hz, output
HPF/LPF bypassed, compressor threshold −12 dB, knee 5 dB, ratio 18:1, attack
3 ms, release 180 ms, automatic makeup on and manual makeup at 0 dB.

Input HPF affects newly recorded audio before the delay tree. Output HPF and LPF
affect the complete wet/dry mix before compression. Each filter has an **Off**
stop followed by a logarithmic frequency range. The output filters use 12 dB
per octave Butterworth sections; input HPF retains the original browser filter
response. Cutoffs are limited to 45% of the current sample rate. During Audio,
the readout shows the effective cutoff and the tooltip retains the requested
frequency if the device rate limits it.

| Mastering preset | Input HPF | Output HPF / LPF | Threshold / ratio | Attack / release | Makeup |
| --- | ---: | --- | --- | --- | --- |
| Original | 55 Hz | Off / Off | −12 dB / 18:1 | 3 / 180 ms | Automatic |
| Transparent | 55 Hz | Off / Off | Compressor off | — | 0 dB |
| Gentle | 55 Hz | 35 Hz / Off | −18 dB / 2:1 | 20 / 180 ms | +2 dB |
| Dense | 80 Hz | 80 Hz / 14 kHz | −22 dB / 4:1 | 8 / 240 ms | +4 dB |
| Warm | 55 Hz | 35 Hz / 6.5 kHz | −16 dB / 2.5:1 | 25 / 260 ms | +2 dB |
| Airy | 90 Hz | 120 Hz / 18 kHz | −18 dB / 2:1 | 15 / 150 ms | +2 dB |
| Telephone | 55 Hz | 350 Hz / 3.5 kHz | −22 dB / 4:1 | 5 / 120 ms | +3 dB |

The **Gain reduction** meter reports actual positive compressor attenuation in
dB before automatic/manual makeup and the output knob. Compressor bypass keeps
the fixed 6 ms latency and final 0.94 ceiling. Manual makeup acts before that
ceiling, including with the compressor off. The editable ranges are threshold
−60–0 dB, ratio 1–20, knee 0–40 dB, attack 0.1–100 ms, release 10–1,500 ms,
and makeup −12–+12 dB. Input/output HPF support up to 2 kHz and output LPF up to
20 kHz, subject to the device-rate limit.

Focused mastering presets preserve the current tree, mix, recording, input
source, voice policy, output level and Audio state. Full factory scenes recall
Original mastering; saved full
scenes include the edited mastering settings. Reset all returns mastering to
Original. Older external snapshots that omit mastering recall Original settings. The full-state randomizer includes bounded mastering variation.

Filters and dynamics process shared buses, rather than adding work to every
voice. Coefficients and compressor curves are prepared outside audio processing;
the callback retains filter state and lookahead storage during smoothed edits.
The live voice controller measures this processing along with the delay engine.

## How the playable voice budget behaves

The optional voice cap defaults to **No cap**. Automatic adaptation seeks the
largest requested eligible voice count supported by measured callback work.
The browser starts with a conservative budget, measures 300 ms of callback work,
then tests larger counts from the measured remaining headroom. Trials use 180 ms
of evidence and another 60 ms of steady work before the next increase, replacing
the slow generation-by-generation climb. Previously proved device capacity
survives a smaller scene and is tested again when demand grows. These colors
show admission, rather than the arrival of delayed sound; waviness shows signal.
Unsuccessful probes roll back. The native comparison uses
a separate warmed calibration before those live probes.
Failed probes are retried, so capacity can increase when device conditions
improve. The controller accounts for transient load and lets outgoing voices
finish fading before repeatedly reducing the same budget. Severe or worsening
overload still reduces it immediately. Turning adaptation off requests all
eligible voices, subject to an explicitly chosen cap.

Voice storage is prepared between processing callbacks and swapped into the
engine without resetting recording, branch phase or delay-edit crossfades. The callback does not
allocate or free that storage. Outgoing branches release smoothly, so active
counts can briefly exceed a reduced target. Available memory limits structural
allocation; measured audio deadlines limit simultaneous playback. Per-grammar
ranges reflect memory and exact numeric representation, rather than a fixed
thirteen-generation cap. Branches beyond 39 seconds of cumulative delay retain
structure with zero audio gain, leaving grain read-head room within the
40-second history. A completely inaudible tree does not grow a hidden budget.

Rejected control updates retain the working tree. Recoverable WASM memory growth
refreshes the audio buffers. A fatal processor failure mutes output, releases
capture and discards the failed graph; pressing Audio prepares a fresh graph
with the retained musical settings, without reloading the page. A trapping
topology compilation also resets its compiler for the next edit.

Audio-thread admission updates visit changed ranks and active/releasing voices,
using a rank-to-slot lookup prepared with the controls. Increasing the requested
tree no longer makes each device-budget adjustment scan every reserved branch.
The lookup and merge scratch are reserved up front and included in memory metrics;
admission and rendering do not allocate on the audio callback.

Rendering visits active voices instead of scanning every reserved slot. Graphics
reduce their frame rate and curve detail as audio load rises; the visual
preview is bounded independently of the audio tree. Beyond thirteen generations,
a sampled native preview preserves actual branch priorities rather than
substituting an unrelated smaller tree. Full preset recalls fetch that preview,
just as live parameter edits do, before the preset menu finishes applying.

Each tap reads shared recorded input at its inherited pitch and cumulative delay;
audio does not cascade through parent processors. The full tree geometry stays
constant as device capacity changes. Color indicates admission; wave amplitude
indicates signal, with actual tap RMS taking precedence on short edges and at
audible endpoints. Long-edge interiors illustrate nominal input travel, so there
is no separate generation-activation timer. Frozen input records zeros while
existing delayed audio and the retained input history continue.

The ripple carrier is an activity illustration rather than the literal PCM
waveform. Metered response uses rendered granular output; long-edge transit and
unmetered slots retain the historical approximation. Stable slots and coherent
topology revisions keep meters on their actual branch. The meter count does not
cap simultaneous audio. Audio processing uses preallocated storage.
Browser status messages copy bounded telemetry separately from the processing callback; there is no HTTP audio API.

A regression renders 2,049 admitted taps and measures the additional output of
the final unmetered tap. Increasing Pine from 13 to 14 generations requests
16,382 to 32,766 voices; automatic mode admits the count supported by measured
device deadlines and retries when conditions improve. Quiet capacity growth
colors newly available branches but creates no signal waves.

Processing load estimates callback work: control updates, test-tone/input
preparation, DSP, mixing, adaptive changes and audio activity measurement/publication.
It excludes the final telemetry stores and parts of device transport.
`deadlineMisses` counts measured blocks exceeding their sample-time budget; it is
not a hardware-driver xrun counter. In the native comparison, capture underruns
and overruns count empty or full microphone FIFO frames separately; independent input/output clocks can drift.
The browser feeds microphone capture through the same AudioContext graph.
A peak attempted voice count is not an established sustainable count.

Run verification with installed JavaScript development dependencies and
Playwright Chromium:

```sh
npm run check:l-system-wasm
cargo test --manifest-path src/instruments/micmic/rust/Cargo.toml -p l-system-delay-wasm --release
node --test tests/l-system-delay-wasm.test.mjs
node scripts/test-l-system-delay-wasm.mjs
node scripts/test-l-system-delay-visuals.mjs
```

The browser suite starts a plain static server with no native companion. It
loads the committed WASM and exercises real AudioWorklet processing, microphone
permission and capture, explicit output arming, controls, presets, layouts and
lifecycle. Its input is automated rather than a physical microphone. Screenshots
and telemetry are saved under ignored `artifacts/`; human listening and sustained
physical-device checks remain separate. The compatibility command
`test-l-system-delay-app.mjs` runs this browser suite; `--native` is rejected.
Native CPAL and CLI comparisons remain independently testable through Cargo.

The visual-causality check instruments actual Canvas strokes with an isolated
test-only browser bridge and mocked telemetry. It verifies complete colored
availability and signal-bearing response at all three CPU pressure tiers, independent sibling motion,
rank continuity, visible measured release, straight muted descendants, and rejection of stale
topology packets. Its screenshots and report are in ignored
`artifacts/l-system-delay-visual-causality/`; it starts no audio device. Core
fixtures separately prove distinct real delay onsets within one generation and
an off-probe impulse whose tap meter agrees with measured rendered audio.
Dense generation-13 fixtures cover all eleven grammars at normal and severe
pressure. The Canvas checks inspect measured responses and the historical
fallback for unmetered slots for interior displacement and changes over audio time. A short
input packet advances through early, middle and late positions of a descendant;
quiet sections remain straight and connected. Separate silent-admission and muted-bus cases verify
that capacity growth creates no signal waves. Long branches keep their joined
endpoint energy anchored to measured output, and a muted wet bus cannot inject input-root energy into
descendants. Full scene recalls clear prior meters and wait for the new pool,
including scenes sharing the same grammar and generation count.
Representative screenshots and the report are generated without microphone capture. Full recalls of Cedar, Quaking
Aspen and Foxglove use previews compiled by the committed Rust WASM; all
sixteen original scenes also run with quiet and ordinary input envelopes. These
mocked fixtures do not establish physical microphone behavior or a device voice
deadline.

The actual browser WASM regression also feeds synthetic 173 Hz microphone bursts
(230 ms every 850 ms) through the normal capture/worklet path. Staghorn Coral at
1440×900 must show at least one CSS pixel of wave deflection on multiple
non-root branches at input amplitudes .01, .03 and .05; subpixel movement alone
does not pass. Pine, Venus, Ivy, Dragon and Koch also require visible descendant
waves under ordinary .03 input bursts. A fresh silent capture must keep the full
tree geometry unchanged and straight while availability colors track automatic
voice admission. Muting wet output preserves those colors and removes descendant
motion. These checks use synthetic
media, not a physical microphone or a listening evaluation. The input and delay
branches use the same fixed stroke width; compression settings do not create
a separate visual animation.

## Historical native implementation verification

These results describe the earlier CPAL implementation, before browser WASM.
They are retained as comparison evidence rather than browser performance claims.

The first October 3 integrated revision passed 61 Rust release tests, strict Clippy,
formatting, and repository verification (5,452 passed, six skipped). Both
integrated browser modes passed 45 range checks, three viewports, all grammars
and presets, touch, automated accessibility, and working controls after browser
Back. Static-host discovery also remains Audio off and explains the required
local servers when no native proxy is present.

The subsequent individual-tap display revision passed 66 Rust release tests,
including distinct sibling onsets, sparse-impulse detection against rendered
audio, rank remapping, release, coherent publication and actual bus-gain mute.
Strict Clippy/formatting and repository verification passed (5,456 passed, six
skipped). The visual check proved complete color coverage under pressure, and
the integrated native browser check passed controls, layouts and live pool growth.

The October 4 dense-pattern correction passed 67 Rust release tests, strict
Clippy/formatting, all-eleven-grammar Canvas checks, and repository verification
(5,458 passed, six skipped), including clean WAX parity. The audio DSP is
unchanged; the additional Rust regression confirms that an admitted voice beyond
the display-meter boundary contributes sound. No new human listening pass was
performed for this rendering change.

The later October 4 parity revision passed 80 Rust release tests, strict Clippy,
formatting and repository verification (5,465 passed, six skipped), including
clean WAX parity. Both isolated browser modes verified all 26 growth buttons and
full scenes; live muted Pine → Ivy → Pine retained the audio clock and device
policy. All eleven dense grammars passed moving-baseline and active-position
checks under pressure. A real muted CPAL capture of the built-in tone verified
native input timestamps and admitted-generation counts. Input filter response
and settled dynamics were compared against independent Chromium measurements;
compressor transients and ceiling reconstruction remain approximations. No new
human microphone listening comparison was performed.

The final October 4 preset-recall correction passed repository verification
(5,470 passed, six skipped), including clean WAX parity. Actual original/native
browser comparisons matched all sixteen quick and full scene settings. The
integrated browser check verified all 26 full-recall Canvas coverages, named
selection and growth reload. Visual checks passed three authoritative deep
preset recalls, 32 quiet/ordinary factory cases, and all eleven dense grammars
under normal and severe pressure. Pine retained moving curves for all 16,382
admitted taps, including 14,334 beyond the individual meter boundary. Regression
tests retained input history through topology lag and missing snapshots. These
frontend corrections leave the Rust DSP unchanged; no new human listening or
physical microphone comparison was performed.

The October 4 mastering implementation passed 96 Rust workspace release tests,
strict Clippy, formatting and final repository verification (5,473 passed,
six skipped), including clean WAX parity. The integrated native browser suite passed 76
control checks, all 26 full scenes, seven mastering profiles, all three layouts,
and closed/open-panel accessibility with no browser errors. Its real CPAL test
used the built-in tone at zero output level, measured 13.17 dB of compressor
gain reduction, and verified bypass returning to 0 dB. Every live mastering
edit preserved Audio, topology and sample time; output stayed zero and no input
device opened. Original mastering and mix were restored before capacity and
lifecycle checks, which also passed. The low-rate UI fixture verified 20 kHz
requested LPF displaying its effective 3.6 kHz cutoff on an 8 kHz device.
Visual tests retained pulse travel, 32 quiet scenes and all eleven dense
grammars. The pulse fixture now publishes monotonically increasing timestamps
and predicts position independently from actual packet/frame timing. Human
microphone listening and timbral comparison remain unperformed.

The earlier 35-second muted CPAL run at 48 kHz calibrated 1,221 voices, attempted
up to 1,515, and ended at 1,156. It recorded 20 processing deadline misses during
capacity search; concurrent repository checks used the same computer for part
of that run. This is functional evidence of adaptation, not a verified
sustainable 1,515-voice rating. Live storage expansion installed 32,766 slots
without resetting the audio clock. Automated output stayed muted and did not
open a microphone; listening quality remains for audition.

## Earlier comparison record

The CPU table and listening results below are the saved October 2, 2026
core/CLI comparison. In that workload, 1,024 independently shifted Rust voices
met every sampled deadline and averaged about 4.4 times the JavaScript speed;
2,048 missed some deadlines. These figures describe that earlier short offline
test, rather than the current playable app's live ceiling. The persistent pool
and app were added afterward, so their current source differs from the saved
source/executable hashes. Re-run the comparison to generate a fresh record for
the current checkout.

## Why the browser delay loses branches

The catalogue's L-system Delay is `/l-mic.html`, owned by
`src/instruments/micmic/`. Its audio starts with 48 voices, can reach 256 with
partial worklet timing, and can probe toward 1,024 only with fresh whole-context
render-capacity measurements. Without trustworthy telemetry it stays at 48.
These are allocation and deadline guards, independent of pitch quality.

Pythagorean growth also caps each generation at 128 branches. The default
thirteen generations produce 1,022 eligible delayed taps before voice pruning,
rather than the 16,382 descendants of an uncapped binary tree. With default breadth pruning,
48 voices cover generations one through four and only 18 branches of generation
five; generations six through thirteen contribute no audio. Merely enlarging
the DSP pool does not remove this separate topology cap.

Economy mode retains 24 shifted pitch classes plus exact unison. It rounds
pitches to 0.01 semitone, chooses the strongest classes by gain squared, and
maps overflow pitches to the nearest retained class. Every branch still owns
its own delayed read head. The optional Silky modes use 3, 7, 10 or 16
Signalsmith lanes with 160 ms processing blocks and 30 ms hops. The separate
`/l-systems.html` suite has different voice limits and is not this baseline.

## What the native version changes

[CPAL](https://docs.rs/cpal/0.16.0/cpal/) handles native input and output;
the Rust core implements the pitch and delay processing. It ports the current
economy/fallback algorithm: one shared 40-second float32 raw-input history,
two overlapping 110 ms sine-squared grains, playback rates from 0.125 to 8,
equal-power pan, smoothed controls, a 65 ms delay-edit crossfade, and input/output
`tanh`. Unison uses an ordinary interpolated delay. Stable voice keys preserve
phase and recorded history through edits.

Native scenes can retain every original pitch instead of merging classes.
The comparison also exports complete 11- and 13-generation binary trees with
4,094 and 16,382 voices, explicitly removing the browser's topology caps.
Each branch reads the raw input at its inherited cumulative pitch and delay;
it does not process its parent's already shifted audio. These are delay taps,
not independent duration-stretch processors.

The core renders blocks of at most 128 frames with each voice's state kept
together. It uses a shared interpolated window table and reuses read positions
for stereo. Very long delays switch to sample-order processing to protect
history-ring reads. Rendering, silence and voice retirement allocate and free
no heap memory. At counts above 1,024, retirement uses a smaller per-voice
threshold to avoid abruptly dropping a significant summed tail.

More voices do not change the grain quality or pitch/time range. Shifted taps
need grain headroom and startup history, so a requested one-millisecond delay
does not become a one-millisecond pitched echo. Some extreme delays near the
history limit cannot acquire enough history to sound. The
[Signalsmith spectral engine](https://signalsmith-audio.co.uk/code/stretch/)
has not been ported in this experiment.

## Historical measured processing cost

Both engines use the same independently shifted stress voices and source.
The test runs on one performance core of an Intel Core Ultra 9 285HX, pinned to
CPU 0, with Node 24.14.0 and Rust 1.98.1 release builds. Each repetition primes
40 seconds of history with voices disabled, warms 128 blocks, and measures
64 blocks; there are three repetitions. The 128-frame block at 48 kHz has a
2.667 ms deadline. The benchmark times DSP processing and voice retirement,
excluding source preparation, graphics, browser worklet scheduling and device I/O.

| Voices | JS p99 ms | Rust p99 ms | Mean speedup | Rust deadline misses |
| ---: | ---: | ---: | ---: | ---: |
| 48 | 0.306 | 0.066 | 4.06× | 0/192 |
| 128 | 1.080 | 0.179 | 4.06× | 0/192 |
| 256 | 1.710 | 0.379 | 4.22× | 0/192 |
| 512 | 2.996 | 0.679 | 4.27× | 0/192 |
| 1,024 | 6.302 | 1.422 | 4.39× | 0/192 |
| 2,048 | 12.739 | 2.817 | 4.60× | 17/192 |
| 4,096 | 27.567 | 5.985 | 4.75× | 192/192 |
| 8,192 | 95.943 | 14.104 | 6.14× | 192/192 |
| 16,384 | 125.350 | 26.698 | 4.97× | 192/192 |

At the sampled counts, JavaScript stays within the deadline through 256 voices;
Rust stays within it through 1,024. This is approximately four times the voice
count under the same measured budget, and about 21 times the browser's
48-voice safe start. The browser can already allocate 1,024 on sufficiently
capable systems; the native benefit here is processing headroom and independent
pitch retention, not proof that every system's existing browser ceiling is 256.

The stress test uses distinct rates, rather than a cheap all-unison workload.
JavaScript counts above 1,024 bypass only its production guard for comparison;
they are not available browser settings. These short CPU measurements do not
certify continuous microphone performance or a universal real-time ceiling.
The native DSP's mono-history, window and reserved voice/key storage is about
10.7 to 10.9 MB in these scenes, excluding allocator overhead, source/output
buffers, temporary control maps and CPAL's ring buffer. Shared history keeps
this far below one full recording per voice; the browser economy renderer also
shares raw history.

## Sound comparison

The generated `artifacts/l-system-delay-comparison/listening.html` has raw and
level-matched JavaScript/Rust players. Matching targets are −18 dBFS RMS with a
0.9 peak ceiling. The source contains harmonic tones, a chirp and deterministic
noise transients, followed by silence. Clips isolate the DSP core; the browser's
input filter, master gain and compressor are excluded.

All seven corresponding scenes match within `1.49e-8` maximum absolute sample
error, below the `1e-6` acceptance threshold. The stereo edit scene includes
retiming, pitch/pan changes, replacement, pruning and release. All nine native
renders are finite, have no samples near unity, and have a silent final
half-second. This establishes numerical continuity, not a human judgment of
sound quality.

| Scene | Voices | Distinct rates | Spectral centroid | Energy from 20 to 200 Hz |
| --- | ---: | ---: | ---: | ---: |
| Default economy | 48 | 10 | 284 Hz | 40.0% |
| Default economy | 256 | 16 | 305 Hz | 36.8% |
| Default economy or independent | 1,022 | 20 | 278 Hz | 54.0% |
| Midnight Ivy economy | 48 | 24 | 270 Hz | 45.7% |
| Midnight Ivy independent | 48 | 48 | 271 Hz | 53.9% |
| Full binary tree, 11 generations | 4,094 | 23 | 267 Hz | 61.2% |
| Full binary tree, 13 generations | 16,382 | 25 | 264 Hz | 58.1% |

The default has no pitch-class overflow, so its 1,022-voice economy and
independent renders are equivalent. Midnight Ivy provides the useful pitch
comparison: economy merges half of its 48 requested classes; native retains
all 48. The symmetric full binary trees repeat many accumulated pitches and
delays, so 16,382 voices are only 25 distinct rates. The measurements suggest
greater branch coverage and changed low-frequency summation, rather than
uniformly brighter sound. Spectral statistics use a 4,096-frame Hann FFT with
stereo energies summed; band percentages are relative to 20 Hz through Nyquist.
They are descriptions of this test source, not quality scores.

For the saved comparison, human listening, speech/formant quality and real
microphone capture remained unperformed. A silent default-device CPAL playback
smoke test passed at 48 kHz. Numerical parity does not establish a perceptual
improvement, and more voices do not change the underlying granular pitch quality.

## Reproduce the CLI comparison

From the repository root, build the native workspace and generate the scenes,
WAVs, measurements and listening page:

```sh
cargo build --manifest-path src/instruments/micmic/rust/Cargo.toml -p l-system-delay-cpal --release
node scripts/compare-l-system-delay.mjs
```

Linux builds need the ALSA development package and `pkg-config`. The lockfile
pins the Rust dependencies, including CPAL 0.16. To repeat the recorded Linux
CPU affinity, run the comparison with `taskset -c 0`. Outputs are ignored build
artifacts; the saved measurement JSON is the durable record.

Use the executable to list devices, process a recording, or explicitly start
live microphone capture with a generated scene:

```sh
src/instruments/micmic/rust/target/release/l-system-delay-cpal --devices
src/instruments/micmic/rust/target/release/l-system-delay-cpal --scene artifacts/l-system-delay-comparison/default-1022-independent.scene.json --input recording.wav --render /tmp/l-delay-output.wav --seconds 8
src/instruments/micmic/rust/target/release/l-system-delay-cpal --scene artifacts/l-system-delay-comparison/default-1022-independent.scene.json --live --seconds 30
```

File input accepts mono/stereo PCM or float32 WAV at the scene's sample rate.
Offline rendering defaults to level 1; device playback and capture default to
0.58. Use `--demo` instead of `--input` for the built-in test source. Omitting
`--render` plays through CPAL. Offline scenes support sample-offset events;
live capture currently accepts one static scene at time zero. Input and output
devices must support the scene rate. The bounded live ring reports overflow
and underflow, but independent device-clock drift is not resampled.

The saved comparison's verification covered 19 native tests, 40 focused
JavaScript tests, strict Clippy, formatting, numerical render parity and playback
smoke. The playable app adds coverage for deterministic full-tree compilation,
parameter validation, adaptive growth/cuts, persistent pool controls, audible
retiming reversals, control-buffer reclamation, and callback rendering without
heap allocations or frees. It is a standalone local instrument alongside the
existing browser `/l-mic.html`; the old CLI scene renderer remains available,
and neither target is an integrated plugin.

The earlier playable-app checks passed 38 Rust tests, strict Clippy and formatting, six UI model
tests plus a tracked-file publishing boundary test, and the full repository
`npm run verify` (5,439 passing JavaScript tests, six skipped, no failures,
including WAX distribution parity). Automated WCAG A/AA checks found no
violations on the desktop surface or its Settings dialog.

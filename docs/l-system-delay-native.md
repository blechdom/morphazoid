# L-system Delay Rust: browser audio and native comparison

The published **[L-system Delay Rust](https://morphazoid.com/l-mic-rust.html)**
runs its Rust audio engine as WebAssembly inside a browser AudioWorklet. It needs
no local Rust executable or Morphazoid proxy. The original JavaScript instrument
remains at `/l-mic.html`. Both keep their own route and settings.

The Rust page source offers 210 full scenes, including all sixteen original presets,
the ten earlier Rust scenes, 88 earlier additional scenes and 36 new branching
scenes, plus 36 exploration scenes and the twelve presets from each of the
Parametric Lab and Experiments. The rule menu combines twenty-three classic and
stochastic grammars with six parametric, context, sequence and tiling modes.
The new curves and repeatable stochastic branching are documented in
[Grammar exploration](l-system-delay-grammars.md).
The incorporated lab mappings are documented in [Lab models](l-system-labs-models.md).
Its controls include fractional Time fold, mastering within **Mix**, and
audio-clock branch animation. Microphone input is selected by default. The header contains
input trim, the microphone switch and meters. The first **Input** control section
offers **Mic/line**, **Audio file** with a local uploader, and **Built-in samples**
with a second sample dropdown. There is no synthesizer or test-tone input in
this browser menu.
The **Sample** and **L-system type** menus each have a **Next** button that
wraps through the same choices as their dropdown. Sample names form one plain
list; credits remain below the input controls. Recursion knobs share one compact
responsive grid, including conditionally available lab and stochastic parameters.

## Play the browser instrument

To share a sound for preset creation, open the header **Settings** gear and use
**Share a sound → Copy sound parameters**. An optional name travels with the
JSON. Paste it into chat to turn the captured sound into a factory preset.
The snapshot includes every musical tree/lab parameter, wet/dry mix, filters and
compression with full numeric precision. Input choice and independent live gains
are included separately as reference context. Audio, device policy and media
contents are not captured. Capture does not alter playback or recompile the tree.
If clipboard access fails, the same text opens selected for manual copying.

Open the published instrument in a browser supporting WebAssembly, AudioWorklet
and microphone capture. Click the microphone switch and allow access, then enable
**Audio** to hear the recursive delays. Microphone capture and Audio are separate:
input can be captured and metered while output remains off. Enabling Audio with
microphone selected can also request capture as part of that explicit action.
Nothing starts capture or audible output on page load, preset selection or MIDI
enablement. Device selection uses Morphazoid's browser audio-input settings.

For recorded input, choose **Audio file** and upload a local recording, or choose
**Built-in samples** and a sample loop, then enable **Audio**. Both feed real PCM
into the same Rust delay history as the microphone; the voice admission and
pitch/time processing remain unchanged. **Loop input** controls repetition,
**Restart input** starts the recording again, and **Stop input** releases its
source while allowing the delay tail to continue. Turning Audio off or leaving
the page releases input and cancels pending loads. Re-enabling Audio starts the
selected input again.

Input mode, the selected sample, the uploaded recording and loop preference are
session state. Sound presets, reloads and dice retain them along with the live
gain controls. Uploads stay in the browser; files may be up to 64 MiB and playback
uses the first two minutes, with longer files labelled as excerpts. Built-in
samples reuse Synthesaurus's [33-input sample library](processing-input-samples.md), with
locally bundled recordings and arrangements; the input section links their
original credits, including CC0 acoustic drums, CMU ARCTIC voice syllables,
public-domain birdsong and Morphazoid's original rendered musical loops.

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
own pitch and delay. Before expanding a requested tree, a disposable worker
instance measures the actual Rust granular DSP on this device. The compiler
prepares a connected tree within that measured capacity, using lazy rewriting
and bounded frontiers rather than allocating every requested child. Presets
retain their complete requested settings; the prepared tree and effective
iterations are runtime state. Large tilings use a complete, shallower derivation
when their next substitution would exceed capacity.

At preset commit, Rust admits the complete eligible, device-bounded tree together,
including when switching from a small tree during an earlier cooldown. Playback
then measures real audio-thread deadlines. Three seconds of coherent, fully
admitted audio may propose a larger budget for the **next explicit scene edit**;
it never compiles or installs a larger unchanged tree. Before accepting that
proposal, the worker measures the candidate's actual pitched DSP in a disposable
instance with its full delay history populated. An unproved proposal falls back
to the last measured budget while still applying the requested preset.
Overload reduces active voices inside the retained
tree; it does not repeatedly recompile a smaller tree. Inactive voice slots do
not consume recurring DSP work, and installed storage already keeps its largest
allocation. Capacity carries between presets and is revalidated under current
load. There is no fixed final voice-count ceiling; calibration's
time allowance limits the initial probe, and later validated scene growth remains
possible. An optional user cap, memory and processing capacity still constrain
playback. Graphics retain the complete device-bounded prepared scene. Audio-off
previews show that scene; playback selects branches from Rust's exact active
voice slots, including sounding release tails. Retired slots disappear immediately
on the next coherent status update, even when smoothed visual meters remain positive.
The active slot list is independent of the individual meter capacity and has no
separate display cap. Drawing cost adjusts frame rate, resolution and waveform detail,
without a separate branch-count feedback loop. Expensive frames and low signal
amplitude cannot remove branches while audio admission remains unchanged. Zero
Depth retains the descendants reported by Rust while their audio releases, then
removes them when Rust retires their slots. Prepared metadata remains available
for immediate recovery. Framing uses the complete prepared scene. Graphics do not
reduce audio admission or restart recording.
Unchanged musical controls are not repainted on each meter update. Worklet
telemetry uses transferred compact numeric snapshots, expanded into the existing
public arrays on the main thread. On coarse clocks, an individual render or
control operation exceeding a quantum plus the clock's 1 ms precision margin is
observed separately rather than diluted into the normal 32-block average.
Installation and retirement retain their separate maintenance accounting. These
measurements describe processing deadlines, not physical output-device underruns.
Browser performance must be measured on the actual device. The historical CPAL
benchmarks below do not establish a sustainable browser voice count.

The processing order is audio, the audio-aligned tree, then secondary controls
and diagnostics. Rust advances the built-in seed's state without evaluating its
inaudible oscillators during pure microphone, file or sample input. Meter work
skips only exactly silent slots; nonzero input and release meters retain their
original arithmetic. The long-history sample-order path tracks pending numeric
growth once per render block. Exact PCM, future seed state and release tests
cover these arithmetic optimizations without reducing the voice pool.

The inline branch readout separates the device-bounded **prepared** tree from
the voices currently **processing**. The prepared count is established before
playback and changes only with an explicit scene edit, rather than tracking every
live deadline or silently growing while playing. It is an estimate of prepared work,
not a promise that changing browser or device load cannot require audio backoff.
The processing count includes release tails and matches the voice slots used by
the playback graphic.

The **Live performance** panel sits above the presets on all three Rust delay
pages. It displays the complete requested count, prepared branches, history-eligible
voices, actual processing voices, current audio limit and admitted target. The
**Measured estimate** is the most recent proved warm scene count, or the initial
conservative device estimate. Neither is a permanent device maximum: pitched
read cost, sample rate, mastering and competing applications affect capacity.
The audio load and peak are callback processing time divided by available sample
time, including maintenance. They are not total machine CPU usage. Deadline
misses measure late callbacks, rather than physical sound-device dropouts.
Graphics reports main-thread drawing milliseconds and actual frame rate. GPU
time uses asynchronous WebGL2 elapsed queries where supported, sampled around
four times per second with at most two pending queries; unavailable or stale
measurements are labelled accordingly. It measures branch drawing time, not
total GPU utilization, and never waits for the GPU to finish.

**Requested** is the full rule's descendant count before device fitting;
**Voice budget** is the preparation ceiling you choose to test. For example,
1,329 requested branches with a budget of 512 asks to prepare up to 512 branches.
A larger budget cannot invent more branches than the current rule requests.

Turn **Voice budget** or edit its number directly beneath the knob, then press
**Test capacity**. The dial and editable value are one control. Enter or leaving
the number commits the draft; Escape restores the previous value.
**Live data** starts closed and contains the live meters, voice counts, deadline
misses and **Capacity tests** disclosure. **Live cap** remains visible beside its
caret, with its editable value directly beneath the dial. Both disclosures
preserve the chosen budget and any running test when closed.
Turning the knob alone does not rebuild or interrupt the playing tree. The
worker measures the requested scene with fully populated delay history while
the existing audio source continues. With **Protect audio** enabled, a candidate
must fit 95% of the measured audio budget before its complete pool is committed;
a declined test retains the current pool and reports its measured cost. This
explicit test can retry a scene after overload, rather than waiting for
background growth. The requested budget carries across preset changes, which
revalidate each different workload. Small scenes prove only their actual voices
and retain earlier safe fallback capacity. **Live cap**, beside **Live data**,
changes how many prepared voices can run; 0 means **All available**. It changes
existing voice admission smoothly without rebuilding the tree or restarting
input. Audio protection still applies. To prepare a larger pool or revalidate a
scene after a real overload, use **Voice budget → Test capacity**.
**Auto budget** tests the device
estimate again and returns preparation to device-managed budgets; even a declined
recovery test clears the user ceiling while retaining the playing tree.

Disabling **Protect audio** permits a manual trial above measured headroom and
shows that it is unproved. Re-enable protection to restore automatic deadline
backoff. More voices give fuller branch coverage at greater DSP cost; GPU drawing
does not offload their audio processing. Capacity controls stay outside captured
sound presets and never arm Audio, restart input, or replace delay history.

Control acknowledgements may repeat an earlier audio snapshot. They still
update musical settings, but cannot renew the freshness of that snapshot's
meters or input history. Sparse active-slot selections reuse indexed prepared
metadata while preserving original branch order. WebGL Time fold changes a
uniform; Canvas timing is materialized on fallback or geometry rebuild, including
resize. Secondary UI painting is coalesced into a task after the tree renders;
lifecycle locks remain synchronous. Unchanged menu, knob and readout values are
not rewritten, and closed Settings diagnostics do not repaint.

Regression evidence must compare audio/sample clocks with elapsed wall time as
well as inspect continuous wet PCM: consecutive sample indices alone cannot
detect a slow audio clock. Browser probes characterize rendering and cannot
establish physical microphone/DAC continuity or human listening quality.
Topology allocation, atomic installation and telemetry still have audio-thread
costs; these optimizations do not establish that every interruption is resolved.

Drag horizontally to change Time fold and vertically to change Branch angle;
arrow keys provide the same controls, with Shift for finer changes. Presets and
randomization preserve Audio, input policy, input gain, output level and output
boost. Mastering presets preserve the tree, live recording and those gain controls.
Hiding or leaving the page mutes output and releases
microphone capture; returning requires an explicit restart.

The audio engine shares the Rust granular pool, original input cleanup and
mastering model with the native implementation. It retains a 40-second mono
history, stereo branch panning and smoothed live pitch, pan, gain and delay
changes. It does not add independent duration stretching or the optional Silky
spectral renderer. WAX host audio buses remain unverified for this route;
ordinary browser playback does not imply DAW track-input integration.

## Integrated rule modes

The **L-system type** menu selects every rule family on the current Delay page.
Parametric branching adds Child length, Turn per generation, Module delay ratio,
Module pitch ratio, Child branches and Stopping length knobs. Context-sensitive
sequences expose Neighbor influence and Symbol ratio; Thue–Morse and Fibonacci
expose Symbol ratio. Penrose and Sphinx use the same numeric control as Tile pitch
contrast. Controls for other rule families remain hidden until needed.
The shared Generations control requests 1–24 derivations in these six modes and
1–52 generations for classic grammars. Device capacity determines how much of
that request is prepared; it does not rewrite the saved scene.

All 186 earlier Delay scenes keep their names, settings and order. The 24 lab
scenes are additional complete scenes, with their numeric rule settings included.
Recalling a classic scene removes the prior lab mode and recalling a lab scene
restores all of its numeric module fields, independently of the previous scene.
Mode edits and preset recall use the existing live engine and preserve source
playback, input history, Audio state and the independent gain controls.
The standalone `/l-system-parametric-lab.html` and `/l-system-experiments.html`
routes retain their focused controls and twelve-scene banks.

The former single-option **Pitch detail** selector is removed. Independent
granular pitch processing remains the same; Branch angle and Angle → octave span
remain editable. Incorporating the lab modes does not change the device-adaptive
admission policy or add a fixed voice-count ceiling.

## Original interface and continuous edits

The native page uses the original `l-mic.html` sections, shared site styles,
`micmic.css`, generation colors, all sixteen original full presets and slider mappings.
Its parameter banks use compact knobs matching the header volume control. Drag
up or down to adjust; hold Shift for finer motion, or use the native arrow,
Home and End keys. Every parameter, range, step and readout remains available,
including Tap, filter cutoffs, compression and signed pruning/asymmetry guidance.
**Curls** adds continuous angular winding in either direction, from −8 to +8 turns
along the longest root-to-tip path; this is added rotation, not a guaranteed count
of visible loops. Zero leaves the original layout and sound intact;
all earlier factory presets recall zero; the exploration bank also demonstrates
curled paths. The input root stays fixed while
successive segments turn, preserving their connections, lengths, gaps and delays.
Those changed local turns feed the existing **Angle → octave span** pitch mapping,
and their new positions feed **Spread**. The existing pitch-rate limits still
apply. Curls does not reduce the number of voices or change device admission.
Saved scenes retain Curls; older scenes without it restore zero. Held edits use
the same staged Rust updates and continuous graphic transitions as Branch angle.
**Center angles** restores Branch angle to its 90° midpoint, Turn asymmetry to
even, and Curls to zero through one live edit. Timing, pitch span, variation,
levels, source playback and the Audio state remain unchanged. The former Rule
mutation control now describes its existing grammar-specific behavior:
**Branch variation** changes Pythagorean turns, lengths and delays;
**Delay variation** changes delay timing on all other patterns while retaining
their shape and pitch turns. It does not rewrite the selected grammar.
The optional voice-cap knob uses a logarithmic gesture across the full current
memory-supported range; its adjacent numeric field accepts an exact count,
with 0 retaining no user cap. This presentation adds no audio voice ceiling.
Preset recall updates knob positions without restarting the selected input.
The first sixteen entries use the exact original names, from Pythagorean Pine
through Giant Sequoia, and retain their complete original sound settings.
Search `l-mic` or `starting point` to show only these original starting points.
The first 26 scenes retain their settings and order, including Cedar, Quaking
Aspen, Juniper, Baobab, Foxglove, Lotus, Acacia, Lichen, Moonflower and Horsetail.
The earlier expansion adds eight families, each with a scene for every original
grammar. The six new branching grammars add Seedling, Glass, Clockwork, Canopy,
Cathedral and Unison scenes, preserving the first 114 scenes and their order:

| Search keyword | Range explored |
| --- | --- |
| Glass | Very short time folds and granular pitch textures |
| Clockwork | Short, distinct rhythmic delays |
| Water | Medium delays and open stereo movement |
| Cathedral | Long, slowly unfolding delay patterns |
| Unison | Unshifted delays, emphasizing rhythm and shape |
| Wild | Strong mutation, asymmetry and pitch movement |
| Canopy | Deep trees with high descendant levels |
| Cuttings | Shallow, sparse trees with fewer descendants |

The classic portion of the type menu retains all twenty-three grammars, including
the branching systems, fractal curves and repeatable stochastic shrub.
The new rules extend both the Rust audio compiler and its matching JavaScript
preview, with the same parent connections and voice-admission order. They use the
same device-measured admission, inherited delays, pitch/pan and live smoothing.
No additional audio-voice ceiling is introduced. The original JavaScript page
and the shared eleven-grammar catalogue retain their original options.

| New branching type | Axiom and productions | Basis |
| --- | --- | --- |
| Meadow bush | `F`; `F → F[+F]F[-F]F` | Published alternating side shoots |
| Frond fan | `F`; `F → F[+F]F[-F][F]` | Published bracketed fan |
| Ladder fern | `X`; `X → F[+X]F[-X]+X`, `F → FF` | Published continuing-apex fern |
| Whorled shrub | `X`; `X → F[+X][-X]FX`, `F → FF` | Published paired sides plus continuing stem |
| Trident tree | `FX`; `X → [+FX][FX][-FX]` | Original planar three-child bud rule |
| Four-way canopy | `FX`; `X → [++FX][+FX][-FX][--FX]` | Original planar four-child bud rule |

The first four productions follow Figure 1.24(a, b, d, e) of
[The Algorithmic Beauty of Plants, Chapter 1](https://www.algorithmicbotany.org/papers/abop/abop-ch1.pdf).
The last two use the book's bracketed-turtle method to create explicit planar
fans. Their `F` stems remain unchanged while only `X` buds split, so every
branching junction has exactly three or four children even after repeated
expansion. The supplied preset angles separate their directions; deliberately
choosing zero or coincident angles can overlap their geometry while retaining
the separate voices. They are artistic two-dimensional trees, rather than
species models or copies of the book's three-dimensional botanical examples.
Preset angles of 25.5 degrees adapt the book's 25.7-degree examples to the
existing half-degree knob step. All original parameters and ranges remain.

On mobile, closed input/sample selector triggers scroll below the sticky tree
preset row. Open chooser panels retain their existing viewport anchoring,
scrolling, selection and outside-tap dismissal.

The menu search matches names and descriptions, including these family keywords.
Each selection restores the complete grammar, growth, pruning, stereo spread, wet/dry
mix, filters and compression. Input gain, output level and output boost remain
at the performer's current values, including when output is muted. The separate growth-button grid is
removed. **Reload selected preset** uses the same complete recall. Missing mix
or mastering fields in older scene data use defaults rather than inheriting
another scene. New captures omit the three live gain controls; gain values in
older saved scenes are ignored on recall. Editing these controls leaves the
selected sound's preset identity intact. Microphone capture, Audio, recorded
history and device policy remain live. Pending edits cannot replace a completed recall; musical controls
are temporarily unavailable while the scene is being installed.
Negative original pruning values remain exact preset data; both engines treat
them as breadth first.
The earlier Rust additions retain their fourteen-to-sixteen-generation Pine
scenes and six additional curve grammars. The expansion explores both shallow
and deep trees, time folds from 1 to 3,000 ms, unshifted and strongly shifted
delays, narrow and wide stereo fields, and contrasting filter and compressor
settings. Actual audio admission remains device measured rather than guaranteed
by a preset. Presets do not set a voice cap. Cantor's straight grammar has no
turn-derived pitch or stereo movement; its scenes vary timing, density and
mastering instead. A short time fold does not change the shifted renderer's
110 ms grain duration. Long cumulative delays beyond 39 seconds retain their
geometry but cannot produce a tap from the 40-second history.
Choose consumes Morphazoid's current shared catalogue, with the Rust entry beside
the original. Rust Time fold spans **0.05–3,000 ms**, with logarithmic dial travel
below 50 ms and decimal readouts. Existing presets retain their exact delays;
50, 240, 1,000 and 3,000 ms retain their earlier dial positions. Unshifted voices
use fractional sample reads with a one-sample minimum (about 0.021 ms at 48 kHz).
Shifted voices retain 110 ms grains and a minimum 137.5 ms base read delay, so
the fold value does not describe their pitch-shifting latency. Shorter folds
can make more taps eligible within recorded history; measured DSP capacity
still determines how many run. The original JavaScript control keeps its
1–3,000 ms mapping. Native input, diagnostics and the optional voice cap use the same control
styles. Audio remains explicitly armed.

Held knob gestures send their leading value immediately and coalesce further
values at 16 ms intervals, including a final trailing value. Recursion uses a
direct generation-gain update rather than compiling a new tree. Time fold has its
own live coefficient lane: when the prepared branches keep the same 39-second
history eligibility, it changes one Rust scalar without compiling or uploading
another pool. Crossing that boundary prepares new ranks and generation gains
through the ordinary compiler. Preset recall cancels pending gesture timers and
owns the complete scene; preparation and processor recovery retain the latest
live fold. Mix and mastering
updates bypass structural compilation and acknowledge without copying the full
meter/history payload. Existing DSP smoothing applies to these live coefficients.
Repeating a fully acknowledged parameter, Recursion or performance value skips
another compile/install or worklet update. A return to the previous value while
an edit is pending still supersedes that edit.
Zero Recursion retains structural ranks and recorded history for immediate resume.
**Depth / decay** spans 0–100%. At **100% · no decay**, every generation has the
same underlying gain before voice balancing, with no progressive generation
attenuation. Individual branches still share their generation's gain, and the
existing wet-bus normalization and mastering remain active. This endpoint uses
the same smooth live gain update; it does not recompile the tree or reset input
playback, history, pitch heads or measured voice capacity. Saved scenes retain
100% exactly; factory presets and the bounded dice range keep their earlier levels.

The drawing retains the committed audio tree while a structural edit is prepared.
The topology worker prepares the classic preview once per structural reply;
animation frames no longer rebuild the full tree. Compatible geometry morphs in
place over 80 ms, retaining branch maps, wave history and gesture fit. WebGL2
updates the position buffer during the morph without rebuilding its other data.
Obsolete compiled replies are discarded before installation. Classic grammar
previews use the same generation ordering and connected pruning as the native
audio model. Recursion arriving during compilation also applies to the returned
preview, avoiding a stale zero-gain drawing.
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
Rust/WASM audio engine, voice admission, presets and sample clock. Rendering
adapts to measured drawing cost and audio pressure, reducing resolution and
curve detail before lowering its frame rate. Cached geometry and reusable wave
buffers reduce per-frame work. The animation clock uses paired worklet sample
time and AudioContext time, so delayed status delivery does not restart or
rewind the wave motion. Graphics do not impose another audio voice ceiling.
During playback, both renderers draw only the input root and delay branches in
Rust's active slot list, including release tails still processed by the DSP.
Meter smoothing affects wave amplitude, never membership. The complete accepted tree remains metadata
for presets, parent connections and camera bounds; its unavailable grey branches
are omitted. Audio off restores the complete preset preview. WebGL2 compacts its
actual instance and meter buffers when membership changes, avoiding per-frame
processing of the inactive tree. Admission changes do not recenter or zoom it.
History uploads reuse a Float32 scratch buffer and grow texture storage
geometrically, rather than reallocating it for every newly recorded sample.
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

Live Time fold follows a common 35 ms smoothed coefficient with a single moving
readhead per voice. Large moves additionally limit readhead travel to four
samples per sample. Grain phase, recorded input, source playback and release
tails survive the gesture. Movement intentionally produces a tape-like pitch
glide; it avoids running two delay lanes for every voice at once. A longer delay
waits at its last readable position when the required input history is not ready.
Extreme moves can therefore take longer to reach their requested delay than the
nominal 35 ms smoothing.

Discrete scene changes retain the 65 ms two-head crossfade and its pending-target
behavior. The fade waits for readable destination history, and identical
effective grain/read delays bypass it. Short folds below the shifted grain-base
floor no longer create a redundant crossfade of the same samples. Graphics reuse
the accepted tree and wave paths; WebGL scales delay coordinates with a uniform
instead of uploading another topology. Historical envelope travel follows
nominal applied timing, while tap endpoint amplitude remains measured audio.
This illustration is not a measurement of each slewing granular read position.

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

## Mastering controls in Mix

The **Mix** section groups input cleanup, stereo output filters and compression
with wet/dry levels, stereo spread and output boost. Moving these controls does
not change their ranges or processing. **Original** retains the prior sound:
input HPF at 55 Hz, output HPF/LPF bypassed, compressor threshold −12 dB,
knee 5 dB, ratio 18:1, attack
3 ms, release 180 ms and automatic makeup on. Manual output boost starts at 0 dB
and remains independent of preset recall.

Input HPF affects newly recorded audio before the delay tree. Output HPF and LPF
affect the complete wet/dry mix before compression. Each filter has an **Off**
stop followed by a logarithmic frequency range. The output filters use 12 dB
per octave Butterworth sections; input HPF retains the original browser filter
response. Cutoffs are limited to 45% of the current sample rate. During Audio,
the readout shows the effective cutoff and the tooltip retains the requested
frequency if the device rate limits it.

| Mastering preset | Input HPF | Output HPF / LPF | Threshold / ratio | Attack / release | Automatic makeup |
| --- | ---: | --- | --- | --- | --- |
| Original | 55 Hz | Off / Off | −12 dB / 18:1 | 3 / 180 ms | On |
| Transparent | 55 Hz | Off / Off | Compressor off | — | Off |
| Gentle | 55 Hz | 35 Hz / Off | −18 dB / 2:1 | 20 / 180 ms | Off |
| Dense | 80 Hz | 80 Hz / 14 kHz | −22 dB / 4:1 | 8 / 240 ms | Off |
| Warm | 55 Hz | 35 Hz / 6.5 kHz | −16 dB / 2.5:1 | 25 / 260 ms | Off |
| Airy | 90 Hz | 120 Hz / 18 kHz | −18 dB / 2:1 | 15 / 150 ms | Off |
| Telephone | 55 Hz | 350 Hz / 3.5 kHz | −22 dB / 4:1 | 5 / 120 ms | Off |

The **Gain reduction** meter reports actual positive compressor attenuation in
dB before automatic/manual makeup and the output knob. Compressor bypass keeps
the fixed 6 ms latency and final 0.94 ceiling. Manual makeup acts before that
ceiling, including with the compressor off. The editable ranges are threshold
−60–0 dB, ratio 1–20, knee 0–40 dB, attack 0.1–100 ms, release 10–1,500 ms,
and output boost (manual makeup) −12–+24 dB. Input/output HPF support up to 2 kHz and output LPF up to
20 kHz, subject to the device-rate limit.

Mic input gain supports 0–4×. Output remains a 0–100% level control; the
Output boost control in Mix adds gain to the complete mix after compression,
including when compression is off, and before the fixed 0.94 ceiling. This provides more
gain for quiet microphones. The three gain controls remain live across presets,
Next, arrows, randomization and scene reloads.

Focused mastering presets preserve the current tree, mix, recording, input
source, voice policy, input gain, output level, output boost and Audio state.
The first 26 factory scenes recall Original filters and compression. New factory
scenes include their own filters and compression, using the mastering profiles
above and custom settings. Saved full scenes include the edited filters and
compression. Reset all returns those settings to
Original while retaining the live gain controls. Older external snapshots that
omit mastering recall Original filters and compression. The full-state randomizer
includes bounded mastering variation while preserving the live gain controls.

Filters and dynamics process shared buses, rather than adding work to every
voice. Coefficients and compressor curves are prepared outside audio processing;
the callback retains filter state and lookahead storage during smoothed edits.
The live voice controller measures this processing along with the delay engine.

## How the playable voice budget behaves

The optional voice cap defaults to **No cap**. Automatic adaptation seeks the
largest requested eligible voice count supported by measured callback work.
The browser measures a device budget before playback and adopts every eligible
prepared target together. A smaller preset does not force the following dense
preset to start with its tiny admission count. Depth and manual-cap restoration
also restore the current safe scene plan together. There are no upward admission
trials or automatic topology expansions inside an unchanged browser scene.
Healthy callback evidence can propose more capacity for a later explicit edit;
that candidate must pass a separate fully warmed worker measurement before
commit. Genuine overload locks a reduced safe plan for the current scene and
informs the next scene's budget. No numeric final voice ceiling is imposed.
The native comparison retains its separate warmed calibration and live upward
trials. The controller accounts for transient load and lets outgoing voices
finish fading before repeatedly reducing the same budget. Severe or worsening
overload still reduces it immediately. Turning adaptation off requests all
eligible voices, subject to an explicitly chosen cap.

In the browser, a structural pool is uploaded, validated and prepared in batches
sized from measured spare audio-block time, with 4,096 records as the maximum
batch size. Upload and obsolete-storage cleanup share that time allowance;
cleanup receives a share even while another pool is being prepared. A small
bootstrap batch learns per-record cost on the current device. This is a work
batch limit, not an audio voice ceiling. The committed pool keeps rendering during
preparation. An atomic handoff updates audible/releasing voices, while inactive
slots adopt targets when admitted. The pending pool stages the latest requested
depth before its first committed block; later live edits still override it.
Staging that coefficient leaves the playing scene untouched, and rejection or
abort preserves its gains and future PCM. Recording, branch phase and delay-edit
crossfades survive the handoff. Allocation, memory growth and freeing replaced
storage can still consume time; staging does not guarantee every device deadline.
Repeated installs recycle the numeric control records and rank maps. Once both
buffers are warm, edits within their retained capacity allocate and free no
control storage, including a smaller scene followed by restoring the larger one.
Larger high-water scenes and raw worklet uploads can still allocate. Rank-map
reset still visits the prepared count, and atomic adoption visits active voices;
recycling does not make those operations constant time or reduce the voice budget.
Finite topology preparation and cleanup retain a previously proved capacity
estimate for prompt restoration and revalidation. Total callback CPU and missed
deadlines still include that work; recurring DSP, admission, status polling and
live controls remain part of voice-capacity measurement. Genuine render overload
still reduces the budget. Old numeric voice storage retires in measured spare
time after rendering, avoiding a whole-vector destructor at growth commit. A
retained,
suspended graph temporarily processes controls with output muted, completes its
retirement queue and suspends again. This neither arms Audio nor opens an input;
a newer explicit Audio or microphone action retains the running graph.
Outgoing branches release smoothly, so active
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
reduce their frame rate and curve detail as audio load rises; the browser preview
uses the complete device-bounded prepared scene. Full preset recalls fetch that preview,
just as live parameter edits do, before the preset menu finishes applying.

Each tap reads shared recorded input at its inherited pitch and cumulative delay;
audio does not cascade through parent processors. The prepared tree geometry and
camera bounds stay constant as audio admission changes within that scene; only branches in the
exact active slot list are drawn during playback. Color indicates admission;
wave amplitude
indicates signal, with actual tap RMS taking precedence on short edges and at
audible endpoints. Long-edge interiors illustrate nominal input travel, so there
is no separate generation-activation timer. Frozen input records zeros while
existing delayed audio and the retained input history continue.

Proved headroom can grow the next explicitly edited scene after worker validation.
An unchanged prepared scene retains its derivation and camera fit.

The ripple carrier is an activity illustration rather than the literal PCM
waveform. Metered response uses rendered granular output; long-edge transit and
unmetered slots retain the historical approximation. Stable slots and coherent
topology revisions keep meters on their actual branch. The meter count does not
cap simultaneous audio. Audio processing uses preallocated storage.
Browser status messages copy bounded telemetry separately from the processing callback; there is no HTTP audio API.

A regression renders 2,049 admitted taps and measures the additional output of
the final unmetered tap. Increasing Pine from 13 to 14 generations requests
16,382 to 32,766 voices; automatic mode admits the count supported by measured
device deadlines. Later validated edits can increase capacity when conditions
improve. Admission colors indicate available processing; waviness indicates signal.

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

## Expanded preset verification

The October 5 expansion preserves the first 26 scenes exactly and adds 88 scenes.
Repository verification passed with 5,954 tests passing and six skipped, including
clean WAX parity. The five focused Chromium cases verified all 114 complete UI
recalls with Mic/file/sample choices and live gains retained, 13 representative
new scenes with actual Rust audio, a linear-to-original-Pine return, and searchable
menus at 1440×900, 390×844 and 844×390. Preset selection with Audio off opened no
microphone and started no playback.

All 114 target pools compiled with finite data and no exact DSP duplicates. A
separate 48 kHz Rust/WASM render covered 16 new scenes across all eleven grammars
and eight families, each with its authored mix and a wet-only copy. The fixed
64-voice admission belongs only to that offline fixture; it does not change the
product's voice policy or measure device capacity. All 32 captures had finite
processed output, exact cold silence and settled tails. Redwood Nave's wet output
remained audible through 12.93 seconds after the source burst. Measured spectral
and temporal differences distinguish the scenes without serving as a musical
quality threshold. Human listening and physical-device checks remain unperformed.

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

The original JavaScript page and the earlier Rust browser page both adapted
their audio voice count. The original retains its budget across smaller demand
and sends the entire selected voice array in one message. Its full quiet outline
also makes admission changes less visible. The earlier Rust page could clamp
its carried-over admission to a small scene, then add voices through live trials
and replace its prepared pool after recurring headroom proof. That extra growth
was resource scheduling, not rhythmic propagation through the delays.

The current Rust browser commits its complete device-bounded scene together and
keeps that scene's prepared count fixed. Both granular engines smooth gains with
a 15 ms time constant and require recorded history before delayed reads can
produce sound. Fresh microphone input can therefore reach long delays later;
a fully warmed preset should not admit generations several seconds apart.
The original's 1,024-voice maximum and Rust's measured budget are different
policies, so neither code inspection nor a historical native benchmark proves
the relative sustainable browser capacity on a particular device.

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
equal-power pan, smoothed controls, a 65 ms discrete-scene delay crossfade, and input/output
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

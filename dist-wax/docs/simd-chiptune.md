# SIMD Chiptune

SIMD Chiptune preserves WebGPU Chiptune's original preset bank, synthesis formulas,
nine 32-step sequencer lanes and eight-tap stereo echo in a WebAssembly SIMD
AudioWorklet. Its interface is intentionally redesigned around compact animated
performers and direct sequence editing. The seven performers are **Drums, Bass,
Arp, Lead, Upper A, Upper B and Noise**. Noise controls the original procedural
sweep; it does not add a tenth sequencer lane.

Turn **Audio** on, then **Play**. Play can also run the visual transport while
Audio is off. The searchable preset menu, Next and randomize buttons sit at the
top of the full-width workspace, beside Play and a persistent Tempo knob. There
is no right sidebar. On narrow screens the performance bar stays reachable while
scrolling. Preset recall restores the original
musical state without stopping transport.

## Playing and editing

Select a character to focus its sequence editor. Each card independently switches
between **Dance** and **Controls**, with Mute, Solo and Volume always
visible. **Steps** appears once in each voice’s control view. Drag a dancing character to change its two live sound controls. Controls
replaces that dancer with compact rotary controls; switch back to Dance at any
time. On a phone, swipe horizontally through the seven cards and scroll inside a
control face to reach its remaining knobs. The character menu
defaults to **Original characters**: the original six WebGPU dancers render
unchanged, with a matching pixel character for Noise. **Pixel animals**, **Pixel
blobs** and **Arcade crew** add small costumes on the same skeleton and pixel
grid. All skins follow the original musical motion and leave the sound unchanged.

Each performer has Mute and Solo buttons plus one small level knob, with **MUTED**
and **SOLO** indicators inside its bay. Drums keeps Bus, Kick, Snare, Hat and
Shaker levels together in its footer. Those same levels are absent from the
control faces. All knobs use the small arc style with visible numeric values.

A single level knob includes existing patch, character-level and saved trim
settings. Turning it sets that voice’s absolute level, without changing mute,
solo or unrelated sound controls. Older snapshots retain their exact sound until
edited. Most voice/part levels span 0–200%; the drum bus spans 0–150%. Bass keeps
its 0–100% overall trim plus separate pulse and sine components for balance.
Drag vertically or use arrow keys; double-click restores the source default.
Multiple performers can be soloed together; mute takes priority.

A small meter beside each character title shows its rendered sound, including
its echoes. Each drum part has a meter below its level knob, including ghost
hits. These use actual audio peaks, not the dance animation or sequence triggers;
Audio-off, paused and silent voices show no activity. The display has a short
release to make brief hits visible. Metering does not alter the mixed samples.
The Noise performer gives the previously unowned sweep its own mute, solo, level
and sweep controls. Muting all seven performers silences all parts, and soloing
another performer excludes the sweep. Noise remains **Song-only**, as in the
original sound engine. Selecting it shows the sweep envelope instead of a note
lane; Independent loops does not synthesize that texture.

The sequence graphic supports continuous painting and keyboard editing. Notes
appear above volume controls for pitched voices and drums alike. Follow,
Zoom, X pan and pitch view sit directly above the graphic. Drums expose their
four parts and individual mute/solo controls there. Each pitched card’s control
view has Steps, Step time and Note length in Independent loops. Kick, Snare,
Hats and Shaker each have their own step count and timing in their drum tab;
use decay controls to shape hit length. Sequence tools beneath the editor retain
transformations and custom step fractions.

**Song arrangement** preserves the original procedural composition and phrase
motion; its Sequence/Pattern pad switch selects the editor. **Independent loops**
repeats editable parts with separate lengths and step fractions. Its **Song loop**
menu and **Next loop** button can load sections 1–32, including material after the
intro. Each choice samples that section into independent loops; it does not seek
the running Song transport. Edits are retained separately for each visited
section, so returning to a section restores its edited pattern. Reloading a preset
resets that section cache. Song and Independent loops retain their own sequences
when switching modes.

MIDI and WAX retain the original sequence-instrument contract, including MIDI
output preview. WAX snapshots also include the selected skin, mixer volumes and
cached loop sections, plus each card’s Dance/Controls choice. Older snapshots
restore missing volumes at 100% and cards in Dance view.

## Finding the sound controls

All 154 original parameters remain available, grouped by their actual destinations.
Global tabs separate mix/tuning, shared tone, echo and Song arrangement. Voice
cards show tone and timing together in one scrolling face; Drums retains its
Kit/Kick/Snare/Hats/Shaker tabs. Each group exposes all applicable controls without
additional “More” disclosures. Numeric parameters use knobs; scale notes and
packed gate patterns keep musical buttons.

| Location | What it changes |
| --- | --- |
| Mix + tuning | Transpose, scale, output, synth/Noise bus and stereo width. Pitch range also shapes the Arp contour. |
| Shared tone | Upper A/B pulse width and PWM; shared noise clock/color for percussion and Noise. |
| Echo | Synth and Noise repeats. Drum repeats have separate Ghosts controls in Drums. |
| Song | Generated notes, shared gates and Upper/Lead section changes; hidden in Independent loops. |
| Each pitched character | Tone, register and patch level; its own Song rhythm or Independent-loop timing. Bass also has pulse/sine balance. |
| Drums | Kit mix/tails/Ghosts, then Kick, Snare, Hats and Shaker sound and rhythm controls. |
| Noise | Sweep amount, rate, decay and period; active only in Song. |

Controls that only affect the procedural Song are hidden in Independent loops.
Pulse/PWM shapes Upper A/B, while Lead and Arp use saw oscillators and Bass has its
own pulse width. Song step counts limit the repeating edited-cell overlay; they
do not shorten the entire procedural arrangement. Independent-loop step counts
set the actual repeating lane length. Noise has no step count.

## Source analysis and implementation choices

| Instrument inspected | Useful mechanism | Choice here |
| --- | --- | --- |
| [WebGPU Chiptune](../webgpu-chiptune.html) | Complete 154-parameter composition, nine lanes, articulated dancers, full presets, PolyBLEP pulse/saw, drums and eight analytic echo taps | Preserve the original presets, musical formulas, tuning and phase. Share the model and core controller; give SIMD its requested compact interface, skins and Noise controls. |
| [WebGPU 303](../webgpu-303.html) | Audio-clock scheduling of GPU-rendered chunks; analytic synthesis and modulation | Keep graphics following the audio clock. These compact chip voices do not require GPU rendering/readback. |
| [SIMD 303](../simd-303.html) | Dedicated 128-frame worklet, fixed-memory WASM, scalar fallback | Use the same bounded worklet architecture and independently selectable fallback. |
| [SIMD Synth](../simd-synth.html) | Groups of voices processed with real SIMD arithmetic | Vectorize groups of oscillator voices while preserving Chiptune's existing sound design. |

The scalar and SIMD builds share one analytical kernel. SIMD vectorizes
four-voice phase, pulse/saw generation, tone/drive, level and stereo operations.
Sequence decisions and drums use scalar code. The renderer evaluates the
original delayed voice function for all eight echo taps, including negative
times where the original permits them. Gate decoding is cached per block;
echo formulas and musical timing are preserved.

Each kernel uses fixed memory. The AudioWorklet renders 128 stereo frames at a
time; UI frames never schedule notes. It receives the original packed parameters,
sequence metadata and cells, including deferred-edit state. Song drum edits and
Pattern note edits retain the current cell until its next safe onset. Changes
of mode, rate or loop length clear the applicable pending edits as before.
Pause and restart preserve the original transport semantics.

Tempo changes integrate a separate musical beat clock through a 120 ms ramp,
rather than multiplying elapsed time by the newly selected tempo. Oscillators
keep their continuous seconds clock; already-triggered drum tails use their
original onset time, and analytic echoes read historical beat positions. This
prevents a live tempo move from seeking the composition or bending an in-flight
drum hit. Paused tempo edits preserve the musical position on resume.

Other live configuration changes use 256-sample crossfades, and short transport
ramps reduce abrupt edges. These do not restart oscillator phase, the composition
or its echoes. Late
transport messages catch up to their requested AudioContext timestamp. Invalid
or unsupported SIMD binaries fall back to the scalar kernel; a runtime SIMD
trap switches to scalar at the same musical time. Samples are checked for
finiteness and bounded before the independent master gain.

## WebGPU startup

The original page still requires a working WebGPU adapter. A browser can expose
`navigator.gpu` while returning no adapter; that makes Audio startup fail. In
local Chromium testing, normal headless mode reproduced “No WebGPU adapter was
found,” while explicitly enabled software WebGPU started and rendered audio.
That evidence does not identify the configuration of a particular user's device.

SIMD Chiptune never requests a GPU adapter. It needs Web Audio, AudioWorklet and
WebAssembly on HTTPS or localhost. `?scalar` explicitly selects scalar WASM for
compatibility checks. Audio loading can be cancelled without leaving pending
startup timers or allowing an old startup attempt to alter a newer session.

## Provenance and limits

The sound is a port of the repository's WebGPU Chiptune shader, which credits
srtuss's 2015 [Chiptune (sound)](https://www.shadertoy.com/view/MljSRt).
The source credit remains at the bottom of the workspace. The alternate
character skins extend the existing pixel dancers with no external sprite assets.
The repository's WebGPU 303 and SIMD 303 also supplied architectural examples; their acid-shader lineage credits
[sound - acid jam](https://www.shadertoy.com/view/ldfSW2). This document does not
establish additional licensing rights for those sources.

The instrument is chip-inspired, with no claim of emulating a particular console
or sound chip. GPU and WASM transcendental functions can produce different
hash-noise samples; exact cross-device noise identity is not promised. Pitched
voices, sequencing, envelopes, balance and effects preserve the original formulas.

## Verification

Verification distinguishes original musical-state parity from the intentional
interface redesign. The preset browser suite compares the complete original
preset cycle between WebGPU and SIMD, allowing only neutral Noise controls and
SIMD-specific skin/section/view state. Responsive checks cover 1440×900, 390×844 and
844×390, preset-menu placement, reachable transport, compact controls and the
drum editor. Paused character pixels are no longer expected to match WebGPU.

Audio browser cases exercise absent/failing WebGPU, bounded output, explicit
Audio/Play separation, silence on pause and teardown. Forced scalar checks cover
live edits, level response and worklet progress during a main-thread stall.
Kernel tests compare scalar/SIMD output, fixed memory, actual SIMD instructions,
voice/control response, packed edit timing and deterministic rendering. Adapter
and worklet tests cover cancellation, external context ownership, preview data,
late starts, fades, continuous configuration changes, fallback and disposal.
Meter tests check actual isolated stem peaks, mute/solo, echo and ghost tails,
scalar/SIMD agreement and unchanged output samples. Unified-level tests cover
legacy XY/trim snapshots, zero-level recovery and preservation of other controls.
Tempo regressions cover rapid changes after ten minutes, phase preservation,
in-flight drum hits, historical echo timing and paused resume. Parameter checks
cover ownership of all 154 controls, mode-dependent visibility and actual kernel
sensitivity. Browser checks exercise independent card views, per-voice/drum step
counts, reachable controls on all three layouts and WAX state restoration.
Performance tests cover neutral migration of the original six performers,
seven-performer mute/solo behavior, Noise timing and later-section extraction.

A matched-engine audit on 2026-09-24 used Chrome software WebGPU and the SIMD
kernel at 48 kHz. All 24 presets matched parameters and sequences in both Song
and Pattern. Across 156 matched-time scenes, isolated pitched voices differed by
less than 0.002 dB. Eight-second Source Tracker renders differed by −0.021 dB
in Song and −0.007 dB in Pattern; drums and the noise sweep retained similar
long-window envelopes and broad spectra. Individual hash-noise samples and quiet
noise tails differ because GPU and WASM transcendental math differ. This is
mechanical comparison evidence, not a listening verdict or a hardware-GPU claim.
Both pages default to Independent loops, which deliberately omits Song's section
movement and texture; compare matching modes as well as matching preset names.

Human listening and physical touch/MIDI-device acceptance remain unperformed;
automated signal and interface comparisons do not establish subjective sound
quality or playing feel.

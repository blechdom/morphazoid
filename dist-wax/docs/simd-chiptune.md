# SIMD Chiptune

SIMD Chiptune is the complete WebGPU Chiptune instrument rendered in an
AudioWorklet with WebAssembly SIMD. It shares the original controller, preset
bank, model, sequencer, performer drawing and stylesheet. The musical surface
matches the original: six animated performers, five pitched parts plus drums,
nine 32-step lanes, independent loop lengths and rates, Song/Pattern modes,
per-step pitch and volume, voice tone controls, mute/multi-solo and stereo echo.
The backend name changes and GPU-only chunk/workgroup settings are hidden.

Turn **Audio** on, then **Play**. Play can also run the visual transport while
Audio is off. Selecting a performer focuses its controls; dragging a performer
changes its sound through the same XY mappings as WebGPU Chiptune. The sequence
supports continuous painting, pitch/velocity editing and keyboard interaction.
Song retains the procedural composition; Pattern makes independently looping
editable parts. Preset recall restores the same complete original state without
stopping the transport. MIDI and WAX use the original sequence-instrument contract,
including the MIDI output preview.

## Source analysis and implementation choices

| Instrument inspected | Useful mechanism | Choice here |
| --- | --- | --- |
| [WebGPU Chiptune](../webgpu-chiptune.html) | Complete 154-parameter composition, nine lanes, articulated dancers, full presets, PolyBLEP pulse/saw, drums and eight analytic echo taps | Preserve the interface and musical formulas, including original tuning and phase. Share the controller and model so the two pages stay aligned. |
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

Straightforward improvements are deliberately narrow: 256-sample crossfades
on live configuration changes and short transport ramps reduce abrupt edges.
They do not restart oscillator phase, the composition or its echoes. Late
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
The existing credit remains on the page. The repository's WebGPU 303 and SIMD 303
also supplied architectural examples; their acid-shader lineage credits
[sound - acid jam](https://www.shadertoy.com/view/ldfSW2). This document does not
establish additional licensing rights for those sources.

The instrument is chip-inspired, with no claim of emulating a particular console
or sound chip. GPU and WASM transcendental functions can produce different
hash-noise samples; exact cross-device noise identity is not promised. Pitched
voices, sequencing, envelopes, balance and effects preserve the original formulas.

## Verification

The parity browser suite compares both pages at 1440×900, 390×844 and 844×390:
complete state, musical control inventory, paused performer-canvas pixels,
sequencer painting, voice controls, independent lanes, mode retention and the
complete preset cycle. Audio cases exercise absent/failing WebGPU, bounded
output, explicit Audio/Play separation, silence on pause and teardown.

Kernel tests compare scalar/SIMD output, fixed memory, actual SIMD instructions,
voice/control response, packed edit timing and deterministic rendering. Adapter
and worklet tests cover cancellation, external context ownership, preview data,
late starts, fades, continuous configuration changes, fallback and disposal.

Human listening and physical touch/MIDI-device acceptance remain unperformed;
automated signal and interface comparisons do not establish subjective sound
quality or playing feel.

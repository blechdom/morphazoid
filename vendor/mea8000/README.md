# MEA8000 parameter-frame synthesis in WebAssembly

This ports the **actual integer sound generator and quantization tables** from
Antoine Miné's BSD-3-Clause MAME MEA8000 model. It is a four-cascade-formant
parameter-frame engine, not a full text-to-speech frontend or an original chip
recording. No external phoneme ROM is required by this generator.

Pinned MAME revision: `c8588c15c78215a0ce36ac573aa5e8da03185e4c`.
Source: https://github.com/mamedev/mame/blob/c8588c15c78215a0ce36ac573aa5e8da03185e4c/src/devices/sound/mea8000.cpp .
The source is dated 2006; this is an emulator milestone. The original chip's
release date has not been established by this port. COPYING retains the BSD source license and copyright notice.

## API and controls

```js
import {createMea8000,synthesizeMea8000} from './runtime.js';
const engine=await createMea8000();
const {samples,sampleRate}=synthesizeMea8000(engine,{
  pitchHz:120,seed:1,
  frames:[{formants:[700,1200,2600],bandwidths:[125,125,125,125],
           amplitude:.088,durationMs:64,pitchDelta:0,noise:false}]
});
```

Returns mono Float32 at 64000 Hz: original 8 kHz DSP with the MAME 8× linear output
interpolation. `encodeMea8000Frame` converts readable controls into actual 4-byte
chip parameter frames, quantizing to the published tables. The fourth formant
is fixed at 3500 Hz; bandwidths have four choices; amplitudes have sixteen choices;
frame durations are 8/16/32/64 ms. Pitch increments use the frame's encoded signed
step; noise uses the dedicated pitch code. All tables are exported for honest
knob limits. Initial pitch is 40–500 Hz, quantized to the original 2 Hz pitch byte.
The JS wrapper bounds requests to 256 frames and 17 seconds of output.

The worker accepts `{type:'render',frames,...options}` or
`{type:'render',atlas:true,metadata,pitchHz:120}` and returns transferred samples
or an error. Its owner must terminate it after one request, on timeout and on
cancellation. Load only after explicit Audio consent.

## Extraction and interpretation

`build.py` extracts the integer interpolation, filters, waveform generation,
frame decoder, frame shift and quantization tables from the pinned source.
The deterministic noise-table seed substitutes for MAME's host random generator.
Native device callbacks/timers, bus commands and REQ handling are excluded;
a bounded offline host interpolates frame parameters with the same sample counts.
An initial fade from zero and final fade frame suit instrument playback, and
accumulated pitch is bounded to 20–1000 Hz. This is **not cycle-accurate bus/chip
emulation**. The synthesis equations and quantized frame meanings are retained.

`renderMea8000Atlas(engine,{metadata})` builds 43 **original educational English-ish
parameter gestures**. Those formant/noise settings are Morphazoid approximations,
not recovered MEA8000 speech tables or a historical text engine. The atlas
balances each finite gesture toward RMS 0.13 with peak cap 0.8, fades its edges,
and selects sample-clock vowel loops. The raw frame API retains its native level.
Expose direct formants, bandwidths, frame duration, noise, pitch and quantization
to make this engine's distinctive mechanism understandable.

The host, wrappers, authored gesture data and build script use Morphazoid's MIT
terms; the extracted DSP and tables retain their original BSD notice.

## Build and proof

With Emscripten 4.0.22 on PATH: `python3 scripts/vendor/mea8000/build.py` (from the repository root). EMXX/EM_CONFIG can select an
existing SDK. No system packages, native audio devices or runtime filesystem are
required. Modified extraction and bridge sources are in `scripts/vendor/mea8000/`;
the build script downloads the original source from its pinned revision. build.json records source/artifact hashes and compiler.
Deploy mea8000.js and mea8000.wasm together.

Node and real Chromium module-worker checks produced finite, nonzero raw frames
and all 43 atlas gestures with interior vowel loops and no page errors. The atlas
was 8.955 seconds, RMS 0.126 and peak 0.800; cold worker/render took about 75 ms here.
The WASM fetch was observed. No human listening or actual-mobile assessment has
been performed; those measurements do not certify intelligibility or authenticity.

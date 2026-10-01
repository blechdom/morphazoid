# Vizsn, device-free WebAssembly port

Actual Vizsn formant/resonator DSP and tables from Ville-Matias Heikkilä,
with Jari Komppa's SoLoud integration. Source and integration explicitly use
WTFPL terms; see COPYING and preserved source headers. Original Morphazoid
bridge, build script, JS wrapper and atlas mapping use the project's MIT terms.

Pinned SoLoud revision: `e82fd32c1f62183922f08c14c814a02b58db1873`.
Sources: `src/audiosource/vizsn/soloud_vizsn.cpp`, `include/soloud_vizsn.h` at
https://github.com/jarikomppa/soloud/tree/e82fd32c1f62183922f08c14c814a02b58db1873 .
First Vizsn release year is not established by this port; 2013–2018 is the
integration copyright interval, not an invention date.

## API

```js
import {createVizsn,synthesizeVizsn} from './runtime.js';
const engine=await createVizsn();
const {samples,sampleRate}=synthesizeVizsn(engine,{
  text:'aeiou ä ö y hello',voiceType:6,pitchHz:98,rate:1,seed:1
});
```

Output is mono Float32 at 8000 Hz. `text` uses Vizsn's native simple character
mapping, normalized to lower-case with ä/ö mapped to its two special vowels.
This is not general English pronunciation or a complete language frontend.
Alternatively supply `phones:[0,1,...]` using the 20 IDs in `VIZSN_PHONES`.
Text/phones are bounded to 1000 units; output to 120 seconds; phase-pitch control
35–450 Hz; rate 0.4–3; excitation 0–9. PitchHz expresses the base phase-increment
frequency; composite/noisy excitation modes need not have that perceived pitch.

The one-request module worker accepts `{type:'render',text,...options}` or
`{type:'render',atlas:true,metadata,...options}`, posts ready/transferred samples
or error, and must be terminated by its owner. Native-device backends are absent.
Generate only after Audio consent and terminate the worker on cancellation.

## Shared speech reader atlas

`renderVizsnAtlas(engine,{metadata,voiceType:6,pitchHz:98})` returns 43 clips with
existing Spelling metadata keys and sample-clock vowel loop points. This is an
**explicitly approximate adapter to Vizsn's limited 20-phone vocabulary**:
voiced stops, English affricates and TH are not separate native Vizsn phonemes.
Diphthongs concatenate native vowel gestures. Isolated H is silent in this
upstream model; the atlas retains its H→A filter transition and excludes the A
body. These are generated sounds, not a new recorded speaker or claimed exact
English phonemes.

Excitation 6 is the tested atlas default. Modes 0,1,2,3,5,6,7,8,9 generated valid
vowel loops in the Node check. Mode 4's squared phase excitation can lack stable
zero-crossing loops, so it is suitable for finite text/phoneme rendering only;
the atlas intentionally reports that limitation instead of returning silent
held vowels. An outer instrument limiter/calibrated gain remains appropriate.

## Changes from upstream

- Tiny original base-class shim removes the unused SoLoud mixer/device lifecycle.
- Render blocks are at most 256 samples. Final partial blocks return their actual
  size, and the end sentinel produces no stale buffer samples.
- A rate field adjusts original phone/transition timing without resampling.
- Signed integer phase wrapping is explicit through `-fwrapv`; the extreme
  excitation float-to-int conversion saturates before the original 8-bit stage.
- The original unsigned scaled PCM receives bias/DC removal and a finite bound.
- A fresh source/instance is owned per utterance; text is never changed while
  that instance runs. The bridge frees the upstream text allocation explicitly.
- Atlas mapping, edge fades and vowel-loop selection are separate integration.

No formant tables, resonator topology or native excitation formulas were replaced.
The result preserves Vizsn's intentionally rough 8-bit output stage.

## Rebuild and proof

With Emscripten 4.0.22 on PATH: `python3 scripts/vendor/vizsn/build.py` (from the repository root). Or set EMXX to an em++ path
and EM_CONFIG to its SDK config. Build uses no device/file/network runtime.
Modified DSP, shim and bridge sources are in `scripts/vendor/vizsn/`;
the build script downloads the original source from the pinned revision. Generated artifact hashes, source hashes and compiler version are in
build.json. Retain vizsn.js/vizsn.wasm together in any deployed directory.

Node checks cover finite bounded speech in all 10 excitation modes, native phones,
all 43 default atlas units, deterministic reset and safe repeated rendering.
Real Chromium module workers fetched the WASM and generated natural text and the
43-phone atlas without page errors. Default atlas measured 7.857 seconds,
RMS 0.0937 and peak 0.7245; cold worker/render was about 28 ms on this machine.
These are signal checks, not human listening or mobile-performance acceptance.

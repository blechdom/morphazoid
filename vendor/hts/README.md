# HTS English HMM speech in WebAssembly

This is a browser port of the actual HTS runtime, Flite+hts_engine English
frontend, and official CMU ARCTIC SLT HTS voice. It synthesizes parameter
trajectories from trained hidden Markov models and renders them with the HTS
vocoder. It is not a recording player, browser SpeechSynthesis call, neural
model, substitute formant synth, or the separate Flite Clustergen SLT model.

## Provenance and attribution

- **hts_engine API 1.10**, HTS Working Group, release December 25, 2015.
  Software: Modified BSD; see `LICENSE-HTS.txt`.
- **Flite+hts_engine 1.07**, HTS Working Group, release December 25, 2016.
  Software: Modified BSD; see `LICENSE-FLITE-HTS.txt`.
  This archive bundles its modified Flite 2.0.0 frontend and English lexicon;
  their additional notices are preserved in `LICENSE-FLITE.txt`.
- **HTS Voice CMU ARCTIC SLT 1.06**, HTS Working Group, release December 25,
  2016. Trained using HTS 2.3 and Carnegie Mellon University's CMU ARCTIC
  database. The trained voice is **Creative Commons Attribution 3.0**:
  <https://creativecommons.org/licenses/by/3.0/>. Preserve
  `LICENSE-SLT-VOICE.txt`, including its CMU ARCTIC source notice. The model
  itself is unmodified; this port packages it into `hts.data`. Atlas extraction,
  normalization, fades, and looping are Morphazoid adaptations of generated
  output. No contributor endorsement is implied.

Primary project: <https://hts-engine.sourceforge.net/>.
Archive origin: <https://downloads.sourceforge.net/hts-engine/>.
Exact archive and artifact SHA-256 hashes are in `build.json`.
These release dates describe the integrated versions, not the invention date
of HMM speech synthesis.

## Browser files

Ship the files in this directory with `src/families/speech/hts-runtime.js`,
`hts-atlas.js`, the shared vowel-loop helper and extended worker. `hts.js` is
Emscripten glue; speech generation executes inside `hts.wasm`. The lexicon is
compiled into WASM; `hts.data` contains the unchanged SLT model.

Current binary sizes and SHA-256 hashes are recorded in `build.json`.
Memory grows from 32 MiB to a 256 MiB resource ceiling. Ship WASM with
`application/wasm` and the model `.data` as `application/octet-stream`.

## API and integration

```js
import { createHts, synthesizeHts } from '../../src/families/speech/hts-runtime.js';
const module = await createHts();
try {
  const { samples, sampleRate, events } = synthesizeHts(module, {
    text: 'Daisy, give me your answer.',
    speed: 1,
    semitones: 0,
    beta: 0,
    voicingThreshold: 0.5,
    gvWeight: 1,
  });
} finally {
  module._hts_close();
}
```

Output is mono Float32 PCM at the native requested sample rate (48,000 Hz by default). `events` contains phonemes with
`phone`, `start`, and `end` in seconds, derived from actual HMM state durations.
Native whole-text synthesis retains the Flite frontend's language analysis
and the model's sentence timing. Text is currently English ASCII, 1–1000
characters. Render duration is capped at 90 seconds.

All numeric controls are passed to native setters without adapter range caps:
speed, pitch offset, beta, voicing threshold, spectral/F0 global variance,
alpha, frame period, sample rate and gain. Native code performs its own clamps.
Sample rate and frame period use the native unsigned integer ABI. Initial UI
spans are expandable and exact input can send values beyond them. Render work,
output duration and memory are separate resource budgets.
See `docs/voice-native-value-limits.md` for the source audit and evidence.

Render in the supplied module worker to avoid blocking the interface:

```js
const worker = new Worker('./worker.js', { type: 'module' });
worker.onmessage = ({ data }) => {
  worker.terminate();
  // data.type === 'ready': { samples, sampleRate, events } or atlas below.
  // data.type === 'error': { message }.
};
worker.postMessage({ type: 'render', text: 'Hello, Voicesaurus.' });
```

This worker serves exactly one render. Its owner must terminate it on
completion, error, cancellation, teardown, or timeout. Start workers only
after explicit Audio consent. Playback transport must not arm Audio.

For the existing 43-key Spelling Synthesizer contract:

```js
worker.postMessage({ type: 'render', atlas: true, metadata: SPELLING_DIPHONE_CLIPS });
// ready: { samples, sampleRate, clips }
```

`renderHtsAtlas` is also exported directly from `atlas.js`. Every gesture is
an actual model-generated phoneme, sliced from a dictionary word using the
HMM durations; e.g. AE from “cat,” TH from “thin,” ZH from “vision,” KW from
“queen,” KS from “six.” Vowels are generated slowly and get interior sustain
loops. Clips are independently normalized toward RMS 0.13 with a peak cap
of 0.8, edge fades, and short gaps. Shared atlas readback discards native
sentence coarticulation and timing; expose native text as a distinct mode
when native prosody is desired. Whole-text PCM preserves the upstream level
and needs the application's normal headroom-aware output conditioning.

## Rebuild

Requires Python 3.12+ and Emscripten 4.0.22. With a configured Emscripten SDK:

```sh
EMCC=/path/to/emsdk/upstream/emscripten/emcc python3 scripts/vendor/hts/build.py
```

The script fetches missing official archives, checks their hashes, extracts
them, and compiles bundled frontend and runtime C sources. Existing source
directories are reused; remove them to rebuild from freshly verified source.
The script retrieves the pinned official source archives. A public copy of the recipe and bridge is included under `source/`.

One portability adaptation is generated as `HTS_misc-portable.c`: upstream
HTS 1.10's FILE offset branch reads glibc's private `fpos_t.__pos`; the port
uses standard C `ftell((FILE *) fp->pointer)` for Emscripten/musl. The original
archive source is retained unchanged. The HTS equations, training model,
and native label frontend are unchanged. `bridge.c`, `runtime.js`, `atlas.js`,
and `worker.js` are original Morphazoid integration code. `vowel-loop.js`
is copied from the existing MIT-licensed Morphazoid helper.

## Verification

The initial port checks rendered native text and all43 gestures in Node and
real Chromium workers, checking finite PCM, pitch/rate sensitivity, vowel-loop
metadata and cancellation. Integrated regression checks live in
`e2e/voicesaurus.spec.mjs` and the shared speech suites. The build script is in
`scripts/vendor/hts/build.py`; copy its emitted `hts.js`, `.wasm`, `.data` and
`build.json` into this directory after a deliberate rebuild.

No human listening, singing-quality, timbral-fidelity, or mobile-device
acceptance is claimed. Pitch transposition is available; arbitrary sustained
notes through the atlas are not the same as a score-trained singing engine.

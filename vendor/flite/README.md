# Flite WebAssembly browser worker

This is a working browser port of the unmodified synthesis program in
`@echogarden/flite-wasi@0.1.1`. Flite reports **2.3-current, March 2022**.
Flite itself was publicly released in **2001**. Its Clustergen statistical
parametric synthesis architecture was published in **2006**. The package
version/build date should not be displayed as the invention date of a method.

## Runtime files

- `flite.wasm`: genuine WebAssembly/WASI, 17,284,756 bytes (gzip 13,154,129 bytes).
- `src/families/speech/flite-runtime.js`: small browser-neutral in-memory WASI adapter and WAV decoder.
- `src/families/speech/flite-worker.js`: module worker; synthesis and memory allocation stay off the UI thread.
- `src/families/speech/flite-phones.js`: all 43 Spelling Synth gesture IDs mapped to Flite/CMU phones.
- `src/families/speech/flite-atlas.js`: optional atlas renderer using one synthesis invocation per voice.
- `COPYING`: upstream complete license and component notices, retained verbatim.
- `VOICE_NOTICES.md`: authors/license headers for all six embedded voice definitions.

Flite and its embedded voices use the BSD-style terms documented in COPYING;
the npm package labels the overall license `BSD-4-Clause`. The WASI adapter,
worker, atlas renderer and strip script are new Morphazoid integration code,
not upstream Flite files. The only binary modification is removal of custom
debug/name/producers sections. Executable and data sections are unchanged.
All original voice data remain in the binary.

## Browser integration

The runtime and atlas helpers live in `src/families/speech/`:
`flite-runtime.js`, `flite-atlas.js`, `flite-phones.js`, `vowel-loop.js`,
`flite-worker.js` and `flite-loader.js`. The loader shares cancellation and
validation with `atlas-loader.js`. The browser worker accepts a render request
with `voice: 'slt'`, `'awb'` or `'rms'`, then returns a transferred phoneme atlas.
It is terminated by the owner on success, error, timeout or cancellation.

The reusable `synthesizeFlite(module, options)` function also supports whole
sentences and explicit Flite phone sequences, returning mono Float32 PCM,
sample rate and timed phoneme events. `pitch` is mean F0 in Hz, `pitchRange`
is its standard deviation and `rate` controls duration stretch. The current
instrument UI uses generated phoneme atlases, so native whole-sentence
coarticulation/prosody is not claimed for its readback.

Playback stays on Web Audio's sample clock. No server speech service is used;
the static WASM file is fetched only after explicit Audio enable. Serve the site
with HTTP(S), since module workers cannot reliably load from `file://`.

## Voices and methods

| Voice | Method | Notes |
| --- | --- | --- |
| `kal` | LPC-residual diphone concatenation | 8 kHz American English, Kevin Lenzo |
| `kal16` | LPC-residual diphone concatenation | 16 kHz American English, Kevin Lenzo |
| `awb` | Clustergen statistical parametric synthesis | 16 kHz voice model, Alan W. Black |
| `rms` | Clustergen statistical parametric synthesis | 16 kHz male American English voice model |
| `slt` | Clustergen statistical parametric synthesis | 16 kHz voice model, female American English |
| `awb_time` | Limited-domain concatenative time voice | **Not general-purpose TTS.** Do not offer it for arbitrary prose. |

The AWB/RMS/SLT model code predicts acoustic parameters and synthesizes speech
through an MLSA vocoder. These are distinct voices from the same engine/family,
not three independently invented synthesis methods. KAL16 overlaps the existing
Spelling KAL sample source; SLT/AWB/RMS are the valuable new comparison family.

`-psdur` emits end-of-phone times; the adapter derives starts from the preceding
end. Clustergen timings quantize to roughly 5 ms. KAL's reported segment times
do not exactly align with its actual diphone WAV boundaries, and singleton KAL
phones can yield zero frames. Use contextual KAL synthesis or the established
KAL atlas; the new atlas renderer intentionally only accepts Clustergen voices.

## Atlas rendering

```js
const module = await WebAssembly.compile(await (await fetch('vendor/flite/flite.wasm')).arrayBuffer());
const atlas = renderFliteAtlas(module, { voice: 'slt', metadata: SPELLING_DIPHONE_CLIPS });
// atlas: { samples: Float32Array, sampleRate: 16000, clips: { a: {...}, ... } }
```

The renderer builds one phone sequence with silence boundaries, synthesizes it
once, then slices from Flite's own timing events. This avoids creating 43 copies
of the engine's 17 MB initial memory. Three repeated units give vowels enough
steady sound to choose positive-going, phase-matched loop points. Consonants
and glide clips remain finite. Fade edges are 3 ms; gaps are 12 ms. This atlas
is generated locally rather than shipped as a recording. An atlas intentionally
discards sentence coarticulation/prosody so it can be played letter by letter;
use the full-text API above for Flite's native phrase rhythm.

Atlas gains follow the existing eSpeak atlas convention (1.8 consonants/clusters;
1 otherwise). Fixed SLT/AWB/RMS output trims of 0.9/1.2/1.3 were calibrated through
the instrument's master and protection chain. A real-browser capture of the same
phrase across all ten voices passed the active-RMS spread limit of 4 dB and
sample-peak limit of 0.95, with no non-finite output. These are signal checks;
human listening and intelligibility acceptance remain unperformed.

Bounds: each request permits 1–1000 input characters, rate 0.4–3, pitch 40–400 Hz,
and range 0–100 Hz. Output memory files are capped at 32 MB. The binary's initial
linear memory is 262 pages (17,170,432 bytes), grows when needed, and has no
declared maximum. Atlas rendering makes one instance and produces under 12 seconds
of packed PCM, 43 clips, and valid loops for all ten literal vowel categories.
A production worker timeout and termination are the cancellation boundary.

## Proof

Real headless Chromium module-worker tests on localhost produced four full
sentences via KAL16/SLT/AWB/RMS, with only local requests and zero page errors.
Cold worker+fetch+synthesis took approximately 114–198 ms for 3.7–4.6 seconds of
speech on this machine. This is not a mobile performance guarantee.

Every one of the 43 phone gestures produced nonzero PCM for all three
Clustergen voices. The single-invocation atlas tests returned:

| Voice | Packed seconds | Clip duration range | CPU render time |
| --- | --- | --- | --- |
| SLT | 11.196 | 0.076–0.627 s | 373 ms |
| AWB | 11.729 | 0.100–0.730 s | 187 ms |
| RMS | 7.644 | 0.037–0.624 s | 124 ms |

## Reproduction and provenance

- Package: https://www.npmjs.com/package/@echogarden/flite-wasi/v/0.1.1
- Package source: https://github.com/echogarden-project/flite-wasi
- Package git revision: `dcccbab8f63e706174df857fba694ec541b97e48`
- Upstream engine/source build instructions: https://github.com/festvox/flite
- Engine history: http://www.festvox.org/flite/
- Clustergen: Alan W. Black, *CLUSTERGEN: A statistical parametric synthesizer using trajectory modeling*, INTERSPEECH 2006.
- Tarball: https://registry.npmjs.org/@echogarden/flite-wasi/-/flite-wasi-0.1.1.tgz
- npm integrity: `sha512-/ayJRFWbq73EEL8N82z1WO2mbey87wFa+t1o+U+xyaD7Ub0qedQ9s0IDJlO5cVvyD2ZXQbFwzeiCD8eXqQ8HCQ==`
- Stripped WASM SHA-256: `198d1ba1929c66b3bb782932adc10c27265eba9e3f80199f47335a67f612ea9e`

Extract that package, retain its COPYING, then run:

```sh
python3 scripts/strip-flite.py package/flite.wasm vendor/flite/flite.wasm
```

The package's README points to upstream WASI build instructions. The npm metadata
identifies the packaging revision; it does not establish an exact upstream engine
commit, so no stronger source revision claim is made here.

# Sinsy Japanese score singing in WASM

Built and verified in Chromium on 2026-10-01. This is the actual Sinsy 0.92
Japanese MusicXML frontend, original singing-context label generator,
hts_engine API 1.10 vocoder, and NIT SONG070 F001 trained Japanese singing
model. It does not use an English speech/phoneme atlas, prerecorded song,
browser speech API, remote service, or playback-rate approximation.

## Integration files

Copy into `src/families/speech/`:

- `sinsy-score.js`: validated note/lyric/tempo-to-MusicXML helper, controls and defaults
- `sinsy-runtime.js`: WASM loader and waveform render API
- `sinsy-worker.js`: one-request module worker
- `sinsy-presets.js`: 10 full presets, including score and native controls

Copy into `vendor/sinsy/` together:

- `sinsy.js`, `sinsy.wasm`, `sinsy.data`, `build.json`
- `COPYING-SINSY`, `COPYING-HTS-ENGINE`, `COPYING-MODEL`

Retain `build.py` and `bridge.cpp` in the source distribution/rebuild directory.
The build script takes no repository paths: run it from a directory containing
the bridge with `emcc` and `em++` on PATH. It fetches and verifies pinned
source archives, applies explicitly documented compatibility/API patches,
compiles and writes the artifacts. The upstream hashes are recorded in
`build.json`. Existing downloaded archives may be placed alongside it to avoid
network access. The source and model archives are retained here as well.

## API

```js
import {sinsyScoreToMusicXml, SINSY_CONTROLS} from './sinsy-score.js';
const xml = sinsyScoreToMusicXml({
  tempo: 100,
  notes: [
    {midi: 69, beats: 1, lyric: 'さ'},
    {midi: 69, beats: 1, lyric: 'く'},
    {midi: 71, beats: 2, lyric: 'ら'},
  ],
});
worker.postMessage({type: 'render', xml, values: {alpha: .55}});
// {type:'ready', samples:Float32Array, sampleRate:48000}
// or {type:'error', message}
```

Low-level in-worker equivalent:

```js
const {samples, sampleRate} = await renderSinsyScore(xml, values);
```

Audio stays off until the owner arms it explicitly. Rendering does not create
an AudioContext. Start the worker only after Audio consent; terminate it on
success, error, cancel, timeout, or teardown. No native alignment events are
exposed, so do not manufacture phoneme timings. A score cursor is authored
score timing, not an automatically measured vocal alignment.

`SINSY_PRESETS` entries are `{id,label,values,score}`. `values` contains actual
units for all seven native controls. `score` is `{tempo,notes}`. Score tempo is
separate from engine values; do not pass it to `renderSinsyScore`'s values.

## Native values and score controls

The original Japanese kana dictionary, note and lyric frontend, trained model
and score timing run in WASM. Native controls include alpha, pitch shift, gain,
frame density, postfilter, voicing threshold and spectral global variance.
Tempo belongs to the musical score; frame density preserves aligned score duration.
Note, tempo, pitch and vocoder operating-range caps were removed. The native
setters determine clamping or rejection. Initial knob spans are views only.

The helper converts musical beat durations to the engine's native 480-tick
clock, constructs matching measure lengths and adds short boundary rests.
Score-input size, 50-second audio duration and 50,000 predicted synthesis frames
are resource budgets; they do not define musical parameter ranges.
See `docs/voice-native-value-limits.md` for the final contract and evidence.

## Upstream changes

The Japanese dictionary, lyric converter, score timing/pitch, trained model,
label generation and synthesis algorithms remain original. Changes are:

1. Three explicit C++03 `std::make_pair<...>` instantiations now use ordinary
   type deduction for compatibility with modern libc++.
2. HTS's glibc-private file-offset access uses standard `ftell` for MEMFS.
3. Public forwarding methods expose existing `HtsEngine::setTone/setSpeed`,
   plus original `HTS_Engine_set_beta`, `set_msd_threshold` and `set_gv_weight`.
4. A new bounded C bridge copies original double PCM into Float32 output.

The old source emits dynamic-exception-specification warnings under modern
WASM; normal C++ exception handling is enabled. HTS also emits an upstream
self-comparison warning in its multiple-model validation path. This port
loads one verified model.

## Provenance and dates

- Sinsy 0.92 source release: December 25, 2015, Modified BSD.
- NIT SONG070 F001 0.90 voice release: December 25, 2013, **CC BY 3.0**.
- Voice attribution: Sinsy Working Group / Nagoya Institute of Technology,
  Department of Computer Science. Retain and present the model's attribution
  and link to <https://creativecommons.org/licenses/by/3.0/>.
- HTS engine 1.10: Modified BSD, its separate notice retained.
- Official source: <https://sinsy.sourceforge.net/>.

These are pinned release dates, not claims to the exact invention date of
HMM singing or the Sinsy project.

## Verification

`browser-proof.mjs` serves these scratch artifacts under their intended
browser paths and runs actual Chromium module workers. `browser-proof.json`
records 36 successful WASM renders: baseline plus score/control contrasts,
all 10 presets, and min/max of all seven engine controls. Checks include
finite bounded non-silent PCM, score tempo affecting actual duration, native
frame density preserving aligned duration, native control sensitivity,
invalid-input rejection, `.wasm`/`.data` fetches, and no page errors.

This is mechanical DSP/browser evidence. Human listening and mobile layout
acceptance have not been performed by this handoff.

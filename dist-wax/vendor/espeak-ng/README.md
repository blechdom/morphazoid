# eSpeak NG — English WebAssembly build

This is a real WebAssembly build of eSpeak NG 1.52.0.1 and Echogarden's
`eSpeakNGWorker` wrapper. It supports the default formant renderer, Klatt voice
variants and speechPlayer. `espeak-ng.wasm` contains the synthesis executable;
`espeak-ng.js` is the Emscripten module/virtual-filesystem glue. Speech is rendered
locally in a worker, without a remote text-to-speech service.

## Sources and licensing

- eSpeak NG/Echogarden fork: commit
  [`9a550bef455f03b459f51796e3482833aab7fbc0`](https://github.com/echogarden-project/espeak-ng/tree/9a550bef455f03b459f51796e3482833aab7fbc0).
- Source archive: <https://codeload.github.com/echogarden-project/espeak-ng/tar.gz/9a550bef455f03b459f51796e3482833aab7fbc0>.
- Emscripten 4.0.22, installed with emsdk commit
  `e566f7bdcc7735f44037911c24b87a58a3c93145`.
- Sonic's pinned source `fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104` is supplied to
  CMake's dependency discovery. Sonic is disabled in the produced engine.
- GPL-3.0-or-later; see [COPYING](COPYING). The upstream Apache, BSD and Unicode
  component notices are preserved in `COPYING.APACHE`, `COPYING.BSD2` and
  `COPYING.UCD`. The surrounding Morphazoid project retains its own license.

## Packaging changes

The source's existing synchronous `eSpeakNGWorker` API is preserved, including
16-bit PCM and timed IPA phoneme events. Klatt and speechPlayer are enabled;
MBROLA, Sonic, hardware playback and asynchronous native threading are disabled.

The only source-build change is `SINGLE_FILE=0` in `emscripten/Makefile`, so the
WebAssembly binary is stored separately. Preloaded data is repacked after the
build to retain English language files, all voice variants and the shared
phoneme/intonation tables. The synthesis executable is not altered by subsetting.
The original all-language data package is approximately 19 MB; the English
package is 936,055 bytes. English `en-us` and `en-us+klatt` are exercised by
Morphazoid's phoneme atlas; other languages are not included.

## Rebuild

From the repository root, with Python 3.12+, CMake, make and a C/C++ compiler:

```sh
python3 scripts/build-espeak-wasm.py /tmp/rebuilt-espeak /tmp/espeak-build
```

The script downloads pinned source revisions and a temporary Emscripten SDK;
it does not install system packages. Allow roughly 2 GB of scratch space.
It builds native data first, cross-compiles the WASM library/wrapper, subsets
English data, copies licenses and writes `build.json` with revisions and SHA-256
checksums. It can target `vendor/espeak-ng` to replace the checked-in engine.

## API and validation

```js
import create from './espeak-ng.js';
const module = await create();
const voice = new module.eSpeakNGWorker();
voice.set_voice('en-us'); // or en-us+klatt
voice.set_rate(140);
voice.set_pitch(43);
voice.set_range(0);
voice.synthesize('Hello, Voicesaurus.', (pcm16, events) => {
  // Copy/consume Int16Array PCM; events include phoneme audio_position in ms.
  return false;
});
```

The pitch and range setters use eSpeak's 0–99 speech controls, not MIDI note
numbers. The sample rate is reported by `voice.samplerate` (22,050 Hz here).
The browser loads `espeak-ng.wasm` and `espeak-ng.data` next to this module.

A Chromium module-worker check verified a real `WebAssembly.instantiateStreaming`
call, local WASM/data fetches, both 43-phone atlases, timed phoneme callbacks and
whole-text speech without console errors. No listening judgment is implied.

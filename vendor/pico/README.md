# SVOX Pico — local WebAssembly runtime

Actual Pico WASM engine from `@echogarden/svoxpico-wasm@0.2.0`, package source commit `4b1d64dc4c69cec088141d8653c526f09b76ea62`: https://github.com/echogarden-project/svoxpico-wasm . Its runtime files are unmodified. The npm archive SHA-256 is `c1874834673159ac068282d36bab7e3a21e399043388d4e56763b54f1d6885b1`.

English language resources are from https://github.com/naggety/picotts at `21089d223e177ba3cb7e385db8613a093dff74b5`; every bundled `.bin` was compared with the bytes at that pinned revision. US English uses `en-US_ta.bin` + `en-US_lh0_sg.bin`; British English uses `en-GB_ta.bin` + `en-GB_kh0_sg.bin`. Total runtime/data payload is about 3.54 MB before compression, with each locale loaded on demand.

Pico's public API records an initial version on 2009-04-20, with 2008–2009 SVOX copyright. The source maps phonetic features through decision trees to acoustic parameters with five states per phone, log-F0 and mel-generalized cepstral models. Its signal stage performs spectral/phase reconstruction and overlap-add. This is statistical parametric speech synthesis, not an ordinary diphone recording player.

Licenses: core/package Apache-2.0 (`LICENSE`); upstream resources notice retained as `DATA_NOTICE`. `DEBIAN_COPYRIGHT` records the specific model-data caveat: those files claim Apache-2.0 and are redistributable, but Debian classifies them as non-free because preferred source is missing. Do not describe the language models as fully reproducible open training data. Preserve SVOX/Android/Ooura attribution. The independently written JavaScript bridge uses the documented public C API; it does not copy the Echogarden wrapper implementation.

`vendor-pico-wasm.py` reproducibly retrieves and verifies the exact published package and four English data files. It is a pinned vendoring script, not a claim that this work rebuilt the upstream WASM compiler output. Package/build source is linked above. `build.json` records runtime and model hashes.

Bridge API:

- `await createPico({language:'en-US'|'en-GB'})`: fetch local WASM and two selected model files, initialize a 2.5 MB engine arena and its voice.
- `synthesizePico(engine,{text,pitch:1,speed:1,volume:.7})`: native whole-sentence TTS, returns Float32 PCM at 16 kHz. Pitch supports .5–2, speed .2–5, volume 0–1; default .7 preserves output headroom.
- `synthesizePico(engine,{phones:xsampa,...options})`: native phonetic input. The wrapper escapes XML attributes and Pico's additional backslash escape convention.
- `renderPicoAtlas(engine,{pitch,speed,volume})`: 43 English gestures and ten vowel sustain loops for the segmented reader. Pitch/speed are applied by Pico during synthesis, not playback resampling. British /b,g,r/ need opening-to-schwa context; an acoustic onset estimate retains the consonant's opening transition and discards the sustained helper vowel. It is not a native phoneme timestamp. Each gesture body is balanced under a .85 peak ceiling.
- `engine.dispose()`: release native engine, voice, resources and allocated buffers. Workers serialize requests and may be terminated for cancellation.

Input/output limits and checked pointer lengths protect the bridge against unbounded loops/output. Native data/functions still come from historical C code; all synthesis belongs in a disposable worker. The browser wrapper uses fetch/Emscripten's memory filesystem, with no Node filesystem or remote speech service.

Verified in Node: both locales rendered all 43 gestures, all ten vowel loops, and complete text with meaningful native speed changes. Chromium module worker fetched real WASM and rendered the US atlas in about 381 ms on this machine, then changed to British English and generated a complete sentence. Signals were finite; atlas peaks stayed at/below .85. These are local machine measurements, not mobile performance guarantees. Human listening remains pending.

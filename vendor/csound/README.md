# Csound voice opcodes in WebAssembly

Voicesaurus uses the original Csound `fof` and `vosim` opcodes in an actual WASM engine. These are two synthesis methods inside one Csound runtime. The phonetic target tables and orchestras are original Morphazoid educational examples, not the original CHANT program or voice database and not a full Csound text-to-speech frontend.

## Exact runtime and source

`csound.wasm` is the unmodified `package/lib/csound.dylib.wasm` from `@csound/wasm-bin@6.18.7`, renamed locally. Package version 6.18.7 reports `csoundGetVersion() === 6181` (Csound 6.18.1). No executable/custom sections were removed or edited. Size: 4,688,462 bytes. SHA-256: `67311f471b48a96173b498a29d6b125cffe1c005410a49bcbd9b9987d27b7707`.

- Published package: https://registry.npmjs.org/@csound/wasm-bin/-/wasm-bin-6.18.7.tgz
- Package/source revision: https://github.com/csound/csound/tree/cbbdbcab7833e1b5e7f4cc267bb057b3b055ff40
- WASM build recipe and patches: https://github.com/csound/csound/blob/cbbdbcab7833e1b5e7f4cc267bb057b3b055ff40/wasm/src/csound.nix
- Runtime/codec dependency recipes: https://github.com/csound/csound/tree/cbbdbcab7833e1b5e7f4cc267bb057b3b055ff40/wasm/src

`scripts/vendor-csound-wasm.py OUTPUT_DIR` verifies the immutable package's SHA-512, extracts the one binary and verifies its SHA-256. This reproduces the published artifact; it does not claim to recompile the compiler output from source. The pinned upstream repository contains the synthesis sources, WASI patches and Nix recipes needed to modify/rebuild the library. Those recipes pin libsndfile, mpg123, LLVM, wasi-libc and wasi-sdk; other codec source versions come from the chosen Nix package set, so a fresh source build is not claimed byte-identical here.

The independent JavaScript host in `src/families/speech/csound-runtime.js` supplies a bounded memory-only WASI environment, invokes the exported Csound API and copies mono floating-point output. No `@csound/browser` wrapper or plugin-example binary is bundled. Only authored orchestras/scores are accepted by the voice layer. Engine compilation/rendering belongs in a disposable worker; the owner terminates it on cancellation or timeout. The unmodified Csound WASM remains a separate, replaceable library; the host/orchestra source is available in this repository for adapting to a modified compatible build.

## Licenses and embedded dependencies

Csound is LGPL-2.1-or-later; see `COPYING` and the pinned source-file notices. Its statically linked dependencies remain present even though these voice examples do not decode or encode audio files:

- libsndfile: LGPL-2.1-or-later, `COPYING.libsndfile`; source https://github.com/libsndfile/libsndfile/tree/3bd5048f8c2f7285743e9922c195c7a08f3f5551 .
- libFLAC, libogg and libvorbis: retained BSD notices in `COPYING.flac`, `COPYING.ogg`, `COPYING.vorbis`; projects https://xiph.org/flac/ , https://xiph.org/ogg/ , https://xiph.org/vorbis/ .
- LAME: GNU Library GPL, retained in `COPYING.lame`; source https://lame.sourceforge.io/ .
- mpg123 1.29.3: LGPL-2.1, copyright 1995–2020 Michael Hipp and others; exact upstream terms in `COPYING.mpg123`, retrieved from https://www.mpg123.de/download/mpg123-1.29.3.tar.bz2 .
- wasi-libc: retained overview `COPYING.wasi-libc`, musl MIT notices `COPYING.musl`, cloudlibc BSD notice `COPYING.cloudlibc`, and LLVM/Apache exceptions `COPYING.llvm`. Source revisions are recorded in the pinned upstream `wasi-sdk.nix` recipe.

The repository's MIT license does not replace these component terms.

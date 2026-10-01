# Compiler/runtime notices for the browser speech ports

GnuspeechSA, Vizsn and MEA8000 were built using Emscripten 4.0.22. Retained notices
from that SDK cover generated JavaScript/runtime glue (Emscripten MIT/NCSA),
C library code (musl MIT and its listed components), and C++/compiler-runtime code
(LLVM Apache-2.0 with exceptions and included legacy notices).

These notices supplement the engine-specific source/voice licenses. They do not
make GPL-licensed Gnuspeech or other engine code MIT-licensed.

- Emscripten source/license: https://github.com/emscripten-core/emscripten/tree/4.0.22
- The SDK is pinned by each engine's build script/manifest.
- `Emscripten-LICENSE`, `musl-COPYRIGHT`, `LLVM-LICENSE` are unmodified SDK notices.

Csound's separately built WASI runtime uses its own pinned LLVM/wasi-libc source;
its version-specific notices are retained with `vendor/csound/`.

# Remote @ffmpeg/core runtime provenance

FFmpeg Wasm Lab does not store or publish `@ffmpeg/core` object code. After an
explicit Load Core or microphone action, the browser downloads the ESM
single-thread build from the official package CDN and rejects it unless both
files match the recorded SHA-256 values:

- JavaScript: https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js
  - SHA-256: `67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3`
- WebAssembly: https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm
  - SHA-256: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`

The package declares `GPL-2.0-or-later`. The GPLv2 text is retained here as
`COPYING.GPLv2`, and the page links users to this provenance record.

- Package: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Release source/build reference: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1
- Source archive: https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz
- Single-thread build recipe: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/71aa99d37c02a7b4c435275ca9ef50e612f6efa1/build/ffmpeg-wasm.sh

These links identify the upstream release; Morphazoid has not independently
established that the source archive alone is complete Corresponding Source for
the package binaries.

Only the pinned core assets are requested from unpkg. Captured microphone PCM
is processed inside the browser worker and is never sent to the CDN.

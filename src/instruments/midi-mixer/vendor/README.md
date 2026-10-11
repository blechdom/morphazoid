# MIDI mixer SoundFont dependency

The mixer uses [SpessaSynth Core](https://github.com/spessasus/spessasynth_core)
4.3.22 with [stb-vorbis](https://github.com/spessasus/stb-vorbis) 0.0.6,
retrieved from the official npm registry on October 10, 2026. Both packages use
Apache-2.0; complete text is in `LICENSE.txt`. The bundled stb_vorbis C decoder
retains its public-domain dedication.

These are the same pinned engine/decoder versions embedded by Midiophilia's
existing SoundFont player. The mixer needs direct processor access so two MIDI
scores can run under one audio-frame clock. It does not modify upstream code or
use a runtime CDN. It reuses `assets/midiphoria/soundfont/TimGM6mb.sf2`; see that
asset's existing license and credits.

`spessasynth-core.js` bundles only `SpessaSynthProcessor`, `SoundBankLoader` and
`SpessaLog`, with esbuild-wasm 0.28.2: ESM, browser platform, ES2022 target,
minification, legal comments at EOF. Reproduce by `npm pack` of the two pinned
versions (no install scripts), extracting Core to `package/` and stb-vorbis to
`node_modules/stb-vorbis/`, then bundling an entry that exports the three symbols
from `./package/dist/index.js` with those options. Two generated template-literal
line-ending spaces are escaped as `\x20` without changing their string values,
so the committed bundle passes whitespace checks.

| Source package | SHA-256 |
| --- | --- |
| `spessasynth_core-4.3.22.tgz` | `ff232efdef6bdd46037098dfede1f652aec53dd6042463170144bb929af722f9` |
| `stb-vorbis-0.0.6.tgz` | `c9b539e71303f17bfb2fbcfd546fa905d1e25b045a3bd15454e6caf072f52659` |

Primary API references: [direct processor audio loop](https://spessasus.github.io/spessasynth_core/getting-started/)
and [MIDI channel parameters](https://spessasus.github.io/spessasynth_core/spessa-synth-processor/midi-channel/).
The installed 4.3.22 source and TypeScript declarations were checked alongside
the current upstream docs.

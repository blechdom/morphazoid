# Midiophilia browser MIDI player dependencies

Retrieved from the official npm registry on October 7, 2026.

- [SpessaSynth Lib](https://github.com/spessasus/spessasynth_lib), version 4.3.14.
- [SpessaSynth Core](https://github.com/spessasus/spessasynth_core), version 4.3.22.
- [stb-vorbis](https://github.com/spessasus/stb-vorbis), version 0.0.6.

All three JavaScript packages use Apache-2.0; complete text in `LICENSE.txt`.
The bundled stb_vorbis C decoder retains its public-domain dedication.
The packages are separate from the original Python Midiphoria repository.

`spessasynth.js` bundles only the WorkletSynthesizer and Sequencer exports from
Lib with the pinned Core and stb-vorbis dependencies, using esbuild-wasm 0.28.2:
ESM, browser platform, ES2022 target, minification, legal comments at EOF.
The npm dependencies themselves specify `latest`; this vendored build pins the
exact versions above, and makes no runtime CDN requests.

One change to Lib before bundling: remove the Sequencer constructor's exact
`window.addEventListener("beforeunload", this.resetMIDIOutput.bind(this));` line.
This page never routes to external MIDI output. Its own pagehide lifecycle
closes the synth and AudioContext; removing the anonymous listener prevents
leaks on failed startup and restored pages. All other library code is unchanged.
`spessasynth_processor.min.js` is the prebuilt AudioWorklet from the Lib 4.3.14
npm package, with its dependencies embedded by upstream. Its only adaptation
replaces the single exact `registerProcessor(ma,Xt);` statement with
`export{Xt as SpessaSynthWorkletProcessor};`. The authored
`../midiphoria-processor.js` subclasses that processor and registers the original
processor name. Its note middleware handles sequencer and direct MIDI attacks
before synthesis, preserving the upstream transport, controllers and sound bank.
No upstream synthesis or sequencing implementation is rewritten.

To reproduce: use `npm pack <package>@<version> --ignore-scripts` for each pinned
package in a temporary directory; extract Lib as `package/`, Core as
`node_modules/spessasynth_core/`, and stb-vorbis as `node_modules/stb-vorbis/`.
Remove the one line above from Lib's `dist/index.js` into a temporary copy.
Bundle an entry exporting `{ WorkletSynthesizer, Sequencer }` from that copy
with the esbuild options above; copy Lib's processor and license, then apply
the exact processor statement replacement described above once. Reversing that
replacement must reproduce upstream processor SHA-256
`109ad445931e5c6e17739a994b2694d325577a6cb6fd2b56b39385edfc9e1fb5`.
No install hooks or upstream application scripts are required.

| Source package | SHA-256 |
| --- | --- |
| `spessasynth_lib-4.3.14.tgz` | `44912872fa9c1ce8c132f3259b7af4813f0a31f85bd83b6ee010b1c960069072` |
| `spessasynth_core-4.3.22.tgz` | `ff232efdef6bdd46037098dfede1f652aec53dd6042463170144bb929af722f9` |
| `stb-vorbis-0.0.6.tgz` | `c9b539e71303f17bfb2fbcfd546fa905d1e25b045a3bd15454e6caf072f52659` |

| Shipped file | SHA-256 |
| --- | --- |
| `spessasynth.js` | `ceebab141fe8b7e7625c70d5899ce8999e1d475938e5d10e23d5c5cebcc78771` |
| `spessasynth_processor.min.js` | `f62027244c4f1e4d687483c50976ee72ded54ce081e57c88b0d9cb0f81b9199a` |

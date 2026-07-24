# Elementary Audio browser bundle

This directory contains a local ESM bundle of:

- `@elemaudio/core` 4.0.3
- `@elemaudio/web-renderer` 4.0.3

Both packages are MIT licensed. The renderer embeds its AudioWorklet and WASM
runtime, so the static site does not need a package manager or a separate
`.wasm` request.

The bundle was generated with esbuild 0.28.0 from:

```js
export { el } from "@elemaudio/core";
export { default as WebRenderer } from "@elemaudio/web-renderer";
```

Elementary's `sampleseq2` node uses Signalsmith Stretch internally. The audio
engine lab therefore labels this path as an Elementary runtime/graph comparison
with a Signalsmith backend, not as an unrelated fourth stretching algorithm.

Upstream: <https://github.com/elemaudio/elementary>

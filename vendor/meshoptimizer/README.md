# meshoptimizer decoder 0.25

Unmodified ES module from the upstream `v0.25` tag. It embeds its scalar and SIMD
WebAssembly decoders and has no network dependency. MIT license: `LICENSE.txt`.

- Source: https://github.com/zeux/meshoptimizer/tree/v0.25/js
- File: https://raw.githubusercontent.com/zeux/meshoptimizer/v0.25/js/meshopt_decoder.module.js
- SHA256: `4ac97b2c44347dacb9a0ca9c3740c8678d166fdcf02bc1612f371e27418e70a7`
- License SHA256: `e4a26033e3551fb2722888949fbb41e77aee628e8e8f04dcffeee301aa7e5634`

The Roach GLB uses `EXT_meshopt_compression` with lossless `ATTRIBUTES` and
`INDICES` streams, with no quantization filters. Three.js's existing GLTFLoader
supports it after `loader.setMeshoptDecoder(MeshoptDecoder)`. Configure
`MeshoptDecoder.useWorkers(1)` to move decoding off the UI thread; the caller owns
worker teardown through `useWorkers(0)`. Await `MeshoptDecoder.ready` before
calling synchronous decode methods. Audio must remain independent of loading.

The corresponding encoder is an offline-only tool under
`scripts/vendor/meshoptimizer/`; it is not needed in the published site.

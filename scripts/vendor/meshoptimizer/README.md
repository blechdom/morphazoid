# Offline meshoptimizer encoder 0.25

Unmodified encoder from https://github.com/zeux/meshoptimizer/tree/v0.25/js.
MIT license: `LICENSE.txt`. No npm installation is required.

- Original: https://raw.githubusercontent.com/zeux/meshoptimizer/v0.25/js/meshopt_encoder.module.js
- SHA256: `54f67e999c6facbb946219f967e96cb6dc00a004d1c7c7ae5ca373e003600ebf`

Used only by `scripts/optimize-roach-asset.mjs`, which never invokes reordering,
quantization or simplification. Keep this build-only file out of runtime output.

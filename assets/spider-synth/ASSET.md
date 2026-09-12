# Spider specimen

The real CC0 *Argiope bruennichi* scan is credited in [SOURCE.LICENSE.txt](SOURCE.LICENSE.txt). [source-provenance.json](source-provenance.json) preserves the publisher's identity, species, license, counts, download metadata and original archive digest. The static scan is approximately 106,200 triangles; the supplied calibration cube is excluded.

`spider-mobile.glb` contains the entire animal surface, one 4K photographed color atlas, and an authored 38-joint skin. Its 5,488,852-byte transfer uses lossless Meshopt compression and WebP quality 92. Texture encoding is lossy; geometry, UVs and skin attributes are not quantized or decimated. The decoded mesh attributes occupy 7,179,600 bytes. A decoded 4K RGBA texture occupies about 64 MiB before mipmaps and renderer overhead.

The rig separates cephalothorax, abdomen, paired pedipalps and chelicerae, and four grouped segments per walking leg. These are authored control regions on the continuous scanned surface. The four grouped leg joints do not imply that spiders have only four anatomical leg segments. Small mouth-region boundaries, skinning and all movement are approximations. The viewer has no flying motion and does not claim a full mesh collision solver.

`rig-manifest.json` records source-space pivots after the coordinate transform, eight measured centerlines and four link lengths per leg. Its `outputSha256` identifies the intermediate uncompressed prepared GLB. `spider-mobile.glb.report.json` separately identifies the final compressed delivery and verifies all decoded attribute bytes against that intermediate file. Instrument coordinates are +Y up, +Z forward and +X right, with the web in the XZ plane.

To rebuild, download and extract the licensed glTF archive named in SOURCE.LICENSE.txt. Keep its `scene.gltf`, `scene.bin` and `textures/` together. From the repository root:

```sh
python3 scripts/spider-build-asset.py /path/to/extracted/gltf /tmp/spider-prepared/spider-rigged.glb
node scripts/spider-pack-asset.mjs /tmp/spider-prepared/spider-rigged.glb assets/spider-synth/spider-mobile.glb
cp /tmp/spider-prepared/rig-manifest.json assets/spider-synth/rig-manifest.json
node --test tests/spider-synth-asset.test.mjs
```

The preparation script requires NumPy, SciPy and Pillow only at build time. The published delivery was prepared using NumPy 2.5.3, SciPy 1.18.1, Pillow 12.3.0 and Node 22.23.2, plus the repository's vendored Meshoptimizer encoder. WebP bytes may differ with encoder versions; the packed report records the actual result. No processing dependencies or original source archives are downloaded by the instrument at runtime.

`specimen.webp` is an actual 1100 x 900 render of the neutral spider and web. The matching instrument icon is a separate 512 x 512 render, not a crop that cuts away the feet. Both use WebP quality 90. No AI-generated specimen image is used.

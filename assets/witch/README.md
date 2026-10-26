# Witches Brew model derivatives

These three models reduce texture download and decoding costs for Witches Brew.
They retain every source triangle, vertex attribute, joint, skin weight, animation,
material and scene node. The full binary prefix containing geometry and rig data
is byte-identical to the checked-in source, including the tarantula's existing
meshopt streams. Only embedded images, their buffer offsets/lengths and the total
physical buffer size change. The source instruments keep their original assets.

| Model | Texture edge | File bytes | Source bytes |
| --- | ---: | ---: | ---: |
| `hand-512.glb` | 512 px | 1,690,168 | 3,812,180 |
| `hand-1024.glb` | 1024 px | 2,241,004 | 3,812,180 |
| `tarantula-512.glb` | 512 px | 4,437,776 | 4,730,584 |

## Attribution and licenses

`hand-512.glb` and `hand-1024.glb` are texture-resized derivatives of
[Rigged hand](https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e)
by [Elena FF](https://sketchfab.com/elenaferfor), and remain licensed under
[Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
These modified model files are **CC BY-SA 4.0**, not the repository's general
code license. Preserve this credit and the same license when distributing
modified versions. The source is [hand.glb](../gesticulating-hand/hand.glb);
[original credit and provenance](../gesticulating-hand/README.md) and
[the source license notice](../gesticulating-hand/SOURCE.LICENSE.txt) remain available.
Changes here are Lanczos texture downsampling and image re-encoding; the native
mesh, rig and Open/Close animation are unchanged.

`tarantula-512.glb` is based on
[King Baboon Tarantula](https://sketchfab.com/3d-models/king-baboon-tarantula-92c84c9dac9043ee81e87173e2ee0381)
by [Auckland Museum](https://sketchfab.com/aucklandmuseum), licensed under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
It derives from [Spider Synth's prepared phone model](../spider-synth/skins/tarantula/spider-phone.glb).
That preparation retains all animal triangles and adds Morphazoid's rig; see
[source credit and prior modifications](../spider-synth/skins/tarantula/SOURCE.LICENSE.txt)
and [provenance](../spider-synth/skins/tarantula/source-provenance.json).
The Witch derivative only downsamples the embedded color atlas from 2048 to
512 pixels and re-encodes it with the same WebP quality 90 setting.

## Reproduce and verify

From the repository root:

```sh
python3 scripts/build-witch-model-textures.py
python3 scripts/build-witch-model-textures.py --check
```

The builder uses the existing [Pillow 10.2.0 build dependency](../../scripts/spider-phone-asset-requirements.txt)
and verifies libwebp 1.3.2, libjpeg-turbo 2.1.5/JPEG API 8.0 and zlib 1.3.
It pins each source GLB's SHA-256. `--output-root <directory>` writes separate
derivatives for comparison; `--check` compares output bytes without writing.

All images use Lanczos resampling. Hand color remains JPEG (quality 92, no chroma
subsampling); its metallic/roughness and luminance/alpha specular maps remain
lossless PNG. The palette map is expanded to RGB before resampling. No scalar or
alpha map receives lossy image encoding. The spider retains its existing WebP
extension, quality 90, method 6.

Validation reparses the completed GLBs, compares all non-image metadata and
geometry/rig payloads, verifies the unchanged binary prefix, decodes every image
to check dimensions and MIME type, and checks that PNG pixels exactly match the
resampled reference. Full native geometry remains the dominant tarantula cost.

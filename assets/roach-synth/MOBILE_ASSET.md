# Roach mobile asset

`cockroach.glb` is the unchanged, attributed source rig. The derived
`cockroach-mobile.glb` retains the geometry and anatomical controls while trading
some texture/shading precision for smaller downloads and texture memory. Wing
preparation also moves out of startup. See
`SOURCE.LICENSE.txt` for the scan's CC BY 4.0 attribution; this optimization does
not change the asset license.

## Rebuild

Use supported Node 22 and Python 3 with Pillow 10.2.0 linked against libwebp
1.3.2. The texture script checks those exact versions instead of silently
changing the encoder. `scripts/roach-asset-requirements.txt` pins the Python
package; no npm or runtime package is added.

```sh
node scripts/precompute-roach-wings.mjs assets/roach-synth/cockroach.glb /tmp/roach-mobile-prepared.glb
node scripts/optimize-roach-asset.mjs --input /tmp/roach-mobile-prepared.glb --output assets/roach-synth/cockroach-mobile.glb --textures normalhalf --attributes precision16
```

The optimizer also accepts the original rig directly, to isolate compression
from wing preparation. It refuses to overwrite its input. Omitting both quality
options produces an exact geometry/lossless-texture reference. `--textures
original` isolates geometry compression; `color95` changes only color textures.
`mobile` uses Q100 normals/Q95 other textures; `compact` uses Q94 normals/Q90
other textures with head color Q95. `normalhalf` uses compact color/data settings
and half-size, losslessly encoded normal maps. All are explicit quality profiles.

## Preserved contracts

- No mesh simplification, welding, vertex/index reordering, or animation
  resampling. Positions, indices and animation values remain byte-exact.
  `precision16` rounds only the lowest eight mantissa bits of NORMAL, TANGENT
  and TEXCOORD floats; joint transforms are excluded. Every compressed stream
  decodes exactly to this declared input. Joint nodes, transforms, extras, mesh
  primitive assignments, accessor layouts, material parameters, samplers and
  animations are checked for exact JSON equality; changed shading-accessor
  min/max metadata is recomputed.
- The lossless reference preserves JPEG files and verifies pixel-exact PNG to
  WebP replacements. Selected normalhalf textures explicitly resample normals
  and compress color/data with loss. Normal directions, RGBA error and dimensions
  are measured rather than claiming that high-quality encoding is lossless.
- WebP alone reduces transfer bytes, not GPU memory. Halving the normal maps
  reduces total texture texels from 29,229,056 to 21,856,256. A simple uncompressed
  RGBA plus full-mipmap estimate falls from 155.89 to 116.57 MB; actual browser
  allocation can differ. Color and material-data dimensions are unchanged.
  Vertex counts and draw calls are retained. Load-time worker decoding and
  staged texture upload belong to the viewer; audio timing is independent.
- Meshopt uses `ATTRIBUTES` or `INDICES` with filter `NONE`. The index-sequence
  codec preserves literal triangle vertex ordering. A URI-less buffer 1
  declares the bounded decoded storage; the physical compressed data and images
  are all in the GLB's buffer 0. There are no external asset URLs.
- The output `.report.json` records tool versions, source/output SHA256,
  byte counts, every decoded buffer hash and every image's pixel hash/error.
  Reports contain no timestamps or temporary paths, so repeated builds can be
  compared byte for byte.

## Measured alternatives

All compressed candidates below use the same prepared-wing input, whose size
is 40,633,612 bytes. The unchanged original rig is 39,998,280 bytes. MB below is
decimal, not MiB. The selected asset's SHA256 and full per-image/per-accessor evidence are
retained in `cockroach-mobile.glb.report.json`.

| Texture / attribute profile | GLB MB | Texture estimate with mipmaps | Tradeoff |
| --- | ---: | ---: | --- |
| Lossless / exact | 29.92 | 155.89 MB | Exact decoded geometry and texels |
| Color95 / exact | 27.94 | 155.89 MB | Only color images change |
| Mobile / precision16 | 15.34 | 155.89 MB | Full-resolution Q100 normal maps |
| Compact / precision16 | 12.83 | 155.89 MB | Full-resolution Q94 normal maps |
| Normalhalf / precision16 | 13.59 | 116.57 MB | Half-size, losslessly encoded normals |

For the compact textures, the worst per-image RGBA PSNR is 40.77 dB for color
and 35.99 dB for material data. WebP uses chroma subsampling even at Q100: the
worst normal map's sampled mean/p95 directional errors are 5.72°/21.21° for
mobile and 5.91°/21.39° for compact. Normalhalf has greater fine-detail loss,
7.47°/26.69°, compared after bilinear upsampling to the original dimensions.
Those are worst-map statistics from up to 65,536 evenly spaced texels per map;
isolated sampled errors are larger. They are not a perceptual acceptance test.

The geometry shading precision change is much smaller: maximum normal/tangent
angular error is below 0.00070°, and maximum UV error is 0.00000763 (under 0.008
pixel on a 1024 texture). A 12-significant-bit shading experiment saved only
2.4 KB, so the more precise 16-bit option is retained. The original unused cover
streams are deliberately retained instead of repacking shared accessors for a
small extra size reduction.

The full-resolution compact build was repeated with an identical GLB SHA256
`df27f223fd508df31bfec4963d7b6032543e8aaa6072107d808810668a9e610b`.
The normalhalf candidate SHA256 is
`77fc19bf4acaff26f76d3d9a8e154faafdf314eded046298f5d11522c4113016`.
It was also rebuilt with byte-identical output. The final profile was selected
after browser inspection of phone face/top flight and desktop side views. This
does not stand in for a physical-phone performance or touch pass.
Focused automated tests verify all original position/index/animation bytes,
joint identities, bounded shading errors, self-contained buffers and the pinned
decoder. Four-view browser comparison and physical-device acceptance are
separate; neither follows automatically from these checks.

## Tool provenance and format references

The unmodified meshoptimizer 0.25 decoder is vendored with its MIT license under
`vendor/meshoptimizer/`; the build-only encoder is under
`scripts/vendor/meshoptimizer/`. Their README files pin upstream URLs and hashes.
Pillow is an offline dependency under the permissive HPND license; libwebp uses
the BSD 3-Clause license. Neither is distributed with the browser instrument.

- [meshoptimizer 0.25 API and lossless encoding](https://github.com/zeux/meshoptimizer/blob/v0.25/js/README.md)
- [EXT_meshopt_compression, including placeholder buffers](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_meshopt_compression/README.md)
- [EXT_texture_webp](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Vendor/EXT_texture_webp/README.md)
- [WebP encoding options](https://developers.google.com/speed/webp/docs/cwebp)
- [Pillow 10.2.0 license](https://github.com/python-pillow/Pillow/blob/10.2.0/LICENSE)
- [libwebp license](https://chromium.googlesource.com/webm/libwebp/+/v1.3.2/COPYING)

KTX2/Basis Universal was considered but not used: it needs a texture transcoder
and GPU-format selection absent from the current vendor set. It could reduce
GPU memory in a future measured tradeoff. Automated geometry equality and image
error characterization are separate from browser and physical-device review.

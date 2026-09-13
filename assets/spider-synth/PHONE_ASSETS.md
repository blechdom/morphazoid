# Spider phone assets

Each `spider-phone.glb` is a texture-only derivative of its neighboring
`spider-mobile.glb`. The older filename is retained for compatibility: that
original delivery still contains the full 4K color atlas, and its bytes have not
changed. The phone variant contains the same complete scanned surface and the
same authored 38-joint skin, with a 2048 × 2048 photographed atlas.

No triangle, vertex, position, normal, UV, joint, weight, inverse bind, animation
or collision landmark is removed or altered. Even the compressed Meshopt
geometry streams are copied byte for byte. Meshes, material parameters,
samplers, skin/joint transforms, accessor layouts and scene metadata are
unchanged. Both variants therefore use the same existing `rig-manifest.json`.
Only the embedded atlas, its descriptive name and physical GLB offsets change.

## Size and memory

| Specimen | Full 4K delivery | Phone 2K delivery | Transfer reduction |
| --- | ---: | ---: | ---: |
| Argiope | 5,488,852 bytes | 3,885,404 bytes | 29.2% |
| Golden orb-weaver | 4,982,988 bytes | 3,556,500 bytes | 28.6% |
| Devil spider | 6,587,364 bytes | 4,771,936 bytes | 27.6% |
| King Baboon tarantula | 5,246,060 bytes | 4,730,584 bytes | 9.8% |
| Huntsman | 5,972,996 bytes | 4,574,316 bytes | 23.4% |
| Fishing spider | 6,213,220 bytes | 4,577,612 bytes | 26.3% |

The tarantula's source atlas already compresses particularly well. Most of its
file is geometry, so retaining those streams limits its transfer reduction.

Every decoded atlas falls from 67,108,864 to 16,777,216 bytes of RGBA storage
(64 to 16 MiB), a 75% reduction. With a complete uncompressed RGBA mip chain,
the estimate falls from 89,478,484 to 22,369,620 bytes (about 85.3 to 21.3 MiB).
These are texture-storage estimates; actual browser/driver allocation and
transient decode/upload copies can differ. Geometry allocation, triangle count
and draw calls remain unchanged. One selected skin is loaded at a time.

The texture is resized with Lanczos and encoded as WebP quality 90, method 6.
Halving each dimension loses the finest photographed detail, especially in a
close face view; 2K retains four times the texels of a 1K atlas. No AI image,
invented hairs, recoloring, sharpening or resculpting is used. The current
WebP/Meshopt extensions and vendored decoder remain sufficient; no new texture
transcoder or runtime dependency is introduced.

## Rebuild

From the repository root, use Python 3 with Pillow 10.2.0 and libwebp 1.3.2.
The script checks both exact versions. The build-only Python package is pinned
in `scripts/spider-phone-asset-requirements.txt`; existing committed full-detail
GLBs are the inputs, so rebuilding does not require downloading scan archives.

```sh
python3 scripts/spider-build-phone-assets.py all
node --test tests/spider-synth-phone-assets.test.mjs
```

To rebuild a single animal, replace `all` with `argiope`, `golden`, `devil`,
`tarantula`, `huntsman` or `fishing`. Use `--output-root /tmp/spider-phone-check`
to compare a second build without replacing delivery files. All six GLBs and
their reports were rebuilt with byte-identical results using that option.

Outputs are `assets/spider-synth/spider-phone.glb` for Argiope and
`assets/spider-synth/skins/<id>/spider-phone.glb` for the other five scans. Each
neighboring `.glb.report.json` records the original and derivative SHA-256,
transfer/texture sizes, exact retained payload hashes, tool versions and image
encoding measurements. Reports exclude timestamps and temporary paths.

Focused tests independently decode all non-image buffers and compare them to
the original, including positions, triangle indices, UVs, weights, joint
indices and inverse binds. They check the actual WebP dimensions, unchanged
rig/scene metadata, bounded self-contained buffers, source hashes and measured
texture/transfer savings. RGBA encoding PSNR is 41.06–45.06 dB against the
Lanczos-resized reference; this measures the additional WebP encoding error,
not the detail lost in resizing and not visual acceptance. Browser rendering
and physical-phone loading/performance are separate checks.

## Attribution

Licenses and source credits are unchanged. The Argiope and four ffish.asia
scans are CC0; see [the original scan documentation](ASSET.md),
[additional specimen documentation](skins/ASSET.md) and each neighboring
`SOURCE.LICENSE.txt` / `source-provenance.json`.

The King Baboon tarantula is derived from **King Baboon Tarantula** by
**Auckland Museum**, licensed **CC BY 4.0**, as attributed in
[its license notice](skins/tarantula/SOURCE.LICENSE.txt). This additional
derivative resizes and re-encodes the photographed color atlas. It retains
the previously documented coordinate preparation, authored rig and all source
surface limitations.

# Additional real spider specimens

Each specimen is a photographed, three-dimensional surface scan, independently
rigged for the instrument. These are five different anatomical meshes, not color
swaps on the original Argiope. The browser loads one selected GLB at a time.

| Skin | Species recorded by publisher | Animal triangles retained | Compressed GLB | License |
| --- | --- | ---: | ---: | --- |
| [Golden orb-weaver](golden/specimen.webp) | *Nephila pilipes* | 116,379 | 4,982,988 bytes | CC0 |
| [Devil spider](devil/specimen.webp) | *Araneus ventricosus* | 161,171 | 6,587,364 bytes | CC0 |
| [King Baboon tarantula](tarantula/specimen.webp) | *Pelinobius muticus* | 239,276 | 5,246,060 bytes | CC BY 4.0 |
| [Huntsman](huntsman/specimen.webp) | *Heteropoda venatoria* | 171,906 | 5,972,996 bytes | CC0 |
| [Fishing spider](fishing/specimen.webp) | *Dolomedes cf. sulfureus*, identification uncertain | 147,012 | 6,213,220 bytes | CC0 |

The four CC0 specimens were published by Yuichi Kano / ffish.asia / floraZia.com.
The tarantula is based on [King Baboon Tarantula](https://sketchfab.com/3d-models/king-baboon-tarantula-92c84c9dac9043ee81e87173e2ee0381)
by [Auckland Museum](https://sketchfab.com/aucklandmuseum), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Morphazoid's changes
are listed in each specimen's `SOURCE.LICENSE.txt`. Each neighboring
`source-provenance.json` records the original publication, archive URL, license,
creator, digest and measured counts. The archive is not a runtime dependency.

The supplied meshes contain no original rig or animations. Each has a new
38-joint skin: cephalothorax, abdomen, paired pedipalps and chelicerae, and four
broad links per walking leg. Individually reviewed centerlines follow each
specimen's actual legs; both its natural asymmetry and its body proportions are
preserved. The long front appendages of the tarantula are pedipalps, rather than
an invented fifth pair of walking legs. Four control links group the smaller
anatomical leg segments; they are not a claim that a spider has four leg joints.
Small mouth-region boundaries and the continuous skin are approximations.

`rig-manifest.json` contains the 38 stable joint IDs/pivots, eight independently
measured five-point chains, four lengths and cross-section radii per chain,
measured body ellipsoids, and a neutral body height that clears the body
underside. Coordinates are +Y up, +Z forward, +X right in web-radius units. Each
new scan is uniformly scaled to a longest surface span of 0.9 units. The scale
is uniform, so a tarantula's bulky body is not stretched into an orb-weaver.

Every animal triangle is retained. The separate calibration object is removed
from the four ffish.asia archives. Attribute-identical vertices are welded;
photographed UV seams remain. Position rounding has a maximum error of
0.0000005 per component in instrument units. Normals use normalized signed
16-bit components, UVs use normalized unsigned 16-bit components (at most
0.032 texel error at 4K), and weights use normalized unsigned 8-bit components.
The original 4096 × 4096 color atlas is re-encoded to WebP quality 90. Meshopt
then packs these prepared attributes losslessly and verifies their decoded
bytes. The runtime GLB requires `EXT_texture_webp`, `EXT_meshopt_compression`
and `KHR_mesh_quantization`, supported by the instrument's vendored loader.

The largest delivery, Devil spider, is 6.59 MB decimal / 6.28 MiB; its additional
spines and photographed texture are retained. All five are below a 7 MiB
per-specimen ceiling. One decoded 4K RGBA texture costs about 64 MiB before
mipmaps/driver overhead; inactive skins must be disposed rather than cached as
live GPU scenes. The previews are actual 1100 × 900 neutral renders, encoded as
WebP quality 90. They are not AI-generated specimens.

## Rebuilding and verification

Download the original archive named in a specimen's provenance file, verify its
SHA-256, and extract its `scene.gltf`, `scene.bin`, texture folder and license
together. Run from the repository root, using Python with NumPy, SciPy and
Pillow installed:

```sh
python3 scripts/spider-build-skins.py golden /path/to/extracted/gltf /tmp/spider-prepared/golden/spider-rigged.glb
node scripts/spider-pack-asset.mjs /tmp/spider-prepared/golden/spider-rigged.glb assets/spider-synth/skins/golden/spider-mobile.glb
cp /tmp/spider-prepared/golden/rig-manifest.json assets/spider-synth/skins/golden/rig-manifest.json
node --test tests/spider-synth-skins-asset.test.mjs
```

Substitute `devil`, `tarantula`, `huntsman` or `fishing` for another specimen.
Reviewed calibration is in `scripts/spider-skin-landmarks/`. The preparation
script writes an intermediate `prepared.npz` for offline inspection, not for
publishing. Source archives and Python are not used by the running instrument.
The published preparation used NumPy 2.5.3, SciPy 1.18.1 and Pillow 12.3.0;
encoder versions can change texture bytes, so the GLB report records actual
input and output hashes.

The asset tests decode every packed attribute and check normalized weights,
finite positions/normals, preserved triangles, all 38 joints controlling real
vertices, neutral inverse binds, actual leg endpoint placement, independent
segment lengths, provenance and body-plane clearance. Chromium rendered all
five final GLBs with zero page/console errors. Forty-five inspected captures
cover neutral, top, side, face, bottom and four representative joint gestures.
This establishes geometry/loader behavior; physical-phone GPU cost and live
performance feel still require device testing.

## Limits

The museum tarantula has visibly softer surface and facial detail than the four
ffish.asia scans. Its overlapping, curled preserved legs remain in the source
surface, with separately authored control chains. Rigging does not invent hair,
eyes, missing surface detail, or independently scanned mouth pieces. The
collision ellipsoids/capsules approximate the solid cuticle and do not model
every microscopic hair or the full photographed mesh.

The tarantula, huntsman and fishing spider are hunting-spider skins in an
artistic web performance. They must not be described as natural Argiope-style
orb-web builders. The biological qualifications and original research sources
are in [the scan research](../../../docs/spider-synth-scan-candidates.md).
No real black-widow scan was verified or added in this release.

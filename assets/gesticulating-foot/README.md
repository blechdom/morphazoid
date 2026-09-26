# CC0 articulated right foot

This asset crops the official MakeHuman base mesh at the right ankle and retains the default skeleton's real five toe chains. The big toe has two joints (`mcp`, `dip`); the other toes each have three (`mcp`, `pip`, `dip`). `foot_R` is the ankle hinge. Two stationary calf anchors preserve the original ankle blend weights, making 17 skin joints in total: 14 toe joints, one foot and two calf anchors.

- `foot.glb`: 1,678,952 bytes; 34,352 triangles; 17,830 exported vertices (17,178 before UV/material splits); three embedded texture maps.
- `rig-report.json`: every bone's source name, parent, rest transform, bend/spread axes, heads/tails, toe endpoints, mesh bounds and conversion evidence.
- `source-metadata.json`: pinned upstream model commit, URLs, SHA-256 checksums and the original asset-pack record confirming the skin's CC0 license.
- `SOURCE.LICENSE.txt`: attribution and MakeHuman's full CC0 asset license text.
- [`build-foot.py`](../../scripts/gesticulating-hand/build-foot.py): portable reproducible conversion, requiring Python 3 and Pillow. No Blender or runtime subdivision is required.

## Sources and licensing

Mesh, rig and skin weights come directly from [MakeHuman at a8bc2d54ff0ac92e78ff71431b1023eda42bf482](https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data). MakeHuman's [license sections C and D](https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md) explicitly release bundled graphical assets and output under CC0. No application code is included in the GLB.

The Aksel skin diffuse, normal and specular maps are by **Mindfront**, distributed in the [official MakeHuman skins02 CC0 pack](https://static.makehumancommunity.org/assets/assetpacks/skins02.html). The pack's own `mindfront_aksel_skin` record explicitly states `license: CC0`; that record is retained in source metadata. The diffuse texture derives from an original MakeHuman skin; the normal/specular maps were supplied by Mindfront. Attribution is retained for provenance even though CC0 does not require it.

## Rebuild

From the repository root, choose temporary source-cache and output directories:

```sh
python3 scripts/gesticulating-hand/build-foot.py --download --source-dir /tmp/gesticules-foot-source --out-dir /tmp/gesticules-foot-rebuilt
```

The first run obtains three pinned MakeHuman source files and the official 76,112,708-byte skin pack, validates SHA-256 hashes, then extracts only the three relevant textures. Reusing the cached sources requires no network:

```sh
python3 scripts/gesticulating-hand/build-foot.py --source-dir /tmp/gesticules-foot-source --out-dir /tmp/gesticules-foot-rebuilt
```

A rebuild from the inspected source cache produced byte-identical GLB output:
`26b982805339623a0fa7e7c64e15839278e8771dc0ed9a30eccb56663e794272`.

## Conversion and rig convention

The source right-foot body faces whose vertices are below Y = -7.15 and on X < -1.25 yield 1,080 base vertices and 1,068 quads. The single ankle boundary is flattened to the crop plane and closed with an n-gon. Two offline Catmull–Clark steps interpolate both geometry and source skin weights; face-varying bilinear UVs preserve texture seams. Smooth area-weighted normals are shared across UV seams. The closed ankle has a separate plain skin material.

Coordinates retain MakeHuman decimeters: Y up and +Z toward the toe tips. All exported bone rest rotations are identity. Joint heads define their translations; the report's rest-local bend axes account for each toe's slight lateral direction, and spread uses local +Y. The big toe's absent middle joint is explicitly `null`; do not invent or double-drive it. The ankle maps flex to +X, side to +Z, and twist to +Y. Bone names have already been sanitized for Three (`toe2_3_R`, etc.).

Original source weights sum to approximately one because the upstream file rounds to three decimal places. They are interpolated and normalized for export. One 0.002 weight on source vertex 6535 incorrectly points to the left second toe; it is mirrored to the right counterpart. The source has 37 crop vertices with more than four influences. For Three's standard four-weight skinning shader, the largest four interpolated influences are kept and renormalized. 3,644 subdivided geometric vertices require some pruning; the largest discarded mass is 0.103679. This is recorded explicitly rather than claiming untouched source weights.

The original 2048×2048 skin maps are cropped without resampling to `[44,1697,396,2033]` (352×336 pixels). UVs are remapped affinely to this exact crop, including the OBJ-to-glTF vertical convention. The original normal pixels are preserved and used at strength 0.38. Specular intensity is converted to nonmetal roughness (`0.84 - 0.46 * intensity`) to retain nail/skin contrast.

## Verification and limits

Chromium loaded the GLB with the repository's Three GLTFLoader with no page errors. Both skinned primitives share the expected 17-joint rig. All 14 toe joints individually displaced a strongly weighted vertex at 30 degrees, with finite results. Open toes, simultaneously curled toes and ankle flexion were rendered and inspected. The GLB rebuild was byte-identical.

The foot has distinct toes, recognizable toe joints, nail patches and skin/crease detail at normal instrument size. Its original foot texture region is only 352×336 pixels: close zooms are softer than the separately scanned hand's full-resolution texture. The mesh is an artist-authored human base, not a clinical biomechanical model or a tendon/contact simulation. Extreme toe combinations can intersect or pinch the interpolated skin. The ankle is deliberately capped where the limb is cropped. The retained calf anchors should normally stay at rest while `foot_R` controls ankle movement.

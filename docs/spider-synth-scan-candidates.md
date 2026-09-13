# Additional scanned spiders: verified candidate report

Checked 2026-09-12. Candidate research only; these specimens are not yet selectable in the instrument.

## Recommendation

Start with the **giant golden orb-weaver** and **Araneus ventricosus**. Both are CC0 specimen scans from the same creator as the current Argiope, have strong visible detail, and fit an orb-web instrument. Keep the museum tarantula as a third, deliberately different option, with a silk-retreat presentation and a quality caveat.

Five public glTF ZIP archives have actually downloaded successfully. Original Sketchfab pages/API and each archive license agree; full archive hashes are recorded below. Current API reports `isDownloadable: true`, `isProtected: false` for all five. The public archive is a Creative Commons redistribution mirror, also used for the current Argiope asset. No paid, authenticated, or protected downloads were used.

The creator describes the specimen photogrammetry method in [Kano 2022, Bio-photogrammetry](https://riojournal.com/article/86985/). These are physical-specimen surface captures. The Auckland Museum model explicitly carries the `3d-scan` tag and identifies its handling collection. Individual ffish.asia pages give species/license, but do not specify a separate scanner/camera method for each specimen.

## Ranked candidates

### 1. Giant golden orb-weaver — Nephila pilipes

[Original asset](https://sketchfab.com/3d-models/cc0-giant-golden-orb-weaver-88711ad10ac04174a56f6e9d6f8cb474) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/88/88711ad10ac04174a56f6e9d6f8cb474.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **12,569,975 bytes (12.57 MB decimal)**. Listed geometry: 116,391 triangles. Every specimen has one 4096 × 4096 color texture.
- Preview inspection: Best first addition. Long dark legs and gold-patterned elongated abdomen create a striking contrast to the existing Argiope. The preview clearly separates all eight leg silhouettes. Thin dried-specimen limbs have some scan lumpiness; joint landmarks and new skinning are required.
- SHA-256: `040d8b9b3e30b8f3efcc45db75c1e4a470bdc743679507c29048ef80ad7ff845`.

### 2. Devil spider / Araneus — Araneus ventricosus

[Original asset](https://sketchfab.com/3d-models/cc0-devil-spider-araneus-ventricosu-cbe47106f52f41adbc0b928d8b4d8a1e) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/cb/cbe47106f52f41adbc0b928d8b4d8a1e.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **15,470,386 bytes (15.47 MB decimal)**. Listed geometry: 161,202 triangles. Every specimen has one 4096 × 4096 color texture.
- Preview inspection: Best second addition. A large round, dark leaf-patterned abdomen and stout spiny legs produce a substantially different silhouette. Legs are spread clearly enough for landmarking. Mouth appendages are not supplied as independent pieces.
- SHA-256: `cb247ed93e614f1dae92277cc0a5080d0450fbbfa47789090be8819fe204968e`.

### 3. King Baboon Tarantula — Pelinobius muticus

[Original asset](https://sketchfab.com/3d-models/king-baboon-tarantula-92c84c9dac9043ee81e87173e2ee0381) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/92/92c84c9dac9043ee81e87173e2ee0381.zip)

- Creator: Auckland Museum. License: [CC Attribution](http://creativecommons.org/licenses/by/4.0/).
- Measured archive: **10,676,413 bytes (10.68 MB decimal)**. Listed geometry: 239,276 triangles. Every specimen has one 4096 × 4096 color texture.
- Preview inspection: A useful third, conditional choice. The Auckland Museum handling-collection specimen is a documented real 3D scan. Thick orange-brown legs and body are distinctive, but the preview is considerably softer than the two orb-weavers: fine hair, eyes, and mouth detail are weak, and overlapping bent legs complicate rigging. This is not the best choice if equally crisp facial detail is essential.
- SHA-256: `ac39f947ce78c38914cf028efb300f8a76c300365c8d1e9f2b92d5bc4cedf74d`.

### 4. Huntsman spider — Heteropoda venatoria

[Original asset](https://sketchfab.com/3d-models/cc0-huntsman-spider-h-venatoria-d7c041dddbbe49d38b33b60db6a6b1a7) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/d7/d7c041dddbbe49d38b33b60db6a6b1a7.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **14,123,227 bytes (14.12 MB decimal)**. Listed geometry: 171,934 triangles. Every specimen has one 4096 × 4096 color texture.
- Preview inspection: Good detail and a very wide, sideways leg stance. Brown patterning and broad stance are recognizable; hip axes and leg limits would need careful reauthoring. Better for a wall/ground or explicitly artistic performance than presented as an orb-web builder.
- SHA-256: `a2dccf6670b00077126fa3a0062d073e76769786e2bb370318d73148d9c2478c`.

### 5. Fishing spider — Dolomedes sulfureus (creator identification uncertain)

[Original asset](https://sketchfab.com/3d-models/cc0-fishing-spider-d-sulfureus-17b41b78fc2545ea839ba67952a60953) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/17/17b41b78fc2545ea839ba67952a60953.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **14,207,773 bytes (14.21 MB decimal)**. Listed geometry: 147,024 triangles. Every specimen has one 4096 × 4096 color texture.
- Preview inspection: Good specimen with pale longitudinal stripes and clearly splayed legs. The title contains a question mark in Japanese, so keep its species identification provisional. Visually less distinct than the first three; useful as an additional hunting-spider variant.
- SHA-256: `a2ea2f1e2f07567bacef216bcaf4e63e02e1b1a02a53bb1d28dbdaf24a54af5e`.

## Animation and mobile feasibility

All five downloaded files contain **zero skins and zero animations**. Their two/three spider mesh chunks are mostly approximately 65k-vertex index partitions, not separately authored anatomical body parts. None is a drop-in rigged skin. Each needs its own body/leg landmarks, new skin weights, authored small-appendage pivots, neutral stance, and matching segment lengths. Existing motion controls can be reused after per-specimen calibration; directly reusing the current Argiope bone positions would distort them.

The four ffish.asia archives include a separate color-calibration cube, which should be removed. Preserve the actual spider texture and geometry, then weld compatible vertices, compress geometry, and re-encode the inefficient color image to WebP. Color textures alone occupy 8.45–9.98 MB in these archives. The museum texture is a 5.76 MB PNG. That leaves a plausible path toward a **roughly 3–6 MB mobile asset**, but this is a target/engineering estimate: no optimized GLB or mobile loading benchmark has been produced for these candidates. Tarantula hair remains limited by the source scan, regardless of triangle count.

Validation before integration: inspect underside and mouth; verify all eight leg chains and avoid fused-neighbor weighting; test feet against shared web contacts; compare neutral/face/side screenshots; measure actual final bytes and phone-emulated load/render cost.

## Tarantulas and webs

Tarantulas use silk for homes, molting mats, and handling food. Many occupy silk-lined ground burrows, while arboreal species use webbed retreats; they generally hunt by ambush or pursuit rather than spinning orb-shaped prey-capture webs. [San Diego Zoo](https://animals.sandiegozoo.org/animals/tarantula)

Adult female Australian tarantulas occupy web-lined burrows; younger animals and males may use lighter silk retreats under rocks or logs, sometimes with a film of silk around the entrance. This is evidence for those tarantulas, not a claim that every species has the same retreat. [Australian Museum](https://australian.museum/learn/animals/spiders/australian-tarantulas/)

For this particular King Baboon specimen, the museum identifies a burrowing East African species with thick digging hind legs. An appropriate instrument scene would therefore be a retreat entrance and a loose silk sensing surface, or an explicitly artistic web. Do not present a canonical Argiope capture orb as its natural construction. Tarantula trip-thread layouts are species dependent; the well-documented trip-lines of Australian funnel-web spiders must not be generalized to every tarantula.

A sonic possibility is especially relevant here: the San Diego Zoo describes the King Baboon spider producing a defensive hiss by rubbing mouthpart structures. The Australian Museum describes comparable stridulation in Australian tarantulas. This supports an authored friction/rasp mechanism; it is not a recording already acquired.

Huntsman legs are naturally laterigrade, with twisted joints spreading forward and sideways, so their distinct stance needs a separate rig calibration. [Australian Museum](https://australian.museum/learn/animals/spiders/huntsman-spiders/)

## Black widow and jumping-spider search outcome

No suitable freely redistributable **real whole-body scan** was verified in this bounded search. This is not evidence that none exists. Black-widow results found included explicitly authored Cinema 4D/hair models and commercial animated assets; jumping-spider results likewise included Blender-authored or commercial models. Those should not be described as scans.

The [Arachnophilia black-widow project](https://arachnophilia.net/scanning-the-web/) documents scanning a **web**, not a downloadable detailed spider-body skin. It is relevant to web structure but does not solve the asset request.

## Download and integration status

The five original archives and inspection metadata were downloaded to the local
research directory `/tmp/spider-v3-skins`. They are not runtime dependencies or
committed site assets. The links and hashes above allow the same source files to
be retrieved for a later rigging pass.

No new skins were added to the instrument, and no black-widow or jumping-spider
availability has been promised.

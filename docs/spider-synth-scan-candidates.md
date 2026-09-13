# Additional scanned spiders: sources and implementation

Updated 2026-09-12. The five sources researched below now have independently
calibrated, selectable rigs in version 4. Together with the original Argiope,
there are six real specimens. See the [QA record](spider-synth-qa.md) for
integration checks and measurement limits.

## Implemented specimens

The **giant golden orb-weaver** and **Araneus ventricosus** provide particularly
clear surface patterns and contrasting orb-weaver silhouettes. The museum
tarantula adds a bulky, orange-brown form, with visibly softer facial and hair
detail. Huntsman and fishing spiders add broad hunting-spider stances. These
are different scanned meshes, each with its own weighted rig, not texture swaps.

| Selectable skin | Retained animal triangles | Delivered GLB bytes | License |
| --- | ---: | ---: | --- |
| Golden orb-weaver | 116,379 | 4,982,988 | CC0 |
| Devil spider | 161,171 | 6,587,364 | CC0 |
| King Baboon tarantula | 239,276 | 5,246,060 | CC BY 4.0 |
| Huntsman | 171,906 | 5,972,996 | CC0 |
| Fishing spider | 147,012 | 6,213,220 | CC0 |

The browser fetches only the selected model, about 5–6.6 MB, independently of
Audio. Changing skin preserves the players, held pose, sound, web and phase;
a failed load leaves the current specimen in place. Inactive GPU scenes are
disposed. The [asset record](../assets/spider-synth/skins/ASSET.md) contains
actual previews, per-specimen provenance, rig manifests and rebuild steps.

All five public glTF ZIP archives downloaded successfully during the source
check. Original Sketchfab pages/API and each archive license agreed; full
archive hashes are recorded below. At verification the API reported
`isDownloadable: true`, `isProtected: false` for all five. The public archive is
a Creative Commons redistribution mirror, also used for the original Argiope
asset. No paid, authenticated or protected downloads were used.

The creator describes the specimen photogrammetry method in [Kano 2022, Bio-photogrammetry](https://riojournal.com/article/86985/). These are physical-specimen surface captures. The Auckland Museum model explicitly carries the `3d-scan` tag and identifies its handling collection. Individual ffish.asia pages give species/license, but do not specify a separate scanner/camera method for each specimen.

## Verified source archives and visual limits

### 1. Giant golden orb-weaver — Nephila pilipes

[Original asset](https://sketchfab.com/3d-models/cc0-giant-golden-orb-weaver-88711ad10ac04174a56f6e9d6f8cb474) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/88/88711ad10ac04174a56f6e9d6f8cb474.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **12,569,975 bytes (12.57 MB decimal)**. Listed geometry: 116,391 triangles. Every specimen has one 4096 × 4096 color texture.
- Source inspection: Long dark legs and a gold-patterned elongated abdomen contrast with the original Argiope. The surface clearly separates all eight leg silhouettes. Thin dried-specimen limbs retain some scan lumpiness. This version adds independently reviewed joint landmarks and skinning.
- SHA-256: `040d8b9b3e30b8f3efcc45db75c1e4a470bdc743679507c29048ef80ad7ff845`.

### 2. Devil spider / Araneus — Araneus ventricosus

[Original asset](https://sketchfab.com/3d-models/cc0-devil-spider-araneus-ventricosu-cbe47106f52f41adbc0b928d8b4d8a1e) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/cb/cbe47106f52f41adbc0b928d8b4d8a1e.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **15,470,386 bytes (15.47 MB decimal)**. Listed geometry: 161,202 triangles. Every specimen has one 4096 × 4096 color texture.
- Source inspection: A large round, dark leaf-patterned abdomen and stout spiny legs produce a substantially different silhouette. Legs are clearly spread for the authored calibration. Mouth appendages were not supplied as independent pieces; their small pivots remain approximations.
- SHA-256: `cb247ed93e614f1dae92277cc0a5080d0450fbbfa47789090be8819fe204968e`.

### 3. King Baboon Tarantula — Pelinobius muticus

[Original asset](https://sketchfab.com/3d-models/king-baboon-tarantula-92c84c9dac9043ee81e87173e2ee0381) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/92/92c84c9dac9043ee81e87173e2ee0381.zip)

- Creator: Auckland Museum. License: [CC Attribution](http://creativecommons.org/licenses/by/4.0/).
- Measured archive: **10,676,413 bytes (10.68 MB decimal)**. Listed geometry: 239,276 triangles. Every specimen has one 4096 × 4096 color texture.
- Source inspection: The Auckland Museum handling-collection specimen is a documented real 3D scan. Thick orange-brown legs and body are distinctive, but fine hair, eyes and mouth detail are softer than the orb-weavers. Its separately calibrated rig preserves the curled specimen surface and original overlaps. The long front appendages are pedipalps, not a fifth pair of walking legs. Rigging does not recover missing facial detail.
- SHA-256: `ac39f947ce78c38914cf028efb300f8a76c300365c8d1e9f2b92d5bc4cedf74d`.

### 4. Huntsman spider — Heteropoda venatoria

[Original asset](https://sketchfab.com/3d-models/cc0-huntsman-spider-h-venatoria-d7c041dddbbe49d38b33b60db6a6b1a7) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/d7/d7c041dddbbe49d38b33b60db6a6b1a7.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **14,123,227 bytes (14.12 MB decimal)**. Listed geometry: 171,934 triangles. Every specimen has one 4096 × 4096 color texture.
- Source inspection: Brown patterning and a very wide, sideways leg stance are recognizable. Its rig uses separately measured hip pivots and leg chains. The current web performance is explicitly artistic; this spider is not presented as a natural orb-web builder.
- SHA-256: `a2dccf6670b00077126fa3a0062d073e76769786e2bb370318d73148d9c2478c`.

### 5. Fishing spider — Dolomedes sulfureus (creator identification uncertain)

[Original asset](https://sketchfab.com/3d-models/cc0-fishing-spider-d-sulfureus-17b41b78fc2545ea839ba67952a60953) · [Downloaded CC archive](https://mirror.traines.eu/sketchfab-backup/17/17b41b78fc2545ea839ba67952a60953.zip)

- Creator: ffish.asia / floraZia.com. License: [CC0 Public Domain](http://creativecommons.org/publicdomain/zero/1.0/).
- Measured archive: **14,207,773 bytes (14.21 MB decimal)**. Listed geometry: 147,024 triangles. Every specimen has one 4096 × 4096 color texture.
- Source inspection: Pale longitudinal stripes and clearly splayed legs remain visible in the rigged derivative. The publisher's title contains a question mark in Japanese, so the instrument retains the provisional identification *Dolomedes cf. sulfureus*. Its web performance is artistic.
- SHA-256: `a2ea2f1e2f07567bacef216bcaf4e63e02e1b1a02a53bb1d28dbdaf24a54af5e`.

## Rigging and mobile delivery

The original downloaded files contained **zero skins and zero animations**.
Their two or three spider mesh chunks were primarily vertex-index partitions,
not separate anatomical body parts. This version adds a new 38-joint weighted
skin to every specimen: cephalothorax, abdomen, paired palps and cheliceral
regions, and four broad control links along each of eight walking legs. These
links group smaller anatomical segments; a four-link control chain is not a
claim that a spider has only four anatomical joints.

Each model has its own reviewed landmarks, five-point leg centerlines, segment
lengths, cross-section radii and neutral body height. Its proportions and
natural asymmetry are preserved through uniform scaling. Shared motion and
MIDI controls address stable joint IDs while foot planning uses the selected
specimen's measured reach. Small face-region boundaries approximate a
continuous surface; the source does not supply separate reconstructions of
every mouthpart.

The four ffish.asia calibration cubes are removed. All animal triangles and
photographed UV seams are retained. Compatible vertices are welded; positions,
normals, UVs and weights use bounded attribute packing; Meshopt compresses the
prepared geometry and verifies its decoded bytes. Each original 4K color atlas
is re-encoded to WebP quality 90. Actual final downloads are listed above,
replacing the earlier size estimate. A decoded 4K RGBA atlas still uses about
64 MiB before mipmaps and driver overhead, so the runtime disposes inactive
models rather than retaining every skin as a live GPU scene.

Per-specimen ellipsoids and leg capsules add body-boundary and web-clearance
constraints. They prevent new or deeper overlap at modeled attachments while
respecting supported foot targets. This remains an approximation under
integrated validation: it is not an exact mesh, hair or elastic-body solver,
and does not remove overlap already present in curled preserved specimens.
Final performance checks belong in the [QA record](spider-synth-qa.md);
physical-phone rendering and live performance feel require device testing.

## Tarantulas and webs

Tarantulas use silk for homes, molting mats, and handling food. Many occupy silk-lined ground burrows, while arboreal species use webbed retreats; they generally hunt by ambush or pursuit rather than spinning orb-shaped prey-capture webs. [San Diego Zoo](https://animals.sandiegozoo.org/animals/tarantula)

Adult female Australian tarantulas occupy web-lined burrows; younger animals and males may use lighter silk retreats under rocks or logs, sometimes with a film of silk around the entrance. This is evidence for those tarantulas, not a claim that every species has the same retreat. [Australian Museum](https://australian.museum/learn/animals/spiders/australian-tarantulas/)

For this particular King Baboon specimen, the museum identifies a burrowing East African species with thick digging hind legs. A retreat entrance and loose silk sensing surface would reflect that ecology. The implemented scene instead keeps the musician's chosen web and is explicitly artistic; a canonical Argiope capture orb is not presented as this species' natural construction. Tarantula trip-thread layouts are species dependent; the well-documented trip-lines of Australian funnel-web spiders must not be generalized to every tarantula.

A sonic possibility is especially relevant here: the San Diego Zoo describes the King Baboon spider producing a defensive hiss by rubbing mouthpart structures. The Australian Museum describes comparable stridulation in Australian tarantulas. This supports an authored friction/rasp mechanism. No tarantula recording was acquired; the three newly bundled recordings are identified separately as actual *Maratus volans* courtship substrate vibrations. Their [credits and license](../assets/audio/spider-synth/README.md) do not imply that the tarantula skin produced them.

Huntsman legs are naturally laterigrade, with twisted joints spreading forward and sideways, so the implemented skin has its own stance and rig calibration. [Australian Museum](https://australian.museum/learn/animals/spiders/huntsman-spiders/)

## Black widow and jumping-spider search outcome

No suitable freely redistributable **real whole-body black-widow or jumping-spider scan** was verified in this bounded search. This is not evidence that none exists. Black-widow results found included explicitly authored Cinema 4D/hair models and commercial animated assets; jumping-spider results likewise included Blender-authored or commercial models. Those should not be described as scans.

The [Arachnophilia black-widow project](https://arachnophilia.net/scanning-the-web/) documents scanning a **web**, not a downloadable detailed spider-body skin. It is relevant to web structure but does not solve the asset request.

## Download and integration status

The five original archives were downloaded to the local research directory
`/tmp/spider-v3-skins`. They remain build inputs, not runtime dependencies.
The independently rigged, compressed GLBs and their provenance are now bundled
under `assets/spider-synth/skins/`, with per-specimen `SOURCE.LICENSE.txt`,
`source-provenance.json` and `rig-manifest.json`. Original archive counts above
include calibration geometry; the delivered animal-only counts are in the
implementation table.

The instrument now implements six selectable real scans including the original
Argiope. No black-widow or jumping-spider body scan was verified or added. The
[request audit](spider-synth-request-audit.md) separates current implementation
from source limitations and final integrated validation.

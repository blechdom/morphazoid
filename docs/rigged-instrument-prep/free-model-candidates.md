# Free realistic-model candidates for Rig Lab

Research checked 2026-10-16, tentacled/kitchen leads checked 2026-10-17;
licensed downloads inspected 2026-10-18. The [shared Rig Lab](../../src/pages/rig-lab.html)
now **loads the approved downloads** for both ants, the textured mosquito,
Peacock Moth, the octopus candidate, pan, cake stack, spatula and butter.
Original GLB bytes and creators
are recorded in [model attribution](../../assets/rig-lab/SOURCE.LICENSE.txt).
The Diamond and David Hall downloads remain attributed **references**, but
the foam and lattice lab stages now render the actual 3D solver cells and
indexed polyhedra with Three.js. Their live topology changes when users add
cells/vertices or select a different boundary/solid; it is **not** the source
GLBs deforming. David Hall's separate 13-bone derivative remains available
for download but is not drawn in the current stage. The
downloaded "Iridescent Mosquito" is a different,
unrigged, very heavy model; it is **not** the approved textured mosquito and
is deliberately not bundled. The approved adarshktk source had no skeleton
either; its distributed derivative has a new 21-bone skin and resized maps.
The two conversion scripts (`scripts/rig-lab/rig_mosquito.py` and
`scripts/rig-lab/rig_lattice.py`) and attribution file document these edits.
No human photorealism or tactile judgment is
claimed. Source ZIPs remain in the user's Downloads directory, not the site.

**User selections:** keep *both ants*, the Voronoi-cell and icosahedra
references, the *textured mosquito* and *animated peacock moth*, and the
pancake/pan leads. The two jellyfish options were **rejected**. The imported
octopus has six long skinned chains and shorter branches, not eight fully
jointed arms. The eight independent musical controls remain, but a better
eight-arm asset is needed before promising one-to-one real arm manipulation.
Cell-count, subdivision, solid shape and the six-cake stack remain separate
instrument state. Foam/lattice shape switches have been restored only for
the new generated surfaces, not by renaming downloaded geometry.

The linked listings currently declare
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit each
named creator, link the exact model and license, mark mesh/texture/rig edits,
and keep the **asset** under its own license rather than silently relicensing
it as project MIT code. Do not assume that an external Blend/FBX download
linked in a description has the same terms as the Sketchfab download.
[Poly Haven](https://polyhaven.com/license) provides CC0 PBR materials, but
its catalogue did not yield a matching rigged animal, pancake or deformable
cell/lattice. “Free Standard,” noncommercial, no-derivatives, AI-generated,
and franchise-ripped listings were not selected.

| Rig | Candidate, creator, declared license | What is actually advertised | Integration caveat |
| --- | --- | --- | --- |
| Ant Farm | [(муравей) Ant Rig VFX](https://sketchfab.com/3d-models/ant-rig-vfx-ea4047922b5644fdb48b5ac910974241), rayray, CC BY 4.0 | Rigging, one animation, 2K textures; ~6,464 faces | First textured-ant trial; verify the included glTF/FBX bones and three-instance budget. Build the interactive tunnels separately. |
| Ant Farm (animation alternative) | [Game-Ready Worker ant Model](https://sketchfab.com/3d-models/game-ready-worker-ant-model-b48893d316cc4b2f98ec1d1e37027e6a), Msassasa, CC BY 4.0 | Rigged/animated tag, 16 clips; ~47,872 faces | More motion options but heavier for a colony. The description's external `.blend` link needs its own provenance check. |
| Mosquito | [Mosquito](https://sketchfab.com/3d-models/mosquito-474d2ea54af64114b2b5b1d2f6b18f8a), adarshktk, CC BY 4.0 | Blender/ZBrush/Substance model, original file has twelve meshes, 4K embedded maps, zero skins and zero clips | Selected textured source. The derived browser GLB retains its maps and UVs at 2K/1K, splits paired meshes and weights 21 new bones; the demo now poses them for the existing sound controls. No baked clip or biological motion claim. |
| Mosquito (animation lead) | [MOSQUITO](https://sketchfab.com/3d-models/mosquito-120237636bc14d6fa28dbd86b1095c42), ICUC 3D, CC BY 4.0 | One animation; ~96,010 faces; no descriptive rig/material metadata | Inspect before calling it realistic, rigged or browser-ready. No suitable *confirmed* photorealistic, editable mosquito rig was established. |
| Moth | [Animated Peacock Moth](https://sketchfab.com/3d-models/animated-peacock-moth-1c3db0798f1c46be9764e99631cbb0a7), Osian CG, CC BY 4.0 | One animation plus colour, roughness and normal maps; ~61,488 faces | Best naturalistic-animated lead. Verify separate fore-/hindwing hinges and brushable surface topology. |
| Moth (scan alternative) | [Moth](https://sketchfab.com/3d-models/moth-9d1facf05aad4c1ea420f3c90cb9d2f9), Peter Farell, CC BY 4.0 | Photogrammetry from 64 photographs; ~37,821 faces, **zero** clips | Real surface detail, but needs retopology, texture reprojection and a new wing rig. |
| Octopus (selected source) | [Octopus rig](https://sketchfab.com/3d-models/octopus-rig-48f40cb3dfd5473fbb200cf1dcd7b944), Dirk.z, CC BY 4.0 | ~31,260 faces, 128-bone skin, UVs, no color image or baked animation clips | The original skinned mesh now has four runtime artistic UV/PBR finishes and wetness control. Six long chains and two short appendages are editable, not eight matching tentacles; no claim of photorealistic skin. |
| Octopus (animated look lead) | [Glass octopus](https://sketchfab.com/3d-models/glass-octopus-0238634d283a4cff9a0029eaf74dfe58), Andrey, CC BY 4.0 | One animation, ~16,912 faces; transparent deep-sea creature study | Promising naturalistic style; demanding glass shader, unverified arm hierarchy. Inspect included archive before suggesting a browser swap. |
| Squid / eerie creature | [Lurker – Rigged and Animated](https://sketchfab.com/3d-models/lurker-rigged-and-animated-28b3e1a216904de7ad212368fb9d8f59), HighPolyDensity, CC BY 4.0 | Creator describes a fantasy giant mutant squid with six clips; ~8,524 faces | Strong motion/tentacle alternative, **not photoreal octopus**. Check separate limbs and texture/maps. |
| Cthulhu-like texture lead | [Horrifying Cthulhu](https://sketchfab.com/3d-models/horrifying-cthulhu-f6627f6f386a43f68d25736b462fac34), Panda Verse Shop, CC BY 4.0 | Listing advertises PBR FBX/normal/roughness maps; ~9,997 faces, **zero** clips | Research lead only: no proven rig, asset provenance or face/tentacle separability. Avoid assuming the description's FBX has identical rights. |
| Pancakes | [Pancake frying pan (⌀22 cm)](https://sketchfab.com/3d-models/pancake-frying-pan-22-cm-f6a99070101c4c72a33cf3316d3e8c7c), volvor, CC BY 4.0; [Pancake Stack](https://sketchfab.com/3d-models/pancake-stack-85eae11b31154f0d8a12058e9c5992df), Cas_Models, CC BY 4.0 | Pan ~2,149 faces with advertised 4K textures; stack ~5,080 faces with painted butter/syrup | Both static; inspect whether pancakes, plate and butter are separate meshes. If merged, retopologize/separate individual cakes before making a controllable stack. |
| Pancake flipper and butter | [Kitchen Spatula – Tool](https://sketchfab.com/3d-models/kitchen-spatula-tool-c8777bf04ba749e59ce0796d780ed1af), Emma Leyers, CC BY 4.0; [PB121 Butter Low](https://sketchfab.com/3d-models/pb121-butter-low-4db1f5be40844a5a8127c4db42c28424), SCANIMAT, CC BY 4.0 | Spatula creator advertises Substance Painter texture, ~7,720 faces; butter ~3,392 faces, description simply “Butter” | Both static; the imported spatula now follows a playable flipper pivot, and separate imported butter patches respond to heat. They are not skinned or physically simulated. |
| Pancakes (scan alternative) | [Pancake with wipe cream and fruits](https://sketchfab.com/3d-models/pancake-with-wipe-cream-and-fruits-8ba1df8108ba4d4dadc128a7bd2f2496), JackIsRunningKIRI, CC BY 4.0 | Photogrammetry; ~300,000 faces, zero clips | Natural texture but not ready for browser or a flip: decimate/retopologize, isolate the pancake and preserve the texture. |
| 3D Voronoi Foam | [Voronoi Cells of Diamond](https://sketchfab.com/3d-models/voronoi-cells-of-diamond-1989e01ea0554254ad4553ab9c908fd0), ayvlasov, CC BY 4.0 | Static ~12,096-face space-filling polyhedral cell reference | Download remains attributed and available. Rig Lab draws its own clipped cell surfaces instead; 2–12 seeds and a selectable boundary retopologize real faces. |
| Polyhedral Lattice | [3D Lattice of Icosahedra and Octahedra](https://sketchfab.com/3d-models/3d-lattice-of-icosahedra-and-octahedra-c58fa5bbb8a74ef7ac6fc477715e1fc3), David Hall, CC BY 4.0 | Originally static ~5,200-face interlocking lattice | The 13-bone derivative remains credited and downloadable. Rig Lab instead creates selectable geodesic shapes (0–2 subdivisions) with new editable nodes. |

**Rejected for this direction:** the earlier [fried-egg jellyfish](https://sketchfab.com/3d-models/animated-fried-egg-jellyfish-nhm-wien-9f47a81921ef4b25af115b91c2b7d539)
and [rigged jellyfish](https://sketchfab.com/3d-models/jellyfish-220abbec03e44eecbe8843d190adc0b2).
The old [jellyfish concept brief](jellyfish.md) remains archived, but it is not
the chosen lab instrument or an approved texture/asset.

## For further imports or replacements

1. Open each listing, read its current license and creator/third-party credits,
   download through the licensed route, and save source URL, creator, date,
   license text and any derivative notices in an asset provenance record.
2. Inspect the archive in Blender: glTF/GLB or FBX, texture maps, armature and
   skin weights, actual animation channels, separate wing/bell/food pieces,
   transform axes and UVs. A “rigged” tag or clip count alone is insufficient.
3. Make a mobile LOD and texture budget before bundling; scans with hundreds of
   thousands of faces and 4K maps cannot simply replace the light procedural
   meshes. Audit normal maps and glass-octopus transparency if trialed.
4. Connect imported bones/mesh handles to **the existing sound-driving pose**,
   not a disconnected animation player. Pointer cancellation, silent Play,
   audio arming, adjustable topology and stack state, reset and WAX/nested-path
   packaging must keep working. A Sketchfab download may require signing in;
   don't scrape or repackage a viewer preview as a license-compliant download.
5. Preserve the attribution and licenses in the release artifact (including
   `dist-wax` only through its normal build), then perform human visual,
   listening and touch/musical QA. An automated mesh/rig check does not
   establish perceptual quality or physical-device performance.

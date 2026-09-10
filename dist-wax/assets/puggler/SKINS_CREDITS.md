# Puggler prop skin artwork

These are generated photographic-style cutouts, not camera photographs or reproductions of particular museum objects. The history skin deliberately mixes eras and places; it is fictional stage dressing, with no claim of historical authenticity. The future objects and names are invented.

All 33 base prop IDs keep their simulation mass, radius, drag, bounce and sound assignments. Historical and future names describe the appearance, not a new physical model.

## Artwork provenance

Created on 2026-09-10 using the built-in OpenAI image generation tool (`image_gen.imagegen`), in fresh generation mode without reference images. No third-party source artwork was supplied.

- `history-props-collage.webp`: 1484 × 1060; source generation `exec-113a7bc1-3b7f-4b6c-8ae8-b96081f2a376.png`.
- `future-props-collage.webp`: 1484 × 1060; source generation `exec-4357f71e-b412-41ce-b038-10dce8bc8bd3.png`.

The selected RGBA PNGs were encoded as WebP with browser Canvas at quality 0.94. The generated alpha channel was preserved byte-for-byte. No background removal, painted masking, recoloring or outline processing was used.

The atlases contain 33 props in nominal seven-column/five-row order; the last two cells are empty. Runtime source rectangles follow the actual cutout bounds instead of assuming exact cell alignment. Two historical cutouts had touching peripheral cords: the herb bundle and astrolabe use separate rectangles that trim those cord ends. One history edit was rejected because its output painted a checkerboard background; three fresh regeneration attempts returned server errors. The original historical bitmap is retained.

The final WebPs and their rendered crops were inspected in Chromium over a dark background. Very low-alpha colored pixels visible in some raw image viewers remain effectively transparent during normal browser compositing; for example a source pomegranate-edge RGBA pixel of [255,255,0,1] has alpha 1/255. Encoding validation found zero alpha differences between each PNG and WebP.

## Historical atlas — exact selected prompt

```text
Create a PNG sprite atlas with a TRANSPARENT BACKGROUND, an actual RGBA alpha channel. Empty pixels have alpha 0. Only the 33 distinct physical objects are opaque. Natural close-cut photographic silhouettes, no white outlines, no paper backing, no stickers.
Asset type: historical prop skins for a juggling game. This is a deliberately mixed global-history fantasy collection, from prehistory through medieval and early modern life, not one time period and not claimed museum replicas.
Composition: a wide 7:5 canvas, ideally 1792 by 1280 pixels. Exactly SEVEN equal columns and FIVE equal rows of square cells. Each object is centered within its assigned cell, occupies no more than 65% of that cell's width or height, and has a generous transparent gutter around its entire silhouette. All 33 objects must be separate, complete, uncropped, and clearly identifiable. Last two cells are empty. No drawn grid, labels, writing, backdrop or cast shadows.

ROW ONE, left to right:
1. A polished round gray stone sphere.
2. An antique bronze drinking beaker.
3. A knotted wooden caveman club, thick at one end.
4. A black iron cannonball with rusty patches.
5. A terracotta amphora with two handles.
6. A worn medieval brown leather boot.
7. A small carved wooden duck.

ROW TWO:
1. A whole dried silvery fish.
2. A deep red pomegranate with crown.
3. A patinated bronze temple bell.
4. A rectangular ancient clay writing tablet with tiny impressed marks, no readable text.
5. A bulging dark leather waterskin with short neck and stopper.
6. A complete pear-shaped wooden oud with short neck and strings.
7. A rolled parchment scroll with one curled edge, blank parchment.

ROW THREE:
1. A small rustic wooden cart with four wheels.
2. A round bronze gong with central boss, no stand.
3. A curling ram's horn.
4. A conical woven straw hat.
5. A thick unlit beeswax candle.
6. A little stitched linen cloth doll with simple limbs.
7. A golden wedge of honeycomb.

ROW FOUR:
1. A chipped stone axe lashed to a wooden handle.
2. A seated carved dark stone cat figurine.
3. A graceful bronze ewer with handle and curved spout.
4. A tied bundle of dried herbs.
5. A small bowed rebec string instrument with narrow wooden body and three strings, no separate bow.
6. An ordinary ivory memento mori skull prop, clean dry bone, no flesh or gore.
7. A crescent-shaped rustic bread loaf.

ROW FIVE:
1. A coil of thick hemp rope.
2. A leafy herb in a small hand-thrown ceramic pot.
3. A small upright wooden butter churn with plunger handle.
4. A round brass astrolabe with openwork star pointer.
5. A closed medieval bound manuscript with worn brown leather covers and metal clasps.
6. Empty transparent cell.
7. Empty transparent cell.

Style: highly realistic photographed objects with aged wood, stone, clay, bronze, leather, linen and plant detail, natural subdued museum-object lighting. Keep every object's edges directly against transparency. No white paper perimeter, decorative border, painted background, or repeated object. All objects must remain intact and within their own cells. Output a genuine transparent PNG.
```

## Future atlas — exact selected prompt

```text
Create a PNG sprite atlas with a TRANSPARENT BACKGROUND, an actual RGBA alpha channel. Empty pixels have alpha 0. Only the 33 distinct invented physical objects are opaque. Natural close-cut photographic silhouettes, no white outlines, no paper backing, no stickers.
Asset type: strange far-future sound objects from the year 3026, for a juggling game. Invented alien technology and biotech, physical and tactile with real material texture, all distinct silhouettes. Photograph these imaginary objects as if they were real.
Composition: wide 7:5 canvas, ideally 1792 by 1280 pixels. Exactly SEVEN equal columns and FIVE equal rows of square cells. One complete object centered in each assigned cell, at most 65% of the cell width and height. Large transparent gutters. No overlap or cut-off parts. Last two cells empty. No visible grid, labels, text, logos, cast shadows or backdrop.

ROW ONE, left to right:
1. Gravipod: pearly ceramic orb nested within an attached segmented chrome halo.
2. Pulse canister: black-chrome ribbed cylinder with amber translucent windows.
3. Phase baton: bent aquamarine tuning fork with two unequal rounded arms.
4. Singularity seed: heavy black obsidian sphere with five glowing blue pits.
5. Memory ampoule: twisted violet glass vessel with two asymmetric bulbs.
6. Drift talon: silver crescent claw with three blunt prongs.
7. Echo hatchling: tiny amber biomorphic pod with a beak-like tip and luminous gill ridges.

ROW TWO:
1. Ribbon resonator: a wide iridescent metal ribbon folded into a twisting S.
2. Choral knot: a pink braided cubic knot with a yellow hollow center.
3. Vacuum bloom: inverted pale ceramic bell-shaped flower with violet inner ridges.
4. Time ingot: a transparent rounded rectangular block enclosing scattered black fragments.
5. Cloud bladder: a pale translucent three-lobed soft pouch with cyan veins.
6. Nerve harp: irregular black wishbone frame stretched with five luminous threads.
7. Quanta wafer: flat copper hexagonal plate with raised concentric rings.

ROW THREE:
1. Vector sled: narrow red-and-silver crescent platform with small fins.
2. Halo lattice: gold interlocked double-torus rings with tiny etched holes.
3. Tongue antenna: pink segmented flexible stalk with a black beaded tip.
4. Prism nest: attached stack of translucent triangular prisms with lime veins.
5. Ion thorn: compact six-point lime crystal thorn cluster.
6. Mneme grub: soft purple six-segment grub-like biotech body with tiny stub legs.
7. Cryofizz spiral: chrome spiral cup enclosing blue translucent foam.

ROW FOUR:
1. Cleave arc: black handle with two curved rose-metal blade fins.
2. Dormant oracle: smooth ivory eyeless alien biomorph with a looped tail, resting pose.
3. Flux manifold: red ceramic three-legged valve with short translucent hoses.
4. Spore capsule: green ribbed oval shell containing attached black bead clusters.
5. Void lyre: deep-blue hourglass-shaped string frame with translucent cords.
6. Fossil processor: bronze perforated shell with asymmetric glass lenses.
7. Crescent relay: smooth golden curved bar split by three black bands.

ROW FIVE:
1. Loop organism: coiled opal segmented serpent-like object with a fin-shaped head.
2. Root reactor: rough gray pod growing copper fractal branches.
3. Pressure petal: rose-pink umbrella-shaped disk on an aqua stalk.
4. Möbius dial: mirrored chrome ribbon forming a compact twisted infinity loop.
5. Archive brick: violet trapezoid block enclosing a transparent crystalline core.
6. Empty transparent cell.
7. Empty transparent cell.

Style: highly realistic product photography of impossible alien objects, brushed metals, translucent glass, textured ceramic, soft biopolymer, subtle built-in light rather than big external glows. Real material grain and tiny wear. Every silhouette directly meets actual transparency, never a white paper perimeter. Exactly 33 varied objects, all intact. Output a genuinely transparent PNG.
```

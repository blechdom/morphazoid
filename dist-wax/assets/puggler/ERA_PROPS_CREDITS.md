# Additional Puggler era props

`era-props-collage.webp` contains seven generated photographic-style cutouts. These are fictional stage assets, not camera photographs, authentic historical artifact reproductions, or a claim about a real animal species. The swaddled baby is depicted as an inanimate theatrical doll. The octopus is an invented fluorescent alien.

The new appearances reuse seven existing physical prop IDs. This artwork and metadata do not change their mass, radius, flight model, drum assignment or vocal role.

| Skin | Physical ID | Display name | Atlas sprite |
| --- | --- | --- | --- |
| History | mic | Bones | history-bones |
| History | banana | Ham hock | history-hamhock |
| History | plushrat | Swaddled baby | history-baby |
| History | skateboard | Harpsichord | history-harpsichord |
| History | bowling | Boulder | history-boulder |
| History | club | Wooden club | history-club |
| Future | fish | Fluorescent octopus | future-octopus |

## Provenance and validation

- Generated September 10, 2026 with the built-in OpenAI image generation tool, `image_gen.imagegen`, in fresh generation mode.
- No reference image or third-party source artwork was supplied.
- Selected source: `exec-59b41473-52f2-434f-8e03-d8d72d4ddf65.png`.
- Final asset: `assets/puggler/era-props-collage.webp`, 1774 × 887 pixels, 429,520 bytes.
- PNG-to-WebP format conversion used Chromium Canvas at quality 0.94. Alpha values are unchanged at every pixel. No background removal, painted masking, recoloring or outline processing was used.
- The source contains 1,037,333 fully transparent pixels. Seven substantial isolated alpha components were measured, and all seven runtime crop rectangles were checked in bounds and separated from neighboring objects.
- The final atlas was visually inspected in Chromium over a dark background for visible borders, completeness and separation. Nominal layout is four columns and two rows, with the last cell empty; the metadata uses measured pixel rectangles.

## Exact generation prompt

```text
Use case: stylized-concept.
Create one sprite atlas of SEVEN photographic-style juggling stage props, with a genuine transparent RGBA PNG background. Empty pixels must have alpha 0. No painted checkerboard, no paper, no white outline, no sticker border, no background scene, no text.

Composition: strict four equal columns and two equal rows, wide 2:1 canvas. Exactly one complete cutout centered in each cell, occupying at most 65% of the cell, with generous empty transparent gutters on every side. Seven distinct silhouettes; last cell empty. Every tentacle, instrument leg, and bone stays entirely within its own cell; nothing touches adjacent cutouts.

Top row, left to right:
1. A pair of dry ivory animal long bones crossed together as one object, aged realistic bone texture, clean and non-graphic.
2. A whole cooked ham hock with a short exposed bone handle, glossy browned roast surface, hearty old banquet food, non-graphic, no plate.
3. A lifelike theatrical baby DOLL with closed eyes, entirely swaddled in an aged cream linen blanket, face peeking from the cocoon. An obviously inanimate stage prop, no exposed body, no accessories.
4. A complete miniature harpsichord in three-quarter view: worn dark wooden wing-shaped case, open lid, visible plucked strings, small black-and-ivory keyboard and slender legs. Historically inspired baroque instrument, not a modern grand piano.

Bottom row, left to right:
1. A rough irregular gray BOULDER with angular worn facets and gritty mineral texture, visibly a natural rock, not a polished sphere.
2. A thick primitive wooden club, knotted gnarled dark wood with an enlarged blunt head and narrow handle, diagonal orientation, no metal.
3. A fluorescent alien octopus with a bulbous iridescent teal-magenta head and eight individually curled tentacles with vivid lime and cyan suckers. Wet convincing organic photographic texture, brilliantly fluorescent surfaces, NO outer halo or glow border. Entire animal contained in its cell.
4. EMPTY transparent cell.

Lighting: realistic detailed material photography, slightly scruffy theatrical objects, soft directional light that models the object without any cast shadow outside its silhouette. Natural close-cut edges directly adjoin actual transparent pixels. No labels, grids, watermarks, floor or backdrop.
```

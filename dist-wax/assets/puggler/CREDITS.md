# Puggler asset credits

All eight bundled recordings are **CC0 1.0 Universal**. See
[the included license](CC0-1.0.txt) and
[Creative Commons' CC0 deed](https://creativecommons.org/publicdomain/zero/1.0/).
No audio is taken from *Xavier: Renegade Angel*, a commercial song, or a game.
Samples load from this site's own assets only, after explicit Audio activation.

## Recorded acoustic drums

Drum samples by **Karoryfer Samples**, selected from Big Rusty Drums, Unruly
Drums, and Swirly Drums. The creator confirms that all their free libraries are
CC0: <https://shop.karoryfer.com/pages/free-samples>.
[Big Rusty Drums](https://shop.karoryfer.com/pages/free-big-rusty-drums) records
an oversized Polish drum kit and modern cymbals; these are acoustic drum
recordings, not a synthesis approximation.

Retrieved from the [Stargate public-domain sample pack](https://github.com/stargatedaw/stargate-sample-pack/tree/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/stargate-sample-pack/karoryfer),
commit `dbfd6ec52d4ed53b60bdbea5fc6adf295127c027`.
The pack's Karoryfer readme identifies the source libraries, and its root
`LICENSE` is CC0 1.0. Original filenames below are relative to
`stargate-sample-pack/karoryfer/`.

| Bundled file | Original filename | Kept duration |
| --- | --- | --- |
| kick.wav | kicks/kick_Szpaderski_24_dampened.wav | 0.65 seconds |
| snare.wav | snares/snare_Pearl_alumunum_14x8.wav | 0.80 seconds |
| crash.wav | cymbals/crash_BRD_17.wav | 1.80 seconds |
| tom.wav | toms/tom_Szpaderski_18.wav | 0.80 seconds |
| hat.wav | hihats/hihat_BRD_closed.wav | 0.30 seconds |

## Recorded audience voices

- **oi.wav**: [Oi.wav by rhink](https://freesound.org/people/rhink/sounds/245867/),
  August 31, 2014; CC0. The creator labels the clip “Oi.” Retrieved from the
  [HQ preview](https://cdn.freesound.org/previews/245/245867_4516680-hq.mp3),
  with initial silence removed (0.1075 seconds), converted to mono 22050 Hz
  PCM, peak normalized, and given a 3 ms onset and 18 ms release fade. The
  remaining 0.4498-second call is repeated three times with level accents and
  pauses; its articulation is retained rather than replaced with formant synthesis.

- **boo.wav**: [Booing Crowd by NeoSpica](https://freesound.org/people/NeoSpica/sounds/504621/),
  January 29, 2020; CC0. The creator describes an audience booing, mixed from CC0
  sounds. Kept 2 seconds starting at 0.35 seconds from the [HQ preview](https://cdn.freesound.org/previews/504/504621_7704891-hq.mp3).
- **woo.wav**: [Woo 2.wav by jayfrosting](https://freesound.org/people/jayfrosting/sounds/333421/),
  January 19, 2016; CC0. A small audience yelling “woo.” Kept 1.8 seconds from
  the initial audible onset of the [HQ preview](https://cdn.freesound.org/previews/333/333421_5884138-hq.mp3).

## Processing and authored phrases

Bundled recordings were decoded/resampled by Chrome OfflineAudioContext,
converted to mono 22050 Hz 16-bit PCM WAV, normalized to a 0.92 peak, trimmed,
and given a 3 ms onset and 60 ms release fade. They may be pitched, panned,
compressed, filtered, or shortened during playback.

`src/puggler-samples.js` authors the other two sounds from scratch under the
repository's MIT license: a distorted plucked-string power-chord phrase,
a plucked bass phrase. They are rendered into small PCM buffers at Audio
activation. OI now uses the sampled call above; WOO uses the existing audience
recording. `src/puggler-vocals.js` supplies the original three punk characters'
register, EQ and doubling treatments. `src/puggler-era-vocals.js` supplies six
era voices: earthy chant, chamber reply, an ornamented Maestro line, cyber-funk
call, Cyberwoman soprano and liquid Quor melisma. These all transform the same
licensed OI/WOO recordings; they are not newly recorded actors. A short-grain
pitch treatment preserves syllable order, with a smaller three-formant singing
layer following the recording's amplitude and voiced-pitch estimate. Short,
finite early reflections and chorus add era color. The estimator is an effect
control, not a transcription or a validated analysis of the singer.

`src/puggler-era-samples.js` authors twelve two-second instrumental phrases and
ten finite percussion sounds under the repository's MIT license. Historical
performers use mouth-bow-style twang, lute/oud-like plucks and harpsichord-like
keys, with different woody/gut-string bass parts. Their catch kit uses frame
drum, tabor, bronze gong, log drum and finger-cymbal approximations. Future
performers use FM leads, liquid glass, underwater marimba and elastic cyber-funk
bass; their catches use sub kick, laser clap, splash crash, water tom and glitch
hat synthesis. These are theatrical synthesis colors, not instrument recordings
or reconstructions of particular historical traditions.

All era buffers are rendered once at explicit Audio activation and reused.
Vocal buffers have source-relative level balancing, a 0.88 peak ceiling and faded
boundaries; authored instruments target RMS 0.17 and percussion 0.18, with peaks
bounded below 0.90 before live gain. Historical instruments and all vocals bypass
per-voice overdrive and use gentle compression. Future instruments use milder
drive than the punk guitar. The shared output ceiling and catch-driven ducking
remain in place. Vocal path-driven playback rates stay between 0.84× and 1.2×,
even at extreme juggling tempos, to retain the character's register.

The character who last threw or kicked a prop owns its vocal phrase and its era
instrument. A pass keeps that voice until the receiver throws; audience returns
use the intended receiver. Skin changes crossfade to matching instruments and
voices while preserving relative phrase progress. Sound-role IDs remain stable,
so existing object choices and presets still work. Crowd cheers and boos keep
the original audience recordings.

Only airborne objects (including audience lobs and throws to the crowd) sound their looping
phrase. Rider and audience catches trigger the selected drum; drops trigger the audience boo.
Object position controls pan, height changes phrase playback pitch/speed, and
velocity changes phrase rate and brightness. Juggling pause releases riffs
while catch tails and visible, model-triggered crowd cheers/boos may continue.
Explicit Audio mute, zero level, and hidden-page `active: false` silence all
audio. There is no independent backing track or crowd loop.
Human listening approval remains a separate check from automated
finite-output and lifecycle tests.

## Generated photographic collage

`props-collage.webp` (1916 × 821) and `venue-collage.webp` (1774 × 887)
were regenerated on September 10, 2026 using the built-in image-generation tool.
These are AI-generated photographic-style cutouts, not sourced camera photographs.
The venue atlas depicts fictional adults from behind. The CC0 attribution above applies
to the sound recordings, not to these generated images.

The current images have natural transparent photo edges, without paper or sticker
borders. Rear-facing punk heads replace the previous frontal portraits. The source
RGBA PNGs were encoded as WebP at quality 0.94 using browser Canvas; dimensions and
every alpha byte were preserved. The renderer uses fitted source rectangles in
`src/puggler-collage.js` because the cutouts do not follow an exact equal grid.
Photographs keep their aspect ratio and rotate around model positions. Faded
copies follow recorded flight positions and rotations; they are not predicted paths.
Four images, including the additional crowd and prop atlases below, decode once per renderer;
original vector artwork is the fallback
while loading or after failure. Display size is controlled in code, independently
of each prop's physical mass and collision properties.

### Prop atlas prompt

```text
Create a PNG sprite atlas with a TRANSPARENT BACKGROUND (an actual RGBA alpha channel). This is a game asset; empty pixels must have alpha 0. The subject silhouettes are the only opaque pixels.
Photorealistic objects, tight natural photo edges, no outlines or paper backing. Arrange exactly 21 separate small objects centered in a regular 7-column, 3-row grid, one per equal square cell on a 7:3 canvas. Each object fills at most 60% of its cell, leaving 20% transparent margins on every side. No grid marks, no labels, no text. Keep every object entirely within its own cell.
Row 1 left to right: worn pink rubber ball; crushed silver tin can; green juggling club; purple bowling ball; green glass bottle; black studded punk boot; dirty yellow rubber duck.
Row 2: whole silver fish; red apple; brass hand bell; red brick; pink balloon; battered orange electric guitar; pink-and-black cassette tape.
Row 3: cracked skateboard; black vinyl record with pink center; dented microphone; orange-and-white traffic cone; lime glowstick; red-and-white plush mushroom; gray plush rat.
Detailed scratches, grime, worn material, real product photography. Natural antialiased photographic object silhouettes without a surrounding white edge. Clean transparent PNG output for direct use over a dark game stage.
```

### Venue atlas prompt

```text
Create a PNG sprite atlas with a TRANSPARENT BACKGROUND (an actual RGBA alpha channel). This is a game asset; empty pixels must have alpha 0. Only the subjects are opaque.
Eight small photorealistic subjects centered in a precise 4-column 2-row grid of equal square cells on a 2:1 canvas. Each subject fills at most 60% of its own cell, leaving generous 20% transparent margin on all sides. No crossing cell boundaries, no outlines, no paper backing, no grid marks, no labels, no text.
Top row left to right: battered black guitar amplifier with torn grille and duct tape; tall battered black double-woofer PA speaker cabinet; dirty red bass drum with ivory drumskin and metal rim and legs; shiny tied black garbage bag with banana peel.
Bottom row left to right: back of a pink-mohawk punk head and nape; back of a lime-mohawk punk head and nape; raised devil-horns hand with studded black wristband seen from the back of the hand; open raised hand with black nail varnish and ragged black fishnet cuff seen from the back of the hand.
Both heads face directly AWAY from the camera. See only mohawk hair, rear of shaved skull, back of ears and nape, never their faces. These are rear-view crowd heads looking toward a stage.
Photographic skin, individual hairs, grime, scuffed material and wear. Tight natural photograph edges without white outlines. Clean transparent PNG output for direct use over a dark game stage.
```

## Additional generated crowd cutouts

`crowd-collage.webp` (1983 × 793) was generated on September 10, 2026 using
the built-in image-generation tool. It contains five fictional rear-view crowd
characters (an adult with dreadlocks, a child in a hoodie, a person wearing a tall
black hat, a broad person with curly hair, and an older punk) plus five varied
raised-hand gestures (a lit lighter, a phone, an open hand, a peace sign, and horns).
These are AI-generated photographic-style cutouts, not sourced photographs of
real people. The CC0 recording licenses above do not apply to this image.

The atlas was generated with genuine transparent alpha and natural photo edges,
without paper backing or white outlines. Its source RGBA PNG was encoded to WebP
at quality 0.94 using browser Canvas; dimensions and every alpha byte were
preserved. No background removal or creative pixel processing was used. The
renderer uses measured source rectangles because the generated positions do not
follow a precise equal grid. Existing prop and venue images remain separate.

### Additional crowd atlas prompt

```text
Create a PNG sprite atlas with a TRANSPARENT BACKGROUND (an actual RGBA alpha channel). This is a photographic crowd sprite sheet for a scruffy punk music game; empty pixels must have alpha 0. Only the ten separate subjects are opaque. Natural tight photo edges, no white outlines and no paper backing.
Arrange exactly ten isolated cutouts in five columns and two rows on a wide 5:2 canvas. One subject centered per equal square cell. Each subject fills at most 60% of its cell, with at least 20% transparent margin on all four sides. Keep entire subjects separate, no overlap or touching, generous empty gutters. No grid lines, labels, text or watermark.

TOP ROW: five DIFFERENT heads with necks and upper shoulders, all seen STRICTLY FROM DIRECTLY BEHIND, looking away from the camera toward a concert stage. Only backs of heads, hair, back of ears, necks and shoulders are visible. No eyes, noses, mouths or visible faces.
1. A dark-skinned adult with long shaggy black dreadlocks, scruffy black denim shoulders.
2. A smaller child wearing a baggy charcoal hoodie with the hood up, seen from behind, a little messy hair emerging.
3. A tall slender adult wearing an ABSURDLY TALL crumpled BLACK TOP HAT, narrow neck and battered jacket shoulders. Entire very tall hat visible.
4. A broad-shouldered adult with a large unruly mass of dark curly hair, worn olive jacket.
5. An older pale punk with a bald patch, wispy gray hair, several ear rings and ear accessories, battered black leather collar.

BOTTOM ROW: five isolated raised hands with short forearms, from the audience viewpoint, diverse skin tones and natural human anatomy.
1. Medium-brown hand holding a small metal cigarette lighter upright with a clearly visible small yellow-orange FLAME above it; frayed denim cuff.
2. Dark-skinned hand gripping a black smartphone vertically to photograph the stage, screen visible with a tiny blurred concert glow but no text or recognizable people, cloth wristband.
3. Light-skinned raised open palm with all five fingers, chipped black nail polish, ragged black sleeve.
4. Brown-skinned raised hand making a peace sign with two extended fingers, cheap bracelets, back of hand toward camera.
5. Pale freckled raised hand making devil horns with index and little finger extended, black studded wristband, back of hand toward camera.

Wacky, shabby club audience photography. Natural skin texture, individual hair strands, worn fabric and metal, rough candid flash-photo lighting, real material detail. No drawn/sticker/cartoon edges. Every cutout has a clean natural silhouette directly adjoining transparent pixels. Output a genuine transparent PNG for use over a dark stage.
```

## Additional generated juggling props

`props-extra-collage.webp` (1619 × 971) was generated on September 10, 2026
using the built-in image-generation tool. It contains thirteen photographic-style
cutouts: an ice cream cone, axe, deceased tabby cat, fire hydrant, pickle, violin,
skull prop, banana, snake, potted plant, toilet plunger, CD, and VHS tape. The cat
is an AI-generated, intact, non-graphic animal depiction with closed eyes and a
limp pose; it is not a photograph of a real deceased animal or a stuffed toy.
The skull is an ordinary clean prop. These generated images are separate from
the CC0 sound recordings credited above.

The source RGBA PNG was encoded to WebP at quality 0.94 using browser Canvas.
Its dimensions and every alpha byte were preserved. No background removal,
repainting, or other creative pixel processing was used. Each object remains an
independent cutout with genuine transparency and no paper or sticker outline.
The renderer uses measured source rectangles instead of relying on a perfect
five-column grid. Existing prop, venue, and crowd atlases remain separate.

The plush mushroom is retired from the object bank and sprite map. Its unused
cell remains in the original prop sheet; the original generation prompt above
documents that sheet accurately.

### Additional prop atlas prompt

```text
Create a PNG sprite atlas with a TRANSPARENT BACKGROUND (an actual RGBA alpha channel). This is a game sprite sheet of photographic objects for a scruffy punk juggling game. Empty pixels must have alpha 0. Only the thirteen separate objects are opaque. Natural tight photograph edges, no white outlines and no paper or sticker backing.
Arrange thirteen isolated objects in a regular FIVE-COLUMN, THREE-ROW grid on a 5:3 canvas. Each cell is an equal square. One object centered in each assigned cell. Keep each ENTIRE object within its own cell at no more than 60% of the cell width and height, with at least 20% transparent margin on all four sides. Do not overlap, crop, merge, or place objects across the cell boundaries. The last two cells of the bottom row are empty transparent space. No grid lines, labels, text, cast shadows or watermark.

TOP ROW, left to right:
1. An ice cream cone: a crumbly waffle cone with two slightly melting pink and white scoops.
2. A small battered axe with a wooden handle and scuffed gray steel head, diagonally posed.
3. A NON-GRAPHIC deceased tabby cat, a real animal rather than a stuffed toy: complete small adult brown-gray striped cat lying limply on its side, eyes gently closed, relaxed head, limp extended paws, visible tail. Fur is intact. No blood, wounds, injuries, exposed organs, decay, or signs of suffering. It must clearly look like an actual photographed cat lying lifeless, with all legs and tail visible within the cell.
4. A battered red fire hydrant with side nozzles and bolts, upright.
5. One bumpy green dill pickle, tilted diagonally.

MIDDLE ROW, left to right:
1. A complete worn brown wooden violin with neck, scroll and strings, diagonally posed, no bow.
2. An ordinary ivory skull prop, anatomically recognizable human skull with dark eye sockets and teeth; clean dry bone, no flesh or gore.
3. One ripe yellow banana with dark freckles, curved.
4. One entire green-and-brown snake in a compact graceful S curve, head and tail both visible, natural scales.
5. A little leafy houseplant in a scuffed terracotta pot, the entire pot and all leaves visible.

BOTTOM ROW, left to right:
1. A toilet plunger with a long wooden handle and red rubber cup, diagonally posed.
2. A silver CD with subtle rainbow reflections and a central round hole.
3. A black VHS videotape cassette with a worn blank off-white label.
4. Empty transparent space.
5. Empty transparent space.

Match grimy real-object product photography: worn textures, scratches, tiny dents, realistic fur/scales/leaves, natural material detail and subdued photographic lighting. Natural silhouettes directly adjoin transparency, without surrounding white borders. Keep every object crisp and recognizable as a small juggling sprite. Output a genuinely transparent PNG.
```
# Stage-skin and additional audience artwork

Additional generated imagery has its exact prompts and provenance in
[SKINS_CREDITS.md](SKINS_CREDITS.md) and
[CROWD_EXTRA_CREDITS.md](CROWD_EXTRA_CREDITS.md).

The historical crowd refresh and seven additional era object cutouts are credited
in [HISTORY_CROWD_CREDITS.md](HISTORY_CROWD_CREDITS.md) and
[ERA_PROPS_CREDITS.md](ERA_PROPS_CREDITS.md), including exact generation prompts.

The rear-view future audience, including cyborgs, aliens, women, children and a
baby, has its artwork and exact prompt in [FUTURE_CROWD_CREDITS.md](FUTURE_CROWD_CREDITS.md).

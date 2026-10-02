# Catalogue logo generation

The 29 catalogue logos listed below were generated on 2026-09-13 with the
built-in OpenAI image-generation tool. The existing `shape.webp`,
`graph-delay.webp`, and `morphazoidical.webp` marks were supplied as style
references only. No third-party artwork, photographs, logos, or trademarks were
used as source material.

The shared prompt requested a centered, compact Morphazoid instrument emblem:
a playful high-detail tactile miniature made from glossy enamel, dark metal,
glass, glowing wire, and brass; cyan, coral, violet, acid-lime, and brass color;
a strong silhouette with generous margin; and no text, border, badge, UI,
watermark, scenery, floor, or crop. Each source image was generated square and
converted to a 512 × 512 WebP at quality 92.

The generator did not return a usable alpha channel despite two transparent-
background attempts. The final prompt therefore required a perfectly flat,
edge-to-edge pure-black background. The homepage catalogue image well uses the
same black so the square boundary disappears without deleting dark edge detail.

| Catalogue asset | Instrument-specific subject |
| --- | --- |
| `roach-synth.webp` | Articulated six-legged cockroach voice machine |
| `quadruped.webp` | Four-legged gait creature on a sixteen-step ring |
| `spider-synth.webp` | Eight-legged orb-weaver plucking a radial silk web |
| `julie-saw.webp` | Seated performer bowing an S-curved singing saw |
| `creaturazoid.webp` | Persistent airway creature with body percussion and rhythm steps |
| `surround-field.webp` | Central sound orb inside a multichannel speaker array |
| `boidzoid.webp` | Flock of arrow-birds following a sine path |
| `throat-singing.webp` | Profile airway with drone and overtone rings |
| `puggler.webp` | Punk unicyclist juggling a microphone, can, and ball (superseded by the character-reference redraw below) |
| `simd-303.webp` | Four-lane waveform processor with sequencer and effects |
| `dentaphone.webp` | Two dental arches forming a modal marimba |
| `moire-drone.webp` | Woven frequency fabric under two sculptor nodes |
| `hocket-loom.webp` | Three-track pulse loom with interlocking handoffs |
| `yoyodyne.webp` | Spinning yo-yo, taut string, hand, and trick trajectories |
| `gesturama.webp` | Tracked hand painting drum, membrane, and harp zones |
| `moebius.webp` | Half-twisted ribbon with stations and two playheads |
| `micromorph.webp` | Microphone signal morphing through five membranes |
| `blowhole.webp` | Cetacean head with source bulbs, air sacs, resonator, and valve |
| `algorithmic-mazes.webp` | Orthogonal, radial, and hexagonal maze mechanisms |
| `klein-bottle.webp` | Glass figure-eight Klein-bottle immersion with two slice curves |
| `paths.webp` | Five generative routes emerging from a shared hub |
| `penrose-tilings.webp` | Fivefold Penrose-rhombus signal network |
| `vector-flight.webp` | Centered craft inside a circular vector star field |
| `karplus-strong.webp` | Plucked string inside a feedback-delay resonator |
| `entanglement-dance.webp` | Two linked qubit dancers with correlated motion |
| `vocalzoid.webp` | Mechanical mouth joining syllable blocks into melody |
| `playhead-paint.webp` | Painted looping stroke chased by three playheads |

## Hiccup Head reference redraw — 2026-09-16

`hiccup-head.webp` is a hand-authored vector redraw of the user's Hiccup Head
instrument screenshot, not an AI-generated image. It preserves the cream/black
checkerboard, violet outline and side hair, round eyes, orange nose, and green
gap-toothed mouth. UI guides and the old icon's color-swatch strip are omitted.

The editable source is `artwork/vector-instrument-icons/hiccup-head.svg`, with
a transparent 1024 × 1024 PNG beside it. The catalogue uses a transparent
512 × 512 lossless WebP rasterized from that SVG with librsvg/Cairo and Pillow.
The existing catalogue and menu asset path is unchanged.

## Transparent icon refresh — 2026-10-01

Four catalogue icons were refreshed with the built-in OpenAI image-generation
tool and exported as transparent 512 × 512 lossless WebP files. `puggler.webp`
is now a close crop of the instrument's actual orange-haired character and its
tall green eyelet hat. `fractal-signals.webp` initially became a balanced
six-way radial synth whose recursive arms represented the instrument's six
signal modes; the reference-led refresh below supersedes it with a less
symmetrical layout. The existing subjects in `gesticulating-hand.webp` and
`simd-chiptune.webp` were retained while their baked square backgrounds were
removed.

The retained full-resolution transparent PNG sources are:

- `artwork/instrument-icon-variants/puggler/round-1-character-head-transparent-source.png`
- `artwork/instrument-icon-variants/fractal-signals/round-1-radial-synth-transparent-source.png`
- `artwork/instrument-icon-variants/gesticulating-hand/round-1-transparent-extraction-source.png`
- `artwork/instrument-icon-variants/simd-chiptune/round-1-transparent-extraction-source.png`

Each variant directory also contains the exact `catalogue-current.webp` copied
to `assets/instruments/`. The generation requests prohibited backdrops, badges,
frames, text, and watermarks and explicitly required a genuine alpha channel.

## Reference-led icon refresh — 2026-10-02

Six catalogue icons were redrawn from the instruments' own graphics and specimen
renders. The built-in OpenAI image-generation tool supplied the reference-led
raster studies; Fractal Synthesis was then finished as an exact vector drawing
so its mathematical detail remains legible at catalogue size:

- `fractal-signals.webp` is an asymmetric recursive interpolation plot. A pale
  off-axis spline and coordinate ticks establish the mathematical drawing;
  cyan and violet echoes encode iteration depth, while sampled points, control
  chords, and two sparse compass constructions replace every hub, connector,
  tube, dashed orbit, and radial hardware motif.
- `dentaphone.webp` reduces the instrument to its two anatomical dental arches
  with restrained resonance contours.
- `julie-saw.webp` follows the in-instrument line graphic: Julie, the dominant
  S-curved steel saw, and the amber bow.
- `roach-synth.webp` follows the real specimen's flattened body, wing seam,
  spiny legs, pronotum, and antennae.
- `spider-synth.webp` follows the default Argiope specimen's separated body,
  striped abdomen, natural eight-leg stance, and a few silk strands.
- `klein-bottle.webp` adopts the restrained translucent technical mesh language
  of the Möbius icon while preserving the Klein bottle's immersed crossing.

The retained full-resolution transparent sources are:

- `artwork/instrument-icon-variants/fractal-signals/round-2-asymmetric-technical-transparent-source.png`
- `artwork/instrument-icon-variants/fractal-signals/round-3-asymmetric-mathematical-source.svg`
- `artwork/instrument-icon-variants/fractal-signals/round-3-asymmetric-mathematical-transparent-source.png`
- `artwork/instrument-icon-variants/fractal-signals/round-4-asymmetric-recursive-plot-source.svg`
- `artwork/instrument-icon-variants/fractal-signals/round-4-asymmetric-recursive-plot-transparent-source.png`
- `artwork/instrument-icon-variants/dentaphone/round-1-anatomical-arches-transparent-source.png`
- `artwork/instrument-icon-variants/julie-saw/round-1-stage-graphic-transparent-source.png`
- `artwork/instrument-icon-variants/roach-synth/round-1-specimen-transparent-source.png`
- `artwork/instrument-icon-variants/spider-synth/round-1-argiope-transparent-source.png`
- `artwork/instrument-icon-variants/klein-bottle/round-1-moebius-style-mesh-transparent-source.png`

Each icon is exported as a transparent 512 × 512 lossless WebP. The matching
variant directory retains the exact `catalogue-current.webp` copied to
`assets/instruments/`.

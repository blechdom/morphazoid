# Seven 3D instrument briefs

Prepared 2026-10-16 for Morphazoid; selected CC BY model downloads were
added 2026-10-18. **Try the shared [Rig Lab](../../src/pages/rig-lab.html)
at `/rig-lab.html`** for seven sound-driving sketches. Five stages retain
the approved **downloaded ant, octopus, mosquito, moth and kitchen** meshes.
At the user's request the two purely geometric stages now draw **live Three.js
topology**, not copies of the static Diamond and David Hall reference GLBs.
No procedural animal, kitchen prop or missing-asset substitute is displayed.

Rig Lab has **three recallable demonstration scenes per stage**. Select a
scene, then press Play to see its downloaded joints or recomputed geometry
animate; Audio still starts off and is armed separately. Presets restore the
complete rig settings without stopping Play or switching Audio on/off.
Editing a control shows Custom. The pancake tour flips, scoops, stacks and
peels its imported cakes with the downloaded spatula; its contact sounds
follow that same sequence. Ant footsteps follow the six imported VFX
hip/knee chains or the Worker's own three-stride Walk clip instead of moving a
static pose across the stage. The Worker also plays its original dig clip.
The [source-animation audit](source-animation-audit.md) distinguishes original
clips from new joint controls and records the source clips not yet exposed.

The selected animal/kitchen GLBs, their credited geometry and textures are retained
(some textures were downsized for the browser). The moth's **original
279-track, one-second animation is now played**, with editable folds layered
on top; its animation samples match the full-resolution download. A runtime-only
normal correction fixes the Peacock moth's dark left wing; the wing hinges
also compensate for the downloaded mirrored skeleton so equal folds move
symmetrically. Balanced key/fill/rim lights expose the existing texture maps.
The octopus has UVs but no source images; four **selectable runtime 2D
albedo/grain material skins** (reef, luminous abyss, pearl and kelp) and
adjustable PBR roughness/clearcoat coat its original 128-bone mesh. Presets
restore both skin and sheen without stopping Play or Audio. These are
artistic treatments, not photorealistic upgrades or changes to the GLB bytes.

Dragging a Voronoi seed now changes the **actual rendered cell faces** and the
same calculated volume that tunes its voice; choose 2–12 cells and a cube,
octahedron or icosahedron boundary. The procedural lattice now draws its own
connected faces/struts and lets musicians select solid shape, 1–4 units and
0–2 geodesic subdivisions. An icosahedron grows from **12 to 42 to 162
individually playable vertices per unit**; edits and audio use the same node
list. The attributed Diamond and David Hall assets remain downloadable
references, not active surfaces or "live" parts of those stages.
Ant trail/gate/chamber controls affect sound/path, not visible tunnels.
A required **animal/kitchen** download failing still leaves that stage empty.
The lab is *not* seven finished or catalogue-registered instruments.

**Model sourcing:** [free model candidates](free-model-candidates.md) records
the selections and what still needs checking. [Model file attribution,
modifications and license](../../assets/rig-lab/SOURCE.LICENSE.txt) accompany
the actual downloads. The imported octopus has **six long skinned tentacle
chains**, not eight matching arms; the other two playable controls operate
shorter appendages. The moth has independently accessible fore-/hindwing bones.
The approved adarshktk mosquito source had **no skin**: our 21-bone derivative
adds two wings, six two-joint legs, a probe and body joints. David Hall's
previously static download also has a new 13-bone (root + 12 joints) derivative
made from its original facets. Their materials, meshes and new skins remain
under their creators' CC BY 4.0 licenses, not the project's MIT license.

| Brief | The player changes | The world plays | Its own sound |
| --- | --- | --- | --- |
| [Ant Farm](ant-farm.md) | Three imported ant actors; path/gate controls affect sound, not a drawn habitat | Walks and route choices | Contact rhythm through resonant chambers |
| [3D Voronoi Foam](voronoi-foam.md) | Choose boundary/cell count, move 2–12 real 3D clipped cells | A visible slice visits sound-driving volumes | Tunable cell resonances |
| [Deformable Polyhedral Lattice](polyhedral-lattice.md) | Choose polyhedra, connected units and 0–2 subdivision steps, pull live vertices | A pulse visits the same generated joints | Elastic tones controlled by actual edge lengths |
| [Octopus](octopus.md) | Imported mantle and eight appendage controls, four UV skins and material wetness | Pressure pulse and appendage motion | Swells and eight length-dependent resonators |
| [Pancakes](pancakes.md) | Imported pan, stackable cakes, flipper, plate, butter and syrup | Flips, plate impacts and melting | Impact, friction, sizzle and peel |
| [Mosquito](mosquito.md) | Wing hinges, six curled legs, flight path, probing pose | A hover and steerable orbit | Pitch-bending wing tone with leg-controlled air |
| [Moth](moth.md) | Four flexible wings and brush strokes | Fold, flutter and wing-loop motion | Soft membrane modes and papery grains |

**Keep lattice and foam distinct.** The polyhedral prototype pulls connected
struts and selectable solid faces, rather than reading the existing
[Lattice](../../src/pages/lattice.html) line or routing the existing
[3D Graph](../../src/pages/graph-3d.html). Voronoi Foam solves changing
**3D cell volumes and shared faces**, not springy node-edge tension. Ant Farm differs from
[Roach Synth](../../src/pages/roach-synth.html) and
[Spider Synth](../../src/pages/spider-synth.html) by letting a colony change
the *paths it plays*. Octopus replaces the rejected jellyfish candidates in the
lab with eight independent controls (not eight matching arms); the earlier [jellyfish proposal](jellyfish.md)
is retained as historical design notes, not a selected model. Pancakes is a
contact-and-material performance, not a skin for the animal instruments.
Mosquito is a **single continuous airborne voice** steered through space;
Moth is a **two-sided wing-surface and brushing instrument**, not a slower
Mosquito or a Roach Synth wing preset. Their DSP, gestures and motion transports
must remain independent.

## Shared decisions for the implementation passes

- Seven independent IDs/routes are *proposed*, not reserved. The shared lab has
  one page and no independent catalogue entries; do not advertise seven
  finished instruments. When individual routes actually play, add their
  entries. Put owned model, viewer, audio, app, presets and styles in
  `src/instruments/<id>/`, with canonical HTML in `src/pages/`, not at the root.
- Reuse the local Three.js modules already used by Roach Synth and Gesticules.
  Keep **only imported animal and food surfaces**. The two geometrical stages
  intentionally render their own sound-driving solver surfaces, as requested;
  do not introduce a hand-drawn animal or pretend a reference GLB deforms.
  The approved textured mosquito had no skin or
  animation until we processed it with `scripts/rig-lab/rig_mosquito.py`.
  The unselected, unrigged iridescent download is not used. No animal/food
  recordings are assumed here.
- One model/timeline owns each visible contact or deformation and the
  corresponding audio state or event. Camera orbit/zoom never change
  world-space sound.
  Schedule events against `AudioContext.currentTime` with bounded lookahead;
  render frames do not own timing. Use continuous pitch by default, not a
  pentatonic or Western-scale grid.
- Browser Audio starts off and requires the explicit Audio control. World
  motion/transport can continue silently; Audio arm must not start Play, and
  Play, pointer and Space must not arm Audio. Separate manual performance from
  automatic motion where relevant. Pausing automatic motion must not erase
  hand-authored geometry or abruptly kill held sound.
- First slice: one obvious gesture, immediate visual and audible consequence,
  deterministic reset, moderate gain, a small bounded scene, visible selection,
  keyboard/native-control alternatives, and pointer-cancel rollback. Grow
  distinct *complete* presets and full-state bounded randomization later.
  Preset recall changes neither Audio state nor external transport/output level.
- When promoted to standalone instruments, integrate each ID across `src/pages/manifest.js`, site
  registry/catalogue/taxonomy/MIDI-capability records, authored fallback
  navigation, a valid WebP icon, release-file policy, WAX generation, and
  focused Node/Playwright suites. Follow
  [instrument development](../../.agents/skills/morphazoid-instrument-development/SKILL.md)
  and [transport](../../contracts/audio-transport-v1.md); do not copy the
  siblings' MIDI or microphone declarations before those capabilities exist.

## Evidence and unresolved production choices

Inspected Roach Synth and Gesticules pages/viewers/docs and the existing
asset/runtime inventory. There are still no dedicated Mosquito or Moth
instrument routes. Animal/kitchen imports are lazy: missing files leave an
**empty 3D stage**, with labelled sound controls still available; math stages
need no third-party GLB. The mappings are
**artistic prototypes**, not measured ant,
octopus, mosquito, moth, foam, lattice or pancake acoustics; the cockroach wing-rate
study cannot establish rates or timbre for either new insect. Before making
biological claims, acquiring assets, or describing synthesized sound as a field
recording, document species-specific primary evidence and license/provenance.
Human listening, physical-touch testing, and musical usefulness still require
their own pass. The lab's mechanical checks do not establish any of those.

The seven briefs specify first-slice bounds and acceptance scenes, not permanent
product limits. Names, catalogue grouping, eventual MIDI controls, GLB sourcing,
and a richer preset bank remain open until each slice is genuinely playable.

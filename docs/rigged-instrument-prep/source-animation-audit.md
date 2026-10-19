# Downloaded rig and animation audit

Checked against the GLBs actually served from `assets/rig-lab/` on
2026-10-19. **A skin/bone hierarchy is not the same thing as an animation
clip.** Counts below are imported glTF skin joints and animation clips, not
claims about how lifelike the models look in motion.

| Rig Lab model | Imported joints / original clips | What Play actually shows |
| --- | --- | --- |
| Ant Rig VFX (rayray) | 82 / 1 (`CINEMA_4D_Main`, ~0.7 s, 54 tracks) | Its clip is held near 0.22 s as a starting pose; the six imported hip/knee chains get a separate distance-based **authored gait**. The source clip moves other joints but is **not a walk**; do not label the gait as original motion. |
| Worker ant (Msassasa) | 53 / **16** | The original three-stride `Walk` is synced to route distance; the original `dig` clip plays in the digging scene. **14 other original actions are not exposed in Rig Lab.** |
| Peacock moth (Osian CG) | 104 / **1** (`Animation`, 1 s, 279 tracks) | **Original whole-rig clip now plays on the cloned skeleton.** Manual left/right fold, brief brush flash and span are added after sampling it; distal wing joints retain their original keyed motion. The old demo replaced this clip with a sine-wave root flap, so the user's quality concern was justified here. |
| Octopus (Dirk.z) | 128 / 0 | Source skeleton, new runtime tentacle/mantle poses; there is no baked animation to restore. |
| Textured mosquito (adarshktk) | Original: 0 / 0; derivative: 21 / 0 | New skin and live controls on the downloaded mesh; the original wasn't rigged or animated. |
| Icosahedral lattice (David Hall) | Original: 0 / 0; downloadable derivative: 13 / 0 | The derivative remains available but is no longer the Rig Lab stage surface; Play visits generated joints on live Three.js polyhedra. No source motion existed. |
| Voronoi Diamond cluster | 0 / 0 | Available as a static reference, not played: the stage now clips its own cells and changes their visible topology. |
| Pan, pancake stack, spatula, butter | 0 / 0 for each | Downloaded static meshes are moved as objects; not native skeletal animation. |

The Worker's other bundled clips are `Attack1`, `Attack2`, `bite`, `build`,
`drink`, `eat`, `Formic Acid`, `grab/heavy bite`, `idle`, `Jump`,
`Sting(human)`, `Sting(other ant)`, `Trophalaxis`, and
`Trophalaxis(Feed Larvae)`. Playing these as a walk would misrepresent the
artist's motions; they remain available in the GLB for future dedicated
interaction scenes.

**Moth data comparison:** `~/Downloads/animated_peacock_moth.glb` (the
full-size download) and `assets/rig-lab/peacock-moth.glb` have matching
sampler input/output bytes across all 279 animation tracks and matching
channel targets. Their *files* differ because the served version has smaller
textures; its native animation was intact, just ignored until this change.
In browser tests, a non-root wing joint now moves at the authored phase and
the two wing folds still work independently. Pausing holds the clip phase.

This is an inspection of track data and runtime behavior, **not** a
photorealism rating or a claim that the new mosquito/octopus gaits match any
artist's intended motion. File credits, creator links and modifications:
[SOURCE.LICENSE.txt](../../assets/rig-lab/SOURCE.LICENSE.txt).

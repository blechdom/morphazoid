# 3D Voronoi Foam — proposed volumetric instrument

**Status:** independent route is proposed, not implemented. The shared Rig Lab
now renders the solver's **actual clipped 3D cell faces** in Three.js. Choose
2–12 cells and a cube, octahedron or icosahedron boundary: adding a seed or
changing the boundary creates new visible vertices; dragging one retunes its
rendered volume and its sound. The approved ayvlasov Diamond cluster remains
an attributed downloadable **reference**, but its fixed GLB is no longer
rendered in this stage. Suggested later ID/route:
`voronoi-foam` / `voronoi-foam.html`. Unlike existing Lattice, 3D Graph and
2D Blobs, the *measured volumes and shared polygonal faces* of a bounded
three-dimensional partition are the score and the resonator controls.

**Rig Lab action:** pull a seed through the translucent cells. Neighbors
visibly expand/compress, and the held tone bends with computed volume. A
visible sweep plane visits cells in world-space X order while the audio clock
schedules their centroid crossings independently of rendering.

## Performer → model → sound

| Gesture / visible change | Model quantity | Audible consequence |
| --- | --- | --- |
| Drag a 3D seed toward a neighbor | Convex clipped cell volume | Smaller volume raises that cell's resonant frequency smoothly |
| Move seed along sweep axis | Cell centroid X | Shifts its next trigger time and stereo placement |
| Pull a seed to depth | World Z, not camera projection | Changes actual cell boundaries and pitches (future: separate depth panning) |
| Change shared face area by squeezing cells | Face area, not yet measured in Rig Lab | Future: bounded cross-coupling between those two tones |
| Tap a visible cell | Stable seed/cell ID | Auditions its current modes immediately, even while sweep is stopped |
| Move/reverse the slice | World-space sweep position and velocity | Changes event order/density and attack energy; no automatic scale |

For the first approximation, use `f = clamp(f0 * cbrt(V0 / max(V, ε)),
90, 1200)` Hz, where `V` comes from the actual clipped 3D cell and `V0`
is a reference volume. Smooth `f` and bounded coupling in Web Audio.
This is **artistic volume-to-pitch sonification**, not a verified foam acoustic
mode. Do not call a 2D texture or a projected polygon a 3D Voronoi volume.

## Model and time

- Rig Lab clips convex polyhedra against a cube, octahedron or icosahedron
  and the bisector of every other seed; it computes the same finite polygon
  vertices, positive volumes and centroids used in sound. Translucent film
  and outlines show the actual topology. Min seed separation and deterministic
  tie-breaking keep coincident/edge cases finite. **Face area and adjacency
  coupling are not implemented yet.**
- Keep stable seed IDs when topology changes. A face appearing/disappearing
  crossfades its coupling instead of rebuilding the audio graph with a click.
  Dragging a seed must update both rendered faces and sounding pitch while
  the slice continues moving.
- Automatic **Sweep** is one audio-clock-controlled pass over the block; it
  triggers a cell when the plane crosses that cell's centroid (one event per
  pass), with cross-coupling set by its current shared faces. A future "surface
  crossings" mode is separate: do not multiply events silently in the first
  slice. Manual tap/drag auditions independently of Sweep. Audio off still
  permits silent geometry edits and visual scanning.
- Default five visible seeds with nonuniform volumes; continuous pitch,
  medium-paced sweep paused, Audio off and modest gain. Camera orbit changes
  only visibility. Offer orthographic front/side views and precise X/Y/Z
  controls as touch/keyboard alternatives.

## Smallest playable slice and limits

Five seeds, one draggable seed, one audible cell, correct recomputed geometry,
and a sweep that reliably hits that cell. Add other cells, coupling and whole
scene presets *after* the volume-to-pitch relation is both visible and audible.
Candidate scenes: "Open cells" (few broad deep tones), "Packed glass"
(small bright tightly coupled cells), "Skewed sweep" (irregular onset spacing).
Presets change actual seed locations, scan state and timbre, not Audio, camera,
external output, or a compulsory tuning grid.

The lab supports 2–12 real cells and all three clipping solids. Cell and
boundary changes immediately rebuild the visible triangles and outlines
and update the matching voice's volume and frequency. Gestures and sliders
manipulate X/Y/Z seeds; a sweep plane moves on Play. Face-area coupling,
reverse sweep and a physical foam simulation are future work. Budget ≤12 simultaneous cell voices, ≤66 face pairs,
one geometry recompute per input update (throttle visual-only redraw first),
and bounded 100–120 ms audio lookahead. Solve/timestamp music without relying
on `requestAnimationFrame`; cap viewport pixels as in sibling Three.js viewers.
Geometry math lives in a pure testable module; audio and viewer are separate.

**Acceptance scenes:** the cell volumes sum to the selected solid's volume within stated
numeric tolerance; shared face adjacency is symmetric; seeds at the boundary
or coincident never produce NaN/negative gain; shrinking a held cell raises
its measured frequency; dragging its X changes the *next* sweep onset;
rotating the camera changes neither notes nor order; reversed/fast sweeps
admit exactly one centroid crossing per cell/pass, including across frame
stalls; live topology changes and preset switches keep transport and fade
cleanly; Audio off produces silence. Check desktop, portrait, short landscape,
and separately listen for pitch, coupling and preset contrast.

**Evidence/asset boundary:** the visible/sounding cell geometry is custom
deterministic math rendered in Three.js, not the attributed ayvlasov mesh.
That CC BY source remains an optional static reference, not a deformable
model or our own work. No third-party Voronoi library or acoustic measurement
is assumed.

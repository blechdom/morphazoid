# Deformable Polyhedral Lattice — proposed independent instrument

**Status:** editable geometry-and-sound sketch on the shared
[Rig Lab](../../src/pages/rig-lab.html); not a finished standalone route or
catalogue entry. This one has a different causal mechanism from 3D Voronoi
Foam (volumes), Lattice (a line reading geometry), and 3D Graph (traversal).
The stage now renders the same model nodes/edges/faces used for sound, rather
than cloning an invariant download. Choose an icosahedron, octahedron or
tetrahedron, 1–4 connected solids and 0–2 geodesic subdivision steps.
An icosahedron changes from **12 to 42 to 162 separately playable vertices
per unit**; its triangles and struts retopologize with them. David Hall's
[downloaded lattice](https://sketchfab.com/3d-models/3d-lattice-of-icosahedra-and-octahedra-c58fa5bbb8a74ef7ac6fc477715e1fc3)
and the 13-bone derivative built by `scripts/rig-lab/rig_lattice.py` remain
[credited, downloadable references](../../assets/rig-lab/SOURCE.LICENSE.txt).
They are **not** used as the live geometry or as substitutes for it.

**One action:** pull a vertex of a connected solid in 3D.
Connected neighbors yield; measured edge lengths change while a held tone
bends and a pulse plucks the connected structure over time.

| Gesture | Visible mechanism | Sound in the preview |
| --- | --- | --- |
| Drag a joint | Its generated facets, struts and shared vertex bend together | Its actual edge lengths tune a held tone |
| Adjust depth | The selected vertex moves along Z | Edge lengths retune without moving the camera |
| Change neighbor yield | Nearby joint motion follows the pull | Mean strain changes brightness and attack |
| Change subdivision | Creates and exposes new editable joints on real faces and struts | Pulse and pluck now visit/tune the added vertices |
| Pluck or play pulse | An audio-clock pulse traverses generated joints; the visible highlight follows | Short tuned attacks on an unquantized path |
| Orbit the camera | View changes, geometry stays put | No sound or pitch change |

The solver defaults to one icosahedron (12 joints, 30 edges, 20 triangle faces)
and connects up to four units with three bridges per additional unit. Its
indexed Three.js mesh, instanced struts and vertex markers take **the same
positions** sampled for edge strain and sound. A detail change rebuilds
shared edge-midpoint vertices and triangular faces, including new pick handles
and a longer pulse path, without stopping Play or Audio. Spring dynamics with
inertia, retopology of the *download*, face resonance and recorded gestures
are **not** implemented.

For an independent instrument, decide how to solve energy-preserving springs
with damping and collision constraints, which polyhedra may be reconfigured,
how local modes are excited at actual events, and how to keep pitch continuous
without default note-grid quantization. Start with one bounded cell and a
single tension-sensitive voice before scaling up. Preserve direct grips,
keyboard/native alternatives, explicit Audio separate from pulse and
deterministic reset. Validate geometry and audio budgets on phones.

**Evidence boundary:** these resonances are an invented mapping from strut
lengths, not a measured physical lattice instrument.

# Fractal Delay

[Open the instrument](../fractal-delay.html). Its five mappings share one
mic/line, local audio-file and recorded-sample input system based on L-system
Delay Rust. Audio starts off; choose a source and explicitly enable Audio.
Microphone capture has its own permission and on/off control. Mic trim applies
to mic/line; file and sample playback enter at unity. Source, playback and live
levels survive musical preset recall. The reused sample bank retains its
existing credits in [processing input samples](processing-input-samples.md).

## The shared mechanism

Each visible connection is an admitted bidirectional delay waveguide. An edge's
length sets its travel time:

`edge delay = normalized geometric length × Travel time`.

Complex-plane coordinates use the same fixed scale of 2.5 in every scene.
Adding detail never renormalizes the distances already present. Rust compiled
to WebAssembly runs the travelling-wave network inside an AudioWorklet in the
browser; a local Rust service is not required. This implementation does not
provide a native backend or a WAX track-audio connection.

At a junction, equal-impedance scattering distributes arriving waves. Coupling
continuously blends this redistribution with reflection. At zero coupling,
incident waves reflect; at full coupling, a two-edge junction transmits and a
branch scatters. The blend is energy bounded. Boundary nodes reflect, while
Decay supplies a per-traversal multiplier of `decay^length`, so a finite graph
can produce echoes and resonances. At zero coupling the closed ports also
prevent new input from entering the wet network; Dry remains independent.
The sound propagation law is our acoustic interpretation of the graph, not a
property prescribed by the quadratic iteration.

Short travel times make interference and resonance prominent; longer times
make individual routes and returns easier to follow. Pitch offset changes the
wet pickup continuously, without imposing a musical scale or retuning edge
travel times. It is a two-window time-domain transposition after the network,
rather than FFT pitch shifting. Pickup selects an
actual receiver node. The input and receiver are visible on the same graph.

## Five mappings

| Mapping | Mathematical construction | Acoustic routes and limits |
| --- | --- | --- |
| Inverse tree | Each point produces both `±sqrt(z − c)` predecessors. Repeating this construction approaches the selected Julia set. | Parent-to-child connections form the signal tree. They are constructed straight routes, not claimed Julia boundary curves. Complete inverse depths are prepared together. |
| Contour loops | Finite marching-squares extraction of constant escape potential, refined against the actual potential field. | Bidirectional loops connect through explicitly drawn nearest spatial bridges. These bridges make lobe proximity consequential; an isolated uniform loop otherwise responds to perimeter rather than its curls. |
| Orbit routes | Follow `z → z² + c` from the critical point and detect finite approximate returns. | Detected cycles include an actual return edge. Nonperiodic or escaping orbits become finite open routes with reflective ends. A fixed critical point uses a disclosed small perturbation rather than a fabricated nonzero cycle. |
| Ray lattice | Trace the negative numerical gradient of escape potential toward the set and combine it with equipotential loops. | Finite ray samples and contour vertices join through explicitly drawn spatial bridges. This is a numerical approximation; it does not claim exact external angles or boundary landing points. |
| Fractal chamber | Sample the filled silhouette and retain its largest connected chamber as a four-neighbor mesh. | Actual grid-neighbor waveguides form the chamber. Julia dust without resolvable filled interior uses an explicitly thickened potential neighborhood. The chamber is a geometric waveguide model, not an exact continuum membrane simulation. |

The Mandelbrot set is a parameter map: a point `c` selects a quadratic Julia
system. Inverse trees and forward orbits always show that selected Julia
dynamics. For contours, rays and chambers, Julia uses the fixed selected `c`;
Mandelbrot instead uses the parameter-plane potential or filled silhouette.
Changing `c` in those Mandelbrot mappings moves the excitation selection rather
than deforming the Mandelbrot set itself.

## Controls, presets and continuity

The complex parameter spans real −2…1 and imaginary −1.5…1.5. Detail spans
2…12; higher requested detail requires more graph edges or grid resolution.
Travel time spans 0.05…2,000 ms per normalized geometric unit. Coupling spans
0…1, Decay 0…0.98, Pitch offset −24…24 semitones, and Pickup 0…1 along the
indexed graph. Twenty complete musical presets cover four starting points per
mapping. Random changes every musical field within its bounds, while retaining
the live source, levels and device state.

Travel time, Coupling, Decay and Pitch offset are live scalar changes; they do
not regenerate topology. Geometry preparation runs in a separate worker with
latest-revision guards. The complete new playable graph is admitted at once;
preparation is not an animation of generations progressively becoming active.
Fractional delay readers have a one-sample minimum. Travel changes use a 35 ms
smoothing response and bounded read-head velocity; the resulting tape-like
Doppler glide is part of a moving-delay interpretation. The bidirectional rings
reserve the full travel-time range with geometry headroom. Geometry changes
retain compatible route histories; newly created routes start empty and fill
according to their actual propagation times. Network replacement crossfades
the old and new output over 64 ms. Admission happens together; physical signal
arrival can still occur later on longer new routes.

Capacity depends on both graph workload and the total edge length that needs
two-way delay storage. A voice count alone cannot describe waveguide memory.
Admission reduces whole inverse depths, coherent contour/ray resolution or
whole mesh resolution. The graphic displays the admitted network; it does not
append a larger decorative graph that the audio engine cannot process.
Finite sampling, delay storage and output protection remain explicit bounds.

## Research and acceptance

The quadratic map, inverse iteration and distinction between parameter space
and Julia dynamics follow [McClure's inverse-iteration algorithms](https://marksmath.org/scholarship/papers/Julia.pdf)
and [Lindsey's Julia/Mandelbrot introduction](https://pi.math.cornell.edu/~klindsey/presentations/MandelbrotPresentation.pdf).
The connected scattering/delay interpretation follows the
[digital waveguide mesh](https://ccrma.stanford.edu/~jos/pasp/Digital_Waveguide_Mesh.html).
Contour extraction, ray tracing, finite silhouettes and acoustic bridge rules
are numerical or artistic interpretations described above.

The catalogue icon is a raster rendering of this instrument's own vector
model, generated with code. It contains no third-party artwork.
Automated checks can establish bounded PCM, control sensitivity, source and
state continuity, responsive layout and mathematical identities. Human
listening, physical microphone and touch-quality acceptance remain separate
and unperformed unless a subsequent receipt records them.

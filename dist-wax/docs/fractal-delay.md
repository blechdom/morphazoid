# Fractal Delay

[Open the instrument](../fractal-delay.html). Its five mappings share one
mic/line, local audio-file and recorded-sample input system based on L-system
Delay Rust, plus a synthesized Impulse source from the L-Systems Notes engine. Audio starts off; choose a source and explicitly enable Audio.
Microphone capture has its own permission and on/off control; it can meter
silently and never arms Audio. Mic trim applies
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

**Path echoes** is the default Sound interpretation. Each arrival continues
into the other connections at its junction, splitting into branches without
the sign-inverting reflections of the resonant model. Coupling blends this
forward travel with immediate return along the incoming connection. A leaf
returns through End return; Sustain still applies `decay^length` on traversal.
All admitted connections participate, including the visible loop/shortcut/hub
routes. Crossings that merely overlap on screen are not additional junctions.

Three compact controls make the visible geometry consequential:

- **Angle pitch** gives each directed connection a continuous shift of
  `Angle pitch × sin(heading)` semitones. Upward travel raises pitch, downward
  lowers it, horizontal travel adds no shift, and reverse travel reverses the
  shift. A journey accumulates these local shifts; **Pitch** remains a separate
  transposition of the combined wet output. Neither mapping quantizes notes.
- **Path taps** blends the selected Listening ports with delayed arrivals
  throughout the complete prepared network. At zero only the selected pickups
  are heard; at 100% every connected node is monitored. The whole-network
  coefficient vector has unit L2 norm across incoming directions, rather than
  dividing each distant tap by the full node count. Monitoring does not change
  feedback or inject an undelayed source into the output. The default 65%
  retains a 35% contribution from your selected listening points.
- **Bend tone** darkens sharp turns and endpoint returns. At a junction with
  several routes, it uses their mean continuation direction, excluding the
  connection being returned through. A straight continuation stays open;
  zero disables this additional filtering. New external excitation bypasses
  bend filtering, so Network drive still feeds the requested source level.

Direction pitch is a two-window time-domain read inside each travelling delay,
not FFT processing. Its adaptive grain fits the existing 25% reserved history
headroom, so it adds no per-edge delay memory. With Angle pitch zero the first
arrival follows the geometric travel time. With pitch active, grain lookback
can smear an arrival by up to 25% of that connection's nominal time (also bounded
by a 110 ms grain span). Extremely short paths cannot support a meaningful
independent pitch window and instead behave as short-delay coloration. The
graphics sample the actual processing histories and arrival readheads; there
is no separate animation clock for these journeys.

**Resonance** retains the original sound interpretation. At a junction,
equal-impedance scattering distributes arriving waves. Coupling
continuously blends this redistribution with reflection. At zero coupling,
incident waves reflect; at full coupling, a two-edge junction transmits and a
branch scatters. The blend is energy bounded. Source injection is independent
of Coupling. End return sets reflection at degree-one endpoints: zero absorbs,
one reflects. Decay (the Sustain knob) supplies a per-traversal multiplier of
`decay^length`, so a finite graph can produce echoes and resonances. Circulation
already exists in the bidirectional paths and loops.
The sound propagation law is our acoustic interpretation of the graph, not a
property prescribed by the quadratic iteration.
Angle pitch, Path taps and Bend tone are retained but inactive in Resonance.
Short-delay factory resonators keep this interpretation; longer echo presets
use Path echoes. Saved snapshots from before these controls restore Resonance
with zero new mappings. New parameter captures use version 4 and include the
four sweep settings, the explorer view and the live tempo-latch preference. The captured c values become the new starting center;
live Play/Pause states remain separate transport state.

Short travel times make interference and resonance prominent; longer times
make individual routes and returns easier to follow. Pitch offset changes the
wet pickup continuously, without imposing a musical scale or retuning edge
travel times. It is a two-window time-domain transposition after the network,
rather than FFT pitch shifting. Inputs and receivers occupy actual graph nodes,
shown by green source markers and orange pickup markers.

## No decay and synthesized impulses

**No decay** in Network opens the forward paths: Path echoes, 100% Sustain,
Coupling, Path taps and End return, with Bend tone at zero. An impulse can
traverse the complete connected shape and circulate through its returns.
The toggle changes live audio controls without rebuilding the graph or clearing
its travelling sound. Switching it off restores the previous loss settings;
Sustain remains adjustable from zero through 100%.

No configured decay is not a promise of equal loudness at every point or an
infinite constant waveform. Junction splitting and pitch interpolation can
still reduce amplitude; branching normalization and the output limiter remain
active. Angle pitch remains available. Set it to zero to compare unpitched
travel or constant-amplitude circulation on a simple loop.

Choose **Synth impulse** under Input. **Send** launches one note;
the circular **Play/Pause** repeats notes at the **Repeat tempo**, with the
shared Tap control. Audio must be armed separately. Pause stops future
excitation and lets the network's existing sound continue. Audio off mutes the
instrument and stops the source. Switching to mic, a file or a sample cancels
its repeat transport; switching back is ready for a fresh Send or Play.

The sound settings reuse the existing L-Systems sine, triangle, square, saw,
FM, PM and Shepard voices, with frequency, modulation index/ratio, tone filter,
ADSR/hold, Shepard motion/width and level. Modulation applies to FM/PM and
Shepard settings to Shepard. Envelope stages share the synth's four-second
maximum; excessive stage times are fitted proportionally and reflected in the
knobs. Repeat notes are scheduled against the AudioContext clock with an 85 ms
lookahead, independent of drawing. Tempo edits retain beat phase; a long UI
stall skips missed attacks rather than replaying a backlog.

The synth borrows the network's AudioContext and feeds only its input, through
Network drive. Direct input at zero hears only the delayed output. Mic trim
does not attenuate the synth. Musical preset selection, Next and randomize
retain the selected source, impulse sound and repeat state. Copy parameters
includes the impulse settings, without persisting a live playing state.

## Fractal explorer and coordinate controls

The graphic is split evenly: a Mandelbrot/Julia explorer on the left and the
installed audio routes on the right. The chooser, region presets, Zoom, and
both coordinate motion rows share one compact control area. There are 13 region
starting points, including full sets, folded coasts, islands, fine spirals and
Julia filament close-ups. These are visual invitations rather than claims of
exact periodicity.
The region Next button remembers the last chosen area while motion changes c,
so it visits every region and skips the Custom view placeholder.

The coefficient boxes accept typed values and show the current real and
imaginary numbers. While a box has focus, its draft is preserved as motion
continues; Enter commits its value as a new sweep center. Each axis has its own
circular Play/Pause, tempo knob, Tap and Sweep. Latch links tempo edits in either
direction, including native keyboard and Tap edits; it leaves the two phases,
Play states and sweep reaches independent. Enabling Latch uses the Real tempo.
A main sound preset with unequal authored rates releases the latch so it can
recall exactly. The sound-preset snapshot format stays compatible with earlier
captures; Copy parameters adds the view and latch alongside the musical state.

On the Mandelbrot image, click or drag selects c. On the Julia image, drag
changes c relatively; a simple click keeps the coefficient because Julia image
coordinates are z rather than c. Shift makes the drag finer, Alt or middle
button pans, the wheel and plus/minus keys zoom, and Escape or Whole returns
to the full view. Arrow keys edit c and become finer with explorer zoom.
Region selection applies its suggested coefficient without restarting input or
arming Audio. Zoom, pan and switching the displayed set only change the view;
Delay domain still chooses the Julia/parameter-plane construction for the
applicable sound mappings.

Image calculation stays in a worker with one active render and one latest
pending target. It is bounded to 360 pixels per edge (240 while Audio or
coordinate motion runs), 64–384 iterations, and at least 100 ms between
submissions (150 ms while Audio or coordinate motion runs). Bounded row chunks
yield through messages rather than chained timers, so idle timer delays do not
accumulate between rows. Mandelbrot pixels do not recompute when c moves. View gestures
transform cached images immediately while the next image completes. Up to six
rasters retain wider views beneath recent detail; Julia rasters are kept only
for the same coefficient. Drawing crops each raster to the visible canvas,
including at maximum zoom, and skips covered background layers. Newly exposed
areas outside all cached views still need a new calculation; deep zoom retains
finite resolution and iteration limits to protect audio processing. The
actual travelling-wave graphics retain their separate audio-aligned renderer.

The masthead uses Morphazoid's shared Choose and next-instrument navigation,
including Faves, search and keyboard dismissal. The Rust/WASM controller owns
its audio lifecycle independently from the pure navigation enhancement.
Faves-only instruments remain searchable; only Faves rows duplicated in other
groups are suppressed during filtering. The exact shared-menu amendment is
recorded in `fractal-delay-navigation-runtime-changes.json` without changing
historical navigation reference hashes.

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

## Excitation, listening and optional connections

One mic, file or sample source can excite a single point, a local cluster,
distributed points, boundary points, or the whole admitted shape. Input position
moves the anchor through stable construction order from the original source.
Input count selects up to 256 points in grouped modes, bounded by the prepared
nodes; Whole shape uses every prepared node. Input spread controls the spatial
selection of grouped excitation. Distributed mode chooses coverage with
farthest-point sampling. Boundary mode uses base terminals, mesh perimeter or
outer hull, as appropriate to the mapping. It does not claim an exact analytic
Julia boundary.

Input weights have unit L2 norm, with each node's injection divided among its
incident edges by the square root of degree. This keeps adding ports from
simply multiplying injected power. Listening likewise supports single, local,
distributed or whole-shape pickups, with position, count and spread. Pickup
weights have unit L1 norm; they form a weighted receiver average. Cancellation
and reinforcement depend on the actual travelling wave phases. An orange ring
indicates a receiver sharing a green source node.

Network drive boosts the external source entering those excitation points,
after mic/line gain or unity file/sample playback. It ranges from −12 to +24 dB
and starts at +12 dB (about four times the source amplitude). It does not multiply
reflections or feedback. Actual graph pressure and the travelling-wave display
respond to this stronger excitation. Direct input independently sends the
unprocessed source to the speakers; it starts at zero, so playback initially
contains only the effect. Increasing Network drive does not increase this direct
signal. Both controls sit beside the input source, smooth live edits over 35 ms,
retain their values across musical and mastering presets, and appear in captured
live levels.

Delay gain amplifies that collected receiver signal before pitch processing,
effect/direct summing and mastering. It ranges from −12 to +48 dB and starts at
+24 dB (about 16 times the receiver amplitude), so the normalized delay return
can be substantially louder than the direct input. The gain follows live edits
over 35 ms and sits outside the feedback network: it changes listening level
without increasing excitation or the circulating wave energy. The shared final
compressor and output ceiling still apply. Delay gain is a live level retained
across musical and mastering presets, and is included in captured live levels.

The [Graph Delay instrument](../graph-delay.html) supplies routing inspiration:
multiple entry/exit nodes, rings, small-world shortcuts and hubs. Connections
can retain the original fractal routes or add loop joins, sparse long shortcuts,
or hub spokes through existing nodes. Link density controls added connections.
These are visible acoustic connections drawn in cyan, with their actual
geometric lengths setting their delays. They are artistic network extensions,
not additional mathematical Julia or Mandelbrot edges. Admission counts and
delay-history memory include every added connection; the model reduces a
complete structure when needed.

## Controls, presets and continuity

The complex parameter spans real −2…1 and imaginary −1.5…1.5. Detail spans
2…12; higher requested detail requires more graph edges or grid resolution.
Travel time spans 0.05…2,000 ms per normalized geometric unit. Coupling spans
0…1, Decay 0…0.98, Pitch offset −24…24 semitones, and Pickup 0…1 along the
indexed graph. Forty complete musical presets retain the original four
starting points per mapping, eight multiport/routing scenes and twelve bolder
journeys. Rabbit Slingshot, Two-Step Thunder and Four-Way Carousel use longer
returns; Orbit Torrent follows a long open route. The newer paths use stronger
continuous angle pitch, broader listening coverage and lighter bend damping,
with sparse excitation so successive arrivals can be heard. Root Cloud starts
with a stronger path interpretation. Random
changes every musical field within its bounds, while retaining
the live source, levels and device state.

Each c axis has independent **Play/Pause**, **Tempo** and **Sweep** controls.
Motion starts paused and never enables Audio or microphone capture. Tempo is
0.25–60 BPM: one beat is one complete back-and-forth round trip (6 BPM takes
10 seconds). Shared Tap sets that same physical rate. Sweep is the distance
on either side of the starting c value, from zero to ±1.5, clipped to the
coordinate bounds. The motion follows a continuous sine with no jump at
startup or pause/resume; tempo edits retain phase. Moving c or changing Sweep
chooses a new center at the current pose. A preset restores its c and four
motion settings while retaining each axis's live playing state.

Sounding motion uses `AudioContext.currentTime`; visual-only exploration uses
a monotonic performance clock. One shared 50 ms timer advances both phases
independently of rendering. At most ten new geometry requests per second are
sent, with only one motion scene outstanding through its installed Rust
acknowledgement. A busy worker skips intermediate poses and next prepares the
current pose; it does not accumulate old targets. The renderer adopts that
same installed graph. Dense numerical contours/chambers can therefore update
more slowly than simple orbits, while the sweep clock keeps its tempo.
For Mandelbrot contours/rays/chambers, motion moves the excitation selection
through the fixed parameter-plane graph rather than deforming it.

Motion geometry is still admitted against its measured cost and real delay
storage. The worker's exact-geometry cost cache holds at most 32 entries. Its
offline benchmarks reuse one WASM allocator with a fresh Rust engine per
trial, so prior histories/crossfades do not contaminate measurements. Allocated
WASM pages retain their high-water mark; this is separate from the live audio
instance. Source playback, live gains and the audio context stay in place
through motion and preset changes.

Travel time, Coupling, Decay and Pitch offset are live scalar changes; they do
not regenerate topology. End return is also a live scalar. Port selection
reuses the admitted geometry in the worker, then retargets source and receiver
weights in Rust over 35 ms without replacing histories or resetting the clock.
Coefficient knobs and explorer drags update during the gesture. Geometry
preparation runs in a separate worker, with one graph in flight through its
Rust installation acknowledgement and only the newest waiting target retained.
New pointer positions cannot cancel a graph before it becomes audible and
visible; intermediate positions are skipped when preparation is slower than
the gesture. Audio startup uses the same queue. Source playback and live levels
remain independent of these edits.
The complete new playable graph is admitted at once;
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
The device memory envelope is 48, 96 or 192 MiB based on the browser's device
memory hint (96 MiB when unavailable). Half is available to each scene so
current and replacement networks can coexist. These are application budgets,
not a claim to have measured all available system memory. A worker benchmarks
the actual Rust graph with the maximum path mappings and Travel time to select
a steady processing target with room for a transition. Live scalar edits keep
that admitted graph instead of recalibrating capacity during the gesture.
The test budget can bypass that CPU target while retaining memory
and finite model bounds. It never changes automatically as sound gets louder.
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

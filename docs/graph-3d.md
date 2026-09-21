# 3D Graph — September 20, 2026

A separate **Works in progress** instrument built on Graph Synth. The existing
2D Graph Synth/Drums/Graphs pages and shared DSP modules are unchanged.

## Play

1. Enable **Audio**, then **Play** for recurring injections, or **Send note**
   to audition one traversal from the selected node.
2. Drag the empty stage to orbit. The camera changes the view, not the music.
3. Open the **ⓘ** button beside the title for instructions. Drag a node to move it
   in the screen plane. Shift-drag or **Drag into depth**
   moves it along the camera's depth axis. World X/Y/Z sliders are precise
   alternatives. Use brackets to select nodes, arrows to orbit, Shift+arrows
   to move, Enter to send, P to toggle its pin, and Space to toggle Play.
   Dragging, keyboard moves and sliders pin the edited node automatically; it
   stays there under forces. Unpin explicitly to release it. Cancelled gestures
   restore the exact original local position and pin state; clicks only select.
4. Enable **Let forces move the nodes** and compare spring length, repulsion,
   center attraction and shell attraction. Forces can move silently with Audio
   off; changing a force does not implicitly start Play.
5. Click a route midpoint or use the route selector/switch to disable it.
   Disabled routes are visually marked and do not conduct new events.
6. Front, Side, zoom, Orbit and View reset affect only the camera. Arrange
   restores unpinned nodes to the selected layout.

## What's new in the third dimension?

| Organizing control | Spatial consequence | Musical consequence |
| --- | --- | --- |
| Depth spread | Expands local Z before twist | Changes true 3D edge lengths, depth mapping and shading |
| Helical twist | Rotates horizontal slices by their height | Changes distances and bends without changing connectivity |
| Spring rest length | Connected pairs prefer a selected separation | Changes traversal timing; stretched edges can change FM/PM index |
| Node repulsion | Pushes all nodes apart with softened distance-dependent force | Opens the spatial rhythm and distribution of pitches |
| Center attraction | Draws nodes inward | Compacts route lengths and radius-pitch range |
| Shell attraction | Pulls toward a spherical shell rather than a point | Organizes spatial layers and route crossings differently |
| Pin | Keeps a node's local coordinates fixed under forces | Provides anchors around which the rest reorganizes |

These are bounded artistic graph-layout forces, **not a claim of acoustic
physics**. They do not generate new connections. The supported deterministic
graph generators are reused from `src/instruments/graph-delay/graph-delay.js`; layouts are sphere,
helix, layers and cube. Thirty presets (six original plus 24 additions) explore different structures,
articulations, tempos, force settings and assignable sound mappings.
The initial seed is **MIDI pitch 68** and tuning is **Continuous**. Every preset
uses continuous tuning; Western scales remain opt-in. Forces initially stay off. Presets keep the Audio and Play controls independent.

## Assignable sources → sound

The mapping section is immediately below transport/preset recall. Each row has
an independent source menu and amount. X, Y, Z, route length, radius, stretch or
Off may feed each destination; pitch also supports accumulated 3D bends.

| Destination | Default source | Amount / behavior |
| --- | --- | --- |
| Travel time | XYZ route length | Time multiplier; higher source values wait longer |
| Pitch | Y height | Continuous octave span about the seed frequency |
| FM / PM color | Incoming route stretch | Adds up to 6 × Color amount to the base modulation index |
| Brightness / level | Z depth | Lower source values become darker and slightly quieter |
| Stereo pan | X left/right | Stereo width; low values left, high values right |

These are **world** coordinates, never camera coordinates. For timing, X/Y/Z
mean the absolute distance traveled along that axis, normalized by 2.6/2/2.6.
For pitch/color/shading/pan they mean the arrival node's signed position,
clamped to −1…+1. Axis color values are remapped to 0…1.

- **Route length** is Euclidean XYZ distance divided by a fixed reference cube
  diagonal `2 × sqrt(3)`, clamped to 0…1. Timing uses that value; pitch and pan
  remap it to −1…+1. This is not the line's projected screen length.
- **Radius** reads distance from the origin. Timing normalizes it by `sqrt(3)`;
  pitch/pan use `clamp((radius − 0.55) × 1.5, −1, 1)`.
- **Stretch** compares world-space route length with the spring-rest reference:
  `clamp(abs(length − rest) / rest, 0, 2)`. Timing/color divide by two;
  pitch/pan remap to −1…+1. The solver uses local/pre-transform coordinates,
  whereas this sound source deliberately uses the transformed geometry.
- Travel time is `minimumTime × (1 + source × (multiplier − 1))`, bounded to
  25 ms…2 s. Source Off or multiplier 1 makes all hops equally long. Tempo
  controls injection spacing, not individual route delays.
- Continuous pitch is `seedHz × 2 ** (bipolarSource × pitchSpan)`. MIDI's note
  number supplies only the reference frequency: pitches are not rounded unless
  the performer explicitly selects a scale. At span zero or Pitch Off, the
  seed is held. Extreme bends may leave the shared renderer's audible range.
- **Accumulated 3D bends** sum signed angles between consecutive travel vectors.
  Magnitude is spatial; sign uses the bend normal's Y component. Bends exactly
  in a vertical plane are positive by convention. This is not an intrinsic 3D
  winding number or torsion invariant. Pitch span sets the octave travel per
  full signed turn.
- Incoming route length/stretch are sampled at departure and carried with the
  event; the injected note has zero incoming values. The node frequency preview
  uses its first enabled incoming route (or zero) and zero accumulated bends;
  actual multi-route arrivals can differ.
- FM/PM color is inactive for Sine, Triangle and Shepard voices. Shading is an
  artistic filter/level mapping, not a physical HRTF or distance model. Off
  disables each source independently; it does not mute the instrument.
- Return level / brightness use Graph Synth's cycle-feedback conventions.
  Acyclic paths finish rather than inventing returns.

## Preset listening map

Presets replace geometry, pins and route switches reproducibly, but keep Audio,
Play and camera state. They do not restrict subsequent edits. All use Continuous.
These descriptions state design intent, not human listening approval.

| Preset | Contrast to explore |
| --- | --- |
| Orbital branches | Default Y pitch, XYZ timing, stretch color |
| Helical return | Ring returns and depth pitch |
| Floating canopy | Sine branches with longer decays |
| Elastic cube | Live repulsion and springs, radius pitch |
| Flat to folded | Compressed depth and twisted PM paths |
| Turning constellation | Signed bend accumulation across islands |
| Glass meridian | Y travel → time, X → pitch, Z → color / pan |
| Low orbit | Low sine ring and radius shading |
| Wire rain | Short PM drops, Z travel → time |
| Slow prism | Sparse long attacks; length → pitch |
| Crosswind | X travel → time, Z → pitch, Y → FM |
| Equal crossings | Uniform hop times without pitch quantization |
| Shell choir | Live shell forces, radius pitch, slow sine envelope |
| Taut metal | Stretch drives both timing and metallic FM |
| Velvet helix | Low smooth sine chain; radius → time |
| Sideways clock | Fixed pitch, irregular X timing, height color |
| Depth pebbles | Low short FM; length pitch and Z timing |
| Folded fan | Thin twisted layers and accumulated bends |
| Polar lanterns | Sparse bright islands, Y shading, Z stereo |
| Spring insects | Fast moving PM with stretch pitch / timing |
| Hollow cube | Low sine branches, X timing, Z pitch |
| Spiral mirage | Shepard voice with bend accumulation |
| Long shadows | Slow centered triangle chain, X pitch, deep shading |
| Bright splinters | High short FM, dense DAG, uniform hop times |
| Breathing islands | Long sine envelopes, moving radius timing / pitch |
| Inside out | Stretch pitch/pan, length FM, radius shading |
| Zigzag relay | Long chain, small bend steps, short PM |
| Still frequency | Fixed seed with height-driven FM variation |
| Orbit dust | Dense moving Shepard paths, short Z-driven hops |
| Wide apart | Five nodes, wide continuous pitch and long XYZ delays |

## Reuse, scheduling and state ownership

`src/instruments/graph-3d/graph-3d.js` reuses the existing topology generators, split/merge and
feedback gains, `graphSynthVoice` tuning/voice conversion, and
`rotatePoint3`/`projectPoint3` from the solid instruments. Its separate
spatial model and bounded frontier scheduler leave the 2D code unchanged.
`graph-3d-app.js` uses the existing **GraphSynthAudio** renderer, output
manager, shared Audio strip, navigation and MIDI adapter.

Automatic note injection and graph arrivals are handled by a 20 ms scheduler
with 120 ms AudioContext lookahead. The animation callback paints only.
Long UI stalls discard stale attacks instead of dumping them into the present.
Native voice envelopes already scheduled in Web Audio continue independently;
the instrument does not claim unlimited glitch-free lookahead through arbitrary
JavaScript suspension.

An already scheduled hop keeps its departure time and endpoint snapshot.
Each following hop uses the current graph. Node motion therefore changes future
routes without restarting a traversal. Topology/node-count/seed changes clear
incompatible pending events and fade voices, while Play remains engaged.
Already submitted sound may remain for up to the lookahead after route changes.

Bounds: 3–24 nodes; at most 192 generated edges (the chosen generator families
fit without hidden pruning); 1,024 pending events; 12 runs; 160 admitted events
per run; 48 hops; 8 cycle returns; 16-second per-run horizon; 24 submitted
arrivals per scheduler service. Shared renderer voice/source-rate protections
remain in place. Dense graphs can shed repeated attacks, never silently
change the visible topology. Audio defaults off. Hidden/page-exit lifecycle
stops transport, clears tails, and releases the context.

The patch store is a versioned browser-local record of settings, positions,
pins and route switches. Load validates transactionally. Older version-1 patches without the new
source fields acquire XYZ timing, stretch color, Z shading and X stereo defaults. It never restores an
AudioContext, held notes, playback state, camera state or pending event queue.
No microphone, recording, automatic graph analysis, or MIDI output is claimed.
Incoming MIDI notes inject a selected-node traversal through the shared
cancelable input event. Real MIDI hardware and real WAX-host behavior remain
separate device checks.

## Acceptance

Test the XYZ timing against paths with identical XY projection but differing
depth; camera invariance; view/drag round trips; deterministic and bounded
forces; pinned nodes; independent route switches; finite acyclic completion;
bounded cyclic decay; no stale bursts after a stall; transactional patch recall;
audio/transport separation; source/pan/timbre leverage; 1440×900, 390×844 and
844×390 layout and pointer/keyboard handling.

Human listening, real-controller feel and physical-phone performance cannot be
established from headless tests alone. This is an expressive graph instrument,
not a validated scientific model.

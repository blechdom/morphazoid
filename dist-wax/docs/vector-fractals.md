# Vector Fractals — configurable contour readers and XY sound

Open `/vector-fractals.html#explorer`, `#julia`, `#mandelbrot` or `#voyager`. These demos are
an independent work in progress; existing Julia and Fractal Synthesis instruments
are unchanged. Enable **Audio**, then **Play**. Audio and transport are separate.

## What to try

- **Contour Explorer:** scroll/pinch to zoom and drag to pan. Arrow keys pan,
  +/− zoom, and Home or Whole returns to the full outline. Jump to Seahorse Valley
  or Seahorse filigree for dense structure, or choose **Fractal → Julia** and a
  named **Julia shape**. Julia coefficient exposes editable real/imaginary parts
  of `c`; commit a number with Enter or by leaving the field. Both are bounded
  to `[-2, 2]`. Shape selection restores the whole view and default Edge detail
  while preserving reader, voices, drums, mappings, speed, pitch and transport.
  Manual coefficient edits retain the camera. Whole/Home fits the current set.
  A quick vector preview appears first,
  followed by finer contours calculated for the current region. Edge detail
  moves the sampled level closer to the set; Fine increases spatial sampling.
  Click a strand or use Next strand to choose the sound source. Save SVG exports
  the completed visible paths, keeping cropped paths open. **Trace** plays Broad,
  Curl and Fine contour levels together. **Traveler** maps the signed turns of
  each border to pitch; try the **Border traveler** preset. **Radar** sweeps a shared ray, and
  **Scan** sweeps a line out and back. Each level has independent Tone and Drum
  switches and voice choices, plus a whole-layer mute. Open Contour mappings,
  Drum beads and Shepard motion to adjust their behavior; zero mapping amounts
  disable those mappings. Try Radar percussion, Scan and shimmer or Endless ascent.
  Set Cycle rate independently of Pitch. Choose **XY oscillator** to read one
  strand as a periodic waveform instead.
- **Julia Vectors:** start with Pure circle, then Ellipse. Both have only the
  fundamental under external-angle traversal, despite different aspect ratios.
  Basilica and Rabbit add counter-rotating odd harmonics. Cardioid explorer
  exposes excursion and position within a known connected-Julia parameter region.
- **Mandelbrot Contours:** compare Rounded orbit and Close encounter. These are
  approximations to the full Mandelbrot exterior map, not just the main cardioid.
  Compare external-angle and constant-distance scans of the same contour.
- **Bulb Voyager:** a point travels inside the main cardioid or period-two bulb.
  That point supplies `c` for a changing Julia oscillator. Compare slow Cardioid
  drift, Period-two tide and Fast bloom. The small diagram is the parameter plane,
  not another audio waveform.

Clearance is the exterior radius `r>1`; decreasing it reveals structure. Detail
caps the source harmonic index (quadratic Julia uses odd indices). Pitch is
continuous, not scale-quantized. Rotation mixes XY; Mono sends the rotated X
projection equally to both speakers. The colored plot then collapses to X=Y.
Drag left/right to rotate and up/down to change clearance; arrow keys do the
same. Knobs remain native ranges with keyboard access. Vectors and Source contour
are display switches only. Preset changes, randomization and Reset preserve master
level and live Audio/Play state. Reset restores the current demo and voyage origin.

## Mathematical model and provenance

### Progressive Contour Explorer

The explorer samples the exterior Green potential of `z -> z*z+c`. Mandelbrot
uses `z0=c` while varying `c` across the parameter plane. Julia fixes `c` at the
chosen coefficient and starts `z0` at each sampled position in the dynamical plane.
After escape both evaluate `log G = log(log |z_n|) - n*log(2)` and extract a negative level with
marching squares and refined edge crossings. The level moves closer to the set
as the view narrows; it is recomputed, not a magnified stored SVG. The finite
iteration limit and spatial grid make these approximations: narrow connections
can fall between samples and appear as separate closed loops. Neither topology
nor every filament is certified. More sampling reveals additional structure.
The cardioid/period-two interior shortcuts apply only to Mandelbrot. Julia
iteration bounds use the fixed coefficient, and multiple disconnected sampled
paths remain separate. These do not rely on the limited Fourier family list.

Julia shape coefficients are reused from
[`JULIA_PRESETS`](../src/instruments/julia/julia.js) in Morphazoid's Julia instrument:

| Shape | Real c | Imaginary c |
| --- | ---: | ---: |
| Basilica | -1 | 0 |
| Douady rabbit | -0.12256116687665361 | 0.7448617666197442 |
| Co-rabbit | -0.12256116687665361 | -0.7448617666197442 |
| Airplane | -1.7548776662466927 | 0 |
| San Marco | -0.75 | 0 |
| Cauliflower | 0.25 | 0 |
| Golden-mean Siegel disk | -0.3905408702184 | -0.5867879073469687 |
| Spiral · finite depth | -0.7 | 0.27015 |
| Listening default | -0.788 | 0.1191 |
| Unit circle | 0 | 0 |

The Siegel coefficient is `λ/2 − λ²/4`, with `λ = exp(2πi(√5−1)/2)`.
Spiral's critical orbit escapes; it is a disconnected Julia set whose finite
positive-potential outlines remain playable. Tiny components may be lost at a
finite grid/depth; Fine refinement helps but does not certify topology. Airplane
also benefits from Fine. Listening default and Spiral are sibling instrument
scene names. Mandelbrot's Region menu retains camera locations, not fixed Julia
coefficients. SVG metadata records the domain, Julia coefficient where relevant,
camera and all exported potential levels. Shape selection is a focused geometry
change; the main preset menu continues to recall complete musical scenes.

A cancellable worker sends a coarse preview and a completed refinement. Camera
transforms respond immediately while stale calculations are discarded. Sampling
has a 240,000-cell cap, rendering uses view-relative coordinates, and zoom stops
at a view width of `1e-10`. This is ordinary double-precision computation; it
does not implement arbitrary-precision deep zoom. Refinement time depends on
the visible region and device. An offscreen/hidden page suspends refinement.

The selected sampled strand supplies the oscillator. Closed paths use uniform
arc-length traversal. Cropped open paths use cosine-paced there-and-back traversal,
so they never acquire a fabricated closing chord. The 2,048 samples are centered,
transformed and bandlimited through the same mip-bank pipeline as the other modes.
This is an artistic sound mapping of sampled geometry. The main explorer shows
the source strand; the waveform monitor shows the filtered, rotated audio.
Existing sound continues during refinement, then crossfades to the new strand
without resetting the carrier. A completed empty region crossfades to silence.

### Traveler: marching-squares border turns

Choose **Reader → Traveler · turn → pitch**, or the complete **Border traveler**
preset. A directional arrow follows each selected contour at the independent
Cycle rate. Left turns lower pitch and right turns raise it. Each layer starts
at its own top unless you select a starting point by clicking a strand.
**Closed path direction** reverses the traversal of closed borders.

On first activation, Traveler starts at the reference pitch at its current
position; time previously spent in another reader does not transpose it.
**Turn → pitch** sets 0–4 octaves per 360° (default 1). Changes affect future
turns without replaying earlier laps; zero holds the current pitch. Feature size
smooths corner turns over a geometric arc-length window, so subdividing the same
polyline does not add notes or change the mapping. Pitch is continuous and is not
quantized to a musical scale. The angle readout shows the current lap and counts right turns as positive;
the audible pitch continues across laps.

A simple closed planar polygon has net signed turning ±360° per lap. Concave
bends can reverse pitch locally even during a net rising lap. This is accumulated
relative turning, not horizontal position or a wrapped compass heading. We sum
`atan2(cross(incoming, outgoing), dot(incoming, outgoing))` on the original
nonzero segments, retain the actual winding, and extend the smoothed signal
across the seam. The renderer and audio consume the same 2,048-sample control
profile. Fine geometry may still exceed that temporal sampling resolution.
Cropped open paths retrace without a synthetic endpoint corner or closing edge;
their turn signal unwinds to zero over the round trip. Closed-path direction
does not change an open path's deterministic starting endpoint.

Shepard voices use each layer's own accumulated octave motion, including local
reversals. Their partials recycle in both directions, supporting endless travel
through repeated laps. Ordinary Sine/Reed/Glass voices hold at ±4 octaves from
the reference and retain the engine's final frequency bounds. Switching to
Shepard makes continued turning audible after an ordinary voice reaches its
limit. Geometry refinement and direction changes align replacement turn profiles
at the current sounding pitch. Edits and Audio off/on preserve musical flow. Pitch holds while Audio is off;
rearming resumes from that pitch at the current playhead position.

Traveler replaces Height → pitch for sustained voices. Pan, bend/fold timbre,
layer mutes, Tone/Drum switches, voice selection, and drum spacing remain active.
Traveler drums use Drum pitch with the layer's low/middle/high register; no hidden
height mapping affects them. Shepard's time-based rise/fall and travel-per-cycle
controls are hidden in Traveler; Octave spread still shapes the Shepard sound.

### Shapes-inspired layered readers

Trace treats the contours as slow musical paths. Three sampled Green-potential
levels are visible together, colored amber (Broad), violet (Curl) and cyan (Fine).
These are potential levels in the chosen Mandelbrot or Julia plane, not discrete
recursive pullback generations. Refinement still has finite spatial resolution; increasing
depth cannot recover filaments smaller than the sampling grid.

Each layer selects a strand near the chosen fine strand. The heads share one
sample-clock traversal phase, but their arc lengths differ: they finish a cycle
together, without claiming spatial correspondence between every curl. Closed
paths have consistent orientation and aligned start anchors; cropped paths
travel there and back without a closing chord. A layer with no contour in the
region is silent and its row says “outside view.”

| Visible quantity / control | Sound mapping |
| --- | --- |
| Height / Radar distance | Continuous pitch about the reference, with 0–4 octaves of deviation; no scale quantization |
| Horizontal position | Stereo pan using shared view coordinates; Position → pan sets width, zero centers it |
| Bending over Feature size | Bend → color controls local turning's contribution to brightness, independently switchable at zero |
| Deviation from a broader local chord | Fold → texture controls a separate bounded spectral texture; default off |
| Cycle rate | 0.01–1 Hz (100–1 seconds per shared cycle), default 0.1 Hz |
| Feature size | 0.2–8% of path arc length, default 1.5%; small follows tiny bends, large measures broader turns |
| Per-layer checkbox | Smooth mute without restarting that layer's cycle |
| Tone switch and voice | Sine, Reed, Glass or Shepard; Broad/Curl/Fine use low/middle/high registers |
| Drum switch and voice | Thump, Wood or Metal, independent of the sustained voice |
| Drum Spacing | Equal arc distances in shared view-width units, 0.6–20% of view width, default 4% |
| Drum pitch / decay | 30–1,800 Hz reference and 20–1,500 ms decay |
| Radar X/Y / Scan angle | Move the ray origin or rotate the scan direction, changing contacts and rhythmic spacing |
| Shepard motion | Rise/fall, 0–4 octaves of travel per reader cycle (zero holds it still), 0.5–2 octave spectral width |

Tone level and Drum level independently mix the two mechanisms. Every source
and mapping remains editable when disabled; switching it back on uses those
saved settings. Reader selection, voice, spacing and mapping edits preserve
transport. All musical settings belong to complete presets and randomization.

Trace follows its selected strands; Radar and Scan intersect the visible paths
at each contour level. Their chord is bounded to three tracked contacts per
level. More detailed regions can have many more intersections than that; this
is a selected, smoothed reading of the geometry. Reader trajectories and drum
crossing schedules are prepared in a separate worker with at most 128 paths,
2,048 intersection segments and 64 candidate intersections per level/sample.

Drum beads are placed by arc distance, independently of adaptive vertex count.
Closed Trace gives even pulses; open Trace slows near its turnarounds. Radar
crosses each noncentral bead once per turn. Scan crosses beads on the outward
and return sweeps, counting a turnaround bead once. Equal projected positions
strike simultaneously. Clustering conveys projected contour density and
orientation, rather than measuring curvature alone. At most 256 beads per
level are displayed and scheduled; dense cases increase spacing evenly.
The spacing uses the current view width, so zoom can change the bead pattern.

Shepard voices recycle octave-spaced partials through a smooth spectral window.
Their accumulated pitch motion continues across the visible cycle seam; it is
an endless-pitch illusion over finite repeating geometry. Selecting another
voice switches that layer back to its ordinary sustained tone.

This adapts the semantics of Shapes' `shape-readers.js` and `shape-sound.js`:
constant-distance Trace, geometric pitch/pan and curvature-driven timbre. It
does not treat every adaptive vertex as a percussion event. Subdividing a
straight segment therefore does not manufacture extra notes. The voice names
describe synthetic colors, not sampled or validated acoustic instruments.

The worklet samples bounded 2,048-point contact tables with separate continuous
carrier phases, up to nine sustained contacts and 24 percussion tails.
The canvas interpolates the same positions using audio telemetry, and armed
drum flashes follow actual reported strikes. Geometry and voice edits preserve the cycle, banks and mutes
fade smoothly, and Play pauses motion and releases sound. Reset restores the
current demo and resets motion; presets and randomization preserve Audio, Play
and output level. Audio-off Play remains a silent visual preview. During
refinement, heads continue to show the last completed audible paths until the
new tables are ready. The waveform monitor is reserved for XY playback.
On a completed bank replacement the drawing shows the destination path while
the audio glides between the two parameter trajectories over 90 ms. A rapid
second replacement may wait for the current fade (up to another 90 ms); the
shared traversal phase remains continuous during that brief transition.

Broad outlines, Seahorse Valley and Seahorse filigree are the primary acceptance
scenes, along with each voice alone, all-muted, an empty region, reader changes,
pause/resume, rapid zoom, and a stalled main thread. Automated measurements
cover clock/geometry agreement, bounded output and control sensitivity; they
do not establish listening quality or physical touchscreen feel.

### Fourier contour modes

The shared object is `z(theta)=sum a[k] exp(i*k*theta)`. Julia's inverse Böttcher
map satisfies `psi(w)^2+c=psi(w^2)`, with `psi(w)=sum b[n] w^(1-2n)`:

```
b[0] = 1
b[n] = ((n even ? b[n/2] : 0) - (n==1 ? c : 0)
         - sum(b[k]*b[n-k], k=1..n-1)) / 2
```

For `c=0`, `psi(w)=w`. For `c=-2`, `psi(w)=w+1/w`. Safe moving parameters use
`c=q/2-q*q/4` (main cardioid) or `c=-1+q/4` (period two), where
`q=depth*exp(i*theta)` and `depth<=0.96`. Fixed landmarks are the basilica and
rabbit center. Unconstrained disconnected Julia sets are outside these Fourier
modes' scope; the sampled Contour Explorer supports fixed custom coefficients.

The full-Mandelbrot map is `Psi(w)=w+sum(b[m]*w^-m)` beginning with
`b[0]=-1/2, b[1]=1/8, b[2]=-1/4, b[3]=15/128`. Its 513 coefficients were
independently generated with exact rational arithmetic during the preceding
vector-fractal research, using Beretta et al.'s recurrence, then rounded to
JavaScript doubles. They are mathematical constants, not copied source code or
downloaded media. Unit tests independently check sampled escape-potential levels
and the published leading coefficients. The constant translation is removed for
DC-free audio; both reference and audible plots use the same centering.

References supporting the constructions:

- Beretta et al., *On Benford's Law and the Coefficients of the Riemann Mapping
  Function for the Exterior of the Mandelbrot Set*, equation (1), Theorem 6,
  Table 1: <https://arxiv.org/abs/2206.04112>.
- Douady and Hubbard, *Exploring the Mandelbrot Set: The Orsay Notes*, exterior
  maps, Green functions and periodic components:
  <https://www.math.cornell.edu/~hubbard/OrsayEnglish.pdf>.
- Milnor, *Dynamics in One Complex Variable: Introductory Lectures*, exterior
  conjugacy and boundary-extension qualifications:
  <https://arxiv.org/abs/math/9201272>.
- Web Audio specification, AudioWorklet:
  <https://webaudio.github.io/web-audio-api/#AudioWorklet>.

All rendering, transforms and audio code here is original repository code.
The catalogue icon is procedurally drawn from this model; no third-party image.

## Approximation and DSP boundaries

- Finite Fourier contours are approximations to smooth equipotentials, **not**
  exact finite representations of fractal boundaries. Low detail very close to
  the set can introduce truncation artifacts. The clearance floor is 1.025.
- The worker creates 2,048-point XY tables. Distance traversal resamples the
  polygon periodically, then transforms and filters it again.
- Ten mip levels retain at most 512, 256, …, 1 harmonics. Their selection and
  smooth overlap stay below `0.42*sampleRate`, reserving sideband headroom. Linear
  table interpolation is a practical approximation, not mathematically perfect
  continuous-time reconstruction or a proof of zero aliasing under modulation.
- Both axes use the same energy normalization, capped by radial peak. Every
  mip uses the same gain, preserving aspect and cross-pitch consistency. The
  user level starts at 35%; a final finite-value/bounds guard prevents runaway
  output. No hidden reverb, distortion or unrelated synthesis obscures the test.
- Voyager precomputes 48 shape frames and interpolates their paired tables
  cyclically in an AudioWorklet. Intermediate blends need not be exact Julia
  equipotentials. Its motion and carrier keep running through UI/render stalls.
- In XY mode the two channels share one carrier phase. Pitch/rotation/level are smoothed;
  new banks crossfade for 90 ms. Repeated edits coalesce rather than queue
  unbounded work. The carrier is not reset by changing demos or presets.
- Colored geometry shows the pitch-filtered, rotated table, not merely the
  full-detail source in the three Fourier modes. Explorer geometry shows the
  sampled source instead. Waveform monitors follow audio telemetry at up to 30 fps. The scan dot
  deliberately runs 256 times slower than audio to make traversal legible in XY mode.
  Trace heads run at the actual independent musical traversal rate.
- WebGL draws the ordered paths; Canvas 2D is a fallback and draws the small
  monitors. Contour extraction/FFT construction occurs in workers; bounded Trace
  resampling occurs when a completed path or Feature size changes. No microphone,
  uploaded files, network DSP or audio samples are used.
- Universal MIDI control/preset/transport surfaces remain available; there is
  no pitched QWERTY mapping or claimed native MIDI-note/output engine.

## Verification

`node --test tests/vector-fractals.test.mjs` checks exact cases, the functional
equation, full-Mandelbrot escape potential, FFT and mip filtering, preset bounds,
parameter sensitivity, stereo/mono and audio release/crossfade behavior.
`npx playwright test e2e/vector-fractals.spec.mjs` checks the three routes,
Audio-off interaction, explicit startup, sound continuity, mobile layouts and
resource cleanup. `tests/vector-contour*.test.mjs` checks sampled field geometry,
worker cancellation and contour audio; `e2e/vector-contours.spec.mjs` checks
progressive navigation, selected-strand sound, SVG export and responsive controls.
`tests/vector-trace-*.test.mjs` and `e2e/vector-trace.spec.mjs` cover layered
geometry, density-independent curvature, independent musical/carrier clocks,
voice/mute continuity, empty-region silence and colored SVG export.
`tests/vector-julia-contours.test.mjs` checks analytic circle geometry, potential
identities, coefficient provenance, valid disconnected paths and parameter bounds.
`e2e/vector-julia-presets.spec.mjs` exercises all ten named coefficients, each
reader, live shape changes, custom coefficients, Whole/zoom, SVG metadata and
portrait/landscape controls.
`tests/vector-traveler-*.test.mjs` and `e2e/vector-traveler.spec.mjs` check signed
turning, subdivision invariance, open/closed seams, pitch direction and continuity,
Shepard bounds, transport and responsive controls.
These are mechanical checks; human timbre/touch judgment and
physical iPhone listening remain separate acceptance steps.

# Vector Fractals — progressive contours and XY sound

Open `/vector-fractals.html#explorer`, `#julia`, `#mandelbrot` or `#voyager`. These demos are
an independent work in progress; existing Julia and Fractal Synthesis instruments
are unchanged. Enable **Audio**, then **Play**. Audio and transport are separate.

## What to try

- **Contour Explorer:** scroll/pinch to zoom and drag to pan. Arrow keys pan,
  +/− zoom, and Home or Whole returns to the full outline. Jump to Seahorse Valley
  or Seahorse filigree for dense structure. A quick vector preview appears first,
  followed by finer contours calculated for the current region. Edge detail
  moves the sampled level closer to the set; Fine increases spatial sampling.
  Click a strand or use Next strand to choose the sound source. Save SVG exports
  the completed visible paths, keeping cropped paths open.
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

The explorer samples the exterior Green potential of `z -> z*z+c`, starting
with `z0=c`. After escape it evaluates
`log G_M(c) = log(log |z_n|) - n*log(2)` and extracts a negative level with
marching squares and refined edge crossings. The level moves closer to the set
as the view narrows; it is recomputed, not a magnified stored SVG. The finite
iteration limit and spatial grid make these approximations: narrow connections
can fall between samples and appear as separate closed loops. Neither topology
nor every filament is certified. More sampling reveals additional structure.

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
rabbit center. Unconstrained disconnected Julia sets are deliberately outside
this demo's scope.

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
- The two channels share one carrier phase. Pitch/rotation/level are smoothed;
  new banks crossfade for 90 ms. Repeated edits coalesce rather than queue
  unbounded work. The carrier is not reset by changing demos or presets.
- Colored geometry shows the pitch-filtered, rotated table, not merely the
  full-detail source in the three Fourier modes. Explorer geometry shows the
  sampled source instead. Waveform monitors follow audio telemetry at up to 30 fps. The scan dot
  deliberately runs 256 times slower than audio to make traversal legible.
- WebGL draws the ordered paths; Canvas 2D is a fallback and draws the small
  monitors. Geometry/FFT construction occurs only in a worker. No microphone,
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
These are mechanical checks; human timbre/touch judgment and
physical iPhone listening remain separate acceptance steps.

# Bifurcator

Bifurcator is an original musical sonification of five nonlinear dynamical
systems. Regime changes a mathematical parameter. Orbit signal blends raw motion
with a clearer voice. Shape playheads map the growing trajectory to continuous
pitch; Shape rhythms adds independent pulse clocks to the same geometric
readers. Up to sixteen heads can map geometry to pitch, travel, tempo, loudness
and stereo pan. The graphic follows the same state as the sound.
Audio begins off. The orbit may move silently before Audio is enabled.

## Playing

Enable **Audio**, then change **Regime** slowly. Drag horizontally over the stage
to change Regime and vertically to change Clarity in Orbit signal or Pitch span
in either Shape mode. In **Tempo map**, vertical movement changes Tempo range,
or Base tempo when Tempo follows is Constant. Arrow keys do the same;
Shift makes smaller changes. **Space** pauses or resumes motion. **Enter** or
**Nudge** perturbs the current state. In Hysteresis, Nudge can move the state
between its two basins of attraction. Pointer cancellation ends a drag.

The independent Audio switch mutes output while allowing the orbit to continue.
Pause releases the sound and then freezes the model. Resume continues from that
state. Presets and dice preserve Audio, Play, and the master output level.
Reset restores the default Lorenz patch and initial orbit while preserving
those live controls. Fifty complete presets include the original seventeen
Orbit patches, three Shape demonstrations, eight larger Shape choirs and
twenty-two rhythm patches. They cover clear and raw chaotic orbits, oscillation
onset, alternating cycles, periodic windows, hysteresis, layered contours and
variable-tempo pulses. Presets own every musical control; dice randomizes all
numeric controls, routes, voices, models, head counts and Grow shape, while
preserving Play. Neither controls output devices or master output. Pitch is
continuous; there is no automatic scale quantization.

**Sonification → Shape playheads** adds the geometric technique used by
[Shape](../shape-synth.html): visible playhead positions become continuous sine
frequencies. One to sixteen heads read the actual retained trajectory. The open
contour is read back and forth without inventing a closing line between its
endpoints. Each numbered, colored head corresponds to one voice. The **Live
playheads** table reports its actual primary frequency in Hz, mapped BPM and
ratio in Shape rhythms, and current travel rate.

**Pitch follows** selects one of seven geometric coordinates: height,
horizontal position, center distance, depth, angle, bend or path position.
Height maps higher positions upward; horizontal maps rightward positions upward;
center distance maps outward positions upward. Depth reads the retained third
coordinate of Lorenz or Rössler; it stays fixed in the other three models.
Angle reads direction around the projected origin, bend reads the contour's
local turn, and path position reads relative arclength along the retained window.
These are seven ways to read the geometry, not seven independent dimensions of
the underlying system.

**Low pitch** sets the lower frequency and **Pitch span** sets the octave range.
The mapped frequency is `lowPitch × 2^(coordinate01 × pitchSpan)`, smoothed and
limited to the lower of 12 kHz or one quarter of the actual sample rate. The
coordinates use one fixed bounded projection, shared by sound and drawing, so
changing screen size does not transpose the instrument. Clarity and Orbit →
tone belong to Orbit signal and are hidden in both Shape modes.

**Travel speed** moves the heads along the retained contour. **Travel spread**
gives the heads progressively different speeds; **Travel follows** maps another
coordinate to each head's speed, with **Travel range** controlling its octave
span around the base rate. **Loudness follows** and **Loudness depth** shape
individual voice levels. **Pan follows** and **Pan width** route voices to the
actual left and right audio channels. Pan is centered at zero width; centered
voices preserve the earlier sound level. Constant routes ignore their range or
depth controls. The routes are independent: depth can set pitch while height
sets travel, angle sets tempo and horizontal position sets pan.

Both Shape modes use independent sample-clock rates for mathematical growth,
playhead travel, carrier phase and, in Shape rhythms, beats. They slow the model's
time rescaling to make developing geometry readable; changing pitch, travel or
tempo does not change that growth. Uncheck **Grow shape** to freeze both the
mathematical state and recorded geometry while heads and beats keep playing.
Pause releases then freezes all these clocks. Audio off mutes without freezing
them. Nudge changes the model state for subsequent growth. Route and preset
changes preserve live oscillator and beat phases; model changes replace the
contour while retaining those musical clocks. Reset starts them again.

**Sonification → Shape rhythms** gives each head a sample-owned beat phase and
synthetic **Pluck**, **Bell**, **Tick** or **Low pulse** voice. Pluck uses a mostly
fundamental tone, Bell adds an inharmonic partial, Tick uses a brief higher
partial, and Low pulse drops its pitch after each strike. These are generated
voices, with no recorded drum samples. **Base pitch** sets the geometric pitch
reference; Low pulse can descend below it, toward 0.28 times the mapped pitch
with a 20 Hz floor. The Hz table follows that actual primary frequency.
**Pulse decay** controls the envelope's base decay time; the voice adapts it into
a longer bell, shorter tick or shorter low pulse.

The shared **Tap** buttons set Base tempo directly in BPM, motion and travel
as multipliers (120 BPM = normal 1×), or Sweep time as one full tap interval.
These edits preserve Audio, Play and live musical phases. Motion and travel
still follow their existing model and geometry mappings.

**Base tempo** ranges from 30 to 240 BPM. **Tempo follows** chooses a geometric
coordinate, and **Tempo range** controls its octave span around Base tempo:
`BPM = clamp(baseTempo × ratio × 2^((coordinate01 − 0.5) × tempoRange), 8, 960)`.
Constant fixes the coordinate at 0.5. Rhythm ratios repeat across numbered heads:
all 1×; ½× / 1× / 2× / 4×; 2:3:4 as 1× / 1½× / 2×; or 1× / 2× / 3× / 5×.
Each head advances its beat phase by `BPM / (60 × sampleRate)` per sample and
strikes when that phase wraps. First activation staggers the heads' beat phases;
tempo edits preserve them. Switching to continuous Shape playheads suspends
the retained pulse clocks, and returning resumes them.

**Tempo map** shows the chosen coordinate horizontally and BPM on a logarithmic
vertical scale. Curves show the target map for each ratio; colored dots show
the heads' actual smoothed BPM, and numbered phase lanes show their actual beat
progress. Pulse halos follow the synthesized envelopes. The tempo summary
reports the available mapped ranges, capped at 8–960 BPM. These graphics consume
engine state; they do not trigger the beats.

**Wave cycles** switches the stage to an overlay of the actual synthesized
cycles. Period-doubling makes neighboring cycles alternate, so one waveform
opens into two shapes, then four, and eventually a changing bundle. All traces
share the same amplitude scale; the overlay retains amplitude differences.
Orbit, or Shape in the geometric modes, switches back to the trajectory without
changing the sound.

**Sweep splits** selects a period-doubling patch with Clarity 60% and full
Orbit → tone coupling, then moves r continuously from 2.8 to 3.99. It preserves
the current Pitch, master output, Audio and Play. Its duration is controlled by
Sweep time, including during the sweep. Pause holds its progress; editing sound
controls lets it continue. Stop sweep leaves r where it is, while a manual
Regime edit, model change, preset or Reset ends the gesture. The sweep crosses
periodic windows as well as chaos. It runs on the audio clock, or silently before
Audio is first armed, and transfers its current progress when Audio starts.

| Control | Range | Musical effect |
| --- | --- | --- |
| Regime | Native range depends on model | Changes the system's long-term behavior. It is not a monotonic chaos meter. |
| Sonification | Orbit signal / Shape playheads / Shape rhythms | Selects direct-orbit sound, continuous sine readers, or geometry-driven pulse clocks. |
| Clarity | 0–1 | Blends a bounded direct-orbit signal with a pitched voice. It does not change the mathematical orbit. |
| Pitch / Low pitch / Base pitch | 35–1,400 Hz | Orbit mode sets its carrier reference and time rescaling. Both Shape modes set the geometric pitch reference independently of model time; Low pulse can fall below it. |
| Motion rate / Shape growth | 0.15–3× | Changes model time; in original Hopf and period-doubling it also changes the audible oscillation rate. |
| Orbit → tone | 0–1 | Changes orbit coupling, waveform shaping and modulation in the sonification. |
| Brightness | 80–18,000 Hz | Two-stage low-pass cutoff, limited to a safe fraction of the actual sample rate. |
| σ / β | 4–18 / 0.8–4 | Lorenz coupling and dissipation. |
| a / b | 0.05–0.35 each | Rössler spiral growth and vertical forcing. |
| Sweep time | 4–40 seconds | Sets the pace of the continuous wave-splitting gesture. |
| Playheads | 1–16 | Adds independently mapped readers with smooth voice activation and release. |
| Travel speed | 0.03–3× | Sets base distance travelled per second; 1× is six normalized path units per second before spread and routing. |
| Pitch span | 0–4 octaves | Sets the continuous geometry-to-frequency range; zero gives all heads the same mapped base pitch. |
| Pitch follows | Height / Horizontal / Center distance / Depth / Angle / Bend / Path position | Selects the geometric coordinate read as pitch. |
| Travel spread | 0–3 octaves | Spreads travel speeds across heads around the base rate. |
| Travel follows / Travel range | Constant or any of the seven coordinates / 0–3 octaves | Maps geometry to travel speed independently of pitch and growth. |
| Loudness follows / Loudness depth | Constant or any coordinate / 0–100% | Maps individual voice amplitude; full depth spans 15–100% before envelope and transport gain. |
| Pan follows / Pan width | Center or any coordinate / 0–100% | Maps actual stereo position; zero width centers every voice. |
| Base tempo | 30–240 BPM | Sets the center tempo before geometric range and head ratios. |
| Tempo follows / Tempo range | Constant or any coordinate / 0–3 octaves | Maps geometry around Base tempo, with actual mapped BPM bounded to 8–960. |
| Rhythm ratios | 1× / ½, 1, 2, 4× / 1, 1½, 2× / 1, 2, 3, 5× | Repeats explicit tempo ratios across the numbered heads. |
| Pulse voice | Pluck / Bell / Tick / Low pulse | Chooses the generated per-strike sound in Shape rhythms. |
| Pulse decay | 25–1,200 ms | Sets the base envelope decay time, adapted by the chosen pulse voice. |
| Grow shape | On / Off | Builds the contour or holds it while the readers continue. |

## Mathematical mechanisms and sound

**Hopf:** `ż = (μ + i2π)z − |z|²z`, with μ from −1 to 2.
The supercritical Hopf bifurcation occurs at μ=0. Negative growth shrinks the
state toward equilibrium; positive growth produces a limit cycle with radius
approximately √μ. In Orbit signal, its actual radius controls the sound amplitude
and a shrinking orbit becomes silent. A negligible
numerical seed lets oscillation reappear after floating-point decay to zero.
The graphic shows the actual complex state in the plane.

**Period-doubling:** `x[n+1] = r x[n](1−x[n])`, with r from 2.6 to 4.
In Orbit signal, one map update occurs per reference carrier cycle. Period-two
therefore gives alternating audio cycles and a genuine half-frequency component;
successive doublings produce longer patterns. The Orbit signal diagram is a
computed parameter sweep of this equation, with the active parameter and actual live iterates
overlaid. Chaos appears alongside periodic windows; r=3.835 demonstrates a
period-three window. A perceived octave drop is not guaranteed for every mix.
[May's original discussion](https://ned.ipac.caltech.edu/level5/Sept01/May/May3.html)
and [period-doubling observed in wind instruments](https://www.lam.jussieu.fr/Membres/Castellengo/publications/2000a-Period-doubling_ActaAcustica.pdf).

**Hysteresis:** `u̇ = bias + u − u³`, with bias from −0.65 to 0.65.
Two stable branches coexist for `|bias| < 2/(3√3)`; folds occur at the two
endpoints. Slowly sweeping bias upward and downward produces different jump
thresholds. In Orbit signal, the graphic overlays the actual (bias,u) path on the equilibrium
curve, with the unstable middle branch dashed. A scalar equilibrium has no
intrinsic pitched vibration, so in Orbit signal its branch is deliberately mapped
to the pitch and timbre of a separate oscillator. This is a musical mapping of
bistability.
[Bifurcation-theory background](https://doi.org/10.1103/RevModPhys.63.991).

**Lorenz:** `ẋ=σ(y−x)`, `ẏ=x(ρ−z)−y`, `ż=xy−βz`.
Regime controls ρ from 0.5 to 80. The default σ=10, β=8/3, ρ=28 gives the
familiar butterfly attractor. With those standard σ and β, a pitchfork occurs
at ρ=1. The homoclinic explosion near 13.9265 introduces transient chaotic
dynamics; sustained chaos appears near 24.06 and coexists with stable
equilibria until the subcritical Hopf near 24.74. These thresholds depend on
σ and β. Increasing ρ does not guarantee increasing chaos.
The graphic projects actual x,y,z samples; those coordinates also supply the
raw waveform and the modulation of the clearer voice.
[Lorenz's original paper](https://doi.org/10.1175/1520-0469(1963)020%3C0130:DNF%3E2.0.CO;2),
[global bifurcations](https://research-information.bris.ac.uk/en/publications/global-bifurcations-of-the-lorenz-manifold-2/),
[coexisting regimes](https://www.pik-potsdam.de/members/kurths/publikationen/2014/malik_etal_kurths_2014_PhysRevE.89.062908.pdf).

**Rössler:** `ẋ=−y−z`, `ẏ=x+ay`, `ż=b+z(x−c)`.
Regime controls c from 2 to 18; a=b=0.2 by default. The default c=5.7 supports
the familiar chaotic spiral. Changes can produce periodic, doubled and chaotic
regimes; the implementation does not label every parameter combination chaotic.
The raw voice reads the actual coordinates, and the clearer voice retains
bounded orbit modulation. [Rössler's original paper](https://doi.org/10.1016/0375-9601(76)90101-8).

## Implementation boundaries and provenance

This is a numerical instrument, not a physical acoustic simulation. Its
equations, integrator, sonification, presets and graphic are original code.
No third-party recordings or source code are included. The catalogue artwork
is an original procedural rendering of the Lorenz equation.

The geometric and rhythm voices are artistic mappings, not assertions that
an attractor has an intrinsic musical pitch or tempo. Their exponential
frequency mapping follows the existing Shape implementation in
[`shape-sound.js`](../src/families/geometry-presets/shape-sound.js) and
[`audio.js`](../src/audio.js). It reads the real numerical states through a
fixed soft-bounded projection: Lorenz uses x + 0.15y horizontally and z−24
vertically; Rössler uses x + 0.12z and y + 0.23z; Hopf uses x and y. Lorenz depth
uses a bounded y projection and Rössler depth uses bounded z. The logistic reader
shows a return map of previous versus current iterates, while hysteresis uses
its state and bias. Their depth coordinate, like Hopf's, is zero. The reader
shares its projected coordinates with the graphic rather than reading pixels
or stretching each shape's own bounds. Arclength and local bend are computed
from the displayed two-dimensional contour; retained depth is interpolated
along that same path.

Both Shape modes' mathematical rate is 0.35×speed for Hopf, 3×speed for Lorenz and
hysteresis, 5×speed for Rössler, and eight×speed map updates per second for
period-doubling. Orbit signal retains its original audio-rate time rescaling.

Continuous models use RK4, with a maximum of eight substeps per audio sample.
Extreme combinations can cap the time rescaling; numerical escapes restart
the model through a finite transition. Rössler parameters can describe escaping
trajectories as well as bounded attractors. These protections do not establish
the mathematical existence or stability of an attractor at every setting.
Internal diagnostics report recovery and integration limits.

Controls are smoothed. Mono and each stereo channel are independently
DC-filtered, low-pass filtered and bounded to ±0.8 before master output.
The original Orbit voice feeds the same signal to both stereo channels. With
neutral routes and centered state, Orbit and Shape produce identical mono,
left and right engine samples. Pan routing changes the actual stereo channels
while preserving the mono reference; channel filters and crossfades retain
their separate tails during changes. A mono output consumes the mono reference
without overwriting it with either stereo channel.
In Orbit signal, at a stable equilibrium, the raw Lorenz/Rössler coordinate
becomes DC and the
raw-only mix can become silent; increase Clarity to hear its steady pitched
mapping. Chaos here is deterministic, not injected random noise. Clarity is
an artistic mix control and is not a Lyapunov-exponent estimate.

The AudioWorklet owns audible timing. Graphics consume decimated real model
states and never schedule sound. Before Audio is first armed, a silent pure
engine previews the orbit; its state transfers to the audio engine at arming.
Reduced-motion preferences reduce drawing cadence. Rendering is bounded to
4,500 history points (1,800 with reduced motion), 30 frames/second (15 with
reduced motion), and a 1.25-million-pixel target. Disposal releases the graph,
meter connection, context, interval, animation frame and listeners.
The silent fallback retains the latest acknowledged audio state, so a processor
failure and explicit restart preserve the orbit, active sweep, reader clocks
and stereo state rather than returning to the state at initial Audio arming.

The geometric reader stores at most 1,024 projected points and depths, sampled
at 120 Hz. Sixteen bounded readers locate their arclength positions and refresh
mapping targets at 240 Hz. Carrier and partial phases, beat phases, pulse
envelopes, pitch and tempo smoothing, voice gain and stereo routing run per
audio sample. Each beat is triggered by its head's sample-owned phase, without
a timer or rendering callback. Voice and route targets change smoothly; a
strike restarts its envelope without restarting its carrier phase.

Reader traversal, capture cadence, geometry, oscillator phases, beat phases,
envelopes and stereo filters transfer with engine state when Audio starts or
restarts. The enclosing engine state remains version 1; its nested reader state
is version 2 and records all sixteen heads, retained depth and pulse state.
The importer also accepts the earlier four-head reader version 1, retaining
its geometry, traversal and carrier phases, with neutral defaults for added
routes and inactive extra heads. An older engine state without a stereo block
mirrors its mono filter and transition state into both channels. Imports are
validated before changing live state. Same-rate joins preserve successive
mono, left and right samples exactly. Cross-rate joins retain physical state,
phases and timing in seconds; local filter coefficients and frequency ceilings
follow the new sample rate, so the resulting samples need not be identical.

As the retained window rolls, heads advance with its discarded distance to
preserve their spacing. Model changes and numerical recovery replace
incompatible geometry while retaining live carrier, beat and pulse state.
Reset replaces geometry and resets those musical clocks. If the original voice
advances during a mode excursion, growing a new shape begins at the actual
current state with a short crossfade and retained musical clocks; missing
trajectory time is not joined by a synthetic chord. A held contour can continue
to be read before growth resumes. Mapped primary frequencies are bounded by
12 kHz and one quarter of the actual sample rate; added rhythm partials have
their own sample-rate ceiling. Drawing cadence never schedules the voices.

The cycle overlay captures the filtered left-channel synthesizer signal before
master volume, with 64 phase-aligned samples in each of the last 24 complete reference
cycles. Its short repeat detector compares actual waveforms, including their
amplitudes, for periods 1, 2, 3, 4, 6 and 8. “No short repeat” does not prove
mathematical chaos: it can also describe a longer period, changing parameters
or quasiperiodic motion. Quiet or poorly sampled signals receive no confident
repeat label. Pause keeps the complete captured cycles and drops an unfinished
cycle rather than joining it across a release or restart.
In both Shape modes the reference cycle belongs to the first synthesized primary
voice; multiple heads, pulse envelopes and changing tempo can make the mixed
waveform lack a short common repeat. This carrier-cycle comparison does not
classify the rhythm's beat period.
The repeat comparison omits the first two phase bins, where sharp cycle
boundaries inherit sampling-grid jitter; the displayed traces retain all bins.

Automated tests cover mathematical relationships, finite bounded output,
subharmonics, hysteresis, parameter effects, deterministic stereo state transfer,
legacy four-head sample compatibility, independent growth/travel/beat clocks,
actual tempo and ratio strike counts, pulse output, transport, full preset and
randomizer ownership, responsive layout and cleanup. These checks do
not establish perceived musical quality or physical touch feel; human listening
and hardware testing remain separate.

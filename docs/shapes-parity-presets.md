# Shapes: shared geometry sound, presets and articulation

September 21, 2026. Worktree branch `codex/full-instrument-presets`; local work,
not a deployment. Human listening remains separate from automated verification.

## Current instrument

`shapes.html` has **106 presets**, interleaved across dimension and playing style:

- **61 Continuous** scenes;
- **27 Corners & Notes** scenes: the 15 imported corner-percussion scenes and
  12 newly articulated sine/FM/PM/Shepard note scenes;
- **18 Triggers** scenes: 12 Rattlesnake and six FM-kit examples. Six Rattlesnake
  scenes specifically use four, five or six subdivisions.

The original 36 Shape, 20 Solid and 20 Hyper presets remain present. Their full
musical parameter snapshots round-trip through the Shapes adapter. The shared
header starts at **Select Preset**, uses the Choose UI, and provides next and
parameter-dice buttons. No preset is applied during registration.

### Corners & Notes: one player, not duplicate modes

- **One subdivision** uses the original corner/vertex anchors.
- Higher subdivisions add points between those anchors; they do not duplicate
  vertices at shared edges. 3D/4D note markers project the same geometric points
  used by the event detector, rather than subdividing an already projected line.
- **Corner percussion** remains a sound option. It retains Shape's strike
  envelope/noise/level mappings and Solid/Hyper's original attack/decay sounds.
- Sine, FM, PM and Shepard notes use the existing contour worklet's real
  synthesis algorithms, with an independently timed, editable five-node ADSR.
  They no longer substitute one almost-fixed, roughly 50ms native strike for
  every note. The new twelve tonal scenes have different envelopes, timbres
  and simultaneous-note counts.
- In **Map**, `Swell · peak at marker` starts an automatic note's attack *before*
  its corner/subdivision. The marker anchors the attack peak; decay/sustain and
  release follow it. The scheduler extends its forecast for the pre-attack.
  Initial live joins are smoothed; an impossible past native-percussion attack
  is not compressed into a late burst.
- Each timed note has its own envelope and identity. A later marker does **not**
  reset the earlier note's tail, and envelopes are not forced to fit between
  markers. The bounded voice budget may retire old voices smoothly under
  overload. A shared gain budget keeps overlapping synth notes below the bus
  peak ceiling.
- The original **Continuous** spatial corner-swell behavior, including manual
  contour interaction, is unchanged. Clocked note swell predicts automatic
  motion; live MIDI attacks start with the key press, and held synth notes
  sustain until note-off and then follow their release.

Legacy `playing=corners` routes and saved states migrate to Corners & Notes,
Corner percussion, one subdivision. There is no second Corners playing button.
Audio remains explicitly armed. Presets own musical motion switches but protect
master output, live angles/phase and the selected control tab. Shape-only 3D/4D
scenes center their stationary slice. Scene level is separate from master level.

## Shared implementation, not a replacement instrument

`src/families/geometry-presets/shape-readers.js` and `shape-sound.js` contain the
original Shape reader and sound formulas; both Shape and Shapes call them. This
includes open-line radar/endpoint handling, FM/PM controls and modulation sources,
pitch curves, stereo source/inversion, directed corner envelopes/swell and
travel/turn Shepard settings. `geometry-sound.js` likewise shares Solid/Hyper's
voice formulas with Shapes.

`src/instruments/shapes/parameter-bridge.js` translates names, not musical values.
`full-presets.js` validates complete snapshots before mutation. The shared header
verifies exact recall and rolls back failed applications. `mode-presets.js`
authors the additional note/trigger scenes. No iframe, new framework or duplicate
embedded instrument was introduced.

**Map → Full controls** exposes the original synthesis parameters. Existing
Shapes Character sound remains available for Continuous; Corners & Notes uses
full geometry synthesis. The restored head-option buttons reverse individual
Point/Radar readers or turn Line readers by 90 degrees without losing their
travel. Rotate includes independent 2D rotation ping-pong.

The new fields reuse native control styles and the shared amplitude editor.
Notes use its time-envelope UI; continuous geometry keeps its spatial envelope.
Audio nodes, transport, geometry, storage and DSP remain instrument-owned.

## Random and output safety

Dice generates parameters, dimension and playing style, not a factory selection.
Radar/form rolls also retain relative motion rather than locking all readers
between markers at equal rotation speeds.
It avoids incidence-muted Point readers, stationary corner strikes, and random
open-line rays which can miss their geometry indefinitely. Random discrete
motion has a useful lower density. Manual settings remain available; deliberately
muted master output or Audio off are never overridden.

Dense native trigger rolls constrain head/division/hit counts and rotation
instead of creating uncontrolled drum bursts or slowing into an apparent stall.
Strike strength is a musical velocity parameter: it defaults to 100% for older
saved setups, with moderate settings in new trigger demos and generated scenes.
The older Rattlesnake and FM-kit engines remain intact.

## Device-relative budgets and dense-geometry clicks

Shape, Solid, Hyper and Shapes opt into the existing renderer-load controller
through `audio-budget.js`. Learning is per synthesis mode, runtime-only and based
on measured load, not an OS/device-name guess. It creates no probe tones or
permissions and does not mark a preset Custom.

Geometry pools retain a 32-voice hard allocation, with the existing 20-voice
4D continuous limit and any lower musical preset ceilings. Shepard starts at
eight; sustained demand/headroom may grow a budget, overload shrinks it, and
hysteresis/cooldown prevent immediate oscillation. Single-voice steps allow
reductions below eight. Coarse clock spikes are not treated as reliable individual
deadline measurements; sustained mean load is used instead. High-resolution
peaks and actual underrun reports retain their fast response. Other pool callers
retain their policy.

A full pool previously deleted still-audible release tails to admit new
intersections. Geometry pools now wait for quiet slots inside the same fixed
allocation. Pending geometry is bounded, updated rather than replayed, and
cleared on silence. A redundant per-sample gain-smoothing calculation was hoisted
without changing the oscillator formulas.

The deterministic 32-voice handoff's boundary step fell from about 0.04162 to
0.000834 (nearby steady steps about 0.000742). In four instrumented browser
sphere/toroid cases, premature voice removals counted 306/124/252/437 before and
zero afterward. These are **voice-removal counts, not counts of audible clicks**.
They demonstrate that defect's removal, not universally click-free playback.
See `test-results/shapes-density-clicks/` for source snapshots and measurements.

## Evidence, limits and rollback

- All 76 imported source snapshots have exact parameter round-trip tests.
- `tests/fixtures/shapes-original-voices.json` contains 122 voice sets from the
  saved pre-integration individual controllers, with SHA-256 provenance. Tests
  compare frequency, gain, pan and synth parameters at two phases of each
  continuous scene. Computed numeric outputs allow at most
  `8 * Number.EPSILON * max(1, |actual|, |reference|)` to accommodate last-bit
  differences in serialized doubles between runners. Voice counts, ordering,
  field sets, modes, literal ratios/widths/smoothing times, nulls and exact
  silence remain strict. The saved reference bytes and synthesis are unchanged;
  negative tests reject nonfinite outputs and changes beyond this rounding bound.
- DSP tests cover long ADSR/release, pre-marker attack/peak, independent overlap,
  true sine/FM/PM/Shepard differences, MIDI hold/release, bounded waiting voices,
  stale-event cancellation and smooth dense-pool handoffs.
- Model tests cover legacy migration, subdivisions and marker/event alignment,
  long swell forecasts, complete random state and Audio/output protection.
- Browser checks cover all presets, the mixed live tour, random scenes, retained
  drum engines, MIDI, storage/BFCache, curve editing and phone portrait/landscape.
  Read final logs for exact results, rather than treating an earlier green run
  as approval of later changes.

Scheduling uses Shapes' audio-clock grid, not the individual pages' frame-driven
percussion callbacks; sample-identical onset timing between pages is not claimed.
Fallback browsers without the contour worklet retain the existing native strike
fallback rather than full worklet FM/PM/Shepard note synthesis. Physical-device
listening, touch feel and timbral approval remain with the owner.

`test-results/shapes-mega-presets/before/`, `shapes-density-clicks/before/` and
`shapes-note-articulation/before/` preserve the successive source layers. An
initial random sweep caught a clipped dense trigger roll; its failed state/report
remain alongside subsequent fixes and verification. Preserve prior uncommitted
work when rolling back—do not reset this worktree to HEAD.

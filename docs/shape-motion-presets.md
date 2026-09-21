# Shape: motion and spacing preset expansion

## September 21, 2026 — local implementation, browser verification pending

Route: `shape-synth.html` (legacy `shape.html` redirects to it).
This is the Shape instrument, not the separate combined `shapes.html` app.

The owner requested 24 more presets, explicit Rotation/Playhead on/off recall,
varied playhead spacing, wider sonic exploration and a mixed menu order.

Implemented:

- **36 full presets**: the initial 12 plus 24 additions, two more Bowed line
  variants, and the requested removal of Sweet orbit and Paused sketch.
- `playing` and `autoRotate` are now required boolean preset parameters.
- Menu order is explicitly interleaved; it does not reshuffle unpredictably on
  reload or change the meaning of the next arrow.
- **28 nonuniform head layouts**, including close pairs, grouped taps, unequal
  gaps and twelve opposing strands.
- Ten playhead-only scenes, six rotation-only scenes and 20 with both motions.
  Pausing remains available through the ordinary controls, not a factory scene.
- Eight sine, eight percussion, eight FM, eight PM and four Shepard scenes.
- Point, scanning-line and radar readers; forward/reverse motion, mixed scan
  axes, opposite head directions and loop/ping-pong rotation. Rotating scenes
  now include eight clockwise, eight counterclockwise and ten ping-pong scenes.
- Velvet wheel uses the original straight square, not a near-circle. Only the
  Sweet orbit preset was removed; circle geometry remains available.

## Quick audition

| Scene | What to explore |
| --- | --- |
| Velvet wheel | The original square turns counterclockwise past stationary radar readers |
| Clustered marimba | A close pair of percussion hits followed by more distant replies |
| Salt glass | Clustered moving radar and reverse rotation shape inharmonic FM |
| Twelve-point braid | Twelve nonuniform points travel in opposing directions |
| Stuttering pentagon | Three close taps, a gap, then two more |
| Detuned lanterns | Near-coincident pairs produce small changing pitch separations |
| Uneven drum wheel | Irregular stationary rays; rotating geometry supplies the rhythm |
| Twin comets | Opposed fast points plus slower rotation |
| Corner storm | Four irregular heads on 32 star points; slower travel and ping-pong rotation |
| Open line · Bowed pendulum | Three uneven moving readers with a separate ping-pong rotation |
| Bowed line · Reverse reel | Two opposing readers with continuous counterclockwise rotation |
| Bowed line · Four-way rocker | Four uneven readers with ping-pong rotation |
| Interference grid | Six mixed-axis lines, deep PM and two simultaneous motions |

Descriptions identify motion states, and the existing Playhead/Rotate buttons
reflect the recalled values. The three original sub-preset editors for amplitude,
percussion and pitch curves remain in their instrument sections.

## Audio and motion are different

Selecting a preset does **not** press the Audio button, create an AudioContext,
enable MIDI, request a microphone, or apply a preset during page initialization.
If Audio is off, the recalled motions run silently. If Audio is already on,
the preset's motion and sound configuration takes over.

The current physical position/angle is preserved, not reset to the beginning.
Continuous phase is rebased when loop/ping-pong mode changes. Head direction
adjustments preserve existing travel while the new relative offsets are applied.
Play/Rotate switches and speeds are musical preset settings; evolving positions
are not, so normal animation does not continually mark a preset Custom.
Manually changing either motion switch does mark the full preset Custom.

The native Shapes bridge is not used for this operation. The Shape-owned preset
adapter applies all parameters, synchronizes the existing controls, and requests
one frame. It releases outgoing voices only when both motions stop or the sound
mode changes, using the existing pool fade rather than closing/recreating audio.
Starting from rest resets clock references; continuing motion preserves them.
Old corner history is discarded so a geometry swap does not replay stale strikes.

The initial motion expansion did not change synthesis. The subsequent
owner-reported click follow-up adds an opt-in rounded attack to
`VoicePool.strike`, enabled only by Shape's corner-percussion caller. Other
callers retain their exponential attacks. The six reported percussion presets
now use 8–14 ms rounded attacks and less attack noise; Insect clock and Corner
storm also have lower event density. These changes intentionally tune Shape
percussion, rather than being a sound-neutral file refactor.

Voice ceilings, gain normalization, samples, worklets, saved-data keys and MIDI
listeners remain unchanged. Dense/deep scenes use restrained master/strike
levels. “Bell”, “marimba”, “storm”, and similar names are expressive starting
points, not acoustic-fidelity claims or guarantees of listening quality. See
[the audition follow-up](preset-audition-followup.md) for measured contributors
and the remaining browser/listening boundary.

## Verification performed

The initial expansion passed 129 checks. The latest Shape/Hiccup feedback pass
passed **181 checks, with six skipped**, across 16 direct Node suites:

- `tests/shape-full-presets.test.mjs` (nine checks)
- `tests/geometry.test.mjs`
- `tests/articulation.test.mjs`
- `tests/playheads.test.mjs`
- `tests/mapping.test.mjs`
- `tests/audio.test.mjs`
- `tests/synth-processor.test.mjs`
- `tests/shape-midi.test.mjs`
- `tests/full-instrument-presets.test.mjs`
- `tests/header-preset-menu.test.mjs`
- `tests/shape-percussion-onsets.test.mjs`
- `tests/preset-audition.test.mjs`
- `tests/hiccup-head.test.mjs`
- `tests/hiccup-head-face-regression.test.mjs`
- `tests/hiccup-head-transport.test.mjs`
- `tests/preset-hierarchy.test.mjs`

The Shape-specific tests verify:

- Original startup state remains unchanged and mutable arrays are private.
- All 36 records have complete validated parameter coverage and finite geometry.
- Every scene restores both motion flags while retaining Audio and physical phase.
- Full recall is independent of prior edits and intervening scenes.
- Invalid scenes fail before changing live state.
- All original IDs except the explicitly rejected Sweet orbit remain, with a
  stable mixed order and the additional Bowed line variants.
- The actual authored preset-adapter function is executed against a small I/O
  harness for all scenes × four incoming motion states × two Audio states.
  That checks button states, clock handling, one fade when appropriate, and no
  Audio rearming. It is not a browser or audible-output simulation.

The initial expansion changed `applyShapeFullPreset` and preserved the other
170 existing Shape app function bodies. Compared with the later pre-feedback
snapshot, this audition follow-up changes only `strikeCorner`; its other
**170 named function bodies** are unchanged. These are different checkpoints.
Preset data and the parameter-coverage boundary are intentionally changed in
the separate `full-presets.js` module.

## Remaining acceptance

Browser checks have been updated for all 36 recalls, actual Play/Rotate controls,
visible head offsets, silent motion with Audio off, stopping both motions,
manual controls, and retention of one live audio owner. They have **not** run
after this expansion because the browser/build approval-service issue remains
unresolved. Do not infer physical-device feel, clipping behavior of every scene,
or timbral approval from the pure/control-flow checks.

The full repository gate and WAX/production regeneration remain pending.
`dist-wax/` was not hand-edited and still needs regeneration. No commit or push
was performed for this batch.

Local evidence and before-source snapshots are under
`test-results/shape-preset-motion/` and
`test-results/preset-audition-followup/`.

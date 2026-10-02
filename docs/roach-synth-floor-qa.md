# Roach Synth head and antenna floor constraints

The head and antennae previously had body-core exclusion but no ground check.
Only the six terminal feet determined the support plane, so the neutral antenna
meshes and downward face edits could extend through the floor.

The bundled rig now raises the antennae in its calibrated rest pose and captures
conservative bounds from every owned head, neck and antenna mesh vertex once at
load. Occupied local cells provide at most 512 corner points per part. This
bounds the runtime check without scanning meshes on the audio thread.

The shared pose projection runs after procedural motion and MIDI composition,
before the audio engine measures joint displacement. The viewer applies the
same projection after the visual speech gesture. A head edit also checks its
antenna descendants. Normal face edits retain all leg angles and the existing
six-foot support plane; if an extreme whole-body tilt leaves no legal face
posture above that plane, a derived support lift clears the remaining deficit.
Derived lift suppresses physical gait impacts while consuming their contact
counters; recovery plays new steps without replaying missed ones. Direct MIDI
attacks remain intentional instrument gestures. This is a bounded geometric
constraint, not a full rigid-body simulation.

Pointer edits retain accepted pose deltas and discard blocked pointer travel.
Edits use the full composed input as their origin, including contributions
already rejected by the floor. A short reverse drag therefore releases
immediately, even from an initially clipped preset, animation or MIDI pose. Audio,
Sound Play, Animation Play, MIDI notes and speech keep their existing ownership
and timing. The 200 Hz audio control path owns synthesis; graphics do not
schedule collision-related sound or musical events.

## Verification

- `npm run verify`: 3,537 passed, 6 skipped, no failures; generated WAX output
  matches a clean build.
- Four new browser cases check actual owned mesh vertices, desktop and phone
  drag reversal (including initially clipped static and external poses), tilted
  body poses, unchanged normal leg support, and independent players. They pass
  on source and generated WAX pages.
- Independent Three.js forward-kinematics checks cover 429 actual-rig poses,
  including 108 ordinary manual face edits with no derived support lift.
- Release and Storybook builds complete; the Storybook artifact check passes.
- Neutral Side and head-contact Face screenshots were visually reviewed.

A preliminary isolated-server browser run failed to load an AudioWorklet module.
Its complete worklet import graph matched source; the unchanged actual-app test
passed on the root preview, and the generated WAX regression passed. No DSP
change was inferred from that isolated loading failure.

The expanded Roach browser run also exposed an existing mobile knob-swipe
failure: the horizontal test gesture leaves the Legs level at 0.72. The
unchanged test reproduces the same failure on the live `4e1f372` baseline.
That control/test issue is outside this floor-collision change; this report
does not describe the entire expanded browser suite as green.

The full source browser run completed with 56 of 59 cases passing. The viewer
fixture was then aligned with accepted movement (a constrained head gesture
correctly accepts 6.39 degrees instead of the raw 13.68-degree request); its
focused test passes and verifies visible movement. Speech-with-animation
sampling failed under concurrent QA load but passed unchanged with other test
jobs stopped. The remaining mobile-knob failure reproduces on the live
baseline, as noted above. Repository verification also passes after integrating
the separate catalogue-logo update from `main`.

### Audio timing

Measured the final DSP on this machine at 48 kHz in 128-sample blocks. Each case
used 1,500 warmup blocks followed by 5,000 measured callbacks; timing included
rendering, message handlers and periodic telemetry copies. Graphics and other
QA processes were stopped for the measurement.

| Case | Mean | p99 | Maximum | Missed 2.667 ms deadlines |
| --- | ---: | ---: | ---: | ---: |
| Held neutral | 0.331 ms | 0.411 ms | 1.358 ms | 0 |
| Unsafe animated face pose | 0.479 ms | 0.623 ms | 1.082 ms | 0 |
| Dense MIDI and XYZ controls | 0.626 ms | 0.925 ms | 1.585 ms | 0 |

All samples were finite; peak amplitude stayed below 0.695. The dense case used
24 notes and 24 changing axis controls. Lifted gait contacts were suppressed,
while intentional MIDI attacks remained active.

Artifacts are retained in `/tmp/roach-floor-qa/` and
`/tmp/roach-floor-audio-qa/benchmark-root-final/`, including the actual rig,
complete callback timings and exact DSP snapshots. This is offline timing and
browser-emulation evidence. Physical phone, hardware MIDI and listening tests
were not performed; the change does not claim new timbral or biological fidelity.

## Neck and camera refinement, 2026-10-02

The original approximate head hinge sat in front of its rear shell. An upward
rotation therefore swept that shell corner through the floor: a requested
head rotation of -20 degrees was projected to -0.234 degrees. The neck had a
similar rear-shell restriction, and Face view placed its camera below the face.

The bundled scan now uses rear attachment hinges for head and neck while
preserving all resting mesh and child world transforms. The head and neck have
more upward range and narrower inward ranges; the existing body-core and floor
constraints remain intact. Precise imported skeletons retain their authored
hinges. Vertical pointer movement follows each face hinge's measured lifting
direction. Face view places its camera above and in front, and camera gaze
articulates both neck and head through the shared motion writer, including the
audio pose. Old head-only gaze data remains compatible. Zoom refreshes this
shared gaze, and temporary speech gestures retain their existing clock and
saved-pose ownership.

Actual browser surface drags of 36 pixels upward accept -13.68 degrees for each
face hinge. The head centroid rises about 0.071 world units when dragging the
head and 0.087 when dragging the neck; the latter also extends forward about
0.091 units. A short reverse responds immediately. Face gaze raises the head
about 0.106 units and extends it 0.177, with a facing-to-camera dot product of
0.991. Before/after Side and Face screenshots were visually inspected.

An independent forward-kinematics sweep checks 225 head/neck pitch, yaw and tilt
combinations. All accepted poses are finite and within joint limits, clear the
floor and body core, and preserve all support rotations without fallback lift.
Resting body, neck and head centroids are unchanged to twelve decimal places;
foot kinematics, rest offsets and gait tables, joint IDs/order and the body-core
proxy are unchanged. This is geometric and browser-emulation evidence; physical
device handling was not tested.

Repository verification passes with 5,440 tests passed, six existing skips and
no failures; generated WAX output matches a clean build. The 26-case browser
sweep passed 23 cases initially. Three old setup gestures exceeded the new
inward range or used the old direction; those fixtures were updated to use a
legal inward angle rejected by the floor and an outward manual speech gesture.
All three corrected cases passed in the focused rerun, preserving their floor,
short-reverse and exact saved-pose restoration assertions.

### Vertical flexibility with restrained lateral movement

Only the up/down hinge range remains expanded. Head side tilt is limited to
six degrees and left/right turn to eight; neck tilt is limited to three and
turn to four. Camera tracking uses smaller lateral contributions: head tilt
three/turn four and neck tilt/turn two degrees. All X lift ranges, pivots,
upward pointer direction and floor/body guards are unchanged.

An independent probe verifies that head and neck -20-degree lift remains
sample-for-sample identical. Thirty-six extreme lateral inputs and 480 speech
samples remain within the tighter limits, preserve support and clear the floor
without derived body lift. Five focused browser cases pass, covering large
sideways gestures and offsets, desktop/phone upward lift, stable Face gaze and
saved-pose restoration after speech. Actual combined lateral rotation stays
within 15.1 degrees. Desktop and phone screenshots were visually inspected.
Repository verification again passes 5,440 tests with six skips and no failures;
generated WAX output matches a clean build. Physical device handling remains
unperformed.

### Head contact with the pronotum

The plate immediately above the head belongs to the neck joint. The resting
scan already has a small authored seam overlap, and its first new upward crown
contact occurs after only 0.074 degrees of relative head rotation. The viewer
measures that stop once from the actual crown vertices and plate triangles;
only its bounded angle and parent relationship reach the audio engine.

Further upward head pressure now lifts the parent plate through the neck hinge,
within its existing pitch limits. The close-fitting relative head hinge bends
vertically; the neck retains its small sideways range. Resting mesh transforms,
support joints, body-core exclusion and floor bounds remain intact. Floor search
respects the relative contact stop without creating additional carried pressure.

Animation, gaze, manual offsets, MIDI and temporary speech are composed before
one shared contact projection. Raw intent is retained separately from the
displayed pose. Direct edits save only the accepted request of the touched
joint, so derived plate lift does not become a held neck offset. A short reverse
releases immediately, including at neck saturation and a floor stop. Speech
returns to the exact underlying manual head/plate pose after its envelope ends.

Pure motion and DSP regressions verify contact in both lifting directions,
rest-relative limits, bounded and idempotent carry, invalid-parent rejection,
unchanged unrelated parts, opposing MIDI pressure and speech restoration.
Independent actual-rig edit math also verifies a held neck offset surviving head
release and temporary speech never entering saved head or neck offsets.

A second independent check uses the actual normalized 31-joint rig: 126 extreme
head, neck and lateral requests remain finite, preserve all support joints and
show exactly zero drift through 1,000 repeated core/floor projections per case.
Warmed offline control-step medians are 33 microseconds for held head pressure,
46 for walking and 91 for flying, at most 1.82% of the 5-millisecond control
interval in these cases. These are geometric and offline timing measurements.

Final repository verification passes with 5,453 tests passed, six existing skips
and no failures; generated WAX output matches a clean build. Twenty-four unique
browser cases have passing evidence across focused and broader runs, covering
real triangle contact, continued plate lift, short reversal, exact release,
Face aim, desktop/phone surface gestures, floor stops, support, animation,
background, zoom, native voice clocks, mute and speech restoration.

The focused run passed six cases initially; one signed-zero assertion was
corrected and passed alone. The broader run passed 17 of 19 cases initially.
Its speech observer measured only relative head rotation, which can remain at
a stop while the neck visibly carries the head, and its short plate sample
missed a fixed positive-lift threshold. The observer now follows the composed
body/neck/head orientation and requires visible motion; the plate check samples
a longer interval and retains its movement threshold for either direction.
Four corrected speech cases pass together with unchanged runtime source and
all original exact pose, offset, transport and clearance assertions preserved.
Side rest, contact, lift, reversal and Face screenshots were visually reviewed.

Artifacts are retained as `/tmp/roach-head-plate-*-after-20261002.png`,
`/tmp/roach-head-plate-contact-after-20261002.json`, and the focused, broader and
corrected browser logs. Physical devices and listening were not tested.

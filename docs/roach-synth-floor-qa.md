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

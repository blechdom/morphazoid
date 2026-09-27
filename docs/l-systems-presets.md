# L-Systems presets, shared controls and sound update

Source base: `f30859b28d257d6cbe7d6522da451f1719fb1af1`.
Route: `l-systems.html`. The original synth, drums and `l-mic.html` remain available.

## Performance contract

- The first control-panel row is **Choose preset → Next → Random**. Registration
  does not recall a scene. There are 48 authored main scenes: 16 Continuous,
  16 Notes and 16 Triggers, with independent geometry, motion, timbre, envelopes
  and mix values. Random creates a full new state, not a random factory recall.
- Mic has its own 16-scene bank imported from L-System Delay's actual
  `MICMIC_FULL_PRESETS`. Main scenes never overwrite Mic sounds; Mic scenes never
  overwrite synth, trigger or envelope settings. Geometry is deliberately shared.
- Recall/random retain Audio, Play, reader position and master level. Mic random
  also retains the user's input trim and Mic mix level. The ranges selected by
  presets/random are moderate, not restrictions on the instrument's controls.
- Same-mode recall and live edits reconfigure the existing audio clock. They do
  not cancel the pending note window or sounding tails. Actual route changes
  prepare the selected engine; Audio and Play remain independently controlled.
- Presets/random never ask for microphone permission. Explicit Audio or selecting
  Mic while Audio is armed starts input. Leaving Mic releases its stream.

## Controls and sound

Shared control ordering follows Delay: L-system type; Branching (iterations or
1–13 generations, pruning priority, decay); Timing (child ratio and Mic time
fold); Pitch (angle and Mic pitch scale); Variation (asymmetry and mutation).
Speed and integer subdivisions remain near the top beside transport.

**Growth model** preserves both original grammar rewriting and Delay generation
geometry. The latter also works in Continuous, Notes and Triggers. Mutation is
stable/deterministic. Child ratio changes inherited segment timing; pruning
prioritizes trunks or twigs when the existing voice/event budget is exceeded.

Synth choices are Sine, Triangle, Square, Saw, FM, PM and Shepard. Graph-inspired
additions are editable FM/PM ratio, one smoothed low-pass tone/resonance stage,
and density-following or fixed note duration alongside the existing envelope.
FM/PM has a small trunk drive so non-forking grammars can still use modulation.
Wave-specific gain factors and moderate factory modulation reduce level/edge
without reducing the manual parameter ranges.

Triggers reuse Graph's existing FM styles plus actual Rattlesnake physical and
Karplus strings, tines and objects. Voice-map rows select the appropriate material.
This is shared engine reuse, not a new authentic-acoustic-model claim.

Conditional controls are hidden, not deleted:

- Generation Mic hides reader speed, position, traversal/structure, subdivisions,
  reader feedback/timing/bend and length scale; it exposes time fold, pitch scale
  and dry input. Original reader Mic retains its original controls and has its
  own pitch-source selection.
- FM/PM ratio and index are shown for those engines. Depth drive remains visible
  in Notes (it also changes note weight/timing) and for Continuous FM/PM/Shepard.
- Fixed note duration is shown only in Notes with fixed articulation.
- Branch decay/pruning are hidden for non-forking reader geometries; generation
  Mic retains them for its tap allocation.

## Audio and resource boundaries

The synth retains `VoicePool` and its bounded oscillator worklet, not Graph's
native graph per note. Notes/Triggers keep the existing 85ms lookahead, 25ms poll,
128 starts/second, burst16 and max8 grouped simultaneous starts; timed note
voices remain capped at128. Graph's physical engine additionally caps Karplus
starts at24/second and Rattlesnake at240/second.

Mic now owns **one stream and one AudioContext**. It preserves the original reader
processor and adds Delay's existing raw-history granular generation processor;
both collect the same live input so switching growth model does not reopen the
device. Generation rendering is fixed at128 virtual taps with24 shifted pitch
classes plus exact unison and40 seconds of input history. This does **not** port
Delay's optional Signalsmith spectral backends or its freeze controls. Imported
preset topology/timing/pitch/decay/wet/dry/pruning values are preserved, not a claim
of bit-identical output gain to the standalone instrument.

Mic preset/slider edits replace tap targets, not processor/history. Stop silences
wet and dry output but keeps granted input; Audio off/route exit releases input;
pagehide closes outputs, contexts and scheduling. Late permission results are
stopped, and a processor failure can be recovered by an explicit Audio action.

## Verification and remaining acceptance

Focused unit coverage: complete schemas, all64 scene captures, cross-bank
boundaries, deterministic full-state random field coverage, original default
trace equality, timing/mutation/pruning effects, finite traversable topology,
new waveform/ratio/note mappings, Karplus row selection and host mute.

Chromium coverage: desktop1440×900, touch portrait390×844, touch landscape844×390;
all64 Next recalls; Random; appropriate control visibility; no implicit Audio or
mic grant; dense Notes and held ADSR/range gestures; same-clock live recall;
new waves and percussion; one-stream/history Mic edits; cancellation, Stop,
Audio off, processor-error recovery and pagehide cleanup. Synthetic220Hz input
is used for Mic tests, not an actual microphone or phone.

Exact feature amendments are in `l-systems-presets-runtime-changes.json`, reversed
before the earlier Notes amendment. No relocation hashes are refreshed. Runtime
files are explicitly declared and WAX is generated, not hand-edited.

Automated bounded signal/meter and continuity checks are **not human listening**.
Physical-phone CPU, real microphone feedback safety, musical preference, preset
level matching by ear, and timbral acceptance remain unperformed.

### Completed automated gate

- Focused preset/Notes/suite/amendment/rollout tests: **77 passed**; toolbar-host
  contract tests: **3 passed**.
- Final Chromium gate: **40 passed**, including the two L-Systems suites plus
  its shared canvas sizing/resize and metadata/bootstrap cases.
- `npm run verify`: **4,552 passed, 6 skipped, 0 failed**; syntax, SIMD, XYFlow
  and clean-build WAX parity passed.
- `npm run build:wax` and `npm run build:site`: passed. Production runtime JS
  matches source; production HTML adds only the expected social-preview tags.
- Phone portrait/landscape screenshots were inspected mechanically. No human
  listening, physical-phone or real-microphone pass was performed.

During development, one test run overlapped WAX regeneration and briefly saw a
missing generated shader file. After serializing builds/verification, the clean
run passed. The toolbar test was extended to recognize this app's explicit
sticky-header preset host, while retaining the single-host/placement checks.

Preview used `http://127.0.0.1:3456/l-systems.html` from the isolated
`morphazoid-l-systems-presets` worktree on `codex/l-systems-presets-20260926`.
The preview controller's SHA-256 matched the worktree source:
`6e7187e721973d02fae7e49dcaf189ce95fdc0e3f2da6b2104413ab37dd39b8e`.
The implementation review above preceded the later request to push to main.
Publication integration and its fresh-main checks are recorded separately below.

## Publication integration

Rebased onto `fbdea09260c0c6b126b0f751cf561c957fe13da3` before pushing.
Current-main Gesticules, Hybrinx and SIMD Chiptune changes were retained. The only
textual conflicts were the shared runtime inventory and preset rollout counts;
main's entries were preserved and L-Systems' reviewed additions were applied.
No L-Systems audio dependency had changed on the incoming main.

Fresh-main gate:

- Focused L-Systems, frozen-amendment, rollout and toolbar checks: **80 passed**.
- Browser continuity, presets, Mic, phone layout and shared canvas/bootstrap
  regressions: **40 passed**.
- `npm run verify`: **4,590 passed, 6 skipped, 0 failed**, including syntax,
  SIMD, XYFlow and clean-build WAX parity.
- `npm run build:wax`, `npm run build:deploy` and
  `npm run check:storybook-dist`: passed (213 WAX pages, 112 Storybook entries).
- No new human listening or physical-device acceptance is implied by publication.

A second main update arrived before the push. Rebased cleanly onto
`a0921c71ad26b6883b1d1505d39d966a90848d88`; incoming changes only softened the
Gesticules foot bend and updated Chiptune skin artwork (and their WAX copies).
No L-Systems or shared audio/control dependency changed. Follow-up L-Systems,
shared-contract and both affected-owner tests: **93 passed, 0 failed**.
`npm run check:wax-dist` again matched a clean build.

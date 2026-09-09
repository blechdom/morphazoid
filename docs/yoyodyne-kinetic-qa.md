# Yoyodyne kinetic prototype — verification

Date: 2026-09-08. Branch: `codex/yoyodyne`. Preview:
http://127.0.0.1:3440/yoyodyne.html, served from the isolated
`morphazoid-yoyodyne` worktree under this task's visualization directory.
No commit, push, or deployment was performed.

## Implemented slice

The instrument-development skill shaped one causal model: throw/tug/hand motion
moves a constrained yo-yo, spin excites a continuous sounding string, and length,
tension, motion, angle and position change its voice. Four hand routines replace
the timeline and note/tine layout. The responsive/audio skill drove explicit
Audio/transport separation, live-edit continuity, phone reachability, and
lifecycle checks. Perceptual QA remains automated characterization only.

The model uses authored dimensions, a compliant unilateral string, separate axial
spin, a lossy bind approximation, and prescribed cradle geometry. It is not a
validated simulator of full yo-yo string topology or real nylon-string acoustics.

## Automated evidence

- 15 focused Node tests passed: deterministic reset, throw/sleep/bind/catch,
  a complete paid-out Around-the-World orbit, cradle string-length conservation,
  repeated routines, control sensitivity, bounded extremes, stereo DSP, release,
  smoothing, worklet queue bounds, stale-input fade and disposal.
- 11 focused Chrome browser tests passed: explicit Audio, keyboard and pointer
  gestures, all four actual worklet scenes, live edits, mute/pause, context
  interruption/resume, hidden-page recovery, repeated arming, teardown, and
  desktop 1440x900 / portrait 390x844 / landscape 844x390.
- Three shared Yoyodyne audits passed: route smoke, shared UI contract and
  responsive reachability. The combined run also incidentally selected and
  passed three Kinetic Hull audits: 17 browser tests total.
- The explicit WCAG 2/2.1/2.2 A/AA axe scan reported zero violations.
- 359 files passed the syntax inventory from `package.json`.
- The repository-wide Node run reported 2,835 passed, 6 skipped, 2 failed.
  The additional worklet test was added afterward and passed in the focused run.
- Clean static output was generated through `scripts/build-site.sh`, followed
  by the repository's Dentaphone/Hiccup fingerprint functions and
  `addWaxLayer`. Every byte and file name in `dist-wax` matched the final
  clean WAX build: 1,360 files. Authored HTML remains free of WAX bootstrap code.
- `git diff --check` passed.

The normal `npm run verify` launcher was unavailable on this host (no npm).
Its syntax and Node-test inventories ran using the bundled Node 24 runtime.
The WAX build/parity steps ran through WSL plus the exported repository build
transforms because Windows Node passes incompatible output paths to WSL Bash.

The two full-suite failures are the previously observed Windows/WSL build-helper
failures in `tests/aws-deployment.test.mjs`: the site builder could not find
`vendor/three/three.core.min.js` beneath its Windows temporary output path, and
the deploy-helper fixture cleanup reported EBUSY. They are not a green full-suite
result. The malformed generated directory was moved, not deleted, into
`test-results/failed-windows-site-builder-output`.

## Signal characterization — not a listening approval

Deterministic stereo render, 48 kHz, 6 seconds per trick, default controls,
40% output, with short section-edge fades. This is a render of the pure model
and the same DSP used in the worklet, not a microphone or speaker recording.
All samples were finite, with no clipping.

| Routine | Peak | Stereo RMS | Maximum adjacent-sample change |
| --- | ---: | ---: | ---: |
| Sleeper | 0.0601 | 0.0342 | 0.00248 |
| Rock the Cradle | 0.0703 | 0.0220 | 0.00355 |
| Around the World | 0.0722 | 0.0192 | 0.01064 |
| Gravity Pull | 0.0600 | 0.0305 | 0.00351 |

The actual browser output separately passed finite, non-silent stereo and
no-clipping tests. Numerical differences among routines and control settings
prove measurable leverage, not musical usefulness or timbral quality.
The worklet smooths targets over approximately 25 ms and fades on stale input.
Automated catch/release reaches silence; subjective click judgment is unperformed.

Local generated listening artifact:
`test-results/yoyodyne-four-tricks.wav` (24 seconds, routines in table order).
Metrics: `test-results/yoyodyne-characterization.json`.

## Human/device pass still needed

Listen at a low, consistent level: Audio -> Perform -> each of the four routines.
Then try Throw, drag the hand, Tug, and Catch. Check whether the sound reads as
one expressive spinning-string instrument, whether moving length/tension feels
musically useful, and whether the looping defaults become tiring or piercing.
Human listening, physical touch/controller feel, real MIDI hardware, physical
audio output routing, and an actual WAX host have not been evaluated.

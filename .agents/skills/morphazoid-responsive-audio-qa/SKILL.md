---
name: morphazoid-responsive-audio-qa
description: Run mechanical regression QA for a Morphazoid browser instrument whose layout, accessibility, input, transport, state lifecycle, or Web Audio contracts changed. Use after UI/audio implementation or when controls disappear, overlays block gestures, playback stops during edits, or mobile differs from desktop; use morphazoid-perceptual-qa for timbre, control-leverage, preset-separation, click, or listening-readiness diagnosis.
---

# Morphazoid responsive and audio QA

Verify the instrument as an interaction, not as a screenshot. This workflow
proves mechanical contracts; it does not claim perceptual or musical quality.

## Establish the risk surface

Read changed files and identify transport state, audio lifecycle, render loop, breakpoint rules, nested scrollers, overlays, stored state, and navigation/catalogue integration. Choose focused tests before the broad suite.

## Exercise state transitions

While sound is active, test play/stop/loop, preset and bank changes, modes or dimensions, hold/press/release controls, randomize/reset, modulation, rapid repeated transitions, and retained state where supported.

Playback should continue through non-transport edits. Check mechanically for
doubled voices, stale silent nodes, runaway gain, duplicated timers/listeners,
dropouts, and UI state diverging from sound state. Record transient candidates,
but route audible click judgment to `morphazoid-perceptual-qa`.

## Exercise parameter meaning

Move every prominent viewport control and representative side-panel controls
through minimum, middle, and maximum. Confirm visible change, a real model or DSP
destination where promised, safe numerical bounds, and recovery. This pass may
prove that state or measured output changed; use `morphazoid-perceptual-qa` to
decide whether the audible leverage or musical result is adequate.

## Exercise viewports

Check a normal desktop viewport, narrow phone portrait, and short phone landscape. At each size confirm the full instrument can be understood, all controls remain reachable, touch targets remain usable, the intended panel scrolls, the document does not accidentally overflow, labels remain legible, and no overlay blocks gestures. Check resize and orientation changes during playback.

## Verify integration

Run relevant pure and interaction tests, navigation/catalogue tests when registration changed, JavaScript syntax checks, and the production build path. Run `npm run verify` before handoff when feasible. Report exact commands and results, including pre-existing failures.

Do not declare success solely because a page loaded or one screenshot looked correct.

Run this mechanical gate before perceptual QA when both apply. Perceptual QA may
consume its routes, traces, and transient candidates without repeating the full
responsive matrix.

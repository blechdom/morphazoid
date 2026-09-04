---
name: morphazoid-responsive-audio-qa
description: Verify a Morphazoid instrument whose graphics, controls, responsive layout, transport, presets, modulation, or Web Audio behavior changed. Use after instrument UI/audio work or when controls disappear, overlays cover the viewport, playback stops during edits, or mobile portrait/landscape differs from desktop.
---

# Morphazoid responsive and audio QA

Verify the instrument as an interaction, not as a screenshot.

## Establish the risk surface

Read changed files and identify transport state, audio lifecycle, render loop, breakpoint rules, nested scrollers, overlays, stored state, and navigation/catalogue integration. Choose focused tests before the broad suite.

## Exercise state transitions

While sound is active, test play/stop/loop, preset and bank changes, modes or dimensions, hold/press/release controls, randomize/reset, modulation, rapid repeated transitions, and retained state where supported.

Playback should continue through non-transport edits. Check for clicks, doubled voices, stale silent nodes, runaway gain, duplicated timers/listeners, and UI state diverging from sound state.

## Exercise parameter meaning

Move every prominent viewport control and representative side-panel controls through minimum, middle, and maximum. Confirm visible change, audible change where promised, safe numerical bounds, and recovery. Measure output or internal state when listening is ambiguous.

## Exercise viewports

Check a normal desktop viewport, narrow phone portrait, and short phone landscape. At each size confirm the full instrument can be understood, all controls remain reachable, touch targets remain usable, the intended panel scrolls, the document does not accidentally overflow, labels remain legible, and no overlay blocks gestures. Check resize and orientation changes during playback.

## Verify integration

Run relevant pure and interaction tests, navigation/catalogue tests when registration changed, JavaScript syntax checks, and the production build path. Run `npm run verify` before handoff when feasible. Report exact commands and results, including pre-existing failures.

Do not declare success solely because a page loaded or one screenshot looked correct.

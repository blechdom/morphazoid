# Starting-instrument review — September 18, 2026

**Later September 18 update:** Tape Worm and Loop Soup now use editable
multi-loop network engines and native in-loop controls. See
[loop-network QA](loop-networks-qa.md) for the current tests. The fixed-loop
limits and counts below describe the earlier, published five-demo checkpoint.

Source worktree: `/home/blechdom/creative/morphazoid`, local `main`, based on
`a17d7b5`. This report records the pre-publication acceptance checks for the
five demos and their September 18 clarity review.

## September 18 review

**Final gates:** 3,623 Node tests passed, 6 skipped, none failed; all 502 syntax
targets parsed; WAX/XYFlow parity passed; public/Storybook build and artifact
validation passed. The expanded demo browser suite passed **40 tests** and the
standard route/shared-navigation suites passed **10 additional tests**.
The focused engine/worklet suite passed **20 tests**.

Added per-instrument listening exercises, sound/mechanism explanations, graphic
legends, individual control descriptions, keyboard alternatives, and explicit
capability/memory limits. These are in the authored HTML, behind a stage-linked
**How it works / listening exercise** disclosure. Preset descriptions remain
next to Starting point; manually altered values show **Custom settings**.

Consistency findings fixed:

- Loop Soup lost pre-Audio Hold and erasure edits during worklet initialization.
  Its initial handoff now preserves modes and resamples the edited preview
  tapes at the actual audio rate. Reset no longer releases held bowls.
- Hollowphonic's pre-Audio bypass state did not survive the handoff, and reset
  could leave bypass enabled. Both now agree with the displayed state.
- Habit Habitat reset and counters were incomplete. Reset explicitly returns
  to Recall with a reproducible walk while retaining learned weights; initial
  Audio handoff retains the manual-teaching sequence. Added labelled From/To
  controls for deterministic, keyboard-accessible route weakening.
- Tape Worm could report a successful recording after rejecting a too-short
  take. Capture now reports accepted/rejected status. Reader tape and replacement
  target are distinguished; Tape A/B names match the drawing.
- Tape Worm only drew departure handles. IN diamonds, OUT circles, directed
  connections, drag-to-edit arrival, and percentage readouts now explain both
  positions and the fact that both tapes share their gate parameters.
- Tempo Tantrum's radial drag and displayed radial offset used different scales.
  They now agree. The display shows all possible nominal phase branches rather
  than a single guide jumping backwards once per drive cycle.
- Arrow keys no longer erase Loop Soup accidentally while its erase brush is off.
- Source notes distinguish silent strikes, a selected but disabled microphone,
  and active loop ingredients. Pause, mute, monitoring and capture are explained
  separately rather than implying that all four stop together.

All five stages, a settled phone view with open instructions, and the new
catalogue card were visually inspected. The first full-page phone capture
caught a layout frame; the settled canvas was checked to contain rendered pixels
before and after the help disclosure opened.

Twenty six-second stereo preset renders at 24 kHz were characterized again,
with metrics in `test-results/starting-instruments-review/preset-metrics.json`.
Per-instrument maximum sample peaks at the default output setting:
Tempo Tantrum 0.174; Tape Worm 0.123; Loop Soup 0.105; Habit Habitat 0.148;
Hollowphonic 0.091. These are signal measurements, **not human listening
approval** or proof of perceptually click-free behavior.

The full freely editable multi-head/record-head graph looper and automatic
first-loop analysis are **not implemented**. The distinction from these five
mechanism studies is documented in `starting-instruments.md`.

## September 17 initial baseline

### Automated results at that checkpoint

- **Full `npm run verify`:** 3,620 passed, 6 skipped, 0 failed.
  Syntax checking, XYFlow determinism and committed WAX parity passed.
- **Focused core/worklet tests:** 17 passed, covering all five engines.
- **Final new-instrument browser suite:** 31 passed. Desktop 1440×900,
  portrait 390×844 and landscape 844×390, plus emulated coarse-pointer input.
- **Public release build:** passed. The generated site contains 182 WAX pages.
- **Generated-byte audit:** all five pages' core dependencies and icons match
  source in `dist/`, `dist-wax/`, and `dist/dist-wax/`.
- **WAX browser pass:** all five generated pages start with Audio off, then load
  and run their worklet with exactly one output-manager connection and no page
  errors. This is not a real DAW-host test.

## Tested relationships

- Tempo Tantrum settles into phase lock, loses lock outside its coupling range,
  and recovers after a body-specific phase nudge. Unforced phase evolution
  matches the ODE; silent-preview and sample-rate stepping agree within tolerance.
- Tape Worm changes route without changing stored samples. File decoding and
  synthetic microphone recording reach the real browser worklet. Short recordings
  retain the previous tape. Reset keeps the loaded audio and playing transport.
- Loop Soup's Hold mode preserves samples exactly. Overdub changes them; selected
  erasure removes a region. Maximum input/retention/spill remains bounded.
- Habit Habitat learns from manual visits, not recall. Seeded recall is
  deterministic, memory round-trips through browser storage, invalid memory is
  rejected, and selective forgetting weakens only the selected route.
- Hollowphonic's depth changes resonant delays, damping changes the response,
  strikes excite silent-source chambers, and bypass changes the transmitted signal.
- No Play, stage key, MIDI-note handoff, or pointer gesture implicitly creates
  audio. Audio Off mutes while transport continues. Pause releases sound. Pagehide
  releases the output connection and media.
- Delayed/cancelled microphone grants cannot retain live tracks. Rapid Audio
  cancellation cannot revive an older start or duplicate output connections.
  Unsupported Web Audio produces a truthful error rather than an “on” indicator.
- Actual pointer drags, keyboard alternatives, emulated touch scrolling,
  navigation hydration, and critical/serious accessibility checks passed.

## Issues found and fixed

The first browser pass exposed the shared legacy reset handler reloading Tape
Worm; the new pages now explicitly own in-place reset and retain their recordings.
The new catalogue additions initially invalidated several old fixed-position
assertions. The existing catalogue order is now preserved, the new entries are
appended, and explicit tests cover the additions. The fractal trio test continues
to require the same three contiguous records, without requiring them to remain
the last instruments forever.

## Audition evidence and remaining human checks

Twenty deterministic stereo model renders (four presets per instrument) are
available locally in `test-results/starting-instruments-audio/`, with metrics in
`metrics.json`. Six-second, 24 kHz renders at the default output level had maximum
sample peaks between 0.091 and 0.174 across the five instruments. The silent-source
Hollowphonic preset was explicitly struck for its render.

Both desktop stages and the phone layout were visually inspected. **No human
listening approval, real microphone, hardware MIDI, DAW/WAX host, or physical
phone pass was performed.** Finite audio and successful browser tests do not
establish timbral quality, click-free perception, controller feel, or the musical
usefulness of the locking and splicing gestures.

The pre-existing staged CSV and uncommitted logo-suggestion collection were
preserved and were not included in this work.

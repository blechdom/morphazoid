# Shape: remaining clicks and full-parameter randomization

September 21, 2026. Local uncommitted work on `codex/full-instrument-presets`;
not a deployed or listening-approved build.

The owner still hears Shape clicks after the rounded-attack preset changes.
That feedback remains an unresolved perceptual defect. This pass does not
claim that another envelope adjustment has solved it.

## Confirmed code paths and targeted changes

### Stale corner strikes after a paint stall

Shape computes corner crossings from the elapsed audio-clock interval, but its
percussion flush previously compressed every interval into at most 30 ms.
A one-second delayed frame could therefore replay that second's crossings as a
short burst. Softer single-note attacks do not correct that timing behavior.

`planShapeCornerStrikes` now drops crossings outside the latest 30 ms before
gain normalization, preserves the remaining event spacing, and anchors the
batch to one absolute audio-clock time. Normal frame intervals up to 30 ms keep
their previous relative scheduling. In the deterministic 100-crossing /
one-second fixture, the authored flush now schedules four recent events rather
than 100 compressed attacks.

**Boundary:** detection still runs from the paint loop. This prevents overdue
bursts; it does not prove uninterrupted audio through a long main-thread stall
or replace a future paint-independent scheduling pass.

### Interrupted attack-noise envelopes

The existing tone crossfade held its current level, but the noise path cancelled
its scheduled ramps before starting a release. Removing the ramp endpoint can
change the level being released. The revised Shape path holds the current noise
level first, then releases to zero. The fallback reconstructs the known linear
envelope value instead of guessing from `AudioParam.value`.

This opts in through Shape's existing `attackCurve: "smooth"` strike path.
Other strike callers retain their previous noise automation. Original tone
decay, frequency, peak limits and named preset data are unchanged. No broad
filter, waveform replacement or worklet rewrite was used to hide transients.

## Mechanical evidence, not a listening verdict

**249 checks passed, six skipped, zero failures** across 21 direct Node suites
after both changes. The full repository/browser/WAX gates were not run.

`tests/shape-click-paths.test.mjs` checks:

- normal-frame event timing and immutable input;
- stale-event rejection with retained spacing at 100 ms, 250 ms and one second;
- the actual authored flush and peak normalization after stale-event removal;
- hold-before-release on native noise retriggers;
- fallback held levels during attack, decay and repeated releases;
- unchanged default noise-release automation for other callers.

Existing strike-onset, audio, preset, geometry and instrument checks remain
applicable. These are scheduling/control-flow tests, not a recording of the
reported clicks.

The simultaneous randomizer correction replaces factory-derived mutations with
direct instrument-specific generation. Every preset-owned musical parameter
is covered; output level, instrument identity, live devices/clocks and necessary
derived anchors remain protected. See [the randomization contract](header-preset-random.md).

## Still needed

Browser/audio execution remains unverified after the earlier approval-service
failures. No indirect retry was used. Full repository verification, generated
WAX parity, real-browser recordings and human listening remain pending.

To isolate the remaining complaint, record the exact preset (or randomized
settings), sound mode, browser/device, and whether clicks occur during steady
playback, a rotation reversal, or a preset/control change. Compare those windows
with intended percussion attacks before changing another synthesis path.

Before-source snapshots and test logs:
`test-results/full-parameter-random/`.

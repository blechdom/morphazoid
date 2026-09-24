# Automatapoeia: explicit transport and next-row edits

Owner-requested behavior, September 24, 2026. This supersedes the immediate
preset-reseed behavior in the earlier note-release fix.

## Performer contract

- Load paused with an empty dark stage and Audio off. The prepared seed is not
  displayed or sounded until Play. The shared round
  Play/Pause control sits beside Generation rate, outside disclosures. Space
  uses the site's existing protected-focus transport shortcut.
- The graphic has no visible title, caption or status text overlays. Its
  accessible heading, canvas instructions and readout metadata remain intact.
- First Play schedules the seed itself as generation zero, before its first
  descendant. It enters at the bottom; every subsequent row enters below it and
  shifts the existing history upward immediately, even before the viewport fills.
  With Audio armed, the seed is sounded by the same audio-clock event that
  presents it. Rendering never creates a seed or advances the score.
- Play thereafter advances the existing automaton. Audio is a separate arm: Play never
  enables Audio, and enabling Audio while paused never advances or auditions a
  row. Pausing releases sound/queued attacks and preserves rows and position.
  Resuming continues the current lineage, rather than restarting at row zero.
- Presets, Next, dice and live evolution/sound controls preserve all existing
  cells, history and generation count. While playing, their new values drive
  the **next unheard row**, not an arbitrary row after the whole lookahead.
  Edits while paused stay silent and take effect when evolution resumes.
- Changing rate/swing while sounding retains the already-running row's next
  boundary. Subsequent intervals use the new timing values. Musical Swing and
  Time spread retain their original meanings.
- Width changes use the existing centered resize transition on the next row;
  earlier rows remain intact. Family/rule/boundary/transform changes evolve
  directly from the latest cells.
- Seed density remains an initial-condition control: it does not randomly
  replace living cells on a parameter edit. Before first Play (while the history
  is empty), current width/density set the initial row. Restart/Reseed also use
  them explicitly.
  Presets retain their deterministic sound-seed metadata, but do not rebuild
  `caInitialRow` or generate a new cellular lineage. The original seed-row
  metadata remains separate from that preset sound seed.
- **Restart** deliberately clears to an empty stage and queues the seed if
  playing, or waits for Play if paused. **Reseed** deliberately appends a
  new seed lineage without clearing earlier rows; on an empty paused stage it
  only prepares a seed. Neither changes Play or
  Audio. An extinct row stays extinct under a rule that cannot revive it;
  choosing a preset no longer secretly repairs it by reseeding.

## Audio boundary

The independent `AutomatapoeiaClock` still fills a 350 ms audio-time queue.
`revise()` first presents rows already heard, keeps the earliest unheard row's
original timestamp, discards its future score snapshots, and regenerates from
that last presented row. Repeated edits before a boundary replace the same
future row rather than appending generations or rebasing the metronome.

`cancelAutomataFrom(when)` cancels only future buffer attacks. Buffers already
sounding retain their natural finite tails. The sine bank's logical state had
already advanced through lookahead, so its old held columns fade over 8 ms at
the boundary and retire within 12 ms; replacement columns are scheduled from
the new row. Unstarted old columns stop at the boundary without sounding.
Physical source ownership is retained until `ended`, including canceled future
nodes, so Pause/Audio off/teardown can still stop everything.

This is bounded main-thread lookahead, not a worker/worklet migration. Long UI
stalls beyond available headroom can still lose attacks. A control edit made
extremely close to a deadline can also miss its audio submission; stale attacks
are skipped, not replayed late. Rendering remains subordinate to audio. No
claim of unconditional hard-real-time behavior or human listening acceptance.

## Preservation and evidence

- Original model, row DSP, factory snapshot values, parameter ranges, public
  route and control IDs remain intact. Only factory *descriptions* changed to
  stop promising a new seed lineage on recall.
- The earlier SHA fixtures and separate note-release/audio-clock amendments are
  unchanged. `automatapoeia-live-transport-runtime-changes.json` records the
  additional controller/description edits, reversed first in preservation tests.
- `automatapoeia-live-transport.test.mjs` covers same-boundary rewinds, repeated
  edits, low-rate empty lookahead, selective tail preservation, future-attack
  cancellation and panic ownership.
- The updated lifecycle tests cover all twelve presets, dice, mode controls,
  validation-before-mutation, Audio-off recall and retained cells/Play state.
- `automatapoeia-live-transport.spec.mjs` exercises actual source/WAX pages:
  paused startup, independent Audio, control position, Space, pause/resume,
  unchanged history and exact next-row cells/deadlines after preset/live edits.
- Existing timing tests still withhold RAF for 1.5 s and block the UI for 240 ms;
  the source and WAX pages must retain sample-timed straight row intervals.

See local verification logs under
`test-results/automatapoeia-live-transport-20260924/` (ignored, machine-local).

## Final local verification — September 24, 2026

Integrated onto freshly fetched `origin/main` at `b5020b3`, retaining its Shapes
sound-bank changes. The sole textual conflict was additive runtime-manifest
entries; both features' required paths are retained. The neighboring main
worktree was not changed.

- `npm run verify`: **4,235 passed, six skipped**, no failures; source/SIMD,
  XYFlow and clean-build WAX parity passed on Node 22.23.2.
- `npm run build:site`: passed, including 209 generated WAX pages.
- The five focused Automatapoeia browser suites: **17 passed** after integration,
  covering source/WAX playback, next-row edits, note retirement, clock stalls,
  rule changes and all three required viewports.
- All thirteen Faves' toolbar checks at three viewports: **39 passed**.
  Shared experiments-family route smoke: **16 passed**.
- Earlier repeated transport/clock/lifecycle checks: **39 passed** over three
  repetitions; focused Node/controller/preservation checks: **82 passed**.
- Desktop, portrait and landscape screenshots were inspected. Landscape voice
  selection ends at 386.25 px in the 390 px viewport; all primary touch targets
  retain 48 px. The former landscape visibility failure is resolved without
  changing its assertion.

These are local automated and visual checks, not deployment, listening,
physical-phone or real-MIDI acceptance. Publication remains a separate action.

Main subsequently advanced with the Puggler-only update `43592fc`. The candidate
was rebased again without changing Automatapoeia runtime or its browser tests.
The full gate was rerun: **4,239 passed, six skipped**, no failures; WAX parity
and a fresh production-site build passed. Earlier browser evidence above still
covers the byte-identical Automatapoeia/Faves runtime.

## Bottom-entry follow-up — September 24, 2026

Owner request: start from nothing, hear the first seed row, and scroll upward
from the bottom immediately rather than first filling downward. This supersedes
the former visible-seed startup. The startup lead remains 60 ms on the audio
clock; original within-row onset offsets, swing, tails and DSP are unchanged.
Pausing before the first deadline cancels its queued sound and leaves the stage
empty; resuming schedules that seed again. Once heard, normal pause/resume does
not repeat the seed. Edits made before the first deadline replace that same
seed slot rather than skipping to a descendant.

`automatapoeia-bottom-entry-runtime-changes.json` records only this additional
controller amendment, reversed before the existing frozen amendments. Focused
Node tests exercise the real controller and clock with a deterministic time
source; browser tests inspect actual canvas pixels/draw positions, native audio
buffers and output activity on source/WAX at all three viewports.

### Bottom-entry verification

- `npm run verify`: **4,244 passed, six skipped**, no failures; source/SIMD,
  XYFlow and clean-build WAX parity passed on Node 22.23.2.
- `npm run build:site`: passed, including 209 generated WAX pages.
- Six focused Automatapoeia browser suites: **23 passed**, including source/WAX
  first-seed audio and bottom placement, next-row edits, held-note release,
  stopped-RAF/UI-stall timing, totalistic rules and mobile control reachability.
- Shared experiments-family route smoke: **16 passed**.
- Focused Node/controller/preservation checks: **88 passed**.
- Empty, one-seed and growing-history screenshots inspected at desktop
  1440×900, portrait 390×844 and landscape 844×390. First-seed captures all
  contain exactly one row at generation zero. The legacy fill test now waits
  for actual viewport fill; its final square-cell and crop assertions remain
  unchanged.

Evidence is machine-local under
`test-results/automatapoeia-bottom-entry-20260924/`. These are automated and
visual checks, not human listening, physical-phone or MIDI acceptance.

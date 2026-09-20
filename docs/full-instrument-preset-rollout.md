# Full-instrument preset rollout — September 20, 2026

## Current checkpoint: navigation complete, preset rollout not implemented

Branch: `codex/full-instrument-presets`

Worktree: `/home/blechdom/creative/morphazoid-presets`

Preview: `http://localhost:4370/`

This branch starts from the catalogue/file-layout refactor rebased onto main's
`e042512` loop-network update. Both the refactor and the newer Tape Worm/Loop Soup
implementations are retained. The old review and publication worktrees remain
available.

The owner's latest instruction is to prepare a **test branch**, not publish
these pending changes to main. No main push or deployment has occurred.

Completed navigation changes:

- Creaturazoid is immediately after Hiccup Head in Faves.
- Spiral is removed from Faves only. It remains in Tesselation, search, and the
  normal instrument tour.
- The homepage Faves section uses the same explicit order as the Choose menu.
- A next-instrument arrow sits directly beside Choose. It follows visible menu
  order, starting with Faves, skips duplicate visits, and wraps at the end.
  Hidden WIP entries are not silently added to that tour.
- The arrow uses ordinary page navigation, retaining new-tab behavior and
  normal page teardown. Source-instrument query/hash values are not transferred
  to a different instrument; Audio remains off on arrival.
- Focused arrow keydowns do not leak into legacy instrument shortcuts.
  Keyup still propagates so existing held notes can release.
- Touch targets are 48px; keyboard Enter activates the link.

**There is not yet a new header preset control or a set of 12 whole-instrument
presets on every page.** The source inventory is the first rollout step; it is
not preset implementation or a musical-quality approval.

### Checkpoint verification

- `npm run verify`: **3,661 passed**, six skipped, zero failures; regenerated
  WAX and XYFlow parity passed.
- Selected navigation/catalogue/shared-header/audio/MIDI/loop-network/starting-
  instrument browser batch: **230 passed**.
- `npm run build:deploy` and `npm run check:storybook-dist`: passed, including
  109 Storybook entries. The existing large-chunk advisory remains unchanged.
- Homepage Faves order and arrow captured at desktop, phone portrait and phone
  landscape; no document horizontal overflow.
- Preset source inventory: **154 entries** (147 regular instruments, seven labs);
  all remain marked unreviewed/unmigrated for whole-instrument presets.

These checks approve the mechanics of this navigation checkpoint, not the
unimplemented preset migration or a new listening pass. Historical smoke
failures described in the catalogue/layout report are not silently waived or
reclassified as passing by this selected browser run.

Local evidence lives under `test-results/preset-rollout/`, including `verify.log`,
`browser.log`, `production-build.log`, `inventory.json`, and the three viewport
captures. Ignored logs and screenshots are not included in the branch commit.

## Accepted preset requirements

1. Every regular instrument gets one main preset selector plus next arrow in
   the menu bar, immediately to the **left of the sound meters**.
2. Reuse the existing Choose-menu markup/styles/interactions. Do not introduce
   a different-looking selector or an unrelated component framework.
3. Every main preset bank has at least **12 full-instrument presets**. Keep
   existing useful preset names and settings rather than discarding them to
   meet a count.
4. Instruments without presets need 12 deliberately authored starting points,
   not a random multiplier applied to all range controls.
5. Existing preset button banks/selectors move into the header only when their
   real recall behavior has a verified replacement. Remove duplicate old
   performance controls at that point, not before.
6. Multi-bank instruments need complete scenes. Creaturazoid must recall body,
   anatomy, modulation and sequence/tempo together; Hiccup Head must recall
   face, voice/sound bank, effects and pattern/tempo together. Applying only one
   half while retaining arbitrary edited values from the other is not a full
   preset.
7. Default arrow-key navigation advances/reverses main presets. It must not
   steal text editing, range/select manipulation, sequence editing, canvas
   gestures, or navigation-menu keyboard behavior.
8. Preserve explicit Audio arming, transport state, clocks, saved banks,
   imported recordings, device routing and microphone permissions. Selecting a
   preset must not silently arm Audio, ask for microphone access, or destroy
   user recordings.

The seven existing labs are separately identified in the inventory. They are
not silently counted as fully compliant instruments, nor assigned fictional
MIDI, state or preset capabilities.

## Rollout sequence

### 1. Survey and classify state ownership

`npm run analyze:presets` reads every current catalogue page and its entry modules
plus two levels of static local imports. It never executes an instrument.
It writes:

- `test-results/preset-rollout/inventory.json`
- `test-results/preset-rollout/inventory.md`

The checked-in [inventory snapshot](preset-rollout-inventory.md) records the
starting coverage. Names such as `bank`, `pattern` or `preset` are **candidates**:
they do not prove whole-state recall, completeness, count or audio safety.
No candidates is not evidence that an instrument has no presets.

For each row, inspect the actual state owner and record:

- existing banks, names, record schema and applicable source functions;
- complete sound, geometry, modulation, rhythm, timing and effect state;
- live/ephemeral state that must not be serialized or reset;
- sanitization, compatibility aliases, and any async asset dependencies;
- whether current preset application silently starts/stops playback;
- old controls and keyboard handlers that must move together.

### 2. Establish the shared header contract

Reuse the Choose chrome, with domain state remaining instrument-owned. A
header preset controller should receive a validated bank and apply/capture
callbacks; it must not inspect arbitrary sliders or construct audio engines.

Validate IDs and completeness before any state mutation. Provide deterministic
reset and a truthful Custom state after editing. Keep recall atomic where
possible; reject an incompatible or incomplete scene without half-applying it.
Keep submenu focus and Escape behavior consistent with Choose.

### 3. Prove full scenes on the two named multi-bank instruments

Begin with Creaturazoid and Hiccup Head, then a single-bank instrument and an
instrument with no current preset bank. These cases exercise composition,
relocation of existing choices, and new bank authoring before a broad rollout.

At least 12 scenes per instrument should collectively demonstrate familiar,
gentle/sweet, sparse, slow, rhythmically active, fast/virtuosic, sustained,
bright, dark, rough/nasty, strange and extreme-but-bounded possibilities.
These are **coverage prompts**, not mandatory generic preset names or a recipe
for arbitrary parameter randomization. Use only capabilities the instrument
actually implements.

Preserve all existing sounds and scenes as reusable ingredients. New combined
scenes must explicitly cover every persistent musical parameter, not just
select arbitrary pairs from two banks.

### 4. Roll out by real implementation family

Group work by shared state/preset owner rather than catalogue category. Keep a
machine-readable status per route: inventory → state adapter → authored bank →
header migration → mechanical QA → human audition. Unmigrated routes retain
their working controls; do not hide them behind a nonfunctional universal menu.

Use separate commits for coherent groups so problematic migrations can be
reverted without removing the already-reviewed navigation or other instruments.

## Acceptance checks per instrument

- All existing useful preset entries remain available or have an explicit
  complete-scene mapping; minimum 12 verified complete records.
- Recall A → edit every family of controls → recall B → recall A restores the
  same intended sound/visual/rhythm state, independent of preceding edits.
- At least 12 presets are not merely identical records with different names.
- Selecting or cycling with Audio off leaves it off. With Audio on, preset,
  tempo and mode changes do not create duplicate voices, unexpected transport
  stops, runaway levels, or stale scheduled events.
- Sound/pattern/effect changes apply together for multi-bank instruments.
- Menus remain reachable at 1440×900, 390×844 and 844×390, with 48px touch targets
  and no overlap with Choose, meters, Audio or device controls.
- Arrow keys respect focused controls and existing performance-key ownership;
  pointer/keyboard cancellation and teardown work.
- Normal browser and WAX builds use the same preset content without changing
  old storage/processor/MIDI identities.
- Measure bounded output, transitions and useful preset differences. Actual
  listening is still required for timbral range, musicality, sweetness,
  nastiness, expressive feel and virtuosity.

Never report a full-instrument preset migration complete from menu count or
static source hints alone.

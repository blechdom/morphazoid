# Full-instrument preset rollout

**September 23 UI update:** full-preset controls now occupy the first row of the
right control panel; MIDI activation lives inside Settings and master volume
is a knob. [Performance toolbar](performance-toolbar.md) supersedes older
header-placement descriptions below without changing the preset contract.

Current queue reviewed September 22, 2026, against freshly fetched main
`9a45aa0` (after the initial `83ea203` checkpoint). Older dated sections below are historical checkpoints, not the
current Faves list or a substitute for current verification evidence.

## Active priority: Faves first; Works in Progress deferred

Owner priority update, September 21: complete the Faves before taking on other
instruments. Do not spend the next batches authoring or polishing WIP presets
while the main collection remains unfinished.

1. **Faves, in `FAVE_TOOL_IDS` order.** Finish pending recall, layout and
   preservation checks on already implemented Faves; do not recreate their
   banks unnecessarily. All thirteen Faves now have source implementations;
   finish their pending browser/listening/release gates before calling them
   accepted.
2. **Remaining non-WIP regular instruments**, in registry/category order,
   without revisiting Faves as duplicate work.
3. **WIP and labs: deferred**, outside the active preset-authoring queue until
   the owner brings them back into scope. Keep existing work and controls;
   deferral does not mean deleting instruments or withdrawing their presets.

Current Faves order:

1. Shapes
2. Rubix Cube Sequencer
3. Hiccup Head
4. Creaturazoid
5. Hybrinx
6. Jaw Harp
7. Hyper Rubix
8. L-system Delay
9. L-System
10. Graph Delay
11. Graph Synth
12. Automatapoeia
13. Lattice

Shapes replaced the three standalone geometry instruments in Faves. Shape,
Solid and Hyper remain in Geometric with their existing full presets and
preservation tests; do not delete or recreate those banks.

The registry currently contains 84 non-WIP regular instruments: 13 Faves and
71 others. The 73 WIP regular instruments, seven labs and four non-instrument
utility routes are deferred. Derive
future queue membership from `src/site/instrument-registry.js` rather than
treating these counts as permanent.

`docs/preset-rollout-status.json` now includes registry-ordered queues.
`node scripts/presets/rollout-status.mjs` checks membership and derived counts;
after reviewing registry changes, use `--write` to refresh them. This preserves
existing banks and verification records and never infers QA approval.
The first unmigrated non-WIP batch is Shape, Solid, Hyper and Graph Drum
Machines, followed by L-Systems, Graphs and Tesselation. Faves acceptance work
still comes first. See [the September 22 continuation](presets-continuation-20260922.md)
for this pass's exact evidence and remaining gates.

Use shared family work only when it advances the current priority instruments,
not as a reason to switch to easier WIP examples. Fix owner-reported regressions
as they arrive. Batch routine QA and manual reviews so the owner need not test
after every file edit, but keep sound/state preservation gates intact. Standard
repository verification still covers shared behavior and WIP regressions; this
priority change does not authorize weakening tests or skipping release checks.

## Current work: first full-preset batch implemented, final verification pending

The next local batch now implements the shared Choose-styled header preset
control for **24 of 157 regular instruments** (451 full-state presets):

| Instrument | Full presets |
| --- | ---: |
| Creaturazoid | 12 |
| Hiccup Head | 25 |
| Karplus Strong | 16 |
| DJ Dijkstra | 12 |
| Hanoi Carillon | 12 |
| Alpha-Beta Minimax | 12 |
| N-Queens Backtracker | 12 |
| Euclidean Pulse | 12 |
| Cascading FM | 12 |
| Cascading PM | 12 |
| Shape | 36 |
| Solid | 20 |
| Hyper | 20 |
| Shapes (2D/3D/4D app) | 106 |
| Rubix Cube Sequencer | 12 |
| Hybrinx | 12 |
| Jaw Harp | 16 |
| Hyper Rubix | 12 |
| L-system Delay | 16 |
| L-System | 14 |
| Graph Delay | 14 |
| Graph Synth | 12 |
| Automatapoeia | 12 |
| Lattice | 12 |

This is not the all-instrument rollout completed: **133 regular instruments and
the seven separately identified labs remain unmigrated.** That is a coverage
count, not the active queue: unfinished WIP work is now deferred as described
above. The table describes implemented adapters, not new listening approval.
Of these, **64 are non-WIP regular instruments** still in the active queue.
All current Faves are implemented. See [the Faves report](faves-preset-rollout.md)
and `preset-rollout-status.json` for exact current coverage and remaining work.

Changes in this batch:

- Navigation and presets use `createChoosePickerShell()` and the existing
  Choose CSS, not two independently styled dropdowns.
- Presets now mount at the start of the right control panel, in the order
  **preset menu → next → dice**, without applying a preset or arming Audio on
  page load. The existing MIDI toggle lives inside Settings; meters, master
  volume and Audio remain in the masthead.
- Main presets replace complete instrument-owned snapshots, with state
  comparison after recall and rollback on a failed recall.
- Creaturazoid recalls anatomy/modulation and rhythm/tempo together. Hiccup
  Head additionally restores complete voices, sound bank, effects and eyebrows.
- The header menu contains only complete preset choices and their search field.
  The rejected **Edit preset ingredients** disclosure and its control-relocation
  mechanism have been removed entirely, not merely hidden.
- Independent body/face, sequence, sound-bank, skin, material and curve controls
  remain in their own instrument sections. In Creaturazoid and Hiccup Head,
  sequence presets sit beside the sequencer and body/face presets stay in the
  right panel. They affect only their own part; main presets recall the whole
  scene. Local edits truthfully leave the main selection at Custom.
- Parameter edits mark the main selector Custom. Bare arrow keys cycle full
  presets, while focused inputs, sequence grids, canvas controls and navigation
  retain their own key behavior.
- Device/audio state, audio contexts and evolving playhead/rotation phases are
  not serialized or reset. By explicit owner request, Shape main presets now
  recall **Playhead on/off and Rotation on/off** as part of the scene; they do
  not arm Audio. Other instrument transports retain their existing contracts.
  Hiccup main presets now also recall built-in visual skins
  and deliberately varied decay/eye/hair effects; the separate skin selector
  changes only appearance. Webcam capture and live gesture state remain separate
  and are never requested by a factory preset.

### Historical verification checkpoints

For this continuation's final checks and remaining gates, use
[the September 22 evidence](presets-continuation-20260922.md). The reports below
retain their original dates and counts; a later pass does not retroactively
make an earlier failed or unrun check pass.

Latest geometry feedback: migrated headers start at **Select Preset**, not an
auto-selected matching default. Shape's paused scene is removed. Solid/Hyper
each have eight more interleaved single-motion scenes and now recall the primary
playhead flag; shape-only scenes center their stationary slice. Klein is second
in Hyper. Heavy Shepard scenes use an adjustable eight-voice budget, while
startup retains the former 32/20 caps. See
[measured geometry preset feedback](geometry-preset-feedback.md) for browser
evidence and the distinction between render-budget pressure, envelope silence
and unperformed human listening.
This pass completed 40 focused browser checks and the full repository gate
(3,806 passed, six skipped), including regenerated WAX parity. Older pending-build
notes below describe earlier checkpoints; broader preset/device listening and
the remaining instrument migrations are still outstanding.

September 21 Faves batch: twelve more adapters and 156 complete scenes are
implemented without rewriting their engines. Native body/pattern/envelope
controls stay available; the original defaults are preserved in fixtures.
The next arrow keeps its place after generative/manual edits become Custom.
Browser, microphone/device, listening and generated-WAX acceptance remain
pending; this is source implementation, not a completed site-wide release.

September 21 random-button follow-up: all eleven implemented adapters now supply
an instrument-owned parameter randomizer for the shared dice button, immediately
after the next-preset arrow. This creates new full states, not random factory
selection. The follow-up now generates every preset-owned musical parameter
directly, including curves, mappings, effects and musical switches, instead of
varying a subset of a starting preset. Output level, live clocks and device state are preserved;
the selector reports Custom and named presets remain available for recovery.
New adapters are required to supply this callback. The button reuses Choose's
next-button styling and 48px coarse-pointer target. See
[header randomization](header-preset-random.md) for scope, bounds and evidence.
The latest full-parameter and [Shape click-path batch](shape-click-followup.md)
passed 249 checks with six skipped; browser, listening and regenerated WAX
verification remain pending.

September 21 audition follow-up: Hiccup Head's Tin grin / Tongue virtuoso and
Humming head / Sweet doo-wop have exchanged menu positions without changing their
settings. Six new two-bar beats are available as complete scenes and independent
sequence presets, bringing both banks to 25. Shape now has 37 scenes: the
36-scene expansion minus the explicitly rejected Sweet orbit preset, plus two
new Bowed line variants. Velvet wheel uses the original straight square.
Rotating scenes now mix eight clockwise, eight counterclockwise and ten
ping-pong rotations. The six reported percussion scenes have rounded onsets,
less attack noise and, where needed, reduced event density.

**181 focused checks passed, six skipped** across 16 direct Node suites.
The click investigation sampled the actual strike automation in 72 deterministic
reference cases; it is not a browser recording or confirmation that the reported
clicks are gone. Browser, listening, full-repository and WAX/production checks
remain pending. See [audition follow-up](preset-audition-followup.md) for the
evidence, specific changes and listening checklist.

Shape (`shape-synth.html`, not the separate Shapes app) recalls its motion
switches without arming Audio or restarting physical phase. The menu remains
interleaved in a stable order; 29 scenes use nonuniform head spacings. Six are
rotation-only, ten are playhead-only, 20 use both motions, and one explicitly
labelled hands-on scene pauses both. See
[Shape motion and spacing presets](shape-motion-presets.md) for scope and limits.

September 21 MIDI-placement follow-up: the preset header no longer reparents
the MIDI toolbar. It inserts the preset control before the existing MIDI node,
keeping listeners, enabled state, parent and normal teardown untouched. On
phones, presets/MIDI/meters share the first control row, while output/Audio and
settings use the next row rather than squeezing the MIDI button into a
meter-width slot. Two DOM lifecycle tests pass with MIDI present/absent,
including reinitialization and unchanged event handlers. Desktop/portrait/
landscape geometric and keyboard-order checks were updated but remain unrun.
The local WAX artifact must be regenerated before testing that copy.

September 21 cascade follow-up: all FM/PM presets, startup and Reset now use
replacement rhythm-first banks (12 per instrument), rather than the rejected
drone bank plus appended studies. The duplicate Character button banks are gone;
the shared main menu still contains only full preset choices, with no ingredient
editor. All direct cascade parameters remain. See
[cascade preset design and evidence](cascade-rhythm-presets.md) for the 52 passing
focused tests, 144 PM transition checks and 72 offline reference renders.
The synthesis algorithms are unchanged; browser audition and regenerated WAX
remain pending.

Menu-color follow-up: preset rows are native buttons, unlike Choose's links.
Both now explicitly share transparent default rows over the dark menu surface,
and the same accent background/text for hover and selected state. Next-arrow
controls also use the same explicit styling instead of native button chrome.
Three authored-style checks passed; computed-color browser tests were added
but remain unrun. This styling-only change does not alter presets or audio.

Hierarchy follow-up: both pages retain every pre-migration authored control ID,
type, range and option list (95 IDs on Creaturazoid, 122 on Hiccup Head), with one
additional skin-next button on Hiccup Head. Static controller comparison found
all 129 original Creaturazoid function bodies unchanged; Hiccup Head's 227
unchanged functions include its pad, sequence and voice editors. Its three
intentional function edits update skin copy, bind the new skin button and keep
pattern identity when applying a face-only preset. Six hierarchy/data tests
passed. This is source preservation evidence, not a completed browser audit.
The controls-removal and effects/skins browser tests still require execution.

Local popup-placement follow-up, September 20: preset panels now opt into
trigger-relative positioning through the shared Choose shell. The fixed popup
opens four pixels below its own heading, clamps horizontally to the visible
viewport, and limits height to the remaining space. It follows header/viewport
resize and document scrolling; scrolling the list itself does not move it.
The instrument Choose menu's existing position, audio, and preset data are
unchanged. Six focused geometry/lifecycle tests passed, including observer and
listener cleanup. Hiccup Head browser checks for desktop, portrait, landscape,
filtering and resizing while open were added but have not been run; the earlier
browser-approval failure is still unresolved. Regenerate WAX before testing its
copy of this fix.

Eight new bank/keyboard tests passed. The updated browser batch passed **26 of
28 checks**, including exact complete-state recall for all 131 presets,
round-trip edit/recall, and live playback continuity on Creaturazoid/Hiccup Head.
Two mobile regressions remain to be rechecked:

1. Creaturazoid's existing continuous sequence-drag test.
2. The portrait instrument-tour test could not click Choose after the header
   moved outside the viewport.

A fixed-column phone header and a no-op label-write guard have been added since
that run. **Those fixes are not yet browser-verified.** The browser-test
approval service failed twice with a disconnected-stream error. No workaround
was used to bypass its denial.

Do not commit or publish this batch as green until those checks, the full
repository gate, the applicable browser suites, and a fresh WAX build pass.
Generated WAX currently predates the last phone-layout/label changes and must
be regenerated, not hand-edited. Evidence is under `test-results/full-presets/`.

At the earlier September 21 checkpoint, the Faves order was:
Shape, Solid, Hyper, Rubix Cube Sequencer, Hiccup Head, Creaturazoid, Hybrinx,
Jaw Harp, Hyper Rubix, L-system Delay, L-System, Graph Delay, Graph Synth,
Automatapoeia, Lattice. This retains Creaturazoid immediately after Hiccup Head
while moving the three requested instruments before Hyper Rubix; Automatapoeia
and Lattice have exchanged positions.

## Previous committed checkpoint: navigation and preset inventory

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

At commit `15980a9`, there was no header preset migration yet. The source
inventory below describes that starting checkpoint, not the current partial
implementation reported above.

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

1. Every regular instrument gets one main preset selector plus next arrow and
   a dice randomize button in the menu bar, **before MIDI and the sound meters**,
   keeping those controls together in the right-hand group. Dice randomizes
   musical parameters using instrument-owned bounds, not factory selection.
   Preserve output, live clocks and device state and show Custom afterwards.
   Include preset-owned musical switches; external transport flags stay separate.
2. Reuse the existing Choose-menu markup/styles/interactions. Do not introduce
   a different-looking selector or an unrelated component framework.
3. Every main preset bank has at least **12 full-instrument presets**. Keep
   existing useful preset names and settings rather than discarding them to
   meet a count.
4. Instruments without presets need 12 deliberately authored starting points,
   not a random multiplier applied to all range controls.
5. Main presets live in the header. Independent sequence, body/face, skin and
   other focused sub-presets remain with their instrument editors. Do not hide
   them in the header menu or remove parameter controls during the migration.
6. Multi-bank instruments need complete scenes. Creaturazoid must recall body,
   anatomy, modulation and sequence/tempo together; Hiccup Head must recall
   face, voice/sound bank, effects, pattern/tempo and a built-in skin together. Applying only one
   half while retaining arbitrary edited values from the other is not a full
   preset.
7. Default arrow-key navigation advances/reverses main presets. It must not
   steal text editing, range/select manipulation, sequence editing, canvas
   gestures, or navigation-menu keyboard behavior.
8. Preserve explicit Audio arming, transport state, clocks, saved banks,
   imported recordings, device routing and microphone permissions. Selecting a
   preset must not silently arm Audio, ask for microphone access, or destroy
   user recordings. Shape is the owner-requested transport-state exception:
   full scenes restore Playhead/Rotate on/off, but preserve current phase and
   Audio state. Do not turn that into a site-wide automatic-Play policy.

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
Keep focus and Escape behavior consistent with Choose. Do not add an editor
submenu: the main menu is a list of full presets, not an alternate control panel.

### 3. Complete the priority Faves and their full-scene checks

The initial batch used Creaturazoid and Hiccup Head to exercise multi-bank
composition. Continue from that work rather than restarting the pilot: complete
the Faves in the active queue above, including their outstanding verification.
All Faves now have authored banks/adapters; continue their outstanding acceptance
checks and then the remaining non-WIP queue. Do not add another WIP pilot ahead
of the regular collection.

At least 12 scenes per instrument should collectively demonstrate familiar,
gentle/sweet, sparse, slow, rhythmically active, fast/virtuosic, sustained,
bright, dark, rough/nasty, strange and extreme-but-bounded possibilities.
These are **coverage prompts**, not mandatory generic preset names or a recipe
for arbitrary parameter randomization. Use only capabilities the instrument
actually implements.

Preserve all existing sounds and scenes as reusable ingredients. New combined
scenes must explicitly cover every persistent musical parameter, not just
select arbitrary pairs from two banks.

### 4. Roll out through non-WIP instruments in priority order

Follow the active queue before choosing convenient implementation families.
Within a priority batch, group work by shared state/preset owner. Keep a
machine-readable status per route: inventory → state adapter → authored bank →
header migration → mechanical QA → human audition. Unmigrated routes retain
their working controls; do not hide them behind a nonfunctional universal menu.
Previously implemented WIP adapters are preserved, but receive no new
preset-authoring or polish work until reprioritized.

Use separate commits for coherent groups so problematic migrations can be
reverted without removing the already-reviewed navigation or other instruments.

## Acceptance checks per instrument

- All existing useful preset entries remain available or have an explicit
  complete-scene mapping; minimum 12 verified complete records.
- Recall A → edit every family of controls → recall B → recall A restores the
  same intended sound/visual/rhythm state, independent of preceding edits.
- At least 12 presets are not merely identical records with different names.
- Dice generates finite complete parameter states, rather than selecting a
  preset, and never mutates the factory bank. Preserve output level (including
  zero), live clocks and device state. Include preset-owned musical switches
  and audit every parameter for variation. Validate before application;
  if application fails, restore the previous complete musical state. Test named
  preset recovery, keyboard activation and repeated rolls.
- Selecting or cycling with Audio off leaves it off. With Audio on, preset,
  tempo and mode changes do not create duplicate voices, unexpected transport
  stops, runaway levels, or stale scheduled events. For Shape, assert the
  preset's explicit Playhead/Rotate flags rather than preserving old flags.
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

## Shapes parity and mixed bank

Shapes has 106 scenes: the 76 imported complete presets, twelve tonal note
scenes and eighteen drum-trigger scenes. Corners and Notes are now one player;
one subdivision preserves the original corner anchors and larger values add
intermediate notes. Editable ADSR, optional pre-marker swell and independent
overlapping tails preserve the expressive options rather than fitting envelopes
to a step. Six new Rattlesnake demos use four or more subdivisions.

The original continuous spatial-swell behavior and corner-percussion sounds are
retained. See [implementation, migration and verification boundaries](shapes-parity-presets.md).

# Performance toolbar and panel presets

Owner-requested September 23, 2026, based on freshly fetched main `ef9a19d`.
This supersedes the earlier rule that placed presets and MIDI beside the meters.

## Layout

- Masthead: **Morphazoid → Choose → next instrument → flexible space → stereo
  meters → volume knob → Audio on/off → Settings**.
- Right control panel, first row: **Select Preset → next preset → randomize**.
- Settings: the existing **MIDI In on/off button and receive light** occupy the
  MIDI In row. Other routing/profile controls remain available. Its former
  aggregate-select handle remains hidden and synchronized for compatibility.
- Narrow phones wrap the masthead in reading order rather than hide playing
  controls or shrink touch targets. The wordmark remains readable.

All 24 existing full-preset owners declare an explicit
`data-instrument-preset-host`; this includes existing WIP adapters, not new WIP
preset authoring. Shapes places the row above its dimension/bank controls.
Focused sound, sequence, skin, material and other sub-presets stay in place.
The L-system Delay input controls move intact below its full-preset row rather
than remain an extra masthead item. Its trim is not a master-volume knob.

Shared header simplification applies wherever the shared navigation owns the
instrument's header. Existing header master-level ranges get rotary
presentation; no new gain stage or invented volume parameter is introduced on
pages without such a control. Custom workbench transports remain owned by their
existing application.

## Preservation

The volume knob retains the **same native range element**, ID, accessible name,
minimum, maximum, step, current value, and event listeners. Vertical captured
drag raises/lowers its value; Shift makes movement ten times finer. A click
never jumps the value. Native keyboard editing remains available, while wheel
scrolling is untouched. Cancellation, lost capture, disabled state and teardown
release the gesture. Instrument-owned readout updates synchronize the dial
without polling, replacing `.value`, or owning audio state.

Preset exports and legacy `.header-preset-*` selectors remain compatible. Only
placement changes: bank contents, capture/apply/rollback, next/arrow behavior,
randomizer semantics, Custom labels and no-automatic-recall startup remain
unchanged. The popup uses the browser top layer where available to escape a
clipped/contained control rail without cloning or reparenting the controls.

MIDI keeps its original button, manager, permission gesture, computer-key
mapping, messages, receive indicator and shutdown behavior. Merely opening
Settings never enables MIDI or Audio. Audio, primary transport and WAX host
boundaries remain unchanged. Main's Shapes manual-audio fixes are retained.

`preset-toolbar-runtime-changes.json` records exact navigation amendments;
older reference hashes are not regenerated. Regression coverage includes
`tests/range-knob.test.mjs`, `tests/performance-toolbar.test.mjs` and
`e2e/performance-toolbar.spec.mjs`, plus existing preset, MIDI and audio suites.
Mechanical verification does not claim human listening or physical-device feel.

## Verification — September 23, 2026

This is a local implementation, not a publication or listening certificate.

- `npm run verify`: **4,152 passed, six skipped**; syntax, XYFlow and regenerated
  WAX parity passed. `npm run build:deploy` and `npm run check:storybook-dist`
  passed (112 Storybook entries).
- `e2e/performance-toolbar.spec.mjs` and `e2e/io-settings.spec.mjs`: **89 passed**,
  including all 24 full-preset pages at desktop, phone portrait and landscape,
  captured knob drag/cancellation, keyboard order, preset synchronization and
  MIDI CC volume. The changed regions also had no axe violations in three
  focused desktop/phone checks.
- Control inventory, accessibility reports, legacy control geometry and Roach
  MIDI: **187 passed**. The general accessibility reports use the repository's
  normal advisory mode, not a claim of site-wide strict accessibility approval.
- The broader preset/MIDI batch initially passed 154/156. Its new Karplus dial
  assertion was corrected for CSS number serialization and passes in the
  89-check rerun. The remaining Shape percussion clipping assertion also fails
  against unchanged `ef9a19d`; no sound change or relaxed threshold was made.
- The cross-site smoke/layout/audio batch initially passed 595/603. The Settings
  assertion now checks the replacement MIDI button rather than the deliberately
  hidden compatibility select, and passes. Plasma Ball timed out during busy
  runs but passed twice serially without a code change. Six other failures were
  reproduced with original main assertions and runtime: a missing viewport tag
  in the artwork-options page, offscreen Shader Synth graph ports, and missing
  legacy mobile selects on Head Shed, Splice Ring, Onset Atlas and Synaptic
  Resonance. The complete browser suite is therefore **not fully green**.

Local logs, original-main overlay comparisons and screenshots are under
`test-results/preset-toolbar-20260923/` (ignored; not included in a clone).
Human listening, physical MIDI hardware and real-phone gesture feel remain
unperformed. No instrument JavaScript, DSP, preset banks or historical fixture
hashes changed in this UI refactor.

## Continuation order — September 24, 2026

The owner requested **Faves → Apps → remaining instruments → Work in Progress
last**. This is the current rollout order, including eventual WIP work, not a
request to replace any existing bank or sound implementation.

Rechecked against `b5020b3` plus the Automatapoeia transport changes:

- All **13 Faves** already have first-row full-preset menu/Next/dice controls,
  the masthead master knob, and MIDI activation in Settings. The existing
  toolbar suite passed **39 checks** across desktop, portrait and landscape.
- Shapes is also an App and is covered above. **L-Systems, Graphs and
  Tesselation** are the next missing full-preset adapters. A browser inspection
  confirms that all three already get their master knob and MIDI-in-Settings
  from shared navigation, but none has a full-preset menu. Do not add duplicate
  knobs, MIDI managers or gain stages.
- Retain L-Systems' grammar and mix sub-presets, Graphs' topology/sound controls,
  and Tesselation's tile editing. Their next step needs complete-state adapters
  and genuine parameter randomizers, not merely relabeling partial sub-presets
  or randomly selecting an existing scene.
- Migrate the remaining non-WIP owners after Apps; author/migrate WIP presets
  only after that. Resolve current membership from the registry, not older
  rollout counts or filesystem names.

No new Apps preset adapter is implemented by this checkpoint. Its UI inventory
and inspection evidence are local under
`test-results/automatapoeia-live-transport-20260924/`; mechanical layout checks
are not listening acceptance.

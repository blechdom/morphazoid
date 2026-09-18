# Catalogue and source-layout update — September 18, 2026

## Status and scope

Worktree: `/home/blechdom/creative/morphazoid-v2-catalogue`

Branch: `codex/v2-catalogue-layout`

Base: `59e4f4e0d104f4b7f5c2ebeeeca3b3feb81ac08d`

The naming/category pass and root controller/style cleanup are implemented.
The owner confirmed the three retained spreadsheet values and authorized
committing/pushing this batch to `codex/v2-catalogue-layout` for testing on another
computer. **Main integration and deployment remain deferred until that review.**
No framework migration, dependency upgrade, or instrument redesign was performed.

The preceding packaging and source-move layers were carried onto a fresh
worktree based on committed main, preserving its five newer starting instruments
and its social-preview build hook. The old `morphazoid-v2-integration` worktree
and the original main checkout were left untouched.

### Preview

- Current working source: `http://localhost:4355/`
- Built production artifact: `http://localhost:4361/`
- Frozen pre-sheet build: `http://localhost:4360/`

These are local processes, not deployed sites. The production-artifact preview
uses the existing development server's isolation headers for SIMD checks; it
does not prove the deployed host's header configuration.

### Testing the branch on another computer

The current workflows automatically deploy pushes to **main**, not this branch.
Pushing the review branch alone does not create a hosted preview or change the
live website. With Git, a supported Node.js version and Python 3 installed, use
a separate checkout so existing local work remains untouched:

```sh
git clone --branch codex/v2-catalogue-layout --single-branch \
  https://github.com/blechdom/morphazoid.git morphazoid-v2-test
cd morphazoid-v2-test
npm ci
npm run dev
```

Open the local URL printed by that computer's server. Node.js 24 matches the AWS
verification workflow; Node.js 22 is also checked by the retained Pages workflow.
No workflow dispatch, PR creation, main merge, or live deployment is part of this
branch-push request.

## Catalogue decisions

The catalogue now has **147 regular instruments and seven browseable labs** in
19 primary categories. Counts describe this checkpoint, not a permanent product
contract. Existing Faves are retained, using canonical IDs. Category order and
within-category order follow the sheet, with WIP last; the homepage no longer
reorders instruments using the old activity-ranking list.
As before, a secondary category tag can also place an instrument in another
homepage section. Those repeated cards point to the same implementation; 154 is
the unique-entry count, not the number of rendered cards.

Review files:

- `catalogue-update-2026-09-18.tsv`: unchanged owner input.
- `catalogue-update-decisions.json`: effective rows and explicit interpretation.
- `catalogue-update-effective.tsv`: normalized, editable inventory of the result.

Key renames include Shape/Solid/Hyper IDs ending in `-synth`, Combo → Shapes,
Tiles → Tesselation, the `*-drum-machine` IDs, Rattlesnake Skin, Monstroid, and
`simd-lab`. Public HTML and instrument-owned controller/style filenames follow
the approved IDs. Existing runtime icon URLs remain valid.

### Confirmed retained values

The owner confirmed these choices on September 18, 2026. They are no longer
pending naming decisions.

| Sheet entry | Current treatment |
| --- | --- |
| `webgpu-303` → `webgpu-304`, but name “WebGPU 303” | Retained `webgpu-303` |
| `image-to-instrument-3` → `image-to-instrument-4` | Retained `image-to-instrument-3` |
| Rattlesnake → `RatTesselationnake` | Retained “Rattlesnake” |

Other explicit interpretations:

- `tesselation-app` identifies the existing `tiles-app`; “Tesselation” and
  “Monstroid” use the owner's supplied spelling.
- Category ID takes precedence over a conflicting category label. Möbius and
  Klein Bottle are WIP with a Geometric secondary tag; Graph Drum Machine is
  Geometric with a Drum Machine secondary tag.
- Tag separators, obvious case differences and singular/plural variants were
  normalized. Question marks and feature requests were not turned into claims:
  Weierstrass's “Recursion (is it)” and Fabric Filter's “Audio Effect (add
  capability)” remain unresolved.
- The latest sheet lists Throatazoid, so it is retained in this pass. No combined
  App or individual instrument was purged.
- Tempo Tantrum, Tape Worm, Loop Soup, Habit Habitat and Hollowphonic were added
  on main after the inventory and remain in WIP.

Labs are catalogue discoveries, not newly implemented instruments. Their
existing behavior remains unchanged. `CATALOGUE_ITEMS` includes them, while
`INSTRUMENTS` and the regular MIDI/WAX capability registries do not invent support
for them. Five labs use one shared placeholder derived from existing project
artwork. WIP stays visible on the homepage and hidden from the instrument
chooser, retaining the pre-existing picker policy.

## Structure

```text
morphazoid/
├── *.html                       public entry pages and legacy redirects
├── style.css                    global stylesheet
├── nav.js                       public navigation bootstrap
├── wax-page.js                  WAX information-page bootstrap
├── shader-synth-playground-bootstrap.js
├── src/
│   ├── instruments/<id>/        instrument controllers, styles, selected helpers
│   ├── families/<family>/       genuinely shared implementations/styles
│   ├── site/                    registry, identity aliases, taxonomy, site pages
│   ├── ui/                      shared sound-independent controls/styles
│   ├── graphics/                existing graphics utilities
│   └── ...                      existing shared models, worklets and utilities
├── assets/                      runtime images, audio, models and WASM
├── artwork/                     source artwork
├── docs/
├── contracts/
├── tests/
├── e2e/
├── scripts/site/runtime-files.tsv
├── infra/
├── plugins/
├── vendor/
└── dist-wax/                    regenerated WAX output, never edited by hand
```

This pass records **235 relocations**, including moves from the preceding
intermediate layout to newly named owners. No root `*-app.js` controllers remain;
`style.css` is the only root CSS file. Shared controllers such as nonorientable,
physics, SIMD resonator and starting instruments live under `src/families/`.
Folders describe implementation ownership, not navigation categories.

This completes the controller/style cleanup, not every possible reorganization.
Public HTML, global entry scripts, existing root research documents, and many
shared `src/` models remain where they are. Moving those separately should have
its own reason and compatibility plan.

## Preservation boundaries

- Existing HTML addresses redirect to canonical pages without discarding query
  strings or fragments. Instruments may still append their existing mode defaults.
- Public names are not DSP identifiers. Storage keys, processor registrations,
  model enums, DOM contracts, preset formats and legacy MIDI listener identities
  deliberately retain their old strings.
- WAX projects still register the old `<id>:midi-routing` keys. Companion MIDI
  scheduling uses the old route seed, preserving the note sequence after a rename.
- All 147 existing MIDI capability records preserve their fields except the
  public ID; previous-ID lookups still resolve.
- CSS resource URLs and JS imports/worklet URLs were rebased. Fingerprint
  scripts now follow nested entries, including module-relative Hiccup assets.
- Body comparison accounts for **236 JS/CSS files** using recorded URL edits,
  approved visible Monstroid strings, and the two Tesselation source-page links.
  No unexplained body changes remain in that comparison. The homepage controller
  is separately tested because catalogue ordering intentionally changed.
- All **58 compared WASM/audio/model binary assets** in the pre-sheet production
  build remain byte-identical. This is asset evidence, not listening approval.

No audible-identity redesign, new audio engine, saved-bank migration, mobile
performance classification, two-tier Faves, or further DSP abstraction is included.

## Verification

| Check | Result |
| --- | --- |
| `npm run verify` (branch-push recheck, including confirmed values) | **3,645 passed, zero failed, six skipped** |
| Runtime syntax | 506 JS modules, zero syntax failures |
| XYFlow / regenerated WAX parity | Passed |
| Shared browser contract | All 147 regular instruments passed |
| Catalogue/legacy-link branch-push recheck | **20 passed** |
| Broad catalogue/smoke/preservation/audio/MIDI batch | **491 passed, two pre-existing failures** |
| Built-site targeted catalogue/SIMD/Monstroid/Hiccup/Roach/Spider batch | **35 passed** |
| `npm run build:deploy` and `npm run check:storybook-dist` | Passed; 198 WAX pages and 109 Storybook entries |
| Dependency scan | 484 modules; zero errors/warnings |
| Catalogue desktop/phone captures | No document horizontal overflow at 1440px or 390px |
| `git diff --check` | Passed |

The broad browser run includes three-viewport canvas checks, audio continuity,
legacy-route queries/fragments, normal/WAX fixed-frame tract comparisons,
source-layout checks, virtual MIDI and Audio contracts. The targeted production
run additionally exercised SIMD/scalar WASM, lab engine changes, Monstroid calls,
Hiccup sequencing, model loading and Roach/Spider audio during graphics stalls.

### Known failures, independently reproduced before the change

1. **Shepard–Risset:** its existing ID-only `$` helper is called with
   `"[data-reset-all]"`, causing a startup `addEventListener` exception. The
   pre-sheet build produces the same exception at the same source line.
2. **Artwork icon-options preview:** the source page triggers a missing
   `/favicon.ico` request. The pre-sheet build reproduces this and also lacks
   several non-runtime PNG previews under that artwork directory.

Neither failure is ignored or marked as passing. They are deliberately not
mixed into the preservation-only relocation. The production build also retains
Storybook's existing large-chunk advisory.

Earlier failed runs include stale source-path/category assertions, plus an
overstrict redirect test that disallowed Shapes' existing appended mode defaults.
Those assertions were corrected; original logs remain alongside the final runs.
No regular instrument capability requirement was weakened to admit a lab.

## Evidence and rollback

Local artifacts are under `test-results/catalogue-update/`:

- `carry-forward.json`: old/new worktree integration inventory.
- `layout-moves.json`, `layout-proof.json`, `before-layout/`: move map, URL edits
  and pre-move sources.
- `body-preservation-final.json`, `audio-model-assets-final.json`: preservation
  comparisons.
- `baseline-site/`: frozen pre-sheet build.
- `verify-complete.log`: initial complete green repository gate.
- `verify-branch-push.log`: complete gate after owner confirmation and staging.
- `browser-branch-push.log`: 20 passing catalogue/legacy-link rechecks.
- `browser-catalogue.log`: first run, including all shared-contract passes.
- `browser-preservation.log`: broad run with two known failures.
- `browser-baseline-findings.log`: independent pre-change reproductions.
- `browser-production.log`: 35 passing built-artifact checks.
- `deploy-build-final.log`, `dependencies-final.log`: build and dependency checks.
- `checkpoint/`: full tracked/untracked/deleted working-change snapshot.

Checkpoints are local backups, not commits or off-machine recovery. Revert moves
together with their callers, tests, release manifest and regenerated WAX output;
do not restore a controller location while leaving HTML pointing at its new path.
The earlier worktree remains a separate fallback.

This worktree starts from main `59e4f4e`, reducing inherited divergence. Before
any future integration, compare main again and reconcile further changes in a
new recoverable layer. The branch push is owner-authorized; main integration,
rebasing dirty work, and deployment are not authorized by this handoff.

## Human review before integration

One listening/interaction batch is still needed:

1. Browse categories and confirm the requested names, order, tags and Faves.
2. Check Shape/Solid/Hyper and their drum versions with familiar presets; try
   Play, stop and resizing while Audio is active.
3. Switch modes in Shapes and Tesselation without losing expected state.
4. Try Monstroid and Rattlesnake Skin, including a familiar saved preset.
5. Try SIMD Lab and one heavy 3D instrument on the actual devices you use.

Automation does not establish that timbre, touch feel or real MIDI hardware
behavior is unchanged. No new human listening or hardware approval is claimed.

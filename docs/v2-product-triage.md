# Product triage before further abstraction — September 17, 2026

## Owner's revised direction

- Retire the standalone **Throatazoid** instrument; keep Alien Larynx.
- Audit overlapping instruments before spending more time extracting their code.
- Let the owner's Alien Larynx design/interaction notes drive its next changes.
- Agree instrument/category names, placement and ordering before resuming deeper
  work, so concurrent tasks do not maintain conflicting catalogues.
- Prefer integrating tested, bounded changes into `main` over growing one large
  long-lived v2 branch.

This is the quick audit and proposed implementation order, **not a record of a
completed deletion, rebase, commit, merge or publication**. The runtime and
frozen comparison previews were not changed during this audit.

## Actual integration position

Read-only inspection of the local repository found:

- Refactor base: `4e9feed0748d94aa86500b0d63218b62b20138c6`.
- Local `main`: `8098cce41207e5177ddf07ca3a6d45121843982b`.
- `main` has three commits not in the refactor base; the refactor branch has
  zero branch-only commits. Its changes are still uncommitted.
- Before adding this report, 145 tracked-modified or untracked files comprised
  the current batch, including generated WAX files and tests/docs.
- Three paths overlap `main`'s committed changes:
  - `package.json`: a read-only three-way file probe reports one conflict.
    Keep the new check/tooling commands **and** main's reduced full-test
    concurrency rather than choosing an entire side.
  - `scripts/build-site.sh`: the file probe is textually clean. Keep both the
    new runtime modules and main's removal of retired-file requirements.
  - `tests/ffmpeg-wasm.test.mjs`: locally edited but deleted by main. Preserve
    the retirement; do not resurrect the old test.
- Main's three commits reduce test concurrency, remove the already-deregistered
  Constellation/FFmpeg/Plugazoid implementations and fix stale regressions, and
  update Hiccup Head's icon.
- Those changes address the previously reported failure areas. The integrated
  result still needs fresh verification; a commit message is not a new test run.

This comparison is against **local main**, not a newly fetched remote.
No Git history or index mutation occurred. The original main checkout contains
unrelated CSV and artwork work and must remain protected.

Evidence: `test-results/v2-product-triage/integration-audit.json` and read-only
file-merge previews alongside it. A clean textual merge is not semantic proof.

## Throatazoid retirement boundary

Remove its independent playable page/controller and instrument registration,
capabilities, catalogue links and page-specific tests in a dedicated change.
Handle incoming links explicitly; a lightweight redirect to Alien Larynx is
an option without retaining another playable implementation. Preserve the old
frozen artifacts for comparison.

Do **not** delete all files matching `throatazoid*`:

- `src/throatazoid.js` is imported by Alien Larynx, Throat Singing, Morphynx,
  Pink Trombonazoid, Spelling Synthesizer, Wheel of Organs and the tract modules.
- `src/throatazoid-tract-processor.js` is loaded by Throat Singing and Spelling
  Synthesizer independently of the retired page.
- `throatazoid.css` is still loaded by Alien Larynx.
- Model/processor tests, third-party notices and technical lineage documents
  are not automatically obsolete when one page is retired.

Update page-consumer preservation tests intentionally, while retaining their
frozen original fixtures and tests for the surviving modules/consumers.
Regenerate WAX from the resulting source; never hand-delete generated copies
and assume parity.

## Initial consolidation shortlist

The advisory duplication scan is a prioritization aid, not a deletion rule.
Numbers below merge overlapping reported line ranges for each file pair; they
measure lexical overlap, not musical or behavioral equivalence.

| Family | Evidence | Disposition |
| --- | --- | --- |
| Throatazoid / Alien Larynx | About 99% of the shorter remaining controller is covered by duplicate blocks; Alien has five additional systems. | Owner chose retirement of standalone Throatazoid. Preserve shared dependencies. |
| Graphs / Graph Synth / Graph Drums / Graph Delay | `src/graphs-suite.js` explicitly identifies the three older pages as Graphs modes. About 78% of the older shared controller is covered by duplicate blocks with `graphs-app.js`. | Highest next consolidation review. Check presets, limits, gesture/transport and mic behavior before retiring old pages. |
| L-Systems / L-System / L-System Drums / L-System Delay | `src/l-systems-suite.js` explicitly maps the older pages into the combined suite. | High-priority product overlap even without a top-ranked text match. Defaults differ: for example the standalone synth's level is 0.55 versus 0.58 in the suite, so it is not automatically a drop-in replacement. |
| Ouroborousel / Ourorourobouroboros | About 68% controller/model overlap in the reported pairs. The latter adds different layer handling, nested-silence/mix state, defaults and output constraints. | Review retained musical identity with the owner. Do not infer that the extra variant supersedes the first. |
| Roach Synth / Spider Synth infrastructure | Roughly 78% MIDI-module and 71% audio-wrapper overlap in the reported pairs. | Shared plumbing does not make these duplicate instruments. Keep the instruments; consider infrastructure extraction only later. |
| Geometry synth/drum pairs; FM Drums / Sample Drums; FM/PM pairs | Related interfaces/geometry or shared infrastructure, but different engines or playing roles. | Do not remove on source similarity alone. |

Raw ranking: `test-results/v2-product-triage/duplicate-ranking.json`.
The inspected suite records and controller/model code substantiate this short
list; this is not yet a full route-by-route feature-equivalence audit.

For each candidate, make one compact decision row:

`Keep / retire / combine / redesign → unique features → surviving page →
behavior to preserve or intentionally change → acceptance checks`.

## Catalogue arrangement and work coordination

`v2-instrument-plan.csv` is an editable **planning sheet**, seeded from the
current runtime registry: 142 instruments across 14 groups. It records current
primary category, order, secondary tags and favorite status; proposed category
and ordering fields are deliberately blank, not pre-approved placements.
Throatazoid is marked `Retire`, Alien Larynx `Redesign`, and other entries
`Review`. The shortlist's relationships are annotated.

The owner's original `instrument-catalogue.csv` in the main worktree was read
but not edited. Its 144 IDs differ from the runtime inventory: it still contains
Constellation, FFmpeg Wasm and Plugazoid, and lacks Graphs. Do not silently use
that older list to restore intentionally retired instruments. Its richer
feature notes remain useful as evidence, not automatic proof of behavior.

The runtime registry remains the implementation source of truth; this sheet
holds proposed decisions, not a second independently maintained runtime source.
Do not regenerate the sheet over owner edits. After approval, implement its
decisions in one bounded catalogue change and record any unresolved rows.

Working rules for the next batch:

- Keep instrument IDs stable while changing visible names, categories or order.
  Treat retirement and public route changes as explicit exceptions.
- Give each instrument one primary category; use secondary tags/Faves for
  cross-listing rather than creating duplicate instruments.
- Do not mirror navigation categories in source directories. Category placement
  is presentation; shared source is organized by actual code responsibility.
- Assign one writer to registry, categories, tags, Faves, retirement mappings
  and associated catalogue tests during the reorganization.
- Instrument tasks refer to stable IDs and own disjoint instrument files.
  Central registry/build/capability edits are integrated serially.
- Land the approved catalogue reorganization before resuming parallel
  instrument redesign/refactoring that assumes the new inventory.

## Alien Larynx: design first

Pause further abstraction of its interface until the owner's notes arrive.
Its extra open systems panel, custom module cards, typography/decorative chrome
and layered controls deserve a product/design review rather than merely moving
their CSS/functions into shared files.

Turn the notes into three lists:

1. Keep: sounds, expressive controls, presets and gestures that matter.
2. Change: layout, hierarchy, discoverability and specified interactions.
3. Remove: unwanted controls, modes and explanatory/decorative UI.

Separate approved behavior changes from preservation-only structure changes.
Use the existing site design foundations, but do not prescribe a replacement
layout, a new framework, or a generic controller before understanding the notes.
Already extracted modules need not be undone; they should not constrain the new
design or be generalized further just to justify their existence.

## Proposed order

1. Obtain explicit authorization to commit/integrate the existing tested batch.
2. Preserve the source checkpoints and frozen previews; create reviewed,
   logical commits instead of carrying the whole uncommitted diff indefinitely.
3. Refresh remote state when integrating; reconcile on a clean isolated branch,
   keeping main's intentional deletions/fixes and unrelated owner work.
4. Regenerate WAX, run full verification plus relevant browser checks, and
   review the integrated result. Do not normalize the eight old failures as a
   permanent exception.
5. Merge the accepted preservation batch locally into main when authorized.
   Push/deployment is a separate authorization and verification step.
6. Agree the planning sheet's keep/retire decisions, primary categories, display
   names and order before more instrument changes. Do not guess the owner's
   desired taxonomy.
7. Retire Throatazoid and implement approved catalogue placement in distinct,
   reviewable changes; integrate the agreed inventory before concurrent work
   depends on it.
8. Review the owner's Alien Larynx notes; implement approved product changes on
   short-lived branches and integrate after each review.
9. Extract only stable, retained behavior after those decisions.

Proposed sync cadence: start of a working session and immediately before
integration, with additional syncs when main changes the files under active
work. Prefer rebasing private committed feature branches; coordinate shared
history rather than repeatedly rewriting it. The larger objective is prompt
integration of small tested batches, not a permanent v2 branch kept alive by
rebasing.

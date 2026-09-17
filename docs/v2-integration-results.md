# Local main integration — September 17, 2026

The tested preservation work was committed in logical layers, rebased onto the
freshly fetched `origin/main`, verified, and fast-forwarded into **local main**.
Nothing was pushed or deployed.

## Recorded history

Fetched main: `8098cce41207e5177ddf07ca3a6d45121843982b`.

| Commit | Layer |
| --- | --- |
| `8882998` | Shared canvas sizing and advisory architecture tools |
| `8c9f5e2` | Tract geometry and recursive syntax discovery |
| `d939fdf` | Pure instrument registry separated from navigation |
| `fab0c1c` | Shared tract renderer and preservation tests |
| `88a8a52` | Product-triage and catalogue planning documents |

Local main received these five commits at
`88a8a52dcd890c5f4d4cb11a31dc9baadbb0327d`. A documentation-only follow-up
records this result; it does not change the verified runtime.

The integration used `/home/blechdom/creative/morphazoid-v2-integration`.
Main is checked out at `/home/blechdom/creative/morphazoid`. The original
`morphazoid-v2` working copy and its frozen previews remain untouched archival
evidence, not the base for new work. Start subsequent task branches from main.

## Conflict handling and safety

- Kept both the recursive source checker and main's reduced full-test
  concurrency in `package.json`.
- Preserved main's intentional FFmpeg test deletion rather than restoring the
  locally edited obsolete test.
- Kept new shared runtime build entries alongside main's retired-page cleanup.
- Regenerated WAX from the reconciled source; generated files were not resolved
  by arbitrarily selecting one side.
- All other files from the reviewed source checkpoint match its bytes, excluding
  the documented integration paths and planning/documentation updates.
- Verified that all 390 unrelated dirty/untracked CSV/artwork files recorded in
  the main-worktree protection snapshot remain byte-identical. None was staged.
- There are no refactor-related unstaged changes in the main checkout. Existing
  unrelated work is intentionally still present.

## Verification

The complete combined refactoring gate passed against the frozen integrated
artifact at `test-results/integration/site/`:

| Check | Result |
| --- | --- |
| Fast preservation gate | 163 passed |
| Canvas uniformity | 145 browser tests passed |
| Pilot/rollout interaction checks | 49 browser tests passed |
| Tract interaction and fixed-frame rasterization | 16 browser tests passed |
| Catalogue and shared site contracts | 148 browser tests passed |
| Shared audio checks | 4 browser tests passed |
| Full Node suite | 3,597 passed, **0 failed**, 6 skipped |
| Recursive source parsing | 487 modules, zero syntax failures |
| WAX / XYFlow parity | Passed |

Total browser checks: **362 passed**. Standalone full verification also passed.
The eight failures in the September 16 source-reference reports are historical:
main's intervening changes address them. They are not permanent accepted failures
or expected failures of the current batch command.

Local evidence in the integration worktree:

- `test-results/integration/verify.log`
- `test-results/integration/batch.log`
- `test-results/integration/merge-proof.json`
- `test-results/integration/site/`

The previous preservation worktree retains source checkpoints, frozen old
builds, and the before-integration protection snapshot. Local artifacts are
not off-machine backups. Automated checks still do not establish perceptual
approval, real-controller behavior, or mobile-device performance.

## Next work: await the owner's marked-up list

The owner wants the current work on main before rearranging categories,
renaming instruments and files, or doing further folder moves.

- Keep the combined **Apps** and their individual versions for now. The owner
  wants to retire individual versions only after the combined replacements are
  satisfactory. No suite's existence proves feature parity.
- Throatazoid's retirement remains requested but is **not implemented** in this
  preservation merge. Retain its shared dependencies when performing that
  separate change.
- Do not start Alien Larynx redesign or further abstraction before its notes.
- Record deep renames as old/new name, stable ID, page URL, controller/model/
  processor/style/asset paths, import/build references and saved-data mapping.
  Do not silently change sound, old saved banks or compatibility routes.
- Review the proposed source/asset layout before a move-only batch. Assets have
  not been relocated by this integration.
- Catalogue rearrangement, display/file renaming, source relocation and
  behavior/design changes should remain separately reviewable changes.

## Catalogue and device-aware Faves

The live catalogue has 142 instruments with primary category, secondary tags
and a single current Faves tag. `docs/v2-instrument-plan.csv` is a planning sheet,
not a second runtime registry. Proposed categories/names are not applied yet.

A source inventory also found playable/lab pages outside those 142 entries:
Acoustic Manifold, Adaptive Airway Lab, Strophe Lab, Crickets, Nightingale
Manifold, Syrinx UI, and SIMD Audio Lab. The last is navigation-only under Works
in progress; the others have no catalogue tags. Redirect aliases, reference/
architecture pages and community rooms are not extra catalogue instruments.
Keep these separate in review so their future disposition is explicit.

For the requested two device-aware Faves levels, separate:

1. **Compatibility:** actual required browser/device features and available
   fallbacks, not a blanket desktop/mobile user-agent rule.
2. **Performance:** measured behavior on representative presets and real
   devices, with possible local calibration. Screen-size tests alone do not
   establish that an instrument performs well on a phone.
3. **Curation:** which eligible instruments the owner wants in each Faves tier.

Use explicit availability/performance labels and a Show all override rather
than silently hiding unmeasured instruments. No desktop-only/preferred labels,
device-performance scores or automatic filtering have been implemented or
validated in this merge.

# Release-file bookkeeping refactor — September 17, 2026

**Layer note:** this records the packaging-only checkpoint before the subsequent
directory moves. The current worktree also contains the first source-layout
batch; see `v2-source-layout-results.md`. Byte-identical public-file claims below
apply to this earlier packaging layer.

## Scope and status

- Branch: `codex/v2-release-manifest`
- Worktree: `/home/blechdom/creative/morphazoid-v2-integration`
- Base: `ca58234773844f7e1fba8d65e55e1cf89b3f1184`
- Status: local worktree changes, **not committed or merged**

This is infrastructure-only work while the owner's naming/category and design
decisions are pending. It changes no instrument, catalogue, route, source/asset
location, DSP, preset, interface or browser dependency.

The main checkout has unrelated in-progress social-preview changes, including
an insertion in `scripts/build-site.sh`. Those files were neither copied into
this branch nor modified. Reconcile that insertion explicitly during a later
authorized integration; do not overwrite it with this branch's older builder.

## Changes

`scripts/build-site.sh` previously repeated 651 paths across its explicit
worktree-copy and required-file lists. The 1,554-line script is now 118 lines;
its inventory lives in `scripts/site/runtime-files.tsv`.

The manifest declares 792 unique paths:

| Policy | Paths | Behavior |
| --- | ---: | --- |
| `copy+require` | 651 | Include before Git tracking and require the resulting artifact path |
| `copy` | 87 | Include if present, without making absence an error |
| `require` | 54 | Require output presence without granting an additional explicit copy permission |

All 738 explicit copy permissions are preserved, as are all 705 required paths
and their validation order. Explicit copy order now follows the manifest;
actual final output names and bytes are compared independently. Existing
tracked-file selection, spider/icon globs, private-path exclusions and
mandatory-file error messages remain in the builder.

The Node reader is build-time only. It rejects malformed policies, duplicate
paths and unsafe relative paths before emitting anything. Its failure reaches
the shell before an existing output directory is replaced.

Data-reading tests now inspect the manifest. Five tests that previously counted
two filename occurrences now check both semantic roles directly. This preserves
their inclusion/requirement contracts instead of preserving duplicated text.
Tests for the builder's actual exclusion/assembly code still inspect that code.

## Verification

| Check | Result |
| --- | --- |
| Manifest/parser/CLI and isolated original/new builder cases | 11 passed |
| Expanded fast preservation gate | 174 passed |
| Final full Node suite | 3,608 passed, **0 failed**, 6 skipped |
| Recursive JavaScript parsing | 488 modules, zero syntax failures |
| WAX and XYFlow parity | Passed |
| Full production build, including Storybook | Passed |
| Storybook artifact check | 109 entries verified |
| Reference/candidate release comparison | **All 3,382 normal/WAX public files byte-identical**, zero additions/removals |

The initial full run exposed two remaining tests that counted duplicate
filename text. Their original two-role requirements were rewritten as direct
copy/required membership assertions, then both focused checks and the full
verification passed. The failed first log is retained; nothing was skipped or
allowlisted to hide it.

The production build emitted Vite's large-chunk advisory. No warning threshold
was changed. Tests ran with Node `v22.23.2`; a Node 24 run was not performed.
No additional listening or browser-interaction pass was performed for this
packaging-only layer: its complete public file list and bytes are unchanged.
This is not a mobile-performance assessment.

## Evidence and future maintenance

Local evidence is under `test-results/release-manifest/`:

- `reference-builder.sh`, `reference-site/`, `candidate-site/`
- `source-extraction.json`, `artifact-comparison.json`
- `manifest-tests.log`, `fast.log`, `policy-regressions.log`
- `verify.log` (first run), `verify-final.log` (passing run)
- `production-build.log`, `storybook-check.log`
- `checkpoint/` (changed files, hashes and working diff)

The immutable builder fixture is `tests/fixtures/site-builder-v1.sh`.
Isolated tests supply its historical inventory to both builders, avoiding a
permanent requirement that live filenames never change.

For an approved future rename, update a path once in the manifest while retaining
the appropriate policy, then update real references and tests. This manifest
does not automatically rewrite imports, worklet URLs, redirects or saved data.
See `scripts/site/README.md` and run `npm run test:release-manifest`.

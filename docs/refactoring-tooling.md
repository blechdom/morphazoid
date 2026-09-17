# Refactoring tools and preservation evidence

These tools support the scoped v2 plan in `v2-refactoring-plan.md`. They do not
rewrite instruments, remove files, approve sound changes, or publish releases.

## Architecture reports

From the repository root:

```sh
npm run analyze:duplicates
npm run analyze:dependencies
# Or run both:
npm run analyze:architecture
```

Both tools are pinned development dependencies. Their configurations and runner
live under `scripts/architecture/`, rather than adding more root-level files.
Reports go to ignored `test-results/architecture/`:

| Report | Contents |
| --- | --- |
| `duplicates/jscpd-report.html` | Browsable duplicate-code findings |
| `duplicates/jscpd-report.json` | Machine-readable duplication findings |
| `dependencies.json` | Module graph and dependency-rule warnings |

### Scope and limits

- Entry points are root browser `.js` modules, `src/`, and the Morphazoidical
  subtree. Newly nested source remains discoverable.
- Duplication reporting excludes tests, development scripts, generated output,
  assets, design artwork, vendor code, and installed packages. It ignores
  comments but does not normalize identifier or literal values. The initial
  minimum is 10 lines / 100 tokens.
- Dependency reporting parses JavaScript modules, including JSX and literal
  dynamic imports. Third-party imports can appear as graph leaves; their
  implementation is not traversed.
- AssemblyScript `.ts` kernels are deliberately outside the JS dependency
  graph. Their existing compilation and `check:simd-wasm` checks remain intact.
- Computed imports, worklet/worker URLs, fetched assets, runtime registration,
  and external inputs need separate inspection. This graph is not a complete
  release-file manifest. Use `scripts/inspect-instrument.mjs` and browser request
  checks alongside it.
- Dependency-rule violations are warnings. Duplicate findings do not trigger a
  threshold failure. Tool execution/configuration errors still fail, and an
  empty duplicate scan fails rather than silently reporting success.
- Reports are not part of `npm run verify` yet. Review the existing findings
  before deciding which rules should become release gates. Do not automatically
  suppress findings or aim for zero duplication across intentionally different
  DSP implementations.

On the initial source, this configured scan found 633 duplicate blocks across
465 analyzed sources and one reported import cycle: `nav.js` dynamically imports
the catalogue, which imports navigation data back. These are characterization
results, not automatically confirmed defects. They are not directly comparable
with the earlier function-body-only audit.

## The first extraction

`src/graphics/canvas-sizing.js` contains the existing Solid/Hyper sizing
calculation. It owns no DOM, observers, application state, rendering, or audio.
The first pilot used it in `solid-app.js` and `hyper-app.js`. The subsequent
uniformity batch expanded it to 36 more controllers without changing their
existing policies; `src/graphics/README.md` explains the options and limits.

`tests/fixtures/canvas-resize-v1.txt` preserves the original callback from
`4e9feed`. `tests/canvas-sizing.test.mjs` compares calculations and callback
ordering with that independent fixture, including fractional sizes, high DPI,
large canvases, and existing non-finite/edge behavior. Do not "improve" the
reference or change its clamps to make a refactor pass.

The release builder explicitly includes/requires this module, including before
its first commit. This uses the existing release-file mechanism; replacing that
mechanism with a reviewed asset manifest is separate work.

## Fast checks and review batches

```sh
npm run test:refactor:fast
npm run test:refactor:batch
```

The fast gate checks sizing-policy equivalence, audio/transport infrastructure,
the contour worklet, and report tooling. The batch gate additionally runs build
parity, the broad browser sizing matrix, focused interaction/audio suites, and
the existing full verification. It does not regenerate WAX itself: regenerate
and review generated changes before running it.

The batch gate stops on a failed check and never suppresses the eight recorded
baseline failures. In particular, its final `npm run verify` still fails until
those separate baseline issues are resolved. Report new and pre-existing
failures separately; do not call the repository fully green.

## Focused browser checks

```sh
npm run test:browser:v2-pilot
npm run test:browser:v2-rollout
npm run test:browser:v2-uniformity
```

The pilot suite checks Solid and Hyper in three layouts, their existing canvas
calculation, silent transport, audio during viewport changes, sine/FM/PM
transitions, Audio-off behavior, and cleanup. It attaches screenshots, canvas
metrics, browser information, sample rates, and coarse output-meter reports.

The rollout suite adds all three L-system pages and the physics page family,
with selected playback/resize/mode scenarios and a guard against unexpected
microphone requests. The uniformity suite discovers pages loading every
migrated controller, including the Graph wrappers, and checks each against its
own frozen callback in `tests/fixtures/canvas-resize-variants-v1.json`.
It does not assume that all instruments should use Solid/Hyper's pixel budget.

Browser preservation runs are serial to avoid resource contention in heavy
visualizations. Fast Node tests remain parallel. An unchanged Plasma Ball
desktop reference timed out in the initial parallel sizing run, then passed
in isolation and in the full serial run; no assertion or runtime was weakened
to accept that timeout.

By default, the existing Playwright configuration uses port 3435 and can reuse
a running server. Verify which checkout it serves first. To compare an archived
artifact, start an explicitly owned server and set `MORPHAZOID_QA_BASE_URL` to
its exact origin. With an external server, ensure it is reachable before running
the tests; the existing fallback server command still uses port 3435.

For durable comparison evidence, use a JSON reporter as well as console output:

```sh
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/my-run/browser-report.json \
  node_modules/.bin/playwright test e2e/v2-geometry-preservation.spec.mjs \
  --workers=1 --reporter=list,json --output=test-results/my-run/browser
```

These tests do not capture PCM, establish sample-exact sonic equivalence, prove
glitch-free playback, or replace listening on a real device.

## Evidence locations

Initial work is recorded in ignored local storage:

- `test-results/v2-baseline/verify.log`: original full verification results.
- `test-results/v2-baseline/reference-site/`: locally built, untouched-source
  release artifact.
- `test-results/v2-baseline/reference-manifest.json`: source identity and SHA-256
  hashes for that artifact; explicitly not marked production-verified or
  listener-approved.
- `test-results/v2-baseline/browser-report.json`: reference browser evidence.
- `test-results/v2-candidate/artifact-comparison.json`: built-file differences.
- `test-results/v2-candidate/browser-report.json`: candidate browser evidence.
- `test-results/v2-candidate/browser-comparison.json`: paired test outcomes and
  settled screenshot hashes.
- `test-results/v2-candidate/verification-comparison.json`: original/final Node
  results and confirmation that failure names are unchanged.

These local outputs are disposable working evidence, not a durable off-machine
backup. Retain the approved release and listening references in an agreed
archive/release-artifact location before publication.

The broader batch uses `test-results/v2-uniformity/` for source-isolation checks,
original callback backups, before/after policy tests, built-file comparisons,
browser JSON reports, and full-suite results. The accepted first-pilot snapshot
also remains under `test-results/v2-round2/checkpoint/`.

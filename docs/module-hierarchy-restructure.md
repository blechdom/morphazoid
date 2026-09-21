# Instrument module hierarchy: path-only relocation

September 21, 2026. Based on `fb749f2`, in the existing
`codex/shapes-faves-rebased` worktree. This report records the tested relocation
batch; Git history and deployment records establish its publication status.

## Scope

The earlier directory refactor moved page controllers and styles. This pass
moves **281 remaining instrument models, audio engines, worklets and helpers**
out of the flat `src/` directory. It does not redesign instruments, retune
presets, change scheduling, or consolidate similar DSP algorithms. Browser
verification additionally exposed a pre-existing Shepard–Risset initialization
error, a Spider asset-base calculation missed by the literal-path move, and
Spider model-download completion diagnostics. Those exact corrections are
tracked separately below; the owner has now confirmed the targeted Spider
browser rerun passes.

The complete old → new path map is `source-module-layout.json`. A move is not
a rename of public instrument IDs, processor registration names, storage keys
or saved-state formats.

```text
assets/                         # unchanged runtime assets and WASM binaries
*.html                          # unchanged public routes
src/
  instruments/
    shapes/                     # controller, state, scene/rhythm, presets, audio
    hiccup-head/                # controller, model, processor, presets, styles
    roach-synth/                # controller, model/audio/MIDI/renderer modules
    spider-synth/               # controller, model/audio/rig/renderer modules
    puggler/                    # model, audio, crowds/props/rendering, controller
    rubix/                      # model, SIMD surface wrapper, presets, controller
    ...                         # other instrument-owned modules
  families/
    graph/                      # shared graph models/controller/audio
    syrinx/                     # shared animal-call/tongue model and processor
    tract/                      # shared tract model/processors and rendering
    physics/                    # physics scene models and shared controller
    mic-branch/                 # shared microphone branching engines/worklets
    signalsmith-generation/     # generation mixer modules
    ...                         # other existing implementation families
  site/
  ui/
  graphics/
  audio.js, audio-output-manager.js, geometry.js, ...
```

**35 flat JavaScript modules remain deliberately shared**, down from 316.
They include audio/MIDI/math foundations, the general physical-sounds engine,
and the existing SIMD/WebGPU engine/toolchain APIs. The AssemblyScript kernels
and all compiled WASM bytes remain at their existing paths. This pass is not
a toolchain migration. `src/starting-instruments/` retains its existing bounded
family layout.

## Preservation controls

- Authored relocation edits are restricted to resource/import paths.
  DSP, presets, event order, processor names and storage keys remain intact.
  One reviewed runtime fix beyond those moves is Shepard's Reset selector:
  `document.querySelector("[data-reset-all]")` replaces passing a CSS selector to
  the ID-only `$` helper. The correct button now receives its existing handler,
  allowing initialization and teardown registration to finish.
- Spider's specimen asset base now uses its model metadata's new directory,
  rather than the old flat `src/` root. That preserves the deployment prefix
  for model/rig files under WAX or a nested site path. Pure tests resolve every
  desktop model, phone model and companion rig from source and nested mounts.
- Spider's model downloader now uses the native `response.arrayBuffer()` path
  for declared bounded model sizes, matching Roach's existing approach. Header
  and actual-byte size checks, GLB/rig validation and load ownership remain.
  Unknown-size responses retain incremental limiting and now release the
  stream reader. Known-size progress updates go from initial to 85% to ready,
  rather than per chunk; no geometry, synthesis or preset behavior changes.
- `tests/fixtures/module-hierarchy-runtime.json` records SHA-256 hashes of the
  pre-move runtime files. `tests/module-hierarchy.test.mjs` reverses the declared
  path changes and requires exact original bytes for every affected module,
  allowing only the exact, counted selector, asset-base and download corrections
  recorded in the move map's `reviewedRuntimeFixes`. Original hashes are not
  regenerated to hide changes.
- Static and cache-busted imports, module-relative assets, worklet URLs,
  document-relative references and generated WAX references are updated.
- Spider, Roach and Hiccup release fingerprinting follows the new module roots,
  so model/worklet changes still invalidate their page graph without needlessly
  invalidating unchanged large binary assets.
- The runtime manifest retains existing requirements. Relocated required-only
  modules gain explicit copy permission where necessary for uncommitted preview
  builds; genuinely optional files remain optional. No Git staging is used as
  a hidden build prerequisite.
- Frozen historical fixtures remain unchanged. Their consumers resolve the
  current paths, and archive-builder tests keep their original fixture policy.
- No public HTML route, catalogue category, Faves order, asset/WASM content,
  sample, model binary, framework, hosting or deployment setting changes.

## Final verification

The owner reported **all green** after the final `build:wax` → `verify` →
full browser smoke → `git fetch origin` command sequence on September 21.
These full-suite results are owner-executed, not an agent-run full verification.
Local inspection confirms the regenerated WAX controller/viewer contains all
three reviewed runtime fixes. The three hierarchy checks were rerun locally
and pass, including the exact-byte proof for all 430 affected runtime modules;
`git diff --check` is clean.

The fetched `origin/main` is `d96793a` and is already an ancestor of the tested
branch, so no additional rebase or runtime changes are needed before committing
this batch. Publication must use a normal fast-forward push, never force.
The separate local `main` worktree is not modified.

## Verification history

- A complete WAX build succeeded: **207 pages**.
- Runtime syntax check succeeded: **574 modules**, zero syntax failures.
- Path-reversal checks passed for the recorded **430 affected runtime modules**.
- The last focused run passed **319 of 325 tests**. Its six failures were stale
  source-path assertions (Creaturazoid, Graph, migrated demos, shader build
  inventory, SRTUSS and Syrinx); those assertions have since been updated.
  Their final rerun is **not yet performed**.
- The full browser sweep and final `npm run verify` were blocked before execution
  by approval-service failures. They are **pending**, not passing.
- The owner subsequently authorized finishing and publishing to main. On the
  renewed attempt, both the remote fetch and local verification command were
  again rejected before execution because the approval service disconnected.
  Main has not been changed, and this restructure has not been committed or
  pushed. A further static review corrected the remaining Creaturazoid
  worklet-path assertion; it still requires execution of the pending checks.
- The owner's first manual browser run accidentally reused an old worktree on
  port 3435. QA now starts a strict-port server and checks shared source bytes
  before testing; it cannot silently reuse a different checkout.
- The owner's corrected manual run on port 4381 reported **206 passed, two
  failed**. Its traces showed a favicon request from the `automatopoeia.html`
  redirect and the pre-existing Shepard Reset selector crash. Both are fixed
  in source. Four new local regression tests passed (including actual controller
  initialization against the real markup IDs, reset in both modes and cleanup);
  the three path-preservation checks also passed.
- Generated WAX output must be rebuilt for these last two fixes, and their real
  browser rerun remains pending. No successful publication is claimed.
- A subsequent owner run reported **206 passed, two failed** on different pages:
  `cellular-automata.html` requested a missing fallback favicon, while Spider's
  model request returned 200 then reported `net::ERR_ABORTED`. The trace captured
  a still-loading model, not a successful rig load; it does not establish the
  cancellation's cause. All 28 remaining top-level entries lacking favicon
  declarations now point to the existing SVG. An inventory test checks every
  root entry/redirect to prevent this from recurring one alias at a time.
- Spider's smoke check now waits for its existing public model-ready state
  (38 bones and nonempty geometry), fails on model-load errors, and saves
  `spider-model-loading.json` with status and request outcomes. Aborted requests
  remain failures; no blanket exception or silent retry was added. The corrected
  URL base does not by itself prove the reported root-site abort is resolved.
- **22 local regression checks passed** after these follow-ups. The next targeted
  browser rerun and generated-site rebuild remain owner-executed verification.
- The owner's next targeted run repeated both pages three times: Cellular
  Automata passed all three; Spider failed all three. Each saved
  `spider-model-loading.json` shows **loaded, not loading, 38 bones, 105450
  vertices, no retry UI**, alongside a 200 model response followed by
  `net::ERR_ABORTED`. There were no page, console or HTTP errors. This rules out
  an incomplete rig in these runs but does not establish the browser's
  cancellation cause.
- The native-reader change above targets that completion discrepancy. **46
  focused local checks pass**: downloader 10, asset-path/readiness 6, hierarchy
  3, QA server policy 9 JS + 4 Python, existing viewer 7 and actual model/rig 7.
  The hierarchy proof still matches all 430 original hashes after reversing
  only the declared fixes and path changes. `git diff --check` is clean.
  These are local checks, distinct from the browser rerun below. Failed network
  requests are still failures, not filtered away.
- On September 21 the owner reported **all passed** after the Spider-only,
  three-repeat Chromium command below. The current Playwright `.last-run.json`
  also records `passed` with no failed tests. This confirms the targeted fix,
  not completion of all publication gates.
- A fresh publication attempt after that report still could not fetch
  `origin`: the approval reviewer disconnected before command execution.
  No alternate remote-access path was attempted. The generated WAX Spider
  controller and viewer still contain the older asset-base and body-reader
  code, so a generated-site rebuild remains necessary before final verification
  and commit. No new fetch, commit, push or deployment is claimed.
- No new human/device listening pass has occurred. Exact source preservation
  does not substitute for verifying that all resource paths load in a browser.

The targeted Spider command now passes; retained here for reproduction, not
as a request to repeat it:

```sh
env -u MORPHAZOID_QA_BASE_URL -u PLAYWRIGHT_BASE_URL \
  MORPHAZOID_QA_PORT=4381 npm run test:browser:smoke -- \
  --grep 'spider-synth\.html loads without browser errors' --workers=1 --repeat-each=3
```

The owner-confirmed final verification sequence, retained for reproduction:

```sh
npm run build:wax &&
npm run verify &&
env -u MORPHAZOID_QA_BASE_URL -u PLAYWRIGHT_BASE_URL \
  MORPHAZOID_QA_PORT=4381 npm run test:browser:smoke
```

This starts a dedicated server for this checkout. Choose another QA port if
4381 is occupied. For an explicitly started preview, set its base URL instead;
the preflight rejects stale shared source bytes before running any tests.

## Recovery

`test-results/module-hierarchy/before/` contains the changed pre-move text files.
The move map is versionable source; the local `rewrite-report.json` and logs
record the work performed. The Git base remains `fb749f2`. Do not reset a shared
worktree or discard intervening edits to undo a batch—use the explicit move map
and before-files. Consult Git history and remote-branch verification for commit
and publication status; this report alone does not certify a deployment.

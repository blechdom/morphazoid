# Morphazoid agent guide

These instructions apply to the whole repository. Follow the user's requested
scope first. Morphazoid is a collection of playable instruments where graphics,
gesture, sound, and unusual systems form one expressive interface. The browser
surface is a framework-free static application built from authored HTML, CSS,
ES modules, Canvas, and Web Audio. Native JUCE/VST3 and REAPER targets are also
supported; plugin work follows `plugins/README.md` and any more specific subtree
guidance.

Start with `README.md` and `package.json`; use `CONTRIBUTING.md` for the human
development workflow and command matrix. Use `npm run dev` for a browser preview
and `npm run verify` for repository verification. Inspect scripts before
invoking narrower build, WAX, publishing, or deployment commands; do not invent
command names.

## Establish the working context

- Confirm the repository root, branch, worktree, dirty state, and intended
  preview or server root before editing. Never create Morphazoid files beneath
  an unrelated repository. Use `git rev-parse --show-toplevel`,
  `git branch --show-current`, and `git worktree list` from the candidate checkout;
  do not infer the active branch from a directory's name. Repository paths in
  this guide are relative to that root, not the shell's initial directory.
- Preserve pre-existing changes. Use one writer for a worktree or overlapping
  file set. Parallel agents may investigate read-only or work in isolated
  worktrees; integrate their changes serially.
- Read the relevant implementation and nearby shared utilities before editing.
  Inspect at least two useful sibling instruments before creating or materially
  redesigning one.
- For a browser instrument, `node scripts/inspect-instrument.mjs <catalogue-id>`
  inventories its entries, dependencies, registration, WAX copies, and test
  candidates without changing files; see `docs/agent-tooling.md` for its limits.
- Instrument-owned controllers, models, worklets, presets and styles live in `src/instruments/<canonical-id>/`;
  multi-instrument implementations live in `src/families/<family>/`, and site
  metadata/controllers live in `src/site/`. Shared audio/MIDI/math utilities and
  the existing WASM engine/toolchain boundaries retain their `src/` locations.
  See `docs/source-module-layout.json` for the explicit model/worklet move map.
  The subsequent site-metadata moves are in `docs/site-metadata-layout.json`.
  `docs/starting-family-layout.json` records the starting-instrument runtime
  co-location with its existing family controllers. Its subsequent owner-requested
  rename to `src/families/work-in-progress/` is in `docs/prototype-family-layout.json`;
  this shared five-prototype package is not a catch-all for all WIP instruments.
  Follow the actual HTML/import references
  or inspection output; categories and display names are not filesystem paths.
  Public HTML, global bootstrap scripts and `style.css` remain at the root;
  runtime `assets/` stays top-level. See `docs/agent-tooling.md` for the path map.
- For a browser preview, verify the responding endpoint and report the exact URL
  and worktree. The dev server can choose another available port; Playwright's
  base URL can be overridden with `MORPHAZOID_QA_BASE_URL`. Check the current
  server/configuration rather than treating a historical port as authoritative.
  Verify what each port serves and do not stop an unrelated process. Native and
  REAPER previews follow `plugins/README.md`.

## Product principles

- Treat graphic and sound as one instrument. Define the central causal loop
  before adding breadth: performer or simulation state -> visible mechanism ->
  synthesis change -> audible result.
- Prefer direct, tactile gestures in the viewport. Show position, range,
  pressure, motion, or modulation in the graphic, and make important controls
  audibly consequential rather than decorative.
- Build the smallest playable vertical slice first. Add secondary modes, large
  preset banks, effects, and decorative UI after the core gesture is visually
  legible and musically convincing.
- Preserve musical flow. Changing presets, modes, dimensions, breath state, or
  other non-transport parameters should not stop playback or looping unless
  stopping is intrinsic to the requested behavior.
- Treat presets as expressive starting points, not parameter cages. Make
  defaults moderate in level and immediately playable; expressive extremes may
  be wild. Keep randomization bounded and provide a route back to a useful,
  reproducible state.
- Use Morphazoid's existing visual language before inventing component styles:
  dark surfaces, saturated accents, high contrast, compact native controls, and
  deliberately strange but readable graphics. Use negative space structurally.
- Use borders once per semantic region. Prefer spacing, alignment, quiet surface
  shifts, and a single accent over nested card boxes; never add button-like marks
  or tiles that have no action.
- Reserve permanent instrument real estate for playing and recovery. Keep backend,
  lane, kernel, budget, topology, implementation counts, slogans, and explanatory
  diagrams in diagnostics or documentation unless a performer needs them to act.
- Keep transport and recovery immediately reachable. For instruments migrated
  to the header preset contract, main preset recall belongs left of the sound
  meters, using the Choose-menu UI. Keep the right-hand control order
  preset menu → next → randomize (dice) → MIDI → meters → output/Audio →
  settings; do not detach MIDI into the middle of the masthead. Each migrated
  instrument supplies a bounded, pure full-state randomizer, not random preset
  selection or a lightly mutated factory scene. Cover every preset-owned
  musical parameter, including curves, mappings, effects and musical switches;
  keep dependent values valid and test for unintentionally frozen fields.
  Randomization preserves output level, live clocks and device state.
  Preset-owned rotation/motion switches and loop policy are musical parameters,
  so they participate; external Audio/primary-transport flags do not.
  Shape, Solid, Hyper and the Shapes app's primary-playhead recall are explicit owner-requested
  exceptions; registration still shows Select Preset without applying a scene. See
  `contracts/audio-transport-v1.md` for per-family boundaries.
  Randomization marks the result Custom and uses the same complete-state
  apply/rollback contract. The header menu selects complete presets only;
  independent body/face, sequence, skin and other focused sub-preset controls
  remain in their instrument sections, not nested inside the main preset menu.
  Check `docs/full-instrument-preset-rollout.md` for per-instrument migration and
  verification status. The stage remains the graphic and gesture surface.
- A sequencer that visually invites painting must support one continuous captured
  drag across steps, including interpolated skipped cells and one undo transaction.
  A pitched computer-key surface must show the actual physical key labels and use
  the full two-row mapping rather than a short note-name-only piano.
- Use one coherent font and one color across the complete instrument title; do not
  split title words into competing treatments.
- Use ADSR envelopes and X/Y controls when each dimension has a clear, audible DSP
  destination and visible state. Do not add either as decorative control chrome.
- Keep the playable viewport compact and immediate. Put substantial explanatory
  prose, research background, and instructional chrome in adjacent documentation
  or notes rather than displacing the instrument or covering its controls.
- Preserve the user's evocative language as design evidence. Translate terms
  such as "tin can," "pink trombone," "breathing," "howling," or "tactile"
  into concrete geometry, motion, interaction, and sound decisions.
- Do not replace a working instrument with a generic rewrite merely to unify
  code. Preserve sounds, gestures, routes, query/hash behavior, saved banks, and
  menu placement unless the request explicitly changes them.

## Browser and native contracts

- Treat authored public HTML/bootstrap files, `style.css`, `src/`, `assets/`,
  and `morphazoidical/` as source. Treat `dist-wax/` as generated, committed
  output: regenerate it with `npm run build:wax` rather than editing it, and require
  `npm run check:wax-dist` to match a clean build when runtime source changes.
- Explicit pre-commit file inclusion and required artifact paths live in
  `scripts/site/runtime-files.tsv`. Declare each path once and preserve the
  distinction between copy permission and required presence; see its README.
- Keep the browser surface static and browser-runnable. Do not add a framework,
  server rendering, backend, or runtime Node dependency unless the task
  explicitly changes that architecture. This restriction does not apply to
  native or REAPER plugin targets.
- Keep the normal browser site and WAX integration separate. Authored browser
  HTML must not load WAX bootstrap code, and host-only state, MIDI, and transport
  behavior stays dormant without positive WAX detection. Follow
  `contracts/wax-host-v1.md`.
- Browser Audio starts off and is armed explicitly. Audio and transport are
  separate: Play, Space, pointer gestures, and programmatic transport actions
  must not silently arm Audio. The documented explicit MIDI-enable and
  positively detected WAX-host paths are exceptions. Follow
  `contracts/audio-transport-v1.md` and `contracts/web-midi-toolbar-v1.md`.
- Audio takes priority over graphics in both timing and resource budgets.
  Keep synthesis and rhythmic triggers independent of rendering; graphics
  follow the audio clock. When resources are tight, reduce visual frame rate,
  resolution, shadows, or effects before compromising audio continuity or
  timing. Verify that rendering and UI stalls do not interrupt sound.
- Schedule browser musical events on `AudioContext.currentTime`; use animation
  frames only for display. Bound voices, nodes, events, levels, and rendering;
  skip stale attacks, smooth live changes, and release audio, devices, timers,
  frames, and listeners during teardown. Native plugins use host/sample-offset
  scheduling and the lifecycle rules in `plugins/README.md`.
- Reuse `src/ui/` foundations with native accessible HTML and native events.
  Shared components do not own Web Audio, MIDI, microphone permission,
  application state, simulation, or Canvas rendering. Keep domain UI and
  engines instrument-owned. Extract a shared component for two real consumers
  or a project-wide contract. Follow `DESIGN_SYSTEM.md`.

## Integration and responsive behavior

- A stable catalogue ID joins `TOOL_GROUPS` in `src/site/instrument-registry.js`
  (re-exported by `nav.js`), `CATALOG_DETAILS` and
  derived records in `src/site/instrument-catalog.js`, secondary tags in
  `src/site/catalogue-taxonomy.js`, and every applicable
  capability classification in `src/site/instrument-midi-capabilities.js`. Compare
  IDs and records across these sources instead of pinning the current total;
  keep an explicit count only when cardinality itself is a reviewed product
  contract. Avoid import cycles. Add factual catalogue copy, correct
  status/features, authored fallback navigation, and a valid WebP icon.
- Capability records state required behavior; they do not prove it exists. Keep
  requirements and verified behavior separate. Do not weaken a requirement or
  test merely to accept a missing implementation.
- Prefer native labelled controls and `<output>` elements. Every Canvas needs an
  accessible name or alternative. Interactive canvases also need keyboard
  operation and visible focus; informational monitors should not become focus
  targets merely because they use Canvas. Handle pointer cancellation and
  preserve document scrolling outside the drag surface.
- Support desktop `1440x900`, phone portrait `390x844`, and phone landscape
  `844x390`. Keep all controls reachable, prefer a scrollable control region to
  hidden or tiny controls, and check both document and nested-panel overflow.
  Coarse-pointer Audio and primary transport targets must be at least 48x48 CSS
  pixels.

## Research and honesty

- Research unfamiliar animals, acoustics, physical models, mathematical
  systems, and cultural references before making factual claims. Prefer primary
  sources when research materially shapes behavior.
- Distinguish evidence, supported approximation, artistic speculation, and
  non-claims. Do not describe a synthesis proxy as authentic or use false
  scientific precision. Record material third-party provenance and licenses.
- Do not use research as a reason to flatten the project's humor, fantasy, or
  experimental character.

## Shared-worktree and Git safety

- Assume other tasks may be editing the same checkout. Inspect status, diffs,
  untracked files, recent history, and remotes before Git mutations.
- Before reconciling a divergent `main`, preserve tracked and untracked work in
  a recoverable snapshot or use an isolated clean worktree. Never use
  `git reset --hard` or force-push to solve divergence. Check semantic overlap
  even when Git reports no conflict.
- Stage explicit paths and review the staged diff. Do not reformat, stash,
  commit, publish, or otherwise consume unrelated work.
- A request to publish includes proof: confirm the pushed commit is on the
  intended remote branch, then inspect the deployment and public bytes when the
  repository has a deployment workflow.

## Verification

- Start with the narrowest relevant tests. For browser implementation changes,
  finish with `npm run verify` and applicable browser suites from
  `QA_AUTOMATION.md`. Run WAX, release, Storybook, native, or REAPER workflows
  only when those surfaces changed.
- Verify observable relationships: finite and bounded output, expected
  silence/non-silence, onset/release, control sensitivity, preset separation,
  deterministic reset, state continuity, cleanup, and click-free transitions.
- Automation is the mechanical half of acceptance. Never claim timbral quality,
  physical fidelity, musical usefulness, controller feel, or touch quality from
  green tests alone. Perform the relevant human/device pass or state clearly
  that it remains unperformed.
- Distinguish failures caused by the change from pre-existing failures. Report
  both precisely; never call a partial or failed run fully green.

## Reusable workflows

Use repository skills when their descriptions match the task:

- `$morphazoid-history-synthesis` extracts durable guidance from task histories.
- `$morphazoid-idea-development` frames or refines a loose instrument concept
  before or alongside implementation.
- `$morphazoid-instrument-development` implements instrument lifecycle work,
  core redesigns, DSP/control mappings, and full repository integration.
- `$morphazoid-responsive-audio-qa` checks mechanical layout, input, transport,
  lifecycle, and browser-contract regressions after UI/audio changes.
- `$morphazoid-perceptual-qa` diagnoses audible identity, parameter leverage,
  preset separation, transitions, visual causality, and listening readiness.
- `$morphazoid-safe-publish` reconciles, commits, pushes, deploys, or hands off
  work safely from a shared or divergent checkout.

## Agent guidance and integrations

- Keep durable, always-on repository invariants in the root `AGENTS.md`. Use a
  nested `AGENTS.md` only when a subtree genuinely differs; reserve
  `AGENTS.override.md` for an intentional Codex-only same-directory replacement.
  Put human explanations in `CONTRIBUTING.md` or focused docs and put enforceable
  behavior in source, tests, and CI.
- Keep reusable guidance checkout-independent: use repository-relative paths
  and actual worktree discovery, not fixed home directories, branch checkout
  names, interpreter locations or preview ports. Historical reports may retain
  exact paths as provenance; they are not commands for the current checkout.
- Create a repository skill in `.agents/skills/<name>/SKILL.md` only for a
  specialized, repeatable, non-obvious workflow. Give it one job and a precise
  positive/negative trigger boundary. Update it when its commands, contracts,
  dependencies, outputs, or demonstrated routing behavior changes; validate
  structure, trigger and non-trigger prompts, and any helper scripts.
- Use MCP when agents need a reusable structured runtime capability, especially
  for live external data, authenticated access, or controlled actions. A skill
  may teach a repeatable workflow that uses MCP, but it does not replace the
  server. Before adding one, follow `docs/agent-tooling.md`, define ownership,
  permissions, versioning, security, conformance, host tests, operations, and
  rollback, and keep credentials out of tracked files and agent instructions.
- Do not duplicate this cross-agent guidance in `.github/copilot-instructions.md`.
  Add provider-specific instructions only for behavior unique to that provider.

See `docs/agent-tooling.md` for the complete AGENTS/skill/MCP decision matrix
and maintenance checklist.

Treat this file as living guidance. Add a rule only when it is durable across
multiple tasks; keep page-specific decisions in code, tests, or focused docs.

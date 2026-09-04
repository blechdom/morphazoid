# Morphazoid agent guide

## Project

Morphazoid is a collection of playable browser instruments where graphics, gesture, sound, and unusual systems form one expressive interface. It is a static, framework-free HTML/CSS/JavaScript site. Canvas renders many stages; Web Audio and AudioWorklets produce sound.

Start with `README.md` and `package.json`. Use `npm run dev` for local serving and `npm run verify` for repository verification. Inspect scripts before invoking narrower build, WAX, publishing, or deployment commands; do not invent command names.

## Product principles

- Treat graphic and sound as one instrument. Important controls should produce legible visual feedback and a meaningful audible result.
- Prefer direct, tactile gestures in the viewport. Make hit targets generous and show position, range, pressure, motion, or modulation in the graphic.
- Preserve musical flow. Changing presets, modes, dimensions, breath state, or non-transport parameters should not stop playback or looping unless stopping is intrinsic to the requested behavior.
- Treat presets as expressive starting points, not parameter cages. Preserve existing presets and sounds that the user likes while making the underlying instrument broadly playable.
- Use Morphazoid's existing visual language before inventing component styles: dark or black surfaces, saturated accents, high contrast, compact native controls, and deliberately strange but readable graphics.
- Use negative space structurally. Do not cover an instrument or its parameters with floating panels when the control can live in the layout or resizable diagram.
- Preserve the user's evocative language as design evidence. Translate descriptions such as "tin can," "pink trombone," "breathing," "howling," or "tactile" into concrete geometry, motion, interaction, and sound decisions.
- Novelty should remain playable. Randomization, modulation, morphing, and generative systems need bounded output, intelligible feedback, and a route back to a useful state.

## Interaction and audio contract

- Separate transport state from editable instrument state. Do not rebuild or tear down transport because a preset or parameter changed.
- Keep UI, animation, and synthesis synchronized from a clear source of truth. Avoid controls that only relabel a value or animate decoratively when the user expects audible change.
- Map visible structures to audible structures when a page is based on geometry, topology, automata, biology, or notation. Make the mapping inspectable rather than arbitrary where practical.
- Retain private state across mode switches when it belongs to one mode; share state only when the parameter conceptually belongs to the combined instrument.
- Resume or initialize audio only from valid user gestures. Keep continuous synthesis bounded and clean up nodes, timers, animation frames, and listeners.
- Randomize all parameters promised by the UI, but constrain unsafe, silent, or unusable combinations. Do not silently change transport unless requested.

## Responsive contract

- Support desktop, mobile portrait, and short mobile landscape.
- Controls must remain reachable at every supported aspect ratio. Prefer a scrollable control region over hiding controls or shrinking targets until unusable.
- Keep the instrument centered when space permits, but never center it in a way that clips controls.
- Prevent overlays from obscuring gestures or parameters. Make diagram-integrated controls resize with the diagram.
- Check both document overflow and nested-panel overflow. A desktop screenshot alone is not responsive verification.
- Maintain touch targets, keyboard access, focus visibility, and readable contrast.

## Research and honesty

- Research unfamiliar animals, acoustics, physical models, mathematical systems, and cultural references before making factual claims.
- Prefer primary sources for technical claims. Record useful sources near the implementation or in project documentation when they materially shaped the model.
- Clearly distinguish literature-backed behavior from expressive approximation. Physical plausibility is welcome; false scientific precision is not.
- Do not use research as a reason to flatten the project's humor, fantasy, or experimental character.

## Preservation and scope

- Read the relevant implementation and nearby shared utilities before editing.
- Do not replace a working instrument with a generic rewrite merely to unify code.
- Preserve established sounds, gestures, routes, query/hash behavior, saved banks, and menu placement unless the request explicitly changes them.
- Prefer extending existing Morphazoid primitives and styles over introducing a dependency or parallel design system.
- Keep unrelated user and agent work intact. Do not reformat, stage, stash, commit, or publish unrelated changes.

## Shared-worktree and Git safety

- Assume other Morphazoid tasks may be editing the same checkout. Inspect branch, status, diff, untracked files, and recent history before writing or integrating.
- Before pulling a divergent `main`, preserve all tracked and untracked work with a recoverable snapshot and verify the exact restore target. Never use `git reset --hard` or force-push to solve divergence.
- Reconcile remote changes deliberately. After restoration, check for semantic overlap even when Git reports no conflict.
- Stage explicit paths. Review the staged diff and confirm no unrelated files or generated secrets are included.
- A request to publish includes verification: confirm the pushed commit is on the intended remote branch, then inspect deployment when the repository has a deployment workflow.

## Verification

- Test behavior in proportion to risk: pure logic tests for mappings and generators, interaction tests for state transitions, and rendered browser checks for layout and animation.
- For instrument work, verify transport continuity, audible parameter effect, bounded output, cleanup, and relevant viewport sizes.
- Run focused checks during iteration and `npm run verify` before handoff when feasible.
- Distinguish failures caused by the change from pre-existing failures. Report both precisely; never call a partial or failed run fully green.
- A feature is done when the requested musical interaction works, its state survives expected transitions, its controls remain accessible, relevant tests pass, and the production path builds.

## Reusable workflows

Use repository skills when their descriptions match the task:

- `.agents/skills/morphazoid-idea-development/SKILL.md`
- `.agents/skills/morphazoid-history-synthesis/SKILL.md`
- `.agents/skills/morphazoid-responsive-audio-qa/SKILL.md`
- `.agents/skills/morphazoid-safe-publish/SKILL.md`

Treat this file as living guidance. Add a rule only when it is durable across multiple tasks; keep page-specific decisions in code, tests, or focused documentation.

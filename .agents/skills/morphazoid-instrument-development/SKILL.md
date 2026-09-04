---
name: morphazoid-instrument-development
description: Create, consolidate, promote, rename, remove, or materially extend a Morphazoid browser instrument, including its visual-to-sound model, DSP, controls, presets, route registration, and repository integration. Use for new instruments and core redesigns; use morphazoid-perceptual-qa to evaluate or tune an established instrument.
---

# Morphazoid Instrument Development

Build or evolve one coherent instrument whose visual mechanism, gesture, DSP,
state, and repository integration agree. The user's requested concept and scope
take precedence over this workflow.

## Prepare

1. Read the repository `AGENTS.md`, `DESIGN_SYSTEM.md`, `QA_AUTOMATION.md`, and
   `contracts/audio-transport-v1.md`.
2. Verify the repository root, branch/worktree, dirty state, and active preview
   root. Preserve existing changes. Keep one writer per worktree or overlapping
   file set; use parallel agents only for read-only work or isolated worktrees.
3. For creation or a core redesign, inspect at least two siblings chosen for
   relevant architecture or interaction patterns. Identify which parts to reuse
   and which musical mapping must remain unique. Treat siblings as evidence,
   not authority: audit reused behavior against the current contracts before
   copying it. For registry-only lifecycle work, inspect inbound references,
   aliases, and compatibility instead.
4. Resolve the tool ID, page slug, catalogue group/status, primary transport,
   audio input/output, MIDI ownership, WAX needs, research basis, and asset
   provenance from the request and repository. Ask only when an unresolved
   choice would materially change the instrument.

Catalogue placement is material because it controls visibility and
Works-in-progress status. Infer it from the request and closest groups only when
the fit is clear; otherwise defer registration or ask before choosing a group.

Read `contracts/web-midi-toolbar-v1.md` when MIDI behavior or capability
classification changes. Read `contracts/wax-host-v1.md` when host state,
transport, routing, adapters, or WAX artifacts change.

For a rename, promotion, consolidation, or removal that does not change the
core model, skip the instrument-contract and vertical-slice steps. Preserve
stable IDs and saved-state compatibility when required, inspect inbound
references, and use the integration checklist to update every affected surface.

## Freeze the instrument contract

Read [references/instrument-contract.md](references/instrument-contract.md) and
write down the compact contract before broad implementation. It must make the
central causal loop, safe defaults, state ownership, limits, and non-goals
testable. Keep it in the working response or task notes unless the user requests
a persistent design file or the repository already has a required artifact.

When the concept depends on a real physical, biological, historical, or
cultural subject, read
[references/domain-evidence.md](references/domain-evidence.md) before settling
the model or product claims. Research only far enough to support the core
mapping, safe ranges, limitations, and product wording for the requested slice;
do not turn a prototype into an exhaustive literature review.

## Build in vertical slices

1. Implement the smallest complete slice: the central visual, one primary
   gesture, its audible consequence, explicit Audio arm, transport behavior when
   applicable, a safe default, and deterministic reset.
2. Keep domain math/state in a pure browser-free module where practical. Keep
   Web Audio, DOM, Canvas, permissions, and device lifecycles at the application
   boundary. Create or resume browser audio from the explicit Audio action,
   except for the documented explicit MIDI-enable and positive WAX-host paths.
3. Make the visual causal. Identity-defining model events and changes should
   have visible sources or state, and meaningful visible edits should change the
   corresponding sound. Continuous input, ambience, and tails may use aggregate
   causal feedback. Avoid independent decorative animation.
4. Establish bounds before adding voices or effects: input clamps, gain staging,
   maximum voices/nodes/events, scheduler lookahead, geometry/DPR budgets, and
   release/teardown behavior.
5. Run the available automated and perceptual checks before expanding the slice
   and preserve a reversible checkpoint. Continue within the requested scope;
   pause for approval only when the user requested a checkpoint or an unresolved
   product choice would materially change the result. If nobody can listen,
   label that boundary and continue with mechanical evidence.
6. Add one capability at a time. New controls need a DSP destination, audible
   min/default/max relationship, visual synchronization, state ownership, and
   focused tests. Presets must demonstrate distinct regions of the sound space
   rather than small parameter variations.

Version persistent preset/state formats when they may outlive the current page
version. Validate and apply migrations transactionally, preserve unknown fields
when the contract requires forward compatibility, and do not serialize live
audio nodes, contexts, clocks, streams, or recording buffers.

When a model has several independently synthesized mechanisms, or its composite
mix obscures the identity of a layer, use an existing solo/debug seam or add the
smallest in-scope laboratory needed to isolate them. Calibrate source, onset,
duration, spectrum, and level independently before judging the composite.

## Integrate and verify

Read [references/integration-checklist.md](references/integration-checklist.md)
when adding, consolidating, renaming, promoting, or removing an instrument.
Complete every applicable surface; a direct URL alone is not integration.

Run focused model/page tests, `npm run verify`, and the applicable Playwright
suites. Then use
[morphazoid-responsive-audio-qa](../morphazoid-responsive-audio-qa/SKILL.md) for
the mechanical layout, input, transport, and lifecycle gate. Follow with
[morphazoid-perceptual-qa](../morphazoid-perceptual-qa/SKILL.md) when audible
identity, control leverage, transition quality, visual causality, listening, or
physical feel is in scope. State explicitly when human listening or
physical-device checks were not performed.

If previewing, use the repository development command, verify the endpoint, and
report the exact URL and worktree. If publishing is requested, confirm the
scoped diff, generated WAX parity, deployment result, and live content. A push by
itself is not proof that the intended build is public.

# Simulation-driven sonification

Use this reference for physical games, moving sound objects, and instruments
with independently controlled actors. These lessons come from the Puggler
development conversation and its implementation/refinement commits `f06dfb0`
and `4700581`; they are one worked example, not a survey of all Morphazoid
history. Keep page-specific musical and visual choices in that page's contract.

## Make one causal interaction convincing

Prove one complete gesture before multiplying objects, actors, modes, presets,
or explanatory readouts. For Puggler that was a visible throw, an airborne sound,
and an audible hand contact. Research should supply an implementable relationship
and its limits: validate rhythmic patterns mathematically, record source/sample
provenance, and distinguish a fictional duet from a documented passing technique.

Expand to the user's requested scope after the first interaction works. Use
presets to make distinct behaviors easy to try; every additional stage label or
metric should help the player act or understand an audible consequence. Preserve
keyboard/accessibility instructions even when visual explanations move to docs.
Puggler's compact control order and removal of stage readouts were specific user
decisions, not a mandate to hide diagnostic data on other instruments.

## Model identity, time, and structure explicitly

| Fragile boundary | Implementation consequence | Useful acceptance scene |
| --- | --- | --- |
| Stable actor ID versus index in the active cast | Ownership, controls, and sound voices keep stable IDs; formation/passing uses active ordering. Compare membership, not just count. | Solo actor 2; casts `[0, 2]` and `[1, 2]`; swap equal-sized casts while objects are airborne. |
| Fast motion versus frame-sized collision checks | Evaluate swept contacts and the actor's position at the same contact time; snap caught objects to the actual hand. | Maximum speed and height, minimum assistance, and a variable frame step around a catch. |
| Caller-owned preset arrays versus mutable live state | Clone mutable configuration at every apply boundary, including live edits and replacement generation. | Apply a frozen/shared preset, replace an object, then confirm the preset and defaults did not change. |
| Phrase boundaries versus future event reservations | Validate whole transitions and resource counts, not only an isolated repeating pattern. Use numeric sequences when throw values exceed one digit. | Several phrase changes, rests/holds, a missing incoming object, queued crowd throw, replacement catch, and re-entry. |
| Physics range versus render projection | Preserve meaningful world quantities; choose an explicit camera/projection for extreme heights rather than silently clipping the simulation. | Maximum tempo, global height, per-actor height and object count together; finite positions and usable actors in the view. |

Intentional difficulty needs a reproducible baseline. A seeded/no-chaos scene can
prove scheduling and collision invariants while separate scenes exercise real
misses, recovery, and the expressive unstable mode. Do not make a test pass by
silently increasing assistance or suppressing failures that the product requires.

## Give events and sustained sound different jobs

Drive percussion from actual model contacts and use the same object's motion for
its continuous sound. Polling a display state alone can miss a short held phase
between audio updates. Consume timestamped events, bound queues, and schedule
attacks against the audio clock; keep rendering independent of event ownership.

When continuous distortion masks contact drums, isolate the layers and inspect
gain staging, transient envelopes, bus compression, and brief ducking. Raising
the master level cannot repair lost articulation. Keep voice identity stable
through live edits, release removed voices, and bound overlapping tails and
replacement events. Sample validation and signal measurements establish
mechanical facts; they do not establish that a mix sounds convincingly punk.

Write a small action/state matrix before wiring transport. Audio arm, pause of
automatic actions, manual gestures, ongoing physics, crowd reactions, mute,
output level zero, visibility, and teardown are distinct decisions. Puggler's
pause stops new juggling throws while flights settle, riders move, and armed
crowd reactions continue. Another instrument may intentionally freeze its whole
simulation. Test the chosen behavior; do not generalize a global `active` flag
across every subsystem without checking the contract.

## Verify integration at the runtime being used

Use the inspection helper to locate source dependencies, dynamic asset
candidates, registry/capability records, and source/WAX copies. Check any new
asset extension and accompanying license files against `scripts/build-site.sh`;
existence in the checkout does not prove a clean release contains it.

For browser audio probes, inspect the page's actual module URLs. A WAX page
loads `dist-wax/src/...`; importing `/src/...` in a probe creates another module
instance and may inspect a different shared audio-manager singleton. Resolve
diagnostic imports from the page's runtime/package location, then verify the
audio output belongs to that page. Confirm the serving worktree and origin
before interpreting a browser result.

Choose focused scenes for sparse casts, live preset edits, maximum simultaneous
voices, swept contacts, pause/manual/crowd separation, pointer cancellation,
hidden teardown, and coarse-pointer transport targets. Run full integration
checks on the resulting source and generated artifact. Record what passed and
what was actually heard or touched; keep push and deployment evidence separate
when publication is requested.

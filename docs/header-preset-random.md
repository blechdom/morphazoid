# Full-instrument preset randomization

**September 23 UI update:** Select Preset → next → dice now lives at the top of
the right control panel. MIDI moved into Settings; the masthead uses a volume
knob. See [Performance toolbar](performance-toolbar.md). The transaction and
randomization rules below remain unchanged; earlier placement notes are historical.

Local implementation on `codex/full-instrument-presets`, September 21, 2026.
Not committed, pushed or deployed. The existing preset banks and earlier
Shape/Hiccup feedback changes are preserved.

## Visible behavior

The first row of the right control panel is now:

**Preset menu → next preset → dice**

The masthead has **Morphazoid → Choose → next instrument → flexible space →
meters → volume knob → Audio → Settings**. MIDI on/off is inside Settings.

The dice is a native button with a monochrome inline SVG. It inherits the
existing Choose next-button surface and sizing, including 48px coarse-pointer
targets. Its accessible name and tooltip are **Randomize instrument parameters**.
Before any explicit preset/dice action the menu reads **Select Preset**, even
when startup settings happen to match a factory scene. The first next-arrow
action loads the first scene. Opening the page never applies a preset.

The icon is decorative to screen readers. Enter/Space activate the button;
arrow keys continue browsing named presets rather than rolling parameters.

Randomization creates a new complete musical configuration and displays
**Preset · Custom**. It does not simply select a random factory preset. Selecting
a named preset afterwards restores that scene normally. Existing independent
body, sequence, skin and other local controls are not removed or relocated.

Dice preserves the performer's output level (including zero), Audio/device state
and live clocks/phases. The owner's subsequent clarification means **every
preset-owned musical parameter participates**, not just a subset varied around
a factory scene. Shape/Solid/Hyper playhead and rotation switches participate,
with at least one motion active; algorithmic loop policy also varies. Other external transport
flags stay outside the snapshots. No preset is applied and no RNG is consumed
during registration or page load. No new permissions or storage writes occur.

## Implemented coverage

The button is now wired into **24 instruments, including all 13 current Faves**, not the
entire catalogue. The table below describes the original randomizer batch;
the [Faves implementation report](faves-preset-rollout.md) covers the twelve
additional adapters and their device/transport boundaries. The remaining
64 non-WIP instruments still need migration.

| Instrument / family | What varies | Important constraint |
| --- | --- | --- |
| Shape | Geometry, readers, head spacing/directions/axes, motion switches/modes/rates, sound engine, envelopes, mappings, FM/PM/Shepard parameters and stereo | Coherent topology/curves; percussion needs corners; at least one motion; estimated crossings capped at 60/s |
| Shapes | Original geometric sound parameters, geometry and independent motion plus dimension, note divisions and trigger-bank mappings | Original adapters, not preset selection; preserve Audio, master and scene levels; runtime voice budget stays outside the snapshot |
| Hiccup Head | All numeric face/effect controls, effect bypasses, voice count/selection/assignments/solos/characters/modulation, skin, rhythm length/notes/rests/accents and timing | Model-owned numeric bounds; valid built-in choices; one sound per step; no camera |
| Creaturazoid | All body/anatomy/tract/morph-bias/modulation controls, body-motion archetype, rhythm length/notes/rests/accents and timing | Derived fields synchronized; existing model bounds; one sound per step |
| Karplus Strong | Every excitation/string/body/coupling/stereo parameter, polarity and tuning field | Bounded decay/drive/roughness/Q/coupling; ordered pitch range and bounded string count |
| Cascading FM / PM | New stage count, root, frequency span, depth and taper | Jointly solve ratio to retain a slow LFO root and low carrier; separate Hz/radian parameters |
| Dijkstra, Hanoi, Minimax, N-Queens, Euclid | Every score/timing/pitch/timbre/space parameter, seed and loop policy | Existing sanitizer/generator; instrument algorithm and master output retained |

Ranges come from instrument-owned parameter specifications, not extrema inferred
from the factory presets. Categorical model/bank/skin selections still use valid
built-in choices, but no full factory snapshot is selected, mixed or mutated.
The bounds are not a guarantee that
every random result is musically desirable or equally loud. Preserving the
output level does not equalize perceived loudness across different timbres.

## Adapter contract for subsequent instruments

`registerHeaderPresets` now requires an instrument-owned
`randomize(snapshot, random)` callback alongside `capture` and `apply`.

- Return a **new, synchronous, finite JSON full snapshot**; never mutate the
  supplied snapshot, factory presets, live application state or audio engine.
- Use the supplied RNG (default `Math.random`) so tests can inject a seed.
- Keep topology, pitch ranges, dependent IDs, loop lengths and one-voice-per-step
  rules coherent. Do not recursively fill every numeric field with random data.
- Preserve output, live clocks and device state. Preset-owned musical switches
  participate; external transport flags remain outside the schema. Schemas exclude contexts,
  evolving clocks/phases, MIDI devices, microphone/camera streams and assets.
- Return the form the existing `apply` adapter will actually capture, including
  sanitized values and correct Custom/source identities for local editors.
- Do not use a random factory choice as the implementation. The shared
  transaction rejects exact factory states and unchanged state.
- Audit every preset parameter for variation. The only intentionally constant
  fields are master level, instrument identity, provenance IDs, Custom markers,
  required curve anchors and derived/contract fields such as biological lock.
  A categorical ID that changes sound/visual behavior is not merely provenance:
  Creaturazoid's body ID also selects motion envelopes, reference scaling and
  palette, so it participates.

`src/site/preset-random.js` supplies only small pure RNG/cloning/monophonic-rhythm
helpers. Instrument/family preset modules own the parameter choices and bounds.
The shared header clones the captured state before generation, validates the
result before applying it, checks exact capture after application, and attempts
to restore the previous snapshot on a failed application. A failure is announced
through the existing status region rather than falsely marking a recall complete.

## Verification and boundaries

The latest combined full-parameter/click-path batch passed **249 checks, with
six skipped**, across 21 direct Node suites. The
full-parameter follow-up adds explicit parameter-variation coverage across all
eleven instruments and nested Hiccup voice fields. It retains the named factory
preset definitions. See [the Shape click follow-up](shape-click-followup.md) for
the separate scheduling/noise-release changes and current verification boundary.

Focused randomization tests cover 64 seeded results plus RNG endpoints for
each of eleven instruments, deterministic repeatability, immutable input and
factory banks, finite/schema-valid output, actual parameter variation, mono
rhythms, zero-output preservation, coherent cascade carriers and instrument
identity. An additional 480 Shape cases cover the four incoming motion states,
randomized motion switches, phase preservation and percussion density.
192 additional seeded rolls per instrument check for unintentionally frozen
musical parameters. Twenty-four short string/FM/PM
reference renders check finite, bounded, non-silent model output.

Shared DOM-fixture tests cover button order/name, Custom state, named-preset
recovery, arrow behavior, failed preparation, incomplete/throwing application,
rollback and teardown. Style tests assert reuse of the Choose surface and touch
size. These fixtures do not measure real browser geometry or sound.

Playwright coverage was extended for dice rolls on all eleven routes, live
Shape/Hiccup/Creaturazoid continuity, keyboard order, phone touch targets,
matching colors and WAX parity. **It has not run**: browser/build execution
remains pending after the earlier approval-service failures. No indirect retry
was used. The full repository gate, WAX regeneration, actual listening and
physical-device checks remain outstanding; `dist-wax/` was not hand-edited.

Evidence and before-change snapshots are under
`test-results/header-preset-random/` and `test-results/full-parameter-random/`.

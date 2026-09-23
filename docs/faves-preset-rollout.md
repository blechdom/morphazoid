# Faves: full-instrument preset implementation

**Historical batch report.** The current registry has thirteen Faves, led by
Shapes rather than the three standalone geometry synths. See
[the active rollout queue](full-instrument-preset-rollout.md) and
[the September 22 continuation](presets-continuation-20260922.md) for current
membership and verification. The implementation counts and pending checks
below describe earlier checkpoints.

**Later update:** Solid/Hyper now have 20 presets each, Shape has 36, and the
implemented total is 345. See [the geometry feedback report](geometry-preset-feedback.md)
for the subsequent browser/audio checks. Counts below record the initial Faves batch.

September 21, 2026 — local source implementation, final verification pending.
Branch: `codex/full-instrument-presets`. No commit, push, main merge or deployment
was performed for this batch.

## Coverage

All fifteen current Faves now have the shared **preset menu → next → dice**
header controls. This batch adds twelve adapters and **156 complete scenes**:

| Instrument | Added full scenes | Main coverage |
| --- | ---: | --- |
| Solid | 12 | Eight solid forms, five sound modes, plane/axis motion, proportions and amplitude envelope |
| Hyper | 12 | Four 4D forms, five sound modes, axis motion, stretch and amplitude envelope |
| Rubix Cube Sequencer | 12 | Original five performances plus new complete cube/camera/read-path/sound/voice-bank configurations |
| Hybrinx | 12 | Four source-model families, host controls, tongue, call contours, timeline clips and modulation |
| Jaw Harp | 16 | Every authored performance style paired with its recommended physical harp and complete mouth/breath/rhythm controls |
| Hyper Rubix | 12 | Puzzle arrangements, sticker gates, read paths, four portable voice types, topology sound and spatial mappings |
| L-system Delay | 16 | Every existing growth preset combined with topology, pitch, mix and input trim settings |
| L-System | 14 | Every grammar, iteration playback modes, traversal, pitch mapping, sound mode and amplitude envelope |
| Graph Delay | 14 | Every existing graph patch plus complete graph geometry, switches, pitch/delay/mix and motion controls |
| Graph Synth | 12 | Every existing graph topology patch, seven sound modes, tuning, ADSR, articulation and attack lanes |
| Automatapoeia | 12 | Both automaton families, seed/rule, row and column sonification, mappings, voices and envelopes |
| Lattice | 12 | Guarded tile families/deformations, scan direction, sound modes, mappings and timed amplitude envelope |

Together with the previous work, **23 regular instruments / 330 full presets**
are implemented. **65 non-WIP regular instruments remain unmigrated.** The
remaining WIP/labs are still deferred under the owner's priority instruction.
This is not a completed all-instrument rollout.

`preset-rollout-status.json` records current per-route implementation status and
counts. Its verification-pending labels are intentional.

## Preservation boundaries

- No synthesis engine, worklet, sample or WASM implementation was rewritten.
  Eight extracted startup/default configurations are checked against a
  pre-change fixture. Registration does not apply a scene on page load.
- Audio, microphone permission, device acquisition, saved banks and live clocks
  remain instrument-owned. Primary Play stays live; separate musical motion
  switches, loop policy and automation settings belong to their scenes.
- Shape's previously requested primary Playhead/Rotate recall remains its
  explicit exception. Solid/Hyper recall their independent axis-motion switches
  but do not press the primary Play control or reset current physical angles.
- Mic-input instruments retain their existing input stream and frozen/paused
  input state. L-system Delay's active pitch renderer/quality tier is a device
  choice, not a preset-triggered graph rebuild.
- Factory puzzle presets use portable native sound paths. WebGPU acquisition
  remains explicit. Existing initialized GPU state can be retained/recalled;
  a preset never silently requests a new GPU/audio backend. GPU-only variants
  are not presented as device-independent factory scenes.
- Rubix complete presets include an in-memory drum bank. Neither recall nor dice
  overwrites the separately saved FM Drums bank.
- Hybrinx replaces only the selected call's session-local editable gesture.
  Other edited calls and the immutable authored call bank remain intact.
- Graph Delay uses its existing bounded graph-replacement/crossfade path.
  Graph Synth retains its player and pulse deadline rather than resetting Play.
- Automatapoeia presets start their specified seed lineage without toggling
  Audio. Evolving generations and accumulated history are not serialized as
  fixed preset settings.
- Puzzle moves, gesture evolution and manual edits may legitimately make a
  scene Custom. The next arrow now retains the last successfully selected
  preset's tour position rather than jumping back to preset one.
- Focused body, sequence, rule, grammar, skin and envelope editors remain local.
  The duplicate Rubix performance selector and Graph preset grids are hidden
  only on migrated pages; their controller targets remain for compatibility.

## Tests and remaining gate

**503 focused checks passed across 41 direct Node suites**, with zero failures
or skips in this selected batch. This is not the full repository/browser gate.

New focused checks cover all 156 records, deterministic parameter randomization,
preserved factory data and muted output, eight original startup configurations,
real menu enum values, Hybrinx gesture replacement, and the actual Solid/Hyper
adapter functions across Audio/Play states. Existing model/audio/control smoke
tests remain required and are run alongside these checks.

Older static tests that expected default literals inside controllers now test
the extracted defaults directly and verify controller wiring. Their original
value/behavior requirements were not relaxed.

The seeded variation audit uses a continuing RNG stream, as repeated dice
clicks do. Arithmetic seeds in a restarted linear RNG were correlated at two
specific draw positions; the test was corrected to assess actual variation
rather than that seed artifact.

The new Playwright suite covers all twelve routes, exact synchronous recall
before generative evolution, permission isolation, dice and factory recovery,
plus representative desktop/portrait/landscape layout and keyboard order.
**It has not run.** The approval service also rejected the read-only inventory
CLI after a sandbox error; no workaround was used for that denied command.
Previously blocked browser/build commands have not been retried indirectly.

Full repository verification, browser checks, WAX regeneration/parity and human
listening are still pending. The earlier reported Shape clicks remain a
listening/reproduction task; this preset batch does not claim to resolve them.

Local before-source snapshots, test logs and the checkpoint are under
`test-results/faves-preset-rollout/`.

## Next active queue

The integration pass corrected an unsupported Hyper Rubix read-path name and
removed Hybrinx's live tongue-clip highlight from serialized preset data. The
editable clip timeline remains fully captured; its current highlight is derived
from playback. A test executes the actual adapter and performance-update function
with the call player running and paused to enforce that distinction.

Proceed through remaining non-WIP registry order: Shape/Solid/Hyper/Graph Drum
Machines, then the combined Apps and remaining regular instruments. Do not
replace native editors with generic slider randomization to mark that queue
complete. WIP/labs remain deferred, not removed.

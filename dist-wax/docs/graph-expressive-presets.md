# Graph expressive presets

Graph Synth has 32 full scenes: its existing twelve followed by twenty expressive
studies. Graph Drum Machine has 34: its existing fourteen followed by twenty
studies. Existing scene IDs, graph layouts and parameter values remain intact.

The additions combine authored launch intervals and edge timings with deliberate
sound contrasts. Graph Synth covers seven oscillator modes, both trigger and edge
articulation, short attacks and long swells, and continuous graph-derived tuning.
Graph Drum Machine covers eight percussion styles and six complete FM kit recipes.
Sparse string/object/rattle studies retain headroom for their physical engines.
Examples include Subterranean relay, Copper fireflies, Orbital foghorns, Basement
pocket, Bronze heptagon and Breathing foundry.

The seed slider now reaches 999 so it can display the authored study seeds
101–424. Node-motion speed uses 0.001 steps to retain the slow 0.025/0.035-cycle
orbits. Native controls and their events remain in place.

## State and compatibility

Graph Drum snapshots use version 2 and include all sixteen voices, identified by
stable FM pad IDs. Each voice owns frequency, attack, decay, modulation ratio and
index, pitch bend, noise, tone and level. Pad labels, keys, families and colors
remain instrument metadata. Capture owns a deep numeric copy; validation rejects
missing/duplicate IDs, incomplete kits, non-finite values and out-of-range values
before applying state. Dice varies every voice parameter using the current FM
Drums bounded kit randomizer as well as the existing graph randomizer.

Versionless published snapshots still validate. Migration fills their missing kit
from the current live voices, preserving their previous behavior. New factory
snapshots carry explicit kits; the original fourteen scenes use the default FM
kit. Recalling a kit does not write the shared FM Drums local-storage bank.

Graph Drum output level, Audio, primary Play, motion phase, scheduled launch time
and active traversals remain live during recall. Graph Synth retains its existing
state ownership, including scene-owned output on recall and live output during
dice. Both instruments keep Audio/Play independent and registration inert.

## Verification

`tests/graph-expressive-presets.test.mjs` checks complete distinct banks, continuous
synth tuning, rhythm and envelope coverage, finite bounded event schedules,
decaying returns and physical-engine event-rate headroom.
`tests/graph-drum-machine-presets.test.mjs` checks exact kit round trips, legacy
migration, invalid-kit rejection, muted pads and per-voice dice coverage.

`e2e/graph-expressive-presets.spec.mjs` checks exact browser recall, paused/live
transport continuity, all forty added scenes with fresh audio contexts, and menu
reachability at 1440×900, 390×844 and 844×390. The shared Faves test additionally
checks all 32 Synth scenes and dice. Automated sound measurements establish finite,
non-silent bounded output; they do not establish listening quality or touch feel.

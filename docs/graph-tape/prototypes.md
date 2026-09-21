# Graph Tape prototypes — September 18, 2026

Four unregistered prototype pages. They are **not** in the catalogue, nav, or
capability registries, and no existing instrument was modified.

Each one targets a gap that `docs/starting-instruments.md` names as missing from
the five existing demos, or a mechanism that `findings.md` measured and killed.

| Page | Gap it fills | The question it answers |
| --- | --- | --- |
| `head-shed.html` | independently positioned play / record / erase heads | does placing and dragging heads feel like playing? |
| `splice-ring.html` | draggable splice points on an intact loop | can a recording become a graph without being cut? |
| `onset-atlas.html` | segmentation preview with an honest readout | what does phrase analysis actually cost you? |
| `synaptic-resonance.html` | a steerable branch decision | can rhythm route the graph where a rotor could not? |

Shared: `src/proto-shell.js` (audio-arming contract and demo material),
`proto-graph.css`, and `src/head-shed-processor.js` (the tape worklet).

## Head Shed

One circular tape. The tape moves and the heads do not, as on real hardware.
Click the ring to add a head; drag around for position, in and out for level;
press `K` to change it between play, record and erase.

- **Erase / hold** is the single control separating a delay from a looper. At 0
  the tape is wiped behind the record head and this is an ordinary multi-tap
  delay; at 1 the erase is defeated and material accumulates, which is what
  sound-on-sound did on an Echoplex.
- **Generation loss** applies saturation per pass rather than a clean multiply.
- **Dry monitor** exists because a looper must always let you hear yourself.
  Lumber Loops ships with this path muted (`lumber-app.js:1334`), and an earlier
  design in this line was killed for the same omission.
- **One play head per lap** is the cheap experiment: with three or more play
  heads, does hearing one per lap read as *sequencing* or as *dropouts*?

## Splice Ring

The recording is never modified. Splices are markers, segments are the spans
between them, chords are alternative continuations, and **Restore original loop**
returns exactly what you started with.

The displayed order period is **measured by simulating the traversal**, not
asserted. Verified behaviour: 4 segments with no chords repeat every 4; adding
one chord with alternation on moves the measured period to 7.

## Onset Atlas

Segments a phrase, merges similar events into families, and proposes a
transition graph — then shows what it will cost before you accept it.

This page exists because of the finding in `findings.md`: deriving a graph from
phrase analysis frequently gives back **less** than was recorded. Measured on
this page's own demo phrase (4 events):

| Distinctness | Families | Measured order period |
| --- | --- | --- |
| 1.10 (merge freely) | 1 | 1 |
| 0.45 (default) | 1 | 1 |
| 0.12 (keep apart) | 2 | 4 |

The warning fires whenever the order period is below the event count. The
tension is real and is stated on the page: repetition creates branching but also
shrinks the graph.

## Synaptic Resonance

Each edge is a synapse with facilitation, depletable resources, a transmission
delay and a base gain. Effective strength is `gain x F x D`, which makes every
edge band-pass in *pulse rate*. Mutual inhibition decides whether a branch point
passes everything or only its strongest edge.

Seven ring steps start strong, barely facilitate, and recover slowly, so they
collapse when hammered. Seven shortcuts start weak, facilitate over a time
constant near a fast inter-pulse interval, and recover quickly, so they only
wake up in bursts. **Tempo is therefore the routing control.**

Measured sweep of average effective strength:

| Pulse rate /s | ring steps | shortcuts | dominant |
| --- | --- | --- | --- |
| 0.8 | 1.05 | 0.51 | ring |
| 1.5 | 1.01 | 0.45 | ring |
| 2.5 | 0.84 | 0.50 | ring |
| 4 | 0.65 | 0.48 | ring |
| 6 | 0.54 | 0.51 | balanced |
| 8 | 0.45 | 0.61 | shortcuts |
| 11 | 0.43 | 0.62 | shortcuts |
| 14 | 0.38 | 0.68 | shortcuts |

Monotonic in both directions with a crossover near 6 pulses per second. This
matters because `findings.md` established that a rotor's period is a topology
invariant and cannot be steered by playing. Here the branch decision is under
the performer's hands.

**Honesty:** a musical model using the standard facilitation/depression form.
Not a claim of biological accuracy, not a neuron simulation, and the
two-dimensional lattice of the referenced audio plugin is not reproduced.

## Verification performed

- All four pages load with **zero console errors** (Playwright, Chromium).
- Audio contract checked per page: pressing **Play** does not arm audio; only the
  **Audio** control does.
- `head-shed` loads its AudioWorklet without error.
- Mechanism checks are the measured tables above.
- `scripts/check-runtime-source.mjs`: 516 modules parsed, 0 syntax failures.

**Not verified:** no human listening pass. Nothing here has been judged for
timbral quality, musical usefulness, or controller feel. `npm run check` cannot
complete in this checkout because `assemblyscript` is absent from `node_modules`,
which is a pre-existing environment gap unrelated to these files.

## Deliberate non-goals

No catalogue, nav, or capability registration. No icons. No presets. No saved
state — every recording is page-local and lost on reload. No microphone input on
Splice Ring or Onset Atlas. No existing instrument modified.

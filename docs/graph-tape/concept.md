# Graph Tape — concept notes

Status: **concept only.** Nothing here is implemented. Dated 2026-09-16.

> **Superseding frame (added after discussion).** An earlier draft of this note
> framed the idea as accumulating per-edge *weights* (conductance, habit, wear).
> That framing is superseded by the one in "The instrument" below: a **branching
> tape** traversed by **heads**, with **rotors** at the nodes. The weight-based
> material is retained further down as an alternative, but it is not the design.
> The rotor/tape framing is better because its state is a visible object rather
> than a hidden scalar, it is deterministic and exactly resettable, and its entry
> gesture — a looper pedal — is one every performer already knows.

## The instrument

**Sing a phrase. Analysis turns it into a graph. Heads traverse the graph on
branching tape, and rotors at the nodes decide which way they go.**

### Where state lives

Today, in Graph Synth / Drums / Delay, **state rides the traveller, not the
place**. A pulse carries values; node turn angles transform what it carries; edge
length spends time. The graph stores nothing — which is exactly why the same path
sounds the same next time. The graph is a pure function of (input, path).

Making it self-aware means moving state into the place. There are two independent
places, and conflating them is what made the earlier draft muddy:

| | What it holds | What changes between passes |
| --- | --- | --- |
| **Node state** | which way out | the **order** — same material, resequenced |
| **Edge state** | what is written on it | the **material** — same order, new content |

### Node state: the rotor

Each node holds a pointer to one of its exits. A pulse arrives, the rotor clicks
forward one position, the pulse leaves by the exit now indicated. No randomness.

This is a rotor-router walk (Propp machine). Properties that matter here:

- **Deterministic** — reset returns exactly to the start state.
- **Eventually periodic** — the configuration returns after a finite number of
  passes, giving long closed phrases rather than drift.
- **Long period from a small graph** — four nodes of three exits each already
  yields dozens of passes before repeating.
- **Visible** — one arrow per node. The state is grabbable.

State per node is one integer. Variations worth having: rotor step size, rotor
direction, and conditional advance.

### Edge state: the tape

The tape transport already exists — edge length -> time *is* distance along tape at
constant speed. What is missing is a medium that holds content, and a head as a
visible object.

| Tape machine | Graph tape |
| --- | --- |
| the strip | an edge |
| tape length | edge length (existing time mapping) |
| tape speed | head speed — new, and it gives pitch |
| splice | a node |
| record head | writes as it travels |
| play head | reads as it travels |
| erase head | runs ahead of the record head at a settable distance |
| multiple heads at offsets | heads on *different branches* |
| reverse | head runs the edge backward |
| multitrack | audio track plus control tracks |
| the loop | does not exist — the graph is the loop, and it branches |

Two consequences:

- **Length and speed decouple.** Duration = length / speed, and speed also sets
  pitch. Dragging a node changes duration; changing head speed varispeeds. Two
  independent gestures where there was one.
- **The erase head replaces the decay constant.** Memory needs forgetting, but on
  a real machine that is a physical object at a fixed distance before the record
  head, not a multiplier. Drag it close for short memory (behaves like a delay),
  far for long memory, lift it off for sound-on-sound infinite layering — which is
  exactly what defeating the erase head on an Echoplex does.

The existing "inherit values as you go" behaviour becomes the **control tracks**:
track 1 audio, tracks 2..n the parameter values written along that leg. Automation
becomes recordable separately from sound.

### The looper gesture, and why repetition is the key mechanism

A normal looper: sing, get a fixed-length loop, layer on top. Here: sing, and
**analysis builds the graph you then play**.

1. Onset detection segments the phrase into events (`detectSyllables` in
   `src/birdsong-analysis.js` already does this).
2. Each event gets features: pitch, duration, spectral centroid, energy.
3. Similar events **cluster into nodes** — sing "da da dee da" and the three *da*s
   collapse to one node.
4. Observed transitions become **edges**: da->da, da->dee, dee->da.

The mechanism that makes it musical:

> **Repetition in the phrase becomes branching in the graph.**

A through-composed phrase with no repeats yields a chain — one path, ordinary
looper behaviour. A phrase that repeats a motif gives that node two or more exits,
a branch point, and now the rotor has something to choose between. How much
structure you sing determines how much the machine can rearrange it. That is
discoverable in about ninety seconds of play.

5. **Playback**: heads traverse, rotors choose. Every sound is the performer's;
   the order is the graph's; deterministic and eventually returning.
6. **Layering**: sing again. New events either match an existing node — which then
   holds *alternate takes* the rotor can also select among — or create new nodes
   and edges. **Layering grows structure instead of stacking density.** That is the
   difference from every looper pedal in existence.

### Relation to Strophe Graph / Nightingale Manifold

Live phrase analysis and offline recording analysis are the same pipeline with
different inputs. `src/nightingale-manifold.js` already does the offline version at
strophe scale. Importing a nightingale-derived graph is therefore a second input
mode on the same instrument, not a separate build. The analysis notes below still
apply.

---

# Appendix: original weight-based framing and supporting findings

Retained for the code findings, which remain valid, and for the alternative
memory models in case they are wanted later.

## Original goal

Two instruments that share one engine, distinguished by *who authors the graph*:

1. **Graph Tape** — you author the geometry; playing it writes the memory.
   The graph accumulates a record of your performance.
2. **Strophe Graph** — a recording authors the geometry *and* the memory,
   via acoustic analysis. The graph is a portrait of someone else's performance.

## The gap that motivates both

Every change to a Morphazoid graph today is authored by the performer. Nothing
the graph does to itself changes it.

Graph Delay is highly mutable — `moveSelectedNode` rewrites node coordinates and
recomputes edge times live, `setEdgeSwitch` opens and closes routes on click, and
17 shape generators reseed the topology. But no state accumulates from *use*. A
grep for visit counts, pass counts, per-edge history, decay, or adaptation finds
nothing. `edgeSwitchEnabled` reads a boolean that only a click or a reset writes.
Run one pulse through an edge or ten thousand and the edge is identical after.

The only repetition-sensitive quantity is the per-lap feedback loss on a
cycle-closing edge, which is a fixed multiplier, not an acquired property.

Consequence: no instrument in the collection has hysteresis. Practice leaves no
mark. That is the opening.

## Architectural facts (verified)

### Graph Delay edges are real signal paths

`graph-delay-app.js` builds, per edge:

```
inputBus -> switchGain -> DelayNode(2.2s) -> gain -> [lowpass] -> nodes[edge.to].sum
```

Nodes are summing gains with a tap and a stereo panner. Turns are handled by an
AudioWorklet (`morphazoid-graph-turns`, `src/graph-turn-processor.js`, tested in
`tests/graph-turn-processor.test.mjs`) doing per-turn pitch.

Two insertion points matter:

- **The `DelayNode` slot.** Anything expressible as "a thing signal passes
  through" substitutes here. This is where a tape/buffer worklet would go.
- **`gain.gain.value` and `filter.frequency.value`.** Already per-edge scalars,
  free to drive from any accumulator. A memory that only moves level and
  brightness needs no new DSP at all.

That split is the main cost fork: memory that *is* signal (expensive, rich) vs.
memory that *shapes* signal (nearly free, still musical).

### Graph Drums and Graph Synth already share an engine

`graph-drums-app.js` and `graph-synth-app.js` are ~232-byte wrappers over
`src/graph-instrument-app.js`, switched by `mode: "drums" | "synth"`. The shared
contract is documented in `../../GRAPH_INSTRUMENTS_RESEARCH.md`. Graph Delay is *not*
on this engine — it has its own 75KB app. Any new graph instrument should decide
deliberately which lineage it joins.

### Nightingale Manifold already builds a graph from audio

`src/nightingale-manifold.js` and `src/birdsong-analysis.js` already do the
audio-aware graph construction, in-browser, with no model and no backend:

- Segments a recording into strophes. Operational definition: "one active song
  bout bounded by a pause longer than the selected gap."
- Extracts 12 MFCCs plus seven spectral, energy, and temporal descriptors.
- Standardized PCA to 3 components gives each strophe a 3D position.
- `clusterPositions` k-means clusters those into **families** (capped at 6).

And it builds **two distinct edge sets**:

| Set | Construction | Meaning |
| --- | --- | --- |
| `similarityEdges` | kNN in descriptor space, `weight = exp(-distance/scale)` | these strophes *sound alike* |
| `sequenceEdges` | consecutive in time, `weight: 1, observed: true` | this strophe *actually followed* that one |

What it does **not** do is play that graph as a signal-flow network. It uses the
graph for route assembly (`assembleStropheRoute`, `assembleAudioSegments`) and
renders through `effective-bilateral-syrinx-v0`. No delay lines, no cycles, no
feedback, no accumulating traversal.

**The missing work is a join, not a build.** Nightingale produces a graph; the
Graph instruments consume graphs. They have never been wired together.

## What an edge could remember

| | Accumulates | Cost | Character |
| --- | --- | --- | --- |
| **A. Tape** | an audio buffer | high (worklet) | edges become sound-on-sound loops |
| **B. Events** | list of (offset, pitch, velocity) that crossed | low | edges become polymetric loops |
| **C. Habit** | transition weights per node exit | trivial | the graph improvises in your idiom |
| **D. Conductance** | smoothed traffic -> gain/brightness | trivial | used routes open, neglected routes silt up |
| **E. Wear** | traffic -> degradation | trivial | overplayed routes fray and detune |
| **F. Heat** | energy deposited, diffusing to neighbours | low | memory bleeds into the neighbourhood |
| **G. Travel** | how far a node has been dragged | trivial | history of handling, not current position |

D and E are the same scalar with opposite sign; a single bipolar
**Growth <- 0 -> Wear** control would invert the instrument's personality.

### A. Tape, in one line

Replace the `DelayNode` with a worklet holding a circular buffer of length
`edge.delaySeconds`. The whole memory mechanic is:

```
buf[i] = buf[i] * retention + input[i] * write
```

`retention = 0` reproduces today's delay exactly. `retention = 1` is a permanent
tape. `0.97` fades over about a minute.

Node dragging then changes tape length, and the semantics are a real choice:

- **Varispeed** — resample stored content to the new length, so dragging a node
  transposes what is stored on its edges. Recommended default; makes the existing
  drag gesture audibly consequential in a new way and gives the instrument a
  signature sound.
- **Re-window** — crop or zero-pad.
- **Wrap** — same content, moved loop point; rhythmic displacement.

Known hazards: feedback cycles with high retention run away, so a per-edge RMS
ceiling must pull `retention` down automatically (the existing compressor and
clipper are not sufficient); and buffer reallocation on drag must crossfade
rather than swap, or it will click.

### B. Events, the cheap version of the same idea

Store per edge a small list of `{ offsetInLoop, pitch, velocity }` for every
event that crossed, where loop length is the edge's own travel time. Because
edge time is already geometry-derived, this yields **free polymetry** — twelve
edges of twelve different lengths phasing against each other — and makes node
dragging a tempo gesture. Engine-agnostic: events can drive the existing Graph
Drums palettes (Drum Bank, Circuit, Rattlesnake, Resonant Metal, Karplus banks).

### C. Habit, the cheapest thing that genuinely knows what you played

Give each node exit a weight; increment on use, decay slowly. Add one **Follow**
control: at 0 routing behaves as today, at 1 the graph picks exits by accumulated
weights and plays your tendencies back at you — not your notes, your habits.
Visual readout: exit weights as arrowhead size.

## Why these are two instruments sharing one structure

Nightingale's two edge sets map exactly onto the memory ideas above:

- `similarityEdges` -> **the geometry.** Timbral distance becomes edge length
  becomes delay time. The graph's rhythm is the recording's own heterogeneity.
- `sequenceEdges` -> **the Habit weights.** Identical data structure to C, learned
  from the bird instead of from the performer.

Which yields the combined gesture: import the nightingale's graph, then play your
own tape onto it. Follow up re-sings its syntax; Follow down improvises inside its
vocabulary; play long enough and your habits overwrite its transition weights, and
you can hear the structure stop being the bird's and start being yours.

## Design decisions the join forces

- **Nodes should be families, not strophes.** Graph Delay caps at 32 nodes; a long
  recording yields far more strophes. `clusterPositions` already computes a
  `family` per strophe, capped at 6. Make the family the node and let it hold its
  member strophes as content. This also matches standard birdsong analysis
  (syllable *types* plus a transition matrix) and gives a playable graph size.
- **Direction.** `buildSimilarityEdges` normalises to `source < target`, so
  similarity edges are undirected, while Graph Delay edges are directed. Either
  instantiate each as a bidirectional pair (cycles everywhere — possibly good,
  since cycle-closing feedback is already handled) or direct them by time of first
  occurrence. This determines whether the imported graph is a resonant mesh or a
  flow.

## Requirements any version inherits

- **A decay.** Memory without forgetting becomes noise within minutes of play.
- **A visible readout.** Edge thickness for conductance, stored events as ticks
  along the edge, a travelling write-head dot. Memory that cannot be seen forming
  reads as the instrument drifting.
- **A non-destructive reset.** Per-edge erase plus global clear; node dragging must
  never silently wipe stored content.

## Honesty boundaries

Nightingale Manifold's existing warning copy is correct and must survive any port:
PCA proximity *suggests* acoustic similarity, only observed sequence edges
represent observed order, and neither is a claim about meaning. "Syntax" here means
the transition statistics of one analysed recording — not birdsong grammar. Do not
describe an imported graph as decoding, translating, or reproducing a species'
communication.

## Suggested build order

1. **Events (B) + Habit (C)** on existing Graph Delay geometry, driving the Graph
   Drums engines. No worklet, no buffers — mostly bookkeeping, and already a
   complete novel instrument.
2. **Growth/Wear (D/E)** — one bipolar slider over two existing per-edge params.
3. **Strophe Graph join** — import Nightingale's families and edges as graph
   geometry plus Follow weights.
4. **Tape (A)** — its own page, where the real DSP risk lives.

Naming follows the existing family convention (Graph Delay, Graph Drums, Graph
Synth): **Graph Tape** or **Graph Loop** for the first, **Strophe Graph** for the
second. Reserve *Mycelium* for a Growth-mode variant if it becomes its own page.

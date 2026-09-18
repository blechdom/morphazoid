# Graph Tape

Concept notes for a looper built on a graph. **The complete Graph Tape design
below is not implemented.**

**September 17 follow-up:** five separate
[starting instruments](../starting-instruments.md) now explore driven phase
locking, two-tape splicing, retaining loops, learned routes, and coupled
resonators. They are bounded prototypes, not proof of the older period-collapse
claims or a full implementation of this graph/tape architecture.

| File | What it is |
| --- | --- |
| [`concept.md`](concept.md) | The instrument: branching tape, heads, rotors, the looper entry gesture |
| [`findings.md`](findings.md) | What was tested and what failed, with measured numbers |

Related: [`../instrument-ideas-2026-09.md`](../instrument-ideas-2026-09.md) — five separate
instrument concepts from 2025-26 research, plus a structural reading of the collection.

## The one-line version

Morphazoid's graph instruments are pure functions: state rides the traveller, not the
place, so the same path sounds the same next time. Making the graph *hold* state — as
recorded tape on its edges, or as routing state at its nodes — is the open idea.

## Three directions

### A — Retention in Graph Delay

A per-edge retain boolean plus a tape worklet replacing `DelayNode`. Graph Delay becomes
capable of sound-on-sound without becoming a sequencer.

- **Gets you:** branching sound-on-sound, which no hardware or software does
- **Gives up:** no rotors, no sequencing, no analysis — still parallel and simultaneous
- **Risk:** low. Feedback, mic input, compressor and clipper all exist and are correct
- **Unknown:** whether tape content survives Graph Delay's rebuild-on-edit

Historical note: a delay is a tape loop with the erase head engaged; a looper is the same
loop with it defeated. This is that one lever.

### B — Lumber Loops + spokes

Rings independent by default; spokes connect them; connecting collapses the composite
period audibly. Drawn as a wheel — rings plus spokes — which keeps the arcs long enough to
carry waveform and state.

- **Gets you:** steerable form. Cut a spoke and the cycle multiplies; add one and it collapses
- **Gives up:** Lumber's simplicity; risks disturbing a working instrument
- **Risk:** high, and gated on the grid question in `findings.md`
- **Survived adversarial review with no fatal flaws** — the only design here that did

Two distinct meanings of "connect", which are different instruments: **material crosses**
(ring A's output feeds ring B's record input — a dub feedback network, which is what Graph
Delay already does) versus **the read point jumps** (a head leaves ring A and continues on
ring B — graph traversal, which is what the rotor idea wants).

### C — Fix Lumber Loops' three gaps

Not a new instrument. Make Lumber do what it looks like it already does:

1. **Dry monitoring** — one gain node; it is currently a hard zero
2. **Draggable heads on the canvas** — heads are drawn but slider-driven only
3. **Duration-preserving length change** — wire the existing OLA resampler in `src/lumber.js`
   to length changes, decoupling period from pitch

Each is independently worth doing, and all three are prerequisites for B.

## Recommendation

**C, then B.** C is small, fixes real defects in a shipped instrument, and everything it
does is needed by B anyway. It also turns Lumber into the experiment — you get "drag a head
around a loop and see how playing it feels" without building anything new.

**A is parallel and independent**: different file, different question.

Before B, decide the grid question. Adding a grid to Lumber to make the composite-period
story work would contradict its free-length identity, and that is a decision, not a detail.

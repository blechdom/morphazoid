# Graph Tape — tested mechanisms and measured results

Dated 2026-09-17. Companion to `concept.md`.

Several mechanisms in `concept.md` were put through adversarial review in which the
critics **simulated** the proposed state models rather than arguing about them. Three
were killed with numbers. This file records what failed and why, so the ideas are not
re-proposed.

## Killed — rotor period is a topology invariant

A rotor-router walk (Propp machine) on a **strongly connected** graph converges to an
**Eulerian circuit**. The eventual cycle length is therefore fixed by the topology,
roughly the edge count. Initial rotor state changes only the transient and the phase.

Measured: 400 random rotor configurations per shipped preset each returned exactly ONE
period value (clearSteps 1, branchChoir 8, layeredGlass 6, haloRing 1, shortcutChorus 4,
hubScatter 2, softMesh 55, islandSignals 2). Swapping adjacent exit pairs at every branch
node — the effect of dragging a node past another exit — moved the period on **zero**
presets.

**Consequence.** "Click a node and watch the form change" is false. Hand-clicking a rotor
moves phase within a fixed orbit.

**The deeper point:** the Eulerian *fairness* property — every edge traversed equally
often, so nothing you record gets lost — is the same fact that makes the period
unsteerable. You cannot have both. Any design wanting a steerable form must either give
up fairness (coupled/carry rotors, non-uniform step, non-strongly-connected topology) or
steer by **editing topology** instead of by clicking rotors.

Head-steps as a control was also measured and is not learnable: softMesh at steps
2/3/4/6/8/12/16/24 gives periods 6/18/66/70/53/6/55/283, and layeredGlass saturates at 6
for every value above 3.

## Killed — deriving the graph from phrase analysis collapses the order

Singing "da da dee da" yields 2 nodes and 3 edges, so the **order period is 3**. A design
advertising 24 was counting alternate *takes* of the same syllable, not distinct ordered
events. The performer sings four bars, sees "Phrase: 24 events", and hears a
three-syllable loop.

Across 4,000 random phrases the order period was **shorter than the number of events
sung in 49.3% of cases** (median exactly 1.00x). Other measured cases: "ABAB" x4 -> 2;
"AABC" x4 -> 4; "ABAC" x4 -> 4; one syllable x14 -> 1.

Layering does not help. The design's own success case was "sing it again roughly the
same, 16/16 matched, 0 new nodes" — and 16/16 matched means zero new edges, so
layer1(16) + same-again(32 events) still gave order period 3. Singing a genuinely
different phrase over the same two nodes moved it only from 3 to 4.

**Consequence.** "Repetition in your phrase becomes branching in the graph" is true but
much weaker than claimed, and **"layering grows structure instead of stacking density" is
false** under this model — it is precisely stacking density.

**The tension that causes it:** repetition creates branching but also creates a *small*
graph. Distinct material makes a bigger graph but fewer repeats. Phrase analysis sits at
the bad end of that trade.

## Rule — a looper must always monitor live input

One design failed partly because output was tape-only: the performer sang into silence
and heard a fragment one lap later. Any design here needs an explicit dry path.

This is not hypothetical. **Lumber Loops ships without one** — see below.

## Verified facts about Lumber Loops

Checked directly in the source, not taken on report:

| Fact | Evidence |
| --- | --- |
| 5 rings maximum | `lumber-app.js:30`; the error string reads "supports 5 rings in this proof of concept" |
| No dry monitoring | `captureMute.gain.value = 0` at `lumber-app.js:1334` — the capture chain is connected to destination only to keep the ScriptProcessor pumping |
| Length change is varispeed | `source.playbackRate` set from `ringPlaybackRate` at `lumber-app.js:561` — **changing a ring's period also transposes it** |
| Heads are not draggable | `headOffsets` auto-distributed as `index / count` at `lumber-app.js:1108`; heads are drawn but slider-driven only |
| Rings never route into each other | confirmed across the audio graph construction — inter-ring connection is genuinely new |
| Recording uses a deprecated ScriptProcessorNode | `lumber-app.js:1327-1331`, not an AudioWorklet |
| Loop length is the performer's release | no bar, grid, or quantisation anywhere in the record path; 30 s ceiling, 0.15 s floor |
| Phase is analytic, not timer-driven | derived from `audioContext.currentTime` against a per-ring anchor; free mode is fully independent and sample-exact |
| Stored audio is already visualised | waveform envelope displaces the ring contour by +/-6.5% of radius |
| Duration-preserving pitch already exists | centre-anchored OLA granular resampling in `src/lumber.js`, unit-tested — the most reusable thing in the file |

## Killed — the LCM story on Lumber as it stands

Independent components multiply periods: rings of 3, 4, 5 give LCM 60 from 12 edges,
where one connected 12-edge graph gives about 12. Rings of 3, 5, 7 give 105 from 15.
Connecting two rings merges the components and collapses the period — which restores a
steerable gesture that rotor-clicking cannot provide.

**But the LCM story needs integer periods on a shared grid, and Lumber has no grid.**
Loop length is whatever the performer's release made it, and phase is relative-to-now,
not grid-relative. Every record, restart and drag re-anchors, landing a ring's downbeat
at a uniformly random sub-step offset. Measured at T = 0.9 s: mean inter-ring flam
225 ms, max 450 ms, with only a **4.4% chance two downbeats fall within +/-20 ms**.

So a coincidence readout provably cannot be built on the current clock without replacing
the anchoring — which contradicts Lumber's free-length identity.

**Open question, unresolved:** whether to add a grid (contradicting Lumber's design) or
abandon the LCM framing. This should be decided before any connection work, not during.

**Also unresolved:** whether a long composite return is *perceptible*. A 105-lap cycle at
4 s/lap is seven minutes. If nobody hears the return, the composite period is
mathematically true and musically fictional, and displaying it would repeat the exact
mistake that killed the phrase-analysis design. Partial alignments along the way may
matter more than the full return.

## Survived

"Lumber Loops: Spokes" — rings independent by default, spokes connecting them, connection
collapsing the period audibly — scored highest and took **no fatal flaws**. It is the only
design in this line of work to survive review intact.

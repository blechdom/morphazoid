# Instrument concept record — September 2026

Status: **concepts only.** Nothing here is implemented. This file preserves a
design session so the reasoning and the sources are not lost. Dated 2026-09-16.

Related: [`graph-tape/`](graph-tape/README.md) holds the Graph Tape concept that grew
out of the structural-gap analysis below and became the session's main thread.

---

## Part 1 — Reading of the collection

154 instrument pages across roughly six families: geometry readers (Lattice,
Spiral, Escher, Solid, Shape), recursive and algorithmic generators,
physical-model creatures (Blowhole, Syrinx, Hybrinx, Digestazoid, Hiccup Head,
the Karplus family), graph and topology instruments (Graph Delay, Graph Drums,
Graph Synth), puzzle sequencers, and the WebGPU/WGSL shader synth stack.

The pattern underneath all of them, per `AGENTS.md`: one causal loop, made
visible — performer state -> visible mechanism -> synthesis change -> audible
result.

The weakest family is science sonification (Atomic Orbitals, Quantum Square
Dance, Entanglement Dance, Gravity Lens, Neural Pulse, Reaction Diffusion,
Chladni Plate), because most of those map a simulation onto a synth rather than
making the physics *be* the instrument.

### Structural gap A — angular properties of the field itself

**First stated too strongly** as "nothing in the repo uses sound's vector or
angular properties." That is wrong. Verified counter-examples:

- Surround for Safety has an orbit mode: `motionPositionAt` drives the source
  around a circle at `orbitRate` rev/s, plus a figure-eight variant
  (`surround-field-app.js`).
- Vector Flight is thoroughly angular: star azimuth, `projectedRadialVelocity`
  feeding Doppler (`vector-flight-app.js:665`), `projectedTangentialVelocity`
  feeding FM index (`vector-flight-app.js:791`).

**Corrected statement, which is sharper:** every angular quantity in the repo
belongs to a *source moving through a field*. None belongs to the field itself.
Both instruments compute the angle and angular velocity of a point relative to a
listener — source kinematics, the same thing a helicopter flying past does. A
wave whose phase front carries angular momentum, with a quantised topological
charge, is categorically different.

|  | Surround / Vector Flight | A spin-field instrument |
| --- | --- | --- |
| what rotates | the source's position | the wavefront's phase |
| parameter type | continuous angle | quantised integer charge |
| stop the motion | rotation stops | the twist remains |
| sideways drift | requires moving the source | emerges from the charge's sign |

### Structural gap B — no memory in the medium

**First stated too strongly** as "Graph Delay and Graph Drums have edges that
don't change with use / fixed topology." The topology is in fact highly mutable:

- `moveSelectedNode` rewrites node coordinates and calls `applyAudioParameters()`
  immediately, so edge times and turn pitches recompute live, mid-flight
  (`graph-delay-app.js:1837`).
- `setEdgeSwitch` opens and closes a route on click (`graph-delay-app.js:1879`).
- 17 shape generators reseed the topology — chain, ring, mesh, tree, dag,
  smallworld, modular, figure8, orbit, bipartite, hub, random, and more — plus
  `nodeMoving` auto-motion that animates the whole layout.

**Corrected statement:** every change to the graph is authored by the performer.
Nothing the graph does to itself changes it. A search for accumulating state —
visit counts, pass counts, per-edge history, decay, adaptation — finds none.
`edgeSwitchEnabled` (`graph-delay-app.js:446`) reads a boolean only a click or a
reset writes. The single repetition-sensitive quantity is the per-lap feedback
loss on a cycle-closing edge, a fixed multiplier rather than an acquired
property.

Consequence: no instrument in the collection has hysteresis. Practice leaves no
mark. This is the gap the Graph Tape work pursues.

---

## Part 2 — Five concepts from 2025–2026 results

Grounded in web research performed 2026-09-16 rather than from memory. Sources
listed at the end. None of these were built.

### 1. Torsion Beam — acoustic spin and the sound Hall effect

**The result.** March 2026: spiral (vortex) sound beams were shown to shift
sideways — the first measurement of a Hall effect for acoustics, with beams
carrying conserved longitudinal spin angular momentum. April 2026: Cornell found
an acoustic Faraday effect, phonons on twisted corkscrew paths in a magnetic
field, evidencing Hall viscosity.

**The instrument.** One vortex beam seen end-on: a spiral phase front with
topological charge L. Dragging L through ...-3, -2, -1, 0, +1, +2, +3... winds and
unwinds the spiral arms visibly. A field control deflects the beam transversely,
and the drift direction flips with the sign of L — so lateral position becomes a
consequence of a topological choice rather than a coordinate you drag. The spin
rate is an audible rotational whirl, not a decorative LFO.

**Why it fits.** Orbital angular momentum is a playable axis nothing else has,
and it is the natural sibling to Surround for Safety: that one places a point,
this one plays the twist. The quantised charge also gives an integer gesture on a
stage full of continuous drags.

**Honesty line.** A spin-field model with correct sign and charge relationships
rendered to stereo or the existing multichannel path. Not a claim of physically
reproducing an ultrasonic vortex beam in a browser.

### 2. Halftime Crystal — a sequencer that refuses your clock

**The result.** May 2026: a time crystal was coupled to an external mechanical
oscillator for the first time, making its motion controllable. July 2026: a
photonic/plasmonic metamaterial time crystal. The defining property is
subharmonic rigidity — drive it at period T and it answers at 2T or 3T, and keeps
doing so when nudged.

**The instrument.** Every sequencer in the repo obeys its clock. This one does
not. Set a drive tempo and a drive strength; the pattern locks to a subharmonic
and *stays* locked while you perturb it, until you cross a threshold and it melts
audibly into an incoherent phase. Visually, a ring of phase dots that either hold
formation through your poking or scatter.

**Why it fits.** The first instrument where the clock is an emergent property
rather than a setting, and losing the lock is the drama. Cheapest of the five —
pure sequencer logic, no new DSP.

### 3. Codabook — navigating a learned animal-call atlas

**The result.** 2026 produced usable latent spaces of animal vocalisation:
Dolph2Vec for dolphin whistles, TweetyBERT for birdsong, sperm-whale clicks
characterised as a combinatorial coda alphabet, and August 2026 work finding
language-like statistical structure shared across birdsong and whale song.

**The instrument.** A 2D embedding map as the playable surface. Dragging through
it does not play back recordings; it drives the physical models already in the
repo (Blowhole's phonic-lip and U-fold paths, Hyper Syrinx, Hybrinx) from the
coordinates. Coda structure becomes a steppable rhythmic grammar, and the space
between two clusters is a morph no animal makes.

**Note.** Nightingale Manifold, discovered later in the same session, is a better
and already-built realisation of this idea's core — a visible, touchable graph
rather than a latent blob, built from classical acoustic descriptors with no
shipped model. See [`graph-tape/`](graph-tape/README.md).

**Honesty line.** A navigable map informed by published call typologies. Not a
translator; interpolated regions are explicitly artistic.

### 4. Mycelium — a network with memory in its edges

**The result.** 2025–2026 work established a standardised method for detecting
electrical signals in fungal mycelia (differential electrodes, Faraday cage,
STFT analysis), confirmed biological origin, and confirmed electrical integrity
and week-long oscillation across networks. Living mycelium behaves memristively:
conductance depends on the history of what passed through.

**The instrument.** Graph Delay with a living substrate. Every edge is a
memristor — route a pulse through it and it becomes more conductive; neglect it
and it withers. Play a phrase forty times and you carve a route through a 32-node
mesh that was in none of the 17 generators, because you did not design it, you
wore it. Hyphae visibly thicken and grey out.

**Status.** This is the concept that led to the whole Graph Tape thread, and it
was **superseded within the session** by a better framing — rotors and branching
tape, where the state is a visible object rather than a hidden scalar, and the
machine is deterministic and exactly resettable. Retained here because the
conductance model remains a valid alternative. See
[`graph-tape/`](graph-tape/README.md).

**Design consequence worth keeping:** if a carved graph persists in the local
bank, you can train a graph, save it, and hand it to someone else — an unusual
thing to be able to do with a delay network.

### 5. Quiet Rule — play the absorber, not the source

**The result.** June 2026: researchers in China found a quantum-inspired sum rule
governing how sound scatters from certain material properties — a constraint on
what broadband absorption is achievable from a given thickness, pointing toward
much less bulky soundproofing.

**The instrument.** Inverted. A broadband source runs continuously and you sculpt
a metamaterial wall in front of it — cell geometry, resonator depth, layer count.
What you hear is the residue. The sum rule appears as a visible budget bar:
deepen a notch at 200 Hz and it provably bulges elsewhere. You compose by
subtraction against a real constraint you cannot cheat.

**Why it fits.** The repo has no subtractive or architectural instrument at all,
and it pairs naturally with Surround for Safety as a room-acoustics counterpart.

---

## Sources

Acoustics and physics:

- New acoustic wave phenomenon discovered — https://phys.org/news/2025-01-acoustic-phenomenon.html
- Study shows spiral sound can shift sideways — https://phys.org/news/2026-03-spiral-shift-sideways.html
- Resolving the spin of sound (Physics World) — https://physicsworld.com/a/resolving-the-spin-of-sound/
- Soundwaves settle debate about elusive quantum particle (Cornell) — https://news.cornell.edu/stories/2026/04/soundwaves-settle-debate-about-elusive-quantum-particle
- Visualizing sound: hidden behaviors of sound waves — https://phys.org/news/2026-05-visualizing-scientists-reveal-hidden-behaviors.html
- Newfound sound wave scattering rule — https://phys.org/news/2026-06-newfound-bulky-effective-soundproofing.html

Time crystals:

- Time crystal connected to a real device — https://www.sciencedaily.com/releases/2026/05/260504154024.htm
- World-first photonic time crystal — https://www.sciencedaily.com/releases/2026/07/260731034131.htm

Bioacoustics and animal communication:

- Dolph2Vec: self-supervised representations of dolphin vocalizations — https://arxiv.org/pdf/2606.12503
- Birdsong and whale song show patterns similar to human language — https://phys.org/news/2026-08-birdsong-whale-song-patterns-similar.html
- Cracking the code of interspecies communication (CNN) — https://edition.cnn.com/2026/06/03/science/animal-interspecies-communication

Fungal electrophysiology:

- Detection of electrical signals in fungal mycelia — https://pmc.ncbi.nlm.nih.gov/articles/PMC12483595/
- Electrical integrity and week-long oscillation in fungal mycelia — https://www.nature.com/articles/s41598-024-66223-6

# L-system lab models

The Parametric Lab and L-system Experiments use copies of the Rust Delay's
performance interface and the same Rust/WASM delay engine. Their independent
grammar compiler lives in `src/instruments/micmic/rust/app/src/lab.rs`, included
by the native and WASM model. Omitting `parameters.lab` preserves the original
Delay compiler and its saved presets.

## Parametric modules

A live bud carries length, duration, pitch ratio, angle, and lineage. Each
parallel rewrite emits a stem and two through six child buds. Child module
length multiplies by `lengthRatio`; duration multiplies by `delayRatio` and
the shared Child time ratio; pitch multiplies by `pitchRatio`. Branch turns
span the shared Angle, with Asymmetry and the per-depth Angle increment.
The condition `length >= minLength` controls rewriting; shorter buds rewrite
to the empty word. This is conditional module rewriting, rather than a
geometric parameter applied to an otherwise fixed character string.

In schematic notation, with branch turns `a_i`:

```
A(l,t,p,a) : l >= minimum -> F(l,t,p) [A(l*r,t*d,p*q,a+a_i)] ...
A(l,t,p,a) : l < minimum  -> epsilon
```

The compiler uses a persistent stem array and a separate next-bud frontier,
equivalent to retaining terminal `F` modules between derivations. The
minimum-length condition is a musical control, not a voice-count ceiling.
Variation applies repeatable, lineage-dependent length/time factors.
Pitch remains continuous; conversion to semitones is logarithmic arithmetic
for the existing playback-rate engine, without scale quantization.

The mathematical basis is Prusinkiewicz and Lindenmayer,
[*The Algorithmic Beauty of Plants*, Chapter 1, sections 1.8 and 1.10](https://www.algorithmicbotany.org/papers/abop/abop-ch1.pdf).
The particular branching and audio mappings here are original instrument
designs, not biological simulations.

## Context and word sequences

The context experiment uses a one-dimensional binary word with fixed zero
boundary symbols and a central initial one. Every production examines both
OLD neighbors before any replacement is committed. The new centre is one
exactly when its left and right symbols differ, otherwise zero. This is the
radius-one XOR context rule (the Rule 90 cellular-automaton interpretation).
Context influence continuously weights the resulting segment lengths and
durations according to adjacent symbols. It does not switch the mathematical
rule at an arbitrary slider threshold.

Thue–Morse uses `0 -> 01`, `1 -> 10`, beginning at `0`.
Fibonacci/algae uses `A -> AB`, `B -> A`, beginning at `A`.
Every substitution is simultaneous. Their complete final words become paths;
symbols select signed turns and continuous length/pitch ratios. These audio
interpretations are artistic mappings. The graphics do not pretend that a
static derivation is gradually growing during playback.

## Penrose and sphinx substitution patches

Penrose mode starts from ten alternating oriented golden triangles around a
centre and applies the actual Robinson-triangle subdivision. Acute triangles
divide into an acute and an obtuse triangle; obtuse triangles divide into two
obtuse and one acute triangle. Split points divide edges by the golden ratio.
Both triangle boundaries, including diagonals, are shown; this is the
triangular representation of a Penrose patch, not a rhomb-only display.
See [Bettencourt, *Penrose Aperiodic Tiling of the Plane*, section 2.3 and
figures 6–8](https://www.cs.toronto.edu/~jessebett/projects/penrose-tiling/Thesis/Bettencourt_Penrose_Tiling_Thesis_2015_reducedsize.pdf).
The implementation was written independently from the subdivision geometry;
no third-party source code or artwork is bundled.

Sphinx mode repeatedly subdivides the actual six-triangle sphinx pentagon
into four half-scale copies, including reflections. In triangular-lattice
coordinates the parent vertices are `(0,0), (3,0), (2,1), (1,1), (0,2)`.
Child placements before dividing all coordinates by two are:

| Reflection before rotation | Rotation | Translation |
| --- | --- | --- |
| Yes | 180° | `(6,0)` |
| Yes | 0° | `(1,2)` |
| No | 240° | `(0,4)` |
| Yes | 180° | `(3,0)` |

These transforms were independently derived by exact-covering the doubled
parent's 24 elementary lattice triangles. Tests verify disjoint coverage,
area conservation, and both chiralities. Mathematical references are
[Lee and Moody's substitution documented by the Bielefeld Tilings
Encyclopedia](https://tilings.math.uni-bielefeld.de/substitution/sphinx/) and
[Huber, Knecht, Trump and Ziff, *Riddles of the sphinx tilings*](https://arxiv.org/html/2304.14388v2).
The instrument produces recursive rep-4 patches, not arbitrary-order sphinx
tiling enumeration or the paper's Monte Carlo interactions.

For both tilings, shared boundary edges are deduplicated. A connected traversal
of the actual vertex/edge graph assigns every edge a parent and path distance.
Each visible admitted edge is one delay voice. Length/path distance controls
time; triangle type or sphinx chirality and orientation control continuous
pitch ratios; position controls pan. The graph determines lineage, but the
DSP remains parallel history readers: there is no inter-tile feedback or
neighbor-coupled audio simulation. Angle rotates the patch; Asymmetry stretches
it; Curls can deliberately warp it away from its exact undeformed geometry.

## Continuity and limits

All compilers emit the existing stable-slot `PoolTarget` contract and run away
from the real-time callback. The engine retains recording history, smooths
target changes, and admits voices according to measured device capability.
No new fixed voice ceiling is introduced. Structural memory checks and
addressability checks precede exponential allocation; unsupported demands
return an error while the previous instrument continues.

Lab derivation count is validated from 1 through 24; it is independent of an
admitted voice count and may terminate early through the explicit length
condition. Full authoritative Rust previews replace the legacy sampled
preview for these pages. Eligibility still follows finite history duration,
decay, and the current device's audio capacity.

Tests cover exact sequence outputs, simultaneous neighbor replacement,
propagation of module values, conditional termination, true tiling geometry,
finite target mapping, connected visual/audio parent coordinates, context
control sensitivity, and a complete 4,095-voice preview. Automated checks do
not establish musical usefulness or live microphone quality; those require
the listening/device pass.

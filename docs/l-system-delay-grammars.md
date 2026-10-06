# L-system Delay grammar exploration

The current Rust Delay adds six grammar families and 36 complete scenes while
retaining the previous 17 grammars and the settings/order of the first 150 scenes.
Every descendant is an actual independent Rust delay target. Resource admission,
recorded history, pitch-rate limits, normalization and mastering retain their
existing behavior. A dense visual does not establish a sustainable device voice
count. Original `/l-mic.html` and synth/drum grammar banks are unchanged.

| Grammar | Rule provenance | Default rewrite passes / painted segments |
| --- | --- | --- |
| Peano weave | *Algorithmic Beauty of Plants*, figure 1.17(a) | 4 / 6,560 |
| Sierpiński arrowhead | Same book, figure 1.10(b), left/right modules renamed X/Y | 7 / 2,187 |
| Quadratic Koch island | Same book, figure 1.6 | 3 / 2,048 |
| Snake Kolam | Official L-studio graphics manual, §3.1, figure 7 | 5 / 5,460 |
| Dekking square curve | Book figure 1.11(b), quadratic Gosper / E-curve | 3 / 15,625 |
| Stochastic shrub | Book §1.7, three weighted F productions | 5 / seed-dependent |

Sources: [Prusinkiewicz and Lindenmayer, chapter 1](https://www.algorithmicbotany.org/papers/abop/abop-ch1.pdf)
and [the authors' L-studio graphics manual](https://www.algorithmicbotany.org/lstudio/graph.pdf).
These are authored transcriptions of mathematical productions; no external
implementation, images or recordings were copied. The Dekking entry is the
published square E-curve, not the separate “Dekking's church” example. Snake
Kolam retains the sourced drawing construction; its pitch and delay mapping is
Morphazoid's artistic interpretation, not a claim about traditional kolam music.

## Repeatable stochastic branching

The stochastic grammar starts with `F`. Every rewritten `F` independently picks
one of these productions:

```
F -> F[+F]F[-F]F    weight p
F -> F[+F]F        weight (1-p)/2
F -> F[-F]F        weight (1-p)/2
```

**Two-sided branches** sets `p`, initially 0.65. The original book uses
approximately equal weights; the control extends that example. Even at zero,
the one-sided productions retain branching. **Branch pattern** selects a
repeatable integer pattern from 0 through 4,294,967,295. **New branch pattern**
changes this pattern; neither control provides an audio excitation or changes
the selected microphone/file/sample input.

Random choices use a fixed hash of the pattern and the full symbol rewrite
lineage. Angle, time ratio, pitch, curls, levels and other continuous controls do
not reroll rules. Full lineage strings provide collision-free segment identity;
the hash only selects productions. Browser preview and Rust compilation use the
same algorithm and productions. Rule edits compile off the audio callback and
use the instrument's existing staged transition.

The capacity estimate follows the selected pattern and weights. It counts the
actual stochastic realization without allocating the largest possible tree,
and caches a bounded set of recent estimates. Sparse realizations can request
more rewrite passes than the all-five-child case. Actual allocation checks
remain independent of this estimate and preserve the previous playable tree
when the requested topology cannot fit memory.

The generations control retains the existing acoustic-generation mapping: the
selected value scales a family's default rewrite passes, and root-to-tip
distance maps into delay stages. It is not a separate animation growth clock.
The first painted segment is the input root, so the requested delay voice count
is painted segments minus one.

Factory exploration scenes demonstrate clear threads, pitch-heavy curls, long
shadows, fast prisms, sparse weaves and no-decay blooms. They preserve live input,
gain, playback and device policy. Mechanical parity checks verify geometry,
identities, delays, pitch rates, panning, gain and pool records; listening and
physical device/touch acceptance remain separate.

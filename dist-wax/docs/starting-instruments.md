# Five starting instruments — September 17, 2026

Reviewed for playback clarity and consistency on **September 18, 2026**.
Each page now has **How it works / listening exercise**, with a concrete first
experiment, a visual legend, control descriptions, keyboard alternatives,
memory behavior, and explicit limits. The preset note below Starting point
explains what to listen for; manual edits show **Custom settings**.

These are separate, playable vertical slices of the graph-tape discussion,
with provisional names. They are listed under **Works in progress**, not promoted
to finished instruments. No catalogue rearrangement or older app replacement
is part of this work. `Tape Worm` remains a provisional name because an unrelated
audio product already uses Tapeworm.

## The five contracts

| Page | Direct gesture | Visible and audible mechanism | Explicit non-goal |
| --- | --- | --- | --- |
| `tempo-tantrum.html` | Drag or nudge an orbiting bead | Phase perturbation and frequency detuning change crossings of three driven oscillators | Not quantum time-crystal physics, not clock division plus random jitter |
| `tape-worm.html` | Drag splice gates, click a tape | One reader changes between two source recordings with a 12 ms crossfade | Traversal never overwrites recordings; no graph inference |
| `loop-soup.html` | Hold, overdub, spill, erase a region | Three tapes retain and transform stored samples | Fixed three-loop topology; no head-routing sequencer |
| `habit-habitat.html` | Teach node sequences, then Recall | Bounded learned transition strengths bias a seeded walk | No audio recording; recall never reinforces itself |
| `hollowphonic.html` | Deepen or strike a chamber | Three coupled, damped waveguides interfere with a fixed source | No claimed material accuracy or acoustic sum-rule budget |

All ship with original synthesized demo material. Audio must be explicitly armed;
Play, a pointer, or a stage key cannot create/resume an audio context. Before first
arming, a lightweight silent model follows transport. After arming, the selected
engine runs in an AudioWorklet: graphics follow its snapshots, never the other
way around. Audio Off ramps the output down but retains transport and tape state.
It stops any microphone stream and finalizes an active tape recording.
In Loop Soup, a running overdub can still evolve while Audio is muted; use Pause
to stop tape motion or Hold to protect a bowl. Before the first Audio arm, the
silent preview advances positions but does not simulate ongoing overdubs.

Controls and presets do not remove capabilities or reset the transport.
**Reset controls** resets the selected engine's parameters and recoverable phase
state, preserving recorded audio and learned route memory. Explicit clear/demo
actions ask before replacing material. Reload/navigation discards unsaved audio.
Loop Soup's Reset retains Hold states; Habit Habitat resets to Recall without
erasing weights; Hollowphonic resets to noise with bypass off. Tape Worm returns
the reader to Tape A without replacing either recording.

## Is one of these the full graph looper?

**No.** These are five contrasting mechanism studies, not the large editable
graph-tape instrument described in the design discussion.

| Current page | What exists | What does not |
| --- | --- | --- |
| Tape Worm | Two recordings; one read head; linked OUT/IN gates; file replacement and microphone capture | Add/remove heads, independently moving record heads, free graph geometry, phrase analysis |
| Loop Soup | Three fixed loops; retained samples; Hold/Overdub; fixed cyclic spill; erase brush | User-sized first loop, repositionable heads, editable edge topology |
| Habit Habitat | Six fixed nodes; manual transition teaching and recall | Audio analysis, recorded tape, movable geometry |
| Tempo Tantrum | Three driven oscillators and phase perturbations | Recording and graphs |
| Hollowphonic | Three coupled resonating chambers | Looping, recording and graph inference |

Outside this set, **Lumber Loops** is closest to the "big loop" part: up to five
recorded rings and up to four playback heads per ring, with head-offset sliders.
It is not a graph of tape splices and does not have draggable record heads.
**Nightingale Manifold** can analyze an imported recording into strophes and
similarity/succession graphs, but it is not a live record-head tape machine.

### A possible next instrument, not implemented here

The requested graph looper deserves its own first-loop-first interface:

1. Record the first phrase as one continuous, intact loop.
2. Add independently positioned playback, record and erase heads.
3. Drag splice points and connect segments while keeping the recording intact.
4. Optionally propose segmentation using onset sensitivity and minimum segment
   length; propose family groupings using a similarity threshold and node limit.
5. Preview and accept the proposed graph; always retain the original loop and
   an undo route. Similarity grouping must not delete individual occurrences.

That would join several demonstrated mechanisms, but it is a separate build.
No current control labelled Record performs automatic segmentation or clustering.

## Tempo Tantrum: emergent event timing

The classical phase reduction is authored here, in cycles rather than radians:

```text
driver' = f
body[i]' = f/q[i] * (1 + detuning[i] + K sin(2π(driver - q[i] body[i])))
q = [2, 3, 4]
```

The preferred ratios are chosen, but **the attack times are not scheduled by
dividing driver ticks**: every body integrates continuously and triggers only at
its own phase crossing. A stable relative phase is possible for constant
parameters when `|detuning| < K`. Outside this interval the relative phase slips.
The “in step” indication is measured from relative phase velocity after a settling
period, not inferred just from a preset's name or coupling amount.

Drive tempo spans 40–240 BPM; coupling is 0–0.9; global detuning is −0.6–0.6;
individual radial edits add up to ±0.45. A phase nudge displaces one body without
resetting the others. Four presets include stable, near-threshold, weakly driven,
and slow-recovery regions. The model is deterministic.

This is inspired by the *behavioral question* in `graph-tape` and
`instrument-ideas-2026-09.md`, not a reproduction of either cited continuous
time-crystal or photonic-crystal experiment. Those are distinct physical models:
DOI `10.1038/s41467-025-64673-8` and `10.1038/s41586-026-10825-9`.

## Tape and microphone boundaries

Tape Worm holds two mono recordings of at most 12 seconds each. File decoding is
explicit and uses an already armed context. Files larger than 40 MB are rejected;
longer decoded clips use their first 12 seconds, with a visible notice.
Microphone capture uses the worklet, not ScriptProcessor. Short captures and
cancelled permission requests preserve the previous tape. Source audio is
page-local and is never uploaded.
Splice and head edits only change read locations.

Loop Soup has 0.75, 1.2 and 1.8 second buffers. Each overdub revisits a cell once
per tape cycle and writes a softly saturated sum of retained audio, new input,
and the previous sample from a neighboring loop. Each cell is bounded to ±0.9.
Hold does not write any cells. The erase brush is interpolated along skipped
pointer positions. Source and time domains differ intentionally from Tape Worm.

Monitoring is optional and explicitly labelled for headphones. It is a separate
output mix, never implicitly fed back into recording. Audio Off, pagehide,
cancelled permission requests, and device loss release owned media tracks.
Microphone input never starts merely from a preset, Play, or file selection.

## Habit and cavities

Habit Habitat stores a 6×6 transition table (no self routes), with weights 0.25–12.
Teach strengthens only consecutive manual node choices. Recall samples a mixture
of uniform and learned probabilities using a seeded xorshift generator. Save/load
stores only this table in a versioned browser-local record. Forgetting leaves a
small baseline so a route remains possible.

Hollowphonic uses three fractional-read delay lines with loss and a convex
identity/cyclic-neighbor coupling matrix. The matrix cannot amplify its input
norm; each reflection coefficient stays below one. Direct and delayed paths
interfere, producing the heard spectral residue. Independent strikes excite the
same lines rather than a separate cosmetic drum sound. Noise, drone, silence, and
mic are distinct source choices. Bypass compares the source against the wall.
Changing depth changes the delayed read position (varispeed during the move).

## Integration and limits

- Five distinct pure model modules; only lifecycle, DSP utilities and rendering
  helpers are shared. All runtime remains static browser JavaScript.
- One selected worklet, bounded voices/tapes, 20 Hz state reports, capped canvas
  resolution, and independent audio-clock processing during UI stalls.
- Stage keyboard: left/right selects, Enter activates, 1–6 activates an object,
  up/down edits applicable geometry. Labelled native controls provide alternatives.
- MIDI input note-on activates the corresponding object; generic control mapping
  and transport are provided by the existing shared adapter. No MIDI output or
  hardware-controller fidelity is claimed.
- WAX is generated through the existing build. Real DAW audio capture is a host
  verification boundary, not implied by browser microphone tests.
- Icons are original vector/code illustrations, rendered to WebP without an image
  generation service or third-party source imagery.

Model, worklet and browser acceptance tests accompany the implementation.
Automated signal checks do not substitute for listening, real microphone,
controller or physical-phone evaluation.

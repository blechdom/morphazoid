# Graph Delay Rust

`graph-delay-rust.html` is an independent browser instrument alongside Graph
Delay. It preserves the directed graph model, signed incoming-to-outgoing turn
pitch, edge switches, geometry-dependent delays, sink-only output and real
feedback cycles. The original Graph Delay remains available.

## Comparison with the other graph instruments

| Capability | Graph Synth | Graph Delay | Graph Delay Rust |
| --- | --- | --- | --- |
| Sound source | Triggered synthesized notes | Live microphone / line input | Microphone / line, local files, built-in samples |
| Graph shapes, node dragging and node motion | Yes | Yes | Yes |
| Random graph / Random positions / Arrange | Yes | No dedicated actions | Yes |
| Draggable input terminal and input motion | No; seed-note controls | Yes | Yes |
| Clickable and keyboard-operated connection gates | Yes | Yes | Yes |
| Signed turn-dependent pitch, edge/distance delay, feedback, wet/dry | Note pitch and propagation controls | Yes | Yes |
| Pulse/tempo, MIDI/QWERTY notes, synth envelopes and tuning | Yes | Continuous audio effect | Continuous audio effect |
| Network limits | 32 nodes; internal note scheduling/voice limits | 24 nodes / 192 turn routes | 64 nodes / 512 prepared turn voices maximum; initial budget 384 |
| Live voice cap, audio protection and capacity probe | Internal note protection; no live cap or probe | No | Yes |
| Drawing and audio engine | Canvas / note synthesis | Canvas / Web Audio node graph | WebGL2 with Canvas fallback / Rust WASM AudioWorklet |

The Rust instrument retains the original Graph Delay's graph interactions and
musical controls. Random graph, Random positions and Arrange add the graph
performance shortcuts from Graph Synth. Synth-specific note generation remains
specific to Graph Synth; Graph Delay processes incoming audio continuously.

The comparison follows the [Graph Synth page](../src/pages/graph-synth.html)
and [shared graph instrument](../src/families/graph/graph-instrument-app.js),
the [original Graph Delay page](../src/pages/graph-delay.html), and the
[Rust instrument controller](../src/instruments/graph-delay-rust/graph-delay-rust-app.js).

## Live graph controls

Input sits directly below the presets, followed by the open Play section with
Random graph, Random positions, graph shape and six compact sound knobs.
The lower Motion section groups each circular node/input Play/Pause button
beside its path selector, with tempo, Tap and travel controls directly below.
Motion tempo is
shown in BPM (0.6–240), with one path cycle per beat; random walks use that rate
as drift speed rather than a repeating beat. Existing presets retain their
original motion speeds. Pitch shift displays
semitones per 180-degree turn. Edge time, feedback, distance time, wet and dry
sit alongside it. Live cap remains visible immediately below Play. Live data,
input selection, topology generation, detailed pitch/time controls and motion
settings expand separately. All musical sliders use compact shared drag knobs;
native arrow-key controls and preset synchronization remain available.

- **Random positions** moves the existing nodes and retains every connection,
  gate and delay history. With node motion running, the new layout keeps moving.
- **Arrange**, under Topology, restores the generated layout for the current
  shape, seed and node count, keeping connections and gates. It pauses node
  motion so the restored layout stays in place; input motion continues.
- **Random graph** chooses a shape and randomized size, density, seed
  and positions within the preparation budget. It retains pitch, timing, mix,
  source playback, motion clocks and live cap. The existing graph transition
  handles the structural change. The preset dice remains the separate action
for randomizing the complete musical scene.

Preset dice keeps an open backbone to each reachable output. Its node-pass
range is sampled across a complete path, so a long chain does not accidentally
multiply a moderate gain into near-silence. Other gates remain randomized.

Graph actions arriving during an asynchronous graph preparation or capacity test
wait for it to finish. Repeated layout actions retain the latest choice. These
controls never arm Audio.

## Audio and drawing

A single AudioWorklet runs a graph-specific Rust WebAssembly kernel. It applies
pitch to each incoming/outgoing turn before summing outgoing sends; merging
sources before this step would lose Graph Delay's junction behavior. Delayed
sources are read before new writes so cycles have a causal sample history.
The implementation carries over L-system Delay Rust's shared input histories,
110 ms overlapping pitch grains, near-unison bypass, smoothed controls, bounded
preparation, sample-clock processing and separation of graphics from audio.
The L-system feed-forward tree engine is not a substitute for a cyclic graph.

Browser scenes admit up to 64 nodes, 256 delayed edges and 512 turn voices,
versus the original 24 nodes and 192 routes. The initial preparation budget is
384 voices. Dense generated graphs reduce connection density to fit the complete
routing matrix and history budget; they never drop an arbitrary end of the
matrix. Each network also has a 256 MiB memory ceiling. Large graphs at high
sample rates may be rejected while retaining the current scene.

Live cap changes how many prepared turn voices process audio, with a smooth
release/re-admission that retains delay histories. Admission favors complete open
paths to the output. Zero removes the manual cap.
The cap applies per graph; an old and new graph can overlap during transitions.
Protect audio additionally lowers admission when actual audio callback load
approaches its deadline. It restores known capacity after transient overloads,
then probes higher admission in bounded steps when headroom returns. Routine
callback overhead does not block recovery. New topologies receive a fresh,
bounded admission decision; changing a sound knob does not reset protection.
The retiring graph retains its previous automatic ceiling, so fresh admission
does not reactivate a large outgoing graph during the new graph's warmup.
Turning Protect audio off leaves the manual cap in control. Drawing first reduces its
cadence and detail when reported audio load rises.

Live data separates requested, prepared, eligible (open-gate), processing and
live-limit counts. Processing includes fading voices and the retiring graph;
transition work is shown explicitly. Audio load is callback processing time
relative to the block deadline, with average/peak and observed late callbacks.
GPU time uses timer queries when supported; otherwise it says Unavailable.
Graphics reports main-thread drawing time and actual frame rate. Neither timing
readout claims whole-device CPU/GPU utilization or physical sound-device dropouts.

The visible count describes processing turns, not distinct audible notes. Each
input-to-output path can cross several turns, and their signed pitch shifts can
cancel. Live data separately shows fully shifted turns (at least 1.2 semitones
locally); smaller shifts blend with the near-unison path. Graph output still
comes only from sink nodes. A cap below the shortest complete output path can
therefore silence the wet signal: Island Constellation needs at least 35 turns.
The cap readout warns about that condition and about closed output paths. It
also identifies protection reductions and the old graph playing during warmup.

Wide Canopy, Woven Glass and Island Constellation use stronger pitch mappings
and less dry signal than their initial Rust versions. The original 14 patches
retain their settings. Input energy is still normalized at junctions, so adding
routes does not imply more loudness. Both feedback sends and the summed output
reject DC at 10 Hz before limiting; repeated downward shifts can otherwise
accumulate subsonic energy and consume the audible signal's headroom.

Capacity tests use a disposable worker and the same Rust kernel, preserving
current playback. Select a preparation budget and test the generated candidate.
The probe admits every prepared candidate voice regardless of the live cap,
opens its copied gates and raises muted gains, fills the complete delay history,
stresses near-unison turns with pitch, and
measures three trials at the audio context's sample rate. A median load at or
below 45% passes, reserving headroom for overlapping graphs. A passing test
applies its preparation budget; an unsuccessful protected test retains the
current graph. Disabling Protect audio explicitly allows a manual overload
trial. A budget cannot fit fewer voices than a topology's essential paths.
The most recent tested scene is a workload observation, not a permanent device
maximum: geometry, sample rate and other applications affect cost. The playing
graph keeps its original gates and gains throughout the probe.
Graph edits during measurement invalidate the result; Panic cancels the worker.

WebGL2 draws connections with instanced ribbons and arrows, using measured
per-edge and per-node audio activity. A lightweight Canvas overlay retains
labels, switches and pointer/keyboard gestures. Unsupported or software GPU
contexts use Canvas; context loss also falls back without replacing the audio
engine. `?renderer=webgl2` forces GPU rendering for diagnostics, and
`?renderer=canvas` exercises the fallback. Canvas resolution and drawing detail
are bounded.

## Playing and lifecycle

Input provides the same Mic / line, local Audio file and 34 Built-in samples as
L-system Delay Rust, using its shared recorded-input loader and credited assets.
Enable microphone capture explicitly with the header input toggle, independently
of Audio; it can be metered while output is off. Selecting Mic never requests
permission. File decoding may prepare the engine while Audio is off, but playback
starts only after Audio is armed. Files accept up to 64 MiB and the first two
minutes; recorded input has loop, restart and stop controls. The shared input
toggle meters and starts/stops the selected source. All sources pass through the
same Rust processor and input trim. Drag a node or the input terminal, use arrow keys
on the graph to move the selected node, or use brackets and Enter/Space to
select and toggle a connection. The existing 14 graph patches are joined by
Wide Canopy, Woven Glass and Island Constellation.

Presets preserve input selection, recorded playback and loop policy, input gain,
output level, microphone permission, Audio state, the live cap, Protect audio and
motion clocks. Structural replacement prepares a new network, keeps the old
scene audible through the new path's delay and pitch-history warmup, and then
crossfades for 300 ms. Very long chains can retain the old scene for up to
140 seconds before fading; another topology edit queues behind that transition.
Parameter and gate changes update the existing histories. Live pitch, timing
and mix controls also reach the previous sounding graph and queued graph while
the incoming graph warms up, without cancelling the structural transition.
Geometry and gates remain associated with their own topology.
Panic clears audio and releases input. Leaving or hiding the page releases
capture; returning does not silently arm output. The browser engine does not
claim WAX audio-bus support.

## Building and checking

```sh
npm run build:graph-delay-wasm
npm run check:graph-delay-wasm
cargo test --manifest-path src/instruments/graph-delay-rust/rust/Cargo.toml
node --test tests/graph-delay-rust-*.test.mjs tests/graph-delay-capacity.test.mjs
npx playwright test e2e/graph-delay-rust*.spec.mjs
npm run build:wax
npm run verify
```

The committed WASM and source-hash manifest allow browser deployment and CI
validation without installing Rust. Rebuilding needs the
`wasm32-unknown-unknown` Rust target. GPU drawing, PCM behavior, admission,
resource cleanup and layout can be tested automatically. Musical quality,
real microphone feedback and touch feel still require listening and devices.

The audibility regression checks include real WASM PCM during long transitions,
Protect recovery with nonzero callback overhead, DC rejection under strong
downward feedback, and 2,000 seeded random scenes retaining open output paths.
The large-preset pitch mappings were characterized with 173, 233 and 440 Hz
inputs, including 40-second feedback renders. These measurements establish
signal behavior, not subjective sound quality; a human listening pass remains
necessary.

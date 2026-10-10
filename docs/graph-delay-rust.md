# Graph Delay Rust

`graph-delay-rust.html` is an independent browser instrument alongside Graph
Delay. It preserves the directed graph model, signed incoming-to-outgoing turn
pitch, edge switches, geometry-dependent delays, sink-only output and real
feedback cycles. The original Graph Delay remains available.

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
approaches its deadline, then restores voices slowly when headroom returns.
Turning it off leaves the manual cap in control. Drawing first reduces its
cadence and detail when reported audio load rises.

Live data separates requested, prepared, eligible (open-gate), processing and
live-limit counts. Processing includes fading voices and the retiring graph;
transition work is shown explicitly. Audio load is callback processing time
relative to the block deadline, with average/peak and observed late callbacks.
GPU time uses timer queries when supported; otherwise it says Unavailable.
Graphics reports main-thread drawing time and actual frame rate. Neither timing
readout claims whole-device CPU/GPU utilization or physical sound-device dropouts.

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
Parameter and gate changes update the existing histories.
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

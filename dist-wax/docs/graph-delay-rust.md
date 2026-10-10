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

Browser scenes admit 64 nodes, 256 delayed edges and 384 turn routes, versus
the original 24 nodes and 192 routes. The DSP ABI has a hard 512-route ceiling;
the browser uses 384 to reserve more CPU for overlapping scene transitions.
Dense generated graphs reduce connection density to fit the full routing matrix
and history budget. These are resource bounds, not a promise that every device
can sustain the maximum. Each network also has a 256 MiB memory ceiling;
large graphs at high sample rates may be rejected while retaining the current
scene. Graph details show audio
load and late-block observations. Drawing reduces its cadence and detail when
reported audio load rises.

WebGL2 draws connections with instanced ribbons and arrows, using measured
per-edge and per-node audio activity. A lightweight Canvas overlay retains
labels, switches and pointer/keyboard gestures. Unsupported or software GPU
contexts use Canvas; context loss also falls back without replacing the audio
engine. `?renderer=webgl2` forces GPU rendering for diagnostics, and
`?renderer=canvas` exercises the fallback. Canvas resolution and drawing detail
are bounded.

## Playing and lifecycle

Enable the microphone input separately from Audio. Microphone input can be
metered while output is off. Drag a node or the input terminal, use arrow keys
on the graph to move the selected node, or use brackets and Enter/Space to
select and toggle a connection. The existing 14 graph patches are joined by
Wide Canopy, Woven Glass and Island Constellation.

Presets preserve input gain, output level, microphone permission, Audio state
and motion clocks. Structural replacement prepares a new network, keeps the old
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
node --test tests/graph-delay-rust-*.test.mjs
npx playwright test e2e/graph-delay-rust.spec.mjs
npm run build:wax
npm run verify
```

The committed WASM and source-hash manifest allow browser deployment and CI
validation without installing Rust. Rebuilding needs the
`wasm32-unknown-unknown` Rust target. GPU drawing, PCM behavior, admission,
resource cleanup and layout can be tested automatically. Musical quality,
real microphone feedback and touch feel still require listening and devices.

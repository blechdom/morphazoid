# Volumetric Rain Rust kernel

Dependency-free `no_std` Rust DSP, with `f64x2` Wasm SIMD. The source
retains the `garden_` ABI names for the existing page URL. JavaScript in
`../dsp.js` is a numerical reference and limited compatibility renderer.
Both use f64 state and arithmetic, then write f32 stereo output. SIMD groups
sums in a different order, so waveform tests allow floating-point rounding.

```sh
rustup target add wasm32-unknown-unknown
node scripts/build-wasm-garden.mjs
node --test tests/wasm-garden-dsp.test.mjs
```

Stable Rust is sufficient. `build-manifest.json` records compiler, flags and
SHA-256 digests. `RUSTC` can select another compiler. No Cargo dependencies,
allocator, imports, shared memory or memory growth are used. The shipped
artifact needs Wasm SIMD; the page falls back if it cannot compile.

## ABI v1

`garden_state_ptr()` points to 16 header doubles followed by fourteen
32,768-element double arrays: real, imaginary, damped cosine, damped sine,
left/right gains, four ramp deltas, and four targets. Header entries 0–2 are
active count, target count, and ramp frames remaining. The adapter validates
capacity in addition to the ABI version, rejecting obsolete artifacts.

`garden_output_ptr()` points to 2,048 left f32 samples followed by 2,048 right
samples. `garden_process(frames)` returns the count or zero for an oversized
request. Fixed memory is **4 MiB**; mode capacity and block capacity are separate.
One thread owns an instance; processing is synchronous and non-reentrant.

The kernel processes mode pairs in eight-sample tiles, retaining their state
and coefficients in registers across the tile. Tiles split at ramp boundaries.
Odd mode counts preserve the inactive partner's memory. All loads stay within
the even-sized allocated lanes. Per-sample coefficients and gains ramp over
8 ms; removed modes fade before their workload is released. A line between
damped rotations remains in the unit disk. Wide retunings can damp old tails.

The page prepares transcendental coefficients outside the audio thread. The
adapter applies targets/deltas without recomputing trigonometry. The resonance bank orders modes across its frequency band and strikes all of
them. In the optional tine model, modes are interleaved across 32 objects;
`mode % 32` selects one, and a strike visits only that object’s modes. Rendering still visits the full active bank, including silent tines;
32,768 is an extreme workload, not a promise of universal real-time performance.

See `docs/wasm-garden.md` for model assumptions and measured performance limits.
Tests cover reference waveform agreement, odd counts and partial blocks,
prepared targets, ringing transitions, bounded maximum load, deterministic reset,
contact rates and provenance. They do not claim musical quality or no dropouts.

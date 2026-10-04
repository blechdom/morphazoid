# L-system Delay browser Rust ABI

The topology Worker and AudioWorklet instantiate the same import-free
`l-system-delay.wasm`. The Worker compiles the unchanged native grammar model;
the Worklet reuses `l-system-delay-core::Engine`, the native mastering DSP,
performance validation and adaptive admission controller. CPAL remains the
native device adapter and is not compiled into this browser target.

Build with `node scripts/build-l-system-delay-wasm.mjs`. Check committed bytes,
source hashes, import/export lists and ABI using the same command with `--check`.
The check requires Node only. Run host DSP tests with
`cargo test --release -p l-system-delay-wasm --manifest-path src/instruments/micmic/rust/Cargo.toml`.

## Ownership and control calls

All pointers are offsets into exported `memory`; `usize` is `u32` in WASM.
`lsd_alloc(bytes)` returns eight-byte aligned, zeroed storage, released with
`lsd_free(pointer, originalBytes)`. Refresh JavaScript memory views after every
control operation that can grow memory. Never retain a view across memory growth.
Handles from `lsd_compile` and `lsd_new` require their matching free/drop call.
Invalid controls return zero and retain the previous sound; latest error bytes
are available through `lsd_error_ptr/len`.

`lsd_compile(parametersJSON, bytes, sampleRate)` runs in the Worker. Its handle
exposes JSON (`lsd_compile_json_ptr/len`) and a binary pool
(`lsd_compile_pool_ptr/len`). Copy both before `lsd_compile_free(handle)`.
The JSON has native parameter/count fields, grammar generation limits and a
connected preview of up to 2,049 nodes including the original trunk. The full
binary pool contains every requested voice; preview size does not cap audio.

The binary pool is little endian. Its 32-byte header contains six `u32`s:
magic `0x4c534431`, version `1`, voice count, eligible count, revision low word,
revision high word; then one `f64` wet normalization. Each 48-byte record
contains `f64` delay, playback rate, raw generation gain, and pan; then `u32`
priority rank, original branch phase seed, generation group, reserved zero.
Ineligible rank is `0xffffffff`. The browser assigns a coherent revision before
transferring the pool to the Worklet.

`lsd_new(sampleRate, initialCapacity)` creates forty seconds of mono history;
one initial reserved slot suffices. `lsd_install(engine, pool, bytes)` validates
and prepares storage outside processing, then copies numeric controls into the
persistent pool. Growth preserves recording, existing grain phases, delay
crossfades, gain ramps and output conditioning. `lsd_performance` accepts the
native full performance JSON, including mastering. `lsd_strike` preserves the
optional native seed source for legacy scenes; microphone input is the default.

## Processing and telemetry

`lsd_process(engine, inLeft, inRight, outLeft, outRight, frames)` renders
1–128 samples. `inRight=0` copies mono input. Buffers may not alias each other or
the engine. The call allocates and frees nothing. It performs input gain/freeze,
55 Hz default input cleanup, history recording, two-grain variable-rate delay,
selected-voice normalization per generation, wet/dry mix, output filters,
compression, six-millisecond lookahead, ceiling and smoothed output level.
Input freeze smoothly writes silence while recorded delay tails continue.
Native 20 ms parameter ramps and 65 ms fixed-read-head retiming remain unchanged.

The host times rendering and calls
`lsd_observe(engine, processSeconds, frames, underrun)` with measured DSP cost.
Accumulate coarse timer costs across blocks before observing. Admission starts
cautiously, probes additional requested voices, rolls back missed deadlines and
retries; it has no preset numeric ceiling. Explicit performance `voiceCeiling`
remains an optional user limit. The complete requested pool is allocated before
voice admission. Growth/preparation must stay outside `lsd_process`.

`lsd_metrics_ptr` addresses 26 `f64`s in this order:
sampleRate, activeVoices, targetVoices, voiceLimit, installedCapacity,
requestedTargets, cpuLoad, peakLoad, inputPeak, outputPeak, outputLeftPeak,
outputRightPeak, gainReductionDb, deadlineMisses, elapsedSeconds, wetBusGain,
topologyRevision, automatic, source (1 mic/0 seed), calibratedVoices (0 when no
separate calibration), envelopeCount, envelopeEndTime, envelopeInterval,
processedBlocks, underruns, overruns. `lsd_metrics_len()` returns 26.

`lsd_taps_ptr/count` exposes bounded `f32` tap energies paired with `u32` indices
at `lsd_tap_indices_ptr`. `lsd_generations_ptr` exposes 256 `f32` group energies;
`lsd_generation_counts_ptr` exposes 256 `u32` admitted counts.
`lsd_envelope_ptr` exposes a 4,000-element `f32` ring; chronological sample `i`
is at `(lsd_envelope_offset(engine)+i)%4000`, for
`i<lsd_envelope_count(engine)`. Its interval and latest audio time are exposed
through `lsd_envelope_interval/end_time`. Every timestamp advances from samples,
independent of drawing or UI stalls.

WASM address space and actual browser allocation failures bound memory, not a
fixed voice-count constant. Browser scheduling and timer precision can change
the admitted count. Pool preparation can be expensive on very deep trees;
processing itself remains allocation-free. These mechanical tests do not
establish microphone listening quality or reliable throughput on every device.

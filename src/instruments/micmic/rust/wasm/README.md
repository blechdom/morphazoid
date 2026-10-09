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

`lsd_new_calibration(sampleRate, initialCapacity)` creates a separate Worker-only
renderer, released with `lsd_drop`. After installing the candidate pool and
enabling its complete eligible membership, call
`lsd_prepare_calibration_history(engine)` before measuring DSP cost. It fills the
forty-second recording history without advancing the sample clock, so long delay
heads perform their actual history reads during calibration. Ordinary `lsd_new`
handles reject this operation and retain their live recording. Calibration
renderers must never be used as the live instrument.

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

For a device-proved complete scene, call `lsd_install_begin`, then
`lsd_install_scene_admission(engine, 1)` before incremental `lsd_install_step`
calls. The flag is staged with the pool: preparing or aborting it does not change
the playing scene. Commit admits every prepared eligible voice together, subject
to the current depth and explicit performance ceiling; the normal gain attack
still applies. The caller must prove the candidate pool fits the device budget
before requesting this policy. No numeric voice-count ceiling is introduced.

This policy holds membership during unchanged playback. Real overload still
reduces it immediately, and reduced membership stays fixed until a new proved
scene commits. Depth or manual ceiling restores return to the current scene's
safe membership in one update. Committing at zero depth preserves the full
structural plan for a subsequent depth restore. `lsd_capacity_hint` records
capacity for future scenes without expanding a playing bounded scene, including
after a backoff. The flag defaults to zero for each staged installation; omitting
it or using synchronous `lsd_install` restores legacy adaptive admission. These
exports are additive; ABI version 1 and the 26 metric fields are unchanged.

`lsd_install_depth(engine, depth)` stages a finite depth in `[0, 1]` on a pending
version-2 pool without changing the playing scene. Use it before install steps
when a gesture changed recursion while the Worker was compiling. Later live
`lsd_depth` calls still override that pending value in command order. Rejection
or abort preserves the old gains and recording; omitting the staged depth keeps
the compiled pool's authored depth. It rejects ordinary calls without a pending
installation, unsupported legacy pools and invalid values.

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
Accumulate coarse timer costs across blocks before observing. Legacy admission
starts cautiously, probes additional requested voices, rolls back missed
deadlines and retries. Complete-scene admission instead holds its proved
membership and retains deadline protection. Neither policy has a preset numeric
ceiling. Explicit performance `voiceCeiling`
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
`lsd_active_indices_ptr/count` borrows the exact `u32` slots visited by DSP,
including real release tails until retirement. Its count equals `activeVoices`
when read in the same synchronous snapshot; it is independent of tap-meter
capacity. Read pointer/count without intervening controls or rendering and copy
before the next mutation or memory growth. The AudioWorklet transfers an owned
copy, so neither inactive prepared slots nor stale meter energy determine the
visible live membership.
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

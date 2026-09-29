# Volumetric Rain

Metallic resonances overlap and decay. A corrugated surface bends with their
ringing energy, while random strikes vary the position and brightness.

## Play

Turn on **Audio**, then press **Play** or drag the surface to strike it.
Moving along the lower edge changes excitation position; moving toward the
far edge raises spectral emphasis. Arrow keys adjust these coordinates;
Enter strikes. The orange cross is your contact point, and white marks show
automatic strikes.

**Reset** selects **Metal** and centers the contact at 42% position / 65%
spectral emphasis. Volume, Audio, and playback keep their current settings.

The preset menu, **Next**, and **Random** sit above Play/Pause and Rain rate.
Random creates new parameter settings; preset changes preserve playback and Volume.
Pause stops new strikes while the existing resonances decay.

## Sounds

| Sound | Character |
| --- | --- |
| Metal | Ringing resonance with a moderate decay |
| Glass | Bright, long ringing |
| Damped | Low, short impacts |
| Dense | Overlapping, sustained resonance |

**Tines** offer individual mallet, pick, and scraper contacts.

## Shape the sound

- **Metal** scatters the tuning; **Density** sets the number of resonances.
- **Root** sets the lower frequency. **Pitch spread** widens or narrows the range.
- **Ring** sets decay time; **Brightness** changes the balance of upper frequencies.
- **Rain rate** controls automatic strikes, up to 2,048 per second.
- **Random excitation** varies position and spectral emphasis. **Sweep** moves
  across the surface; **Selected position** repeats at your contact point.
- **Weighted chance** favors a spectral region. **Spectral focus** sets the peak
  of that probability, and **Chance width** ranges from one region to equal odds.
  Contacts still excite the whole resonance bank; this does not select one pitch.

Weighted spectral emphasis spans 20–90%, avoiding unusually strong, aligned
attacks at the endpoints. Manual contact covers the full surface. Tine presets
instead use weighted chance to choose an individual tine. Their fundamentals
span 0–4 continuous octaves, without scale quantization.

## Volume and graphic

**Volume** spans 0–100% and starts at 80%. It applies linear gain up to 1.2;
the bounded synthesis keeps final peaks below 0.96. Presets and Reset leave
Volume unchanged. L/R meters show the actual post-volume peaks from −60 to
0 dBFS. Audio starts off and is armed separately from playback.

The metal is visible while silent. Thirty-two energy groups drive its slow
bending and highlights; Density changes the corrugation detail. Pointer picking
follows the visible surface, including its bending. The graphic illustrates
ringing energy; it is not a measured plate vibration or a 3D acoustic simulation.

## Synthesis and capacity

The bank uses logarithmically spaced, damped resonators with stereo scatter.
Each strike excites all active resonances. Metal uses 256 resonances, an 82 Hz
root, 3.2 s decay, and a 40:1 pitch range. Parameter changes ramp over 8 ms.
Seeded random contacts are reproducible; live edits preserve the clock and seed.

The tine model uses 32 individual bodies. Its partial ratios interpolate toward
`1 : 6.267 : 17.548 : 34.386`, ideal cantilever flexural ratios, with detuned
satellites. Material names and contact weights are synthesis approximations.

Rust `f64x2` SIMD renders up to 32,768 resonances in fixed 4 MiB memory.
The separate output-buffer limit is 2,048 frames. Coefficients are prepared on
the page thread; repeated spectral focus reuses a 256 KiB ridge cache. Dense
random strikes use a Gaussian recurrence, re-anchored every 64 modes to limit
rounding drift, instead of evaluating an exponential for every resonance. Graphics
are bounded to a 64×24 mesh, 30 frames/s, and 1.8 million pixels.

Maximum density and rate are device dependent. Lower Density or Rain rate if audio breaks up.
Compatibility playback is capped at 1,024 resonances when Wasm is unavailable.

[Reference waveforms](https://github.com/blechdom/morphazoid/blob/main/tests/fixtures/wasm-garden-original.json) cover the four
resonance presets, with 512 stereo checkpoints each. DSP tests compare output
within 1e-7 and also check bounds, timing, and transitions. Browser checks cover
controls, graphic interaction, volume, meters, and responsive layout.

## Rust and browser audio

This instrument runs Wasm directly in AudioWorklet. CPAL provides Rust audio-device
I/O; CLAP specifies a native plugin interface. Neither is a DSP accelerator.
Native `.clap` files require a separate browser hosting path such as WCLAP.

`node scripts/build-wasm-garden.mjs` builds the kernel using stable Rust and
`wasm32-unknown-unknown`. The build manifest records source and artifact hashes.
Normal site builds need no Rust installation, shared memory, or isolation headers.

References: [CPAL](https://github.com/RustAudio/cpal),
[CLAP](https://github.com/free-audio/clap),
[WCLAP](https://github.com/Signalsmith-Audio/wasm-clap-browserhost),
[AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet),
[Rust Wasm SIMD](https://doc.rust-lang.org/core/arch/wasm32/index.html).

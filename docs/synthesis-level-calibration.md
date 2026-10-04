# Synthesaurus factory level calibration

424 presets were rendered through the production Rust/WASM engine at 48 kHz, velocity 0.8, using their complete audition gate and release. Browser levels below include the settled master of 0.7.

Fixed per-preset trims target -12 dBFS core on max(K-weighted 400 ms RMS, K-weighted 100 ms RMS − 3 dB). The 100 ms term avoids over-boosting brief attacks. Core sample peaks are capped at 0.78 (-2.2 dBFS), below the emergency knee of 0.8. The method fallback is the median preset trim.

24 particle-shaker, FDTD-membrane and FDN-resonator presets also use low-trim raw-peak references and actual final-trim verification at 44.1 and 96 kHz. Their trim is bounded by the largest peak across the three rates. The extra-rate maximum is 0.779999, with 0 presets touching the knee. K-weighted scoring remains at 48 kHz.

For the particle shaker, each of the three rates also uses 16 deterministic silent-idle offsets to vary the collision RNG state. Sustained shake is held for 8 seconds. The largest reference peak bounds the fixed trim, and the worst-peak state at each rate is rerendered at that trim. These are sampled bounds, not guarantees over every possible random sequence.

The gain is constant for each preset. It does not follow the envelope, lift a decaying tail, or remove velocity differences. Peak headroom takes priority over matching the loudness target.

Verification: 0 nonfinite samples; 0 presets touching the emergency knee; 0 touching its ceiling. 164 presets are limited by peak headroom. 0 never cross −48 dBFS over a 10 ms browser-output block.

K-weighted RMS is an energy measurement, not integrated LUFS or proof of perceptual audibility. The worklet duplicates one channel; ungated dual-mono momentary loudness would be 2.319 dB above the reported K-weighted RMS.

| Percentile | Browser score, dBFS | Browser K400, dBFS | Browser peak, dBFS |
|---|---:|---:|---:|
| 0% | -32.2 | -32.4 | -17.3 |
| 10% | -20.6 | -21.9 | -11.5 |
| 25% | -16.8 | -17.8 | -9.7 |
| 50% | -15.1 | -15.1 | -6.9 |
| 75% | -15.1 | -15.1 | -5.3 |
| 90% | -15.1 | -15.1 | -5.3 |
| 100% | -15.1 | -15.1 | -5.3 |

## Comparison with the preserved baseline

Median browser K400 changed from -21.1 to -15.1 dBFS. The median paired lift is 6.0 dB. The central 80% spread changed from 3.0 to 6.8 dB.

This includes source corrections and fixed trims. The browser master remains 0.7. Presets never reaching −48 dBFS over a 10 ms browser block changed from 0 to 0.

## Quietest measured auditions

| Method / preset | Trim, dB | Browser K400, dBFS | Browser 100 ms RMS, dBFS | Browser peak, dBFS | Peak constrained |
|---|---:|---:|---:|---:|---|
| particle-shaker / Separated pebble clicks | 20.6 | -32.4 | -31.3 | -15.1 | yes |
| karplus-strong / Palm-muted string | 16.8 | -32.0 | -26.2 | -5.3 | yes |
| particle-shaker / Sparse beads | 24.7 | -27.9 | -27.8 | -10.0 | yes |
| window-formant / Short broad burst | 15.6 | -29.8 | -27.8 | -5.3 | yes |
| vosim / Damped packet knock | 8.6 | -29.1 | -23.6 | -5.3 | yes |
| chebyshev / Falling-index pluck | 18.8 | -28.0 | -24.0 | -5.3 | yes |
| fdn-resonator / Long low resonator | 29.3 | -25.3 | -21.2 | -5.6 | yes |
| fdn-resonator / Short wooden box | 26.1 | -27.9 | -22.7 | -6.7 | yes |
| phase-vocoder / Fast compressed phrase | 10.1 | -24.7 | -22.0 | -5.3 | yes |
| modal / Dry wooden block | 22.8 | -27.1 | -21.1 | -5.3 | yes |
| pulsar / Sparse low knocks | 13.7 | -24.1 | -23.9 | -5.3 | yes |
| bytebeat / Self-AND pattern | 20.6 | -24.0 | -14.3 | -5.3 | yes |
| vosim / Gapped vocal rhythm | 8.2 | -23.7 | -22.4 | -5.3 | yes |
| pulsar / Chaotic bass grain | 14.7 | -23.6 | -24.2 | -5.3 | yes |
| fof / Dark formant thud | 30.5 | -26.5 | -19.6 | -5.3 | yes |
| granular / Fine sand | 12.4 | -23.5 | -23.1 | -5.3 | yes |
| dpcm / Encoded noise burst | 25.3 | -26.2 | -19.6 | -5.3 | yes |
| fdn-resonator / Few coupled delay tones | 24.5 | -26.1 | -20.1 | -5.3 | yes |
| fdn-resonator / Weakly coupled echoes | 26.0 | -24.5 | -23.5 | -5.3 | yes |
| single-sideband / Large shift splinter | 16.6 | -25.8 | -23.7 | -5.3 | yes |
| corpus / Bright fragment strike | 13.6 | -25.8 | -20.7 | -5.3 | yes |
| rossler / Z projection spikes | 18.5 | -22.6 | -21.5 | -5.3 | yes |
| fdn-resonator / Dense dark cloud | 30.2 | -25.0 | -23.2 | -5.3 | yes |
| physical / Balanced elastic bar | 13.4 | -25.3 | -17.5 | -5.3 | yes |

## Provenance

- WASM SHA-256: `070760c01717912a486ca78ffa0f76bdb50a4b5d225293bef8ae2c05bad54da3`
- Signal fixture SHA-256: `536fb43772b0492dd048ba277be3be9badd33888f3a3055c3e25170d89475100`
- Fixture hashing includes method/preset IDs, normalized parameters, frequency and envelope. It excludes calibration trims, descriptive copy and output master, avoiding a circular calibration dependency.
- Full source hashes, all before/after metrics, explicit onset thresholds and baseline comparisons are in the adjacent JSON report.
- Reproduce with `node scripts/calibrate-synthesis-levels.mjs`; rebuild the WASM after engine changes, then regenerate calibration. Use `--baseline FILE` to attach a preserved earlier audit.

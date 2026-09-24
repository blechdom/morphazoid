# Shapes: conditional controls and Morphazoid sound banks

Implementation base: `41c7239` (current remote main at the start of this pass).
This changes Shapes, not the original Shape/Solid/Hyper engine menus. Rubix's
native drum recipes are extracted for reuse; its sound/mixer behavior is retained.

## Contract

Reader/shape motion remains the source of pitches and crossing times in 2D,
3D and 4D. Continuous voices, full Notes ADSR tails, manual takeover, subdivision
caches and explicit Audio arming remain intact. No tuning quantization is added.
No manual parameter range is narrowed to make novice presets safer.

## Conditional controls, not removed settings

| Control | Shown when | Hidden values |
| --- | --- | --- |
| Shared profile / Sides | 2D or the 3D/4D shared-profile prism | Retained for return to that representation |
| Star depth | An applicable star profile with more than two points | Retained for other forms |
| Character | Simplified Continuous FM, PM or Shepard | Retained for other engines/models |
| FM index/ratio | 2D FM; 3D/4D FM **and PM** | Retained when hidden |
| FM source | 2D FM | Retained for PM |
| PM depth/ratio/source | 2D PM | Retained for FM/higher dimensions |
| Shepard turn mapping/glide | 2D Points, closed contour; glide only in Turn mode | Retained; existing sound mapping falls back to travel when incompatible |

The 3D/4D PM implementation intentionally uses the shared FM/PM index and ratio,
so those controls must not be hidden in those dimensions. Pure tests compare
actual geometry and voice-spec sensitivity; browser tests verify visibility and
round-trip values. The interface no longer clears stored Shepard Turn mapping
merely because another reader is selected.

## Tonal engines

Sine, Triangle, Square, **Saw**, FM, PM and Shepard are available in Continuous and
Notes. Saw uses a PolyBLEP edge correction in the AudioWorklet, a native sawtooth
fallback and a separate adaptive voice-budget profile. Switching to/from the new
waveforms fades through zero. Preset/dice saw levels use the existing square-wave
starter cap; manual output, pitch and envelope ranges remain unchanged.

## Trigger banks

- **Rattlesnake:** existing live membrane/FM engine and morph/character mappings.
- **Soft FM kit:** Rubix's gentler recipe, preserving the saved `fm-kit` ID.
- **Analog drums:** Rubix sine/triangle bodies and shaped noise.
- **Modal drums:** Rubix's short damped partials.
- **Noise percussion:** Rubix filtered bursts with low-body support.
- **Mallets / Pitched Morph:** existing marimba/xylophone/kalimba morph engine.
- **Karplus–Strong:** existing muted/nylon/kalimba/rubber string morph engine.

The prepared banks reuse existing Morphazoid DSP, not substituted recordings or
new approximations of named engines. Sample drums and SIMD 303/chiptune are not
part of this patch. Rattlesnake remains the default and its dense factory scenes
remain available. The bank now has 117 factory scenes: seven additions (two saw
scenes and five new-bank scenes); all new banks also participate in dice.

## Preparation and resource boundaries

The six non-Rattlesnake banks render 16 mono voices before joining playback.
Buffers have level/peak normalization and trimmed, faded tails. At most two banks
are cached. Karplus and mallets use useful base registers, with continuous
geometry-derived transposition; Character depth changes the per-hit filter.
Kit assignment still chooses by feature, position or incidence.

Live triggers perform no rendering, decoding or fetch. The adapter schedules on
AudioContext time, rejects stale attacks, caps active hits at 64 and starts at
128/second with a 24-hit burst allowance. Per-crossing gain normalization,
concurrency scaling, compression and bounded final output protect dense mixes.
Manual takeover cancels only unstarted hits; stop/mute releases active hits.
Cancelled/superseded preparation cannot rearm Audio or overwrite a newer bank.
Preparing a cold bank may take a moment; visual transport continues and there is
no attempt to replay missed events when preparation finishes.

## Validation and listening boundary

- Model tests cover all fixed versus shared-profile forms, FM/PM applicability,
  hidden-state preservation, old bank IDs, factory/dice coverage and trigger
  scheduling/release/budgets.
- Worklet tests cover saw DC/level bounds, alias reduction, full note tails and
  waveform transitions. Native fallback is tested separately.
- Browser matrix covers desktop `1440×900`, phone-sized `390×844` / `844×390`,
  every bank in all dimensions, Audio-off behavior, bank preparation/switching,
  output bounds, saved state and manual/touch takeover.
- Offline comparison isolates two metallic FM bodies (noise disabled) and compares
  raw RMS and level-independent adjacent-sample energy. It is not a whole-kit
  listening judgment.
- `docs/shapes-sound-banks-runtime-changes.json` reverses only this feature's exact
  edits before the existing frozen relocation proofs. The shared Rubix recipes
  are also checked against their pre-extraction source.

No human listening approval or physical iPhone pass has occurred. Phone-sized
browser tests do not establish real-device CPU headroom or perceptual quality.

### Completed checks — 2026-09-24

- `npm run verify`: 4,194 passed, 6 skipped; source/Wasm/XYFlow checks and clean WAX parity passed.
- Expanded Shapes browser matrix: 192 passed (all 117 factory recalls/audio scenes included).
- Additional cold-preparation cancellation and original Rubix all-bank checks: 2 passed.
- `npm run build:site`: passed (209 pages).
- `git diff --check`: passed.

Verified preview: `http://127.0.0.1:3449/shapes.html`, served from
`/home/blechdom/creative/morphazoid-sound`. Source HTML checksum was compared with
the HTTP response.

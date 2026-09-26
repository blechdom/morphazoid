# Rubix: the visible surface is the mix

All six logical faces keep sequencing, including the far side. Turning the view
does not reassign a face to a different instrument or restart its score.
Rows and Snake advance all faces together. Alternate faces divides each beat
into opposite pairs: up/down, front/back, then left/right.

The selected bank plays every face. Color selects the sound; the X faces retain
the complementary drum mapping, while Y and Z faces use the first mapping.
Twists change the sticker arrangement at the committed quarter-turn. During a
drag or animation the original score continues, and the moving surface mixes it.

Play/Tempo and Swing sit directly below Select Preset, followed by Twists/Speed and a compact Read path menu (Rows, Snake, Face pairs). The circular transport buttons follow Shape’s controls. The circular restart-arrow button returns the loop to step one. Visibility dynamics uses the same plain slider styling as the other performance controls. The passive step strip, engine-status strip and Visible score panel are omitted; the cube remains the live score display.

## Visibility and dynamics

Rubix measures the same projected triangle fans and back-to-front paint order
as its Canvas renderer. It clips to the stage and subtracts nearer painted
sticker surfaces **and plastic bases**. Overlapping triangles count only once.
This matches the rendered surface, not a claim of physically exact 3D occlusion.

With Visibility dynamics at its default 100%, gain is proportional to uncovered
screen area, normalized to the largest currently visible sticker. The optional
0% setting gives visible stickers equal gain. Hidden stickers are always zero.
The mapping follows live rotation and twist previews, including existing tails
and attacks already scheduled ahead of time. Gain transitions take 12 ms to
avoid abrupt discontinuities.

The mix uses attack-energy-matched drum buffers, a -24 dB threshold, 5:1 soft-knee
master compressor, fixed 2.8× makeup gain (about +9 dB), and a bounded safety
shaper before the output slider. The fixed makeup restores working level after
compression. It is not automatic gain control and never turns up a hidden face.

**Output, 303 level and Kit level belong to the performer, not the presets.**
Both performance presets and SIMD sound presets preserve all three controls,
including zero/mute. Reset sound remains the explicit reset of sound settings.
Different spectra and articulations can still differ in perceived loudness;
unchanged sliders do not imply identical loudness.

Morphix Drift now selects **SIMD / Morphix bloom** instead of the much quieter
Classic patch and no longer reduces 303 level or Output on recall.

## Sound banks

The original Soft FM, Analog, Modal, Noise and 303 banks remain. Three additional
banks reuse the larger application's actual `LinearDrumAudio` synthesis:

- **Rattlesnake · Modal + FM:** membrane partials, FM body and impact noise.
- **Mallets · Pitched Morph:** marimba/xylophone/kalimba partial families.
- **Karplus Strong · plucked:** short muted/string/tine resonators.

Drum voices are rendered locally to short reusable buffers before switching
banks. These are synthesized attacks, not downloaded recordings. Only the nine
mapped voices are cached per kit, and baked trailing silence is trimmed. The
old drum kit and transport continue during preparation; completed banks
crossfade without restarting the clock. The browser's OfflineAudioContext is
required for kit preparation.

Classic 303 uses independent per-sticker attacks. **SIMD 303 is the default
303 engine**, replacing the WebGPU option. It uses the larger app's actual
`simd-303-simd.wasm` kernel (or the scalar Wasm fallback), with six dry face
voices in one 128-frame AudioWorklet.

### SIMD sound presets

The **SIMD sound** selector changes timbre only. It preserves the cube's
arrangement, shape, size, view, read path, tempo, playback phase and performer
volume. Editing a tone control marks that sound Custom without constraining it
to the preset.

| Sound | Starting character |
| --- | --- |
| Color circuit | Dry saw acid with color-dependent accents |
| Rubber corners | Low, rounded square bass |
| Silver facets | Short, resonant saw accents |
| Wooden square | Hollow odd harmonics |
| Pulse prism | Nasal pulse articulation |
| Glass wire | Upper-partial, triangular ringing |
| Warm diode | Broad driven body with opening envelopes |
| Morphix bloom | Full sustained acid for warped forms |
| Original SIMD sweep | The previous SIMD patch and its independent filter LFO |

The eight new sounds keep the existing color pitches and add repeatable
color-dependent filter, resonance and articulation differences. They disable
the autonomous filter LFO and the legacy transport-position spectrum morph:
the sound no longer needs to drift independently of a stationary cube.

Drawn sticker height, depth and warped radial extent now add live filter
movement, and screen X balances stereo. These are explicit artistic mappings,
not a physical acoustic simulation. The same actual projected geometry used for
drawing supplies these values; changing shape or orbit therefore changes the
tone as well as the area mix. Sticker modulation controls their depth. Tone
changes smooth over 20 ms, independently of the 12 ms visibility ramp.
Original SIMD sweep retains the previous mapping without the extra live tone
layer, so the earlier sound remains recoverable.

There is no GPU device, chunk queue, or 250 ms buffer-priming wait. The page
requests playback 12 ms ahead; one shared worklet clock renders notes, applies
swing to whole beats, alternates face pairs, and publishes the display playhead.
Visibility changes reach the next processed block and use the same 12 ms gain
ramp as the drum mix. Score and timbre edits update atomically
without restarting SIMD playback. Rendering and UI stalls do not own the note
clock. This describes internal scheduling, not measured device-output latency.

Hidden faces retain their logical clock phase; the worklet skips their dry DSP
when their live gain reaches zero. Delay and chorus are disabled so an old
sticker cannot leak through a later sticker's gate. Missing SIMD instructions
use the scalar Wasm kernel. Missing AudioWorklet/Wasm support or a failed engine
falls back to Classic Web Audio, not to WebGPU. Leaving the bank, Audio-off and
page teardown cancel in-progress Wasm loads and disconnect the worklet.

## Limits and verification

- Size remains 2×2 through 6×6; one logical attack per face per step, with at most
  192 active source nodes and 1.8 seconds per cached drum attack.
- Percussion gates are keyed by sticker and bank, remain bounded by the cube
  and bank count, and are disconnected on size changes and Audio-off.
- Audio begins off. Play, orbit, twist and keyboard gestures never arm it.
- Musical attacks use the audio-clock scheduler, not animation frames.
- Audio-off/page teardown release the context, gates, cached buffers and SIMD
  resources.

`tests/rubix-mix.test.mjs` exercises all-face score invariance, clipping,
occlusion, folded-fan unions, live-gate smoothing/cleanup and gain normalization.
`tests/rubix-simd.test.mjs` exercises the actual Wasm
kernels for scheduled onset, scalar fallback, grouped swing, live area gain,
phase-preserving edits and teardown.
`tests/rubix-simd-presets.test.mjs` renders each sound and color through the real
SIMD kernel, checks non-level timbral differences, tests geometry-to-tone and
stereo direction, and verifies hidden silence and supported cube sizes.
`e2e/rubix.spec.mjs` exercises real browser output, bank switching, rotating
gates, all five forms, desktop/phone sizes, preset/volume continuity, Morphix
Drift audibility, all cube sizes, maximum-level protection and an offline
sustained-note gain measurement. The SIMD browser checks run with GPU access forbidden. Automated
evidence is not approval of timbre, click quality or
physical touch feel; those require a human listening/device pass.

Live Tempo/Swing edits send small timing messages instead of rebuilding all six face scores. SIMD Swing takes effect at the next long/short beat-pair boundary, retaining the current note and oscillator/envelope state. Repeated edits replace the pending value without postponing that boundary. The Web Audio scheduler retains its submitted attacks and score cursor during edits.

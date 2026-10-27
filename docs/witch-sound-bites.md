# Witches Brew sound bites

The cauldron plays bounded excerpts. It does not start an interactive copy of
each instrument. Each of the 27 visible Morphazoid icons cycles through three
authored sounds on accepted clicks: 1 → 2 → 3 → 1. Each icon has its own counter;
refills, presets, flight/stirring changes and rebuilding Audio preserve it for
the page session. A consumed icon still waits for a refill. Muted or rejected
triggers do not advance the cycle or queue a later sound.

The offline generators render mono PCM16 at 22,050 Hz. The base and three
variant banks decode once when the audio worklet loads and share 11,907,000
bytes of Float32 storage. BLECH's obsolete base passage is not decoded; the
cupboard Quadruped and walking cat share their three clips. Playback uses
interpolation, fixed voice pools and fixed source trims. No network request,
source-engine construction or PCM allocation occurs at a drop or render
boundary. The live miniatures select precomputed native gesture/parameter
banks and reuse their existing voices.

Variant sources and exact generation details:

- [BLECH, Rubix, Monstroid and Candy Coil](witch-native-variants.md)
- [Puggler, Chiptune, SIMD303 and Spider](witch-character-variants.md)
- [Fractal, Jaw Harp, Harmonicazoid, Synthesaurus, Dentaphone, Rattlesnake and Quadruped](witch-source-variants.md)

| Trigger | Source used to author the excerpt |
| --- | --- |
| `drop-fractal` | Fractal Synthesis (`fractal-signals`), actual `FractalDSP` and its Copper zip factory scene |
| `drop-synthesaurus` | Synthesaurus (`synthesis`), its committed WASM engine, FM Inharmonic bell patch and a continuous-ratio fast phrase |
| `drop-jaw-harp` | Jaw Harp, actual physical processor and Khomus settings, repeated plucks with moving jaw and lips |
| `drop-harmonicazoid` | Harmonicazoid (`harmonica`), actual physical processor with alternating breath pulses and holes |
| `drop-dentaphone` | Dentaphone (`object-forge`), actual modal processor, Steel plates material and authored tooth brush route; frequencies follow a geometric progression |
| `drop-marimba` | Rattlesnake (`linear-drums`), its frequency-dependent modal ratios, gains, damping and strike-noise parameters in a fixed scalar excerpt of 36 cascading strikes |
| `drop-hyper-rubix` | Hyper Rubix (4D), its native eight-cell Hyper Kit parameter mapper and a bounded scalar rendition of its kick, sub, clap, snare, hats, W-axis stab and rim envelopes in a fast cell traversal |
| `drop-blech` | Three dense bundled BLEEDING EDGE MONOTONE AUDIO MIDI passages: Lightstorm (4,274 attacks), Seven Red Suns (4,828), A Soul Of Steel (4,473); native SpessaSynth/TimGM6mb with original pitches, velocities, gates, channels, controllers and programs |
| `drop-rubix` | Rubix 3D's actual `RubixSimd303Processor`, bundled SIMD WASM and Color circuit Acid bank; a scrambled 3×3 cube's three visible faces play the native snake sequence at 252 BPM, with 111 attacks |
| `drop-chiptune` | SIMD Chiptune's native WASM processor and Source Tracker pattern, baked by its own `createWebGpuChiptunePattern` mapper; 192 BPM with shorter echoes and reduced noise/drum mix |
| `drop-acid-303` | SIMD303's native WASM processor, Silver Squelch factory voice, sequence and step expression; the clock runs at 12.8 steps per second |
| `drop-monstroid` | Monstroid's full native `ColonySyrinxPressureProcessor`, Many-mouth rough call (`air-many-mouth-freak`) |
| `drop-candy-coil` | Native `MorphazoidBarberDelayProcessor`, Frozen Bog factory preset: 12 heads, eight-second history range and 0.9 feedback, fed by the native Rubix Acid excerpt; a 2.4-second section after six seconds of history |
| `drop-puggler` | Puggler's actual drum recordings, Oi recording and punk-character vocal DSP, plus its native string-model fuzz-guitar voices; two bars at 224 BPM with choked eighth-note riffs, sixteenth-note drums and two Oi shouts |
| `drop-spider` | Spider Synth's Silk buzz/croak speech character, rendered by the bundled Voicesaurus eSpeak NG engine and `SpiderSpeechPlayer`; “Nooooo! Bad witch!” with the first word slowed, while the accusation retains native consonant timing |
| `drop-roach` wing layer | Roach Synth's actual `RoachBodyEngine`, Wing radio's synthesized outer-wing buzz and recorded vivarium rustle, in three accelerating flutter trains alongside its live feet and wire rasp |
| `drop-cat`, `drop-quadruped` | The existing Witch Quadruped click-meow engine, independently sampled so capturing the walking cat cannot cut off its falling meow; the cupboard icon shares that PCM |
| `drop-mouse`, `drop-lizard` | Quadruped's authored call pitch/type/filter contours in bounded scalar oscillator excerpts; these are fictional calls, not animal recordings |
| `tree-l-system` (legacy PCM) | Archived L-System Synth Notes · Orchard chimes excerpt: native coral traversal, `LSystemEventClock`, note mapping/envelopes, `MorphazoidContourSynth` FM processor and preset lowpass; the clickable tree now uses the live PM voice below |

Normal bites last 2.4 seconds. BLECH MIDI, Syrinx and Creaturazoid last five
seconds so their 3.2-second tree phrase continues during the dive. Existing
Syrinx/Creaturazoid miniatures retain their actual source models and gesture
frames. FM Drums uses eight reusable native-parameter hits in a faster rhythm;
Rubix uses the native Acid bank; Hyper Rubix adds a separate eight-voice
Hyper Kit excerpt. Older drop IDs remain accepted even when
their icons are no longer on the shelf.

The twelve live ingredient miniatures also have three distinct plans based on
native source data. These compact renderers retain their existing approximations;
Alien Larynx, for example, reuses the voice spectrum and body resonances without
running the full alien-scale or wormhole network:

| Ingredient | Three source plans |
| --- | --- |
| Alien Larynx | Double Fold, Giant Tract, Ring Wormhole snapshots |
| Hyper Rubix | Three different eight-cell traversals, geometry mappings and rhythms at 168/232/276 BPM |
| Digestazoid | Three different native event sequences: MB/Burp/HS, CRS/Quick Fart/Whoopee/SB, Heart/Burp/CRS/Quick Fart |
| Hybrinx | Hyena, Alligator and Wolf timeline gestures |
| Roach | Three contact/wire configurations and irregular foot rhythms, all retaining fluttering wings |
| FM Drums | Three factory-voice kits and different fast patterns |
| Hiccup Head | Hiccup, Growl and Braap physical voice gestures |
| Gesticules | Glass/wire flourish, rough bowed/wire scatter, fast marimba/pulse flick |
| Throatazoid | Clear/Deep/Bright, Deep/Clear/Deep and Bright/Bright/Clear voice arrangements |
| Julie Saw | Default tenor, Low Fog baritone and Rough Rosin carpenter blade |
| Syrinx | Songbird, Raven and Bullfrog source gestures |
| Creaturazoid | Caw, Growl and Harsh calls with distinct phrase timing |

BLECH's flying visitors independently cycle the same three dense passages.
Overlapping visitors keep their own selected clip; muted entrances are skipped.
Changing a clip never replaces another visitor's still-playing phrase.

The internal `roach-wings` clip follows the roach bite's clock, fades and release;
it does not add another ingredient or a separately running instrument.

Clicking the tree triggers one live PM traversal across 15 native Pythagorean
branches, using their path distances and fork power. Each branch has a 25 ms
attack, 100 ms decay, 0.64 sustain and 350 ms release; the complete phrase lasts
2.4 seconds. Spread changes turn angle and PM index from 3 to 8. Curl changes
turn asymmetry, modulator ratio and stereo position, with a 40 ms parameter slew.
An audio-clocked pulse follows the branching frontier. Clicking keeps the shape
fixed; dragging edits it, while mushrooms and the shape charm choose new tree
settings. A busy phrase ignores further triggers without queuing or restarting.
It does not consume an ingredient, duck the singer or change the preset, and
joins the shared flight delay. Fabric Filter remains a separate wind channel.
Hush, Reset and Audio off cancel it. `treeEnvelope`, `treeLevel` and
`treeProgress` follow its audio clock.

The ongoing voice/fingers retain 72% of their backing gain during a featured
drop. Fixed per-source trims balance the different native levels, with the
Puggler riff and Chiptune held back from the featured vocal objects. The output
makeup and 0.84 sample ceiling remain fixed. Sources do not normalize or raise
quiet parts during playback.

The web uses Spider Synth's actual string engine with seven closely spaced and
inharmonic low ratios. Its slower noisy attack, damping, dispersion, smooth
tension strain and lowpass trim make the strands quieter, lower and creakier.
Dropping the spider plays its complete spoken protest, without triggering web
plucks or the older two-mass groan. Its 2.4-second clip has silence after the
spoken ending, leaving room before the ingredient reader's release envelope.
The eye effect is a finite, coalesced 1.5-second buffer tear/ring/filter gesture
after the shared mix. It leaves every performer's clock and flight-delay memory
intact. Fabric filters the flying mix and smoothly bypasses on landing. Touching
the mesh refreshes one finite wind puff, using Fabric Filter’s brown/pink/white
noise coloring. It enters the shared delay and filter; Stop, Reset, mute and
landing release it. Anchored pull magnitude and release velocity shape the gust
and the native fabric frequency/Q mapping. Eight fixed resonator pairs process
the whole delayed mix; coefficient/gain interpolation preserves continuity, and
the centered fabric stays dry. The fabric controls keep their values between flights.

Flight uses Candy Coil's actual hump curves and Hann/tilt windows with 4–12
fractionally active heads over a fixed 10.5-second stereo history. Noodle time,
twist, feedback and space have separate controls. Centered twist emphasizes
steady dub echoes; larger twists sweep pitch and direction. Space expands the
cloud into older audio, while feedback adds dark cross-channel repeats through
lowpass, DC removal and bounded saturation. The direct mix retains at least
90% of its gain as the delay turns up, so takeoff does not replace the ongoing
performance with quieter echoes. This preserves a consistent level basis;
individual presets and gestures still change the sound. Flight motion retains
its independent clock. Stop and Audio off finitely release/clear history so a later start cannot
revive a stopped phrase. The native factory example is **Frozen Bog**; the source
instrument has no factory preset literally named “Forever”.

## Source credits

Original Morphazoid engine code, authored scores and procedural excerpts use
the repository license. Puggler's drums are by Karoryfer Samples and its Oi is
by rhink; these recordings are CC0. Their full provenance and license are in
[`assets/puggler/CREDITS.md`](../assets/puggler/CREDITS.md) and
[`assets/puggler/CC0-1.0.txt`](../assets/puggler/CC0-1.0.txt). The excerpt retains
the actual recorded Oi articulation, processed through Puggler's original punk
character effect.

Chiptune and SIMD303 use their committed engines and parameter/sequence
mappers. Their authoring sources are
[`processor.js`](../src/instruments/simd-chiptune/processor.js),
[`webgpu-chiptune.js`](../src/instruments/webgpu-chiptune/webgpu-chiptune.js),
[`simd-303-processor.js`](../src/simd-303-processor.js) and the
[`Silver Squelch preset`](../src/simd-303-presets.js). SIMD Chiptune's original
shader ancestry and credits remain documented with the instrument in
[`simd-chiptune.md`](simd-chiptune.md).

The spider protest is original fictional dialogue rendered offline with the
actual [`Spider Synth speech preset`](../src/instruments/spider-synth/spider-synth-speech.js)
and [`native text renderer`](../src/families/speech/native-text.js). The source
words are “No!” and “Bad witch!”; slowing only the first word creates the long
protest. It is synthetic speech, with no actor recording or runtime speech
service. The bundled eSpeak NG/Echogarden engine's upstream sources, GPL-3.0-or-later
license and component notices remain in
[`vendor/espeak-ng/README.md`](../vendor/espeak-ng/README.md) and
[`COPYING`](../vendor/espeak-ng/COPYING).

The roach layer uses nicotep's CC0 vivarium movement recording through Roach
Synth's own grain player. Its provenance and license remain in
[`assets/roach-synth/audio/CREDITS.md`](../assets/roach-synth/audio/CREDITS.md)
and [`manifest.json`](../assets/roach-synth/audio/manifest.json). The recording
supplies movement texture; the fluttering wing buzz is synthesized.

BLECH's three current passages are bundled creator AUDIO MIDI files by
**BLEEDING EDGE MONOTONE**, supplied under CC0 1.0. Source hashes, passage times,
credits and license records are linked in [native variant provenance](witch-native-variants.md).
The renderer preserves every attack in the selected passages and uses the
native player's 128-voice limit, including its normal voice stealing.

The MIDI excerpt is rendered from the repository's TimGM6mb soundfont by Tim
Brechbill and David Bolton. Its supplied copyright notice and GPL-2 license are
retained in [`assets/midiphoria/soundfont/COPYRIGHT.txt`](../assets/midiphoria/soundfont/COPYRIGHT.txt)
and [`GPL-2.0.txt`](../assets/midiphoria/soundfont/GPL-2.0.txt). The original
soundfont and the exact rendering script remain available alongside the derived
excerpt. The repository's existing SpessaSynth vendor notices remain applicable
to that offline rendering tool.

Rebuild with `node scripts/build-witch-bites.mjs`; a full run automatically follows
with the native-effects and character-bites generators, then
`build-witch-native-variants.mjs`, `build-witch-character-variants.mjs` and
`build-witch-source-variants.mjs`, each in a fresh process. The first
reauthors the actual MIDI, Rubix Acid, Monstroid and Candy Coil excerpts. The
second reauthors Puggler, SIMD Chiptune, SIMD303 and the spider protest. Run
`node scripts/build-witch-character-bites.mjs` to update only those four clips;
both follow-ups preserve every other existing PCM byte.
Append `--tree-only` to the base script to rebuild the legacy tree PCM excerpt;
the live PM tree does not use that recording. This is a source-asset authoring
command, separate from normal site/WAX builds. Mechanical audio tests cover
finite output, differences between excerpts, phrase lifetime, repeated triggers,
shared effects, clock continuity and Audio/Stop behavior. They do not establish
human listening quality or physical controller feel.

During flight, occasional BLECH MIDI flybys cycle the three dense `drop-blech`
PCM excerpts with stereo travel and a quiet fixed trim. Two dedicated readers feed the shared
delay and fabric without consuming or featuring a potion ingredient. Their
flight-only clock pauses on landing or Release; muting consumes missed entrances.

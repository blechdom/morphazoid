# Witches Brew sound bites

The cauldron plays bounded excerpts. It does not start an interactive copy of
each instrument. `scripts/build-witch-bites.mjs` and its native-effects follow-up render excerpts offline
into `src/instruments/witch/witch-bite-clips.js`: mono PCM16 at 22,050 Hz, decoded
once when the audio worklet loads. Output sample rates use interpolation. The
decoded bank uses 3,616,200 bytes (under 4 MB) and is shared by Witch engines in the same realm.
The three added 2.4-second native clips account for 635,040 bytes; the Quadruped
cupboard gesture aliases the existing cat clip and adds no PCM storage.
No network request, source-engine construction, or PCM allocation occurs at a
drop or audio render boundary.

| Trigger | Source used to author the excerpt |
| --- | --- |
| `drop-fractal` | Fractal Synthesis (`fractal-signals`), actual `FractalDSP` and its Copper zip factory scene |
| `drop-synthesaurus` | Synthesaurus (`synthesis`), its committed WASM engine, FM Inharmonic bell patch and a continuous-ratio fast phrase |
| `drop-jaw-harp` | Jaw Harp, actual physical processor and Khomus settings, repeated plucks with moving jaw and lips |
| `drop-harmonicazoid` | Harmonicazoid (`harmonica`), actual physical processor with alternating breath pulses and holes |
| `drop-dentaphone` | Dentaphone (`object-forge`), actual modal processor, Steel plates material and authored tooth brush route; frequencies follow a geometric progression |
| `drop-marimba` | Rattlesnake (`linear-drums`), its frequency-dependent modal ratios, gains, damping and strike-noise parameters in a fixed scalar excerpt of 36 cascading strikes |
| `drop-hyper-rubix` | Hyper Rubix (4D), its native eight-cell Hyper Kit parameter mapper and a bounded scalar rendition of its kick, sub, clap, snare, hats, W-axis stab and rim envelopes in a fast cell traversal |
| `drop-blech` | BLECH MIDI's actual bundled **Black Lattice · Ordered Storm** demo (`assets/midiphoria/midi/black-lattice.mid`), 32–36.5 seconds plus release; 1,260 note attacks through its native SpessaSynth/TimGM6mb renderer, retaining the score's pitches, velocities, gates, channels, programs and pan |
| `drop-rubix` | Rubix 3D's actual `RubixSimd303Processor`, bundled SIMD WASM and Color circuit Acid bank; a scrambled 3×3 cube's three visible faces play the native snake sequence at 252 BPM, with 111 attacks |
| `drop-monstroid` | Monstroid's full native `ColonySyrinxPressureProcessor`, Many-mouth rough call (`air-many-mouth-freak`) |
| `drop-candy-coil` | Native `MorphazoidBarberDelayProcessor`, Frozen Bog factory preset: 12 heads, eight-second history range and 0.9 feedback, fed by the native Rubix Acid excerpt; a 2.4-second section after six seconds of history |
| `drop-puggler` | Puggler's existing drum recordings, Oi recording, punk-character vocal DSP and a quiet native fuzz-guitar accent |
| `drop-roach` wing layer | Roach Synth's actual `RoachBodyEngine`, Wing radio's synthesized outer-wing buzz and recorded vivarium rustle, in three accelerating flutter trains alongside its live feet and wire rasp |
| `drop-cat`, `drop-quadruped` | The existing Witch Quadruped click-meow engine, independently sampled so capturing the walking cat cannot cut off its falling meow; the cupboard icon shares that PCM |
| `drop-mouse`, `drop-lizard` | Quadruped's authored call pitch/type/filter contours in bounded scalar oscillator excerpts; these are fictional calls, not animal recordings |
| `tree-l-system` | L-System Synth's Notes · Orchard chimes preset: native coral traversal, `LSystemEventClock`, note mapping/envelopes, `MorphazoidContourSynth` FM processor and preset lowpass; 15 notes in 2.4 seconds |

Normal bites last 2.4 seconds. BLECH MIDI, Syrinx and Creaturazoid last five
seconds so their 3.2-second tree phrase continues during the dive. Existing
Syrinx/Creaturazoid miniatures retain their actual source models and gesture
frames. FM Drums uses eight reusable native-parameter hits in a faster rhythm;
Rubix uses the native Acid bank; Hyper Rubix adds a separate eight-voice
Hyper Kit excerpt. Older drop IDs remain accepted even when
their icons are no longer on the shelf.

The internal `roach-wings` clip follows the roach bite's clock, fades and release;
it does not add another ingredient or a separately running instrument.

Clicking the tree plays `tree-l-system` through one dedicated scene reader while
the tree changes shape. Rapid clicks fade and restart that reader; they never
consume an ingredient, duck the singer, or change the preset. It joins the
shared flight delay/Fabric path. Release, Reset and Audio off cancel it; no
muted click is queued. `treeEnvelope` and `treeLevel` follow its audio clock.

The final bite gain is lower and the ongoing voice/fingers retain 72% of their
backing gain during a drop. The output makeup and 0.84 sample ceiling are
unchanged. The source clips have fixed individual trims; they do not normalize
or raise quiet parts during playback.

The web uses Spider Synth's actual string engine with seven closely spaced and
inharmonic low ratios. Its slower noisy attack, damping, dispersion, smooth
tension strain and lowpass trim make the strands quieter, lower and creakier.
The spider's groan is a finite two-mass source gesture.
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
lowpass, DC removal and bounded saturation. Flight motion retains its independent
clock. Stop and Audio off finitely release/clear history so a later start cannot
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

The roach layer uses nicotep's CC0 vivarium movement recording through Roach
Synth's own grain player. Its provenance and license remain in
[`assets/roach-synth/audio/CREDITS.md`](../assets/roach-synth/audio/CREDITS.md)
and [`manifest.json`](../assets/roach-synth/audio/manifest.json). The recording
supplies movement texture; the fluttering wing buzz is synthesized.

BLECH's actual bundled MIDI demo is an original Morphazoid CC0 study; its
provenance and exact score generator are in
[`assets/midiphoria/experimental/SOURCE.md`](../assets/midiphoria/experimental/SOURCE.md)
and [`generate.py`](../assets/midiphoria/experimental/generate.py). The excerpt
preserves every attack in the selected passage and uses the native player's
128-voice limit. GM programs, pan, volume and controllers follow the original
eight-row setup from that generator.

The MIDI excerpt is rendered from the repository's TimGM6mb soundfont by Tim
Brechbill and David Bolton. Its supplied copyright notice and GPL-2 license are
retained in [`assets/midiphoria/soundfont/COPYRIGHT.txt`](../assets/midiphoria/soundfont/COPYRIGHT.txt)
and [`GPL-2.0.txt`](../assets/midiphoria/soundfont/GPL-2.0.txt). The original
soundfont and the exact rendering script remain available alongside the derived
excerpt. The repository's existing SpessaSynth vendor notices remain applicable
to that offline rendering tool.

Rebuild with `node scripts/build-witch-bites.mjs`; a full run automatically follows
with `scripts/build-witch-native-effects.mjs` in a fresh process so it retains
the actual MIDI, Rubix Acid, Monstroid and Candy Coil sources. Run that follow-up
directly to reauthor only those four excerpts while preserving the other bytes.
Append `--tree-only` to the base script to rebuild only the tree phrase. This is a source-asset authoring
command, separate from normal site/WAX builds. Mechanical audio tests cover
finite output, differences between excerpts, phrase lifetime, repeated triggers,
shared effects, clock continuity and Audio/Stop behavior. They do not establish
human listening quality or physical controller feel.

During flight, occasional BLECH MIDI flybys reuse the actual Black Lattice `drop-blech` PCM excerpt
with stereo travel and a quiet fixed trim. Two dedicated readers feed the shared
delay and fabric without consuming or featuring a potion ingredient. Their
flight-only clock pauses on landing or Release; muting consumes missed entrances.

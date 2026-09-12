# Roach Synth: sound evidence and implementation notes

Research checked 2026-09-11. The scanned model is a generic winged cockroach specimen; its source metadata does not establish that it belongs to any of the sound-producing species below. Treat the instrument as a collection of cockroach-inspired mechanisms, with species identified in the references below.

## Implemented playable approximation

The instrument has eight anatomical sound groups: legs, outer wing covers,
hindwings, thorax, abdomen, neck, head and antennae. Each owns its oscillator
phases, filters, excitation envelopes, seeded randomness and sound assignment.
The nineteen source choices include smooth held-pose sounds (resonance,
drone, sub pressure, shimmer and clean sine), wing buzz and movement textures,
plus short cartoon footsteps, clicks, clacks, FM hits, rattling percussion and
Karplus plucks. Click and Clack provide separate crisp and resonant foot-contact
articulations without adding independent rhythmic loops.
Eighteen sound/voice presets and twenty-four animation sound patches share a
visible preset selector. Each animation chooses a distinct body mix; only
Dash and freeze assigns Skuttle in its authored animation patch. Default feet
use rounded impacts and the neck uses a clean pitch-responsive synth tone.
The Wing radio patch retains its previous wing generators and settings.
A compact body mixer controls assignment, level, mute and solo. Voice level
is independent of body solos. All nine consumed global sound controls are
visible beside the sound presets and voice input.

Sound Play opens the smooth held-pose sources without advancing the animation.
It never creates a footstep, scraping pulse or recorded grain. Moving each
body group's actual joints supplies its own friction and excitation; stopping
releases those textures back to the held resonance bed. XYZ rotations alter
pitch, filtering and stereo within that group. Left/right and individual joints
have different weighting even when their source is shared. Touching a joint
selects its group. Manual gestures work with Audio armed and either player
paused. Audio arming alone is silent; spoken KAL16 words have their own trigger.
Discrete pose loads and resets re-prime activity, preventing teleportation from
manufacturing contact events.

Six independent foot-contact envelopes follow the same contact counters used
by the visible gait. The assigned instrument turns them into rounded sole taps,
FM drum hits, rattling modal bursts, plucked strings or friction clusters.
FM and rattle articulation draw on Morphazoid's FM drums and Rattlesnake drum
engine; fractional string feedback draws on its Karplus engine. These are
creative percussive instruments, not recordings of those animals. Wire zing
uses the existing lossy waveguide. The engine is scalar AudioWorklet DSP,
not an actual SIMD backend or a validated cockroach biomechanical model.
Roach rustle plays bounded fragments of the CC0 vivarium recording described
below, triggered by that group's movement or the legs' contact events; it is
not a continuously looping ambience. No acquired clip is an isolated flight
sound, house-wall recording, shriek or demonstrated ultrasonic signal.

Twenty-four interleaved animation patches and seeded motion blends share an
audio-clock pose and stylized six-foot support state. Ground travel, swing,
touchdown counters, body lift and upright dances come from that state. Internal
64-sample curves preserve fast gestures; there is no exposed joint sequencer or
route editor in the compact main view. Random routines blend upper-body curves
while retaining their base routine's leg geometry and contact timing. Changing
routines preserves transport phase, and camera views remain independent.
Each routine has an authored eight-beat contact phrase on a sixteenth-note
grid, including eighth-note tripods, individual taps, syncopation and landings.
The optional metronome runs on the audio sample clock only during animation;
the four-dot display follows the same beat. Selecting an animation also loads
its sound patch while retaining master/voice levels and mute/solo choices.
Starting the first animation preserves any sound patch already edited or
chosen by the player. Sound presets can also be selected independently.
Twenty-four static poses plus seeded random poses hold complete body states;
Reset restores neutral without changing the sound mix.

The viewer calibrates a lowered, spread neutral stance from the curled scan
once at load, using bounded joint solving. Its angles and kinematic metadata
are passed to the sound engine. The original GLB retains 27 source joints;
four runtime wing hinges bring the total to 31. The default mobile asset has
pre-separated source-textured covers; the original GLB uses the same split at
runtime. The viewer reconstructs two thin veined hindwings underneath.
Those hindwings are an authored flight illusion, not recovered scan anatomy.
The long antennae remain rigid articulated meshes. Small palps, mouth and jaw
are fused into the scanned head, so they share Head and have no invented
independent controls.

Shared angular limits and sampled-point exclusion from an ellipsoidal body
core constrain the same pose in audio and graphics. This is an interior guard
for common poses, not triangle-level or continuous collision detection, or a
full limb-to-limb physics solver. Fine appendages and surface seams can still
overlap outside that core. Depth testing and self/ground shadows supply visible
occlusion. Graphics remain capped at 20 fps and pixel ratio 1; the AudioWorklet
runs the shared motion clock independently. Camera fitting occurs on loading,
explicit view selection or Fit; zoom has explicit +/− controls rather than
pinch, wheel or pose-driven refitting.

On phones, an explicit Audio on/off control remains on the sticky viewport,
with nearby loading/audio status that does not shift the scrolled controls.
Sound Play and speech remain usable while the GLB is loading; animation waits
for the rig. Built browser and WAX pages version the complete Roach module
graph and the mobile model together to prevent cached controls, worklets and
model assets from mixing releases. A temporary worker decodes the compressed
geometry, and texture uploads yield between short batches. Audio remains in
its existing independent AudioWorklet; loading does not arm or suspend it.

A fixed 20-frame output lookahead (0.42 ms at 48 kHz) protects dense mixtures.
The guard conservatively bounds a four-times windowed-sinc reconstruction,
including peaks between samples, with preallocated buffers and a fast path for
quiet signals. Ordinary low-level samples pass unchanged after the fixed delay.
This matches the offline headroom check; it is not a certified broadcast meter.

Speech reuses Morphazoid's locally bundled KAL16 atlas and pronunciation
dictionary with their existing attribution. The talking bug, growls and
unfurling textures are creative sound design. No ultrasound is output. Automated
renders, measurements and browser interaction tests assess timing, stability
and levels; human listening and physical-device testing have not validated
this revision's intelligibility, feel or timbral quality.

## Available recordings

| Recording | Actual content and provenance | Reuse and exact URL |
| --- | --- | --- |
| nicotep, `Gromphadorhina_portentosa.aif` | Creator's close microphone recording of hissing cockroach movements in a vivarium at Musée d'Histoire Naturelle, Lille; hypercardioid Oktava SDC. Original: 93.062 s, mono, 44.1 kHz, 16-bit AIFF. Description does not promise an isolated clean hiss. Not auditioned in this research pass. | **CC0.** [Creator/source page](https://freesound.org/people/nicotep/sounds/547897/). [Public high-quality MP3 preview](https://cdn.freesound.org/previews/547/547897_7529214-hq.mp3), verified HTTP 200, 2,226,987 bytes. This is a lossy preview; original AIFF download requires normal Freesound login. |
| Grinkod, `Tarakan.ogg` | Creator's own Madagascar hissing cockroach recording. 5.1 s Ogg Vorbis, about 58 KB. Uploaded 2008. A short hiss reference, not an ultrasonic recording. | [Wikimedia source](https://commons.wikimedia.org/wiki/File:Tarakan.ogg) offers **CC BY-SA 3.0**, GFDL, or FAL; select CC BY-SA 3.0 and credit/link license/identify edits. [Stable original-file resolver](https://commons.wikimedia.org/wiki/Special:FilePath/Tarakan.ogg). Direct asset follows Commons path `https://upload.wikimedia.org/wikipedia/commons/a/a1/Tarakan.ogg`, but download returned 403 from this environment, so the file is not locally acquired. |
| Terwelp, `Hissing cockroaches at Lincoln Park Zoo.wav` | Creator's 29.899 s zoo exhibit recording, Chicago, with visitor speech. Not a clean isolated source. | **CC BY 3.0**, [creator/source page](https://freesound.org/people/Terwelp/sounds/24948/). Lower priority because the recording contains intelligible people talking. |

Neither the recordings' sample rates nor their microphone descriptions support claiming ultrasound capture. A 44.1 kHz source cannot represent frequencies above 22.05 kHz, and practical equipment bandwidth may be lower. Prefer nicotep's CC0 clip as the bundled real-world texture reference and retain Grinkod's short hiss as an additional linked reference if direct acquisition remains unavailable.

## Primary scientific evidence ledger

1. **Airflow hiss: Gromphadorhina portentosa.** Nelson & Fraser (1980), *Sound production in the cockroach, Gromphadorhina portentosa: evidence for communication by hissing*, Behavioral Ecology and Sociobiology 6:305–314, [DOI](https://doi.org/10.1007/BF00292773). Hisses arise from forceful airflow through modified spiracles. Adult males hiss in aggression, courtship and copulation; disturbance hisses occur in both sexes and nymphs. Context differs in envelope, timing, loudness and repetition. Muting/playback experiments support an auditory social function in this species. The original paper was searchable at this [PDF reproduction](https://tcurry1977.edublogs.org/files/2011/09/Hissing-Paper-1lldw1l.pdf); direct PDF fetching was denied. This is a wingless species, so its hiss must not be portrayed as a sound generated by flapping the model's wings. Anatomy study: Nelson (1979), [DOI 10.1007/BF00617729](https://doi.org/10.1007/BF00617729).

2. **Tonal disturbance rasp: Henschoutedenia epilamproides.** Guthrie (1966), *Sound Production and Reception In A Cockroach*, J Exp Biol 45:321–328. [Publisher abstract](https://journals.biologists.com/jeb/article/45/2/321/21164/Sound-Production-and-Reception-In-A-Cockroach), [DOI](https://doi.org/10.1242/jeb.45.2.321). Reports stridulation with a 4.5–5.0 kHz carrier, amplitude-modulated pulses grouped into chirps; longer chirps are 50–100 ms. The low-frequency receptor sensitivity reported elsewhere in the abstract is **reception**, not the emitted carrier. No downloadable recording located.

3. **Ultrasonic energy is documented in one abdominal stridulation mechanism.** Schal, Fraser & Bell (1982), *Disturbance stridulation and chemical defence in nymphs of the tropical cockroach Megaloblatta blaberoides*, J Insect Physiol 28:541–552. [Original paper hosted by Schal's NC State lab](https://schal-lab.cals.ncsu.edu/wp-content/uploads/sites/80/2018/10/1982SchalJIPv28.pdf). Paired files on abdominal sternum six rub opposing scrapers on sternum five. Intact nymphs produce broadband noise with most energy around **5–35 kHz**. Bilateral superposition masks many individual pauses. A live spectrum was measured to 100 kHz; that is the analyzer range, not the reported sound band. Some tape recordings had a 15 kHz limit and cannot document the ultrasonic portion. Unilateral measurements resolve irregular individual tooth impacts; reported forward/back strokes are roughly 36/44 ms, with complete groups about 83 ms in two measured nymphs. This is species/life-stage evidence, not a general ultrasonic cockroach language. No public audio supplement found.

4. **Contact vibration and hiss can both be measured, but contact does not prove communicative signaling.** *Registration of Sounds Emitted by the Madagascar Hissing Cockroach Using a Distributed Acoustic Sensor*, Sensors 25(7):2101 (2025), [publisher](https://www.mdpi.com/1424-8220/25/7/2101), [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11990944/). Records a single G. portentosa's mechanical interaction with an optical-fiber sensor and its induced hiss. Data are available **on request from the corresponding author**; no openly downloadable recording was located. Useful support for a substrate-contact layer, not evidence that every footstep encodes a signal. Do not conflate airborne sound, substrate motion and sensory response to imposed vibration.

5. **Flying wingbeat rates, not a recorded flight timbre.** Fourtner & Randall (1982), *Studies on cockroach flight: The role of continuous neural activation of non-flight muscles*, J Exp Zool 221:143–154. [Publisher abstract](https://onlinelibrary.wiley.com/doi/abs/10.1002/jez.1402210204) reports tethered-flight/flight-cycle rates of **23–30 beats/s**. Supports a plausible low-rate wingbeat driver, but does not establish a microphone spectrum or a natural free-flight sound recording.

6. **Flight rate changes with age/environment.** Farnworth (1972), *Effects of ambient temperature, humidity, and age on wing-beat frequency of Periplaneta species*, J Insect Physiol 18:827–839. [Publisher abstract](https://www.sciencedirect.com/science/article/pii/0022191072900200). Tethered P. americana and other Periplaneta males were measured. At 25°C/50% RH, rates were about 23 Hz at 4–6 days, 26.5 Hz by 7 days and 30–31 Hz from 14 days. Ambient temperature and humidity affect rate. These are particular experimental conditions, not fixed universal constants. No licensed microphone flight recording located in this bounded search.

The papers support multiple mechanisms in different species. They do not support saying the current scanned specimen naturally makes all these sounds, or treating the planned synthetic words as biological communication.

## Feasible synthesis using existing Morphazoid architecture

These are implementation proposals inferred from the mechanisms, not validated biomechanical reconstructions.

- **Hiss:** an airflow envelope drives seeded broadband turbulence through a low-Q spectral filter bank and radiation filter. Controls: pressure/envelope, spiracle aperture or spectral tilt, duration, breath roughness. Fit the real reference's RMS envelope and coarse spectral band energies. Avoid fitting a single tonal carrier to broadband noise. Small abdomen motion can share the hiss envelope.
- **Rasp/stridulation:** irregular fractional tooth impacts excite damped cuticle modes, with stroke speed affecting tooth-event spacing. Offer a tonal Henschoutedenia-inspired 4.5–5 kHz preset and a broadband Megaloblatta-inspired abdominal rasp. Bilateral drives can overlap rather than forcing a clean metronomic chirp. Keep anatomical assignment/preset labels species-specific.
- **Scuttle/contact:** six contact-event streams trigger impact and scraping exciters through a selectable ground/material resonator. Amplitude follows foot contact velocity/pressure. These are amplified substrate interactions or designed foley; exact material modes are assumptions. Avoid deriving sound from arbitrary pose-slider changes unless the foot actually contacts something.
- **Flight:** a roughly 23–31 Hz wing-stroke driver excites periodic aerodynamic loading, multiple audible harmonics and broad turbulence. Spin-up/down and flutter jitter provide useful controls. Around 27 Hz is a plausible starting control value; 30 Hz matches one cited mature-male test condition. Sound spectrum/radiation remain artistic approximations until calibrated against a recording. Wingbeat fundamental is not necessarily the loudest audible component.
- **Ultrasonic listening mode:** retain an explicit modeled/source band and an independent audible frequency mapping. A synthetic 5–35 kHz band shifted down to a playable audible range is a **sonification**, not playback of measured ultrasound. An ordinary 44.1/48 kHz browser audio context cannot synthesize the full 35 kHz band; an above-Nyquist oscillator aliases unless rejected or properly translated. Actual higher-rate capture would require verified microphone/recorder bandwidth. Do not invent high-band measurements from the available audible recordings.

`src/crickets.js` provides the useful pattern: analysis → gesture/timing → explicit exciter → damped modes → radiation/output. `createMode` around 458 and `stepMode` around 471 implement stable exact damped poles. `renderCricketModel` around 566 generates fractional tooth events and seeded irregularity, and exports samples/model metadata. Reuse that design and event timing. Its two coupled **cricket-wing** modes (`coupledWingModes`, around 486) should not become a blanket anatomical explanation for cockroaches. `analyzeCricketSong` assumes tonal stridulation; hiss analysis needs broadband descriptors. The existing disclaimer around 415 correctly separates recording spectral concentration from measured damping/anatomy.

## Tiny crusty robot-bug words

This is an explicitly creative voice. Reuse the existing phoneme/diphone path for intelligibility, then apply a narrow buzzy/noisy carrier, slight timing jitter, short dry clicks and restrained saturation/bit reduction. Preserve unvoiced consonants and vowel transitions so texture does not destroy words. Pitch/body-size/formant controls should be independent where feasible.

`src/spelling-pronunciation.js` exports `spellingPronunciationTokens(value, pronunciations)` around 313 with dictionary lookup and fallback pronunciation; prefer it over raw letter `spellingTokens`. `SpellingSynthesizerAudio` in `src/spelling-synthesizer-audio.js` around 1293 supports the existing `vocoder` backend and enable/articulate/durationMs/release/close lifecycle. `event.wordSpeech=true` selects shorter 100–220 ms vowels in the diphone engine. Existing `src/spelling-vocoder-processor.js` uses speech envelopes with pulse/noise carriers and preserves unvoiced consonants. The KAL16 asset and its existing repository attribution should be reused consistently. This is a practical speech starting point, not a cockroach vocal-tract model.

The original GLB/rig manifest preserves **paired wing covers in one mesh**. The mobile derivative precomputes the viewer's triangle partition into independently hinged covers, and the viewer authors two thin veined hindwing fans underneath. These fans are a flight illusion, not recovered scan anatomy. There are no independent mouth-palps, mandible or jaw meshes. The rigid hierarchy has no flexible tissue deformation; the manifest describes the original asset, while these adaptations are recorded in `assets/roach-synth/SOURCE.LICENSE.txt`.

## V5: acquired recording bank and the boundary between recording and synthesis

On 2026-09-11, the public HQ MP3 preview of nicotep's
[Gromphadorhina recording](https://freesound.org/people/nicotep/sounds/547897/)
was downloaded successfully and its creator-page **CC0 1.0** dedication was
verified. The preview is 2,226,987 bytes, mono 44.1 kHz, 93.062 seconds; it is
not the original lossless AIFF. Three derived mono 48 kHz / 16-bit PCM WAVs
are now bundled under `assets/roach-synth/audio/`:

| Bank ID | Original preview interval | Length | Raw RMS / peak | Edited RMS / peak |
| --- | --- | --- | --- | --- |
| `vivarium_scuttle` | 80.500–84.000 s | 3.5 s | −49.06 / −18.65 dBFS | −28.00 / −6.00 dBFS |
| `vivarium_rustle` | 10.400–13.900 s | 3.5 s | −53.52 / −22.65 dBFS | −28.00 / −6.00 dBFS |
| `vivarium_contact` | 3.000–5.500 s | 2.5 s | −51.81 / −20.08 dBFS | −28.00 / −6.00 dBFS |

The bank totals **9.5 seconds / 912,132 bytes**. Full source/output hashes,
exact processing, measured levels and local transient cue positions are in
[the asset manifest](assets/roach-synth/audio/manifest.json); source credits,
license and editing notes are in [CREDITS.md](assets/roach-synth/audio/CREDITS.md).
The source is exceptionally quiet: its full-file RMS is −55.79 dBFS. Simply
normalizing each excerpt's peak to −3 dBFS leaves the three RMS levels at
−33.40, −33.87 and −34.73 dBFS. The supplied edits instead use documented
filtering, fixed gain and short offline peak reduction to expose the texture
without allowing the sparse sharp peaks to consume the mix's headroom.
The audio bank carries precomputed broadband energy cues so short playback
fragments can find movement activity rather than randomly selecting silence.

These are **recorded vivarium movements**. The source does not identify each
transient as a footstep or promise an isolated hiss. No source was recorded
inside a house wall, and no acquired clip establishes a flight sound. The
labels “scuttle,” “rustle” and “contact” describe roles in this instrument;
wall amplification, granular timing, pitch changes and material resonances
are creative processing. G. portentosa is wingless, and its recording does
not identify the species of the scanned winged specimen.

Waveform and spectrogram inspection selected broadband movement clusters
without obvious sustained speech or musical harmonic patterns. No human
listening occurred, so intelligible-background exclusion and timbral quality
remain unverified. The unedited source and equal-RMS comparison renders were
retained in the task's temporary evidence directory for an eventual audition;
they are not extra runtime assets.

The physical inspiration remains separable from those samples:

- A pressure envelope driving turbulent airflow and a broad resonator is a
  useful **hiss approximation**, supported by the experimentally studied
  spiracle mechanism and context-dependent hiss envelopes in
  [Nelson & Fraser (1980)](https://doi.org/10.1007/BF00292773). It is not a
  measured vocal tract and should remain distinct from the robot words.
- Foot impacts and sliding contacts can excite damped substrate/material
  resonances. The [2025 distributed-acoustic-sensor experiment](https://www.mdpi.com/1424-8220/25/7/2101)
  detected both induced hissing and mechanical interaction with its sensor;
  it does not turn ordinary motion into a demonstrated communication code.
  A wall cavity added after those excitations is an authored acoustic setting.
- A low-rate wing driver can draw on the **23–30 beats/s** observed in
  [Fourtner & Randall's tethered-flight experiments](https://onlinelibrary.wiley.com/doi/abs/10.1002/jez.1402210204).
  Harmonic buzz, turbulence and four-wing layering remain synthesis choices;
  neither this study nor the acquired movement clips calibrates their timbre.

The existing species-specific stridulation and ultrasound ledger above still
applies. The downloaded 44.1 kHz preview is not evidence of ultrasonic content,
and an audible translation of modeled high-frequency rasp is sonification.

# Roach Synth: sound evidence and implementation notes

Research checked 2026-09-11. The scanned model is a generic winged cockroach specimen; its source metadata does not establish that it belongs to any of the sound-producing species below. Treat the instrument as a collection of cockroach-inspired mechanisms, with species identified in the references below.

## Implemented playable approximation

The instrument combines short six-foot impact envelopes, filtered scraping and
airflow noise, a 16-mode shell resonator, wing rustle/buzz, rough low growls,
an optional modal/formant drone, and locally bundled KAL16 phoneme samples for
words. Eight sound mixes expose these layers. The default favors short nervous
contacts; the continuous drone starts at zero, and the VOICE slider controls
words independently. This is scalar AudioWorklet DSP, informed by SIMD Synth's
modal-bank design rather than an actual SIMD backend.

All 27 joints start with editable sound routes. Individual or combined XYZ
rotations control pitch, vowel, brightness, shell decay, hiss, wing rate, rhythm,
percussion, crunch, stereo pan, feet, growl, drone or voice level. Grabbing a
part selects it. Dragging a leg produces a filtered scrape, a head/neck gesture
excites shell creaks, and moving the covers excites an unfurling texture.
These manual gestures work with Audio armed and automatic animation paused;
releasing them returns to silence unless words or an explicit drone are active.

Twenty-four repetitive motion patches share an audio-clock pose and stylized
six-foot support state. Ground travel, foot swing, touchdown counters, body
lift and upright dances come from that state. The viewer calibrates an unfolded
neutral stance from the curled scan once at load, using bounded joint solving;
those neutral angles are passed to the sound engine too. This is an authored
support model, not validated animal biomechanics or a general collision solver.
Extreme manual poses can still intersect or leave the ground. Secondary
hindwings and mouthparts are absent; covers stay paired and antennae rigid.

The joint score contains sixteen smoothly interpolated rotation keyframes per
axis, independently assigned to each joint (up to 81 tracks). It adds to the
chosen routine; scores are remembered per routine and can be saved locally.
Switching routines preserves transport phase. Camera views never form part of
the score. Camera-directed head offsets are shared with audio as well as the
visible pose. The renderer caps frame rate and pixel ratio, with bounded shadow
maps, self-shadowing and ground shadows; it follows the audio clock without
scheduling sound on animation frames.

The animal recordings below are linked listening references, not bundled sound
sources. Speech reuses Morphazoid's existing KAL16 atlas and pronunciation
dictionary with their existing attribution. The talking bug, growls and
unfurling textures are creative sound design. No ultrasound is output. Human
listening and physical-device testing have not validated this revision's
intelligibility, feel, or timbral quality.

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

The current GLB/rig manifest has **paired wing covers in one mesh**, no separate unfolded secondary hindwings, and no independent mandible/jaw meshes. Hindwings or mouthparts added for animation are authored additions and need to be described that way. The rigid-joint hierarchy is approximate and has no flexible tissue deformation. These limitations are explicit in `assets/roach-synth/rig-manifest.json`; they cannot be fixed by a sound preset.

# Blowhole: cetacean sound-production research and instrument design

## Design conclusion

`Blowhole` is a two-family, three-topology physical-model instrument: delphinid/orca nasal sources, the sperm whale's specialized right-sided nasal head, and the mysticete larynx. It is not a whale-shaped reskin of a human larynx and not a sample player.

Its central correction is visible in the interface: **the external blowhole is a breathing valve, not the underwater sound source**. Underwater phonation neither uses nor requires opening it. A separate `Surface breath` control opens the valve and produces an exhalation noise. The authored call plans are underwater references and use three modeled internal paths:

```text
DELPHINID / ORCA
nasal pressure → selected phonic-lip side → vestibular air sacs → skull / melon → water
                              ↑_______________ air return ________________|

SPERM WHALE
right nasal pressure → single right phonic lips → spermaceti reflection → junk → water

BALEEN WHALE
lung pressure → coupled U-fold / cricoid-cushion gap → laryngeal sac → throat / body → water
```

The three topologies share performance concepts—pressure, tissue tension, closure, source balance, pneumatic or compliant-sac memory, radiator, scale, and irregularity—but they do not share a fictional universal organ. A tagged sperm whale has also been observed clicking while breathing at the surface: the evidence supports pneumatic isolation of its right sound passage from its left respiratory passage. That exception is why the interface does not say that an open blowhole universally prevents sound.

## What Hybrinx contributes

Hybrinx is a software physical-model sequencer. There are no Hybrinx CAD files, pressure-vessel plans, or fabrication drawings in this repository. Its useful structure is conceptual and computational:

1. **Morphology and gesture remain separate.** The body defines a pressure-driven sound-producing system; a call is a time-varying performance through that body.
2. **The source is causal.** Pressure, tension, closure, bilateral balance, and irregularity drive an oscillator before the tract and cavity stages.
3. **Calls are visible contours.** Hybrinx exposes pressure, pitch/tension, closure, mouth, cavity, roughness, source split, and bilateral balance as synchronized lanes in [`src/hybrinx-timeline.js`](src/hybrinx-timeline.js).
4. **Anatomy is the interface.** Its cutaway body and draggable organs keep the signal path legible while the graph shows the same motion over time.
5. **Speculation is labeled.** Hybrinx calls its grafted tongues chimeric instead of presenting them as literal comparative anatomy.

Those ideas transfer directly. Its tongue and oral-tract topology does not. Morphazoid's earlier research already identifies odontocete phonic lips as a separate source family rather than a mammal-larynx preset; see [`ANIMAL_VOICE_SYNTHESIS_RESEARCH.md`](ANIMAL_VOICE_SYNTHESIS_RESEARCH.md).

Blowhole therefore preserves Hybrinx's source–gesture separation, paired-source controls, color-linked anatomy and contours, and live playhead. It replaces the complete oral middle section with purpose-built nasal or laryngeal anatomy.

## What dolphins and toothed whales actually do

Odontocetes—dolphins, porpoises, orcas, sperm whales, and other toothed whales—produce their main underwater signals in a nasal complex below the blowhole. Pressurized air drives soft phonic-lip tissues into self-sustained vibration and collision. Most odontocetes have left and right source complexes. The bottlenose-dolphin evidence supports right-side clicks and left-side whistles, though that split is not universal across species. Great sperm whales are an important exception: their extremely asymmetric forehead has a single functional sound-generation complex on the right, while the large left passage primarily serves respiration.

The source is pneumatic but highly air-efficient. Air crosses the phonic lips into vestibular sacs and can be recycled inside the nasal system rather than expelled through the external blowhole. In dolphins and many other odontocetes, the dorsal bursae, air sacs, skull, and fatty melon then shape and direct the pulse into water. The melon is an acoustic lens/radiator, not an oscillator. In the great sperm whale, the initial right-sided pulse travels through a much longer bent-horn path: the distal air sac, spermaceti case, frontal reflection, and layered junk form the characteristic head filter and terminal radiation window.

The most important recent result is that toothed whales use several tissue-vibration registers. A closure-heavy `M0` or vocal-fry regime produces short, powerful, air-efficient echolocation clicks. `M1` and `M2` regimes support pulsed and tonal social signals. This is a myoelastic-aerodynamic mechanism: airflow and elastic tissue sustain the motion; it is not a literal edge-tone whistle. Heliox experiments support tissue vibration because changing the gas sound speed did not transpose dolphin whistle contours.

Model consequences:

- Delphinid anatomy retains two possible phonic-lip sides, but the authored bottlenose whistle and click gestures select the measured unilateral side. The sperm preset uses only one right-sided source.
- Pressure must cross a source threshold; the output is not a free oscillator behind a volume slider.
- `M0` produces collisions that excite a broadband cranial/melon filter.
- `M1` and `M2` produce sustained, harmonic tissue motion with different open fractions and effective masses. In `M1`, tissue-pulse repetition is the fundamental frequency and the nonlinear waveform supplies harmonics.
- In `M0` click trains, event repetition rate and broadband ultrasonic center frequency are distinct. They must not be conflated with the M1 fundamental.
- Air recycling changes sustain and stability rather than adding cosmetic reverb.
- Focus changes the cranial radiation filter, not the source pitch.
- A physical-frequency readout is kept even when browser output is transposed into a useful monitor band.

Primary references:

- P. T. Madsen, U. Siebert, and C. P. H. Elemans, [“Toothed whales use distinct vocal registers for echolocation and communication”](https://doi.org/10.1126/science.adc9570), *Science* 379 (2023).
- P. T. Madsen et al., [“Dolphin whistles: a functional misnomer revealed by heliox breathing”](https://doi.org/10.1098/rsbl.2011.0701), *Biology Letters* 8 (2012).
- P. T. Madsen et al., [“Nasal sound production in echolocating delphinids is dynamic, but unilateral”](https://doi.org/10.1242/jeb.091306), *Journal of Experimental Biology* 216 (2013).
- J. Kremers et al., [review of dolphin sound categories, paired phonic lips, melon, and hearing](https://doi.org/10.3389/fevo.2016.00049), *Frontiers in Ecology and Evolution* 4 (2016).
- P. T. Madsen et al., [measurements of air use and nasal recycling during deep click production](https://doi.org/10.1038/s41598-019-51619-6), *Scientific Reports* 9 (2019).
- M. Wahlberg et al., [“Click production during breathing in a sperm whale”](https://doi.org/10.1121/1.2126930), *Journal of the Acoustical Society of America* 118 (2005), supporting a pressurized right nasal passage and single right phonic-lip pathway.
- P. T. Madsen et al., [off-axis measurements of the sperm-whale multipulse structure](https://pubmed.ncbi.nlm.nih.gov/16334703/), *Journal of the Acoustical Society of America* 118 (2005), supporting reflection in the spermaceti organ and forward radiation through the junk.
- NOAA Ocean Today, [Dolphin Anatomy](https://oceantoday.noaa.gov/dolphinanatomy/welcome.html), for a concise public explanation of sound generation below the blowhole and melon focusing.

## What baleen whales actually do

Mysticetes—blue, fin, sei, minke, humpback, right, bowhead, and other baleen whales—use a greatly modified larynx far below their paired blowholes.

Direct experiments on excised sei, minke, and humpback larynges, together with anatomy and fluid–structure modeling, support a distinctive `U-fold` mechanism. Long arytenoid cartilages form a U-shaped frame. Air from the lungs passes through a narrow gap between the transverse arytenoid fold (TAF) and a fatty cricoid cushion (CC); measured mucosa on both surfaces vibrates in the demonstrated CC–TAF or fold-to-fat mode. The experiments also produced a distinct bilateral TAF-to-TAF mode in the humpback larynx. They did not demonstrate two independent fold-to-fat oscillators.

Spent air enters a laryngeal sac. Blowhole models that sac as compliant acoustic and pressure memory; it does not claim to simulate the still-uncertain physiological transport of air back to the lungs. The exact live-animal radiation route is also less certain than the demonstrated source mechanism, so the browser model uses a clearly labeled throat/body modal radiator rather than pretending to reconstruct tissue and water coupling from CT geometry.

The recent experiments also support a depth constraint. The baleen mechanism needs enough lung air and pressure difference to drive large folds and therefore cannot simply escape anthropogenic noise by singing arbitrarily deeper or higher. The instrument's depth control progressively reduces mysticete drive beyond the supported shallow range; it does not apply the same reduction to the compact nasal system of a deep-diving toothed whale.

Model consequences:

- U-fold tension changes the fundamental and register.
- The coupled fold–cushion gap changes onset threshold, harmonic richness, and collision strength.
- The two-voice humpback preset combines a demonstrated fold-to-fat topology with a demonstrated bilateral fold-to-fold topology; using them simultaneously as a biphonic gesture is an explicitly speculative synthesis mapping.
- Laryngeal-sac coupling changes low modes and compliant memory.
- Scale changes fold mass and the resulting frequency range.
- Irregularity belongs inside the coupled source as pitch instability and contact noise rather than cosmetic downstream hiss.
- The paired external blowholes remain sealed throughout underwater phonation.

Primary reference:

- C. P. H. Elemans et al., [“Evolutionary novelties underlie sound production in baleen whales”](https://doi.org/10.1038/s41586-024-07080-1), *Nature* 627 (2024). The study reports direct excised-larynx phonation, anatomy, and a fluid–structure model; it does not claim a complete live-animal radiation reconstruction.

Useful acoustic context:

- WHOI's overview places humpback song broadly from about 30 Hz to 3 kHz: [*Communication and Cognition* chapter](https://www.whoi.edu/fileserver.do?id=57475&p=40212&pt=10).
- D. Cazau et al. discuss nonlinear and biphonic structure in humpback song: [*Scientific Reports* 6, 31660](https://doi.org/10.1038/srep31660).
- R. P. Dziak et al. summarize the population-specific Northeast Pacific B call as a roughly 10–20 second harmonic signal stepping from about 20 to 16 Hz: [*Scientific Reports* 7, 9122](https://doi.org/10.1038/s41598-017-09423-7). That paper's older source proposal is not used here; the preset takes only its acoustic call description and uses the later comparative laryngeal model above.

## Browser physical model

The worklet is an original, compact playable reduction of those mechanisms. It does not copy protected recordings and it does not output real cetacean source levels.

### Odontocete source

For tonal registers, a selected phonic-lip side is a pressure-gated nonlinear oscillator. Tension and scale set the effective tissue frequency; closure changes the open fraction and harmonic slope. The bottlenose signature whistle uses the left side, the bottlenose click gestures use the right, and the orca M1 reduction uses one source whose anatomical side is deliberately left unassigned. Its pulse repetition and oscillator fundamental are one contour, not a slow amplitude gate over a separate carrier. The sperm coda uses one right source and a separate long-head reflection path.

For `M0`, a phase accumulator at the call's pulse-rate contour produces finite-width collision events. Closure sets an 8–100 μs source-pulse window at the requested 48 kHz render rate. Each event excites short damped cranial modes centered on the call's physical click band. In audible-monitor mode, an ultrasound mapping moves only that center band into the speaker band; click spacing, gesture duration, and physical-frequency readouts remain unchanged. A separate bounded pneumatic reservoir makes nasal recycling retain drive and reduce instability; short acoustic delay lines model sac or head reflection rather than pretending that delayed audio is recycled air.

```text
selected phonic-lip side ─ collision / tonal register ─ head modes ─ radiator ─ water monitor
nasal return ───────────── short bounded pressure memory ────────────────┘

sperm right phonic lips ─ distal sac → spermaceti case → frontal reflection → junk → water
```

### Mysticete source

The primary pressure-gated oscillator represents relative motion in the coupled CC–TAF gap. Scale and tension set the low fundamental; closure increases collision and higher harmonics. In the two-voice humpback preset only, a second nonlinear regime represents bilateral TAF-to-TAF contact. Running those two reduced modes together is a creative biphonic mapping, not a claim that direct experiments observed the synthesized phrase. A damped laryngeal-sac mode and several body modes supply the passive downstream color.

```text
coupled CC–TAF gap ─┐
                    ├─ nonlinear source ─ laryngeal-sac mode ─ body radiator ─ water monitor
bilateral TAF–TAF ──┘  (two-voice humpback preset only; simultaneous mapping is speculative)
```

### Safe monitoring

Real odontocete clicks can extend well above 100 kHz, outside a 48 kHz browser audio stream and normal human hearing. Large baleen whales can place strong energy below what laptop speakers reproduce. `Audible proxy` therefore applies a documented monitor translation:

- ultrasound is compressed into a high but audible carrier band;
- infrasonic/very-low components are raised into a speaker-useful bass band;
- signals already inside the 40 Hz–12 kHz speaker-useful monitor band remain at 1:1 frequency;
- octave folding outside that band is shared by all simultaneous voices, so time contours, pulse intervals, voice relationships, and physical readouts stay unchanged.

`Physical band` removes that musical convenience, but browser Nyquist filtering and the listener's hardware still limit the result. Neither mode is a calibrated underwater-source simulation.

### External fluid-acoustic path

The animal model ends at radiation. A separate post-source layer now sketches what reaches a receiver through four listening environments: calm water, open air, windy air, and choppy surface water. This separation is deliberate. Selecting air does not open the blowhole, change the call source, or imply that a submerged cetacean signal crosses the air–water boundary efficiently.

Water and air differ in sound speed, absorption, characteristic impedance, boundary behavior, and turbulence. Seawater carries sound at roughly 1,500 m/s, with the exact value depending on temperature, salinity, and pressure; ordinary air is closer to 343 m/s under room-like conditions. That speed difference changes wavelength and travel time, not pitch for a stationary source and receiver. Absorption in both media is frequency-dependent. Audible low-frequency underwater sound can travel far, so the calm-water mode deliberately avoids the clichéd steep “underwater” low-pass.

The presets are monitor-normalized acoustic sketches:

- **Calm water · hydrophone** keeps a relatively clear direct path and one stable, polarity-inverted surface reflection. The inversion approximates a smooth pressure-release air–water boundary.
- **Open air · comparison** applies modest distance-linked high-frequency loss and an airborne reflection pattern. It is an audition comparison, not normal cetacean phonation or cross-surface transmission.
- **Windy air · turbulence** starts from the open-air path and adds conservative, slowly varying gain and reflected-arrival fluctuation. This represents propagation variability; it does not pitch the source up or down.
- **Choppy surface · hydrophone** replaces one coherent surface return with moving, less-coherent stereo returns and filtered scatter. It is a compact proxy for a moving rough boundary and bubbles, not a generic lush reverb.

Path distance controls spectral color and reflected-path timing. The displayed direct travel time is calculated from distance divided by the preset sound speed, but that full delay is not placed in the live monitor because doing so would make the instrument unplayable. `Acoustic path` interpolates continuously from the clean radiated source to the level-compensated environment. Presets crossfade and remain behind the existing hard output bound.

This layer is not a calibrated propagation solver. It does not request temperature, salinity, pH, humidity, receiver depth, source depth, sea-state spectrum, bathymetry, or wind profile, all of which matter to a predictive model. It also does not simulate transmission through the air–water interface, where the large impedance mismatch normally reflects most incident energy. The layer should therefore be read as a physically informed comparison among receiver scenes.

Primary and standards references:

- NOAA Ocean Service, [“How far does sound travel in the ocean?”](https://oceanservice.noaa.gov/facts/sound.html), for the air/water sound-speed comparison and environmental dependence.
- National Physical Laboratory, [seawater absorption physics](https://resource.npl.co.uk/acoustics/techguides/seaabsorption/physics.html), and M. Ainslie and J. McColm, [simplified seawater absorption formula](https://doi.org/10.1121/1.421258), *JASA* 103 (1998), for frequency-dependent attenuation.
- ISO, [ISO 9613-1](https://www.iso.org/standard/17426.html), and H. Bass et al., [atmospheric absorption model](https://doi.org/10.1121/1.412989), *JASA* 97 (1995), for air absorption's dependence on frequency and atmospheric state.
- National Physical Laboratory, [*Underwater Acoustics: Technical Guides — Speed, absorption, propagation and ambient noise*](https://eprintspublications.npl.co.uk/6340/1/AC12.pdf), for surface roughness, bubbles, wave motion, scattering, and geometry caveats.
- D. Wilson et al., [measurements of atmospheric-turbulence effects on sound](https://doi.org/10.1121/1.413649), *JASA* 99 (1996).
- National Physical Laboratory, [sound pressure, intensity, and acoustic impedance](https://resource.npl.co.uk/acoustics/techguides/concepts/spl.html), for why airborne and underwater sound-pressure levels are not directly interchangeable.

## Gesture set

The included gestures are synthesis targets, not embedded animal recordings:

| Family | Gesture | Model emphasis |
| --- | --- | --- |
| Bottlenose dolphin | Signature loop | M2 tonal tissue vibration and learned frequency contour |
| Bottlenose dolphin | Search clicks | Sparse M0 collisions and focused melon filtering |
| Bottlenose dolphin | Terminal buzz | Rising M0 pulse rate while carrier band remains high |
| Orca | Pulsed call | One side-unassigned M1 source; pulse repetition equals f0 and nonlinear motion produces harmonics |
| Sperm whale | Five-click coda | One right source, exact collision times, spermaceti reflection, and junk radiation |
| Humpback whale | Moan | Coupled CC–TAF vibration and laryngeal-sac support |
| Humpback whale | Two-voice phrase | Explicitly speculative combination of fold-to-fat and fold-to-fold regimes |
| Northeast Pacific blue whale | B call | Population-qualified 15–20 Hz downsweep, long pressure contour, large body radiator |

Each gesture stores normalized keyframes for pressure, source frequency, pulse rate, closure, focus, balance/asymmetry, and irregularity. Moving anatomy changes the body through which those contours play; it does not rewrite the source gesture. This is the direct Hybrinx inheritance.

## Evidence boundary

The interface uses three levels of claim:

- **Observed mechanism:** excised tissue motion, measured pressure/airflow behavior, anatomical source location, paired-source organization, or directly recorded call structure.
- **Anatomically constrained reduction:** two browser oscillators, finite air memory, modal sacs, head/body filter, and depth attenuation derived from those mechanisms.
- **Audible proxy:** frequency translation and speaker-safe dynamics required to make ultrasound, infrasound, and underwater coupling playable in air.

The excised-larynx evidence directly covers sei, minke, and humpback whales. Applying the family mechanism to the Northeast Pacific blue-whale B-call preset is comparative anatomical inference, explicitly labeled as such in the instrument.

The cutaway is schematic. Slider percentages do not claim to be millimeters of tissue, kilopascals of nasal pressure, or an individualized whale reconstruction. Species names identify the call pattern and scale prior, not a validated digital twin.

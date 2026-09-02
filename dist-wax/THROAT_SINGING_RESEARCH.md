# Throat Singing Synthesizer: research and implementation ledger

Research checked 2026-09-02. This document records why the instrument is modeled as it is. It is not a singing tutorial, a vocal-health guide, or a claim that a browser synthesizer reproduces culturally situated performance.

## Terminology and scope

- **Xöömei / khöömei** can name Tuvan throat singing generally and a particular middle-register Tuvan style. The interface uses `Xöömei / Khöömei` for the named Tuvan preset and explains the ambiguity.
- **Sygyt**, **Xöömei**, and **Kargyraa** are the three core Tuvan starting points represented here. **Borbangnadyr** and **Ezengileer** are treated as characteristic embellishments, not unrelated vocal organs or globally fixed waveforms.
- **Mongolian Khöömei** is a living tradition with its own terminology, transmission, and social contexts. UNESCO groups its many techniques into deep `kharkhiraa` and whistled `isgeree Khöömei`. These facts inform the model but do not make a Tuvan-labelled preset “Mongolian.”
- **Western overtone singing** is a separately labelled comparison preset because its focused-harmonic acoustics provide useful independent evidence for F2/F3 clustering.
- **Inuit katajjaq / katajjaniq is not part of this preset family.** Avataq describes katajjaq as throat songs executed by two singers, usually women, and katajjaniq as a traditional game and women’s oral tradition in Nunavik. That paired, interactive form is structurally and culturally different from this solo sustained-drone instrument; no “Inuit” preset is provided.

## Local implementation audit

| Local instrument | What is useful | Decision for this page | Important limit |
| --- | --- | --- | --- |
| **Throatazoid / Pink Trombone lineage** (`throatazoid.html`, `src/throatazoid.js`, `src/throatazoid-tract-processor.js`) | A 44-section bidirectional travelling-wave tract, tongue/lip constrictions, nasal branches, turbulence and release transients; internal glottal periodic-wave and aspiration sources. | Keep the 44-section tract convention and shared audio-output/unlock infrastructure. Use one human airway and make the two research-motivated constrictions explicit. | The live engine helpers are private to `throatazoid-app.js`; the tract is a reduced 1-D circular-equivalent tube, not a measured three-dimensional singer anatomy. |
| **Pink Trombonazoid** (`pink-trombonazoid.html`, `src/pink-trombonazoid.js`, `src/spelling-synthesizer-audio.js`) | Immutable phoneme/event compilation, editable automation lanes, and the same Throatazoid worklet driven by several harmonic glottal sources. | Reuse its smooth event/control-update discipline only if a phrase sequencer is added later. | Its public façade is word/phone-centric and its `TubeSpellingEngine` is private; it is the wrong primary API for continuous overtone gestures. |
| **Hybrinx** (`hybrinx.html`, `src/hybrinx-timeline.js`, `syrinx-app.js`, `src/syrinx-processor.js`) | Immutable gesture curves; pressure/tension/adduction controls; a physical source feeding a variable-area waveguide; accessible resizable performance layout. | Borrow the gesture-language idea for overtone motion and pressure pulses. Keep throat-specific state in a dedicated module. | Hybrinx is a mode inside the large Syrinx app. Its timeline is coupled to animal calls, tongue state and DOM IDs, and its CSS depends on a five-file cascade. |
| **Jaw Harp** (`jaw-harp.html`, `src/jaw-harp.js`, `src/jaw-harp-processor.js`, `jaw-harp-app.js`) | Clean page/app/pure-model/worklet separation, robust lazy audio startup and page lifecycle, harmonic focus display, and formant/resonator controls. | Follow its architecture and lifecycle pattern; keep the drone and selected harmonic simultaneously legible. | Its source is a 96-mode metal reed plus resonators. That is a useful overtone-interface reference, not a human larynx model. |

There is no local `pink-trombone.html`: **Throatazoid** is the direct live Pink Trombone-inspired tract, while **Pink Trombonazoid** is the word/phoneme sequencer built on that tract.

## Evidence ledger

### Sygyt: stable harmonic source, sharply focused tract

Bergevin et al. combined audio, dynamic MRI and transmission-line modeling for Sygyt-style Tuvan singing. The glottal harmonic array remained stable through the focused transition, with little evidence of subharmonics; a linear source-filter explanation was sufficient. Singers brought upper formants together into a narrow focus, principally in the 1–2 kHz octave band. Modeling identified two useful articulatory regions: an alveolar/oral constriction governing the sharp focused state and a uvular/upper-pharyngeal constriction helping move its frequency. Small tract changes can therefore create a large spectral transition.

**Mapping decision:** do not synthesize Sygyt as a drone plus an independent whistle oscillator. Generate one periodic, harmonic-rich true-fold source; retain a low/drone path; tune a paired F2/F3 focus to an integer harmonic of that same source. The Sygyt starting point is true folds `150 Hz`, division `1`, heard drone `150 Hz`, `H12`, and focus `1.8 kHz`, matching the paper’s worked model scale. Harmonic buttons remain a tract-filter gesture, not additional notes.

### Xöömei and named Tuvan styles: practitioner terminology

Alash’s practitioner-facing account calls Sygyt a high, sharp whistled style; Xöömei a middle-range style with an airy whistle; and Kargyraa a low style with a growling undertone and upper overtones. It explicitly says Xöömei is both a particular style and a general term. The Alash *Achai* terminology notes further characterize Xöömei as keeping drone and overtones at more comparable levels, Sygyt as reinforcing the high melody while muting the drone, and Kargyraa as involving the false vocal folds.

**Mapping decision:** Xöömei uses a wider/weaker focus and more audible source body than Sygyt: true folds `145 Hz`, division `1`, `H9` (`1305 Hz`), convergence `0.88`, bandwidth `105 Hz`, breathiness `0.12`, roughness `0.16`. These are playable defaults, not measured population means.

### Kargyraa: synchronized ventricular-fold period division

Lindestad et al. used high-speed imaging, spectra and inverse filtering on one male singer. The true vocal folds kept their original repetition rate, while the ventricular (false) folds closed at half that frequency and reduced every second airflow pulse, adding subharmonics. Sakakibara et al. subsequently modeled the true and false folds as two coupled pairs of masses separated by a laryngeal ventricle. Varying false-fold adduction reproduced pressed and period-two/period-three Kargyraa-like regimes.

**Mapping decision:** Kargyraa is not an unrelated octave-down oscillator. The preset uses true folds `120 Hz`, division `2`, heard drone `60 Hz`, false-fold coupling `0.92`, and `H16` of the heard drone (`960 Hz`). A phase-locked ventricular mask suppresses part of every second true-fold pulse, exposing an actual `60 Hz` source component. At zero coupling the identical pulses still repeat at `120 Hz`, so the display does not claim that an inaudible armed division is the heard pitch. The reduced model does **not** claim to implement the ICMC paper’s complete 2×2 tissue model.

Fan et al. (2025) combined endoscopy and spectral analysis across 18 Inner Mongolian Hoomei productions. They report that contacting false folds may form a dual source in some productions and separately confirm posterior vocal-tract narrowing in an examined production. Warner and Johnson (2026) measured one trained male singer and found greater airflow, peak pressure, and intensity in Kargyraa and mixed ventricular-fold distortion than in modal true-fold phonation. These are useful mechanism and control-direction results, not population norms.

**Mapping decision:** coupling also narrows the lowest epilaryngeal sections so `1:1` coupling changes timbre instead of becoming a near-no-op. The pressure control remains freely playable; the one-participant 2026 ratios are not copied into the presets. Division `4–7` is available only as an explicitly extended rough-effects range, while named Tuvan presets remain at `1` or `2`.

### Tongue, whistle-like percept, and actual whistles

The tongue is an articulator, not the high sound source in this model. In Sygyt and overtone singing, tongue, jaw, lip, and pharyngeal geometry tune resonances that select harmonics already present in the glottal source. Calling the control “whistle tone” would blur this source/filter distinction. By contrast, bilabial oral whistling uses an air jet and an oral Helmholtz-like resonator; tongue position changes the resonant cavity. “Whistle register” is yet another term: 2024 high-speed imaging of operatic sopranos found tissue-driven vocal-fold collision rather than an aerodynamic whistle mechanism.

**Mapping decision:** the canvas handle is `Overtone focus`; “whistle-like” remains a description of the percept. There is no independent whistle oscillator.

### Breath intake versus inspiratory phonation

Ordinary audible intake is principally turbulent, unvoiced flow through an open glottis. Inspiratory phonation is a distinct extended technique in which the folds vibrate during inward flow. Vanhecke et al. found an inverted mucosal wave, lower closed quotient, greater noise, and a steeper harmonic slope during trained inspiratory phonation; MRI work also reports posture changes in the tongue, epiglottis, mouth floor, and teeth.

**Mapping decision:** releasing the drone can play a `460 ms` voiceless noise envelope with weak `500 Hz` and `1.55 kHz` resonances. It bypasses the overtone-focus branch and is explicitly labelled a perceptual proxy, not reversed airflow through the one-dimensional waveguide and not inspiratory singing. `Aspiration` remains noise during exhaled phonation.

### Borbangnadyr and Ezengileer: overlays, not source engines

Alash describes Borbangnadyr as a rolling/trilling embellishment of Sygyt or Xöömei with rapidly changing harmonics, and Ezengileer as a pulsing, stirrup/horse-associated embellishment. Its *Achai* notes associate Borbangnadyr with a lip/tongue warble and Ezengileer with soft-palate articulation and a metallic pulse. Neither description establishes one universal oscillator rate or waveform.

**Mapping decision:** both presets start from a Xöömei-like single source and move focus and level. Borbangnadyr uses `H9`, a `5.4 Hz` triangle motion, focus-motion depth `0.42`, and amplitude-motion depth `0.24`. Ezengileer uses `H10`, a deliberately labelled synthetic two-pulse “stirrup” shape at `2.6 Hz`, focus-motion depth `0.28`, and amplitude-motion depth `0.34`. They must remain usable as ornaments over a base style; those rates and shapes are interface interpretations, not transcriptions or definitions of the traditions.

### Western overtone singing: independent F2/F3 evidence

Sundberg, Lindblom and Hefele’s one-singer MRI/inverse-filtering case study found that overtone enhancement resulted from close clustering of F2 and F3. The back cavity strongly governed F2, while the tongue-tip/lip-defined front cavity acted approximately as a Helmholtz resonator governing F3. Tongue configuration changed with the selected overtone.

**Mapping decision:** the separately labelled `Western overtone — comparison` preset uses the same one-source/two-resonance mechanism but a wider, softer focus: true folds `140 Hz`, `H10` (`1.4 kHz`), convergence `0.76`, bandwidth `142 Hz`, false-fold coupling `0.04`. It does not stand for every Western overtone school.

### Mongolian traditions: related acoustics, distinct heritage

UNESCO’s Mongolian nomination describes a continuous drone plus a harmonic melody shaped by mouth-cavity size, lip opening and tongue movement. It distinguishes deep `kharkhiraa`, emphasizing an undertone/subharmonic an octave below, from whistled `isgeree Khöömei`, emphasizing overtones above the drone. It also documents oral/master-apprentice transmission and performance contexts.

**Mapping decision:** those descriptions corroborate the page’s period-division, harmonic-focus, tongue and lip controls, but no preset is relabelled as an authentic Mongolian rendition. Future Mongolian presets require separate practitioner-led research and terminology review.

### Heritage context and katajjaq boundary

Lamazhaa and Suzukey describe Tuvan Khöömei as living intangible heritage maintained by Tuvan research and cultural institutions, orally transmitted and changing, and present in both traditional and contemporary fused forms. This argues against presenting DSP defaults as canonical or “authentic.” Avataq’s institutional descriptions establish that Nunavik katajjaq/katajjaniq is normally a paired throat-song/game tradition, usually associated with women, rather than this interface’s solo drone-plus-focused-harmonic mechanism.

**Mapping decision:** every named Tuvan preset carries `research-informed approximation` metadata. The page calls non-Tuvan sounds “comparisons,” contains no authenticity score or vocal-production instructions, and does not collapse katajjaq into an overtone-singing menu item.

### New articulatory copy-synthesis result

Cámara et al.’s 2026 preprint uses a differentiable Kelly–Lochbaum waveguide, cubic B-spline tract parameterization, spatially varying damping, and an added sublingual source. On 20 segments from two Sygyt datasets (five singers, ten pitches), it reports a 30–38% log-spectral-distance reduction from its articulatory baseline and better recovery of the merged-formant region.

**Mapping decision:** keep a full tract area profile and spatial loss rather than only a graphic equalizer. Any `Sublingual branch` control is explicitly experimental and may add a filtered secondary branch for timbral reach; it is not presented as settled Sygyt anatomy. The shipped tract remains a deterministic, hand-authored real-time approximation rather than the paper’s per-recording differentiable optimizer.

### Source-filter coupling and speculative extensions

Titze's nonlinear source-filter theory shows that epilaryngeal area changes the acoustic load seen by the glottis; sufficiently strong coupling can reshape flow, change efficiency, or contribute to jumps, subharmonics, and instability. Later sensitivity and three-dimensional computational studies reinforce that the location and degree of constriction matter, while warning that constriction does not simply make every source stronger. Traser et al.'s 2026 one-singer pilot further found systematically different tract configurations across undertone, distortion, growl, and rattle mechanisms.

**Mapping decision:** human controls stay conservative and feed-forward. The collapsed `Beyond anatomy` panel is clearly separated from named styles: `Parallel airways` forks the existing source into up to four safely normalized outlets; `Supra-human focus` raises resonator Q and boost behind the compressor; `Instability proxy` combines incommensurate modulation but does not claim deterministic chaos or a tissue bifurcation model. These controls are sound-design extrapolations, not anatomy or tradition labels.

## Exact synthesis mappings

The pure model lives in `src/throat-singing.js`. Its named values are immutable starting points and carry approximation notices.

### Frequency and focus

```text
closurePatternHz = trueFoldHz / falseFoldDivision
heardDroneHz = closurePatternHz when division > 1 and coupling is audible; otherwise trueFoldHz
selectedHarmonicHz = heardDroneHz * round(harmonicNumber)
separationHz = formantSeparationHz * (1 - formantConvergence)^1.28
uvularSkewHz = (uvularConstriction - 0.5) * separationHz * 0.08
F2 = selectedHarmonicHz - separationHz/2 + uvularSkewHz
F3 = selectedHarmonicHz + separationHz/2 + uvularSkewHz
merged = (F3 - F2) <= focusBandwidthHz
displayFocusGainDbApprox = 3 + 13 * formantConvergence
```

The model accepts true-fold frequency `50–360 Hz`, integer period division `1–7`, and integer harmonic `H4–H24`; the page exposes `55–360 Hz`, division `1–7`, and `H4–H20`. Focus is continuously movable but snaps its labelled target to the harmonic series. Divisions above `3` are never loaded by a named cultural preset.

| Preset | True folds / division | Heard drone | Harmonic focus | Convergence / bandwidth | False-fold coupling | Named motion |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Sygyt | 150 Hz / 1 | 150 Hz | H12 / 1800 Hz | 0.97 / 58 Hz | 0.04 | 0.72 Hz sine, depth 0.06 |
| Xöömei / Khöömei | 145 Hz / 1 | 145 Hz | H9 / 1305 Hz | 0.88 / 105 Hz | 0.04 | 0.58 Hz sine, depth 0.08 |
| Kargyraa | 120 Hz / 2 | 60 Hz | H16 / 960 Hz | 0.70 / 168 Hz | 0.92 | 0.90 Hz sine, depth 0.08 |
| Borbangnadyr | 140 Hz / 1 | 140 Hz | H9 / 1260 Hz | 0.86 / 112 Hz | 0.04 | 5.4 Hz triangle, depth 0.42 |
| Ezengileer | 132 Hz / 1 | 132 Hz | H10 / 1320 Hz | 0.84 / 122 Hz | 0.04 | 2.6 Hz stirrup, depth 0.28 |
| Western overtone — comparison | 140 Hz / 1 | 140 Hz | H10 / 1400 Hz | 0.76 / 142 Hz | 0.04 | 0.45 Hz sine, depth 0.07 |
| Low chant — comparison | 82 Hz / 1 | 82 Hz | H8 / 656 Hz | 0.24 / 280 Hz | 0.12 | 0.32 Hz sine, depth 0.04 |

### Tract geometry and waveguide

- Use `44` circular-equivalent sections across a controllable `13–22 cm` tract.
- Place the upper-pharyngeal/uvular Gaussian constriction at `7.5 cm`, radius `1.05 cm`, with a `0.20 cm²` minimum-area target.
- Place the alveolar/oral Gaussian constriction at `13.0 cm`, radius `0.72 cm`, with the eLife worked-example minimum-area target `0.09 cm²`.
- Place the anterior expansion at `14.75 cm`, radius `0.90 cm`, adding up to `2.1 cm²` before the lips.
- Map the lip area as `(0.42 + 2.25 * mouthOpening) * (1 - 0.42 * lipRounding)` and clamp all section areas to `0.045–12 cm²`.
- At each junction, use reflection `(A_left - A_right) / (A_left + A_right)`, clamped to `±0.999`.
- Map glottal reflection to `0.74 + 0.08 * foldTenseness`; lip reflection to `-0.82 - 0.10 * lipRounding`; spatial/junction retention to `clamp(0.9994 - 0.0007 * breathiness - 0.00045 * roughness, 0.996, 0.9995)`.
- Smooth all interactive audio changes. The focused branch and audible low body are normalized before the output compressor/ceiling so increasing convergence does not create an unsafe level jump.

### Control semantics

| UI concept | DSP parameter | Meaning |
| --- | --- | --- |
| Drone pitch | `trueFoldHz` | True-fold repetition rate; not always the heard low pitch in a divided Kargyraa state. |
| Ventricular coupling | `falseFoldCoupling` | Depth of synchronized alternate/periodic pulse suppression and rough color. |
| Closure period | `falseFoldDivision` | Integer period relationship; `2` yields a heard drone one octave below the true-fold repetition rate. |
| Breath pressure | `intensity` | Source drive and level, with bounded gain compensation. |
| Adduction / pressedness | `foldTenseness` | Pulse sharpness, high-harmonic supply and glottal reflection. |
| Aspiration / roughness | `breathiness`, `roughness` | Noise and small loss/jitter terms, not additional pitches. |
| Selected overtone | `harmonicNumber` | Integer partial of the heard drone used as the F2/F3 target. |
| Overtone focus | `harmonicNumber`, `alveolarConstriction`, `formantConvergence` | Tongue/jaw/lip/pharynx-driven selection and Q-like merger of existing harmonics. |
| Pharynx / overtone position | `uvularConstriction` | Moves/skews the focus and deforms the rear cavity. |
| Lips / front cavity | `mouthOpening`, `lipRounding`, `frontCavityExpansion` | Front-cavity/F3 color and radiation. |
| Ornament | `motionShape`, `motionRateHz`, `motionDepth`, `amplitudeMotionDepth` | Bounded synchronized tract and level movement. |
| Audible inhale | `inhaleAudibility` | A one-shot, voiceless filtered-noise intake after release; not inspiratory phonation. |
| Beyond anatomy | `phantomAirways`, `impossibleFocus`, `sourceInstability` | Explicitly fictional multi-outlet, hyper-focused, and quasiperiodic extensions. |

## Model limitations and non-claims

1. **Not an authenticity model.** Named defaults are audible hypotheses selected from acoustic, anatomical and practitioner descriptions. They are not measurements of an average Tuvan, Mongolian, Inuit, or Western singer and cannot encode pedagogy, language, repertoire, place, social function or embodied expertise.
2. **Evidence is small and style-specific.** The Kargyraa imaging result is from one male singer; the Western MRI paper is a one-singer case study. The eLife Sygyt result must not be generalized to all Xöömei or throat-singing mechanisms.
3. **Reduced larynx.** Periodic pulse suppression approximates ventricular-fold coupling but omits the ICMC 2×2 model’s four moving masses, pressure-dependent self-oscillation, tissue collision, ventricle aerodynamics and possible period-three regimes.
4. **Reduced airway.** A 1-D, 44-section circular-equivalent tube cannot reproduce three-dimensional lateral channels, exact tongue shape, piriform fossae, dynamic epilaryngeal geometry, teeth, detailed nasal coupling, radiation or individual anatomy. The hand-authored Gaussian centers are model landmarks, not universally fixed human coordinates.
5. **Formant helper, not proof.** The paired focus stage intentionally stabilizes and exposes F2/F3 convergence. Its bandwidth and displayed gain estimate are design controls, not outputs of a validated inverse vocal-tract solver.
6. **Experimental sublingual branch.** The 2026 preprint shows copy-synthesis benefit in its system; it does not establish a second sublingual biological oscillator. Keep the branch labelled experimental and removable.
7. **Main-thread gestures are approximate.** UI-rate motion is smoothed into the audio graph; it is not a sample-accurate biomechanical simulation. Fast source coupling belongs in the AudioWorklet.
8. **No vocal-health inference.** The synthesizer must not tell users how to force ventricular-fold phonation or imply that matching a control position is safe technique.
9. **Katajjaq remains out of scope.** A credible katajjaq work would need a separate two-performer, alternating/interactive design and Inuit-led sources. Avataq’s cited lexicon alone supports the two-singer/usually-women description, not a detailed aerodynamic model.
10. **The inhale is not reverse-flow CFD.** It is a short source-filter noise model outside the voiced tract path; it makes performance breathing audible without pretending that the worklet changes aerodynamic direction.
11. **The creature lab is intentionally impossible.** Multiple parallel mouths and supra-human resonator Q are bounded synthesis affordances, not claims about human or animal anatomy. The “instability” control is a proxy, not proof that a chaotic attractor is being simulated.

## Source register

### Acoustics, anatomy and physical modeling

- Christopher Bergevin et al., “Overtone focusing in biphonic Tuvan throat singing,” *eLife* 9:e50476 (2020): <https://elifesciences.org/articles/50476> — DOI <https://doi.org/10.7554/eLife.50476>
- P.-Å. Lindestad, M. Södersten, B. Merker and S. Granqvist, “Voice source characteristics in Mongolian ‘throat singing’ studied with high-speed imaging technique, acoustic spectra, and inverse filtering,” *Journal of Voice* 15(1), PMID 12269637 (2001): <https://pubmed.ncbi.nlm.nih.gov/12269637/>
- Ken-Ichi Sakakibara, Hiroshi Imagawa, Seiji Niimi and Naotoshi Osaka, “Synthesis of the laryngeal source of throat singing using a 2×2-mass model,” *Proceedings of ICMC 2002*, pp. 5–8: <https://quod.lib.umich.edu/i/icmc/bbp2372.2002.002/--synthesis-of-the-laryngeal-source-of-throat-singing-using?rgn=main%3Bview%3Dfulltext> — stable handle <http://hdl.handle.net/2027/spo.bbp2372.2002.002>
- Johan Sundberg, Björn Lindblom and Anna-Maria Hefele, “Voice source, formant frequencies and vocal tract shape in overtone singing. A case study,” PMID 34860148: <https://pubmed.ncbi.nlm.nih.gov/34860148/> — DOI <https://doi.org/10.1080/14015439.2021.1998607>
- Mateo Cámara, María Pilar Daza-Llin, Fernando Marcos-Macías and José Luis Blanco, “Differentiable Articulatory Copy-Synthesis of Biphonic Singing,” arXiv:2606.04943 (2026): <https://arxiv.org/abs/2606.04943>
- Rui Fan et al., “Physiological Basis of Polyphonic Overtones in Hoomei—False Vocal Folds or Vocal Tract Resonance?”, *Journal of Voice* (2025), PMID 40410061: <https://pubmed.ncbi.nlm.nih.gov/40410061/> — DOI <https://doi.org/10.1016/j.jvoice.2025.04.032>
- Geddy Warner and Aaron M. Johnson, “Increased Respiratory Drive in Sustained Ventricular Vocal Fold Phonation,” *Journal of Voice* (2026), PMID 42025569: <https://pubmed.ncbi.nlm.nih.gov/42025569/> — DOI <https://doi.org/10.1016/j.jvoice.2026.03.035>
- Per-Åke Lindestad et al., “Ventricular fold vibration in voice production,” *Logopedics Phoniatrics Vocology* 29(4) (2004), PMID 15764210: <https://pubmed.ncbi.nlm.nih.gov/15764210/>
- Christian T. Herbst et al., “Freddie Mercury—acoustic analysis of speaking fundamental frequency, vibrato, and subharmonics,” *Logopedics Phoniatrics Vocology* 42(1) (2017), PMID 27079680: <https://pubmed.ncbi.nlm.nih.gov/27079680/>
- Ingo R. Titze, “Nonlinear source–filter coupling in phonation: Theory,” *Journal of the Acoustical Society of America* 123(5) (2008): <https://pmc.ncbi.nlm.nih.gov/articles/PMC2811547/>
- Louisa Traser et al., “Vocal tract configuration and acoustic transfer characteristics in mechanisms of extreme vocal styles—A pilot study,” *Journal of the Acoustical Society of America* 160(2) (2026), PMID 42627765: <https://pubmed.ncbi.nlm.nih.gov/42627765/>
- Daniel Azola et al., “The physiology of oral whistling: a combined radiographic and MRI analysis,” *Journal of Applied Physiology* 124(1) (2018), PMID 28839006: <https://pubmed.ncbi.nlm.nih.gov/28839006/>
- Matthias Echternach et al., “Biomechanics of sound production in high-pitched classical singing,” *Scientific Reports* 14 (2024), PMID 38849382: <https://pubmed.ncbi.nlm.nih.gov/38849382/>
- Françoise Vanhecke et al., “Physiology and Acoustics of Inspiratory Phonation,” *Journal of Voice* 30(6) (2016), PMID 26706750: <https://pubmed.ncbi.nlm.nih.gov/26706750/>
- Louisa Traser et al., “Vocal Tract Morphology in Inhaling Singing: An MRI-Based Study,” *Journal of Voice* 31(3) (2017), PMID 26122925: <https://pubmed.ncbi.nlm.nih.gov/26122925/>
- Stefan Werner et al., “Inhalation Duration and Speech Intensity,” *Interspeech 2021*: <https://www.isca-archive.org/interspeech_2021/werner21_interspeech.html>

### Practitioner terminology and living heritage

- Alash Ensemble, “About Tuvan Throat Singing” (style descriptions and audio demonstrations): <https://www.alashensemble.com/about_tts.htm>
- Alash, *Achai* liner notes, “Tuvan Throat-Singing Terminology,” annotated by Sean Quirk, Smithsonian Folkways SFW CD 40578 (2017): <https://www.alashensemble.com/CDs/Achai_liner-notes.pdf>
- Chimiza K. Lamazhaa and Valentina Yu. Suzukey, “Tuvan throat singing as intangible cultural heritage and as Tuva’s cultural brand,” *The New Research of Tuva* 2 (2019): <https://nit.tuva.asia/nit/en/article/view/846> — DOI <https://doi.org/10.25178/nit.2019.2.6>
- UNESCO Intangible Cultural Heritage, “Mongolian traditional art of Khöömei,” Representative List No. 00396 (inscribed 2010): <https://ich.unesco.org/en/RL/mongolian-traditional-art-of-khoomei-00396> — nomination form <https://ich.unesco.org/doc/src/07531-EN.pdf>
- Avataq Cultural Institute lexicon, `katajjaq, katajjait`: <https://www.avataq.qc.ca/en/Nunavimmiuts/The-land/Lexicon>
- Avataq Cultural Institute, “Katajjaniq, the Inuit throat singing, designated as the first element of Québec’s intangible heritage” (2014): <https://www.avataq.qc.ca/en/content/view/full/2949>

# Synthesaurus sequence compendium

Synthesaurus includes a second, independent compendium of sequence and
arpeggiator studies. Select one study, press the existing Play control, and then
move through synthesis methods and presets without replacing the phrase. This
makes changes in synthesis easier to compare against one repeatable musical
input.

The studies are newly authored. They demonstrate documented mechanisms from
player-piano rolls, drawn and punched control media, voltage-stage sequencers,
early digital memory, classic held-chord arpeggiators, MIDI workstations,
interactive generative software, pattern languages, and modern per-step
probability. They do **not** copy factory patterns, proprietary ROM data,
archived performances, product interfaces, or recognizable musical phrases.

## Historical map

Dates below identify documented systems, publications, or product milestones.
They are not claims that one person or product exclusively invented a broad
technique. Period headings organize editorial placement; each picker entry
separately displays only the milestone year or years established by its cited
sources. An undated mechanism document never supplies a date.

| Period | Documented anchors | Mechanisms used in the playable studies |
| --- | --- | --- |
| 1947–1964 · postwar rolls, drawings, and computer scores | [Conlon Nancarrow's player-piano practice](https://brahms.ircam.fr/en/conlon-nancarrow); [Grainger Museum Free Music machines](https://grainger.unimelb.edu.au/explore/collections/grainger-museum-collection/free-music-machines); [RCA Mark II institutional history](https://magazine.columbia.edu/article/how-robert-moog-launched-music-electronic-age); [Mathews, *An Acoustic Compiler* (1961)](https://archive.org/download/bstj40-3-677/bstj40-3-677.pdf) | Tempo-ratio canons, accelerating rolls, drawn contours, discrete parameter rows, and stored computer-score events |
| 1965–1977 · voltage stages and digital memory | [Buchla history](https://buchla.com/history/); [Cornell's 1968 Moog 960 archive records](https://archives.library.cornell.edu/repositories/2/resources/2099) and [1972 Moog 960 mechanism catalog](https://moogfoundation.org/wp-content/uploads/1972-Moog-Music-Catalog-1.pdf); [Mathews and Moore on GROOVE](https://doi.org/10.1145/362814.362817); [Oberheim historical products](https://www.tomoberheim.com/historical-products); [Sequential history](https://sequential.com/about-dave-smith/); [Roland MC-8 chronology](https://www.roland.com/global/company/history/) | Independent voltage rows, stage addressing, clock division, captured gestures, numeric event entry, transposition, and compact phrase memory |
| 1978–1985 · classic arpeggiators and step sequencers | [Roland Jupiter-4 account](https://www.roland.com/us/products/rc_jupiter-4/); [TR-808 owner's manual](https://cdn.roland.com/assets/media/pdf/TR-808_OM.pdf); [SH-101 owner's manual](https://cdn.roland.com/assets/media/pdf/SH-101_OM.pdf); [MIDI history](https://midi.org/midi-history-chapter-6-midi-begins-1981-1983) | Rising, falling, and pendulum chord traversal, octave-range stress studies, latch-like repetition, step accents, fills, pattern chains, compact step entry, and synchronized event streams |
| 1986–1999 · MIDI, workstations, and generative software | [Eventide and Laurie Spiegel's Music Mouse account](https://www.eventideaudio.com/software/music-mouse/); [Korg M1 account](https://www.korg.com/us/products/software/kc_m1/); [Korg WAVESTATION account](https://www.korg.com/us/products/software/kc_wavestation/index.php); [Reunanen’s tracker history](https://widerscreen.fi/assets/Reunanen2024.pdf) and [MOD structure](https://wiki.multimedia.cx/index.php/Protracker_Module); [SSEYO Koan archive](https://intermorphic.com/archive/sseyo/koan/); [Nord Modular legacy account](https://www.nordkeyboards.com/legacy-products/nord-modular/) | Interactive pitch fields, arranged patterns, tracker rows and effect fields, bounded generative rules, modular clock logic, and nested or transformed phrases |
| 2000–present · pattern languages and probability | [SuperCollider project history](https://supercollider.github.io/) and [Pattern Guide](https://docs.supercollider.online/Tutorials/A-Practical-Guide/PG_01_Introduction.html); [Toussaint on Euclidean distribution](https://archive.bridgesmathart.org/2005/bridges2005-47.html); [Ableton Live 8 groove-engine release](https://www.ableton.com/en/press/press-archive/press-archive-release-8/); [Elektron Digitakt manual](https://www.elektron.se/wp-content/uploads/2025/07/Digitakt-User-Manual_ENG_OS1.52A_250708.pdf); [TidalCycles history](https://tidalcycles.org/docs/around_tidal/tidal_history/); [Bitwig Studio 4.0 Operators release](https://downloads.bitwig.com/stable/4.0/Release-Notes-4.0.html); [Strudel getting-started guide](https://strudel.cc/learn/getting-started/) | Pattern algebra, Euclidean pulse distribution, groove offsets, step-local state, deterministic chance, recurrence conditions, polymetric nesting, and live transformation |

Traditional rhythmic practices substantially predate the computer algorithms
that later described or distributed pulses mathematically. The Euclidean
studies therefore use neutral, original pitch material and do not label an
algorithm as the inventor of a culture's rhythm.

## Play and state contract

- `Direct note · current Play behavior` leaves the established Synthesaurus
  hold/repeat demonstration unchanged.
- A selected study uses the same Play button and the existing Frequency, Tempo,
  and Voicing controls. Its own cycle panel exposes steps, step length,
  transpose, density, swing, gate, seed, pitch mapping, and controls specific to
  its mechanism. Audio activation remains a separate user action.
- Sequence choice, per-study parameter edits, and phase are performance state,
  not sound-preset state. Method changes, preset recall, and sound randomization
  leave them intact. Switching away from a study and back restores its current
  session edits; the active study and edits are also encoded in the page URL.
- Processing temporarily owns Play and hides sequence controls; the selected
  study remains available when returning to Synthesis.
- The displayed step follows the audio-clock cursor. Animation frames are never
  the event scheduler.
- Random or conditional studies use an explicit integer seed so the same study
  can be repeated while comparing sounds.

## Implementation and limits

[`sequence-chronology.js`](../src/instruments/synthesis/sequence-chronology.js)
contains source-level milestones and limitations. [`sequence-catalog.js`](../src/instruments/synthesis/sequence-catalog.js)
contains each study's qualified placement, mechanism, authorship review, and limitations. [`sequence-parameters.js`](../src/instruments/synthesis/sequence-parameters.js)
defines bounded common and mechanism-specific controls without mutating the
catalogue, and [`sequence-compiler.js`](../src/instruments/synthesis/sequence-compiler.js)
turns the resulting configuration into a finite beat-addressed cycle. The app
then resolves its pitch coordinates through the selected tuning and sends
explicit ratios to the AudioWorklet.

Compiled input is deliberately bounded to 64 steps and eight simultaneous notes
per step. Non-finite values, unsafe pitch offsets, velocities, gates, cycle
lengths, and tempos are sanitized again in the AudioWorklet. The Worklet owns
event timing and sequence voices; the existing Rust/WASM synthesis engines and
their public ABI are unchanged. Stop, panic, processor entry, and page exit
clear sequence-owned deadlines without taking ownership of physically held
keyboard or MIDI notes. Audio Off mutes the master while the logical transport
continues, so Audio On rejoins the current beat instead of restarting the cycle.

Focused checks are available through `npm run test:synthesis`; browser
interaction and responsive coverage live in `e2e/synthesis.spec.mjs`.

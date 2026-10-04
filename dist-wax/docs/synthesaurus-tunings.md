# Synthesaurus tuning and note maps

Synthesaurus resolves every playable note to a floating-point frequency before it reaches the Rust synthesis engine. The **Tuning / note map** menu therefore applies to every current synthesis method without changing its DSP implementation. It controls the on-screen/computer keyboard, incoming MIDI notes, the Poly Trigger chord, the three basic tuning arpeggios, and all 62 sequence studies. Processing methods keep the choice ready but do not use it.

The frequency knob remains continuous: it is the root for keyboard, Trigger, and Play. Incoming MIDI uses consecutive degrees of the selected map, anchored at MIDI note 69 = 440 Hz. Within the engine's playable range, the default **12-EDO chromatic** mapping preserves the former twelve-tone frequency ratios. Notes outside 20–8,000 Hz are rejected rather than flattened at a boundary; each basic demonstration chord is period-folded as one voicing so its intervals and order remain distinct.

**Direct note** preserves the former held-note or repeated-note Play behavior. **Tuning chord · up**, **down**, and **up–down** retain the compact chord traversals from the first tuning implementation. The other 62 choices use the full beat-addressed arpeggiator/sequence compiler. Each study exposes **Nearest tuning note**, **Continuous tuning contour**, and **Original pitch contour** mapping: discrete patterns default to nearest notes, while drawn and captured gestures default to interpolation between tuning degrees. Tempo, parameters, root, and live tuning changes preserve the running transport. A sounding keyboard or MIDI note keeps its resolved frequency until release; subsequently played notes use the new map. Tuning, sequence, voicing, output, and transport are performer choices and are not overwritten by synth presets, Next, or Random.

## What the menu represents

The menu deliberately combines several useful but different objects:

- A **tuning** defines pitches and a repeating period, such as 19-EDO or a 5-limit ratio lattice.
- A **note map** selects and orders pitches from a tuning, such as major, whole-tone, Japanese yō, or Amhara Tizita.
- A **teaching model** is an explicit mathematical approximation used for comparison. It is not a measurement or claim of cultural authenticity.

There is no meaningful finite list of “all tunings,” and there is no single Asian or African tuning, nor one fixed interval profile representing every Balinese or Javanese ensemble. The catalogue is a sourced starter set with stable IDs and an extensible arbitrary-period representation. Its visible labels say **map** or **teaching model** where that distinction matters.

## Cultural maps and models

| Menu entry | Browser representation | Important limit |
| --- | --- | --- |
| Chinese twelve lü / sanfen sunyi gōng | Fifth-derived historical ratios | The twelve-lü entry is a pitch-sorted reconstruction; historical generation order and pipe names are not represented. It is not a universal Chinese performance tuning. [Harvard Sounding China](https://soundingchina.fas.harvard.edu/Service.html) |
| Japanese yō / descending in (Uehara) | Playable 12-EDO keyboard maps | These reproduce Uehara's 1895 octave-based collections. Ascending *in* may exchange two tones; later theory often uses tetrachords and nuclear tones, and performed intonation is not encoded. [Grove Music Online](https://doi.org/10.1093/gmo/9781561592630.article.43335), [performance context](https://ethnomusicologyreview.ucla.edu/journal/volume/22/piece/1036) |
| Balinese paired ombak (not a scalar menu entry) | Future paired-voice modifier | The cited research documents individual ensemble profiles, paired tuning, ombak, and octave treatment; duplicating the Javanese 5-EDO model under a Balinese label would be misleading. [Gamelan tuning comparisons](https://eamusic.dartmouth.edu/~larry/published_articles/emi_tuning_chart.pdf), [paired-voice research](https://doi.org/10.1080/17459737.2020.1812128) |
| Javanese sléndro / pélog | Idealized 5-EDO and seven-note 9-EDO-subset teaching models | No real ensemble is claimed to match these grids; gamelan sets have individual tunings. [Dartmouth models and measurements](https://eamusic.dartmouth.edu/~larry/published_articles/emi_tuning_chart.pdf), [Central Javanese context](https://music.arts.uci.edu/abauer/148_2018/readings/Brinner_Central_Javanese_Gamelan_Ch_3.pdf) |
| Chopi timbila | 7-EDO teaching model | A Chopi-specific equiheptatonic approximation, never a generic “African tuning.” [UCLA Ethnomusicology Review](https://ethnomusicologyreview.ucla.edu/journal/volume/11/piece/513) |
| Amhara Tizita major / Ambassel | Contemporary 12-EDO keyboard maps | qəñət names, interval transcriptions, variants, and the closed canon are historically debated. [Critical history](https://www.persee.fr/doc/ethio_0066-2127_2013_num_28_1_1539), [Dawit Tegbaru's contemporary keyboard maps](https://music-of-ethiopia.pubpub.org/pub/v1v1u0fy/release/2) |

No Balinese scalar preset ships in this release because the catalogue does not yet contain a named, sourced ensemble profile. A future ombak modifier would model one paired-beating relationship only; it would not reproduce a gamelan or make another scale an authentic Balinese tuning.

Pythagorean, five-limit just intonation, harmonic-series, and equal-division entries use the interval math summarized by [Stanford's tuning notes](https://theory.stanford.edu/~blynn/sound/tuning.html). The quarter-comma meantone chain and the catalogue's future import boundary follow the documented [Scala scale format](https://www.huygens-fokker.org/scala/scl_format.html). [Bohlen–Pierce](https://www.huygens-fokker.org/bpsite/) repeats at a 3:1 tritave, which verifies that the resolver does not assume octave periods.

## MIDI boundary and future extensions

Browser and WAX MIDI input is translated directly from a key number to the selected degree and then to exact internal Hz; note-off retains the original source, channel, and key identity. Synthesaurus does not currently emit tuned notes to external MIDI hardware. Exact external polyphonic microtuning would require a receiver-compatible MIDI Tuning Standard message, MPE/per-note pitch bend, or MIDI 2.0; ordinary channel-wide pitch bend cannot represent independent simultaneous offsets. See the [MIDI Association tuning specification](https://midi.org/midi-tuning-updated-specification).

Likely extensions are paired-voice Balinese ombak, editable MIDI/root anchors, and local Scala `.scl` plus `.kbm` import. Scale pitches and keyboard mapping must be imported together; a scale file alone does not define how physical keys address it. Assigning different arpeggio notes to different Synthesaurus methods is a separate multitimbral change because the current eight-voice bank shares one synthesis method.

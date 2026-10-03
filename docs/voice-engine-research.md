# Voicesaurus: rare and historical engine candidates

Research and integration checked 2026-10-01. [Voicesaurus](../voicesaurus.html)
now has **18 native engine/voice routes**, including actual WASM ports of Sinsy, Gnuspeech, Vizsn,
STK VoicForm, Perry Cook’s Singer, MEA8000, Csound FOF/VOSIM, Pico and HTS.
The remaining entries below are candidates. Speakers and engine choices are
not all distinct synthesis methods. Human listening remains unperformed.

Dates below identify a cited publication, implementation or release. An engine's
release, its underlying technique and its browser port can have different dates.
An existing WASM package establishes a port route; it does not establish that we
have tested its sound, mobile performance or every voice database.

## Strong additions for unusual voices

| Engine | Mechanism and historical milestone | Browser route | Demonstrations worth adding |
| --- | --- | --- | --- |
| **GnuspeechSA / Trillium** | Physical tube-resonance speech with oral/nasal coupling, glottis and frication. Trillium/NeXT lineage in the 1990s; first official GNU release 2015-10-14. | Standalone C++ library with file output; **Integrated WASM port**, native physical controls and five voice models. GPL-3.0-or-later with bundled-data and RapidXML notices. | Continuous speech while changing eight tube radii, tract length, breathiness, glottal pulse and intonation. |
| **Vizsn** | Ville-Matias Heikkilä's unusual small voice engine: resonators, vowel tables, noise and several excitation waveforms. First-release year not established here. | SoLoud contains the full C++ float-buffer renderer under explicit WTFPL terms. **Integrated standalone WASM port**, isolated from native device backends. | Buzzy, airy, burpy and whispered voices; Finnish vowel contrasts. Its simple character mapping is not a general multilingual text frontend. |
| **STK VoicForm** | Four-formant singing instrument with voiced/noise excitation, pitch glide and vibrato. STK lineage dates to 1995; this is not an exact first-release claim for VoicForm. | Small C++ DSP port; exclude RtAudio/RtMidi. MIT-style permissive STK terms; retain excitation-sample provenance. **Integrated** VoicForm/Singer WASM bundle with original shapes/phonemes and direct native notes. | Vowel staircase, vowel held across a scale, whisper-to-voice transition and portamento. SingWave is a component, not another complete TTS engine. |
| **Csound FOF / CHANT lineage** | Windowed sinusoidal bursts with independent pitch and formant controls. CHANT's published account is from 1984. | Official Csound browser/WASM runtime exists. Its FOF is loosely based on a CHANT implementation, not the original CHANT package. **Integrated and verified** real FOF opcode. | Singing vowels, vowel interpolation, choral detuning, independently moving formants and a transition into audible granular pulses. |
| **Csound VOSIM** | Decaying squared-sine pulse groups separated by silence; named system published in 1978. | **Integrated and verified** in the same Csound WASM runtime; a separate method. | Robot vowels, hollow mouth pulses, pulse-count/decay sweeps and buzzy choirs. Preserve valid formant/pitch bounds and remove DC. |
| **Perry Cook Singer / SPASM** | Physically parameterized singing tract with nasal branch, glottis and articulation trajectories. 1989 model paper; 1993 SPASM/Singer account. | Actual distributed algorithm in Snd's `singer.scm`, under Snd's permissive terms. **Integrated C++/WASM translation**, with original tables, attribution and sample-rate validation. | Sustained vowel melody, nasalization, breath, glottal shape, tract morphs and artificial operatic phrases. |
| **MEA8000 model** | Four cascade formants with quantized parameter frames and voiced/noise excitation. Inspected emulator is dated 2006; original chip release year remains unverified here. | MAME has BSD-3-Clause generator code with inline tables and no external phoneme ROM in this implementation. **Integrated extracted WASM generator**, with native quantized parameter-frame notes. | Quantized vowel and pitch ladders, French /y/-like formants, breath frames, stepped versus interpolated robot singing. Input is parameter frames, not text. |
| **SVOX Pico** | Decision-tree statistical-parametric TTS; source API records an initial version on 2009-04-20. Log-F0 and mel-generalized cepstral models feed waveform generation. | Existing `@echogarden/svoxpico-wasm@0.2.0`, about 1.13 MB unpacked before language data. **Integrated browser WASM** with US/UK models. Core/package Apache-2.0; model notices and Debian redistribution analysis are preserved in `vendor/pico/`. | Compare six available locales and statistical speech against formant speech; include whole-sentence rhythm. |
| **VocalTractLab** | Geometric vocal tract, glottal models, acoustics and articulatory gestures. A 2013 published model account is a useful milestone; development is older. | GPL-3.0-or-later C++ backend with C API, separate from desktop UI. Custom WASM port proposed; speaker-model files, rendering cost and mobile memory still need assessment. | Jaw/tongue/lip/velum control, vowel triangle, nasalization, gestures and sung vowel transitions. |

GnuspeechSA uses the original CPU model; its README distinguishes this from the
historical Motorola DSP implementation. Vizsn requires replacing/stopping an
active utterance safely before mutating text. Csound's inspected stable 6.18.7
browser package and core use LGPL terms; newer wrapper metadata must not be
mistaken for the license of its embedded core.

## Additional engines and branches

| Candidate | What it adds | Port and distribution status |
| --- | --- | --- |
| **GamaTTS** | Experimental Gnuspeech descendant with an independently usable articulatory core. | GPL-3.0-or-later. Its C++ library/CLI has no external dependencies; omit the Qt/FFTW/JACK editor. Custom WASM port, data audit and performance checks remain. Same broad family as Gnuspeech. |
| **rsynth** | 1990s Unix speech: Holmes-style phone rules, Klatt-style formants and NRL letter-to-sound rules. Exact first release not established here. | Portable PCM callback; remove native audio and dictionary-library dependencies. The inspected `rhdunn/rsynth` branch has GPL/LGPL provenance, while old branches differ. Pin and inspect files/data rather than calling all rsynth public domain. |
| **SoLoud Speech** | A smaller rsynth-derived formant branch. | C++ buffer rendering is suitable for extraction. SoLoud documents zlib interface code, public-domain/CC0 changes, and uncertainty in the original rsynth attribution. That provenance deserves review before selecting this branch. |
| **KlattSyn** | Direct cascade/parallel formant and voice-quality controls; 2019 browser implementation of the Klatt lineage. | Existing TypeScript/browser implementation; package metadata says MIT, exact source notice still to be audited before bundling. A possible JavaScript exception to the WASM preference. Different from the `klsyn` branch whose original `parwav.c` forbids commercial use. |
| **HTS / Flite+hts_engine** | HMM statistical speech, distinct from current Flite Clustergen. | Modified-BSD C runtime with a Flite English frontend. Inspected CMU ARCTIC SLT HTS model is CC-BY-3.0. **Integrated real WASM port**; SLT here is a different trained model from the Clustergen voice. |
| **Open JTalk** | Japanese frontend plus HTS synthesis; source copyright begins in 2008. | Modified-BSD core, separate MeCab/NAIST dictionary terms, and an inspected CC-BY-3.0 NIT ATR503 M001 voice. Port frontend, dictionaries and runtime together. No browser artifact verified in this pass. |
| **Sinsy, classic HMM branch** | Score-driven singing with notes, lyrics and durations; inspected model release dated 2013-12-25. | Modified-BSD software and inspected CC-BY-3.0 NIT SONG070 F001 model. **Integrated actual WASM port** with native Japanese kana/MusicXML score input, note and tempo editing, and HTS vocoder controls. Separate from newer neural Sinsy services. |
| **Marc LeBrun / CLM `vox`** | Rare musical voice instrument derived from MUS10/CLM. | Snd's distributed translation uses FM in this version. Describe that implementation accurately; do not label it unchanged original waveshaping code. Standalone port not tested. |
| **MBROLA** | Diphone waveform synthesis with explicit pitch contours and durations. Implementation history begins June 1995; first noncommercial release October 1995; MBROLA name March 1996. | AGPL-3.0-or-later core can render files from phoneme commands. Voice databases have separate restrictions, including sale/incorporation conditions; select a specifically permitted database. It needs a text frontend. |
| **SAM** | 1982 home-computer rule-driven voice with mouth, throat, speed, pitch and singing controls. | Existing browser and C implementations. The reverse-engineering project explicitly cannot assign an open-source license. Technical port feasibility is established; redistribution permission is unresolved. |
| **DECtalk archive** | Historical formant TTS with its own frontend and voice behavior. | Public archive links a WASM demo, whose operation could not be verified in this pass. An adequate redistribution grant was not established. Public source availability does not settle that question. |
| **Votrax SC-01 / SC-01-A** | Phoneme-code control of glottal/noise sources and analog-style filters. | BSD-3-Clause MAME generator requires external `sc01.bin`/`sc01a.bin` phoneme ROMs. Those assets need separate provenance. Authored replacement tables would be an explicitly labeled approximation. |
| **SP0256** | Twelve-pole LPC filter and microsequencer, including the familiar AL2 allophone lineage. | BSD-3-Clause MAME decoder, separate speech/allophone ROMs. A licensed or authored dataset is needed; decoder source permission does not establish ROM permission. |
| **Maeda VTCalcs / VTsynth** | Articulatory acoustic model used in DIVA-related work. Lab distributions include actual C code and MATLAB interfaces. | Isolating C from MATLAB/DOS dependencies looks feasible; a redistribution license was not found in the inspected archive. DIVA is a speech motor-control model, not another name for this acoustic backend. |

## What the interface should distinguish

Complete text engines, phoneme engines and singing instruments need different
controls. Text engines should preserve their native sentence timing where
possible. Phoneme engines need a visible pronunciation/timing frontend. Singing
instruments need notes, held vowels and pitch trajectories. Changing a speaker,
language or preset does not create a new synthesis technique.

The integrated ports share a playable English phoneme frontend, held vowels,
native controls and eight presets per addition. Complete sentence APIs are
available in the text-engine runtimes; the shared UI currently joins phonemes.
Sinsy remains a promising route to score-driven singing, and Open JTalk would
add a Japanese frontend. They are not implemented in this pass.

## Primary sources

- Gnuspeech: [GNU project and release history](https://www.gnu.org/software/gnuspeech/), [standalone model and license](https://github.com/mym-br/gnuspeech_sa/blob/master/README.md), [build dependencies](https://github.com/mym-br/gnuspeech_sa/blob/master/CMakeLists.txt), [GamaTTS](https://github.com/mym-br/gama_tts/blob/master/README.md).
- Vizsn/rsynth: [Vizsn source](https://github.com/jarikomppa/soloud/blob/master/src/audiosource/vizsn/soloud_vizsn.cpp), [SoLoud provenance](https://github.com/jarikomppa/soloud/blob/master/docsrc/legal.mmd), [rsynth method/data](https://github.com/rhdunn/rsynth/blob/master/README), [port interface](https://github.com/rhdunn/rsynth/blob/master/PORTING).
- STK: [VoicForm source](https://github.com/thestk/stk/blob/master/src/VoicForm.cpp), [license](https://github.com/thestk/stk/blob/master/LICENSE), [SingWave](https://github.com/thestk/stk/blob/master/include/SingWave.h).
- Csound: [FOF](https://csound.com/docs/manual/fof.html), [VOSIM](https://csound.com/docs/manual/vosim.html), [browser runtime](https://github.com/csound/csound/blob/csound6/wasm/browser/README.md), [core license](https://github.com/csound/csound/blob/develop/COPYING), [CHANT paper](https://doi.org/10.2307/3679810), [VOSIM bibliography](https://ccrma.stanford.edu/~jos/pasp/Bibliography.html).
- Cook/CLM: [Singer algorithm and historical references](https://ccrma.stanford.edu/software/snd/snd/singer.scm), [Snd license](https://ccrma.stanford.edu/software/snd/snd/COPYING), [CLM voice instruments](https://ccrma.stanford.edu/software/snd/snd/clm-ins.scm).
- Pico: [WASM port](https://github.com/echogarden-project/svoxpico-wasm), [parameter model](https://github.com/naggety/picotts/blob/master/pico/lib/picopam.c), [signal generation](https://github.com/naggety/picotts/blob/master/pico/lib/picosig.c), [API date/license](https://github.com/naggety/picotts/blob/master/pico/lib/picoapi.h), [resource integration](https://github.com/echogarden-project/echogarden/blob/main/src/synthesis/SvoxPicoTTS.ts).
- VocalTractLab: [backend/license](https://github.com/TUD-STKS/VocalTractLabBackend), [C API](https://github.com/TUD-STKS/VocalTractLabBackend/blob/master/include/VocalTractLabApi/VocalTractLabApi.h), [2013 model paper](https://doi.org/10.1371/journal.pone.0060603).
- Statistical speech/singing: [HTS runtime](https://hts-engine.sourceforge.net/), [HTS SLT voice terms](https://hts-engine.sourceforge.net/readme_hts_voice_cmu_us_arctic_slt.php), [Open JTalk](https://open-jtalk.sourceforge.net/), [Japanese voice terms](https://open-jtalk.sourceforge.net/readme_hts_voice_nitech_jp_atr503_m001.php), [Sinsy](https://sinsy.sourceforge.net/), [singing-model terms](https://sinsy.sourceforge.net/readme_hts_voice_nitech_jp_song070_f001.php).
- Historical engines: [MBROLA history](https://github.com/numediart/MBROLA/blob/master/Documentation/HISTORY.txt), [voice terms](https://github.com/numediart/MBROLA-voices/blob/master/LICENSE.md), [SAM](https://github.com/s-macke/SAM/blob/master/README.md), [DECtalk archive](https://github.com/dectalk/dectalk/blob/linux-compile/README.md), [KlattSyn](https://github.com/chdh/klatt-syn), [klsyn restriction](https://github.com/rsprouse/klsyn/blob/master/README.md).
- Chips: MAME [MEA8000](https://github.com/mamedev/mame/blob/master/src/devices/sound/mea8000.cpp), [Votrax](https://github.com/mamedev/mame/blob/master/src/devices/sound/votrax.cpp), [SP0256](https://github.com/mamedev/mame/blob/master/src/devices/sound/sp0256.cpp), [Emscripten build route](https://docs.mamedev.org/initialsetup/compilingmame.html#emscripten-javascript-and-html).
- Maeda/DIVA: [VTCalcs lab distribution](https://sites.bu.edu/guentherlab/software/vtcalcs-for-matlab/), [DIVA model and source](https://sites.bu.edu/guentherlab/software/diva-source-code/).

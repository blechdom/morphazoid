# Historical voice engines: native inputs, controls, and browser feasibility

Researched 2026-10-01. The useful boundary is the engine's actual input: text,
phonemes, articulatory/formant frames, or an encoded recording. A game that spoke
from stored coded audio was not necessarily running a text-to-speech engine.
Dates below are documented milestones; they are not asserted invention dates.
No new historical binaries or game speech ROMs were added to the checkout.

## Strong next candidates

| Engine / milestone | Original kind of input | Native controls worth exposing | Browser route and provenance |
|---|---|---|---|
| Bell Labs Voder: patent published 1938; synthetic-speaker paper June 1939 | Human-operated voiced/noise source and filter controls; no text frontend | Finger-controlled band levels, voiced/noise selection, pitch pedal, transient consonant gestures | A DSP reconstruction of an analog apparatus, explicitly labeled as such. There is no original software engine to compile. Dudley's original patent describes both 8-band/thumb and 10-band/foot-pedal arrangements. |
| Kelly–Lochbaum / Bell Labs singing: 1961 Daisy Bell demonstration | Programmed vocal-tract and excitation trajectories, with musical timing | Tract junction/area controls, glottal excitation, pitch trajectory, duration and noise/excitation changes | A paper-based reconstruction or an authenticated recovered program. Archived Daisy audio is evidence of the demonstration, not a general browser TTS engine. No verified, redistribution-licensed original Daisy program was found in this pass. |
| Votrax SC-01 / SC-01-A: used in Wizard of Wor (1980), Gorf (1981), Q*bert (1982) | 6-bit native phoneme code, not arbitrary text | 64 codes including pauses/STOP, four inflection settings, chip clock; board-specific gain and clock circuitry | MAME's actual circuit/DSP model is BSD-3-Clause. It expects a separate 512-byte internal phoneme ROM for each variant. Emulator licensing does not itself establish redistribution rights for that ROM. A separate text frontend would be an added component. |
| TI TMS5200/5220 family: Echo II hardware; Star Wars arcade (1983) | Quantized LPC bitstream, from a speech ROM or host-supplied FIFO | Energy, pitch, repeat flag, lattice coefficients; chip clock; TMS5220C also has native rate/frame-length choices | Very strong WASM candidate: BSD-3-Clause MAME DSP, with authored bitstreams through SPEAK EXTERNAL. This can demonstrate the actual lattice speech core without copying original game or toy recordings. Not equivalent to the current educational LPC proxy. |
| GI SP0256 / SPB640: Intellivoice hardware | Mask-ROM entry points or compressed synthesis program/frames; AL2 specifically provides allophones | Native addresses/commands, pitch/period, amplitude, filter coefficients, interpolation and clock, according to variant | BSD-3-Clause MAME core is available. Intellivoice uses the SP0256-012 mask ROM, not the SP0256-AL2 allophone ROM. Reuse of either mask ROM needs separate provenance; authored frame/microcode demonstrations are a separate option. |
| SSi / TSI S14001A: designed 1975, Speech+ calculator use 1976; Berzerk (1980) | 6-bit word address into compressed speech data | Word selection, START/BUSY; Berzerk adds eight clock-divisor settings and eight volume settings | BSD-3-Clause MAME silicon/state-machine model. It reconstructs 4-bit output from 2-bit deltas and voiced pitch-period symmetry; this is not LPC or unconstrained text-to-speech. Needs speech data. Authored data would avoid presenting an unrelated modern voice as original Berzerk. |
| Harris HC55516 CVSD: Sinistar arcade | Serial encoded audio bits, with a bit clock | Bitstream, clock/rate, decoder/filter characteristics and output level | BSD-3-Clause MAME model; straightforward WASM candidate with newly encoded input audio. A codec/processing exhibit, not a phoneme synthesizer. The famous words are stored performance material. |
| S.A.M. / Software Automatic Mouth: 1982 software | Reciter text-to-phoneme frontend, or direct native phonemes | Pitch, speed, mouth, throat, stress, duration; singing mode bypasses ordinary sentence pitch behavior | Existing C/JS and browser implementations show feasibility. However the popular reverse-engineered C repository explicitly states that it cannot assign a specific open-source license. Its age or public availability is not a redistribution license. |
| Amiga narrator.device + translator.library: classic Amiga speech system; richer V37 interface later | Narrator consumes phonetic text. Translate() is a separate English frontend | Extensive real controls detailed below | Native OS binaries/software are distinct from the published API documentation. No freely redistributable original narrator source was verified. A full-system browser emulator is technically different from a standalone WASM port and still requires system-software provenance. |
| Apple MacinTalk family / classic Speech Manager | Text or each synthesizer's phonetic notation | Native baseline pitch, pitch modulation, rate, emphasis, literal spelling/numbers, pauses and callbacks | Apple documents the API; that does not license the proprietary engines/voices for redistribution. An actual original engine would require authorized source/binaries or a properly sourced system-emulation route. An eSpeak preset should not be labeled MacinTalk. |
| Microsoft Sam / Mike / Mary and other SAPI-era voices | Text plus engine-supported phoneme/XML input | Native rate, pitch, volume, emphasis, spelling, silence and pronunciation overrides | SAPI is an interface, not a synthesis engine. The Windows engine/voice packages remain separate products. No source-port license for these original voices was verified. Browser SpeechSynthesis availability is platform dependent and is not a WASM implementation of those engines. |
| DECtalk | Full text or native phoneme/duration/pitch commands | Native speaking rate, named voices, explicit phoneme timing/pitch, singing and voice-definition commands | A real community WASM implementation already exists at https://webspeak.terminal.ink/ . The source repository explains its developer-shared provenance, but an affirmative redistribution license was not established in this pass. Do not equate its public source dump with permission to relicense it. |

## Particularly rich historical controls: Amiga narrator

The official AmigaOS documentation is unusually explicit and includes working
I/O structures and example code. These are engine controls, not effects applied
to a completed recording:

- Phonetic sentence input; Translate() optionally produces this from English.
- Speaking rate: 40–400 words/minute. Baseline pitch: 65–320 Hz.
- F0 mode: natural, robotic, or (V37+) manual. Manual mode makes accent numbers
  operate independently of automatic sentence-context scaling.
- Formant-target set: the historical male/female switch changes formants, not
  pitch or rate automatically.
- Volume: 0–64. The model is tuned to 22,200 Hz sample output; changing sample
  frequency changes both pitch and formants, so it is not independent pitch.
- F0 enthusiasm: scale in 1/32 units, 32 = unity. F0 perturbation: 0–255.
- F1/F2/F3 target shifts: signed 5% steps.
- A1/A2/A3 formant amplitude biases: −32…+31 dB; −32 is an explicit mute.
- Articulation: transition-time percentage, 100 = normal; 0 removes transitions.
- Vowel centralization: 0–100%, toward a chosen IY, IH, EH, AE, AA, AH, AO, OW,
  UH, ER or UW target. This could be an excellent native, audible demonstration.
- Independent voicing/frication biases, each −32…+31 dB.
- Native mouth-shape, word-start and syllable-start synchronization events.

The documentation distinguishes pre-V37's three-formant model from V37's five
formants. Do not attach all V37 controls to an unqualified “1985 engine” claim.
It also contains native phoneme and intonation instructions. Parameters such as
thread priority and audio allocation masks are integration details, not useful
musical knobs.

Source: https://wiki.amigaos.net/wiki/Narrator_Device
The documentation itself retains Hyperion/contributor copyright; the availability
of that documentation is not evidence of an engine source-code license:
https://wiki.amigaos.net/wiki/AmigaOS_Documentation_Wiki:Copyrights

## Apple and Windows: genuine native commands, separate engine rights

Apple's archived Inside Macintosh command table (dated July 2, 1996) documents:
`[[inpt PHON]]`, `[[pbas ...]]`, `[[pmod ...]]`, `[[rate ...]]`, `[[volm ...]]`,
`[[emph +]]`, `[[slnc ...]]`, character/number literal modes, and synchronization.
Baseline pitch is 1–127, modulation depth 0–127, and volume 0–1. Pitch values are
not simply Hertz. Rate is WPM; supported range/behavior depends on the engine.
Synthesizer-specific commands also exist, and unsupported commands can return
an explicit error. These are Speech Manager capabilities, not proof that every
MacinTalk release implements every extension.

- https://developer.apple.com/library/archive/documentation/mac/Sound/Sound-200.html
- Voice enumeration and per-synthesizer voice IDs:
  https://developer.apple.com/library/archive/documentation/mac/Sound/Sound-196.html

Microsoft's original SAPI XML tutorial specifies rate and pitch −10…+10,
volume 0–100, emphasis/spelling controls, silence, and `pron` phoneme overrides.
Those are native engine requests; their exact acoustic interpretation is engine
specific. The XML schema is not a portable implementation of Microsoft Sam.

- https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ms717077(v=vs.85)

## Early games: preserve the distinction

| Example | What actually makes the voice | What a truthful playable exhibit would do |
|---|---|---|
| Wizard of Wor / Gorf | Votrax SC-01 native phonemes. Board selects 756 or 782 kHz clock and one of two wired inflection choices. | Native phone keyboard/sequence with hardware inflection and clock. Use an added frontend only when labeled separately. |
| Q*bert | Gottlieb SC-01/SC-01-A sound board with phone code, inflection and a programmable clock circuit. | Native phone sequences and clock exploration; avoid claiming ordinary English TTS. |
| Berzerk | S14001A reconstructs coded words from speech ROM. Board has clock and volume control. | Word/data player with clock/volume, or newly authored encoded material clearly identified. |
| Stratovox / Speak & Rescue | DAC voice playback on the game board, alongside separate SN76477 effects. | Encoded/sample voice playback or an audio-processing demo. The SN76477 is not the speech synthesizer. |
| Sinistar | HC55516 CVSD decoder playing encoded voice performance. | A CVSD encode/decode exhibit with new speech/audio; pitch/rate follow bit clock. |
| Star Wars (Atari, 1983) | TMS5220 reconstructs stored LPC-coded speech. | Actual LPC frame/bitstream playback, optionally an LPC analysis/resynthesis input. |
| Intellivoice | SP0256-012 plus speech-data interface. | Actual chip/microcode framing; distinguish its vocabulary mask from AL2's allophone mask. |

The original game recordings/programs are distinct assets from an emulator core.
MAME's source license headers and exact hardware implementation are inspectable:

- Votrax core and 64 native codes / internal ROM dependencies:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/votrax.cpp
- Wizard of Wor / Gorf wiring and release-year entries:
  https://github.com/mamedev/mame/blob/master/src/mame/bally/astrocde.cpp
- Gottlieb speech board register mapping:
  https://github.com/mamedev/mame/blob/master/src/mame/shared/gottlieb_a.cpp
- Q*bert hardware/release entries:
  https://github.com/mamedev/mame/blob/master/src/mame/gottlieb/gottlieb.cpp
- S14001A state-machine model, history and delta reconstruction:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/s14001a.cpp
- Berzerk word/clock/volume wiring:
  https://github.com/mamedev/mame/blob/master/src/mame/stern/berzerk.cpp
- Stratovox's DAC and separate SN76477:
  https://github.com/mamedev/mame/blob/master/src/mame/sunelectronics/route16.cpp
- Sinistar's CVSD hardware:
  https://github.com/mamedev/mame/blob/master/src/mame/williams/williams.cpp
- Actual CVSD decoder:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/hc55516.cpp
- TMS5220 core and native frame/command documentation:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/tms5220.cpp
- Star Wars speech interface:
  https://github.com/mamedev/mame/blob/master/src/mame/atari/starwars.cpp
- Apple Echo II variants and TI chip differences:
  https://github.com/mamedev/mame/blob/master/src/devices/bus/a2bus/a2echoii.cpp
- SP0256 core:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/sp0256.cpp
- Intellivoice's SP0256-012 ROM declaration:
  https://github.com/mamedev/mame/blob/master/src/devices/bus/intv/voice.cpp

MAME is a primary source for its emulator implementation and hardware reverse
engineering, not a contemporaneous release announcement. Its game dates are
useful corroboration, not an excuse to claim an exact chip invention day.

## Bell Labs and software provenance sources

Dudley's actual patent, filed April 7, 1937 and published June 21, 1938:
https://patents.google.com/patent/US2121142A/en

Dudley, Riesz and Watkins, “A synthetic speaker,” Journal of the Franklin
Institute, June 1939 (original publication; bibliographic metadata checked):
https://doi.org/10.1016/S0016-0032(39)90816-1

Computer History Museum's 1961 timeline identifies Kelly/Lochbaum's vocals and
Mathews's accompaniment for Daisy Bell. This is a museum historical account,
not original executable source. Avoid adding an exact machine model from memory:
https://www.computerhistory.org/timeline/1961/

S.A.M. reverse-engineered C frontend, original controls/preset examples and its
explicit unresolved licensing statement:
https://github.com/s-macke/SAM

DECtalk community source/provenance:
https://github.com/dectalk/dectalk/tree/develop
Existing WASM frontend:
https://webspeak.terminal.ink/
The README's old bluegrasspals mailing-list links now lead to a notice that the
archive moved to groups.io in March 2026; they do not currently expose the cited
2015 developer post at that URL. The repository's provenance claim is therefore
not independently confirmed by following that old link in this pass.

## Suggested priority

For additional actual WASM DSP with a clear native interface, investigate TMS5220
SPEAK EXTERNAL first, then SP0256 with authored frame data, and Votrax after its
internal-ROM provenance is resolved. CVSD is an excellent adjacent processing
exhibit. Voder deserves its own manual performance interface as a documented
analog-to-DSP reconstruction. Keep authentic Amiga, MacinTalk, Windows voices,
S.A.M. and DECtalk on a separately labeled source/provenance track until their
specific distributable artifacts are established; do not substitute an eSpeak
voice while claiming it is one of these original engines.

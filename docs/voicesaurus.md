# Voicesaurus

[Open Voicesaurus](../voicesaurus.html). Enable **Audio**, choose an engine,
then press Play, Speak, Sing or Trigger. **Loop** repeats the generated sound
while you edit its controls. Audio starts off. Rendering happens locally in
cancellable WebAssembly workers; no speech service or microphone is used.

The method menu and preset tour run oldest to newest by each displayed,
sourced milestone. These are publications, source credits, datasheets or
releases—not claims that an entire technique was invented on an exact date.
**Next** visits every factory preset across the methods. **Dice** generates a
complete custom scene. Both preserve master level and device consent.

## Native instruments

There are 17 selectable engine/voice routes and 156 complete factory presets.
Several routes are speakers or implementations within the same synthesis family.

| Route | Native input and sound controls |
| --- | --- |
| Csound VOSIM | Direct notes; squared-sine pulse groups, signed amplitude decrement, pulse-width multiplier and three independent bands |
| eSpeak NG Klatt | Whole sentences; native Klatt variants, pitch, range, rate, word gaps, capitalization, emphasis and punctuation |
| Csound FOF | Direct notes; three independent formants/bandwidths/gains, grain rise/duration/decay, phase and octaviation |
| MEA8000 | Actual quantized chip frames; pitch increments, F1–F3, four bandwidths, amplitude, frame length and noise; F4 is fixed at 3500 Hz |
| Perry Cook’s Singer | 71 original tract shapes, seven glottal configurations, all 17 original shape coefficients, source/modulation controls, destination trajectories and host ADSR |
| Gnuspeech | Native English sentences and prosody; oral/nasal geometry, glottal source, radiation, breath, intonation and drift |
| eSpeak NG | Native sentence frontend and formant variants; full-phrase prosody, rate, pitch and interpretation controls |
| STK VoicForm | 32 original phonemes; four parallel formants with separate frequency/pole/gain/sweep, voiced/noise excitation, source filters and pitch trajectories |
| Flite KAL / KAL16 | Native text frontend and diphone synthesis at two source rates; native F0 and duration controls |
| Vizsn | Original letter mapping or native phonetic symbols, ten excitation modes and phase/rate controls; not an English text frontend |
| Flite SLT / AWB / RMS | Three Clustergen statistical voice models with native sentence duration and F0 controls |
| SVOX Pico | Native US/UK English models, pitch, speaking rate and engine gain |
| Sinsy | Japanese kana lyrics and a musical score; editable note pitches, durations, rests, staccato, breath and tempo; native HTS singing controls |
| HTS | Native English sentence frontend, HMM SLT model, duration, F0, global variance and vocoder controls |

Singer is a C++/WASM translation of the Snd-distributed algorithm, with original
shape/glottal tables. STK is its original VoicForm/SingWave implementation.
Csound FOF is not the original CHANT program or voice database. MEA8000 uses
MAME's generator and actual frame encodings, without a speech ROM. Sinsy uses
the actual Japanese MusicXML frontend and the NIT SONG070 F001 singing model,
credited to the Sinsy Working Group / Nagoya Institute of Technology under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

## Japanese singing syllables

Each Sinsy note has a Choose dropdown with romanized spellings beside Japanese
kana, such as **ka · か**, **shi · し**, and **ra · ら**. The 155 choices were
checked against the exact dictionary bundled with Sinsy 0.92. Groups cover
vowels, ordinary consonant rows, combined sounds and loanword syllables.
The spelling is a pronunciation aid, not a translation. **Custom lyric…**
retains direct text entry, including symbols outside the menu, using Sinsy's
native Japanese frontend.

## Singing timeline

The Speaking / Singing switch above the parameters scopes the method menu,
presets, Next tour and Dice. It restores each mode's edited scene and selected
note when switching back. Mode describes the native input path exposed here:
the five note/score engines are in Singing; native text and chip speech paths
are in Speaking. It does not claim that an engine has no other capabilities.

Sinsy, Singer, STK VoicForm, FOF and VOSIM have an editable piano roll. It combines
Pink Trombonazoid's pronunciation selectors with Vocalzoid's visible note/time
editing. The notes are ordered and monophonic: drag vertically for pitch,
horizontally to reorder, or drag the right edge for duration. Arrow keys change
pitch/order; Shift + left/right changes duration. Add, Duplicate, Split and Remove
edit the phrase. The horizontal view scrolls and has its own zoom knob.

Each Sinsy note carries its Japanese syllable dropdown. Singer and STK notes
carry their original native shape/phoneme menus. FOF and VOSIM use per-note
formant parameters; these opcodes have no native phoneme dictionary. The selected
note's pitch and length knobs sit below its position on the time axis, together
with its vowel/formant knobs. Singer exposes the selected note's tract and
frication controls there; STK, FOF and VOSIM group controls by formant. The
remaining native parameters in the right panel also belong to the selected
note. Sinsy's statistical model controls apply to the whole score. Exact
readouts retain native value access beyond the dial and graphic spans.

Tempo changes preserve beat lengths. For the musical note engines it scales
native note-duration seconds, retaining attack, release and within-note
trajectory times. Sinsy receives its native score tempo. The note engines render
each pitch directly; playback never transposes recorded audio to simulate a
different native note. Each authored note has its own attack/model instance.
Interior notes fit their release inside their timeline slot, and their audio
never crosses the next note or rest. The scheduler derives a shorter gate from
the slot length and release, preserving the saved settings. If an extreme
release cannot fit, the output is cropped and faded at that boundary. The final
note and isolated auditions retain their natural release tail.

The separate **Between notes** controls set pitch portamento and vowel/tract
transition time independently; both default to Off. They use native model
controls on Singer/STK and native Csound control-rate trajectories on FOF/VOSIM.
They do not crossfade recordings or imply continuity of vocal excitation across
note attacks. Rests break the transition, and native within-note destination
controls remain available. Sinsy's whole-score model determines its own
transitions and does not expose these additional host controls.

**▶ Note** auditions only the selected note, once. Its separate audio buffer
preserves the phrase, playback position and Loop setting. Editing during an
audition cancels the old request and auditions the edited note after the usual
debounce. Play/From start returns to the complete phrase. Audio always requires
explicit arming.

The playhead follows the audio clock. Musical note timings come from native
sample placement and gate times. Sinsy exposes waveform output without acoustic
phoneme labels, so its playhead shows nominal score timing, including the native
helper's quarter-beat boundary rests. It does not claim exact inferred consonant
or vowel boundaries. Its individual-note audition also lacks the surrounding
score context of the full phrase.

Legacy single-note presets remain unchanged until a phrase edit. Authored
musical phrases save complete, independent native settings for every note.
Current rendering budgets are 62 notes, 120 seconds including tails, and
12 million rendered frames; negative sequential durations cannot advance a
host timeline. These are scheduling/resource limits, separate from native sound
parameter limits. Rejected experiments remain recoverable through the preset
menu and reset control.

## Knobs, exact values and native limits

Every numeric scene parameter has a knob and value readout. All groups start
open. Discrete numeric chip/table settings use stepped knobs; categorical
settings use Choose menus. Drag vertically and hold Shift for finer movement.
Click a continuous knob's readout to enter an exact number, including scientific
notation. Dragging and keyboard adjustments stop at the dial's fixed minimum
and maximum. Typed values may exceed that interval without widening it; the
needle stays at the nearest endpoint and the readout keeps the requested value.
These gesture limits do not constrain preset recall or native value forwarding.
The musical voices use practical performance ranges—for example 0–20 Hz for
vibrato rate and 20–2000 Hz for pitch. Their `dragMin`/`dragMax` metadata affects
only the dial; exact values and the native engine's own limits remain separate.

Values are sent to the native engine, whose setters or equations determine
whether they work. A native setter may clamp, quantize, ignore or reject a value;
the readout records the requested value. The application does not reject finite
sound for being distorted, noisy, unintelligible or outside a conventional voice
range. Numerical failure and memory/time exhaustion are reported separately.
The previous playable buffer remains available when rendering fails.

Parameters are declared in:

- `src/families/speech/native-text-controls.js`: eSpeak, Flite, Gnuspeech, Pico and HTS.
- `src/families/speech/native-musical-controls.js`: Singer and STK.
- `src/families/speech/native-retro-model.js`: Vizsn and MEA8000.
- `src/families/speech/sinsy-score.js`: Sinsy and its score representation.
- `src/instruments/voicesaurus/csound-native.js`: Csound FOF and VOSIM.

Those files describe labels, units, defaults and initial dial spans. Actual
native behavior resides in the respective `*-runtime.js` / `native-*.js`
adapters and the upstream code identified by each `vendor/*/build.json`.
Singer/STK's translated bridge is in
`vendor/musical-voices/source/musical-voices.cpp`; HTS/Sinsy rebuild bridges are
in `scripts/vendor/`. The rebuild scripts pin source and model versions.
See [the parameter/source audit](voice-native-parameter-audit.md) and the
engine-specific README files for implementation boundaries.

Source-row controls follow the selected original shape. Editing a Singer tract,
glottal coefficient or STK formant automatically enables its explicit override.
Host ADSR and destination timing are labeled separately from original parameters.
Randomization chooses finite demonstration settings; it does not determine what
you may enter manually.

## Playback and verification

Text engines receive complete sentences through their original frontend and
prosody. Musical engines receive notes/shapes; Sinsy receives a score; Vizsn and
MEA8000 receive their native inputs. Voicesaurus does not use Spelling's English
phoneme atlas. Spelling remains a separate instrument and preserves its own
letter/readback interaction.

Changing a control regenerates the sound after a short debounce. Playback loops
on the audio sample clock. A failed render retains the previous audio. Pause and
Audio off cancel pending rendering so it cannot restart later. Waveform,
spectrum and spectrogram follow the output. Output gain/protection is separate
from native synthesis parameters, and does not normalize away amplitude edits.

Rendering has bounded time and memory. The common player accepts up to two
minutes and 12 million playback frames per result. Native sample rates outside
Web Audio's supported buffer format are converted for playback while preserving
native generation rate and duration. These are resource/output constraints,
not musical parameter ranges.

`tests/voicesaurus-native.test.mjs` checks complete scenes and finite values;
`e2e/voicesaurus.spec.mjs` checks native input, knobs, playback, cancellation and
responsive layout; `e2e/voicesaurus-engines.spec.mjs` renders the complete native
factory bank. Automated waveform and browser evidence does not establish timbral
quality. Human listening and device acceptance remain unperformed; rollout
status remains `implemented-verification-pending`.

[Historical engines and candidates](voice-engine-research.md) ·
[Apple, Amiga, Windows, games and Bell Labs](voice-platform-history.md) ·
[Third-party notices](../THIRD_PARTY_NOTICES.md)

# Spelling Synthesizer — frontal mouth and voice engines

[Play the instrument](../spelling-synthesizer.html).

Spelling Synthesizer is in **Voice**, alongside Vocalzoid, rather than Cooking
or Work in Progress. Its new catalogue icon is original vector artwork derived
from the instrument's own mouth model, with a spoken letter A; no external image
assets or new licenses. `python3 scripts/render-spelling-icon.py` regenerates
`artwork/spelling-synthesizer.svg` and the 512px WebP using the same optional
Cairo/Rsvg/Pillow authoring tools as the Loopini icon script.

## Playing

Turn Audio on explicitly, then type into the field below the mouth. Letters use
this instrument's existing phonetic gestures; joined pairs include TH, SH and
vowel glides. Holding a vowel sustains it. The circular Play control reads words
using the local pronunciation dictionary; it does not upload text or select a
browser speech voice. Clear, pause/resume, interruption by typing, MIDI notes
and composition input remain available. Text and the reading cursor are
performance material, never replaced by factory presets or Random.

The **Loop** icon beside Play repeats the entire readback, including its existing
punctuation pauses. It starts off; switching it on does not start Play or arm
Audio. Switch Loop off to finish the current pass, or press Pause to stop now.
Pause, Clear, Audio off and leaving the page cancel pending repeats; empty or
non-playable text never loops. The Loop choice stays on through Pause, Clear,
presets, Next and Random so you can browse voices while repeating your text.
Explicit Reset restores Loop off. This is live transport state, not a new
preset parameter; existing scene snapshots and synthesis are unchanged.

## Live readback controls

Voice-engine changes now keep **Play** and **Loop** active. The reader retains
its next phoneme/gesture rather than restarting the text or inserting a preview
vowel. A cold engine may need a short loading gap; Pause remains available during
that load, and Pause, Clear, Audio off, Reset and page teardown cancel any pending
continuation. An unavailable engine reports its error and continues with the
available voice when possible. Paused text does not start merely because a voice
or preset was selected.

Tone/personality and rhythm settings are read for each newly sounded phoneme,
so they also update an already-prepared, repeating phrase. Letter-pair joining
and its delay still concern live typing, not dictionary pronunciation; changing
them no longer pauses word readback.

**Speed**, beside Loop, runs from **0.50× to 2.00×**, initially 1.00×. It changes
phoneme onset spacing and punctuation pauses, preserving the elapsed fraction
of the current interval when adjusted. It does not transpose the voices,
time-stretch the sample recordings, or alter live typing. Faster settings may
interrupt a phone sooner; slower settings leave more space between phones.
Speed and Loop are live performer choices outside presets/Random, alongside
text and the master volume. Explicit Reset returns Speed to 1× and Loop off.

## Local WebAssembly speech voices

**eSpeak NG** and **Klatt** synthesize 43 English phone/pair units in a local
worker on the first explicit Audio enable. Klatt selects eSpeak's Klatt mode,
not DECtalk. Both reuse the existing dictionary reader and sample-clock vowel
loops; they do not provide eSpeak whole-phrase prosody or a melody sequencer.
Three presets per mode bring the bank to 28; the three Flite voices add nine more scenes, for 37 total. Text, Loop, cursor, speed and master
level are preserved when browsing these voices. Voice resources load lazily;
cancelled loads terminate their worker and cannot start delayed playback.
The UI accurately calls their personality choices tone filters.

Flite SLT, AWB and RMS add statistical parametric speech: Clustergen predicts
acoustic parameters and uses an MLSA vocoder. These are three speakers within
one synthesis family, not three new algorithms. Their 43-phone atlases are
also generated locally in a worker using Flite WASM and its segment timings.
eSpeak's English runtime/data is about 1.46 MB; Flite's embedded voice bundle
is about 17.3 MB. Each loads only when first selected with Audio enabled. Audio
can cancel cold loading; workers terminate on completion, error or cancellation.


Spelling and [Voicesaurus](voicesaurus.md) share the controller in
`src/families/speech/spelling-controller.js`; their public routes and preset
storage IDs remain separate. Voice synthesis still runs locally.

## Voice output balance

Spelling opts into fixed engine and personality output trims, followed by
oversampled soft peak protection and a final sample guard. All ten voices use
the same master-volume taper. The quieter Bell Labs, LPC and vocoder voices are
raised relative to KAL/Pinkazoid; extreme Pinkazoid Whisper/Creature bodies receive
separate compensation. This is not automatic gain control: speech dynamics and
voice character remain, and no volume parameter was added to the presets.
The existing meters receive the protected post-master signal.

Calibration uses real-browser PCM captures of the same phrase at 48 kHz and
100% master: “The quick brown fox. Daisy, give me your answer.” Both raw RMS/peak
and gated, mono K-weighted loudness are compared across the original 25 engine/personality
combinations. The earlier clear-voice measurements ranged from approximately
−23 to −32 mono LUFS; Bell Labs was about 9 dB below KAL. The protected captures measure
−19.40 to −18.01 mono LUFS across those 25 combinations, with a maximum recorded
sample peak of about −1.12 dBFS and no non-finite or clipped samples. This leaves
headroom rather than targeting 0 dBFS.
This is a reference-scene balance, **not a universal mastering level or certified
true-peak limiter**. The final sample guard also catches reconstruction overshoot
after oversampling; simply bounding a WaveShaper curve was insufficient for some
plosives. Human listening/intelligibility acceptance remains separate.

Pink Trombonazoid also consumes the underlying audio class. Its existing output
and tone remain unchanged: the new balance/protection is explicitly enabled by
Spelling and Voicesaurus. Existing synthesis models and the licensed KAL recording are not
replaced.

The ten-voice browser regression also captures the same phrase through the final
output at full master, including eSpeak, Klatt and all three Flite voices. Fixed
engine trims keep active RMS within a 4 dB spread, with sample peaks below 0.95
and no non-finite output. This passed after calibrating the new voices; it is
an RMS/peak check, not an extension of the earlier 25-scene LUFS measurement.

The frontal wireframe mouth shows lip opening, rounding, seals, tongue position
and teeth. These are **stylized visemes**, not an anatomically validated face or
a guarantee of lip-reading accuracy. With Audio on, each visual gesture is
started by the same dispatched event as its sound; word readback updates for
**each phone**, not only the final phone of a word. Sampled vowel pairs glide
between their visual poses. With Audio off, typing can still preview gestures
silently. The displayed letter/pair or word identifies the current material.

The mouth and editor stay together on the graphic side while the right rail
scrolls. The old bottom text trail, engine numbering, redundant KAL description
panel and historical slogan were removed. Presets/Next/Random remain first in
the parameter rail.

The graphic and rail meet without an outer gutter, as in Shape and the revised
Möbius/Klein layouts. Sections keep their own control padding; the preset row
stays pinned while scrolling. No extra separator or spacer is inserted between
presets and the first section. Portrait/landscape layouts and bottom safe-area
clearance remain; these spacing changes do not change the voice engines.

## What the engines actually are

| Engine | Implementation | Personality control |
| --- | --- | --- |
| **Pinkazoid** (formerly Bellazoid) | Morphazoid's Throatazoid vocal tract and Pink Trombone-style glottal source. | Voice-body preset, pitch scaling, breath, tension and excitation. |
| **eSpeak NG / Klatt** | Locally generated formant phones using eSpeak NG and its Klatt mode. | **Synth tone** filter; same phoneme synthesis settings. |
| **Flite SLT / AWB / RMS** | Locally generated Clustergen statistical-parametric phones, synthesized through an MLSA vocoder. Three speakers share one family. | **Synth tone** filter; same generated voice model. |
| **KAL samples** | The existing locally bundled CMU Flite KAL16 phone/pair atlas. | **Sample tone** only: Open, Soft, Bright, Brighter, Dark. The recorded speaker, sample position and personality-independent pitch are unchanged. |
| **Voxazoid** | The existing twenty-band vocoder, with KAL samples as the speech modulator. | Carrier pitch, spectral brightness and voicing-related character; not a different recorded speaker. |
| **Bell Labs** | Original Kelly–Lochbaum scattering-tube implementation, inspired by the Daisy Bell era. | Excitation pitch/breath and tract-length scaling; authored phoneme areas/constrictions. |
| **Speak & Spell LPC** | Original 8 kHz, ten-stage LPC lattice using quantized KAL-derived speech coefficients. | Pulse pitch, breath/noise blend and de-emphasis brightness. No sampled audio playback. |

The original `tube`, `diphone`, `vocoder` engine IDs and five personality IDs
are retained for saved scenes. All original preset parameter snapshots remain;
only the Bellazoid scene's displayed name changed to Pinkazoid. KAL's underlying
five tone settings remain exactly 7300, 6570, 7592, 7800 and 5986 Hz low-pass
targets. Typing still supplies the existing small pitch prosody (limited to
±18 cents for KAL); the personality buttons do not retune that recording.

**Why not Daisy Bell?** The current engine is not a reconstruction of the
original Bell Labs voice or a playback of that recording. The source explicitly
uses Pink-style vowel coordinates, LF-style excitation and the Throatazoid
worklet. Pinkazoid names that actual implementation more honestly.

## Speak & Spell-ish

An additive sixteenth full preset selects Voxazoid + Reed, with no timing-driven
dynamics, zero pair delay and pair joining off. It provides a dry, mechanical
spelling-toy starting point without touching text, master level or Audio consent.
It is **not** a TI chip emulator, a new LPC engine, or a recording from the toy.
Its resemblance and usefulness still need human listening acceptance.

The later **Speak & Spell LPC** engine is separate from this retained vocoder
preset. Its three new scenes and three Bell Labs scenes bring the bank to 22.
The later eSpeak NG and Klatt modes add six more scenes; see above.

## Bell Labs and Speak & Spell engines (September 30)

**Bell Labs** uses actual bidirectional wave propagation and area-dependent
scattering across 24 oral tube sections. A short periodic glottal pulse, breath
noise, phoneme constrictions, timed plosive releases and lip radiation produce
the sound. It uses authored approximate area profiles, not recovered 1961 code,
Fant's original measurements, or the Daisy Bell recording. Nasals use a simple
oral-leak component, not an anatomically complete nasal side branch. The mouth
continues to show stylized visemes, not the simulated tube's cross sections.

**Speak & Spell LPC** performs real linear-predictive resynthesis: ten reflection
coefficients, 25 ms frames at 8 kHz, quantized energy/pitch/coefficient indices,
a short voiced chirp or unvoiced noise, and a synthesis lattice. It does not
play the KAL WAV through a filter and is not the channel vocoder. The LPC atlas
is derived from Morphazoid's already licensed KAL recording via anti-aliased
2:1 decimation, autocorrelation, Levinson–Durbin analysis and quantization.
Zero is exactly representable in each reflection codebook, and magnitudes stay
below one. Codebooks, excitation waveform and arithmetic are original, not TI
mask-ROM tables or a bit-exact TMS5100 emulator; resemblance still needs listening.

Both voices run pitch, filter evolution, finite-note envelopes, held vowels and
release on AudioWorklet sample clocks. Two fixed voice slots bound phoneme
crossfades; one master path feeds the existing output meter and level control.
They require AudioWorklet support; the existing visible fallback reports KAL if
an engine cannot load. Audio remains explicitly armed. The **speech-event**
readback scheduler is still the existing timer-based scheduler described below:
adding these worklets does not make whole-word timing stall-proof.

Stable new IDs are `bell` and `lpc`; old engine IDs, all sixteen earlier scene
snapshots, text, Loop, master level and Audio consent remain unchanged. Preset,
Next and Random engine changes retain the live phoneme/gesture cursor, Loop and
Speed. Six additive scenes cover clear, warm and reed/creature settings.

### Technical evidence and provenance

- [Julius O. Smith, Voice Synthesis](https://www.dsprelated.com/freebooks/pasp/Voice_Synthesis.html)
  describes the Kelly–Lochbaum scattering model, its 1961 singing demonstration,
  and the later spectral/source-filter LPC approach. It supports the mechanisms,
  not a claim that our authored profiles reproduce the original voice.
- [TI patent US4209836A](https://patents.google.com/patent/US4209836A/en)
  documents the speech-synthesis IC's lattice, excitation and parameter
  circuitry. Used as historical/mechanism evidence; no ROM or source copied.
- `scripts/audio/build-spelling-lpc.mjs` deterministically generates
  `spelling-lpc-atlas.js`; `--check` verifies it against the source WAV's SHA-256.
  Source attribution and derivative notice remain in `THIRD_PARTY_NOTICES.md`.
- `tests/spelling-retro.test.mjs` checks quantization, coefficient stability,
  all 43 phone/pair units at 44.1/48/96 kHz, pitch/tone/breath sensitivity,
  release/reset, bounded repeated transitions and additive scenes. Audio
  lifecycle tests cover explicit arm, no sample fetch, cancellation and teardown.
- Browser coverage includes both actual worklets, per-phone mouth/readback,
  held vowels, looping, new preset recall, no KAL WAV fetch, bounded metered
  output and Audio-off cleanup. This is mechanical evidence, not a listening
  approval of intelligibility or historical similarity.

## Evidence, provenance and limits

- Local implementation: `spelling-synthesizer.js` (phone gestures/personality
  mappings), `spelling-synthesizer-audio.js` (unchanged engine DSP and KAL atlas
  slices), `spelling-mouth.js` (new original bounded SVG mesh/pose mapping).
- [Pink Trombone](https://dood.al/pinktrombone/): the original project/source
  documents its glottal model and tract; this task copied no new third-party
  code, audio or artwork. Existing Morphazoid tract and Flite assets retain
  their existing provenance.
- [Speak & Spell overview](https://en.wikipedia.org/wiki/Speak_%26_Spell_(toy)):
  the original toy used LPC speech synthesis, not this channel vocoder. Used as
  background evidence for the explicit non-emulation boundary, not a timbre
  or authenticity certification.
- `tests/spelling-mouth.test.mjs`: phone-pose distinctions, bounded finite
  geometry, interpolation and the additive preset snapshot.
- Existing spelling/pronunciation/atlas/audio/worklet tests retain typing,
  hold/release, sample boundaries and dictionaries. The KAL tone test checks
  identical playback rates/sample offsets across personalities and their
  exact distinct tone-filter targets.
- `e2e/spelling-mouth.spec.mjs`: required three viewports, editor/graphic
  ownership, Audio-off typing, per-phone audio/visual agreement for CAT on all
  ten voices, held vowel/release, engine labels and full preset recall.
  `e2e/spelling-presets.spec.mjs` checks all thirty-seven recalls and true Random.
  Loop regressions cover complete repeated phone sequences on all ten voices,
  finishing a pass, cancellation, preset/Random continuity, empty input and
  pause/resume at the final punctuation boundary.

Animation frames update only the SVG. This task does **not** migrate the
existing timer-dispatched speech/readback scheduler to a worklet/lookahead
clock or claim sample-accurate articulation under arbitrary UI stalls. The
mouth uses the active audio clock to interpolate display poses; it never
schedules sound from rendering. The three pre-existing sound models, envelopes, pronunciation and sample data
were not replaced; the new output calibration is described above.

## Automated verification (2026-09-29)

- `node --test tests/spelling*.test.mjs`: 47 passed.
- `npm run verify`: 4,693 passed, six skipped, no failures; runtime syntax,
  WASM, XYFlow and generated WAX parity passed.
- `MORPHAZOID_QA_BASE_URL=<verified-preview> npx playwright test
  e2e/spelling-mouth.spec.mjs e2e/cooking-presets.spec.mjs --workers=2`:
  103 passed. A final Spelling-only rerun after cleanup passed all ten cases.
- `npm run build:wax` and `npm run build:site`: passed.
- Desktop, phone portrait and phone landscape screenshots were inspected;
  preview HTML, controller, CSS and mouth-module bytes matched this checkout.

Human listening, actual phone-keyboard feel and physical MIDI acceptance remain
unperformed. Local screenshots/logs are ignored under `test-results/spelling-mouth/`
and do not travel with a fresh clone. No commit or publication requested.

### Live-control regression checks

- `tests/spelling-output.test.mjs` checks bounded calibration, a common master
  taper, linear low-level output, soft-knee continuity and the final sample guard.
- `tests/spelling-synthesizer-audio.test.mjs` checks opt-in protected routing,
  mute/restore/cleanup and the unchanged legacy output path.
- `e2e/spelling-live-readback.spec.mjs` exercises all ten real engines, live
  tones/rhythm, half/double speed, retained interval progress, delayed/cancelled
  voice loading, fallback, loop continuity and measured full-master balance.
- The existing mouth/responsive and preset suites cover the adjacent Speed
  control, native keyboard operation, preserved text/level/Loop/Speed and Audio
  consent. These checks do not constitute a human listening or device pass.

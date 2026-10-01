# Current value policy

The current native controls use fixed dial gesture ranges with unrestricted
finite exact-value entry. See [native value forwarding and source behavior](voice-native-value-limits.md).
The earlier audit below records how these integrations were developed.

# Native parameter coverage and boundaries

Sources below identify what the shipped engines actually expose. Release
dates or project milestones are separate from invention dates; keep the
page's cited history records rather than inventing a single exact origin.

## eSpeak NG

Source: pinned Echogarden eSpeak NG revision
`9a550bef455f03b459f51796e3482833aab7fbc0`, especially
`src/include/espeak-ng/speak_lib.h`, `src/libespeak-ng/setlengths.c`,
`ssml.c`, `intonation.c`, `emscripten/espeakng_glue.cpp`, and the included
`voices/!v/` files.

Exposed: speaking rate, engine amplitude, pitch, pitch range, word gap,
punctuation mode/list, capitalization cues, intonation group, all-capitals
and penultimate-stress emphasis flags; native SSML phrase emphasis and
character spelling; every included formant/Klatt voice variant. The new
exports call the original C API. In this revision, some public parameter
setters store their value but report EINVAL; effective values are checked
with the original GetParameter API. Word-gap, capitals, punctuation and
intonation changes were verified through real generated PCM.

Not a complete voice-authoring editor: the voice files also contain
per-formant frequency/width/gain, spectral tilt, flutter, roughness,
voicing, consonant, stress, and tune tables. Those are source/data configuration
fields, not setters exposed by the current wrapper; a future authoring mode
could write a new variant file before SetVoice. Language selection is limited
to the included English data. MBROLA is compiled out. OPTIONS is reserved;
VOICETYPE/EMPHASIS/LINELENGTH are documented as internal. SSML break multiplier
only affects explicit SSML breaks; this interface accepts plain text rather
than arbitrary user-supplied SSML.

## Flite

Sources: <https://github.com/festvox/flite>, the packaged Flite 2.3-current
CLI, and `cst_cg.c` plus the SLT/AWB/RMS `cst_cg_db` declarations supplied in
the research source set. Flite's 2001 release and the 2006 Clustergen paper
describe different milestones.

Exposed: the CLI's `duration_stretch`, `int_f0_target_mean`, and
`int_f0_target_stddev`, passed before native text synthesis. Default means /
standard deviations match the models: SLT 172/27 Hz, AWB 132/25 Hz, RMS
98/24 Hz; KAL/KAL16 95/11 Hz. All three controls changed actual SLT output.
No unsupported consonant/formant controls are invented. Further native CG
features (`f0_shift`, MLSA alpha/beta and model-specific features) require
checking the exact compiled binary's feature access before exposing them.
The included `awb_time` voice is a limited-domain clock model, not general TTS.

## Gnuspeech

Source: GnuspeechSA revision `f62e8b88eeeb3fa7e51ac138d561c3061a4a415f`,
`data/en/trm.txt`, `trm_control_model.txt`, `voice_*.txt`, and their C++
configuration readers. This is the Trillium/Gnuspeech articulatory lineage.

Exposed: all scalar musical fields in those three runtime configuration
files: voice, tempo/control rate, pitch offset/reference pitch, global and
individual eight oral radii, global and individual five nasal radii, tract
length/offset, glottal opening/closing limits, waveform, breath, aperture,
air temperature, tube loss, mouth/nose/throat radiation settings, engine and
throat level, noise mix/modulation, micro/macro/random/drift intonation,
drift parameters, and notional/pretonic/tonic contour controls. Each writes
the actual field consumed by the original engine. The waveform and tract
remain model-generated; the dictionary is a text/phonetic resource.

Output-rate/channel/balance fields are format/routing choices and stay in
the mono audio adapter. Dictionary paths and the underlying articulatory
rules/transition/XML models are resource-authoring concerns, not casual
real-time sliders. Full historical rule-table editing is not claimed.

## HTS

Source: official hts_engine API 1.10 `HTS_engine.h`/`HTS_engine.c`,
Flite+hts_engine 1.07, and HTS CMU ARCTIC SLT model 1.06. Their documented
release dates are 2015-12-25, 2016-12-25, and 2016-12-25 respectively.

Exposed: native speed, semitone offset, beta postfilter, LF0 MSD voiced/unvoiced
threshold, MCP global variance, LF0 global variance, alpha warping, frame
period, sample frequency, and engine dB level. Defaults use the original
model's 48 kHz, 240-sample frame and alpha 0.55. LPF has `USE_GV=0` and the
non-LF0 streams have `IS_MSD=0`, so knobs for those inactive dimensions are
omitted. The model itself contains its spectrum and excitation statistics;
there is no native pulse/saw/sine waveform selector to expose.

Per-state means, phoneme-alignment flags, and multi-model interpolation are
also C APIs. They need structured timed labels or multiple compatible
models rather than an independent slider. Arbitrary note/phoneme contour
editing would be a new experimental frontend; none is silently substituted
for the native sentence frontend here. HTS pitch controls alone do not make
this a score-trained singing model; Sinsy has its own labels and voice.

## SVOX Pico

Source: original Android SVOX code/public `picoapi.h`, resources and native
markup handling, as documented in `vendor/pico/README.md`.

Exposed: native English model selection, pitch, speed and volume markup.
The content itself is escaped as plain text. Pico's public engine lifecycle
and resource APIs are used directly. The runtime can separately accept
X-SAMPA phoneme markup, but the native sentence route never supplies it.
Additional documented markup such as explicit breaks, spell mode, and
sentence/paragraph prosody requires a separate structured-markup interface;
internal HMM/model coefficients are not surfaced by the public C API.

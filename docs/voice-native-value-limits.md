# Final native numeric-value behavior

This supersedes the earlier operating-range recommendations. The owner
explicitly requires the native libraries to decide which values they accept.
Adapter numeric min/max validation and clamping are removed. Knob intervals
bound dragging and keyboard adjustments; exact-value entry may exceed them
without widening the gesture range. Only the native engine limits those requests.

## Apply

`native-limits.patch` is a focused unified patch against the current checkout
at handoff time. It preserves root's expanded capitalization description.
It changes native-text/control modules; Flite, Pico, Gnuspeech and HTS runtime
bridges; Sinsy score/runtime/preset modules; and the native HTS/Sinsy bridges
and Sinsy build script under `scripts/vendor/`.

Replace all four artifacts together per engine:

- `/tmp/voicesaurus-native-text/hts/{hts.js,hts.wasm,hts.data,build.json}`
  into `vendor/hts/`.
- `/tmp/voicesaurus-sinsy-port/{sinsy.js,sinsy.wasm,sinsy.data,build.json}`
  into `vendor/sinsy/`.

The emphasis fix needs no additional eSpeak rebuild. Retain the enhanced
eSpeak artifact set from the first native-text handoff.

## Final contract

Numeric parameters receive finite/type checks only. No out-of-range value
is silently replaced with a preset value. Native setters clamp, ignore or
reject values according to upstream behavior. `nativeMin` and `nativeMax`
describe upstream clamp/markup behavior; they must not block sending exact
values that the native library itself will clamp.

Remaining ABI conversions, not musical caps:

- eSpeak parameter values must fit signed 32-bit integers.
- HTS sample rate and frame period use unsigned 32-bit integers; zero reaches
  the native setter and becomes one. Other controls remain doubles.
- Pico factors convert to native integer-percentage markup.
- Flite rate converts to `duration_stretch=1/rate`; an unrepresentable infinite
  stretch is a type error. Pitch/stretch/deviation otherwise pass unchanged.
- Gnuspeech accepts finite scalars without the former min/max ordering or
  operating-range constraints. The original geometry implementation decides
  the result.
- Sinsy's internal `240/speed` must fit its unsigned native frame-period type.
  Score octave is a signed native integer; duration uses unsigned ticks.
  MIDI, BPM and note-length cages are removed. The helper uses Sinsy's native
  480 ticks per quarter note and a measure length matching the authored notes.

Separate resource limits remain: input size, disposable worker timeout,
waveform memory/duration, finite PCM, and predicted work. HTS and Sinsy run
their original native state-generation step, check predicted work, then run
their original parameter/sample-generation steps. A 50,000-frame budget
prevents excessive MLPG allocation; no knob value is clamped. Models and
synthesis algorithms remain original.

HTS returns its actual native sample rate even beyond Web Audio's supported
AudioBuffer range. Handle that as output resampling, not a native knob limit.

## eSpeak emphasis fix

Upstream SSML_EMPHASIS replaces amplitude with absolute 75/100/120 (150 for
x-strong), ignoring previously configured engine gain. Generated markup now
nests native percentage-volume prosody inside the emphasis tag. The gain
therefore scales native emphasis amplitude before synthesis, retaining native
stress/timing and avoiding preventable native clipping. Text remains escaped.
The native x-strong option is now available too.

## Evidence

- `espeak-emphasis-proof.json`: 32 real Chromium renders. Across both eSpeak
  routes and four emphasis modes, gains 65/36 differ and gain zero is silent.
- `native-limit-proof.json`: 41 real Chromium renders, all finite bounded
  PCM, no errors. Includes eSpeak gain450/pitch150/rate500; Flite mean900;
  Pico gain6/speed6; Gnuspeech breath100/loss100/radius.1–4; HTS pitch+192,
  GV12, gain30, speed.05–12, frame3000, rate110250, beta2 and threshold−1.
- `/tmp/voicesaurus-sinsy-port/final-native-proof-summary.json`: 42 cases,
  39 finite PCM results including all ten final presets, score pitches below
  0/above127, BPM1/2000 and pitch+192. Two renders hit declared work/duration
  budgets. GV12 produced native non-finite audio, confirmed in a focused
  rerender and reported. GV12 remains sendable; no cap was added.

Human listening and touch acceptance are not claimed by these checks.

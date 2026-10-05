# Synthesaurus: browser, CPAL, and CLAP

`synthesis.html` uses the shared Rust synthesis core in a WebAssembly
AudioWorklet. It contains no JavaScript oscillator substitute. The native CPAL
player and CLAP plugin use that same core and the same generated preset bank.
CLAP is a native plugin format; the browser uses Web Audio for device output.

## Browser percussion input

The **Drums & percussion** input adds six original technique studies with dated
references: analog rhythm composition, PCM drum playback, swept electronic pads,
analog/PCM hybrids, modal percussion and FM percussion. Each provides three kits
and three independently selectable rhythm patterns. Eighteen complete percussion
performances also appear in the main preset bank. Historical context, sources
and approximation boundaries live on `synthesaurus-reference.html#percussion`.

Eight pads share a 16-step velocity editor with captured drag painting and undo.
Shift paints accents; Alt paints soft hits. A/S/D/F/G/H/J/K strike the pads;
MIDI notes 36/38/42/46/45/50/39/51 address the same sounds. Play runs the drum
sequencer, while manual pads work with Play stopped or running. Audio remains a
separate explicit action. The general arpeggiator and tuning map are not routed
to this bank. Ring time, noise, pitch sweep and FM parameters belong to individual
sounds; there is no global ADSR. Edits affect subsequent strikes, not old tails.

`rust/core/src/percussion.rs` is a dedicated 24-voice bank, not eight copies of
the full teaching synthesizer. It snapshots voice parameters on each strike,
uses bounded deterministic allocation and short choke/steal ramps, and renders
stereo into the existing optional processor/output chain. The closed hat chokes
the open hat. Eight cached, original 12-bit procedural one-shots demonstrate PCM
playback; no manufacturer ROMs or factory recordings are bundled. PCM duration
is limited by both playback rate and its source envelope; decay cannot extend it.

The worklet's existing beat/sample clock schedules both pads and drum lanes.
Kit edits keep rhythm phase; rhythm edits keep sound parameters; running whole
presets commit kit, rhythm and tempo in one scheduled transaction. A drum score
temporarily owns the worklet sequence slot; returning to Synthesizer restores
the remembered arpeggiator. Normal Stop permits short tails; panic clears them.
The browser exposes this new route; CPAL/CLAP menus do not yet expose the bank.

Focused checks: `node --test tests/synthesis-percussion-*.test.mjs` and
`npx playwright test e2e/synthesis-percussion.spec.mjs`. These establish timing,
safety, continuity and interaction—not listening approval or hardware fidelity.

## Existing synthesis and processing engines

The page covers 53 synthesis methods and 17 stereo processors with eight presets each. Frequency, amplitude
envelope, output, and the note gate are shared; method-specific controls retain
their own DSP meanings. Synthesis defaults to **Mono**, with last-held-note priority. Select **Poly · 8 voices**
to play independent notes with their own pitch, velocity, model state and ADSR.
Voicing stays selected through presets, Next, Random and method changes. The
oldest note is stolen only after idle and released voices are exhausted.
Processors have a separate stereo path and hide the voicing selector.
The optional two-row keyboard follows the selected **Tuning / note map**; the main frequency control remains
continuous. The sourced menu includes equal divisions, ratio and historical tunings, familiar note sets,
culturally specific keyboard maps, explicit teaching models, and the non-octave Bohlen–Pierce tritave.
The same resolver drives the keyboard, incoming MIDI, Trigger chord, and every sequence. Audio arming is separate
from Play/Repeat, and presets preserve the tuning, sequence choice and sequence parameters,
master output and running transport. Once Audio is armed, selecting a method
or preset plays one audition note. **Synthesis** and **Processing** have separate
method menus, searchable preset banks, and tours: 424 synthesis presets and 128
processing presets. **Next** traverses the active section in method-menu order,
then wraps within that section; after a custom edit or **Random**, it continues
after the last selected factory preset. The preset dice chooses a method and new
settings within the active section. Each section remembers its sound, edits and
tour position while the page stays open. Existing method/preset URLs open the
correct section automatically. **Random synth** (or **Random
effect**) beside Play/Trigger keeps the current method and varies its parameters,
pitch and envelope. Both preserve output, voicing, tempo and transport. Neither
starts microphone capture. Processing foregrounds input, wet mix and bypass; note
timing, voicing and ADSR belong to Synthesis. Switching to Synthesis releases live
input; returning to Processing requires an explicit input restart. Processing
dice retains an explicitly selected external source, including across methods.
Physical strikes and reeds use coupled random ranges that keep their exciters
audible.

The circular **Play / Pause** button runs a demo. With **Direct note** selected, physical strikes and
zero-sustain sounds pulse at **10–1,200 BPM**, with note length from **5–95%**
of the beat, while sustained sounds hold a continuous note. Three basic tuning-chord choices retain
up, down, and up–down traversal. The other 63 choices run newly authored studies through a bounded
beat-addressed compiler. Each exposes cycle controls plus parameters specific to its arpeggiator,
Euclidean, polymetric, Markov, gesture, tracker, phrase, groove, mutation, or conditional mechanism.
The behavior follows the current method
and envelope automatically, including during edits and preset changes.
Timing runs on the audio thread; live tempo changes preserve the remaining
beat fraction. Tuning, root, sequence-parameter, preset, and method changes preserve
Play and phase. The active study's edits survive a study round-trip and page reload.
Audio remains explicitly armed.

**Octave-range keyboard arp (1982)** follows the JUNO-60's Up, Down and Up/Down
range controls. The original offered one to three octaves; this study extends
that to eight and adds inside-out/outside-in traversal. **Complete traversal**
derives the cycle length from the notes, octave range and direction, including
the return journey without repeated turnaround notes. Its six original presets
demonstrate one-, three-, five-, seven- and eight-octave patterns. Other ordered
arpeggiators can opt into this policy without changing their saved patterns.
The 64-step event budget remains enforced. When the complete field fits, all
notes move together by whole tuning periods into the 20 Hz–8 kHz output range;
this modern extension preserves pitch contour rather than imitating the
hardware's upper-keyboard repetition. See the [original operation manual,
pp. 19–23](https://cdn.roland.com/assets/media/pdf/JUNO-60_OM.pdf) and
[Roland's release history](https://www.roland.com/global/products/rc_juno-60/).

**Trigger Note** plays one finite note in Mono. **Trigger Notes (poly)** plays
three simultaneous degrees chosen for the active tuning or note map, with one attack per voice.
If needed, the entire chord folds together by the tuning's declared period to keep its intervals and
ordering distinct inside the supported 20 Hz–8 kHz range.
The processor button remains a three-second input audition. With a sample or
audio file selected, **Loop input** controls whether Play repeats the whole input
or plays it once; it is on by default and survives preset changes. Changing it
while playing takes effect without restarting the sample. **Restart sample** /
**Replay file**, or Audition, can replay an input that has finished. Live mic and
continuous test signals do not use this switch.

The processing Input menu also includes four original musical loops at 120 BPM:
bass groove, electric-piano chords, plucked strings and a synth arpeggio. They
are rendered with the Rust synthesis engine, retain exact bar lengths and
wrapped release tails, and load only when selected with Audio enabled.
See [loop provenance and regeneration](../assets/synthesis/loops/CREDITS.md).

Every continuous method control has a slider and an exact numeric field in
its displayed units. Discrete algorithms use dropdowns. The sixteen-slot state
format preserves original method IDs and migrates old eight-slot patches using
the added controls' neutral defaults. Frequency reaches 8 kHz; the ADSR ranges
match the engine: attack up to 12 seconds, decay up to 12, release up to 16.

The ADSR graph replaces the envelope sliders. Drag A, D and R horizontally to
change their times, and S vertically to change its held level. Arrow keys and
exact numeric fields offer precise adjustment. The shaded sustain duration is
illustrative; the actual note holds until release. A trigger or preset audition
has one attack. In Mono, returning to an underlying held note changes pitch
without restarting its envelope or re-exciting its physical model. In Poly,
held keys, auditions and repeated notes have independent envelopes and can overlap. If tempo playback is active,
its next strike waits a full repeat interval after the audition's gate ends.

The oscilloscope includes an optional live logarithmic **Spectrum overlay**, using
the same frequency bars as the chaotic synths. Bars show frequency and dBFS; the
bright waveform shows time with automatic amplitude scaling. The separate
spectrogram retains frequency history. Both plots stay visible in a compact
bottom dock on phone portrait and landscape layouts while the controls scroll.
**Freeze** holds plot data through rotation and display-mode changes; audio and
meters continue running.

See [method descriptions](synthesis-methods.md),
[sequence history and provenance](synthesis-sequences.md),
[tuning sources and limits](synthesaurus-tunings.md), and
[neural model provenance](synthesis-neural-models.md). The four learned examples
are small original trained models; they do not bundle the full named research
systems or external pretrained weights.

## Output calibration

Browser, CPAL and CLAP share a fixed gain for each synthesis factory preset. Processor presets instead expose their input/output gains directly; bypass preserves the original input before the shared master. The master
starts at 70% and reaches 100%; preset recall and Random preserve the chosen
master. Parameter edits retain the preset's calibration, while Random uses the
current method's median reference gain. Calibration is independent of velocity
and ADSR, so quiet playing and decays retain their dynamics. The listening target
is now −12 dBFS core K-weighted score (about −15.1 dBFS after the default
master), 6 dB above the previous target; factory sample peaks stay below 0.78.
Peak-constrained strikes retain their attack and can have lower average energy.

The synthesis output stage is linear through ±0.8 and bends smoothly toward a
±0.95 sample ceiling for louder edited settings. This is sample protection,
not a certified true-peak limiter. Factory calibration leaves additional peak
headroom. Custom samples and extreme edits can change perceived level. Poly retains the
Mono calibration for a single note. Chords use smoothed voice-count headroom
(1/√active voices) and the same sample ceiling, preserving velocity and ADSR dynamics.
See [measurements and reproduction](synthesis-level-calibration.md).

The level repair also removes an unintended fourfold shaker resonance offset,
keeps FDN delay ratios distinct when storage limits the requested resonator size,
and accounts for held-noise autocorrelation in its static power normalization.
The Rössler “Slow irregular drone” preset now places its dominant energy in the
audible bass range: its former setting concentrated about 80% below 20 Hz.
Fourteen factory examples now use more audible source settings: full-feedback
Karplus strings preserve ringing instead of canceling their loop; a hard pulsaret
uses an audible-width burst instead of a roughly 262 kHz internal carrier;
mass–spring examples reduce subsonic displacement dominance; shaker resonances
and three FDN examples reveal more of the struck body. Full control ranges remain
available. No live normalization is applied to compensate for those model problems.

Preset auditions fade only the outgoing signal for 8 ms. The new note keeps its
own ADSR attack; the former second fade-in could suppress a brief pluck by about
13 dB peak when another preset was still decaying. Ordinary held method changes
retain their original crossfade.

To regenerate factory gains after changing synthesis code or presets:

```sh
npm run build:synthesis-wasm
npm run calibrate:synthesis
npm run build:synthesis-wasm
```

The last build refreshes native preset data and the browser source fingerprint.
The calibration report binds the measurements to the WASM and sound-defining
preset fields, so a changed bank cannot silently reuse stale measurements.

## Browser build

Install Rust with the `wasm32-unknown-unknown` target, then from the repository:

```sh
npm run build:synthesis-wasm
npm run dev
```

Open `/synthesis.html` at the preview URL printed by the server. The committed
`assets/wasm/synthesis.wasm` allows ordinary static hosting without Rust at
runtime. `synthesis-build.json` records source and binary hashes, checked by the
DSP tests. The build also derives the native preset table from `catalog.js`.

## CPAL standalone player

On Linux, CPAL requires the ALSA development package (`libasound2-dev` on
Debian/Ubuntu). macOS and Windows use their native device backends.

```sh
cargo build --manifest-path src/instruments/synthesis/rust/Cargo.toml -p synthesis-cpal --release
src/instruments/synthesis/rust/target/release/synthesis-cpal --list
src/instruments/synthesis/rust/target/release/synthesis-cpal --method fm --preset 3 --seconds 5
src/instruments/synthesis/rust/target/release/synthesis-cpal --method padsynth --preset 2 --seconds 6 --render /tmp/padsynth.wav
src/instruments/synthesis/rust/target/release/synthesis-cpal --method fm --preset 0 --poly --notes 220,277.18,329.63 --seconds 6 --render /tmp/fm-chord.wav
```

The player defaults to one monophonic engine. `--poly` enables an eight-voice
bank for every synthesis method; `--notes` supplies one to eight comma-separated
frequencies in Hz. Multiple frequencies require `--poly`; `--frequency` remains
available for a single note. Frequencies range from 20 to 8,000 Hz, with the
core applying its sample-rate-dependent upper bound. Each chord note gets its
own model and ADSR, and all notes release in the final part of the demo.

`--render` writes the mix as a mono 48 kHz PCM WAV without opening an audio device. Playback
uses the selected device's sample rate and channel count, with explicit support
for float32, int16, and uint16 device formats. The final quarter, up to one second, releases the
note; a longer envelope can extend beyond this fixed example duration.

## CLAP plugin

```sh
cargo build --manifest-path src/instruments/synthesis/rust/Cargo.toml -p synthesis-clap --release
```

The native library is `libsynthesis_clap.so` on Linux. Copy it with the
`.clap` extension into your host's CLAP scan folder when you want to install
it. Build on the target operating system/architecture. This task does not
install a plugin into a DAW or change your audio device settings.

The plugin supplies stereo output, CLAP/MIDI note input, method and preset
selection, amplitude controls, Mono/Poly voice mode, and up to sixteen method parameters through the host's
generic parameter interface. No custom graphical plugin editor is required.
The source uses the `clap-sys` Rust bindings; the standalone player uses `cpal`.

## Verification and limits

```sh
npm run test:synthesis
cargo test --manifest-path src/instruments/synthesis/rust/Cargo.toml -p synthesis-core --features neural --release
MORPHAZOID_QA_BASE_URL=http://127.0.0.1:3475 npm run test:browser -- e2e/synthesis.spec.mjs
npm run verify
```

Use the actual responding preview URL in browser checks. Automated tests check
real output, finite bounds, release, determinism, parameter changes, preset
separation, browser lifecycle, and responsive controls. They do not establish
musical preference or replace listening and real audio-device/DAW testing.

Built-in sample material is synthesized by the project. Imported files remain
local, are mixed to mono, and are limited to the first 262,144 decoded samples
(about 5.5 seconds at 48 kHz). The common Rust core supplies DC rejection and a
soft output ceiling; output begins at a moderate level. The scope rescales its
vertical range and displays that range, while the meter reports actual dBFS.


## Stereo processing and the FX plugin

The seventeen processors use `ProcessorBank` in the same Rust core as the WASM worklet. Their input, source gate, dry/wet, bypass and output trim are independent of synth notes, ADSR and synthesis calibration. The separate `synthesis-fx-clap` artifact exposes stereo input/output and keeps the existing synthesis plugin identity and state compatible. Its ID is `org.morphazoid.synthesaurus.fx`; it defaults to external input. The browser can use microphone/line input, local stereo files, bundled loops and ten deterministic test signals, including pink, brown and Gaussian white noise.

The spectral processor adds 1,024 samples of latency, including its aligned dry mix; full bypass is immediate. FX CLAP reports this through the latency extension. Changes that cross the latency boundary request a host restart and retain the previous DSP until reactivation; hosts without restart support retain the old DSP. Ordinary same-latency edits remain live. CPAL offline renders retain the delay rather than trimming the onset. Freeze capture clears on stop, reset or source/mode changes and can be rearmed; external synth release tails are processed live after disarming.

```sh
cargo build --manifest-path src/instruments/synthesis/rust/Cargo.toml --release -p synthesis-fx-clap -p synthesis-cpal
cargo run --manifest-path src/instruments/synthesis/rust/Cargo.toml -p synthesis-cpal -- --processors
cargo run --manifest-path src/instruments/synthesis/rust/Cargo.toml -p synthesis-cpal -- --processor delay --input recording.wav --render processed.wav --seconds 12
cargo run --manifest-path src/instruments/synthesis/rust/Cargo.toml -p synthesis-cpal -- --processor vocoder --preset 0 --source 7 --seconds 8
```

CPAL accepts mono/stereo PCM16/24/32 and float32 WAV files, preserves input sample rate for offline output unless overridden, and resamples for device playback. Live capture is available in the browser and FX CLAP; CPAL does not yet capture live input. The FX library builds at `target/release/libsynthesis_fx_clap.so` on Linux; packaging it as `.clap` follows the same platform conventions as the synth plugin. Host ABI tests and file processing tests do not substitute for a real DAW/device audition.

# STK VoicForm and Cook Singer — real WebAssembly voices

This module contains two actual synthesis implementations, compiled to one WASM
binary. It opens no audio devices and creates no AudioContext. It is suitable for
a module worker rendering PCM, or a bounded AudioWorklet wrapper. Both models
operate at 22,050 Hz. Do not change this rate without retuning Singer's tract data.

## Sources and licenses

STK 4.6.2, commit `f3ce5f4d04c83ec2d1661914a5dfc8437758fb4c`:
<https://github.com/thestk/stk/tree/f3ce5f4d04c83ec2d1661914a5dfc8437758fb4c>.
Its original `VoicForm`, `SingWave`, four formant filters, modulation classes and
32-phone measured data are compiled unchanged. The original `impuls20.raw`
excitation is embedded in the WASM filesystem. Exact permissive STK terms are in
`COPYING.STK`. STK's active tick implementation sums four formants in parallel;
its header also discusses an alternative cascade arrangement, which is commented
out in this release. This port uses the active original implementation.

Singer is a C++ translation of Perry Cook's physical singing model as distributed
in Bill Schottstaedt's Snd `singer.scm`, itself translated from Cook's original C
and CLM `singer.ins`. The unmodified Scheme reference is in `source/singer.scm`.
Its 71 tract shapes and 7 glottal configurations are preserved numerically in
`source/singer-data.h`. The port retains the nine-section oral tract, six-section
nasal tract, three-way velum junction, glottal Fourier construction, lip/throat
radiation, fricative noise filter and first-order tract trajectory smoothing.
The tiny `singer-filter` and `singer-nose-filter` optimized recurrence loops are
translated from Snd's `clm2xen.c`:
<https://ccrma.stanford.edu/software/snd/snd/singer.scm>
<https://ccrma.stanford.edu/software/snd/snd/clm2xen.c>.
Snd's exact permissive terms are in `COPYING.SND`; preserve Cook and Schottstaedt
attribution. Source hashes and locations are in `sources.json`.

Historical milestones: Singer's source cites Cook's ICMC 1989 paper, his 1990
thesis, and the 1993 SPASM/Singer Computer Music Journal account. STK's project
lineage begins 1995. These dates do not date this 2026 browser port.

## Adaptations and limits

`source/musical-voices.cpp` is the new integration layer. STK subclasses expose
protected controls and suppress redundant pitch targets: the original SingWave
sets its glide increment to zero when the same frequency is requested while a
glide is still moving. The wrapper preserves that running transition.

Singer replaces CLM envelope/oscillator/random host objects with C++ state,
uses a deterministic xorshift random source, exposes continuous pitch and shape
controls, and applies a brief glottal amplitude smoothing envelope. Changing
its glottis selector crossfades tables computed with Cook's original equations.
These are documented integration changes, not a claim of bit-identical output
to the original CLM runtime. All 71 original shapes are exposed, including `open`: its
feedback can become nonfinite on longer notes, while short finite notes remain audible.
`PLAYABLE_SINGER_SHAPES` provides the complete original list. The original example phrase
scheduler and CLM file-output interface are replaced by the sequence API below.

The optional 43-gesture adapter is newly authored, approximate English articulation
on these native phones/shapes. Its stops use closure/release stages; diphthongs
move between vowel shapes. It is not an original STK/Singer text-to-speech front
end, and does not supply whole-language pronunciation/prosody. It removes DC,
fades boundaries and balances each returned gesture to at most 0.14 RMS/0.8 peak,
with a 32× maximum gain. The underlying raw synthesis API remains available.

## API

```js
import {createMusicalVoices} from './voice-api.js';
const engine=await createMusicalVoices();
const voice=engine.create('singer'); // or 'stk'
voice.set({phone:'ahh',pitch:220,glottis:'soft',velum:0.2});
const samples=voice.render(22050); // Float32Array, one second
voice.set({phone:'eee',pitch:330}); // smooth tract transition, same voice
const next=voice.render(11025);
voice.release();
const releaseTail=voice.render(4410);
voice.dispose();
```

`engine.synthesize({method, sequence:[{phone,duration,pitch,...},...]})` returns
`{samples,sampleRate}` and disposes its temporary voice. Durations are seconds.
Native numerical controls are forwarded without app-defined clamps. Initial knob
spans are display views, not parameter limits. STK retains its original restrictions:
VoicForm accepts zero and negative frequency in this release build (the upstream positive-frequency warning is debug-only); OnePole requires an absolute pole value below 1;
FormSwep accepts 0..Nyquist frequencies, 0<=radius<1, and 0..1 sweep rates; Envelope gain
slew is nonnegative. Invalid scaled formants now report an error rather than silently
retaining an earlier target. Source gains, modulation, one-zero coefficient and native
formant gains can be negative or exceed ordinary musical values.

Singer accepts finite source, geometry, modulation, smoothing and Fourier A/B values.
Its original 200-slot Fourier arrays require a harmonic count below 200; counts below 1
produce the source algorithm's empty table. Phase wrapping supports reverse excitation
and deep modulation. Controls do not clamp tract scale or reject merely loud output.
An inactive velum or tongue override is represented separately from its numerical value,
so negative edits reach the native equations. Frication positions become array indices
when noise is active, preserving the native requirement that the addressed section exist.

All model feedback stays untouched. Nonfinite internal output rejects the render. Finite
samples exceeding Float32 representation are saturated only at the PCM handoff; host
output protection can then make them audible. Note duration/allocation ceilings protect
browser resources and are separate from native DSP parameter ranges. The note host no
longer renders and discards an extra post-release tail that could reject an otherwise
finite audible note.

```js
import {createMusicalGestureRenderer} from './musical-gestures.js';
const render=await createMusicalGestureRenderer();
const {samples,sampleRate}=render('ee',{
  method:'singer',pitch:220,glottis:'soft',velum:.15,vibrato:.015,vibratoRate:5
});
```

Native gesture options are forwarded only when supplied. The gesture `noise`
option is a 0–4 multiplier on the native/staged excitation, preserving plosive
closures and consonant gains. `balance:false` disables per-gesture gain balancing;
DC removal and clip-edge fades remain atlas preparation. This wrapper renders
phoneme PCM, not real-time transport: the host owns note scheduling and consent.

## Rebuild

Requires Python 3.12+, an Emscripten SDK (validated with 4.0.22), and a compiler
cache writable in the SDK's configured environment:

```sh
python3 rebuild.py /tmp/musical-voices-output \
  --build /tmp/musical-voices-build --emsdk /path/to/emsdk
```

The build downloads the pinned STK source archive and checks its SHA256, compiles
its DSP plus the supplied Singer translation and embeds its excitation data.
`build.json` records the compiler and emitted-file hashes. Singer's original
reference and translated source accompany the module; no Snd interpreter is
required at runtime.

## Validation

Node and a real Chromium module worker rendered all 86 mapped gestures, checked
finite nonzero PCM and bounded prepared peaks. Chromium fetched and instantiated
the real WASM binary. Native controls were also tested for 220/440Hz pitch,
nonzero timbre changes, nasal/glottis response and release to silence. This does
not establish subjective voice quality, original-runtime bit identity or human
listening acceptance. Integration must preserve Audio-off consent, lifecycle
cancellation, output headroom and sample-clock playback.

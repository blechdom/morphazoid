# Direct STK / Singer note interface

`src/families/speech/native-musical-notes.js` renders a selected original model
input. It does not parse language or import the English gesture adapter.

```js
const render = await createNativeMusicalRenderer();
const note = render('singer', {phone: 'ahh'}, {
  pitch: 220, duration: 2, destination: 'eee', changeTime: .6,
  attack: .01, decay: .1, sustain: .8, release: .15,
});
// note.samples, note.sampleRate, note.noteOffTime, note.duration
```

Singer exposes all 71 original shapes (including `open`, whose short notes can be finite), all seven original glottal configurations and all 17
shape-table parameters: eight oral radii, glottal and lip reflection, frication
injection position and gain, two frication filter frequency/pole-radius pairs,
and velum opening. The separate tongue hump and tip trajectory poles now match
the source recurrence grouping. Additional controls expose pitch, glottal/noise
excitation, periodic/random modulation and the glottal harmonic count/A/B
Fourier coefficients. The custom glottal editor extends the original seven
configurations; it is not another historical voice database.

STK exposes all 32 original phoneme rows, voiced/noise gains, pitch and gain slew,
periodic/random modulation, source pole/zero, four explicit formant
frequency/radius/gain triples and four filter sweep rates. The source `sss` row
contains a zero-Hz first formant; this is preserved. Direct formant edits support
0–Nyquist frequency and radii below one. STK's actual active instrument sums its
four resonators in parallel.

The original tables remain the default. Coefficient edits activate explicit
overrides. `nativeMusicalDefaults(engine,input)` reads the selected source row;
use it before overlaying a preset's values. The native model deliberately permits
silence (for example zero voiced and noise excitation). Some experimental
geometries are unstable; the render guard rejects them with an error and does
not substitute a different voice. In particular the preserved `rr2` fixture has
a second noise pole radius of 32.000004 with zero frication gain; activating that
pole is not a stable filter configuration.

ADSR, bounded note duration and timed destination selection belong to the new
note host. The model runs through the host's release interval, then receives its
actual release/quiet call and is disposed. A fixed, source-row calibration uses
2-second, 220-Hz references, with a maximum 32× trim. Output-only DC removal and
soft headroom protection never feed back into the physical/filter model.
Amplitude and excitation controls are not canceled by per-note normalization.

The underlying Singer port remains a C++ translation of the Snd/CLM recurrences,
with documented oscillator/random/envelope-host adaptations. The 22,050-Hz model
rate, original glottal table resolution, original nasal reflection constants and
STK excitation sample remain fixed. This does not claim bit identity with an
independent CLM runtime or human listening acceptance.

Validation: all 102 original inputs and 24 native note presets rendered finite,
nonzero notes; new coefficient paths and original glottal choices were exercised.
Known unstable geometry was rejected. Chromium loaded the actual updated WASM
worker. The new bridge preserves byte-identical PCM from all 102 previous raw
API default input renders. Standalone proof files are in the task's scratch
artifacts; repository verification must additionally cover UI and transport.

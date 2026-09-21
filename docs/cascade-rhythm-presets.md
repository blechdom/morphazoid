# Cascading FM / PM: rhythm-first preset replacement

## Scope — September 21, 2026

The owner rejected the previous factory/header banks as harsh drones and asked
for hierarchical LFO rhythms, beating and syncopation, beginning with simple
examples. This replaces **all twelve full presets on each cascade**, including
the underlying factory bank, startup and Reset selection. It is not an append to
the rejected bank.

The synthesis equations, oscillator connections, phase accumulators, bandwidth
guards, smoothing, tap crossfades, output routing and cleanup are unchanged.
Only preset/default data, preset UI wiring and corresponding assertions changed.
The default becomes **Slow Steps**. Master output defaults are 48% for FM and
40% for PM, before the engines' existing normalization and compression.

No new sequencer, amplitude gate, sample, effects chain or randomly generated
parameter scaling was added. Only the final sine in the cascade reaches output.
Consequently the rhythm includes changing pitch and spectral accents, not
necessarily silence between evenly quantized drum hits.

## One obvious main menu

The header offers a single list of full presets. The duplicate Character button
bank is removed from these two pages, while its compact area now explains the
selected preset and how to listen. All five cascade parameters, output level,
Audio and Reset controls remain available.

There is **no “Edit preset ingredients” section** or editor-relocation mechanism
in the authored shared header menu. This does not remove body/rhythm/skin
sub-preset editors belonging to other instruments.

The one data source is `src/families/cascading/rhythm-presets.js`, re-exported by
the existing FM/PM model modules. `full-presets.js` wraps those same records as
complete header snapshots. Startup, Reset, descriptions and header selection
therefore cannot drift onto different banks.

## Listening order

| Preset | Intended relationship |
| --- | --- |
| Slow Steps | A slow sway reshapes quicker steps; the default introductory hierarchy |
| Simple Sway | One 3 Hz LFO and one low final sine, making the basic modulation obvious |
| Sway Inside Sway | Two modulation time scales before the audible result |
| Pocket Pulse | A four-second root containing faster nested pulses |
| Triplet Walk | Threefold rate relationships rather than only octave/doubling relationships |
| Skipping Stones | Non-integer rate relationships and shifting emphasis |
| Drifting Beats | Near-doubled rates whose relative alignments gradually slip |
| Long / Short | Slow phrase motion with uneven faster subdivisions |
| Slow Tide | An eight-second root; listen for the complete slow cycle |
| Quick Feet | Faster nested motion, still in a low register |
| Off-Centre | Non-integer layers that avoid a straight, identical accent pattern |
| Busy Weave | The deepest study, with moderated depth rather than a high-frequency wall |

FM and PM are intentionally tuned separately. FM deviation is in Hz; PM
displacement is in radians. The two Simple Sway voices, for example, use
different carrier ratios to make their motion clear without unsafe intermediate
states when switching out of deeper chains.

Suggested audition: start with Slow Steps, compare Simple Sway with Sway Inside
Sway, then let Pocket Pulse, Drifting Beats and Slow Tide run for at least one
complete slow cycle. Change root speed and taper separately to hear their
different roles. The direct controls still expose the wider instrument range.

## Mechanical evidence, not listening approval

Seven focused Node suites passed: **52 tests, zero failures**:

- `tests/cascading-fm.test.mjs`
- `tests/cascading-pm.test.mjs`
- `tests/cascading-preset-safety.test.mjs`
- `tests/cascade-rhythm.test.mjs`
- `tests/full-instrument-presets.test.mjs`
- `tests/header-preset-menu.test.mjs`
- `tests/choose-picker-position.test.mjs`

The PM suite exercises **144 ordered live preset transitions** in the real
processor class, retaining the original sample-step and preallocated-storage
requirements. The transition phase varies per ordered pair. Early candidate
settings failed this check; the presets were retuned rather than raising the
limit or altering the processor.

The offline analysis renders all 24 presets for 12 seconds at 48 kHz from three
different initial phase offsets: **72 reference renders**. FM follows the page's
actual sine-to-next-frequency wiring; PM is numerically checked against the
existing model renderer. References exclude browser oscillator implementation
details, compression, master gain and hardware output.

Measured ranges in these references:

| Observation | FM | PM |
| --- | ---: | ---: |
| LFO root | 0.125–3 Hz | 0.125–3 Hz |
| Final base frequency | 52.65–128 Hz | 48–89.1 Hz |
| 50 ms spectral-activity 90th/10th percentile contrast | 1.73–11.18× | 1.33–2.90× |
| Maximum measured 99%-energy rolloff across sampled FFT windows | about 350 Hz | about 337 Hz |

Compared with the prior rejected bank at the same all-zero initial phase:

- FM median spectral-activity contrast rises from about **1.01× to 2.18×**;
  median sampled rolloff drops from about **2,109 Hz to 180 Hz**.
- PM median activity contrast rises from about **1.06× to 1.63×**;
  median sampled rolloff is about **237 Hz**, versus **212 Hz** before.
  The PM improvement here is deliberately stronger time variation, not a claim
  that every spectral measure became lower.

“Activity” is first-difference RMS, a coarse measure of local spectral change.
It is not a musical syncopation score. Most deeper presets also pass an amplitude
contrast check; the simple examples intentionally demonstrate pitch movement,
not an invented volume gate. FFT measurements sample six windows per render,
not every instant or every possible live transition.

These measurements show that the new states produce bounded, changing signals.
They do **not** establish sweetness, groove, absence of perceived harshness,
usefulness on phone speakers or human approval. The owner should audition them.

## Reproduce and continue verification

```sh
npm run analyze:cascade-rhythm
```

This writes ignored analysis artifacts under `test-results/cascade-rhythm/`.
The implementation pass also saved the rejected banks and comparison renders
there. `dsp-preservation.json` records the unchanged DSP function/class bodies.

`e2e/cascade-rhythm.spec.mjs` now checks main-menu/default/Reset consistency,
all preset recall states, explicit Audio, retained live audio ownership and
teardown. **It has not been run in this pass.** The prior browser/build approval
service failure remains unresolved; no denied browser/build command was retried
through a workaround.

The full repository gate and regenerated WAX/production artifacts remain
pending. `dist-wax/` still predates these changes and must be regenerated with
the approved build command, never hand-edited. No commit, main push or deployment
was performed for this preset replacement.

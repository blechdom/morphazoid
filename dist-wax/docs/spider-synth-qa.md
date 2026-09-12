# Spider Synth — QA record

Date: 2026-09-12. This records automated tests and offline signal measurements.
It is **not** a human listening, physical mobile device, or DAW approval.
Desktop, mobile-layout, source and generated-WAX browser checks are included
below. WAX browser checks do not constitute a test in a physical DAW host.

## Integrated focused tests

The integrated Node run passed **60 tests, zero failures**: model 22, asset/viewer
4, audio 25, MIDI 8, release consistency 1.

- The delivered specimen is 5,488,852 bytes, with all 106,200 animal triangles,
  the 4096 × 4096 color atlas, and 38 authored weighted bones. Asset checks
  verify normalized skin weights, neutral inverse binds, joint identities,
  output hash, and removal of the calibration cube. See
  [asset provenance](../assets/spider-synth/SOURCE.LICENSE.txt) and
  [preparation notes](../assets/spider-synth/ASSET.md).
- Model checks cover all 24 routines, deterministic direct-time sampling,
  bounded poses and web topology, reachable contacts, nonsliding stance anchors,
  and exact touchdown ledgers. Actual scan-chain tests cover 24 routines × 20
  sampled poses, with contact error below 0.001 web units and no mutation of
  the supplied pose. Planted web segments remain flat; temporary strand/prey
  graphics expire on the shared clock.
- Audio checks cover the shared contact ledger without graphic updates,
  string pitch within 3% at 220/440 Hz, substring/tension/crossing-angle
  causality, bounded adjacent coupling, live controls, idle/release silence,
  all 16 source responses, five distinct string materials, real KAL speech,
  voice mute, and sample-grid metronome pause/resume.
- MIDI checks cover 24-record ownership limits, eight independently posed
  legs, static held poses, source/channel isolation, sustain, pressure, bend,
  expression, panic, and clock adoption. Saturated notes plus maximum leg XYZ
  controls retain exactly stationary planted anchors. Audio remains explicitly
  armed; cancelled loading cannot arm later or replay released notes.

The rig, gait and silk-frequency scale are authored approximations, not measured
animal anatomy or validated biological acoustics. Spinneret sound follows
abdomen movement; the scan has no independently articulated spinneret joint.

## Audio mechanism and measured levels

The worklet owns 24 fractional-delay Karplus string loops and eight body voices.
The shared foot touchdown ledger excites the corresponding visible strand;
substring length and tension determine pitch, while crossing angle and speed
shape excitation. Coupling adds at most one adjacent generation. At the fixed
voice limit, surplus attacks are dropped instead of stealing live tails.
Still resonance and event percussion have separate gates. The control clock is
200 Hz and does not depend on rendering. The design follows
[Jaffe and Smith's Karplus–Strong extensions](https://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf).
Speech uses the bundled KAL16 atlas and CMU pronunciations; no Roach worklet or
Roach animal recordings are loaded.

Offline renders used stereo 24 kHz, four seconds per scenario, intensity 0.65,
tempo 108, and three deterministic noise seeds. The 24 motion companions were
each rendered with all three seeds. Default still/walk/voice used three seeds
each, and all 16 sound presets rendered speech: **97 scenarios total**. Samples
were not gain-normalized. The phrase was “hello, I am a spider. Please do not
break my web.”

| Default state | RMS dBFS | Peak dBFS | Contacts / plucks, seed 1 |
| --- | ---: | ---: | ---: |
| Still Sound Play | −29.59 | −20.37 | 0 / 0 |
| Orb walk | −25.02 to −24.71 | −5.12 to −4.44 | 28 / 47 |
| Words | −26.08 | −8.93 | 0 / 0 |

Across all motion/seed combinations, RMS ranged from −33.18 to −21.75 dBFS;
the largest sample peak was −3.36 dBFS. Across the 16 spoken presets, RMS ranged
from −26.60 to −25.86 dBFS. Different contact densities intentionally produce
different average levels. Sound Play alone creates no contact or pluck events.

The stereo output guard adds 20 audio frames of delay: 0.417 ms at 48 kHz.
It bounds reconstruction against its specified 4×, 81-tap interpolator; this
does not establish broadcast true-peak certification.

## Callback budget

Node 22 ARM64, 48 kHz, 128-frame callbacks, with 1,000 warmup blocks and 4,000
measured blocks per scenario. Measurements include DSP, the 200 Hz model/MIDI
pose updates, and constraints. Main-thread message normalization is excluded.
The maximum-load case holds 24 notes, moves all group XYZ controls, and reaches
24 active strings. This final run includes the distinct Thumb tine and scoped
string-expression implementation.

| Scenario | Mean ms | p99 ms | Maximum ms | Above 2.667 ms |
| --- | ---: | ---: | ---: | ---: |
| Idle / still | 0.196 | 0.234 | 0.259 | 0 / 4,000 |
| Walk | 0.246 | 0.288 | 1.028 | 0 / 4,000 |
| 24 MIDI notes + moving CC + full string pool | 0.274 | 0.316 | 0.431 | 0 / 4,000 |

These are host measurements, not a guarantee for a particular phone or audio
device. Measured source fingerprints: DSP `8e5280f50e5f0b40`, string core
`3167f72f571f7428`.

## Browser and release verification

All 12 Spider browser scenarios pass on source and on the generated WAX page.
They cover the 38-bone scan and four views, all 24 motion companions and actual
toe contacts, audio during delayed/failed model downloads, retry, voice gestures,
held computer/MIDI notes, direct joint sound, orbit versus zoom, finite prey
flutter, and mobile scrolling at 390×844 and 844×390. The real worklet continues
through a deliberate 450 ms main-thread stall. Resuming suspended Audio preserves
the frozen beat instead of advancing through suspended wall time. Direct gesture
attacks are measured during movement; their intentionally short release is then
checked for silence.

Five shared Spider audits pass: smoke, control inventory, shared controls,
responsive layout, and accessibility. The strict accessibility pass finds no
critical or serious violations. The Roach page and shared MIDI regression suite
passes all 18 scenarios.

`npm run verify` passes: **3,383 tests passed, six skipped, zero failed**, plus
syntax, SIMD, deterministic XYFlow and clean WAX parity checks. The normal/WAX
release and Storybook build succeed; the Storybook artifact checker validates
109 entries. Generated WAX browser testing explicitly arms Audio because an
ordinary browser has no DAW host to arm it. Output probes read the manager from
the tested artifact's own directory.

## Reproduction

From the repository root, using the supported Node runtime:

```sh
node --test tests/spider-synth-model.test.mjs tests/spider-synth-asset.test.mjs tests/spider-synth-audio.test.mjs tests/spider-synth-midi.test.mjs tests/spider-synth-release.test.mjs
npx playwright test e2e/spider-synth.spec.mjs --workers=1
npm run build:wax
npm run verify
```

The audio tests exercise the same exported DSP and shared frame writers as the
worklet. To reproduce the level matrix, instantiate `SpiderSynthDsp(24000)` for
each `SPIDER_MOTION_SOUND_PRESETS` entry and set `strings.randomState` to
`seed * 12345` for seeds 1–3. Enable animation with the settings above, then
render 96,000 stereo frames. Compare whole-render RMS and sample peak; do not
normalize each result. Decode the bundled KAL16 atlas and use
`createSpiderSpeechPlan` with CMU pronunciations for the speech cases.

Human listening, physical-device timing, and DAW capture were **not performed**.
These automated checks establish functional relationships and bounded output;
they do not establish preferred timbre, musical feel, or biological fidelity.

# Spider Synth — version 2 QA record

Date: 2026-09-12. Evidence below is automated browser testing, actual mesh/rig
inspection and offline audio measurement. It does not represent human listening,
a physical phone or a DAW host test. The source scan remains unchanged:
5,488,852 bytes, 106,200 triangles, a 4096-pixel color atlas and 38 weighted bones.

## Coverage

The integrated focused run passed **95 tests, zero failures**.
`npm run verify` passed **3,418 tests, six skipped, zero failures**, plus syntax,
SIMD, XYFlow and generated-WAX consistency checks.

The focused suites cover 17 web families and their construction bounds, 40
motion routines, exact planted toe positions, airborne/tethered phases,
deterministic travel, pause/resume, silk deposition, prey lifecycle and bounded
world snapshots. Ordinary crawling retains four or more supports. Explicit
acrobatics have separate takeoff/landing expectations.

The viewer's actual skinned toes were checked across all 17 families; the
maximum reported supported error was 0.00000879 web units. Visible wave tests
check nonzero strand displacement while endpoints and exact planted toe knots
remain fixed. Integration tests also exercise a real AudioWorklet pluck through
telemetry into the visible wave; synthetic viewer events alone are insufficient.

All **22 browser cases** pass on source and the generated WAX page.
Browser cases cover model loading and retry, separate Sound/Animation players,
spoken face motion, notes and scoped MIDI ownership, sustain-independent travel,
screen-relative joystick steering, lost-pointer/blur release, mobile scrolling,
explicit zoom, web construction changes, retained silk across Audio enable,
fly picking/hunting and no graphics-owned automatic sound triggers. A deliberate
450 ms main-thread stall leaves the worklet producing contacts and bounded audio.

The mobile layouts tested are 390×844 and 844×390. New steering tests send touch
events to the real circular pad, cancel the gesture and confirm no zoom or
transport change. Shared audits cover control inventory, responsive geometry,
accessibility and page diagnostics. All five shared audits pass; strict
accessibility reports no serious or critical violations.

## Sound mechanisms and measured levels

The worklet retains a pool of 24 fractional-delay strings and eight body voices.
Four string slots are reserved from routine contacts/coupling so direct plucks
and notes remain responsive during dense movement. There are 24 selectable
source colors and 24 sound presets, plus motion companion mixes. Six new macros
control texture, slide, courtship substructure, resonant space, silk and prey.

All animal/world sounds are procedural. Real research recordings were located
but not bundled without an explicit redistribution license. The existing KAL16
speech atlas and pronunciation resources remain the only sampled voice assets.
The research ledger distinguishes A. aurantia web responses, related Argiope
courtship and wolf-spider mechanism analogies from the fictional talking voice.

These are pre-host-gain worklet measurements; the shared output level and any
external host gain are additional. Three seeds were used for the default mix.

| Scenario | RMS dBFS | Sample peak dBFS |
| --- | ---: | ---: |
| Default held silk | −25.67 to −25.66 | −15.35 to −15.02 |
| Default moving spider | −25.35 to −25.15 | −5.51 to −4.81 |
| Default spoken phrase | −26.08 | −8.93 |

The 24 sound presets were rendered still and moving for three seeds: 144
scenarios, all finite, with sample peaks at or below −4.57 dBFS. All 40 motion companions also completed 16-beat renders with three seeds,
bringing the preset/motion matrix to 264 finite scenarios. The all-controls
stress case reached −3.61 dBFS sample peak. Event-only sources stop receiving
excitation when motion ends; explicit Sound Play owns held resonances. Struggle
sounds settle after a finite window and eating cancels the prey's activity.

## Resource ownership

The worklet owns 200 Hz control/world sampling and all sound event timing.
World graphs are bounded to 1,200 nodes and 2,400 segments, with eight prey and
256 newly laid strands. Spatial lookup keeps stance projection bounded. The
viewer follows at 20 fps with a 1.15-megapixel cap and one bounded shadow map.
A geometry-only test with 1,167 strands and 32 pulses measured 1.08 ms median and
1.13 ms p95; this excludes WebGL and is not a phone GPU measurement.

The final callback benchmark used 48 kHz stereo and 128-frame blocks, including
10 Hz snapshot serialization. Each regime measured 5,000 blocks after warmup
on this development machine. The deadline is 2.667 ms. These are local CPU
measurements, not a guarantee for every browser or physical phone.

| Regime | Mean ms | p99 ms | Maximum ms | Over deadline |
| --- | ---: | ---: | ---: | ---: |
| Held silk | 0.467 | 0.533 | 0.673 | 0 / 5,000 |
| Moving dense web | 0.544 | 0.719 | 1.475 | 0 / 5,000 |
| All bowed sources | 0.512 | 0.677 | 0.853 | 0 / 5,000 |
| 24 MIDI notes, CC and world activity | 0.600 | 0.710 | 1.376 | 0 / 5,000 |

The workload included 1,192 web segments, up to 24 active strings, eight prey,
silk deposition and maximum texture/Space. The profiled DSP SHA-256 begins
`dcc7eee9ad70e262`; shared world hash begins `4f4d85e804236d7b`.
No graphics or model download is allowed to gate Audio.

## Reproduction

Use the repository Node version, install dependencies, and run:

```sh
node --test tests/spider-synth-*.test.mjs
npx playwright test e2e/spider-synth.spec.mjs e2e/spider-synth-world.spec.mjs e2e/spider-synth-viewer.spec.mjs
npm run build:wax
npm run verify
npm run build:deploy
npm run check:storybook-dist
```

Repeat browser cases with `MORPHAZOID_QA_BASE_URL` pointing to the generated WAX
page directory. Source and WAX runtime modules must share the release graph.
Publication is checked against the exact pushed commit and deployed bytes.

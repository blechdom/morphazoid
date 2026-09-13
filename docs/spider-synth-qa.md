# Spider Synth — version 4 QA record

Date: 2026-09-12. This update adds five independently rigged scanned specimens,
three licensed animal-recording sources, and body/leg clearance handling. The
version 3 and version 2 measurements below are historical, not measurements of
this release. No human listening, physical-phone, hardware MIDI or DAW-host
acceptance is claimed.

## Playback and model loading

The separate pose hotfix `b9606cd` was deployed before this update. Body pose,
Random pose and Reset preserve both players, the selected routine and phase;
starting Animation retains the selected held pose. Three live-site cases passed
at desktop, phone portrait and phone landscape sizes. AWS and Pages deployment
jobs succeeded and all 34 frozen public runtime/page/contract files matched.

The additional skin browser cases exercise all six specimens on desktop and
phone. They verify one initial GLB request, live audio and contact events while
a replacement download is deliberately held, unchanged pose/sound/web/transport,
and paused phase continuity. Invalid rigs, failed requests, superseded selections
and Retry retain a playable specimen. All three skin cases pass. Each replacement
is validated before the previous GPU scene is released; inactive scans are not
kept as live GPU scenes.

Three recording browser cases pass: desktop/phone delayed loading after Audio
arm, movement-triggered grains, finite tails after stopping, a deliberate 650 ms
main-thread stall, and complete recording download failure with procedural sound
still playable. Shared responsive, strict accessibility, strict control inventory
and shared-contract audits pass. Responsive coverage includes 1440×900, 390×844
and 844×390; strict accessibility reports no serious or critical violations.

## Scans and measured recordings

The original scan retains its 5,488,852-byte GLB. Five additional GLBs retain all
animal triangles and photographed 4K textures in approximately 5–6.6 MB each.
All 38 joints have real weighted vertices. Six independent leg-chain profiles
are available before any mesh load, so sound and contact timing cannot wait for
a model download. The asset tests check weights, inverse binds, endpoints, link
lengths, compression decode, body height and license provenance. See
[specimen details](../assets/spider-synth/skins/ASSET.md) for exact sizes and
quality limits; the museum tarantula has softer source detail.

The three excerpts total 261,646 bytes and are credited Maratus volans substrate
courtship vibrations from Girard et al. (2011), not calls of the selected scanned
species. Eight bounded grain voices respond to accepted movement, contacts and
MIDI; there is no unattended recording loop. The new samples do not delay Audio
arm, procedural voices or speech. Sources, extraction and licensing are in the
[recording provenance](../assets/audio/spider-synth/README.md).

## Collision and final integration

The collision suite exercises 5,760 skeletal frames across six specimens and
40 routines, plus 80 hostile manual poses. Normal routine tests keep additional
proxy penetration below approximately 0.000255 web units. Extreme simultaneous
manual edits use an explicit 0.001-unit tolerance (about 0.1% of the scan span).
This is an approximation of solids, not a promise of exact mesh separation.
Skeletal planted-toe error stays below 4e−16 in the normal probe; actual GPU
surface rendering has its separate browser tolerance. Airborne toes can fold
for clearance while planted contacts and the measured link lengths stay fixed.

Main body/abdomen volumes and leg thicknesses are measured from each scan;
palp/fang volumes are derived from authored pivots and body length. Existing
anatomical attachment overlaps remain calibrated baselines. The shared planner
clips exact valid intervals on strands, excludes body/toe volumes, rejects
infeasible body orientations, and preserves the leg/strand/position/time ledger.
A geometric boundary regression checks the outer supported toe approaching the
capture-web edge rather than demanding that the body cross its reachable limit.

The first integrated stress benchmark found recurring deadline failures from
repeated future body calculations, rather than recording playback. Its partial
results are retained as failed development evidence, not release acceptance.
The fixes preserve exact results: bounded pose/projection caches, a root-only
support forecast, omission of stationary toes that a committed walking plan
immediately replaces, and evaluation of only audible body-source expressions.
The complete viewer collision solve remains outside the audio thread.

Equivalence checks cover 4,800 optimized full-guard comparisons, 1,200 root-only
guard comparisons, 1,920 composed root/body cases, and 960 complete frames with
matching event ledgers and snapshots. The latter include all six specimens,
dense MIDI, sprint/leap/roll, paused/resumed animation and hold/travel transitions.
The final geometry combination passes 122 focused tests and 19 collision/viewer
tests. All nine future support samples remain in use.

The audio-expression optimization matches all 27×27 source transitions at
24, 48 and 96 kHz: 2,187 cases and 4,866,075 scalar samples. All 67 sound and
companion mixes also match over 1,097,728 stereo frames with MIDI and interrupted
crossfades; stateful surfaces, oscillator state and telemetry match. Existing
audio and recording tests pass 61/61. These comparisons establish preservation,
not human approval of timbre.

## Final callback measurements

Frozen runtime: model `c5cdcd7d`, world `34e15c20`, collision `e9ea0ff1`, DSP
`36463d0c`. Node 22.23.2 on Linux ARM64 runs the actual processor at 48 kHz,
128-frame stereo callbacks and approximately 10 Hz world snapshots. Node's
`structuredClone` stands in for MessagePort submission; this does not measure a
browser's device scheduling, native clone cost or physical-phone performance.
Each of 30 cases has 1,500 warm-up and 5,000 measured callbacks.

Every case's p99 is below the 2.667 ms deadline. All twelve held/normal-walk
cases have zero overruns. The eighteen maximum-load cases have **245 tail
overruns**, or 0.272% of their 90,000 callbacks (0.163% of all 150,000 measured
callbacks). This is not a zero-dropout or worst-case real-time guarantee.

| Specimen | Normal walk p99 ms | Worst dense p99 ms | Worst dense callback ms | Dense overruns |
| --- | ---: | ---: | ---: | ---: |
| Argiope | 1.233 | 2.439 | 4.331 | 60 / 15,000 |
| Golden | 1.231 | 2.347 | 4.072 | 50 / 15,000 |
| Devil | 1.204 | 2.377 | 3.926 | 55 / 15,000 |
| Tarantula | 1.186 | 1.907 | 3.034 | 5 / 15,000 |
| Huntsman | 1.182 | 1.828 | 3.680 | 6 / 15,000 |
| Fishing | 1.163 | 2.455 | 3.688 | 69 / 15,000 |

Dense cases combine 300 BPM sprinting, maximum movement, a 24-spoke/16-ring
web, 24 held/retriggered MIDI notes, all 24 group/axis CC ramps at 46.875 Hz,
bend/pressure, eight replenished prey, silk deposition and dense recorded,
wire or textured mixes. All 150,000 callbacks are finite with no clipped
samples. No physical foot events are late or dropped by the event scheduler;
maximum sub-sample timing error is 0.4 samples. These offline event counters do
not prove absence of audible device underruns during the timing outliers.
The recording pool stays at eight voices. When every body/string row is forced
to a recorded source, bounded fragment/retrigger admission rejects excess
accents; those admission counters are distinct from lost physical foot events.

Eighteen four-second stereo audition renders cover all three recorded presets
and six skins. All are finite below full scale and contain 24–37 recording
attacks. Courtship RMS spans −26.35 to −22.43 dBFS, percussion −27.21 to
−24.60 dBFS, and underworld −19.32 to −16.02 dBFS. Exact rendered WAV hashes and
raw callback timings are preserved in the local final characterization bundle;
these renders have not received human listening approval.

Repository verification passes: 3,512 tests passed, six skipped, zero failures;
syntax, SIMD, XYFlow and clean WAX reproduction checks pass. The final browser
suites pass **35/35 on source and 35/35 on WAX**. These cover skin load failures
and replacement races, recordings/fallback, pose and sound independence, all
ordinary routines, mobile portrait/landscape scroll and touch, MIDI, speaking
face motion, prey/silk and worklet continuity during rendering stalls. The four
shared responsive/accessibility/control/contract audits also pass. Final desktop
and phone screenshots were inspected; this remains browser emulation rather
than physical-device or human-listening acceptance.

---

# Spider Synth — version 3 QA record

Date: 2026-09-12. This record covers the coupled locomotion, construction and
pluck-voice corrections. The version 2 record is retained below as historical
evidence. Results are automated measurement and visual inspection of captured
browser frames. No human listening approval, physical-phone test or DAW capture
is claimed.

## Motion, interaction and geometry

The integrated focused suite passes **138 tests, zero failures**. Coverage now
includes tempo-proportional body travel, exact foot-event identity, inner and
outer reach of the actual scanned leg links, all 17 constructions during fast
turns, edge recovery, Home at an eccentric hub, stationary routines after
travel, and heading-relative silk deposition. A supported recovery step moves
the body inward when a boundary blocks the requested turn; it does not teleport
or unpin the feet.

Actual browser top/bottom/side captures at 300 BPM retained at least four
supports. Maximum observed planted-toe error was 0.000009986 web units. A
separate final edge-recovery capture moved 0.939 web units in 1.3 seconds after a
perpendicular joystick command, changed heading by 2.816 radians, retained four
supports and kept maximum planted-toe error below 0.00000904. Both Play buttons
remained off during manual steering. Captures showed no obvious hovering or
mesh clipping in these poses; this does not establish general mesh collision
safety for every possible manual pose.

Four shared browser audits pass, including strict accessibility (no serious or
critical violations). Portrait 390×844 and landscape 844×390 retain reachable
new controls, no horizontal overflow and a 48-pixel main Audio target. Sound
presets, Random sound and MIDI Program Change have explicit independence
coverage. Real-worklet tests compare planned leg/strand/position/timestamp with
emitted attacks and compare body travel at 60 and 300 BPM. A deliberate 450 ms
main-thread stall exercises audio independence from rendering.

## Pluck characterization

Seventy-two isolated renders compare 24 sound patches with three deterministic
excitation seeds on the same 0.28-unit strand. Measured dominant spectral peaks
span approximately **47–1,008 Hz**, spectral centroids **148–3,434 Hz**, and
half-peak onset **0–310 ms**. These are rendered waveform measurements, not
inferences from knob values. The measurement isolates string voices; it is not
a loudness-normalized sample collection or human timbral acceptance.

A fixed pool of 24 strings retains authored attack/hold/release contours.
Extreme repeated physical contacts can replace old physical tails with a
4 ms fade and an incoming attack capped at 6 ms, so long attacks do not remain
inaudible through repeated resets. Ordinary isolated notes retain their full
contours, and MIDI/intentional ownership is protected. Duplicate MIDI pose
settling/neutral-return pulls are suppressed; pointer and CC-only pulls remain
available. The 51 audio tests cover these boundaries and source responses.

The actual initial app travel configuration was rendered separately at 48 kHz:
Audio on, first Animation Play, Sound Play off, Orb walk at 108 BPM / Movement
65%, figure-eight travel at speed 1 / range .52, Argiope seed 1 and the initial
Orb silk mix. Three four-second excitation seeds measured **−21.44 to −20.90
dBFS RMS** and **−6.01 to −5.83 dBFS sample peak**. Each produced 28 contacts,
72 physical pulls and 30 releases, with no late events, dropped attacks or
nonfinite samples. These are worklet output levels before additional shared
output/host gain, not a human loudness assessment.

A separate 264-render matrix covers 24 sound presets and 40 motion companions
with three seeds. Those are three-second fixed-topology, stationary stepping
fixtures for comparing timbres, not full traveling loops. All outputs are
finite with no late/queue/string-attack drops. Maximum-gain stress reached
−9.79 dBFS RMS / −3.88 dBFS sample peak; fourfold reconstruction of that capture
peaked at 0.770 (approximately −2.27 dBFS). Audio-off probes released the voice
pool and approached numerical silence without new attacks.

## Release verification

`npm run verify` passes **3,461 tests, six skipped, zero failures**, plus
syntax, SIMD, XYFlow and generated-WAX consistency checks. All 26 browser cases
pass on source and WAX. After the final force-ownership/deadline refinement,
the six affected timing, MIDI, dragging and rendering-stall cases were rerun
successfully on both surfaces. The deployment build and Storybook artifact
check pass. Local checks used Node 22.23.2; canonical AWS CI verifies Node 24.
Publication additionally requires confirmation of the remote commit,
automatic deployment and public runtime bytes. The original 5,488,852-byte scan is
unchanged. Additional scanned-specimen candidates are research downloads only;
none adds a runtime download to this release.

## Final audio timing and callback budget

The worklet uses a baseline 200 Hz world refresh plus explicit planning/event
deadlines. Refreshing the next stride separately from the next audible attack
prevents a 4.8 ms lift-off from falling between 5 ms control samples. Force
records distinguish direct control pulls from planned stance pulls, so MIDI
pose settling cannot suppress genuine walking forces or duplicate key attacks.
A continuous 24-note/all-axis CC fixture retained 264 actual touchdowns as
264 contacts, plus 268 stance pulls and 268 releases, without late/dropped
records. Maximum measured onset error was 8.34 microseconds at 48 kHz.

The final quiet benchmark includes 10 Hz snapshot serialization, 48 kHz stereo
and 128-frame callbacks. Each regime measures 5,000 blocks after warmup; the
callback budget is 2.667 ms. These are development-machine measurements,
not a physical-phone guarantee.

| Regime | Mean ms | p99 ms | Maximum ms | Over budget |
| --- | ---: | ---: | ---: | ---: |
| Held sound | 0.526 | 0.629 | 0.756 | 0 / 5,000 |
| Moving dense web | 0.657 | 1.320 | 2.232 | 0 / 5,000 |
| All string materials | 0.652 | 1.301 | 1.498 | 0 / 5,000 |
| 24 notes, continuous CC and world activity | 0.814 | 1.468 | 2.053 | 0 / 5,000 |

The dense fixtures include up to 1,118 web segments and 24 active string voices.
The continuous-CC benchmark retains 1,732 contacts and 1,732 planned pulls with
zero late events, queue drops or string-attack drops. DSP SHA-256 begins
`b473bbc8be86ed004`; world begins `c31fbf713daae8a5`; model begins `c07b4232`;
web geometry begins `6e511820`; string engine begins `fed0c670`.

---

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

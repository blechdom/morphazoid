# Spider Synth request audit

This audit distinguishes implemented features from biological or asset limits.
The version 3 corrections are verified and published separately in the
[QA record](spider-synth-qa.md). It covers the Spider Synth prompts, including
the requested Roach-style performance controls.

| Request | Implementation and remaining limits |
| --- | --- |
| Detailed real spider scan, rigged legs and face | The CC0 **Argiope bruennichi** specimen has 38 authored weighted joints, eight articulated legs, abdomen, palps and mouth regions. It is a real scan. **A. aurantia** informs research; it is not the scanned species. Small mouth regions are approximations; head and thorax are fused. |
| Roach-style views and direct instrument control | Side/top/bottom/face, explicit zoom, XYZ body manipulation, joint markers, held/random/reset poses, independent Sound and Animation players, compact body-source mixer, spoken words and speaking face movement. |
| Leg contacts play the web | A shared foot/contact model maps exact strand, contact position, angle and force into sound. Version 3 couples body translation and heading to reachable foot steps and schedules contact/pull/release events on the audio clock. This is a supported kinematic approximation, not a hydraulic-muscle or full elastic-web simulation. |
| Visible vibrating silk | Localized strand waves follow audio events. Endpoints and planted toes pin the wave. Display motion is slowed for visibility. |
| Many researched web constructions and knobs | Seventeen constructions, including twelve natural motifs and five explicitly artistic networks. Version 3 adds unequal anchors, eccentric hubs, continuous capture spirals, free zones, local spacing, partial traverses, retreat sectors, sheets, tubes and spatial tangles. Construction choice, geometry knobs and Random web are separate from sound presets. |
| Crawl around the web, fast and slow | Joystick, focused arrow keys, MIDI travel and seven route choices. Motion patches recall travel settings; tempo remains global. Version 3 makes tempo accelerate both the body and steps, with separate stalk, ripple and sprint behaviors. |
| Jump, leap, push-ups, rollover, dance, turn, Macarena | Forty authored routines plus bounded random motion. Airborne/tethered acrobatics are intentional fantasy, distinct from supported walking. The spider does not fly. |
| Richer sound, silk slides, portamento, rhythm and many pluck colors | Twenty-four sound sources and twenty-four sound presets plus animation companion mixes. Body gestures shape source parameters. String register, spread and attack/hold/release give presets different pitch ranges and contours. New foot attacks come from motion/contact events; held Sound Play has its own resonances. |
| Sound presets must not alter animation | Version 3 removes sound-preset web replacement. Sound selection, Program Change and Random sound preserve web, pose, travel settings and both player states. Animation selection may recall its companion sound, as requested earlier. |
| Research actual spider sounds and recordings | The research ledger includes substrate vibrations, courtship percussion and friction mechanisms, with species distinctions. These inform procedural sound models. No verified redistributable animal recording has been bundled; the sampled speech atlas is for the fictional voice. |
| Lay new silk while performing | Lay silk deposits a bounded trail behind the moving spider. It has a friction sound and can be plucked. These new threads are playable additions; the spider does not reconstruct an entire new biological orb using a complete attachment behavioral program. |
| Buzzing fly, trapped struggle, hunting and eating | **Send a fly** already launches a visible winged bug with approach buzz. It gets trapped and excites its attached strand during a finite struggle. Click it or choose **Hunt bug** to approach and eat it. Up to eight prey records are bounded. The fly is a lightweight authored model, not a scan. |
| Research leg joints and gaits | Research-informed alternating groups, ripple/wave stepping, heading policies and reach constraints. These are selectable musical movement families, not a claim that spiders have one fixed exhaustive catalogue of gaits. |
| Audio priority and mobile operation | Synthesis and event timing live in the worklet; graphics follow at 20 fps with a pixel cap. The approximately 5.49 MB model cannot gate Audio. Responsive layout, mobile touch emulation and a deliberate main-thread stall have automated coverage. Physical-phone, hardware-controller and human-listening acceptance are separate and have not been performed by this audit. |
| Additional spider scans/skins | [Five licensed candidates were downloaded and inspected](spider-synth-scan-candidates.md). No additional selectable specimen has been integrated yet. Each different scan needs its own joint calibration, skin weights, reach measurements and mobile packaging; replacing the texture alone would not preserve anatomy. |
| Solid body-part boundaries | IK enforces foot support/reach and authored pose limits. There is no complete mesh-to-mesh collision solver, so extreme manually combined body poses can intersect. |

Evidence: [research ledger](../SPIDER_SYNTH_RESEARCH.md),
[asset provenance and rig limits](../assets/spider-synth/ASSET.md),
[instrument contract](../contracts/spider-synth-v1.md),
[MIDI guide](spider-synth-midi.md), and [QA record](spider-synth-qa.md).

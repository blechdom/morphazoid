# Julie Saw: research, technique inventory, and model limits

Julie Saw is a playable reduced physical model of a seated musical-saw
performance. It is not a sample player, a full shell finite-element simulation,
or a calibrated replica of one commercial blade. Its pitch range, modal ratios,
force thresholds, and motion amounts are configurable synthesis approximations
because real saws vary substantially with length, taper, thickness, temper, and
the player's usable bend.

## Why an S-shaped blade sings

A musical saw is a curved elastic strip or plate, not a string. Scott and
Woodhouse describe its unusual vibrational behavior and show why fixed harmonic
string ratios are not a defensible general model ([Royal Society paper and
DOI](https://doi.org/10.1098/rsta.1992.0052)).

The central physical result behind this instrument is geometric localization.
Opposing curvatures in an S-shaped blade create an inflection line—the player's
“sweet spot”—around which a flexural mode is trapped. A flat or merely J-shaped
blade loses energy much faster into its boundaries. Shankar, Bryde, and
Mahadevan measured a much higher quality factor for the S geometry and showed
that curvature opens a spectral gap around the localized mode
([PNAS open-access paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC9169918/)).
Worland's interferometry review likewise shows motion concentrated near the
inflection and explains why bowing away from it is inefficient
([Proceedings on Meetings on Acoustics](https://doi.org/10.1121/2.0001461)).

Increasing bend generally raises pitch and moves the sweet spot toward the
narrow tip. Exact bend, force, and frequency curves are blade-specific: a
robotic playing study's 523–987 Hz sweep is useful response evidence, not a
universal calibration ([Hanai et al.](https://doi.org/10.25046/aj070501)).

## Bow and release behavior

A rosined bow drives the edge through nonlinear stick–slip. Bow force, speed,
direction, angle, and contact point form an optimum region rather than separate
volume knobs. Too little energy can fail to start the mode; excessive pressure
at low speed can choke it; a contact miss loses the pure localized mode and
reveals scrape and broader plate motion.

During bow contact, upper modes and friction noise remain present. After the bow
lifts, those components decay faster while the strongly localized principal
mode rings on. A banded-waveguide/modal musical-saw synthesis and a bow-speed /
bow-force controller demonstrate the usefulness of these coupled controls
([Essl et al.](https://bpb-us-w2.wpmucdn.com/sites.uwm.edu/dist/0/236/files/2016/09/CMJ04-appl-2eqgcup.pdf),
[Serafin and Young](https://www.nime.org/proceedings/2004/nime2004_108.pdf)).

## Playing posture and motion

The recurring performance posture in the sources is seated on a stable chair,
with the handle held between the knees or thighs, blade upright, tip held by the
non-bowing hand, and bow in the other arm. The flex hand and arm establish the
main arch while thumb/fingers or a tip handle form the reverse tip curl. The bow
arm supplies travel; wrist rotation keeps the hair presented to the smooth edge.

Tighter curvature raises the note and moves its sweet spot. Because arch and tip
curl can trade against one another, different shapes can reach approximately the
same pitch with different localization and tone. Julie therefore keeps **Arch /
pitch** and **Tip curl** separate rather than hiding both behind a note knob.

The stage has two independent pointer owners:

- Drag the pink flex hand freely in two dimensions: sideways changes arch while
  down/up changes tip curl, and the drawn hand follows both axes directly.
- Drag the amber bow horizontally for signed speed/direction and vertically for
  contact position. Pen/touch pressure also changes force.
- Two touches can operate both arms simultaneously.
- **Track sweet spot** lets the contact follow the changing bend; turning it off
  exposes misses, sweeps, higher-mode positions, and rasp.

## Evidence-graded technique inventory

Grades used here: **A** peer-reviewed acoustics/robotics; **B** scholarly study
or established specialist; **C** historical/practitioner instruction; **P** a
playable extension rather than a documented acoustic law.

| Technique | Physical gesture and audible result | Grade | Julie Saw mapping |
| --- | --- | --- | --- |
| Sustained bow | Match speed and pressure near the moving inflection | A | Hold Bow or drag amber bow |
| Up/down bow | Either direction; presentation to the edge changes slightly | B/C | Signed horizontal drag |
| Ring and lift | Catch the mode, remove bow, let its purer tail ring | B/C | Ring + lift technique / Lyric ring |
| Light re-bow | Intermittent strokes replenish a fading tone | B/C | Light re-bow rhythm |
| Continuous bow | Sustains controllable level but retains more friction color | A/B | Continuous bow technique |
| Short détaché | Separate alternating strokes make regular articulation | B/C | Détaché technique and rhythm |
| Pressure accent | Momentary extra pressure accents a beat; excess chokes | B/C | Pulse accent rhythm |
| Bow bounce ×1–4 | Rebound-like repeated contacts inside each direction | C | Bounce ×2, ×3, and ×4 rhythms |
| Bow tremolo | Rapid alternating short strokes repeatedly recharge a mode | B/C | Bow tremolo |
| Contact sweep | Follow or hunt for the moving spot; diagonal travel adds rasp | B/C | Sweet-spot sweep / manual drag |
| Glissando | Change curvature while the mode continues ringing | A/B | Flex-hand drag / Siren arc |
| Separated leap | Damp old vibration, reposition, then excite again | B | Choke, move Flex, re-bow |
| Wrist flick | A small flex-hand impulse initiates or rearticulates pitch | B | Fast tip drag; creative approximation |
| Hand vibrato | Oscillate tip curl with fingers, wrist, or forearm | B/C | Hand vibrato |
| Heel/knee vibrato | Pulse the supporting knee from a raised heel | B/C | Knee vibrato |
| Delayed vibrato | Start clean, then introduce the oscillating bend | C | Vibrato delay |
| Higher localized mode | Bow below/away from the primary spot to favor upper motion | B | Higher mode; tracking off |
| Mode pair / double stop | Carefully balance a primary mode and partial; unstable and blade-dependent | B | Mode Pair Mirage approximation |
| Choke | Stop motion under pressure or leave the resonant region | C | Choke button / Pressure choke |
| Soft mallet | Padded quick-rebound strike gives rounded attack and long ring | A/B | Soft button / Felt Mallets |
| Hard mallet | Harder strike produces brighter, shorter plate color | B | Hard button / Bright Beater |
| Two-mallet alternation | Alternate faces/regions rapidly; sometimes strike together | B | Double mallet rhythm |
| Edge pluck | Thumb or plectrum makes a short compound tone | B/C | Pluck button / Edge Snap |
| Thimble taps | Finger-mounted metal contacts drum the blade | C | Tap button; bounded four-hit gesture |
| Teeth scrape | Run a hard object along the tooth edge for washboard color | C | Teeth button; synthetic safe gesture |
| Open-blade gong | Free or suspend the handle and strike the blade | B | Documented, not explicitly modeled |
| Blade snap / thwap | Flex and release a free blade for a short transient | B | Documented, not explicitly modeled |
| Siren / wowa | Large repeated bend sweeps make characteristic vocal slides | B | Siren Seat / Wowa Bloom |
| Storm / wind | Irregular low-pressure bowing, contact misses, and pitch sweeps | B | Storm Window |
| Two-saw combination tones | Two separate sounding saws create interactions | B | Not modeled; Julie is monophonic |

The performer/tutorial sources used for the posture and technique inventory are
Morgan Cowing's detailed bow exercises
([General Technical Information](https://www.yumpu.com/en/document/view/3898550/general-technical-information-on-playing-the-musical-saw)),
Stuckenbruck's scholarly history and technique study
([The Singing Blade](https://www.violin-saw.com/files/the-singing-blade_-the-history-acoustics-and-techniques-of-the.pdf)),
Natalia Paruz's composer guidance
([manual](https://sawlady.com/manual-for-composers/)), the
[MusicalSaw.com tutorial](https://musicalsaw.com/index.php/tutorial/),
[Feldmann maker instructions](https://www.fine-tools.com/blog/instructions-for-the-use-and-application-of-feldmanns-singing-saw),
and the historical
[René Bogart method](https://foresthistory.org/wp-content/uploads/2018/12/HowToPlayTheMusicalSaw.pdf).

The sources disagree in productive ways. Some schools lift the bow after a
clean catch; others maintain contact. Some emphasize slow, mostly one-direction
song phrasing; Cowing documents accents and one-to-four bow pulses. Some teach
continuous slow vibrato; others add it only after a clear onset. These become
selectable behaviors instead of one claimed “correct” performance.

## Rhythms and movements in the instrument

The audio-thread phrase clock includes sourced or source-adjacent patterns:

- lyrical sustained strokes with silence for ring-down;
- slow three-feel / Boston sway;
- intermittent recharge strokes;
- alternating détaché eighths;
- four-pulse pressure accents;
- two, three, and four contacts per bow direction;
- rapid alternating bow tremolo;
- alternating soft/hard mallets;
- broad siren arcs;
- irregular storm contact and choke motion.

Tempo synchronization and deterministic looping are implementation aids. They
do not claim that one canonical musical-saw repertoire uses a step sequencer.

## Range and blade variation

There is no universal musical-saw range. Cowing describes roughly two to two and
a half octaves as common, with examples outside that span. Paruz gives D♯4–G7
for her performance context and identifies G4–G6 as the strongest, most
controllable center. Stuckenbruck records individual blades ranging from about
two octaves to four, including a long saw around D3–D7. Julie's five blade
presets therefore have different nominal ranges and increasingly fragile
extremes; their names are synthesis characters, not manufacturer measurements.

## Morphazoid implementation

Morphazoid already contained an unreachable **Bowed Things** family in
`src/physical-sounds.js`: bars, glass, bowls, and cymbal passed through a
velocity-weakening friction proxy into a modal bank. Julie adds a dedicated
`musical-saw` bank to that family, then specializes it with:

1. continuously smoothed bend-to-frequency motion without clearing modal state;
2. separate arch and tip-curl geometry;
3. a bend-dependent moving sweet spot;
4. the same contact mode shape in the feedback-velocity read and force injection;
5. coupled pressure/speed stability, stationary-pressure choke, rosined attack
   bite, sustained hair grain, and contact-miss noise;
6. one long localized principal mode plus short-lived, non-integer upper modes;
7. a fast bow-lift disengagement that stops excitation while leaving those
   modal states free to ring, with explicit choke as the contrasting damped end;
8. geometry-linked vibrato that moves pitch and the sweet spot together;
9. distinct soft mallet, hard mallet, edge-pluck, thimble, scrape, and choke exciters;
10. an AudioWorklet-owned rhythm clock and telemetry-driven animation;
11. output soft clipping plus a gentle browser compressor.

The modal bank is naturally SIMD-friendly: modal frequencies, decays, complex
states, gains, contact weights, and stereo weights can be packed into four- or
eight-lane vectors. This first Julie page uses the repository's portable scalar
AudioWorklet recurrence so every supported browser receives the same instrument.
A later WebAssembly SIMD kernel can use a two-pass junction per sample: reduce
contact velocity, evaluate one scalar bow law, then update modal lanes with that
force. The audible model does not claim SIMD acceleration until that kernel is
actually connected.

## Model boundaries

- Modal ratios are plausible synthesis seeds, not measured modes of one blade.
- A full curved-shell solution would move modes and shapes more intricately than
  Julie's bounded curvature warp.
- The friction law captures velocity weakening and contact feedback but does not
  model every bow hair, rosin temperature, torsional mode, or blade edge angle.
- The long note and fast upper-mode losses reproduce the reported qualitative
  behavior; their exact T60 values are artistic defaults.
- “Higher mode” and “Mode pair” are intentionally unstable approximations. No
  universal partial selector exists across real saws.
- Steel/body and stereo controls are radiating-body presentation, not a measured
  room or performer transfer function.
- The sound-reactive rainbow hyper-prism chair is a surreal stage image, not
  researched saw-playing posture or physical-safety guidance.
- Julie is monophonic; two-saw combination tones are outside this model.

## Physical safety

The browser instrument is harmless, but real blades are not. Purpose-built
toothless/unset saws or protected teeth are preferable; a stable upright chair,
minimum necessary bend, a tip handle, breaks from sustained thumb force, and
moderate bow pressure reduce injury and bow-hair wear. Do not infer safe physical
forces from Julie's normalized controls.

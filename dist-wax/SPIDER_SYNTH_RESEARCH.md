# Spider Synth: specimen, silk and sound

Spider Synth is an articulated orb-weaver instrument built around a real scan.
The spider’s supported leg contacts and the visible web graph are shared with
its audio engine. It is a musical interpretation of a web, not a prediction of
what this individual animal sounds like.

This version uses [*Argiope aurantia*](https://en.wikipedia.org/wiki/Argiope_aurantia)
as the research starting point requested by the musician. The existing scan
remains *A. bruennichi*, a related species. Its surface has not been relabeled
as an *A. aurantia* scan. The initial construction is an orb with an adjustable
central zigzag, and broader spider constructions and performance dances are
offered as separate musical possibilities.

## Evidence ledger

| Evidence | Implementation | Boundary |
| --- | --- | --- |
| [Argiope bruennichi scan by Yuichi Kano / ffish.asia](https://sketchfab.com/3d-models/cc0-orb-weaver-spider-a-bruennichi-bb646be39dad44948a403366b0ebc977), CC0 | Preserve the scanned surface and color texture; remove the scan’s calibration cube; author a flexible skin rig | The source was static. Joint pivots, weights and motion are authored, not motion capture or a supplied biological rig |
| [Prey localization in spider orb webs using modal vibration analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC9646800/) | Web segments form a connected graph; a foot divides its contacted segment into shorter sounding lengths | A bounded set of musical strings approximates selected local responses. This is not a complete web eigenmode solver |
| [The Speed of Sound in Silk](https://pmc.ncbi.nlm.nih.gov/articles/PMC4140601/) | Tension changes transverse-wave pitch; active plucking and contact transients excite the web | Material hydration, viscoelastic history, silk types and longitudinal waves are not simulated |
| [Tuning the instrument: sonic properties in the spider’s web](https://pmc.ncbi.nlm.nih.gov/articles/PMC5046944/) | Adjustable damping, decay and neighbor coupling let the web range from dry ticks to ringing strings | Controls are musical macros, not calibrated measurements of this specimen’s silk |
| [Control vs. Constraint: vibration transmission during material-bound information transfer](https://www.frontiersin.org/journals/ecology-and-evolution/articles/10.3389/fevo.2020.587846/full) | Legs maintain strand contact; movement and plucking produce distinct events | Rhythms, dances and expressive faces are creative animation routines, not a catalog of documented species behaviors |
| [Horton, 1980: stabilimenta of orb-weaving spiders](https://groups.csail.mit.edu/mac/projects/psyche/87/87-013.html) | The Argiope construction adds connected zigzag strands above and below the hub | This is an authored geometric approximation; the zigzag's ecological function is not reduced to a single settled explanation |
| [Blackledge & Wenzel, 1999: stabilimenta and defense/foraging tradeoffs](https://doi.org/10.1093/beheco/10.4.372) | Keep the distinctive structure visible and playable | A. aurantia experiments do not establish that all decorations always attract prey |
| [Web architecture and prey specialization](https://pmc.ncbi.nlm.nih.gov/articles/PMC6053566/) | Orb, sheet and tangle families motivate different connected layouts | The funnel, bowl, dome, ladder and missing-sector shapes are simplified family references, not webs attributed to A. aurantia |
| [Secondary frames in orb webs](https://www.nature.com/articles/srep31265) | Frame and radial connections remain structural parts of the graph | The graph is not a full silk-construction or structural-failure simulation |
| [External power amplification in Hyptiotes](https://pmc.ncbi.nlm.nih.gov/articles/PMC6575565/) | A triangular construction joins the bank of web instruments | The triangle-weaver's powered capture mechanism is not claimed as Argiope behavior or physically simulated |
| [Spider joint kinematics on different substrates](https://pmc.ncbi.nlm.nih.gov/articles/PMC6935789/) | Alternating tetrapods, varied duty factors and wave/ripple timing shape crawling | The study concerns Grammostola; there is no fixed universal count of natural spider gaits |
| [Gait adaptation after leg loss and regrowth](https://pmc.ncbi.nlm.nih.gov/articles/PMC12211592/) | Eight-leg phase coordination is treated as variable rather than a single immutable walk | Missing-leg/regrowth behavior is not implemented |

## Specimen and articulation

The source depicts *Argiope bruennichi*, an orb-weaving spider, with eight legs,
a striped abdomen and cephalothorax. The head and thorax are fused: the UI names
that row **Head / thorax**. It does not invent a cockroach neck, antennae or
wings. The model preserves 106,200 animal triangles and a 4096-pixel color atlas.
The download is compressed for mobile while retaining that geometry.

Morphazoid adds 38 skin controls: cephalothorax, abdomen, two pedipalps, two
cheliceral regions, and four controls along each of eight legs. Small face
pivots approximate boundaries in a connected scanned surface; they are not a
claim that every tiny fang or mouth articulation was separately reconstructed.
Spinneret timbre follows abdominal movement; the mixer does not imply a
separately resolved spinneret mesh. Speech adds temporary face and palp motion
without changing the held pose or starting the animation transport.

See [the source license](assets/spider-synth/SOURCE.LICENSE.txt) and
[provenance record](assets/spider-synth/source-provenance.json) for the exact
source, derivative and processing information.

## The shared contact model

The web is parameterized in XZ, with Y providing depth for the bowl, dome,
funnel and other surfaces. Radial strands and polygonal capture rings share
graph junctions. A separate continuous-spiral construction connects successive
turns; the plain orb retains its original ring approximation. Every stance foot projects onto an actual
segment and records the segment ID and fractional position. Locomotion keeps
at least four support contacts while other legs transfer to new anchors.
Explicit jumps, leaps and somersaults instead mark their airborne/tethered
phases and landing contacts. Macarena, disco, pushups and rollover are authored
performance gestures. They are not documented A. aurantia locomotor routines.
The renderer solves the scan’s leg rig toward the same contact targets that
the audio engine samples. The graphical frame rate does not generate the beat.

A string’s ideal transverse fundamental is proportional to

`frequency ∝ sqrt(tension / linear density) / (2 × length)`.

The audio engine uses a fixed density/tuning scale and voices the shorter
of the two lengths either side of a contacted point. It does not simulate
two independently vibrating substrings at each contact. Shorter subdivisions ring higher. The displayed tension
control follows the square-root relationship; damping and decay alter the
feedback loop. Contact speed changes excitation strength and brightness, while
crossing angle changes the attack. Pitch and amplitude are bounded into a
useful audible range. This scaling is deliberate sonification, not a claim that
a person could hear these notes from an unaided natural web.

A pooled Karplus–Strong engine recirculates a short excitation through a lossy
fractional delay. Neighbor coupling is bounded; it does not create a separate
permanent oscillator for every strand. Radial and spiral rows have separate
source and level assignments. Body groups add FM percussion, clicks, clacks,
hollow resonances, low drones and other synthetic timbres. Motion sounds occur
as finite gestures and contacts; a stationary limb does not loop friction.

**Send a fly** adds a fictional flying insect that settles on a real strand,
then excites it through struggle events. **Hunt bug** sends the spider to that
insect and ends the struggle with an eating gesture. Capture and consumption
are compressed into seconds for performance. The spider itself has no flight
animation. **Lay silk** deposits a bounded trail of new playable thread while
traveling, with movement-gated friction and attachment sounds. It approximates
silk following the spinneret region rather than biochemical silk production.

Visible plucks use localized traveling transverse packets with a decaying
envelope. Segment endpoints and exact planted toe locations pin the wave.
The display is intentionally slower and larger than microscopic silk motion,
so a musician can connect the contact point with what they hear. Graph Delay's
visible signal traces and L-system mic's active edges supplied the interaction
reference. Quadruped's distinction between gait phase, duty factor and body
motion informed the expanded spider routines; mammalian trot/gallop labels are
not transplanted as biological spider classifications.

## Voice and recordings

The speaking voice reuses Morphazoid’s locally bundled KAL16 diphone atlas and
CMU pronunciation resources, with the existing licenses preserved. Sound
presets color that voice together with the body and silk. Spoken words, FM
bells, drones and cartoon percussion are creative sounds. No field recording
is presented as a spider vocalization, and the instrument does not download
Roach Synth’s animal-movement recordings.

## Timing and controls

Audio begins only after explicit Audio, MIDI enable or a valid WAX host arm.
Sound Play holds the selected resonances. Animation Play advances the spider’s
contact rhythm. Either can run independently; MIDI notes temporarily pose and
sound the selected parts without changing either Play state. Pause freezes the
procedural pose and stops future automatic routine contacts; joystick travel,
prey actions and their contacts remain independent. Existing string tails
are allowed to decay. Manual plucks, gestures and speech remain available
while Audio is armed.

AudioWorklet owns the contact clock and string pool. The visual renderer follows
that clock at a limited frame rate and pixel budget. When 3D is still loading,
the web sound controls and voice remain usable. Mobile keeps the specimen
visible while controls scroll underneath a reachable main Audio button.

[Performance and MIDI guide](docs/spider-synth-midi.md) ·
[Implementation contract](contracts/spider-synth-v1.md)

## Sound research and mechanism decisions

This is a playable sonification, not a measured vocal reconstruction. Argiope aurantia is the requested biological starting point; the specimen asset is identified separately as Argiope bruennichi. No spider field recording was imported. The KAL16 diphone words remain a deliberately fictional robot voice.

| Primary evidence | Supported observation | Instrument mapping and limitation |
| --- | --- | --- |
| D. K. Hoffmaster (1982), [Responses of the spider Argiope aurantia to low frequency phasic and continuous vibrations](https://doi.org/10.1016/S0003-3472(82)80246-7) | Laboratory females responded differently to transverse web vibration depending on rate, amplitude and location. Catching-spiral stimuli between 0 and14Hz affected attack responses. | Pluck location, actual strand length, tension, amplitude and finite prey pulse patterns affect the sound. Audible carrier frequencies and rhythm scaling are authored; the study is a behavioral vibration experiment, not an airborne spider voice recording. |
| Wignall & Herberstein (2013), [The Influence of Vibratory Courtship on Female Mating Behaviour in Orb-Web Spiders](https://doi.org/10.1371/journal.pone.0053057) | Argiope keyserlingi males perform shudders, abdominal wags and mating-thread plucks/bounces. | Movement-triggered percussive rolls, web plucks and abdominal modulation. This is a different Argiope species; no exact species-wide courtship rhythm is claimed. |
| Mortimer et al. (2016), [Tuning the instrument: sonic properties in the spider's web](https://doi.org/10.1098/rsif.2016.0341), [institutional paper record](https://e-archivo.uc3m.es/entities/publication/04104fa7-91d6-4ec1-90cc-45ba0ecb5389) | Experiments and modeling connect web architecture, tension and silk stiffness with transverse and longitudinal wave transmission. | Pooled fractional-delay strings use visible segment/subsegment length; tension changes pitch, damping changes loss, and bounded adjacent coupling changes decay texture. The audible frequency scale and material presets are musical design choices, not silk material measurements. |
| Elias et al. (2006), [Seismic signal production in a wolf spider: parallel versus serial multi-component signals](https://doi.org/10.1242/jeb.02104), [author-hosted paper](https://nature.berkeley.edu/eliaslab/Publications/EliasEtAl2006d.pdf) | In Schizocosa stridulans, palp stridulation, abdominal tremulation and foreleg percussion form serial and parallel courtship components, measured with vibrometry and high-speed video. | Palp stridulation, tremulation and finite courtship-roll colors are explicitly wolf-spider analogies. They are not claimed anatomy or recorded behavior of Argiope. The Courtship knob changes substructure inside an externally triggered decay envelope. |
| Jaffe & Smith (1983), [Extensions of the Karplus–Strong Plucked-String Algorithm](https://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf) | Filtered delay loops support useful string synthesis extensions. | The existing Karplus core adds bounded dispersion and smoothly changing delay length. The bowed/slipping branch is an authored velocity-weakening friction model. Neither is a recording. |

The perpetual Sound Play bed is an intentionally musical extension: slowly changing modal amplitudes, mild pitch drift and a bounded bowed delay loop. Event-only sources still receive no excitation at a held pose. Silk extrusion is driven by measured world travel while Lay Silk is enabled; prey approach, struggle and eating are owned by bounded shared-world prey records.

Four short damped feedback paths provide Space; they are part of the same worklet, not extra Web Audio nodes. Existing output reconstruction guard and20-frame output delay are retained. Audio control/world sampling is200Hz and does not depend on the renderer.

## Recording search and provenance decision

The [Elias laboratory multimedia archive](https://nature.berkeley.edu/eliaslab/Multimedia.html) exposes real research sonifications/recordings for other spider species. No explicit redistribution license was located for those individual audio files, so none was copied. Open-access article licensing does not automatically license unrelated archive audio. The [Steatoda grossa study](https://doi.org/10.1371/journal.pone.0228988) also cautions against assuming stridulation merely from an apparent apparatus: the tested North American males did not stridulate during courtship. Its behavioral videos are not substitutes for an identified Argiope sound recording.

All new animal/world sounds here are deterministic procedural mechanisms. No claim of ultrasonic recording, authentic Argiope speech, human listening approval, phone-hardware validation or DAW routing validation is made.

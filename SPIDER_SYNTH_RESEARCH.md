# Spider Synth: specimen, silk and sound

Spider Synth is an articulated orb-weaver instrument built around a real scan.
The spider’s supported leg contacts and the visible web graph are shared with
its audio engine. It is a musical interpretation of a web, not a prediction of
what this individual animal sounds like.

## Evidence ledger

| Evidence | Implementation | Boundary |
| --- | --- | --- |
| [Argiope bruennichi scan by Yuichi Kano / ffish.asia](https://sketchfab.com/3d-models/cc0-orb-weaver-spider-a-bruennichi-bb646be39dad44948a403366b0ebc977), CC0 | Preserve the scanned surface and color texture; remove the scan’s calibration cube; author a flexible skin rig | The source was static. Joint pivots, weights and motion are authored, not motion capture or a supplied biological rig |
| [Prey localization in spider orb webs using modal vibration analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC9646800/) | Web segments form a connected graph; a foot divides its contacted segment into shorter sounding lengths | A bounded set of musical strings approximates selected local responses. This is not a complete web eigenmode solver |
| [The Speed of Sound in Silk](https://pmc.ncbi.nlm.nih.gov/articles/PMC4140601/) | Tension changes transverse-wave pitch; active plucking and contact transients excite the web | Material hydration, viscoelastic history, silk types and longitudinal waves are not simulated |
| [Tuning the instrument: sonic properties in the spider’s web](https://pmc.ncbi.nlm.nih.gov/articles/PMC5046944/) | Adjustable damping, decay and neighbor coupling let the web range from dry ticks to ringing strings | Controls are musical macros, not calibrated measurements of this specimen’s silk |
| [Control vs. Constraint: vibration transmission during material-bound information transfer](https://www.frontiersin.org/journals/ecology-and-evolution/articles/10.3389/fevo.2020.587846/full) | Legs maintain strand contact; movement and plucking produce distinct events | The 24 rhythms, dances and expressive faces are creative animation routines, not a catalog of documented species behaviors |

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

The web lies in the XZ plane, with Y pointing away from it. Radial strands and concentric polygonal capture-ring approximations share
graph junctions. The mixer calls those rings Spiral silk; the graph does not
pretend they form one continuous construction spiral. Every stance foot projects onto an actual
segment and records the segment ID and fractional position. Locomotion keeps
at least four support contacts while other legs transfer to new anchors.
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

**Catch a bug** adds a small fictional trapped insect at a real strand position
and a short burst of fluttering plucks. It does not start an endless recording.
The spider itself has no flight animation.

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
procedural pose and stops future automatic contacts; existing string tails
are allowed to decay. Manual plucks, gestures and speech remain available
while Audio is armed.

AudioWorklet owns the contact clock and string pool. The visual renderer follows
that clock at a limited frame rate and pixel budget. When 3D is still loading,
the web sound controls and voice remain usable. Mobile keeps the specimen
visible while controls scroll underneath a reachable main Audio button.

[Performance and MIDI guide](docs/spider-synth-midi.md) ·
[Implementation contract](contracts/spider-synth-v1.md)

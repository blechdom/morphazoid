# Spider Synth: specimen, silk and sound

Spider Synth is an articulated instrument with six independently rigged real
spider scans. The spider’s supported leg contacts and the visible web graph are
shared with its audio engine. It is a musical interpretation of a web, not a
prediction of what a selected individual animal sounds like. Version 4 adds
selectable specimens, licensed peacock-spider vibration recordings and
measured collision constraints; final integrated validation is recorded
separately in the [QA record](docs/spider-synth-qa.md).

This version uses [*Argiope aurantia*](https://en.wikipedia.org/wiki/Argiope_aurantia)
as the research starting point requested by the musician. The original and
default scan remains *A. bruennichi*, a related species. Its surface has not
been relabeled as an *A. aurantia* scan. The initial construction is an orb with
an adjustable central zigzag, and broader spider constructions and performance dances are
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

The default source depicts *Argiope bruennichi*, an orb-weaving spider, with
eight legs, a striped abdomen and cephalothorax. The head and thorax are fused:
the UI names that row **Head / thorax**. It does not invent a cockroach neck,
antennae or wings. The original model preserves 106,200 animal triangles and a
4096-pixel color atlas. The additional choices are a giant golden orb-weaver
(*Nephila pilipes*), devil spider (*Araneus ventricosus*), King Baboon tarantula
(*Pelinobius muticus*), huntsman (*Heteropoda venatoria*) and a provisionally
identified fishing spider (*Dolomedes cf. sulfureus*). Each retains its own
scanned surface, proportions and texture.

The five new downloads measure 4.98–6.59 MB each, with all animal triangles
retained and their 4K color atlases re-encoded to WebP. Only the selected GLB is
fetched; these sizes are not added together at startup. Changing **Spider skin**
preserves Sound and Animation state, the held pose, sound, web and phase. A load
failure keeps the existing specimen and performance. Audio initializes
independently of model loading.

Morphazoid adds 38 skin controls to each scan: cephalothorax, abdomen, two
pedipalps, two cheliceral regions, and four controls along each of eight legs.
Every specimen has independently measured leg chains and reach geometry. Four
broad control links group smaller anatomical segments; this is not a claim
that spider legs have only four joints. Small face pivots approximate boundaries in a connected scanned surface; they are not a
claim that every tiny fang or mouth articulation was separately reconstructed.
Spinneret timbre follows abdominal movement; the mixer does not imply a
separately resolved spinneret mesh. Speech adds temporary face and palp motion
without changing the held pose or starting the animation transport.

See [the source license](assets/spider-synth/SOURCE.LICENSE.txt) and
[provenance record](assets/spider-synth/source-provenance.json) for the exact
source, derivative and processing information. The
[additional specimen asset record](assets/spider-synth/skins/ASSET.md) contains
per-skin credits, delivery sizes, rigging methods and source-quality limits.

## The shared contact model

The web is parameterized in XZ, with Y providing depth for the bowl, dome,
funnel and other surfaces. Natural orb constructions use unequal external
anchors, an eccentric hub, a dry free zone, and a continuous inward capture
spiral. The oval capture area is separate from the polygonal support frame;
local spacing and additional lower traverses vary its mesh. Every radius/spiral
attachment shares a graph junction. A crossing without a shared node is not an
attachment. Every stance foot selects an actual segment and records its ID
and fractional position. Locomotion keeps
at least four support contacts while other legs transfer to new anchors.
Explicit jumps, leaps and somersaults instead mark their airborne/tethered
phases and landing contacts. Macarena, disco, pushups and rollover are authored
performance gestures. They are not documented A. aurantia locomotor routines.
The renderer solves the scan’s leg rig toward the same contact targets that
the audio engine samples. The graphical frame rate does not generate the beat.

Per-specimen body ellipsoids and leg capsules provide solid-boundary
approximations. Pose constraints prevent new or deeper overlap at attachments,
and supported feet use exact web contact targets and clearance checks. These
constraints apply to the composed pose, including manual and MIDI movement.
They do not solve collisions between every triangle or hair of the scan.
Original attachment overlap and curled preserved limbs can remain visible.
The collision regression covers all six specimens and forty routines; the
[QA record](docs/spider-synth-qa.md) states the tested tolerances and limits.

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
bells, drones and cartoon percussion are creative sounds. Three additional
sources use actual *Maratus volans* courtship substrate vibrations measured
with laser vibrometry: **Peacock rumble**, **Peacock crunch** and **Peacock
grind**. These are three excerpts from one research video's recorded
articulations, not airborne calls or recordings of any selectable specimen.

Girard, Kasumovic and Elias (2011) published the source in
[Video S1](https://doi.org/10.1371/journal.pone.0025390.s001) of their
[peacock-spider courtship study](https://doi.org/10.1371/journal.pone.0025390).
The exact [Figshare dataset](https://doi.org/10.6084/m9.figshare.132960) specifies
CC BY 4.0. The bundled mono WAVs total 261,646 bytes and load asynchronously
after Audio is armed. They cannot delay the worklet or existing speech atlas.
The [recording credits](assets/audio/spider-synth/README.md) and
[manifest](assets/audio/spider-synth/manifest.json) retain author attribution,
license, species, exact source intervals, extraction changes and file hashes.

The 27 source choices and 27 sound presets include **Peacock courtship**,
**Peacock percussion** and **Peacock underworld**, alongside 40 motion companion
mixes. Recordings play faded fragments only when accepted movement, contact or
MIDI gestures excite them. Eight shared voices, two tails per body row and a
minimum retrigger interval bound their cost. No recording runs as a permanent
background loop; pitch and playback changes are artistic transformations of
the measured signal. Selecting a recorded preset changes neither specimen nor
animation, and unavailable samples leave procedural synthesis playable.

## Timing and controls

Audio begins only after explicit Audio, MIDI enable or a valid WAX host arm.
Sound Play holds the selected resonances. Animation Play advances the spider’s
contact rhythm. Either can run independently; MIDI notes temporarily pose and
sound the selected parts without changing either Play state. Selecting a body
pose preserves playback, animation time and current offsets; the live fix is
commit `b9606cd`. Changing specimen likewise does not reset the performance.
Pause freezes the procedural pose and stops future automatic routine contacts; joystick travel,
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

This is a playable sonification, not a measured vocal reconstruction. Argiope
aurantia is the requested biological starting point; the default scan is
identified separately as Argiope bruennichi. The real Maratus recordings are
laboratory substrate vibrations, distinct from the procedural silk models and
the deliberately fictional KAL16 robot voice.

| Primary evidence | Supported observation | Instrument mapping and limitation |
| --- | --- | --- |
| D. K. Hoffmaster (1982), [Responses of the spider Argiope aurantia to low frequency phasic and continuous vibrations](https://doi.org/10.1016/S0003-3472(82)80246-7) | Laboratory females responded differently to transverse web vibration depending on rate, amplitude and location. Catching-spiral stimuli between 0 and14Hz affected attack responses. | Pluck location, actual strand length, tension, amplitude and finite prey pulse patterns affect the sound. Audible carrier frequencies and rhythm scaling are authored; the study is a behavioral vibration experiment, not an airborne spider voice recording. |
| Wignall & Herberstein (2013), [The Influence of Vibratory Courtship on Female Mating Behaviour in Orb-Web Spiders](https://doi.org/10.1371/journal.pone.0053057) | Argiope keyserlingi males perform shudders, abdominal wags and mating-thread plucks/bounces. | Movement-triggered percussive rolls, web plucks and abdominal modulation. This is a different Argiope species; no exact species-wide courtship rhythm is claimed. |
| Mortimer et al. (2016), [Tuning the instrument: sonic properties in the spider's web](https://doi.org/10.1098/rsif.2016.0341), [institutional paper record](https://e-archivo.uc3m.es/entities/publication/04104fa7-91d6-4ec1-90cc-45ba0ecb5389) | Experiments and modeling connect web architecture, tension and silk stiffness with transverse and longitudinal wave transmission. | Pooled fractional-delay strings use visible segment/subsegment length; tension changes pitch, damping changes loss, and bounded adjacent coupling changes decay texture. The audible frequency scale and material presets are musical design choices, not silk material measurements. |
| Elias et al. (2006), [Seismic signal production in a wolf spider: parallel versus serial multi-component signals](https://doi.org/10.1242/jeb.02104), [author-hosted paper](https://nature.berkeley.edu/eliaslab/Publications/EliasEtAl2006d.pdf) | In Schizocosa stridulans, palp stridulation, abdominal tremulation and foreleg percussion form serial and parallel courtship components, measured with vibrometry and high-speed video. | Palp stridulation, tremulation and finite courtship-roll colors are explicitly wolf-spider analogies. They are not claimed anatomy or recorded behavior of Argiope. The Courtship knob changes substructure inside an externally triggered decay envelope. |
| Girard, Kasumovic & Elias (2011), [Multi-Modal Courtship in the Peacock Spider, Maratus volans](https://doi.org/10.1371/journal.pone.0025390), [licensed supplementary recording](https://doi.org/10.6084/m9.figshare.132960) | Laser vibrometry records rumble-rump, crunch-roll and grind-rev courtship articulations transmitted through an experimental substrate. | Three attributed CC BY 4.0 excerpts add finite recorded accents to body movement and contacts. These are measured Maratus signals, not Argiope or tarantula calls; processing and runtime pitch changes are documented. |
| Jaffe & Smith (1983), [Extensions of the Karplus–Strong Plucked-String Algorithm](https://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf) | Filtered delay loops support useful string synthesis extensions. | The existing Karplus core adds bounded dispersion and smoothly changing delay length. The bowed/slipping branch is an authored velocity-weakening friction model. Neither is a recording. |

The perpetual Sound Play bed is an intentionally musical extension: slowly changing modal amplitudes, mild pitch drift and a bounded bowed delay loop. Event-only sources still receive no excitation at a held pose. Silk extrusion is driven by measured world travel while Lay Silk is enabled; prey approach, struggle and eating are owned by bounded shared-world prey records.

Four short damped feedback paths provide Space; they are part of the same worklet, not extra Web Audio nodes. Existing output reconstruction guard and20-frame output delay are retained. Audio control/world sampling has a 200 Hz baseline with extra refreshes at planned stride/event deadlines and does not depend on the renderer.

## Recording search and provenance decisions

Version 4 bundles the three identified Maratus excerpts above. The exact
supplementary-file metadata, downloaded source checksum and visible behavior
labels were checked before extraction. The publisher's downloadable video is
the source; the study's authors and CC BY 4.0 terms remain attached to every
redistributed derivative. No tarantula hiss or Argiope recording was verified
and added.

The [Elias laboratory multimedia archive](https://nature.berkeley.edu/eliaslab/Multimedia.html) exposes real research sonifications/recordings for other spider species. No explicit redistribution license was located for those individual audio files, so none was copied. Open-access article licensing does not automatically license unrelated archive audio. The [Steatoda grossa study](https://doi.org/10.1371/journal.pone.0228988) also cautions against assuming stridulation merely from an apparent apparatus: the tested North American males did not stridulate during courtship. Its behavioral videos are not substitutes for an identified Argiope sound recording.

The other body/world sources remain procedural mechanisms. The licensed
Maratus excerpts do not establish ultrasonic capture or authentic Argiope
speech. Automated tests and render inspection are distinct from human
listening, physical-phone or hardware-MIDI/DAW validation; no acceptance in
those environments is claimed here.


## Construction rules added in version 3

Twelve natural approximations and five explicitly artistic networks retain the
existing preset IDs. External anchors and mesh spacing join the existing
construction controls. Natural sheets use irregular shared junctions instead
of a rectangular grid; the funnel has a sheet, an off-center mouth and a
connected retreat tube. Tangles use a spatial scaffold with descending
gumfoot motifs.

| Reference / strength | Documented mechanism | Implemented mapping | Deliberate limit |
| --- | --- | --- | --- |
| Reed, Witt & Scarboro (1969), *The Orb Web during the Life of Argiope aurantia*, primary longitudinal laboratory observations. [Original paper](https://www.drpeterwitt.com/wp-content/uploads/1969-The-Orb-Web-during-the-Life-of.pdf) | Dry radii support a viscid spiral; hub/free zone and external scaffold are distinguishable. Webs are slightly oval with the hub toward the upper portion; stabilimenta vary. | Unequal external anchors and a split polygonal frame; offset hub; unequal radial angles and lengths; dry hub platform separated from capture thread; vertical zigzag overlay for Argiope. | Geometric scale and spacing are authored. No single function of the decoration is claimed. The graph is presented in the instrument's XZ plane rather than asserting the animal builds a horizontal orb. |
| Eberhard (2014), *A new view of orb webs: multiple trap designs in a single structure*, primary comparative measurements. [Smithsonian repository](https://repository.si.edu/items/8c025cc0-8acb-4fa6-893f-f7982b42278e) | Radial and capture-mesh spacing vary systematically from the hub toward the perimeter; webs contain locally different trapping regions. | Capture density uses a monotonic radial spacing exponent plus bounded local interval variation. The oval capture boundary is distinct from the polygonal attachment scaffold. | The knob values are normalized design controls, not measured millimeters or species-specific behavioral parameters. |
| Zschokke, *Spiral and web asymmetry in the orb webs of Araneus diadematus*, primary web-geometry study. [University repository](https://edoc.unibas.ch/entities/publication/94b4380b-28f6-4b8e-97c2-4a64bc111e7b) | An eccentric spiral and additional lower capture threads can enlarge the lower catching region. | Argiope/eccentric settings move the hub separately from the capture oval and add connected partial capture traverses below it. | This documented orb motif is borrowed as a bounded construction rule; it is not asserted to be the exact sequence used by the scanned individual. |
| Mortimer et al. (2015), *Unpicking the signal thread of the sector web spider Zygiella x-notata*, primary mechanical and behavioral study. [Open paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC4707845/) | A capture-free sector contains a signal thread linking the hub and a peripheral retreat. | `missing-sector` omits capture crossings in an angular sector and adds one actual signal edge to a connected retreat. | Signal silk has explicit metadata; this does not by itself validate the instrument's vibration propagation. |
| Harmer & Herberstein (2010), *Functional diversity of ladder-webs: moth specialization or optimal area use?*, primary observational and experimental study. [Journal PDF](https://www.americanarachnology.org/journal-joa/joa-all-articles/article/download/arac-38-01-119.pdf/?no_cache=1) | Ladder webs are elongated orb modifications; aerial and trunk-associated ladders have different ecological contexts. | A lower hub, long diverging support radii and many short capture traverses create an elongated fan with a separate rear scaffold. | This is a ladder-orb approximation, not the former rectangular grid and not a species-specific capture-efficiency model. |
| Eberhard & Hazzi (2017), *Web building and prey wrapping behavior of Aglaoctenus castaneus*, primary construction observations. [Journal PDF](https://www.americanarachnology.org/journal-joa/joa-all-volumes/detail/article/download/arac-45-2-177.pdf/?no_cache=1) | Funnel webs comprise a dense sheet of largely non-adhesive lines, an edge-connected tubular retreat, and sometimes an upper tangle. | An irregular connected sheet leads into an off-center depressed mouth and tubular retreat, with distinct upper interception/support threads. | The local sheet is triangulated for explicit shared junctions and predictable walking support. Delaunay triangulation is an engineering approximation, not a claim about spider motor behavior. |
| 2006 linyphiid architecture presentation, observational conference abstract. [American Arachnology 74](https://www.americanarachnology.org/fileadmin/documents/am_arachnol_newsletter/AmerArachnol74.pdf) | Sheet platforms vary in concavity or convexity and have additional irregular structures above or below. | Bowl and dome use different signed support surfaces plus interception/suspension strands. | Evidence here is a primary abstract, weaker than a full methods paper; presets are labeled family approximations. |
| Eberhard et al. (2008), *Vestiges of an orb-weaving ancestor?*, primary ontogenetic web/construction observations. [Author repository](https://kerwa.ucr.ac.cr/items/32181177-dbab-408a-bc64-e5e87974dca0) | Gumfoot-bearing cobwebs use supporting threads and descending adhesive-ended lines, with substantial architectural diversity. | The tangle is a nonpolar 3D scaffold with local branches, cross-braces and descending gumfoot lines. | The model is a selected set of structural motifs; it does not represent every theridiid web. |
| Han et al. (2019), *External power amplification drives prey capture in a spider web*, primary high-speed/mechanical study; Blackledge et al. (2006), silk mechanics with web descriptions. [PNAS record](https://pubmed.ncbi.nlm.nih.gov/31085643/), [JEB paper](https://journals.biologists.com/jeb/article/209/16/3131/16224/Unraveling-the-mechanical-properties-of-composite) | A Hyptiotes triangle has a reduced fan of capture sectors and a separately tensioned anchor line. | Default triangle has four primary rays, transverse capture strands and a rear tension line. | Higher branch settings are an artistic extension. The geometry does not claim to reproduce the animal's power amplification or launch acceleration. |


Geometry construction runs on the main thread. Audio receives a validated
prepared graph, retaining separate spatial lookup scratch storage. Tension,
sound presets and voice changes do not rebuild the graph. Graph generation,
projection and snapshots remain bounded; this is a musical construction model
rather than a simulation of silk secretion, breakage or prey-capture efficiency.

## Locomotion and contact corrections in version 3

[Corver et al. (2021)](https://doi.org/10.1016/j.cub.2021.09.030) identify
different movement patterns across web-building stages. Leg sweeps and turns
are part of how the animal samples and works on its surroundings. This supports
distinct exploratory, stepping and attachment gestures; it does not supply an
exhaustive fixed list of musical gaits.

[Mulder, Mortimer and Vollrath (2020)](https://doi.org/10.1242/jeb.234070)
document orientation, radial tugging and movement toward prey in
*Araneus diadematus*, including altered behavior in distorted webs. The
instrument uses separate contact, load/pull and release events, forward-facing
pursuit and explicit backward/sideways exceptions. Its timing and force values
are authored musical controls, not fitted measurements from that study.
[Prey reeling in Verrucosa arenata](https://journals.biologists.com/jeb/article/222/24/jeb213751/223595/Reeling-in-the-prey-fishing-behaviour-in-an-orb)
provides another distinct mechanism; it should not be generalized into every
spider's walking pattern.

Body travel previously followed an independent time path while legs changed
tempo. The replacement plans reachable steps in the shared beat phase. Stance
feet remain at their attached web points while their pull advances the body;
swinging feet choose reachable strands for the next support. Tempo changes the
cadence and travel together. Stride length responds to Speed and Movement.
Candidate poses respect both maximum extension and the minimum folding radius
of the actual unequal scanned leg links. Default walking uses staggered ripple
steps; sprinting can exchange larger leg groups. Turning is subject to the same
support limits, rather than rotating through planted feet.

The audio worklet schedules the planner's exact event times, leg indices,
strand IDs and fractional positions. A later graphics frame cannot introduce
a new attack or quantize the event to a display frame. Control changes discard
obsolete forecasts; long clock jumps skip stale attacks. These are engineering
guarantees of the musical mechanism, not a claim of biological force accuracy.

## Pluck identity and additional specimens

Pitch register and spread remap the same physical string lengths into distinct
musical ranges. Preset-specific attack, hold and release span crisp clicks,
rounded plucks, metallic shimmer and slow silk blooms; damping still determines
loss in the resonant loop. Faster movement can excite overlapping events while
the fixed voice pool limits resource use. Under extreme physical-event load,
old physical tails may be replaced so new steps remain audible. MIDI-owned
strings keep separate ownership.

[Five additional real scans](docs/spider-synth-scan-candidates.md) now have
independent rigs, measured reach geometry and selectable mobile GLBs. Together
with the original Argiope there are six specimens. The giant golden orb-weaver
and devil spider have particularly distinct surface patterns; the museum
tarantula has a bulkier silhouette but softer fine hair and facial detail.
The tarantula, huntsman and fishing spider perform in an artistic web scene;
this does not make them natural Argiope-style orb-web builders. No verified
black-widow body scan was added. The
[request audit](docs/spider-synth-request-audit.md) distinguishes these completed
implementations from full mesh collision, biological reconstruction and final
integrated performance validation.

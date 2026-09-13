# Spider Synth contract v1

The primary object is a rigged scan in a connected web. A supported foot’s
segment ID, fractional position and contact serial identify its audible pluck
and visible string response. The worklet and renderer evaluate the same pure
pose/contact model; rendering never owns automatic audio onsets.

| Action/state | Sound | Motion |
| --- | --- | --- |
| Fresh navigation | No AudioContext or permission request | Neutral held pose |
| Audio arm | Prepare one worklet and shared stereo output | Preserve both Play states |
| Sound Play | Held resonances at assigned levels | Preserve animation state |
| Sound preset / Program Change / Random sound | Replace body, silk and voice timbres | Preserve web, contacts, prey, deposited silk, pose, tempo and both player states |
| Body pose / Random pose / Reset pose | Change joint modulation without releasing active sound | Replace pose offsets; preserve routine, phase, travel and both player states. First Animation Play retains the chosen pose. |
| Spider skin | Preserve sound, recording voices and both player states; no model download on the audio thread | Load one selected scan and its measured rig transactionally. Preserve pose offsets, routine, phase, location and web. Failed or superseded loads retain the previous playable specimen. |
| Recorded spider source | Finite movement/contact/MIDI-triggered excerpts; no unattended loop | Use the same accepted joint and contact movement as procedural sources |
| Animation Play / Space | Contact plucks if armed | Advance the selected routine |
| Pause animation | Stop new automatic contacts; let tails decay | Freeze procedural time |
| Drag joint / pluck strand | Finite gesture if armed | Change selected pose/contact, independently of Play |
| Hold/release MIDI note | Owned note and release envelope | Temporary static pose overlay; never change Play |
| Joystick / optional MIDI travel | Movement contacts while traveling | Steer independently; release stops manual travel |
| Lay silk | Movement-gated silk friction and attachment plucks | Deposit bounded playable threads along the route |
| Send fly / Hunt bug | Approach buzz, trapped-strand pulses, finite eating gesture | Fly arrives; spider travels to the selected prey |
| Voice | Finite phrase; no browser speech API | Temporary cephalothorax/palp/fang gesture |
| Audio off | Fade/suspend output | Preserve visible performance settings |
| Hide/teardown/panic | Release owned resources and notes appropriately | No stale held notes or stuck pointer ownership |

Eight feet are ordered L1–L4, R1–R4. Web coordinates are XZ, +Y outward and +Z
forward. Stance feet lie on a real segment; the default locomotion keeps at
least four supports. Explicit jump, leap and rollover routines have marked
airborne/tethered phases and landing contacts. There is no flying spider. No independent anatomical neck
is claimed. Articulation of small face regions is explicitly approximate.

Construction presets include an Argiope-inspired zigzag orb, other spider web
families and explicitly artistic networks. Geometry is bounded to 1,200 nodes
and 2,400 segments, with at most 256 deposited threads and eight prey records.
Graph replacement clears topology-dependent prey/silk while preserving the
camera and both player states. Existing notes retain their own string length
and release independently of the replaced graph. The string renderer is a bounded
voice pool, not one permanent oscillator per segment. Length and square-root
tension control pitch; speed/angle shape excitation. Coupling and caught-bug
flutter have fixed event limits. All source mixes must remain finite and
bounded, with idle motion sources silent and held resonance paths separate.

Four camera presets, explicit zoom, body axes, 3D touch and joint markers sit
above the sound player. Mobile scroll remains available; the sticky specimen
and main Audio must not trap or hide controls. Model loading cannot block audio.

Six separately calibrated scans share the 38-joint control layout. Each retains
its measured link lengths, reach limits, body height and collision proxies.
Only the selected mesh downloads. Recorded animal material loads after explicit
Audio arm without blocking the procedural engine; failures leave it playable.
The three credited recordings are Maratus volans substrate courtship vibrations,
not calls attributed to the selected scan. Original MIDI Program Change sound
addresses 0–63 remain stable; recorded presets occupy 64–66.

Body and face edits are constrained using measured main-body volumes and
rig-derived palp/fang volumes; leg collision correction preserves planted foot
identities. Anatomical
attachment overlaps in the source rig are baselines, not permission to deepen
an overlap. Collision handling uses ellipsoids and capsules, not exact
triangle-to-triangle physics or a full biological locomotion simulation.

Acceptance includes pure model support/identity/bounds tests, independent
transport/MIDI/voice tests, DSP pitch/level/tail characterization and a browser
main-thread-stall probe. Source and WAX must share the same release graph.
A real-device touch or listening pass is recorded separately from automation.

## Shared world clock

The worklet advances the world at a baseline 200 Hz, refreshes at planned
stride/event boundaries, and schedules predicted contact, pull
and release events at their individual audio sample times. A bounded ledger
retains each event's leg, exact strand and fractional contact position. Tempo
scales the shared gait phase and body progress; speed and Movement scale stride
length. Supported feet remain planted while the body advances within the
scanned legs' reachable ranges. Forward, backward and sideways routines have
different heading policies. The renderer follows
at 20 fps and renders decaying strand waves localized around each pluck.
Endpoints and actual planted contact points pin the visible wave; they do not
silence the entire contacted strand. The visualization is slowed for legibility.

Animation phase and absolute world time are separate. Pausing Animation freezes
the selected routine but permits joystick travel, prey actions and silk laying.
Lazy Audio enable transfers the latest silent-world snapshot only after loading
has completed. Suspending an already armed AudioContext freezes its clock;
resuming it never advances through missed wall time. Audio off transfers visible
world state back to the performance clock. MIDI sustain may hold a body pose but
cannot latch steering after a physical note release. Panic and lost input
ownership release steering without pressing either player.

Construction happens on the main thread. The worklet accepts validated prepared
graphs; it never runs the construction triangulator in an audio callback.
String register and pitch spread preserve the length ordering while widening
preset pitch choices. Attack, hold and release shape excitation independently
from physical string damping. Long tails have a bounded voice budget, and new
physical contacts may replace older physical tails without taking MIDI-owned
voices.

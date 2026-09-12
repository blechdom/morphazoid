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
| Animation Play / Space | Contact plucks if armed | Advance the selected routine |
| Pause animation | Stop new automatic contacts; let tails decay | Freeze procedural time |
| Drag joint / pluck strand | Finite gesture if armed | Change selected pose/contact, independently of Play |
| Hold/release MIDI note | Owned note and release envelope | Temporary static pose overlay; never change Play |
| Voice | Finite phrase; no browser speech API | Temporary cephalothorax/palp/fang gesture |
| Audio off | Fade/suspend output | Preserve visible performance settings |
| Hide/teardown/panic | Release owned resources and notes appropriately | No stale held notes or stuck pointer ownership |

Eight feet are ordered L1–L4, R1–R4. Web coordinates are XZ, +Y outward and +Z
forward. Stance feet lie on a real segment; the default locomotion keeps at
least four supports. There is no flying spider. No independent anatomical neck
is claimed. Articulation of small face regions is explicitly approximate.

The graph is bounded to 24 spokes ×16 rings. The string renderer is a bounded
voice pool, not one permanent oscillator per segment. Length and square-root
tension control pitch; speed/angle shape excitation. Coupling and caught-bug
flutter have fixed event limits. All source mixes must remain finite and
bounded, with idle motion sources silent and held resonance paths separate.

Four camera presets, explicit zoom, body axes, 3D touch and joint markers sit
above the sound player. Mobile scroll remains available; the sticky specimen
and main Audio must not trap or hide controls. Model loading cannot block audio.

Acceptance includes pure model support/identity/bounds tests, independent
transport/MIDI/voice tests, DSP pitch/level/tail characterization and a browser
main-thread-stall probe. Source and WAX must share the same release graph.
A real-device touch or listening pass is recorded separately from automation.

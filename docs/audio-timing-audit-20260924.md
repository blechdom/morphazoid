# Animation-frame dependencies in audio — 2026-09-24

> Follow-up: Automatapoeia now starts paused and revises its queue at the next
> unheard row on live edits. See [explicit transport](automatapoeia-live-transport.md).
> The audit/evidence below records the preceding snapshot; its Automatapoeia
> buffered-edit description and shared-controller line numbers are historical.
> No other instrument timing implementation was changed.

## Scope and confidence

Read-only timing audit requested after the Automatapoeia repair. Baseline:
`41c7239e0f5025f22cfe3699c9e02a04adc86b71` plus the local Automatapoeia
note-release/audio-clock changes. GitHub fetch succeeded and `origin/main`
matched that baseline on recheck. No other instrument implementation was changed;
this report is not a deployment certificate.

Searched 556 authored JavaScript files in `src/` and `morphazoidical/`:
136 contain an animation-frame reference; the heuristic found 125 probable
loop-containing files. Those counts are **search candidates, not bugs or
instruments**. Checked the 206 root HTML pages/root JS bootstrap files (no extra
inline RAF clocks found), frame aliases/wrappers, and entry/import paths for all
168 registry records. Catalogue labels and Faves/WIP membership come from
`src/site/instrument-registry.js`, not directory names. Generated WAX copies,
third-party bundles, native plugins, and server code are not separate findings.

The tables are **statically confirmed frame-to-audio dependencies**, not claims
of reproduced audible glitches in every listed instrument. Trace the linked
function as well as its caller; merely finding RAF, `currentTime`, or a
worklet is not enough. File line numbers refer to this working snapshot.

- **Event / gate:** frames decide when to discover/start/release notes, gestures
  or loop boundaries. Stalls can delay, skip, bunch, or stretch those changes.
- **Refill:** events already carry audio-clock timestamps, but RAF must refill
  the queue. Previously queued audio survives only within its scheduling horizon.
- **Modulation:** ongoing sound is rendered independently, but its moving pitch,
  timbre, gain, spatial or effect control is frame-updated. This is not necessarily
  a broken metronome, but a musical contour can freeze/jump when graphics stop.
- A worklet may synthesize every sample accurately while receiving late commands
  from RAF. Conversely, a RAF playhead can be entirely visual.

## Automatapoeia: repaired locally, not counted below

Row evolution and both synthesis paths now use explicit audio-clock start times
from an independent timer with 350 ms lookahead; graphics consume delayed score
presentations. Preset recall releases the previous score's voice ownership.
Swing and Time spread retain their intentional musical behavior; at zero Time
spread, row notes share the original renderer's midpoint onset sample.

Tests covered halted RAF for 1.5 seconds and a 240 ms main-thread stall at 12
rows/second: 83.333 ms intervals within half a sample, with timely native buffer
submissions. Source/WAX clock and preset-lifecycle browser tests passed 27/27
across three repeats. This is bounded main-thread lookahead, **not immunity to
arbitrarily long freezes**; a stall beyond available headroom can still lose
rows. Ordinary live edits may wait roughly 350 ms for buffered rows to clear.
See [audio-clock design](automatapoeia-audio-clock.md) and
[preset lifecycle](automatapoeia-preset-lifecycle.md).

## 1. Faves first

| Instrument / public route | Mechanism | Evidence and consequence |
| --- | --- | --- |
| [Jaw Harp](../jaw-harp.html) | Event | Repeat/pluck clock uses the RAF timestamp, then sets `nextRepeatAt = time + interval`; `pluck()` posts `strike-tine` without a future audio timestamp. Breath-linked vowel-sequence boundaries also post configuration here. This can drift/skip with slow frames; the worklet reed synthesis itself is not frame-driven.<br>[tick L2499](../src/instruments/jaw-harp/jaw-harp-app.js#L2499); [pluck L639](../src/instruments/jaw-harp/jaw-harp-app.js#L639); [updateBreathVowelSequence L359](../src/instruments/jaw-harp/jaw-harp-app.js#L359) |
| [Graph Synth](../graph-synth.html) | Refill | Audio-clock pulse and run-event queues have 90 ms lookahead, but only RAF refills them. A gap beyond that window can starve attacks. Geometry motion is frame-driven too.<br>[frame L1263](../src/families/graph/graph-instrument-app.js#L1263); [scheduleRunAudio L954](../src/families/graph/graph-instrument-app.js#L954); [updateClock L1021](../src/families/graph/graph-instrument-app.js#L1021) |
| [Lattice](../lattice.html) | Event + modulation | Scan motion, contact entry detection, percussion strikes, and continuous voice updates all come from `frame()`. Delta is capped at 100 ms. Contact transients can be skipped or delayed and the musical scan can slow.<br>[frame L1685](../src/instruments/lattice/lattice-app.js#L1685); [emitIntersectionStrikes L1568](../src/instruments/lattice/lattice-app.js#L1568) |
| [Hybrinx](../hybrinx.html) | Gesture/gate + modulation | Gesture phase, loop/gap boundaries, tongue timeline and parameter modulators are evaluated in RAF; configurations are posted at a >=26 ms interval. Worklet synthesis continues, but syllable/gate changes depend on frames.<br>[updatePerformance L3047](../src/families/syrinx/syrinx-app.js#L3047); [animate L3175](../src/families/syrinx/syrinx-app.js#L3175) |
| [Shapes](../shapes.html) | Modulation / manual events only | Continuous voice trajectories and manual corner/trigger crossings are updated in RAF. **Automatic Corners & Notes / Triggers already have an independent interval-based audio-clock scheduler**; do not describe that sequencer as RAF-driven.<br>[frame L952](../src/instruments/shapes/shapes-app.js#L952); [updateAudio L868](../src/instruments/shapes/shapes-app.js#L868); [syncDiscreteScheduler L854](../src/instruments/shapes/shapes-app.js#L854) |
| [L-System](../l-system.html) | Modulation | The traversal phase and current/future voices are computed in RAF. A 65 ms voice trajectory smooths updates, but does not independently advance/refill traversal.<br>[frame L680](../src/instruments/l-system/l-system-app.js#L680) |
| [Graph Delay](../graph-delay.html) | Modulation | Automatic microphone/node motion is advanced in RAF and maps to live delay times, feedback gains, routing and pans. Existing delay audio continues without frames; motion-driven effect changes do not.<br>[frame L1550](../src/instruments/graph-delay/graph-delay-app.js#L1550); [applyAudioParameters L638](../src/instruments/graph-delay/graph-delay-app.js#L638) |

## 2. Other non-WIP instruments

| Instrument / public route | Mechanism | Evidence and consequence |
| --- | --- | --- |
| [Graph Drum Machine](../graph-drum-machine.html), [Graphs](../graphs.html) | Refill + modulation | Same 90 ms RAF-refilled graph event/pulse clock as Graph Synth. Graphs microphone mode additionally updates the delay engine from frame-derived geometry.<br>[scheduleRunAudio L954](../src/families/graph/graph-instrument-app.js#L954); [frame L1664](../src/instruments/graphs/graphs-app.js#L1664); [scheduleRunAudio L1295](../src/instruments/graphs/graphs-app.js#L1295); [updateMicAudio L456](../src/instruments/graphs/graphs-app.js#L456) |
| [Shape](../shape-synth.html), [Solid](../solid-synth.html), [Hyper](../hyper-synth.html) | Event + modulation | Automatic corner/vertex percussion is detected/emitted in each visual frame. Continuous mode sends predicted voice trajectories from those frames. Sub-frame offsets/predictions do not make the event producer independent of RAF. These individual pages differ from the newer combined Shapes automatic scheduler.<br>[frame L2465](../src/instruments/shape-synth/shape-synth-app.js#L2465); [flushCornerStrikes L2090](../src/instruments/shape-synth/shape-synth-app.js#L2090); [frame L453](../src/instruments/solid-synth/solid-synth-app.js#L453); [frame L440](../src/instruments/hyper-synth/hyper-synth-app.js#L440) |
| [Shape Drum Machine](../shape-drum-machine.html), [Solid Drum Machine](../solid-drum-machine.html), [Hyper Drum Machine](../hyper-drum-machine.html) | Event | Frame-driven playhead/rotation geometry detects contacts and calls `audio.trigger()`. Main-thread stalls change contact discovery and dispatch timing.<br>[frame L927](../src/instruments/shape-drum-machine/shape-drum-machine-app.js#L927); [triggerContacts L485](../src/instruments/shape-drum-machine/shape-drum-machine-app.js#L485); [frame L674](../src/instruments/solid-drum-machine/solid-drum-machine-app.js#L674); [triggerContacts L638](../src/instruments/solid-drum-machine/solid-drum-machine-app.js#L638); [frame L713](../src/instruments/hyper-drum-machine/hyper-drum-machine-app.js#L713); [triggerContacts L679](../src/instruments/hyper-drum-machine/hyper-drum-machine-app.js#L679) |
| [Spiral](../spiral.html) | Event + modulation | Reader/zoom traversal and contact ages advance in RAF; percussion onsets call `pool.strike`, continuous mode calls `pool.setVoices`.<br>[frame L1452](../src/instruments/spiral/spiral-app.js#L1452); [updateAudio L1419](../src/instruments/spiral/spiral-app.js#L1419) |
| [Lattice Drum Machine](../lattice-drum-machine.html), [Spiral Drum Machine](../spiral-drum-machine.html) | Event | Scan/zoom contact onsets are tested per frame and sent to the drum engine. Debounce/hit limits are not independent musical clocks.<br>[frame L1353](../src/instruments/lattice-drum-machine/lattice-drum-machine-app.js#L1353); [triggerContacts L1129](../src/instruments/lattice-drum-machine/lattice-drum-machine-app.js#L1129); [frame L1420](../src/instruments/spiral-drum-machine/spiral-drum-machine-app.js#L1420); [triggerContacts L1386](../src/instruments/spiral-drum-machine/spiral-drum-machine-app.js#L1386) |
| [L-System Drum Machine](../l-system-drum-machine.html), [L-Systems](../l-systems.html) | Event + modulation | RAF advances traversal and discovers traversal events. L-System Drum Machine sends percussion; L-Systems Notes/Triggers send note/drum events. L-Systems Continuous/Mic also refresh their mappings from RAF.<br>[frame L652](../src/instruments/l-system-drum-machine/l-system-drum-machine-app.js#L652); [triggerEvents L546](../src/instruments/l-system-drum-machine/l-system-drum-machine-app.js#L546); [frame L1238](../src/instruments/l-systems/l-systems-app.js#L1238); [triggerNoteEvents L1146](../src/instruments/l-systems/l-systems-app.js#L1146) |
| [Tesselation](../tesselation.html) | Event + modulation | RAF advances scan phase and contact ages. Drum modes call `triggerDrums`; synth modes replace current voices.<br>[frame L1384](../src/instruments/tesselation/tesselation-app.js#L1384); [triggerDrums L482](../src/instruments/tesselation/tesselation-app.js#L482) |
| [Striped Staircase](../striped-staircase.html) | Event + modulation | RAF advances depth/progress, then `draw()` calls `updatePlayheadAudio`. Drums/Ensemble detect a new time slice and strike; Fill/Edge submit 55 ms voice trajectories. Audio production is inside the drawing path.<br>[tick L517](../src/instruments/striped-staircase/striped-staircase-app.js#L517); [draw L497](../src/instruments/striped-staircase/striped-staircase-app.js#L497); [updatePlayheadAudio L221](../src/instruments/striped-staircase/striped-staircase-app.js#L221); [triggerShapeDrums L196](../src/instruments/striped-staircase/striped-staircase-app.js#L196) |
| [Sorting](../algorithmic-sequencers.html) | Event | RAF checks tempo, emits up to eight overdue `advanceTo(...audible)` steps, then resets its reference to the current frame time. Notes use current audio time, not original step deadlines: batching/drift risk.<br>[animationFrame L532](../src/families/algorithmic-sequencers/algorithmic-sequencers-app.js#L532); [advanceTo L261](../src/families/algorithmic-sequencers/algorithmic-sequencers-app.js#L261); [playStepTone L370](../src/families/algorithmic-sequencers/algorithmic-sequencers-app.js#L370) |
| [DJ Dijkstra](../dijkstra.html) | Event | RAF checks `nextEventAt`, catches up at most six score events, and plays each at `AudioContext.currentTime + .006`. The logical deadline does not reach the audio sink, so overdue events may bunch together.<br>[animationFrame L910](../src/families/algorithmic-scores/algorithmic-scores-app.js#L910); [advanceTo L314](../src/families/algorithmic-scores/algorithmic-scores-app.js#L314); [playAlgorithmEvent L508](../src/families/algorithmic-scores/algorithmic-scores-app.js#L508) |
| [Pink Trombonazoid](../pink-trombonazoid.html) | Event/gate + modulation | RAF advances the word/phoneme timeline, activates segments, releases at word end, handles loop gaps, and modulates the tube. Audio-clock synthesis underneath does not protect articulation boundaries.<br>[updateTransport L1874](../src/instruments/pink-trombonazoid/pink-trombonazoid-app.js#L1874); [activateSegment L1726](../src/instruments/pink-trombonazoid/pink-trombonazoid-app.js#L1726); [animationFrame L1930](../src/instruments/pink-trombonazoid/pink-trombonazoid-app.js#L1930) |
| [Vocalzoid](../vocalzoid.html) | Loop boundary only | The current phrase is scheduled by the audio engine, but RAF detects phrase completion and calls `playSequence()` for the next loop. A suspended frame can delay the next phrase; do not label every within-phrase note RAF-driven.<br>[animationTick L683](../src/instruments/vocalzoid/vocalzoid-app.js#L683); [playSequence L723](../src/instruments/vocalzoid/vocalzoid-app.js#L723) |
| [Syrinx](../syrinx.html), [Tongued Beasts](../tongued-beasts.html) | Gesture/gate + modulation | Same shared `animate → updatePerformance → postConfiguration` path as Hybrinx: call/loop/gap/tongue performance changes are frame-delivered, although DSP runs in worklets.<br>[updatePerformance L3047](../src/families/syrinx/syrinx-app.js#L3047); [animate L3175](../src/families/syrinx/syrinx-app.js#L3175) |
| [Julia](../julia.html) | Modulation | RAF advances contour/pitch position and supplies current/future voice trajectories. Smoothing/lookahead is frame-refilled, not an independent pitch-trajectory clock.<br>[frame L1255](../src/instruments/julia/julia-app.js#L1255) |
| [Throat Singing](../throat-singing.html) | Modulation / gesture contour | `draw()` evaluates the performance/gesture and applies audio parameters at >=25 ms intervals. The drone and audio-rate oscillators continue, but motion/focus gestures freeze or jump with frames.<br>[draw L1574](../src/instruments/throat-singing/throat-singing-app.js#L1574); [applyAudioParameters L950](../src/instruments/throat-singing/throat-singing-app.js#L950); [performanceAt L257](../src/instruments/throat-singing/throat-singing-app.js#L257) |
| [Lumber Loops](../lumber.html) | Effect-control refresh, not loop clock | While playing, RAF reapplies ring filter/pan/reverb/fuzz parameters, including projected 3D depth ordering. This couples that effect-control path to frames, not the already-running buffer-loop playback clock.<br>[frame L2039](../src/instruments/lumber/lumber-app.js#L2039); [updateRingEffects L450](../src/instruments/lumber/lumber-app.js#L450); [depthEffectIntensity L432](../src/instruments/lumber/lumber-app.js#L432) |

## 3. Work in Progress — inventory only

Not a request to implement WIP timing or presets. These are included so that
“the rest of Morphazoid” does not silently exclude their mechanisms.

| Instrument / public route | Mechanism | Evidence and consequence |
| --- | --- | --- |
| [Recursion](../recursion.html) | Refill | 120 ms audio-time lookahead windows are refilled by RAF `scheduleTransport`. It drops missed rolling windows/resynchronizes after stalls; native material may be scheduled for a whole bounded cycle, so this is not a claim that every native note waits for a frame.<br>[frame L1751](../src/instruments/recursion/recursion-app.js#L1751); [scheduleTransport L468](../src/instruments/recursion/recursion-app.js#L468) |
| [Onset Atlas](../onset-atlas.html), [Splice Ring](../splice-ring.html) | Refill / segment boundary | RAF calls `pump()`: schedule the next segment when its predecessor ends within 80 ms, using `max(now + .02, previousEnd)`. Short stalls are buffered; longer ones move the next segment late.<br>[pump L253](../src/instruments/onset-atlas/onset-atlas-app.js#L253); [tick L277](../src/instruments/onset-atlas/onset-atlas-app.js#L277); [pump L175](../src/instruments/splice-ring/splice-ring-app.js#L175); [tick L185](../src/instruments/splice-ring/splice-ring-app.js#L185) |
| [Synaptic Resonance](../synaptic-resonance.html) | Refill | RAF services the 120 ms auto-pulse/propagation queue; `scheduler()` calls `fire` with audio-time deadlines. Deadline timestamps alone do not make queue refilling independent.<br>[scheduler L146](../src/instruments/synaptic-resonance/synaptic-resonance-app.js#L146); [tick L204](../src/instruments/synaptic-resonance/synaptic-resonance-app.js#L204) |
| [Hanoi Carillon](../hanoi.html), [Alpha-Beta Minimax](../minimax.html), [N-Queens Backtracker](../nqueens.html), [Euclidean Pulse](../euclid.html) | Event | Shared Algorithmic Scores RAF/current-time event dispatch, like DJ Dijkstra.<br>[animationFrame L910](../src/families/algorithmic-scores/algorithmic-scores-app.js#L910); [playAlgorithmEvent L508](../src/families/algorithmic-scores/algorithmic-scores-app.js#L508) |
| [Mouthophones](../mouthophones.html) | Event/gate + modulation | Mouthophones auto-gesture hits/releases and breath delivery run in RAF. `nextRhythmAt = time + stepDuration`; `sendBreath` posts the latest flow to the worklet.<br>[runRhythm L803](../src/instruments/breath-atlas/breath-atlas-app.js#L803); [tick L820](../src/instruments/breath-atlas/breath-atlas-app.js#L820); [sendBreath L207](../src/instruments/breath-atlas/breath-atlas-app.js#L207) |
| [Wheel of Organs](../image-to-instrument-3.html) | Event/gate | Wheel of Organs integrates spin in RAF, calls `singCrossing` for wheel crossings, and starts the winning-mouth release at the frame-detected phase transition. Delta is capped at 50 ms.<br>[loop L1711](../src/instruments/wheel-of-organs/wheel-of-organs-app.js#L1711); [updateTime L1618](../src/instruments/wheel-of-organs/wheel-of-organs-app.js#L1618); [singCrossing L1246](../src/instruments/wheel-of-organs/wheel-of-organs-app.js#L1246) |
| [Playhead Paint](../playhead-paint.html) | Event/gate + modulation | `drawStage → syncPlaybackAudio` discovers currently occupied marks and calls `noteOn`, `noteOff`, and `updateVoice` at current audio time. Future updates only cover already-current voices, not independently scheduled future note starts.<br>[drawStage L1510](../src/instruments/playhead-paint/playhead-paint-app.js#L1510); [syncPlaybackAudio L709](../src/instruments/playhead-paint/playhead-paint-app.js#L709) |
| [Entanglement Dance](../entanglement-dance.html), [Quantum Square Dance](../quantum-square-dance.html) | Event + modulation | RAF advances beat/figure/phrase phase and dispatches beat/figure strikes or `triggerDanceEvent`. Elapsed time is capped; Quantum Square Dance detects only the current step serial.<br>[onFrame L455](../src/instruments/entanglement-dance/entanglement-dance-app.js#L455); [strikeBeat L188](../src/instruments/entanglement-dance/entanglement-dance-app.js#L188); [animationFrame L1153](../src/instruments/quantum-square-dance/quantum-square-dance-app.js#L1153) |
| [Order Tones](../order-tones.html), [Cantor Lock](../cantor-lock.html), [Escape Dust](../escape-dust.html), [Linebreaker](../linebreaker.html) | Event + modulation | Respectively: frame-accumulated sequence strikes; RAF phrase pulses; frame-accumulated simulation step sounds; probe/phrase edge grains. All also update continuous voices. Catch-up caps do not provide audio-clock isolation.<br>[frame L824](../src/instruments/order-tones/order-tones-app.js#L824); [setSequenceIndex L246](../src/instruments/order-tones/order-tones-app.js#L246); [advanceModelPhrase L488](../src/instruments/cantor-lock/cantor-lock-app.js#L488); [drawFrame L770](../src/instruments/escape-dust/escape-dust-app.js#L770); [stepOnce L418](../src/instruments/escape-dust/escape-dust-app.js#L418); [updateAudio L419](../src/instruments/linebreaker/linebreaker-app.js#L419) |
| [Mazes](../algorithmic-mazes.html), [Paths](../paths.html) | Event + modulation | Frame-driven playheads feed continuous voices plus junction/turn strike helpers.<br>[frame L1418](../src/instruments/algorithmic-mazes/algorithmic-mazes-app.js#L1418); [updateAudio L1025](../src/instruments/algorithmic-mazes/algorithmic-mazes-app.js#L1025); [frame L701](../src/instruments/paths/paths-app.js#L701); [updateAudio L364](../src/instruments/paths/paths-app.js#L364) |
| [Vector Flight](../vector-flight.html), [Plasma Ball](../plasma-ball.html), [Penrose Tilings](../penrose-tilings.html) | Event + modulation | RAF advances the simulation/contact field and emits queued crossing/static/edge strikes. Small per-hit offsets are relative to late delivery, not independent scheduling. Continuous-mode voice mappings are frame-refreshed too.<br>[animate L887](../src/instruments/vector-flight/vector-flight-app.js#L887); [flushTriggers L826](../src/instruments/vector-flight/vector-flight-app.js#L826); [frame L764](../src/instruments/plasma-ball/plasma-ball-app.js#L764); [strikeStaticEvents L218](../src/instruments/plasma-ball/plasma-ball-app.js#L218); [frame L1094](../src/instruments/penrose-tilings/penrose-tilings-app.js#L1094); [strikeContacts L755](../src/instruments/penrose-tilings/penrose-tilings-app.js#L755) |
| [Gravity Walk](../gravity-walk.html), [Ricochet](../ricochet.html), [Rigidity](../rigidity.html), [Rolling Measure](../rolling-measure.html), [Falling Forms](../falling-forms.html), [Charge Garden](../charge-garden.html), [Packing Pressure](../packing-pressure.html), [Geodesic Drift](../geodesic-drift.html), [Kinetic Hull](../kinetic-hull.html) | Event + modulation | Shared Physics controller advances its fixed-step simulation only from RAF, then drains scene events into `pool.strike` and refreshes voices. A fixed 120 Hz numerical step does not mean an independent 120 Hz audio clock; outer delta is capped at 50 ms.<br>[frame L281](../src/families/physics/physics-app.js#L281); [updateAudio L241](../src/families/physics/physics-app.js#L241) |
| [Gear Ratio Drums](../gear-ratio-drums.html), [Prime Sieve](../prime-sieve.html), [Pendulum Wave](../pendulum-wave.html), [Atomic Orbitals](../atomic-orbitals.html), [DNA Translator](../dna-translator.html), [Neural Pulse](../neural-pulse.html) | Event + modulation | Remaining Experiments event clocks: gear-tooth crossings, prime steps, pendulum sign crossings, orbital sectors, DNA bases/codons, neural pulses. All depend on shared RAF `state.time`/dt (50 ms cap) and call `audio.trigger` from their update paths. Automatapoeia is now the exception.<br>[frame L4232](../src/families/experiments/experiments-app.js#L4232); [stepGears L1209](../src/families/experiments/experiments-app.js#L1209); [updatePrimeSieve L1695](../src/families/experiments/experiments-app.js#L1695); [updatePendulums L1798](../src/families/experiments/experiments-app.js#L1798); [updateOrbital L2150](../src/families/experiments/experiments-app.js#L2150); [updateDna L2267](../src/families/experiments/experiments-app.js#L2267); [updateNeural L2420](../src/families/experiments/experiments-app.js#L2420) |
| [RISSET-MOIRE](../moire-organ.html), [Spring Choir](../spring-choir.html), [Double Pendulum](../double-pendulum.html), [Reaction-Diffusion](../reaction-diffusion.html), [Gravity Lens](../gravity-lens.html), [Feral Fairy Ferris Ferry](../orbital-ferris.html) | Modulation | Remaining Experiments motion/simulation/phase feeds `active.drone()` through `updateCommonAudio → audio.setDrone`. Sound synthesis runs natively, but changing pitches/gains/pans/delay mappings follow frame-derived state.<br>[updateCommonAudio L807](../src/families/experiments/experiments-app.js#L807); [frame L4232](../src/families/experiments/experiments-app.js#L4232); [updateOrbitalFerrisMotion L3009](../src/families/experiments/experiments-app.js#L3009) |
| [Möbius](../moebius-synth.html), [Klein Bottle](../klein-bottle-synth.html) | Modulation, slice mode only | Surface scan/rotation and 75 ms slice-voice trajectories depend on frames. **Their two-lap sequence mode has a separate interval lookahead scheduler** and returns before this slice-audio path.<br>[frame L1545](../src/families/nonorientable/nonorientable-app.js#L1545); [scheduleSequenceLookahead L874](../src/families/nonorientable/nonorientable-app.js#L874) |
| [Boidzoid](../boidzoid.html), [Annealogue](../annealogue.html), [Bell Square](../bell-square.html) | Modulation | RAF evolves flock/schedule/collision state, then updates voice frequency/gain/pan. Continued native oscillation is not independent evolution of those musical mappings.<br>[animate L245](../src/instruments/boidzoid/boidzoid-app.js#L245); [syncAudioVoices L115](../src/instruments/boidzoid/boidzoid-app.js#L115); [frame L497](../src/instruments/annealogue/annealogue-app.js#L497); [updateAudioVoices L125](../src/instruments/annealogue/annealogue-app.js#L125); [animationFrame L707](../src/instruments/bell-square/bell-square-app.js#L707); [updateAudioVoices L159](../src/instruments/bell-square/bell-square-app.js#L159) |
| [Morphynx](../morphynx.html), [Hyper-Syrinx](../hyper-syrinx.html), [Syrinx UI](../syrinx-ui.html) | Gesture/modulation | Morphynx posts the time-varying animal/human performance and morph gains in RAF; Hyper-Syrinx RAF animates oscillator detune; Syrinx UI uses the shared frame-delivered performance/modulator path.<br>[configureAudio L512](../src/instruments/morphynx/morphynx-app.js#L512); [animate L1252](../src/instruments/morphynx/morphynx-app.js#L1252); [engine.animate L755](../src/instruments/hyper-syrinx/hyper-syrinx-app.js#L755); [updatePerformance L3047](../src/families/syrinx/syrinx-app.js#L3047) |
| [Morphazoidical](../morphazoidical/) | Modulation | RAF applies mechanism motion, builds current/future frames, and submits voice trajectories. The event display itself is not a separate audible drum clock.<br>[frameLoop L1865](../morphazoidical/app.js#L1865); [updateAudio L949](../morphazoidical/app.js#L949) |
| [Gesturama](../gesturama.html) | Camera-event input | RAF drives camera analysis (throttled to >=42 ms). Motion/color zones feed performance points, gesture voices and triggers. This is input-detection latency, not an internal tempo sequencer; it still makes sound-event discovery depend on animation callbacks.<br>[analysisLoop L852](../src/instruments/gesturama/gesturama-app.js#L852); [analyzeVideo L793](../src/instruments/gesturama/gesturama-app.js#L793); [processPerformancePoint L671](../src/instruments/gesturama/gesturama-app.js#L671); [processMotionPerformance L716](../src/instruments/gesturama/gesturama-app.js#L716) |

## 4. Additional frame-delayed controls, not recurring musical clocks

These should not be silently counted as metronome defects, but are relevant to
an “audio first” follow-up:

- **Hiccup Head (Fave):** pointer/XY configuration is coalesced until the next
  frame by `queueCanvasStateUpdate(s)` / `flushPendingCanvasStateUpdate`
  ([controller L3912–3942](../src/instruments/hiccup-head/hiccup-head-app.js#L3912)).
  Its sequencer independently calls `scheduleSequence` every 18 ms.
- **Rubix / Hyper Rubix (Faves):** sequence clocks are independently scheduled,
  but puzzle-turn completion changes the sounding score on a visual frame.
  Rubix also flushes camera-dependent score snapshots in its draw callback
  ([Rubix L1139](../src/instruments/rubix/rubix-app.js#L1139),
  [L2186](../src/instruments/rubix/rubix-app.js#L2186)); Hyper Rubix commits a move,
  invalidates serial lookahead, and queues engine synchronization there
  ([L3371](../src/instruments/hyper-rubix/hyper-rubix-app.js#L3371),
  [L4098](../src/instruments/hyper-rubix/hyper-rubix-app.js#L4098)).
  This affects *when edited/turned material takes effect*, not the steady
  tick producer itself.
- **Throatazoid (non-WIP) / Alien Larynx (WIP):** dirty parameter changes are applied in
  RAF (`frame → if (audioDirty) applyAudioParameters`). Input/phoneme changes
  and the timer-requested end of a 95 ms keyboard accent can wait for a frame.
  Importantly, the continuously animated anatomy uses `animate: true` only
  for drawing; the normal audio configuration does **not** use that animation.
  Do not call the visual anatomy their DSP clock
  ([Throatazoid L816](../src/instruments/throatazoid/throatazoid-app.js#L816),
  [L1950](../src/instruments/throatazoid/throatazoid-app.js#L1950),
  [L3116](../src/instruments/throatazoid/throatazoid-app.js#L3116),
  [Alien Larynx L3206](../src/instruments/alien-larynx/alien-larynx-app.js#L3206)).
- **Monstroid:** graph and contour configuration edits use one-shot RAF batching
  ([L831](../src/instruments/monstroid/monstroid-app.js#L831),
  [L1931](../src/instruments/monstroid/monstroid-app.js#L1931)); its telemetry
  animation is not the synthesis clock.
- **SIMD Synth:** patch edits wait for `schedulePatchUpdate`'s RAF; the worklet
  sequence is independent
  ([L121](../src/instruments/simd-synth/simd-synth-app.js#L121)).
- **Micromorph (WIP):** model-control sending is RAF-batched, separately from
  PCM production
  ([L170](../src/instruments/micromorph/micromorph-app.js#L170)).
- **Chladni Plate, Lissajous Orbits, Fourier Epicycles (all WIP):** the shared
  Experiments RAF calls `setDrone` for parameter-derived voices, but these modes
  do not derive a recurring audio event clock from their moving graphics.
  This is control refresh, unlike Gear Ratio Drums, DNA, etc.
- **Retained but unrouted image-to-instrument variants:** the shared module
  still contains frame-driven choir modulation/router pulses/ratchet logic
  ([L815](../src/families/image-to-instrument/image-to-instrument-app.js#L815)).
  The only current public entry, `image-to-instrument-3.html`, returns early
  into `mountWheelOfOrgans` at L411. Do not attribute the old variant loop to
  that active page; Wheel's actual timing is listed above.

## 5. Important exclusions / independent paths checked

“Independent” below means **not waiting for RAF to produce its clock**. It does
not guarantee unlimited stall tolerance, adequate buffering, or perfect timing
on every device. Timer-based lookahead still competes for the main thread.

| Instrument / family | Why its RAF is not the recurring sound clock |
| --- | --- |
| Rubix / Hyper Rubix | Separate `schedulerTick` timers with audio-time event scheduling; specialized engine backends also own their audio clocks. Score-edit caveats are in section 4. [Rubix L2590](../src/instruments/rubix/rubix-app.js#L2590), [Hyper Rubix L3036](../src/instruments/hyper-rubix/hyper-rubix-app.js#L3036). |
| Creaturazoid / Hiccup Head | Independent lookahead scheduler; RAF consumes a visual schedule/queue. [Creaturazoid L654](../src/instruments/creaturazoid/creaturazoid-app.js#L654), [Hiccup Head L2611](../src/instruments/hiccup-head/hiccup-head-app.js#L2611). |
| Hocket Luigi | `updateTransport` appears in RAF, **but also runs inside** independent 24 ms `schedulerTick`; merely seeing that function in a frame callback is not a finding. [L464](../src/instruments/hocket-loom/hocket-loom-app.js#L464), [L1366](../src/instruments/hocket-loom/hocket-loom-app.js#L1366). |
| Jaw Jam / Quadruped / Enveloper / Surround for Safety | Independent interval-based audio scheduling. Frame clocks/readouts follow it. [Jaw Jam L855](../src/instruments/jaw-jam/jaw-jam-app.js#L855), [Quadruped L1266](../src/instruments/quadruped/quadruped-app.js#L1266), [Enveloper L1161](../src/instruments/enveloper/enveloper-app.js#L1161), [Surround L657](../src/instruments/surround-field/surround-field-app.js#L657). |
| Julie Saw / Roach Synth / Spider Synth | Rhythm/motor synthesis is in their audio processors; RAF updates stage/telemetry. [Julie Saw processor](../src/instruments/julie-saw/julie-saw-processor.js), [Roach processor](../src/instruments/roach-synth/roach-synth-processor.js), [Spider processor](../src/instruments/spider-synth/spider-synth-processor.js). |
| Shapes automatic Notes/Triggers; Möbius/Klein two-lap sequence | Independent interval lookahead paths. Their other, frame-driven modes are listed explicitly above. |
| SIMD 303 morph | `updateActiveMorph` in RAF mirrors UI state; `engine.morphTo` sends the actual morph to the audio engine. Not an RAF-driven audio morph. [L716](../src/instruments/webgpu-303/webgpu-303-app.js#L716). |
| SIMD/GPU synth scopes, resonator display, FM/PM/Weierstrass visualizations | Oscilloscope/field/sequence-lamp animation is not the DSP event producer. Do not mistake a draw callback for a scheduler; SIMD Synth patch-edit batching is separately listed. |
| Drum Roll Please! / Ouroboros variants | `advanceVisualState` is a visual mirror; audio processors maintain their own state. For example [Drum Roll processor class](../src/instruments/drum-roll-please/drum-roll-please.js#L500), [Ouroboros processor class](../src/instruments/ouroboros/ouroboros.js#L516). |
| Fabric Filter; Sandy Syrup / Candy Coil Delay; Slippery Resynthesis; Shepard–Risset | Visual fabric/phase updates are separate from running audio engines. A similar-looking simulation/phase in RAF is not sufficient evidence of audio dependence. |
| Five shared WIP prototypes | `mirror.advance` / `preview.advance` in RAF update displays; the shared audio processor advances the actual engine. [Processor](../src/families/work-in-progress/processor.js). |
| Acoustic Manifold / Strophe Lab / Nightingale Manifolds | RAF follows a scheduled playback timeline/cursor rather than scheduling the audio entries. |
| Puggler, sample/pad-instrument stage animation, shared meters/MIDI preview, canvas sizing, accessibility announcements | Pure visual/UI RAF consumers were excluded. No finding is inferred solely from their animation calls. |

## Recommended next implementation order

1. **Faves:** Jaw Harp repeat/vowel clock; Graph Synth queue refill (with its
   shared Graph Drum Machine/Graphs users); Lattice events; Hybrinx gesture/gate
   timeline. Then continuous mappings in Shapes, L-System and Graph Delay.
2. **Non-WIP:** geometric/tiling/L-System drum and note readers; Sorting and
   DJ Dijkstra; Pink Trombonazoid articulation and Vocalzoid loop handoff;
   remaining continuous/gesture control paths.
3. **WIP:** keep this as a backlog until explicitly requested.

For each actual fix, preserve intentional swing, subdivision, note offsets,
envelopes, mappings and transport boundaries. Separate score generation/audio
queues from display state, timestamp whole simultaneous groups once, skip stale
attacks rather than bunch them, and reduce visual work first. A fixed-step
simulation inside RAF, or adding `currentTime` at the final late trigger, is
not enough. Use an independent audio-time scheduler for bounded protection;
move autonomous evolution into an appropriate worker/worklet pipeline where
stronger isolation is required, with explicit sound-preservation tests.

Test each candidate with RAF withheld separately from main-thread stalls,
including stalls longer than its lookahead; compare event deadlines, same-row
onsets, skipped attacks, releases, live edits, and queued-node ownership. Repeat
on source/WAX and relevant modes/presets. The audit did **not** run that dynamic
matrix on the other instruments and makes no listening or hard-real-time claim.

## Verification and local evidence

Automatapoeia: final Node verification phase 4,214 passed / 6 skipped; syntax,
SIMD artifact and XYFlow checks passed. The `npm run verify` process was
interrupted at its final WAX check; that check was subsequently rerun and passed
(`Committed dist-wax matches a clean build`). `npm run build:site` also passed.
Final focused clock/controller/lifecycle/preservation unit rerun: 45 passed.
New timing/lifecycle browser tests: 27 passed. Existing focused browser
regressions: **24 passed, 1 failed** — the pre-existing phone-landscape
`caVoice`-must-fit-without-scrolling assertion (bottom 426.47 at height 390).
The exact unmodified baseline reproduces that layout result; it was not hidden
or changed as part of the audio repair.

Detailed logs, inventory/call-path notes, browser traces and baseline comparison
are saved locally under `test-results/audio-timing-audit-20260924/`,
`test-results/automatapoeia-audio-clock-20260923/` and
`test-results/automatapoeia-note-release-20260923/`. Those directories are ignored
and do not accompany a fresh clone. This tracked report and the source/tests
are the durable summary. Human listening, physical-device timing and real
WAX/DAW-host acceptance remain unperformed. Nothing in this batch was pushed.

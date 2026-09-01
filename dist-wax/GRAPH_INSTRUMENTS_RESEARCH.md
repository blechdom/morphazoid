# Graph Instruments Research

## Goal

Add two instruments that apply Morphazoid's existing recursive-instrument ideas to a general directed graph:

- **Graph Drum Machine**: a source hit enters the graph; node arrivals trigger mapped FM, Rattlesnake, or Karplus percussion.
- **Graph Synth**: a built-in synth excitation enters the graph; delays, turns, branches, sinks, and cycles shape the audible signal.

Both instruments should use the same generated graph and the same edge-time/gain contract. An acyclic graph has a finite first pass. A cyclic graph audibly returns to an earlier node like a bounded delay: every edge contributes time, while each designated cycle-closing edge applies one feedback decay and one tone loss per lap.

## Existing design lineage

### L-System synth

`src/l-system.js` is the reusable grammar and traversal layer. Important exports are `L_SYSTEM_PRESETS`, `expandLSystem`, `traceLSystem`, `advanceLSystemTraversal`, `iterationPlaybackAtPhase`, `allocateIterationVoiceHeads`, `branchAngleFrequency`, `branchVoiceGain`, and `normalizeLSystemPoint`.

`l-system-app.js` turns each active branch head into a continuous voice. `voiceForPlayhead` maps inherited turn, depth, progress, and position to pitch, timbre, gain, and pan; `voicesForPlayheads` preserves branch power and iteration-layer headroom. It uses `VoicePool`, `pitch01ToFrequency`, and `synthParametersForMode` from `src/audio.js` for Sine, FM, PM, and Shepard modes. The useful principle is that the visible traversal and the audio read the same structural state.

### L-System Drum Machine

`src/l-system-drums.js` supplies the discrete-event layer. `lSystemDrumEventsForTraversal` detects every newly entered segment subdivision, including samples around loop wraps and ping-pong reflections. `lSystemDrumVoiceIndex`, `groupedLSystemDrumEvents`, `mappedLSystemDrumVoice`, and `styledLSystemDrumVoice` turn depth, inherited turn, generation, phase, position, and simultaneous-head count into a bounded sixteen-voice drum result.

`l-system-drums-app.js` uses `FmDrumAudio` from `src/fm-drums.js`. In particular, `FmDrumAudio.trigger(voice, { startAt, startDelaySeconds })` supports absolute AudioContext scheduling. The implemented Graph adapter preserves that FM bank and also routes explicitly selected physical palettes through `LinearDrumAudio`, whose absolute-time trigger supports both the full Rattlesnake model and canonical Karplus synthesis. The instrument also establishes useful limits: 240 hits per second, 24 hits per display frame, grouping of coincident hits, and square-root headroom.

### L-System Delay / microphone instrument

`src/micmic.js` turns recursive descendants into delayed audio voices. `generationTopology` builds the exact bounded rewrite, while `generationVoiceSpecs` inherits cumulative delay and cumulative turn-to-pitch along each parent path. Its gain law decays by generation and normalizes voices within a generation. `recursionParameters`, `estimateGenerations`, `generationCountForDepth`, and `generationTailSeconds` show the existing finite-tail and silence-floor conventions.

The hard bounds are also relevant: `MAX_RECURSION_FEEDBACK = 0.96`, thirteen generation stages, 1–3000 ms time folds, a 39-second usable history, 128 branches per generation, and adaptive audio pruning. `micmic-app.js`, `src/micmic-generation-dsp.js`, `src/micmic-generation-processor.js`, `src/signalsmith-generation-bank.js`, and `src/granular-economy-renderer.js` implement microphone capture and pitch-shifted descendant playback. The reusable idea is inherited time, pitch, amplitude, and stereo state along one structural lineage; the new graph instruments do not need microphone permission or this heavier renderer.

### Graph Delay

`src/graph-delay.js` should remain the canonical graph kernel rather than being copied. It provides:

- `GRAPH_PRESETS` and `GRAPH_DELAY_PATCHES`;
- `generateGraph` and `generateGraphWithinTurnBudget`;
- `annotateCycles`, using strongly connected components;
- `graphTurnRoutings`, `nodeTurnRouting`, and `turnPitchSemitones`;
- `graphSinkNodeIds` and `graphNodePans`;
- `graphEdgeSwitchMultipliers` and `edgeAudioParameters`;
- the microphone safety constants `MAX_GRAPH_NODES = 24`, `MAX_GRAPH_FEEDBACK = 0.92`, and `MAX_GRAPH_TURN_ROUTES = 192`, plus a separate 32-node ceiling used by the event instruments.

The supplied topologies cover Chain, Tree, DAG, Bipartite, Ring, Small World, Hub, Mesh, Modular, and seeded Random graphs. After cycle annotation, `generateGraph` marks a stable cycle-closing route with `feedbackEdge: edge.cyclic && edge.to <= edge.from`. This distinction is essential: an edge can be inside a strongly connected component without attenuating every intermediate step.

`edgeAudioParameters` maps geometric edge length to 4 ms–2 s of delay. The microphone Graph Delay retains its absolute `timeScale` control, which adds milliseconds according to length. Graph Synth and Graph Drum Machine instead use a dimensionless `distanceRatio`: 1× gives every edge the minimum time, while larger ratios stretch longer edges proportionally until the shared 2-second safety ceiling. Its normal pass gain is `nodePass / sqrt(indegree * outdegree)`; only a `feedbackEdge` multiplies that result by the bounded feedback amount. Thus a simple ring at `nodePass = 1` loses exactly one feedback factor per complete lap, not one factor at every node. Existing tests also verify that dense and route-masked cyclic graphs remain below unity.

`graph-delay-app.js` demonstrates the audio-rate realization in `buildAudioGraphNodes`: each edge is an `input bus -> route switch -> DelayNode -> GainNode`; a feedback edge additionally passes through a low-pass filter before returning to the target node. Relative incoming-to-outgoing turns are pitch shifted by `src/graph-turn-processor.js`. Only forward sinks are tapped to the wet output, then a compressor and soft clipper protect the final bus. This is the direct starting point for Graph Synth.

## Shared graph contract

The microphone Graph Delay keeps using `generateGraphWithinTurnBudget` for its small live-audio turn matrix. The two event instruments use `generateGraph` directly so their requested density and every authored route remain present; their renderer budgets thin excess attacks instead of rewriting topology. All three derive enabled-route gains with `graphEdgeSwitchMultipliers` and timing/amplitude with `edgeAudioParameters`. Node dragging may change delay and turn mappings, but not node identity or edge identity. Seeded graphs must remain deterministic.

For the event instruments, normalized edge length `L` and response curve `C` set the route time by `baseDelay × (1 + L^C × (distanceRatio - 1))`, subject to the shared 4 ms–2 s safety bounds. This is a scale, not an added millisecond offset: doubling `baseDelay` doubles every edge time that has not reached the ceiling. The Graph Delay page continues to use its established `baseDelay + L^C × timeScale` contract.

For every enabled route `e`:

```text
arrivalTime(next) = arrivalTime(current) + e.delaySeconds
amplitude(next)   = amplitude(current) * e.gain * switchMultiplier(e)
```

Forward edges preserve the normalized pass level. A `feedbackEdge` additionally applies `feedback <= 0.92`. Tone state is unchanged on forward edges and loses brightness once on each feedback edge; the audio-rate form uses the existing low-pass cutoff, while the event form carries a normalized brightness value through an equivalent one-pole decay. A ring therefore repeats after the sum of its edge delays, at one feedback factor and one damping step per lap.

Do not infer cycling from the preset name: use `graph.cyclic` and `edge.feedbackEdge`, especially for Random. Acyclic graphs must end naturally and must not manufacture echo repetitions.

## Graph Drum Machine semantics

A clock, pad, computer key, pointer strike, or MIDI note injects one event into every graph entry (or node zero when a graph has no zero-indegree entry). A priority queue, ordered by absolute AudioContext time, advances events along enabled edges. Each node arrival produces at most one audible strike for a coincident source pulse, then schedules outgoing arrivals using the shared contract. `GraphDrumAudio` keeps the FM context as the graph clock and translates the same future offset into the physical engine's context, so both renderers preserve `startAt`; JavaScript timers do not define rhythm.

Suggested selectable mappings, parallel to L-System Drum Machine, are:

1. **Path depth × turn**: shortest forward depth chooses the four-row family; signed relative turn chooses the column.
2. **Stage position**: node Y chooses the row and X chooses the column.
3. **Degree × cycle phase**: indegree/outdegree class chooses the row; SCC position or lap phase chooses the column.

Vertical position and accumulated turn can retune the chosen drum. Indegree/outdegree can shape tone/noise or decay. Arrival amplitude sets strike level; simultaneous arrivals use square-root normalization. Reuse `cloneDefaultFmDrumVoices`, `sanitizeFmDrumVoice`, `mappedLSystemDrumVoice`-style parameter shaping, and the existing sixteen-slot keyboard/MIDI convention without overwriting the user's saved FM drum bank.

Synthesized and physical Graph Drum voices preserve their envelope time when pitch changes. Sample percussion remains intentionally tape-like: pitch uses playback rate, so an upward transposition may shorten the recorded hit instead of invoking duration-preserving time stretch.

In a cycle, a returned event is a real delayed retrigger with reduced amplitude and darker tone. The final event scheduler stops propagation below an amplitude floor of 0.001, beyond a 1,024-second defensive horizon, at 8,192 path events, or at the bounded feedback/depth limits. A binary priority queue preserves deterministic time ordering, while two fixed-width 32-bit path hashes plus bounded depth preserve route identity without growing an ancestry string on every cyclic pass. Graph Synth and Graph Drum Machine emit attacks only at node arrivals; there is no intermediate edge-subdivision parameter. Their quieter display marks an active route and briefly fills its destination node instead of drawing traveling dots or expanding rings. The page caps each source pulse at 768 drum or 1,024 synth attacks, fairly shares at most 2,048 due-event examinations across active runs per display frame, and renders at most 64 native synth attacks or 96 lightweight drum attacks per frame. The full hybrid Rattlesnake path is reduced to 24 attacks per frame and 240 per second. Buffer-rendered Karplus banks are held to 4 attacks per frame and 24 per second; their graph-scaled controls still produce preset-dependent audible tails rather than literal 40–100 ms buffers. These overload bounds adaptively thin only excess audio attacks; the generated topology, all 32 available nodes, and their route identities remain intact.

## Graph Synth semantics

Graph Synth replaces Graph Delay's microphone terminal with a permission-free built-in excitation. A played note or transport gate creates a Sine, Triangle, Sawtooth, Square, FM, PM, or Shepard source using the mappings and envelope language of the L-System synth. The implemented event-domain form schedules each node arrival on the AudioContext clock using the shared graph kernel and gain math, with the event instruments' ratio-based edge timing:

- edge length scales delay time between the minimum and the selected distance ratio;
- an incoming-to-outgoing signed turn controls inherited pitch interval;
- node position controls pan and can optionally control pitch or timbre;
- branching uses normalized energy;
- every reached node creates a one-shot arrival, audible when its resulting oscillator lies in the render band;
- a cycle-closing edge schedules the inherited voice again after the remaining edge times, with feedback gain and brightness damping applied once per lap.

Inherited-turn pitch is a winding measurement, not a bounded node coordinate. The Full-turn pitch travel control states how many octaves one signed 360° revolution contributes; every later cycle adds the same interval again. Ordinary Sine, Triangle, Sawtooth, Square, FM, and PM notes therefore ignore Position / Shepard span and never pin to a repeated endpoint note. Height, degree, and progress still use that span as their bounded coordinate scale. Shepard uses it as a circular wrap window. Tuning is applied after the route interval, and the mathematical semitone/log-frequency state remains intact at every pass. Arrivals outside the inclusive 20 Hz–20 kHz render band remain visible but do not allocate Web Audio oscillators; a separate Nyquist/aliasing policy can be added without falsifying the graph pitch.

Graph Synth's named graph presets own topology, route timing, feedback behavior, and launch cadence only. Loading one preserves the current voice, pitch/tuning mapping, trigger scope, modulation, articulation, ADSR, and stereo settings. This keeps a topology choice from silently replacing the player's instrument or delaying the first audible node behind a leaf-only attack policy.

This makes a cyclic Graph Synth a network-delay event instrument, not an LFO imitation or a merely visual loop. The event scheduler retains incoming-route provenance through merges, so the following edge receives the correct local turn. Structural rebuilds cancel incompatible scheduled arrivals and fade active voices before adopting the new graph. Moving nodes, arranging, scattering, or animating geometry does not relaunch a traversal: already-scheduled attacks remain untouched while unscheduled future path events are retimed/remapped outside the audio lookahead window.

Useful sound mappings are Turn -> pitch, Y -> pitch, Degree -> FM/PM depth, Path time -> envelope phase, and SCC/lap -> brightness. Keep one direct/root voice option so an acyclic graph with a long first edge responds immediately. Cyclic tails must be cleared by Audio off, Panic, page hide, topology reset, and page exit.

## Safety and performance bounds

- Keep the microphone Graph Delay at 3–24 nodes and 192 relative-turn routes. The event instruments retain their complete requested graph at 3–32 nodes; audio attack thinning, scheduler limits, and dense drawing batches must never mutate its nodes or routes.
- Keep edge delay within 0.004–2 seconds, event-instrument distance ratio within 1×–12×, `nodePass` within 0–1, feedback within 0–0.92, and per-return tone/brightness retention within 0.2–1.
- Preserve split/merge normalization and use `graphEdgeSwitchMultipliers`; closing one merge input must not amplify another input.
- Retain protected outputs, conservative master maxima, and click-safe gain ramps; Graph Synth uses its own bounded compressor-backed one-shot renderer while `GraphDrumAudio` owns and silences both the FM and physical renderers together.
- Bound event count, tail time, depth, active traversals, and amplitude as described above. Keep at most 64 live graph traversals and draw only the newest four; Graph Synth separately caps native simultaneous oscillator voices at 64.
- Recompute spectral/cycle safety after route switching. Never connect a zero-delay feedback path.
- Suspend expensive animation under reduced motion. When either graph instrument becomes hidden or receives `pagehide`, stop its transport, clear every active traversal and scheduled tail, close its AudioContext, and ignore hidden-tab MIDI (including Start/Continue). A BFCache `pageshow` must restore the page paused with Audio off.

## Interaction, accessibility, and MIDI

Both pages need explicit Audio off/on state, no autoplay, labelled controls and outputs, unique IDs, Reset all, and a terse `aria-live` status for user actions rather than animation frames. The Audio control clears every active and future tail when switched off. The graph canvas has no keyboard or duplicate trigger overlay: a compact Play-panel Seed note sets transport, Send, and Space, while MIDI In and the shared computer-key layouts inject independent notes and update the visible seed readout. The canvas remains keyboard focusable: Space injects a pulse, arrow keys move the selected node, and Enter toggles its first outgoing route. Pointer users can drag nodes and click the visible route switches. Route switches have a non-color state, while cycle-closing routes retain the dashed coral treatment. Reduced motion changes presentation without changing sound.

Register Graph Drum Machine under the `drums` note mode and Graph Synth under `pitched` in `src/instrument-midi-capabilities.js`. The shared browser MIDI adapter can provide the normal sixteen-pad and chromatic-key fallbacks. Hardware MIDI should trigger only the source event/note by default; internally generated feedback echoes should not be sent back out as new MIDI messages, avoiding an external MIDI loop. If graph-event MIDI output is later exposed, it needs a separate opt-in and the same rate/tail bounds.

## Site, build, and test integration

The implemented pages are `graph-drums.html` and `graph-synth.html`, with thin entry modules, the shared `graph-instruments.css` workbench style, `src/graph-instrument-app.js`, the pure `src/graph-instruments.js` scheduler/mapping kernel, and `src/graph-synth-audio.js`. They reuse `src/graph-delay.js`; its topology algorithms are not forked.

Add both tools to `nav.js`, add mandatory card copy to `src/instrument-catalog.js`, classify MIDI in `src/instrument-midi-capabilities.js`, add `assets/instruments/graph-drums.webp` and `assets/instruments/graph-synth.webp`, update the authored desktop/mobile fallback links on related pages, and document both instruments in `README.md`. New untracked runtime files must be listed in the worktree-copy and required-file sections of `scripts/build-site.sh`; update `tests/aws-deployment.test.mjs`, then regenerate `dist-wax` through the build rather than editing generated copies by hand.

Core tests should prove:

- deterministic topology and mappings for a seed;
- finite completion for every acyclic topology;
- ring return time equals the sum of edge delays;
- ring amplitude and brightness lose exactly one feedback/damping step per lap;
- the scheduler reaches all 32 nodes in the maximum chain and completes multiple decaying laps around the maximum ring;
- a dense cyclic 32-node schedule stays bounded and deterministic, keeps fixed-width path hashes, and leaves its generated topology unchanged;
- tempo and node-position edits preserve pulse count, active-run count, transport phase, and already-scheduled attack count;
- branching, merging, switching, and simultaneous-event normalization stay bounded;
- random graphs follow their computed cycle annotation;
- amplitude floor, tail horizon, hit-rate limit, event queue, panic, and stale-event cancellation work;
- Graph Synth uses no microphone permission and clears every live feedback tail;
- markup has labelled controls/unique IDs, navigation resolves both pages, catalogue icons are valid WebP files, MIDI classification is correct, and release/WAX artifacts contain every runtime file.

Run focused tests first, followed by `npm run check`, `npm test`, `node scripts/build-release-site.mjs /tmp/morphazoid-graph-site`, and `npm run check:wax-dist` after regenerating the committed WAX artifact.

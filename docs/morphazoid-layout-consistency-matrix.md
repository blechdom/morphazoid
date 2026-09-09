# Morphazoid all-page layout consistency matrix

## Scope and evidence boundary

- **Audit date:** 2026-09-07
- **Source baseline:** isolated `codex/ui-storybook-overhaul` worktree at commit `2c6763e14a26acd04d0a662185083d92945938f7`
- **Inventory:** the 138 stable tool entries exported by `nav.js` `TOOL_GROUPS`, plus the authored home/catalog route `home / index.html`, for **139 navigable pages** total.
- **Evidence used:** authored HTML/CSS/ES modules, `nav.js`, `src/instrument-catalog.js`, `src/instrument-midi-capabilities.js`, `src/wax-instrument-roles.js`, the shared `src/ui/` implementation, and existing focused tests.

This is primarily a **static-source conformance report**, not a claim that all 139 pages were played and observed at every viewport. Static structure can earn `=` or `~`. Audio, MIDI, and responsive behavior remain `?` unless focused tests or direct runtime evidence establish the relevant contract. A class name, an `AudioContext` reference, a MIDI capability record, or an `@media` rule is evidence of intent, not proof of correct behavior. Custom/domain-specific UI is not automatically a defect.

The inventory uses stable navigation IDs rather than deriving IDs from filenames. This preserves intentional mappings such as `combo / shapes.html`, `sorting-algorithms / algorithmic-sequencers.html`, `object-forge / dentaphone.html`, `breath-atlas / mouthophones.html`, `cellular-automata / automatapoeia.html`, `colony-syrinx / monstrozoid.html`, and `micmic / l-mic.html`.

## Neutral part vocabulary

- **Header:** persistent site identity, authored fallback navigation, enhanced navigation, current-page indication, and optional settings/I/O hosts above the page body.
- **Shell:** the top-level spatial contract that relates the primary surface to controls and determines document versus nested scrolling.
- **Primary Surface:** the main playable or explanatory viewport, such as a Canvas, SVG, graph, grid, simulation, tract, waveform, or catalog body.
- **Surface Readout:** compact status attached to the primary surface, including position, mode, runtime, selection, or audio state. It is not a substitute for accessible control state.
- **Control Panel:** the major control region adjacent to or following the primary surface.
- **Control Section:** a labelled grouping within the control panel, commonly a native `details` disclosure but sometimes a static region.
- **Transport:** controls that start, stop, pause, step, seek, loop, or otherwise move an instrument through time. Transport must not silently arm browser Audio.
- **Parameter Field:** a labelled native input/select plus value output and optional description. The application owns its model and audio destination.
- **Rotary Field:** a parameter presented as a dial. It still needs a complete slider contract, visible value, keyboard operation, pointer cancellation, bounds, and focus styling.
- **Sequence/Timeline:** a time-ordered editor or display. This includes step grids, lanes, clips, generated operations, record timelines, and playheads; these are different kinds, not interchangeable widgets.
- **Preset/State:** built-in starting points and any user save, recall, import, export, URL share, or community-load capability. A built-in preset bank alone is **not** user save/recall.
- **Audio I/O:** explicit browser Audio arming, master/output level, optional input/output routing, and lifecycle status. It is separate from Transport.
- **MIDI I/O:** MIDI enable/status, input/output routing, channel/message mapping, clock/transport integration, and cleanup. A capability record states a requirement; it does not prove implementation.
- **Auxiliary Monitor/Inspector:** meters, analyzers, patch inspectors, recorders, routing views, download callouts, or secondary workspaces that support but do not replace the primary gesture.
- **Help:** concise instructions, accessible descriptions, disclosures, and adjacent documentation that explain the gesture without covering or displacing it.

## Five-anchor anatomy comparison

| Part | Shape | Solid | Hyper | WebGPU 303 | Chaotic FM |
| --- | --- | --- | --- | --- | --- |
| Header | `.masthead`, `.audio-strip`, `#audioButton`, `#audioState`, authored tabs/mobile select, `nav.js` | Same legacy-standard header contract | Same legacy-standard header contract | Same contract; `nav.js` plus `#audioButton` | Same contract; `nav.js` plus `#audioButton` |
| Shell | `main.shell`; `section.stage`; `.stage-wrap#stageWrap`; `aside.panel` | `main.shell`; `section.stage`; `.stage-wrap`; `aside.panel` | `main.shell`; `section.stage`; `.stage-wrap`; `aside.panel` | `main.shell.webgpu-303-shell`; `.stage.webgpu-303-stage`; `.stage-wrap.webgpu-303-stage-wrap#stageWrap`; `.panel.webgpu-303-panel` | `main.shell.chaotic-fm-shell`; `.stage.chaotic-fm-stage`; `.stage-wrap#stageWrap`; `.panel.chaotic-fm-panel` |
| Primary Surface and readout | `canvas#stage` plus `.stage-meta #stageReadout`; pointer/keyboard playhead and several curve editors | `canvas#stage` plus surface/cutting-plane readout | `canvas#stage` plus W-plane/4D rotation readout | `canvas#stage`, `.stage-meta #stageReadout`, plus surface-adjacent `.webgpu-stage-knobs` | `canvas#stage`, `.stage-meta #stageReadout`, and a recursive operator/signal visualization |
| Panel anatomy | `#playSection`, `#formSection`, `#soundSection`, `#mappingSection`, `#outputSection`; dense native legacy fields and choice switches | Four principal sections: Play, Form, Rotation, Sound | Four principal sections: Play, Form, 4D Rotation, Sound | `.webgpu-303-presets`, Mapping, Structure, Sound, Output/runtime sections | Auxiliary `.plugin-download-callout` precedes `.chaotic-fm-presets`, Performance, Structure, and DSP reference sections |
| Transport | `#playButton`, `#position`, speed/motion/direction controls; multiple playheads | `#playButton` moves the reading surface/cutting plane | `#playButton` moves the hyperplane | `#playButton` drives the internal 303 sequence | No conventional `#playButton`; drone/MIDI performance is intentionally controlled through Audio and performance mode |
| Rotary fields | None; `button[role=slider]` nodes are curve handles, not knobs | None | None | Runtime-generated `.webgpu-knob-dial[role=slider]` in `#knobControls`; pointer, wheel, keyboard, ARIA values | No shared rotary bank; native legacy fields and custom signal controls |
| Sequence/timeline | A playhead path and envelope/pitch curves, not a step sequencer | Surface traversal only | Hyperplane traversal only | Internal sequence arrays, preset sequence data, and sequence actions; not the shared `createStepButton` pattern | DSP reference contains a descriptive operation sequence; performance is drone/MIDI rather than a step workspace |
| Preset/state | Curve/envelope presets exist, but no uniform user bank | No prominent page preset bank | No prominent page preset bank | Built-in `#presetButtons`; applying a preset changes parameters and sequence | Built-in `#presetButtons`; explicit WAX state registration preserves validated settings |
| Main inconsistency | Much denser than Solid/Hyper and mixes generic shell controls with instrument-owned curve-slider editors | Matches the shell well but lacks the richer Output/Help/state affordances of Shape | Matches the shell but compressed markup and 4D controls stress section labelling | Conforms outside, but puts a large custom dial bank beside the surface and uses a second control grammar | Conforms outside, but begins the panel with a download callout, has no standard Transport, and has page-specific MIDI/WAX state coupling |

The shared outer anatomy is real: all five anchors load the same global design foundations through `style.css`, and each uses the exact `.shell`, `.stage`, and `.panel` contract. The implementation is nevertheless still mostly legacy/static HTML. Production factory adoption is concentrated in `nav.js` (`createMidiStatus`, `createStereoMeter`) and `physics-app.js` (`createChoiceSwitch`, `createRangeField`, `createSelectField`). The anchor differences above should be represented as optional shell regions and domain-owned controls, not erased.

## Cell legend

Each matrix cell combines an implementation origin with a verdict.

Origins:

- `F` — a shared `src/ui` factory/module is actually instantiated.
- `L` — legacy standard markup/classes consume shared `style.css` and compatibility selectors.
- `C` — custom or page-local implementation.
- `Ø` — the part is absent.

Verdicts:

- `=` — conforms to the applicable source-level contract.
- `~` — equivalent or intentionally domain-specific.
- `!` — confirmed divergence or an expected part is missing.
- `?` — static evidence is insufficient; runtime/manual proof is needed.
- `–` — not applicable by design.

Examples: `F=` shared and conforming; `L=` legacy-standard and conforming; `C~` valid custom anatomy; `C!` confirmed custom divergence; `Ø!` missing required part; `Ø–` absent by design; `L?` or `C?` present but not runtime-verified. `Pr` records visible/built-in preset anatomy only; it does not imply user save/recall.

## All-page matrix

| ID / route | Family | Hd | Sh | Sf | Pn | Sq | Pr | Au | Mi | Ax | Rs | Main inconsistency or distinguishing part |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `home` / `index.html` | Landing / Catalog | L= | C~ | Ø– | Ø– | Ø– | Ø– | Ø– | Ø– | C~ | C? | Catalog/card body intentionally replaces an instrument surface and panel. |
| `shape` / `shape.html` | Geometry Synths | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Canonical shell, but curve editors and multi-playhead controls make the panel much denser than its siblings. |
| `solid` / `solid.html` | Geometry Synths | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Compact cutting-plane instrument; no prominent preset/state area. |
| `moebius` / `moebius.html` | Geometry Synths | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Topology traversal is domain-owned inside the standard shell. |
| `klein-bottle` / `klein-bottle.html` | Geometry Synths | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Topology controls extend the standard shell without a shared state bank. |
| `hyper` / `hyper.html` | Geometry Synths | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Compact 4D sibling; fewer sections and state affordances than Shape. |
| `graph-synth` / `graph-synth.html` | Geometry Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Graph topology is instrument-owned while outer controls remain legacy-standard. |
| `lattice` / `lattice.html` | Tiles | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Pattern playhead is a domain traversal, not a generic sequence grid. |
| `spiral` / `spiral.html` | Tiles | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Spiral time direction and scrubbing remain app-owned. |
| `lattice-drums` / `lattice-drums.html` | Tiles | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Standard shell with a geometry-specific drum traversal and repeated legacy fields. |
| `spiral-drums` / `spiral-drums.html` | Tiles | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Standard shell; drum timing follows the spiral rather than generic cells. |
| `penrose-tilings` / `penrose-tilings.html` | Tiles | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Tiling path/sequence logic and presets are local to the geometry. |
| `shape-drums` / `shape-drums.html` | Drum Machines | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | High-value repeated range/select migration candidate; retain strike scheduler and playhead. |
| `solid-drums` / `solid-drums.html` | Drum Machines | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Surface traversal and drum mapping are local despite standard outer anatomy. |
| `hyper-drums` / `hyper-drums.html` | Drum Machines | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Many 4D rotation fields stress panel density and short-landscape reachability. |
| `l-system-drums` / `l-system-drums.html` | Drum Machines | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Traversal/system presets are domain state; ordinary fields are migration candidates. |
| `graph-drums` / `graph-drums.html` | Drum Machines | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Large topology/delay/motion/mapping panel uses repeated legacy fields. |
| `linear-drums-machine` / `linear-drums-machine.html` | Drum Machines | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Paint-machine shell and custom pattern workspace intentionally depart from the standard two-column anatomy. |
| `rubix` / `rubix.html` | Sequencers | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Cube visibility and sticker sequencing require app-owned grid semantics. |
| `constellation` / `constellation.html` | Sequencers | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Composer graph/inspector workspace is a Dashboard or Sequence Workspace, not a plain Instrument Shell. |
| `sliding-puzzle` / `sliding-puzzle.html` | Sequencers | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Move history and solver timeline remain puzzle-owned. |
| `wave-pool` / `wave-pool.html` | Sequencers | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | Ø– | C? | Custom wave/pattern surface keeps a standard panel vocabulary only at its edges. |
| `hyper-rubix` / `hyper-rubix.html` | Sequencers | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | High-dimensional cube sequence uses custom visibility and traversal semantics. |
| `webgpu-303` / `webgpu-303.html` | Sequencers | L= | L= | L= | L= | C~ | C~ | L? | F? | C~ | L? | Surface-adjacent custom dial bank is the clearest second control grammar inside a standard shell. |
| `webgpu-chiptune` / `webgpu-chiptune.html` | Sequencers | L= | L= | L= | L= | C~ | C~ | L? | F? | C~ | L? | Nine-lane SOURCE/NOTE/REST/OFF editor cannot be reduced to generic on/off steps. |
| `jaw-jam` / `jaw-jam.html` | Sequencers | L= | C~ | C~ | C~ | C~ | Ø– | L? | F? | C~ | C? | Gesture/performance workspace uses a custom shell and auxiliary monitors. |
| `webgpu-synths` / `webgpu-synths.html` | Sequencers | L= | L= | C~ | L= | C~ | L~ | L? | F? | C~ | L? | Standard shell lacks the usual `.stage-wrap`; GPU views and state remain custom. |
| `shader-synth-playground` / `shader-synth-playground.html` | Sequencers | L= | C~ | C~ | C~ | Ø– | C~ | L? | F? | C~ | C? | Full modular workspace/inspector should use the Dashboard contract rather than forced shell anatomy. |
| `throatazoid` / `throatazoid.html` | Voice Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Large airway/voice controls and monitors are domain-owned; no conventional Transport is required. |
| `pink-trombonazoid` / `pink-trombonazoid.html` | Voice Synths | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | Ø– | C? | Tract-focused custom shell needs independent touch and overlay review. |
| `throat-singing` / `throat-singing.html` | Voice Synths | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Dual-voice airway controls fit the shell but carry custom performance state. |
| `syrinx` / `syrinx.html` | Voice Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Call/animal decks and model HUD extend the Instrument Shell. |
| `tongued-beasts` / `tongued-beasts.html` | Voice Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Tongue/airway gesture remains custom inside shared outer geometry. |
| `hybrinx` / `hybrinx.html` | Voice Synths | L= | L= | L= | L= | C~ | C~ | L? | F? | C~ | L? | Editable SVG clips/keyframes and splitter form a true timeline, not a generic step component. |
| `creaturazoid` / `creaturazoid.html` | Voice Synths | L= | C~ | C~ | L= | C~ | C~ | L? | F? | C~ | C? | Custom split shell and continuous-volume/call lanes require a Sequence Workspace contract. |
| `colony-syrinx` / `monstrozoid.html` | Voice Synths | L= | C~ | C~ | L= | C~ | C~ | L? | F? | C~ | C? | Stable ID differs from route; colony sequence and large custom surface need explicit family treatment. |
| `blowhole` / `blowhole.html` | Voice Synths | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Bioacoustic custom shell/monitor anatomy should remain Special. |
| `jaw-harp` / `jaw-harp.html` | Voice Synths | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Jaw gesture and analysis are domain-specific within standard outer anatomy. |
| `harmonica` / `harmonica.html` | Voice Synths | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Breath/reed interaction has specialized auxiliary status and input risk. |
| `hiccup-head` / `hiccup-head.html` | Voice Synths | L= | C~ | C~ | L= | C~ | C~ | L? | F? | C~ | C? | Large custom sequencer and split regions parallel Creaturazoid but have different step semantics. |
| `digestazoid` / `digestazoid.html` | Voice Synths | L= | C~ | C~ | L= | Ø– | C~ | L? | F? | C~ | C? | Body/processor controls use a custom shell; no generic timeline should be inferred. |
| `breath-atlas` / `mouthophones.html` | Voice Synths | L= | L= | L= | L~ | Ø– | Ø– | L? | F? | Ø– | L? | Stable ID differs from route; panel omits standard `control-section` disclosures. |
| `spelling-synthesizer` / `spelling-synthesizer.html` | Voice Synths | L= | C~ | C~ | C~ | Ø– | Ø– | L? | F? | Ø– | C? | Text/pronunciation workflow needs a Special form contract, not a Canvas-first shell. |
| `vocalzoid` / `vocalzoid.html` | Voice Synths | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Voice sequencer/monitor workspace is custom and needs explicit scroll ownership. |
| `lumber` / `lumber.html` | Mic FX | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Microphone capture/effect state adds permission and recorder lifecycle risk. |
| `micmic` / `l-mic.html` | Mic FX | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Stable ID differs from route; microphone chain remains processor-owned. |
| `graph-delay` / `graph-delay.html` | Mic FX | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Graph delay uses standard shell while routing/model behavior stays local. |
| `micromorph` / `micromorph.html` | Mic FX | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Custom slider-role controls and external model state need targeted accessibility review. |
| `plugazoid` / `plugazoid.html` | Mic FX | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Input bridge/download/help content adds a significant auxiliary region. |
| `shepard-risset` / `shepard-risset.html` | Barber Shop Poles | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Compact standard shell and static panel fields are a safe factory-migration example. |
| `slippery-resynthesis` / `slippery-resynthesis.html` | Barber Shop Poles | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Resynthesis/file state adds auxiliary and persistence concerns. |
| `moire-drone` / `moire-drone.html` | Barber Shop Poles | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Standard shell; custom visual/filter coupling remains instrument-owned. |
| `drum-roll-please` / `drum-roll-please.html` | Barber Shop Poles | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Standard shell with drum/rattle synthesis but no explicit sequence workspace. |
| `ouroborousel` / `ouroborousel.html` | Barber Shop Poles | L= | C~ | C~ | L= | C~ | L~ | L? | F? | Ø– | C? | Carousel shell and rotary slider-role controls need a shared rotary-field decision. |
| `ourorourobouroboros` / `ourorourobouroboros.html` | Barber Shop Poles | L= | C~ | C~ | L= | C~ | L~ | L? | F? | Ø– | C? | Ring/carousel variation shares custom anatomy but not the exact shell contract. |
| `ouroboros` / `ouroboros.html` | Barber Shop Poles | L= | C~ | C~ | L= | C~ | L~ | L? | F? | Ø– | C? | Circular sequence surface and rotary controls form a specialized family. |
| `ouroboros-borealis` / `ouroboros-borealis.html` | Barber Shop Poles | L= | C~ | C~ | L= | C~ | L~ | L? | F? | Ø– | C? | Borealis variant extends the custom Ouroboros shell and needs shared family tests. |
| `sandy-syrup-delay` / `sandy-syrup-delay.html` | Barber Shop Poles | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Shared barber-delay app makes ordinary panel controls a highest-safety migration slice. |
| `candy-coil-delay` / `candy-coil-delay.html` | Barber Shop Poles | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Same app/shell as Sandy; retain analyzer and delay model while sharing fields. |
| `l-system` / `l-system.html` | Fractals & Recursion | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Traversal/preset logic stays local; outer fields are legacy-standard. |
| `recursion` / `recursion.html` | Fractals & Recursion | L= | L= | L= | L~ | C~ | Ø– | L? | F? | C~ | L? | Standard surface but panel omits the common disclosure-section pattern. |
| `enveloper` / `enveloper.html` | Fractals & Recursion | L= | L= | L= | L= | C~ | Ø– | L? | F? | C~ | L? | Envelope/timeline behavior is domain-owned and transport-sensitive. |
| `julia` / `julia.html` | Fractals & Recursion | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Panning/similarity controls extend the standard surface contract. |
| `striped-staircase` / `striped-staircase.html` | Fractals & Recursion | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Sequence/spectral analysis adds an auxiliary view to a standard shell. |
| `recursive-fm` / `recursive-fm.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Dense signal-flow monitor and MIDI mode make a simple field migration behavior-sensitive. |
| `recursive-pm` / `recursive-pm.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | PM flow graph and native MIDI mapping must survive outer UI consolidation. |
| `chaotic-fm` / `chaotic-fm.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | C~ | L? | C? | C~ | L? | Page-specific WAX state, MIDI mode, plugin callout, and no conventional Transport raise migration risk. |
| `chaotic-pm` / `chaotic-pm.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Complex PM flow/preset state should follow simpler family migrations. |
| `cascading-fm` / `cascading-fm.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Repeated legacy panel fields are shareable; synthesis graph stays local. |
| `cascading-pm` / `cascading-pm.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | PM sibling is a good paired field migration after behavior baselines. |
| `weierstrass` / `weierstrass.html` | Chaotic Synths | L= | L= | L= | L= | Ø– | L~ | L? | F? | Ø– | L? | Standard shell with local wave model and dense parameter set. |
| `playhead-paint` / `playhead-paint.html` | Misc | L= | C~ | C~ | L= | C~ | Ø– | L? | F? | C~ | C? | Paint surface and gesture/audio zones use a custom shell around a standard panel. |
| `boidzoid` / `boidzoid.html` | Misc | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Flight path and spatial readouts are domain-owned inside standard anatomy. |
| `vector-flight` / `vector-flight.html` | Misc | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Vector trajectory/telemetry acts as a custom sequence and monitor. |
| `gesturama` / `gesturama.html` | Misc | L= | C~ | C~ | C~ | Ø– | L~ | L? | F? | C~ | C? | Gesture-focused full app does not expose the exact shell/stage/panel tokens. |
| `image-to-instrument-3` / `image-to-instrument-3.html` | Misc | L= | C~ | C~ | C~ | C~ | L~ | L? | F? | C~ | C? | Wheel-of-organs image workspace needs upload/analysis as first-class auxiliary anatomy. |
| `orbital-ferris` / `orbital-ferris.html` | Misc | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Orbit sequence and ride controls fit a standard experiment shell. |
| `fm-drums` / `fm-drums.html` | Instruments | L= | C~ | C~ | C~ | Ø– | C~ | L? | F? | Ø– | C? | Compact drum-pad shell is structurally separate from geometry drum pages. |
| `linear-drums` / `linear-drums.html` | Instruments | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Custom knob and linear-pattern grammar need a rotary/sequence contract review. |
| `karplus-strong` / `karplus-strong.html` | Instruments | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Rotary-style slider controls exist outside a shared Rotary Field primitive. |
| `karplus-carpet` / `karplus-carpet.html` | Instruments | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Carpet gesture and custom slider presentation remain instrument-owned. |
| `surround-field` / `surround-field.html` | Instruments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Multichannel routing/recording is a Dashboard-like auxiliary system within a shell. |
| `sample-drums` / `sample-drums.html` | Instruments | L= | C~ | C~ | C~ | Ø– | C~ | L? | F? | Ø– | C? | Pad/sample shell differs from both FM and geometry drum layouts. |
| `object-forge` / `dentaphone.html` | Instruments | L= | L= | L= | L~ | C~ | L~ | L? | F? | C~ | L? | Stable ID differs from route; physical-object editor lacks common disclosure sections. |
| `sorting-algorithms` / `algorithmic-sequencers.html` | Algorithmic Sequencers | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Generated-operation progress is a custom sequence, not a reusable step grid. |
| `dijkstra` / `dijkstra.html` | Algorithmic Sequencers | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Shares one app/layout with the algorithm family; outer fields are high-leverage migration targets. |
| `room-lobby` / `music-rooms.html` | Experiments | L= | C~ | Ø– | Ø– | Ø– | Ø– | Ø– | Ø– | C~ | C? | Landing/content room intentionally has no instrument surface or I/O. |
| `vocal-effects-room` / `vocal-effects-room.html` | Experiments | L= | C~ | Ø– | Ø– | Ø– | Ø– | Ø– | Ø– | C~ | C? | Content/launch surface is a Landing/Catalog variant, not an audio processor instance. |
| `instrument-share-room` / `instrument-share-room.html` | Experiments | L= | C~ | Ø– | Ø– | Ø– | Ø– | Ø– | Ø– | C~ | C? | Community/share concept page does not yet provide the universal preset-sharing system. |
| `morphazoid-roulette` / `morphazoid-roulette.html` | Experiments | L= | C~ | Ø– | Ø– | Ø– | Ø– | Ø– | Ø– | C~ | C? | Launcher/selection experience appropriately uses Landing/Catalog anatomy. |
| `yoyodyne` / `yoyodyne.html` | Experiments | L= | C~ | C~ | L= | C~ | C~ | L? | F? | Ø– | C? | Custom simulation shell retains a standard side panel and local state. |
| `hanoi` / `hanoi.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Shared algorithm-family controls surround a domain-specific generated sequence. |
| `minimax` / `minimax.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Shared algorithm-family shell; search-tree progression stays app-owned. |
| `nqueens` / `nqueens.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Shared algorithm-family shell; backtracking sequence remains domain-owned. |
| `euclid` / `euclid.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Shared algorithm-family shell; Euclidean pulse generation stays local. |
| `alien-larynx` / `alien-larynx.html` | Experiments | L= | L= | L= | L= | Ø– | L~ | L? | F? | C~ | L? | Very dense biological controls and monitors need a Special-content density pass. |
| `hyper-syrinx` / `hyper-syrinx.html` | Experiments | L= | C~ | C~ | C~ | Ø– | C~ | L? | F? | Ø– | C? | Custom hyper-dimensional voice shell lacks the exact standard regions. |
| `morphynx` / `morphynx.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Animal/voice sequence and HUD extend otherwise standard anatomy. |
| `escher-tessellation` / `escher-tessellation.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Geometry traversal and analysis are custom but contained by the shell. |
| `plasma-ball` / `plasma-ball.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Compact experiment with no visible preset/state bank. |
| `ffmpeg-wasm` / `ffmpeg-wasm.html` | Experiments | L= | L= | C~ | L= | Ø– | Ø– | L? | F? | C~ | L? | Media processing surface omits `.stage-wrap`; capture/export is auxiliary and permission-sensitive. |
| `order-tones` / `order-tones.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Ordering progression is a custom generated sequence in a shared shell. |
| `morphazoidical` / `morphazoidical/` | Experiments | C~ | C~ | C~ | C~ | C~ | Ø– | C? | C? | C~ | C? | Independent themed workspace is intentionally Special; do not treat it as a template name. |
| `bell-square` / `bell-square.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Physics experiment uses the standard shell and shared physics factories. |
| `entanglement-dance` / `entanglement-dance.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Coupled-state progression is domain behavior within the standard shell. |
| `quantum-square-dance` / `quantum-square-dance.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Quantum visualization uses shared shell/physics control foundations. |
| `annealogue` / `annealogue.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Annealing progression and state selection remain experiment-owned. |
| `gravity-walk` / `gravity-walk.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard geometric-physics consumer and current factory-adoption reference. |
| `ricochet` / `ricochet.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Collision progression is custom; fields come through the physics family. |
| `rigidity` / `rigidity.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard physics shell with no separate sequence or preset region. |
| `rolling-measure` / `rolling-measure.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Rolling measurement progression is the distinguishing surface behavior. |
| `falling-forms` / `falling-forms.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard physics shell; simulation remains the primary causal surface. |
| `charge-garden` / `charge-garden.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard physics shell with custom charge simulation only. |
| `packing-pressure` / `packing-pressure.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard physics shell; no separate time editor is exposed. |
| `geodesic-drift` / `geodesic-drift.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard physics shell with geodesic simulation as the primary surface. |
| `kinetic-hull` / `kinetic-hull.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Standard physics shell; hull dynamics remain local. |
| `moire-organ` / `moire-organ.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Moiré progression is an experiment-owned sequence-like mechanism. |
| `chladni-plate` / `chladni-plate.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Pattern evolution is custom while outer experiment anatomy is shared. |
| `spring-choir` / `spring-choir.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Coupled spring timing is domain-owned inside the standard shell. |
| `gear-ratio-drums` / `gear-ratio-drums.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Gear timing/drum events are custom; no generic grid is present. |
| `cellular-automata` / `automatapoeia.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Stable ID/route spelling differs; automaton pattern and state remain local. |
| `prime-sieve` / `prime-sieve.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Sieve progression is a generated sequence, not a step editor. |
| `lissajous-orbits` / `lissajous-orbits.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Orbit cycles are primary-surface behavior rather than timeline UI. |
| `pendulum-wave` / `pendulum-wave.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Phased pendulum progression is custom within the shared shell. |
| `double-pendulum` / `double-pendulum.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Chaotic motion sequence is visual behavior, not an editable timeline. |
| `reaction-diffusion` / `reaction-diffusion.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Pattern evolution/state controls add an auxiliary experiment layer. |
| `atomic-orbitals` / `atomic-orbitals.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Orbital-state visualization uses experiment-owned selection and monitor details. |
| `dna-translator` / `dna-translator.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Translation progression is a generated sequence in standard experiment anatomy. |
| `neural-pulse` / `neural-pulse.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Pulse progression is custom; any model/network dependency stays auxiliary. |
| `fourier-epicycles` / `fourier-epicycles.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | C~ | L? | Epicycle path and transform readouts are domain-owned. |
| `gravity-lens` / `gravity-lens.html` | Experiments | L= | L= | L= | L= | C~ | Ø– | L? | F? | Ø– | L? | Lens/orbit progression remains primary-surface behavior. |
| `cantor-lock` / `cantor-lock.html` | Experiments | L= | L= | L= | L= | Ø– | Ø– | L? | F? | Ø– | L? | Shared fractal-uncertainty shell with no explicit sequence region. |
| `escape-dust` / `escape-dust.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | Ø– | L? | Iteration/path state is custom inside a shared family shell. |
| `linebreaker` / `linebreaker.html` | Experiments | L= | L= | L= | L= | C~ | L~ | L? | F? | C~ | L? | Line/event progression and extra readouts distinguish this family member. |
| `combo` / `shapes.html` | Apps | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Consolidated 2D/3D/4D instrument has custom banks and three role-slider knobs; do not merge it with separate Shape/Solid/Hyper pages. |
| `l-systems` / `l-systems.html` | Apps | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Full multi-system application needs a Dashboard/Sequence Workspace decision. |
| `tiles-app` / `tiles.html` | Apps | L= | C~ | C~ | C~ | C~ | C~ | L? | F? | C~ | C? | Multi-tiling app shell and inspectors are intentionally broader than Instrument Shell. |
| `algorithmic-mazes` / `algorithmic-mazes.html` | Apps | L= | L= | L= | L~ | C~ | Ø– | L? | F? | C~ | L? | Standard surface but no exact panel/control-section contract; multiple playheads are domain-owned. |
| `paths` / `paths.html` | Apps | L= | L= | L= | L~ | C~ | Ø– | L? | F? | C~ | L? | Path application uses a standard shell but a custom non-disclosure panel. |

## Summary counts and interpretation

Static detectors over the 139 authored routes found:

- **139** total rows: home/catalog plus **138** `TOOL_GROUPS` entries, with no ID derived from a filename.
- **138** pages with an exact `.masthead`; the independent themed workspace is the one intentional exception.
- **105** pages with the exact `.shell` token and **105** with the exact `.stage` token.
- **103** pages with exact `.stage-wrap`, **115** with exact `.panel`, and **109** with exact `.control-section`.
- **133** pages with authored `.audio-strip`/`#audioButton` markers and **90** with `#playButton` or `data-primary-transport` markers. These are presence counts, not runtime-success counts.
- **74** pages with sequence/timeline/playhead/pattern source tokens, **89** with preset/patch/bank tokens, and **45** with monitor/inspector/analysis/record/upload/HUD tokens. These lexical candidates were manually interpreted by page context in the matrix; they are not interchangeable features.
- Production `src/ui` JavaScript adoption remains concentrated in **two shared entry points**: `nav.js` and `physics-app.js`. Most pages receive shared CSS through `style.css` but retain legacy/native markup.

The largest structural review pool is the **34 pages without exact `.shell`/`.stage` tokens**. Some are correct Landing/Catalog, Dashboard, Sequence Workspace, or Special pages; others are migration candidates. Likewise, the 24 pages without exact `.panel` and 30 without exact `.control-section` are review pools, not automatic failures.

Audio, MIDI, and responsive cells are intentionally dominated by `?`. This report did not perform a fresh 139-page permission, device, playback-continuity, or three-viewport runtime sweep. Existing focused tests inform risk and examples, but broad static presence was not upgraded into a behavioral claim.

## Top divergence priorities

1. **Separate deliberate custom anatomy from accidental drift.** Review the 34 nonstandard shells family-by-family. Preserve the custom Sequence Workspace and Dashboard pages; migrate simple one-off shell variants toward the shared outer contract.
2. **Move repeated legacy controls to factories without breaking IDs.** Start with `candy-coil-delay.html` and `sandy-syrup-delay.html`, then the simpler Solid/Hyper controls and repeated geometry-drum fields. Keep legacy classes during adoption so page CSS, tests, MIDI discovery, and WAX adapters continue to work.
3. **Define one accessible Rotary Field contract from two real consumers.** `shapes.html`/`combo-app.js` and `webgpu-303.html`/`webgpu-303-app.js` expose materially different custom role-slider dials. Do not convert curve nodes or domain handles merely because they also use `role=slider`.
4. **Do not universalize sequences prematurely.** Creaturazoid, Hiccup Head, WebGPU Chiptune, Hybrinx, algorithm-generated progressions, and geometric playheads have different lane, state, keyboard, and scheduling models. Share leaf controls only where semantics match; keep parent timing and audio app-owned.
5. **Close the preset/state capability gap explicitly.** Many pages provide built-in presets, but the site does not yet have a universal, versioned user save/recall/import/export/share/community contract. The matrix `Pr` column must not be read as proof of that future system.
6. **Turn responsive unknowns into evidence.** Run 1440×900, 390×844, and 844×390 checks for each family, including document and nested overflow, sticky surface behavior, overlay occlusion, visible labels, and 48×48 coarse-pointer Audio/primary Transport targets.

## Proposed template contracts

### Instrument Shell

Required: Header, Shell, labelled Primary Surface, accessible Surface Readout, Control Panel, labelled Control Sections, explicit Audio state where audio exists, and clear scroll ownership. Transport, Preset/State, Rotary Fields, MIDI, monitors, and Help are optional capabilities. The template owns layout and accessibility boundaries; it does not own Canvas, synthesis, scheduling, or application state.

### Sequence Workspace

Required: Header, a labelled Sequence/Timeline primary region, visible current/selection state, keyboard instructions, Transport when time advances, and an inspector/control region that remains reachable. Step cells, lanes, clips, pattern states, scheduling, and playhead math stay application-owned. A shared leaf step is used only when its state model matches.

### Dashboard

Required: Header, clear hierarchy among multiple surfaces/monitors/inspectors, labelled panels, bounded scrolling, and explicit primary action. Suitable for graph composers, modular tools, multichannel routing, analysis, and multi-view GPU applications. It must not pretend that one Canvas and one side panel are always primary.

### Landing/Catalog

Required: Header, current navigation, clear page purpose, accessible card/list navigation, and responsive document flow. Audio, MIDI, Transport, instrument panel, and sequence regions are absent by design unless the page embeds a real playable instrument.

### Special

Used when the core gesture genuinely requires a tract, creature, splitter, full-screen field, independent theme, or another domain-specific arrangement. It still inherits global requirements for accessible names, native events, focus, pointer cancellation, explicit Audio/MIDI permission, cleanup, responsive reachability, and stable navigation. “Special” is a reviewed exception contract, not a waiver from usability or maintainability.

## Recommended next evidence pass

Generate runtime evidence as a separate, repeatable pass rather than silently upgrading this source report: load all 139 routes with Audio/MIDI/microphone APIs instrumented for zero automatic permission requests; capture post-`nav.js` structure; exercise the three canonical viewports; attach per-cell evidence; and retain explicit manual overrides for valid custom anatomy. Any authored HTML/CSS/`src/ui` migration must also rebuild and verify WAX output rather than editing `dist-wax` directly.

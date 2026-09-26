# Rubixoids

`rubixoids.html` is one app page containing the full Sliding Puzzle (2D), Rubix Cube (3D) and Hyper Rubix (4D) instruments. It opens in 3D. The dimension selector sits below the main Morphazoid menu. Play, Tempo and Swing are in the active instrument’s side panel. Direct links accept `?dimension=2d`, `?dimension=3d`, or `?dimension=4d`.

## Instrument ownership and preservation

Rubixoids owns complete copies of the three instrument implementations under `src/instruments/rubixoids/sliding-puzzle/`, `src/instruments/rubixoids/rubix/` and `src/instruments/rubixoids/hyper-rubix/`. Their controllers, puzzle models, presets and styles belong to this app. The copied sounds, sequencing and interactions are preserved at migration; later Rubixoids changes can evolve independently of the standalone instruments.

The app owns its control surfaces in `src/instruments/rubixoids/native-views.js` and mounts them in the same document. Persistent ShadowRoots scope each instrument's IDs and styles, and each owned controller is initialized once. No iframe, standalone HTML page, or standalone instrument controller, model, preset or style is required. Shared site controls, Web Audio infrastructure, SIMD kernels and MIDI services remain common infrastructure. The site MIDI adapter also retains its shared WAX routing helper; instrument DSP dependencies belong to the Rubixoids copy.

The migration retained every instrument control, initial value, help description and accessibility label in the owned templates; the subsequent panel cleanup simplifies presentation without changing the musical controls. The original Audio/output elements remain as hidden controller-owned controls. One main masthead delegates Audio and output to the selected instrument and shares one MIDI toolbar inside Settings. Its layout stays fixed across dimensions. Full preset banks appear at the top of the active instrument’s control panel, following the current Morphazoid toolbar; Sliding Puzzle retains its native controls without inventing a full-instrument preset bank. The MIDI output preview stays inside the active instrument’s scrolling panel and follows its native route; parked previews release their listeners and pending work. The visible panel controls use the selected instrument’s native transport. Rubix and Hyper Rubix place Play/Tempo, Swing, Twists and Read path immediately below Select Preset, using Shape’s circular play buttons. Rubix’s passive playhead and Visible score panels are removed; Hyper’s editable sticker grid remains available for muting. Scoped DOM/event adapters connect these controls without replacing puzzle rendering, synthesis, gestures, sequencing or presets.

A failed dimension download leaves the current instrument playing and allows a clean retry. If destination activation fails, the app parks it and restores the previous instrument, transport and preset controls. Switching parks the previous instrument and activates the next; puzzle arrangements, undo histories, queued manual moves, native sound settings and editor state remain owned by each instrument. Only the active instrument runs its audio and scheduled motion; one shared musical clock retains beat phase across dimension handoffs. Explicit lifecycle adapters carry Audio/Play intent between dimensions, without arming Audio on a fresh visit. The consolidation changes code ownership and shared UI while retaining the migrated sound engines, gain calibration and musical mappings.

Rubix retains animated twists, drag previews, scramble and undo, five geometric surfaces, its live per-sticker visibility mixer, separate performer levels, native sound banks, the persistent SIMD 303 surface engine and all full presets. Sliding Puzzle retains tile transitions, line slides, rectangular boards, board rotation, path/direction controls, gesture auditioning, automatic slides and animated history unwind. Hyper Rubix retains all five sequence methods, editable gates, playback scopes, native WebGPU 303 and topology resonators, fourth-axis manipulation, animated twists/unwind, original preset banks and randomization. Specialized controls and editors remain in their native instrument panels.

Rubix Play reuses unchanged SIMD patterns prepared when Audio was armed. Turns, size, reading mode and tone edits still invalidate the relevant configuration; the original sound patterns and scheduling lead are unchanged. This removes redundant synchronous setup ahead of the first note.

The native transport contracts are also retained: Rubix requires Audio before starting Play and stops transport when Audio is disabled. Sliding Puzzle and Hyper Rubix support a silent visual clock. A dimension switch does not substitute a different sequencing algorithm or recall a preset.

The FM drum kit is copied once into `morphazoid:rubixoids:fm-drums:bank:v1` on the app's first visit. This preserves a previously saved kit while keeping later standalone bank changes separate. The original bank is never modified.

## Shared clock

The active instrument’s Tempo/Swing controls drive one shared clock for the three instruments. The clock starts at 126 BPM with straight timing and supports 30–300 BPM in every mode. Presets retain their authored tempo and swing; recalling one changes the shared clock without resetting its beat. Pause freezes that beat, and Play resumes from it.

The active AudioContext drives the common timeline. If that attached context is suspended or interrupted, the beat holds with the audio and continues immediately when audio resumes. Explicit Audio-off playback and brief dimension handoffs detach the context and use monotonic time; neither timing source uses animation frames. Hyper Rubix also retains its native hidden-tab behavior: it parks audio, lets silent time advance, and rejoins on return. Each instrument retains its own score cursor, pulse division and reading method. A dimension joins the next shared pulse while keeping its saved sequence position. In 3D, live clock edits retain submitted attacks and the score cursor, then adapt unscheduled deadlines to the shared grid without restarting. SIMD 303 applies the latest Swing at the next long/short beat-pair boundary, so dragging cannot jump backward and retrigger a sticker; sounding kernels and envelopes remain intact. Local restart controls still return that instrument's score to its first step without resetting the common beat.

The 3D continuous SIMD surface aligns to the shared clock without resetting its six synthesis kernels. Its clock phase is separate from its score position. Hyper Rubix recovers its next score note from scheduled musical timestamps even when visual callbacks are delayed. The native WebGPU 303 may wait one extra native pulse when rejoining to preserve its original phrase modulation and odd/even swing pairing; it retains every note and synthesis mapping.

## Transferable settings

Compatible settings transfer when edited, including edits made by native preset recall. Tempo and swing always follow the shared clock; other untouched native defaults are preserved. Values use the receiving instrument's existing controls and supported ranges. Unsupported puzzle orders retain their existing order; rectangular boards remain specific to Sliding Puzzle. No routine handoff applies a full preset or clears history.

| Settings | Native destinations |
| --- | --- |
| Tempo and swing | One shared clock for all dimensions |
| Output | All dimensions, when edited |
| Shared sound engine | All dimensions; every original sound bank also remains available |
| Decay | Sliding body decay, Rubix acid/shared-voice decay, Hyper body decay |
| Brightness | Sliding brightness, normalized Rubix cutoff, Hyper filter center |
| Pulse division and playback direction | Sliding and Hyper; quarter-note units converted explicitly |
| Position/pitch, filter, neighbor and disorder response | Sliding and Hyper native mappings |
| Stereo spread | Sliding and Hyper |
| Automatic moves and speed | Sliding and Rubix |
| Square puzzle order | All dimensions that support the edited order |

Specialized sequence methods, native bank identities, view rotations, topology networks, 303 surface presets, face/cell selections and their editors stay with their native instrument. A named native engine is never replaced by a similarly named generic sound. The host's parameter bindings are explicit in `src/instruments/rubixoids/shared-settings.js`.

## Sticker appearance

The app uses Rubix's six original finishes: white, yellow, green, blue, red and orange. Sliding tiles retain native animation and sound highlighting with dark backing and opaque inset faces, including an explicit orange tile style.

Hyper defaults to opaque, shaded faces of the original projected cubical stickers. Face-level depth sorting and back-face removal replace translucent overlapping hulls for this view. **Selected cell** exposes any boundary cell without obstruction; **Glass** restores the original translucent renderer. W+ and W− retain separate sticker/voice identities and visible marks while sharing white/yellow finishes. Appearance changes do not change the puzzle model, playback scope, sound or animation. The standalone Hyper page retains its original appearance.

The **Non-playing cubes** rotary control sets transparency from 0% (solid) to 100% (hidden). Its default mode fades cubes that are not currently sounding, using the existing scheduled note/tail cues. Sounding cubes keep their normal appearance; pausing restores the complete puzzle. The alternate **Outside playback scope** mode fades stickers excluded by the current sequence scope, including non-corners in Corner stream, even while paused. Parallel hyperbars include all cells. Fully hidden stickers are omitted from drawing and hit testing. The control supports mouse/touch dragging and native range keyboard operation, retains its setting between dimension switches, and never changes gates, gain, tempo or the sound engine.

## Output calibration

Sliding Puzzle now has fixed 2× makeup after its existing compressor, and Hyper Rubix has 3× makeup. Both reuse Rubix's existing soft peak curve. Hyper also has a final 0.9 peak guard to catch oversampling reconstruction peaks during dense passages without changing normal levels. Rubix's original 2.8× calibration and dynamics remain unchanged. Hyper's native Rattlesnake body and grains receive matching 6× source calibration, retaining their balance. These are fixed gains, independent of visibility, silence or preset changes; the performer output controls still reach zero.

The earlier volume-calibration investigation compared native pages with the former iframe host and found no host attenuation. Those measurements predate the direct-document migration and describe the retained DSP calibration, not a new measurement of the current mounting architecture. At the native defaults, mean meter RMS rose from approximately 0.023 to 0.045 in 2D (+6 dB) and 0.012 to 0.040 in 4D (+10 dB). A separate six-second, 48 kHz stereo PCM capture of the 4D default measured RMS 0.0172 → 0.0498 and peak 0.161 → 0.530. Native Rattlesnake presets gained roughly 16–18 dB. These are automated characterizations, not human listening judgments.

## Preset sequencing corrections

**One cell · Glass reply** uses the scoped serial engine, so its Y− selection actually limits the notes. **Corner stream** visits only real corner stickers, without inserting rests for edges, faces and centers. It has 8 notes for a selected cell, 32 for four view-facing cells, or 64 for the complete shape at every supported order. Editing its scope preserves the running musical position. Other native preset settings, including their existing output values, remain intact.

## Additional sound engines

The shared bank adds SIMD Chiptune, SIMD 303, SIMD Synth, Soft FM, Analog, Modal, Noise, Rattlesnake, Pitched Morph, Karplus Strong and Sine alongside existing native choices. The same additive bank is available in the other updated sequencers.

SIMD Chiptune is a quantized oscillator patch using the existing SIMD Synth WASM kernel; it is not a port of the WebGPU Chiptune score. SIMD 303 and SIMD Synth use their existing kernels. Scalar WASM/native fallbacks support browsers without SIMD. Buffers are prepared after explicit Audio arming; bounded voices schedule on AudioContext time independently of animation frames. These additions do not replace Rubix's native continuous SIMD surface or Hyper's WebGPU/topology instruments.

## Regression coverage

The frozen `tests/fixtures/rubixoids-owned-runtime.json` records the 26 copied runtime files and their original hashes. `tests/rubixoids-owned-runtime.test.mjs` reverses the recorded path relocations and explicit storage-key and shared-clock amendments to verify byte-for-byte preservation at migration without reading the current standalone sources. It also requires every owned runtime file in the release manifest. Subsequent intentional Rubixoids changes must update this proof explicitly; standalone edits never update it automatically.

The frozen `tests/fixtures/rubixoids-migration-inventory.json` records the controls, choices and preset identities carried into Rubixoids. Static and browser tests check that these capabilities remain available while allowing Rubixoids to add features and reorganize its UI. They do not require future equality with the standalone instruments. Static dependency checks reject imports or styles from standalone instrument implementations; source tests also verify mapping units and additive sound-engine behavior.

The direct-mount browser suites in `e2e/rubixoids.spec.mjs`, `e2e/rubixoids-polish.spec.mjs` and `e2e/rubixoids-recovery.spec.mjs` run with standalone instrument requests blocked, apart from the site MIDI adapter’s shared WAX routing helper, and check that no iframe or native HTML page is loaded, that the single masthead appears above the dimension selector, and that shared Audio/Play/output and MIDI follow the active instrument. They verify identical top-bar geometry across dimensions and reachable MIDI controls inside Settings. They also compare controls, voice choices and presets with the frozen migration inventory, measure intermediate 3D turns before model commit, retain undo and puzzle state through switches, recall exact 4D presets during playback, exercise pending engine changes, and inspect 4D opacity and scope behavior at desktop, phone portrait and phone landscape sizes. Audio measurements use the real page's shared output manager; inactive instruments are checked through their own context/scheduler diagnostics. The separate offline output-stage test checks the existing fixed gain and peak bounds. A deterministic between-note pause check verifies that complete 4D sticker visibility returns even when no animation frame was pending. Keyboard checks preserve each native instrument’s gestures and Audio/Play rules. A synthetic page-transition fixture checks cached-page parking, restoration of sound and puzzle history, and final teardown; it does not claim real browser back/forward-cache acceptance.

`e2e/rubixoids-owned-audio.spec.mjs` verifies that the copied 3D surface actually uses six SIMD voices and keeps rendering audible PCM during a 220 ms UI stall. It also checks the actual SIMD kernel and voice backends for Chiptune in all three dimensions, including finite output and no kernel failures. `e2e/rubixoids-standalone-isolation.spec.mjs` checks the reverse boundary: each standalone page retains native and Chiptune playback with all Rubixoids resources blocked. Saved-kit unit tests verify one-time seeding and independence from later standalone bank edits.

The shared-clock suites (`rubixoids-clock`, `rubixoids-hyper-clock` and `rubixoids-shared-clock-simd`) verify the common swung grid, audio-context handoffs, pause/resume, native subdivisions, live tempo and preset edits, delayed display callbacks, and SIMD alignment without kernel resets. Browser checks also verify the single clock panel, the full common tempo range, and beat/audio recovery after an attached context is suspended and resumed in every dimension.

These are automated mechanical checks. The earlier DSP characterization above and the current mounting regressions establish different evidence; neither constitutes a human listening or physical MIDI/touch-device pass.

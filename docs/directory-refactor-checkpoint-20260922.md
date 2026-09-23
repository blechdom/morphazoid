# Directory refactor checkpoint — September 22, 2026

## Scope and stopping point

This is the directory-only checkpoint before further preset authoring.
It is based on `9a45aa0`, retaining the incoming Audio/MIDI setup, stereo delay
inputs and Loopini. It changes source ownership paths, their consumers,
preservation tests and associated documentation—not DSP, presets or controls.

The earlier controller/style and 281-module moves are retained. This final
ownership pass moves three site metadata modules beside their registry and
controllers:

- `src/instrument-catalog.js` → `src/site/instrument-catalog.js`
- `src/instrument-midi-capabilities.js` → `src/site/instrument-midi-capabilities.js`
- `src/plugin-catalog.js` → `src/site/plugin-catalog.js`

The move map is `site-metadata-layout.json`. All nine affected runtime modules
reverse byte-for-byte to independent references read from Git at `9a45aa0`.
The original 430-module hierarchy fixture is unchanged; its existing exact
stereo-input amendments remain enforced.

The final tree audit also co-locates the fifteen modules formerly under
`src/starting-instruments/` with their existing controllers in
`src/families/starting-instruments/`. See `starting-family-layout.json`.
Seventeen runtime files (the package and two controllers) reverse byte-for-byte
to their pre-move references. The processor registration, DSP, native presets,
recording buffers, route semantics and five public pages are unchanged.
The existing copy-only manifest policies are retained; no WIP features or
presets are added.

## Remaining root ownership audit

There are no root `*-app.js` controllers. The public root scripts remain
`nav.js`, `wax-page.js` and `shader-synth-playground-bootstrap.js`; `style.css`
remains the global stylesheet. Public HTML and aliases keep their URLs.
Runtime assets, samples, model binaries and WASM stay in their existing trees.

The remaining 33 flat JavaScript modules are intentional boundaries:

| Boundary | Examples / reason retained |
| --- | --- |
| Shared audio lifecycle, gain, envelopes and inputs | `audio.js`, `audio-output-manager.js`, `audio-input-settings.js`, `adaptive-polyphony.js`, `amplitude-control.js` |
| Shared MIDI infrastructure | `midi-manager.js`, `browser-midi-adapter.js`, `midi-output-preview.js` |
| Shared geometry, articulation and mappings | `geometry.js`, `solid.js`, `hyper.js`, `playheads.js`, `mapping.js`, `articulation.js` |
| Shared synthesis/worklet APIs and decoding | Contour synthesis, physical sounds and `pcm-wav-decoder.js`; worklet URL loading is not represented by ordinary import counts |
| SIMD/WebGPU engine/toolchain boundary | Existing engine, processor, preset/state and worker modules; the nine AssemblyScript kernel/layout files also remain together |
| Retained external integration APIs | `ffmpeg-wasm.js` and `plugazoid.js`; no ordinary runtime import was found in the dependency report, but that is not authorization to remove or silently migrate them |

The executable root audit composes the earlier retained-module inventory with
the site moves and main's new shared input-settings module. A new flat module
therefore requires an explicit ownership review instead of silently undoing
the instrument/family layout.

## Preservation and verification

The release manifest retains the same copy/required policies for moved files.
WAX is regenerated from authored source, never hand-edited. Existing public
routes, metadata records, processor names, storage identities and all preset
content remain intact.

Browser harness repairs are included only to make preservation checks exercise
the intended controls:

- Navigation assertions target the Choose picker, not both Choose and Presets.
- Graph recall compares exactly against the independent browser factory to
  avoid Node/Chromium last-bit coordinate differences.
- Creaturazoid painting centers and hit-tests the lane before a real pointer
  stroke, avoiding the sticky mobile action bar; interpolation assertions are
  unchanged.

The exact directory-only candidate is verified separately from pending preset
queue/documentation work. Final results and the candidate tree are recorded
under `test-results/directory-checkpoint-20260922/`.

| Gate | Result |
| --- | --- |
| Metadata/root-boundary candidate | 4,069 Node checks passed, six skipped; WAX parity and production build passed |
| Broad browser preservation before family co-location | 402 passed, including Faves, all existing full presets, Shapes audio, I/O and all public routes |
| Family co-location focused Node checks | 40 passed |
| Final combined `npm run verify` | 4,071 passed, six skipped; syntax, SIMD, XYFlow and clean-build WAX parity passed |
| Final production build | Passed, including the 209-page WAX subtree |
| Final affected-family/all-route browser gate | 255 passed: recording/worklet lifecycle, loop-network controls, pointer/keyboard input, retained recordings and every public HTML route |

The family move does not change the broader Faves/runtime surfaces covered by
the 402-check gate. Five pending preset-queue tests remain outside this commit;
the root ownership audit and two family-layout tests are included.
All 26 new preservation references were independently checked against their
declared Git base. The original 430-module fixture remains untouched.

The first family WAX check caught a generated documentation copy omitted from
the staged candidate. The matching freshly generated file was included and
the complete repository gate rerun successfully; the initial failure remains
in `family-first-verify.log`. Final logs are `final-verify.log`,
`final-build-site.log` and `family-browser.log`. Nothing was hidden or waived.

No new listening, real microphone/MIDI-device or physical touch approval is
claimed. These checks establish mechanical preservation, not a new timbral
assessment. Preset authoring resumes only after this directory checkpoint.
Push and deployment are separate operations.

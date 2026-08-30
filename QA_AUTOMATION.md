# Morphazoid QA automation

This browser suite is the mechanical half of the Morphazoid quality process. It is designed to find regressions, inventory controls, and produce reviewable evidence. It does not replace the listening pass that decides whether an instrument is expressive, coherent, or enjoyable.

The route inventory is generated from the same catalogue and navigation data used by the site. At the time this document was written it contains 138 source HTML pages, including 116 catalogue instruments: 74 primary instruments and 42 works in progress.

## Setup and commands

Install the JavaScript dependencies and Playwright's Chromium build:

```sh
npm install
npx playwright install chromium
```

If a managed machine already has Chrome but cannot install Playwright's browser, point the configuration at that executable:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:browser:smoke
```

The Playwright configuration starts a local server on `127.0.0.1:3435`; a separate development server is not required.

| Command | Purpose |
| --- | --- |
| `npm run test:browser` | Run the complete browser suite. |
| `npm run test:browser:smoke` | Load every source HTML route and report page, console, request, and first-party HTTP errors. |
| `npm run test:browser:midi` | Run the virtual Web MIDI capability and representative message-path contracts. |
| `npm run test:browser:audio` | Run the initial real-browser Web Audio signal, clipping, and cleanup probes. |
| `npm run test:browser:audit` | Run control inventory, shared consistency, responsive-layout, and accessibility audits. |
| `npm test` | Run the existing Node test suite; this command is unchanged. |
| `npm run verify` | Run the existing source, Node-test, and WAX-distribution verification; this command is unchanged. |

Useful strict audit modes are opt-in while existing findings are triaged:

```sh
E2E_STRICT_A11Y=1 npm run test:browser:audit
E2E_STRICT_CONTROLS=1 npm run test:browser:audit
E2E_STRICT_A11Y=1 E2E_STRICT_CONTROLS=1 npm run test:browser:audit
```

Failures retain screenshots, video, and traces under `test-results/playwright/`. The HTML report is written to `playwright-report/` and can be opened with:

```sh
npx playwright show-report
```

## Present coverage matrix

Counts below describe the current repository and will change automatically as catalogue entries or HTML pages are added.

| Area | Scope | Automated contract | Important boundary |
| --- | ---: | --- | --- |
| Route smoke | 138 HTML pages | Successful document response, visible body, title, language, and no page/console/first-party request or HTTP errors | Does not interact deeply with each page |
| Shared consistency | 116 catalogue instruments | Shared Audio control exists and starts off; standard navigation/mobile pickers hydrate to the active instrument; the intentional Morphazoidical custom header is an explicit contract | Does not judge detailed visual style or musical consistency |
| Responsive reachability | 138 HTML pages × 3 layouts | Desktop `1440×900`, phone portrait `390×844`, and phone landscape `844×390`; viewport metadata, horizontal overflow, clipped/fixed interactive controls | Does not prove touch gestures feel good or that visual hierarchy is attractive |
| Accessibility | 74 primary instruments | axe reports for WCAG 2 A/AA, 2.1 A/AA, and 2.2 AA; critical/serious failures can be gated in strict mode | Automated rules do not replace keyboard, focus, screen-reader, or cognitive review |
| Control inventory | 74 primary instruments | Duplicate IDs, finite range bounds, nonempty selects, control metadata, and min/mid/max range assignment with restoration | Generic range exercise proves DOM mathematics, not that the mapping is musically correct |
| MIDI requirements | 116 catalogue instruments | Exactly one required-capability record per route, native/shared ownership, note policy, keyboard policy, and explicit output classification | The declaration is an intent inventory, not proof that every route currently implements it |
| MIDI behavior | 2 representative instruments | Native and public-event note paths, note-off, standard/semantic CC, 24-PPQN clock, Start, and Stop | Real controllers, device latency, every route-specific map, and every transport message still need targeted coverage |
| Web Audio behavior | 2 representative instruments, 3 contracts | Audio begins inactive, produces finite non-silent output, remains below clipping, reaches sustained silence after stop, and proves Karplus Strong's output slider changes the measured signal | It does not yet compare timbre with a previous release or judge sound quality |

The reports are intentionally useful before every optional strict gate is enabled. Review the attached control and accessibility JSON, fix or explicitly disposition existing findings, then enable strict mode so the accepted state cannot regress.

## First characterization findings

The calibrated first run distinguishes application defects from harness noise. It currently reports three concrete polish items:

- `shepard-risset.html` throws in `shepard-risset-app.js` because the script binds `[data-reset-all]` even though that element is absent.
- `shader-synth-playground.html` places five patch-port buttons beyond the `844×390` phone-landscape viewport.
- `image-to-instrument-3.html` uses `tongueOut` for both an `<output>` and an `<input>`, creating an ambiguous duplicate DOM ID.

These are deliberately not allowlisted. The relevant browser commands remain red until the pages are fixed, then become regression gates without changing the tests. Vector Flight is not a defect: browser automation uses its existing `?manual=1` deterministic rendering hook so a continuous canvas loop cannot starve headless test execution.

## MIDI contracts

`e2e/helpers/fake-midi.mjs` installs a standards-shaped `navigator.requestMIDIAccess()` before page code runs. It supplies virtual inputs, state changes, timestamped `midimessage` events, optional outputs, and sent-message logs. The page therefore uses its normal MIDI manager and public browser adapter; tests do not call private instrument functions.

The requirement declaration covers all 116 catalogue instruments and currently says that every instrument must accept MIDI input. Its classification contains seven native mappings and 109 intended shared `universal-control` mappings. Each instrument also declares one of four note policies (`processor`, `drums`, `pitched`, or `sequence`), keyboard ownership, and whether MIDI output applies.

That declaration is desired coverage, not evidence that the feature exists. Current behavior may bootstrap the detailed mapping contract only where MIDI is actually implemented and verified. If a page should handle notes, CC, clock, or transport but does not, the requirement remains in place and the missing behavior stays an implementation gap; absence must never be captured as the accepted baseline.

Maintain two separate MIDI records:

1. **Requirement:** what each page is supposed to support, including explicit `notApplicable` reasons for message families that do not fit the instrument.
2. **Verified behavior:** the exact mapping proved by a focused browser test, or `missing`/`untested` until that test exists.

An intentional implementation change updates its reviewed behavior contract. A discovered bug does not automatically update the contract: fix the implementation when it violates the intended mapping, or revise both requirement and test only when the desired product behavior has deliberately changed.

The focused behavior tests establish these contracts:

| Message family | Contract | Current evidence |
| --- | --- | --- |
| Note-on | Preserve note and velocity and reach the route's intended note action | Recursive FM reports `C4` and velocity through its native client; Graph Synth receives a note through the public `morphazoid:midi-input` event and launches a graph pulse |
| Note-off | Release a gated voice or publish the release without applying an unsafe generic global stop | Recursive FM reports the matching release; Graph Synth is explicitly annotated as one-shot, so no fabricated gate assertion is made |
| CC | Preserve controller/value and apply either an exact native semantic or a safe shared semantic mapping | Recursive FM maps CC72 to release; Graph Synth maps standard CC7 to its output level |
| Timing clock | Treat MIDI clock as 24 pulses per quarter note and update an explicit tempo control from stable timestamps | Thirty-two deterministic pulses at 120 BPM update Graph Synth to 120 BPM without relying on real-time sleeps |
| Transport | Start prepares audio and starts an explicit primary transport; Stop resets clock tracking and stops it | Graph Synth's primary transport is asserted on Start and off on Stop |

`Continue`, song position, pitch bend, pressure, program changes, panic CCs, MIDI output, and individual native maps should get focused route contracts before they are described as release-gated. The helper can generate several of these messages, but helper capability alone is not product coverage.

Virtual MIDI proves parsing, routing, UI state, and deterministic mapping. A release still needs a short real-hardware pass for device discovery, reconnect behavior, controller profiles, velocity feel, clock jitter, transport interoperability, stuck-note recovery, and end-to-end latency.

## Web Audio: Playwright or Puppeteer?

Puppeteer can test Web Audio because it can drive Chrome and execute `AudioContext` or `OfflineAudioContext` code in the page. There is no separate “Puppeteer for Web Audio” product. Playwright provides the same browser-page access while also providing the route fixtures, device emulation, traces, screenshots, permissions, parallel projects, and optional Firefox/WebKit coverage already used here, so a second Puppeteer harness would duplicate infrastructure.

For Web Audio assertions, prefer stable application-level seams:

- `src/audio-output-manager.js` for active state, stereo RMS/peak, clipping, and connection cleanup.
- `OfflineAudioContext` for deterministic DSP renders that do not depend on speakers or wall-clock scheduling.
- Known presets, seeds, note messages, sample rates, render lengths, and input fixtures.
- Chromium-only baselines initially. Browser audio engines can differ slightly, so do not share sample-exact thresholds across engines without separate approval.

Chrome DevTools Protocol can be reached through Playwright when a Chromium-only diagnostic is genuinely needed. It should not become the primary contract: internal Web Audio diagnostics are less stable than instrument output metrics. Headless output also cannot prove speaker routing, acoustic level, controller latency, microphone feedback safety, or subjective sound quality.

## Previous-version audio: two-stage approved baselines

Raw waveform snapshots are often too brittle: harmless browser, scheduling, or floating-point changes can alter samples while sounding identical. Conversely, two signals can have similar peaks while sounding substantially different. Previous-version comparison should therefore be introduced in two deliberate stages.

### Stage 1: characterize and approve the reference

1. Archive the currently published production site before replacing it: record its URL and capture time, preserve the exact built assets, and store response/content hashes so later deployments cannot silently move the reference. Link the archive to its source commit when that commit can be identified. Also record the browser build, operating system, sample rate, channel count, and renderer version.
2. Give each covered instrument a deterministic scene: preset, seed, initial state, input fixture, MIDI/gesture sequence, render duration, and warm-up time.
3. Prefer `OfflineAudioContext`. For features that cannot render offline, capture through the shared output manager using fixed event timestamps and a bounded observation window.
4. Store compact analysis JSON for each scene: duration, silence, finite samples, peak, RMS, crest factor, onset times, envelope/tail measurements, coarse spectral bands or centroid, fundamental pitch where meaningful, and stereo balance/correlation.
5. Keep a short WAV reference only when reviewers need A/B listening. Large WAVs can live in release artifacts or dedicated fixture storage while the approved metrics and provenance remain versioned.
6. Have a human listen to the reference, inspect the metrics, and explicitly approve it. A merely current render is not automatically a good baseline.

Stage 1 is characterization. Drift should be reported and attached, not used to mass-update expected files or block every change before the references have been reviewed.

### Stage 2: enforce candidate comparisons

1. Render the same scene from the candidate build in the same pinned environment.
2. Always fail on non-finite samples, unexpected silence, clipping, missing events, runaway duration, channel loss, or failed cleanup.
3. Align captures by their declared trigger or measured onset before comparing them. Do not treat startup latency as timbral difference unless latency is itself the contract.
4. Use tight sample or impulse-response tolerances only for truly deterministic DSP. Use approved feature tolerances for oscillators, realtime schedulers, noise, convolution, and browser-dependent rendering.
5. Report per-metric deltas and attach candidate/reference audio for meaningful drift. A single opaque similarity score is insufficient for diagnosis.
6. Updating an approved baseline requires an intentional review: explain the sound change, listen A/B, approve the new artifact, and retain its provenance. Never make “update all snapshots” the default response to failures.

Baseline lanes can be expanded in this order: the 15 Faves, the rest of the 74 primary instruments, then promoted works in progress. This produces a trustworthy standard before multiplying fixtures.

## Declarative sonic-slider contracts

The generic control inventory already answers “can this range accept bounded min/mid/max values and return to its original value?” It cannot answer “does this slider implement the intended curve or produce the intended sonic result?” Add that layer with a small reviewed manifest per control, rather than guessing semantics from labels.

A proposed contract shape is:

```js
{
  id: "recursive-fm.release",
  route: "recursive-fm.html",
  setup: {
    preset: "factory-default",
    seed: 17,
    sampleRate: 48000,
    trigger: { type: "midi-note", note: 60, velocity: 100, gateMs: 180 }
  },
  control: "#ampReleaseMs",
  points: [0, 0.5, 1],
  mathematical: {
    curve: "exponential",
    physicalRange: [2, 10000],
    unit: "ms",
    relativeTolerance: 0.01,
    monotonic: "increasing"
  },
  sonic: [
    { metric: "decayT60Ms", relation: "increasing", minimumSpread: 4 },
    { metric: "peak", maximum: 0.98 },
    { metric: "finiteSamples", equals: true }
  ]
}
```

Each contract should specify:

- A deterministic setup and trigger, so another control or random seed cannot dominate the result.
- The normalized UI domain and intended physical mapping: linear, logarithmic, exponential, stepped, bipolar, enumerated, or custom.
- Expected readout units and tolerances where the displayed value is part of the promise.
- A sonic relation rather than an arbitrary exact waveform: pitch raises fundamental frequency, cutoff raises spectral centroid, release lengthens the tail, gain raises RMS, pan moves channel balance, tempo shortens event intervals, and resonance increases energy near the cutoff.
- Safety invariants at every sampled point: finite output, bounded peak, no runaway nodes, and clean stop.
- An explicit `notApplicable` reason for controls with no isolated sonic meaning. Geometry, seed, topology, and preset controls may need structural or event-sequence contracts instead.

Start with one or two identity-defining controls on each Fave. Require both the mathematical mapping and the sonic relation to pass before expanding to secondary controls. If a slider cannot be described with a stable expectation, that is a design-review signal—not a reason to create a vague snapshot.

## Manual release boundary

Automation should leave the release pass focused on what browsers cannot decide:

- Musical identity, sweet spots, expressive range, and fatigue.
- Whether labels and mappings match what a musician hears.
- Touch and controller feel on physical devices.
- Real MIDI, microphone, camera, multichannel, and audio-device behavior.
- Keyboard focus order, visible focus, screen-reader narration, and permission-denial recovery.
- Intentional A/B approval for any baseline audio change.

When automation finds a defect, fix the failed contract. When testing inspires a new feature, put it in the feature parking lot and keep the current polish cycle closed.

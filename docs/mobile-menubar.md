# Shared mobile menubar — October 18, 2026

Started from freshly fetched `origin/main` **aacc4c90**, in an isolated worktree;
rebased onto fresh main **485a1a2c** for publication. The independent Hybrinx,
BLECH and Rezoidinator changes remain intact.
This supersedes the earlier wrapped masthead / mic-beside-presets mobile layout.
Desktop markup, controls, sound, presets, routes and permission gestures remain
instrument-owned and unchanged.

## Contract and implementation

For phone portrait (≤720px) and short phone landscape (≤960px wide and ≤560px
high), show one row:

**home icon → Choose chevron → flexible space → Record → stereo meters →
volume knob → Audio → Settings**.

The wordmark text and next-instrument button are hidden only on mobile. Choose
still opens the existing searchable, categorized instrument selector. Record's
elapsed clock stays inside its slot so starting a recording never widens the bar.
Audio remains 48×48 CSS pixels, including at 320px. Record, volume and Settings
narrow from 48px to 40px below 361px; the home icon and chevron have compact slots.
Both popups are constrained to the viewport below the menubar. Keep the extra
8px spacing before Audio: it prevents touch browsers from retargeting a volume
knob edge gesture to the Audio button.

Mic, input gain and other extra header controls move into **Settings → Instrument
controls**. Moving an existing node preserves listeners, values and audio/device
ownership. Desktop insertion markers restore the original order; focused controls
retain focus (opening Settings if needed). Removed controls are not resurrected.
Input-error Retry/Dismiss stays inside Settings and closes with its disclosure.
Preset selectors remain in the control panel and are not moved into Settings.

The shared implementation is `src/site/mobile-menubar.js` and `.css`, installed
by `nav.js` and imported by `style.css`. It enhances existing authored mastheads;
**the site does not yet have a single shared header-markup component**. Structural
observers handle asynchronously assembled native headers and added controls,
without walking the header for every meter/MIDI activity update. Initialization
is idempotent and teardown releases observers/listeners and restores nodes.
`src/audio-input-control.js` uses the same breakpoint and Settings host.

No new gain stage, Audio activation, MIDI manager, recorder, transport, or fake
volume control is introduced. A page without a core control does not acquire an
invented one just to look uniform. WAX/native audio ownership remains unchanged.
`mobile-menubar-runtime-changes.json` records the exact additive navigation hooks,
stylesheet import and runtime paths;
independent historical hashes are retained.

## Site-wide inventory and follow-up links

At this revision the canonical page manifest contains **206 pages**: **203** use
shared-style navigation and receive this presentation layer. **196** have the
standard performance-header class. These counts are an audit snapshot, not a
registry cardinality contract. The browser suite derives routes from the manifest.

### Independent headers (not migrated)

| Page | Current ownership / follow-up |
| --- | --- |
| [Chaotic DSP reference](../chaotic-dsp-reference.html) | Custom reference header; does not use shared navigation. |
| [WebGPU DSP primitives](../webgpu-dsp-primitives.html) | Custom atlas header; does not use shared navigation. |
| [Synthesaurus reference](../synthesaurus-reference.html) | Reference document without a masthead. |

### Partially shared instruments (compact presentation works; deeper refactor remains)

| Instrument | Remaining difference |
| --- | --- |
| [L-system Delay Rust](../l-mic-rust.html) | Native controller assembles picker/audio/Settings from shared primitives; not the automatic browser-audio header path. |
| [L-system experiments](../l-system-experiments.html) | Native-owned assembly as above. |
| [L-system parametric lab](../l-system-parametric-lab.html) | Native-owned assembly as above. |
| [Fractal Delay](../fractal-delay.html) | Shared navigation and audio primitives, but no Settings menu. Existing input-control fallback remains; Settings needs a deliberate follow-up migration. |
| [Strophe Lab](../birdsong-lab.html) | Shared navigation; custom master slider and no header Audio button. The existing slider moves into mobile Settings, rather than inventing audio behavior or a new master control. |

Synthesaurus **does** use shared header navigation. Its explicitly panel-owned
input strip stays beside its Input category, not in the header; select **Mic /
audio in** to expose it. Settings' diagnostic input likewise stays in its test
panel. Sound Fonts imports navigation indirectly and **is not** an exception.
Catalogue, architecture, collaboration/room and informational pages use compact
shared navigation without being forced to acquire an instrument audio toolbar.

## Mechanical verification

See `e2e/mobile-menubar.spec.mjs`, `e2e/performance-toolbar.spec.mjs`,
`e2e/audio-input-placement.spec.mjs` and `e2e/output-recording.spec.mjs`.
The mobile matrix is 390×844, 844×390 and 320×568, with desktop restoration at
1440×900. Coverage includes searchable navigation, control order/overlap, popup
bounds, focus, node identity/events, dynamic teardown, MIDI CC after rotation,
permission-denied popups with and without Popover API, live capture continuity,
and the active recording clock.

The broad menubar matrix disables Playwright video capture: on this runner,
desktop Vector Flight stalls its frame loop with capture enabled, on both
unchanged main and this checkout. Screenshot/trace evidence and all layout
assertions remain enabled. Other focused suites retain their normal videos.

Initial pre-rebase browser results: **483/500 passed** in the combined matrix. All **210** new
menubar checks passed including the isolated Plasma Ball rerun (one timeout in
the busy combined run). Gesticules had one aborted model request and passed all
three viewports on rerun. The remaining **15** toolbar failures reproduce with
unchanged main: preset-first-row assertions for L-system Delay Rust, the two
native L-system labs and Graphonic Calculator, plus Fractal Delay's absent
Settings control, at three viewports. These tests were not weakened.

All input placement/error/live-capture tests and output recording tests passed.
The direct-entry audit found no page errors, no horizontal overflow at 390px,
and no lost Audio buttons across all 206 pages. Screenshots were inspected at
320px portrait and 844px landscape. Desktop-only fallback-brand styling and
late output-host replacement have additional focused coverage.

Initial pre-rebase `npm run verify` passed: **8,681 tests passed, six skipped**, with runtime/WASM
checks, deterministic XYFlow and clean-build WAX parity passing. After recording
these results, the documentation-only artifact refresh also runs through
`npm run build:wax` and `npm run check:wax-dist`. Local screenshots, baseline
inventory and logs are under ignored `test-results/mobile-menubar/`; they do not
accompany a fresh clone. The tracked tests and this report do.

Physical phones, mobile Safari, actual microphone/MIDI hardware and human
listening remain untested. Mechanical checks are not a claim of perceptual or
touch-device acceptance.

## Audio/Settings alignment follow-up

The desktop-pointer mobile layout inherited a 44px Settings disclosure around a
48px trigger, placing the button 2px below Audio. Both the disclosure and trigger
now use the 48px mobile height; the trigger is block-level flex so inline text
baselines cannot add an offset. Tests compare exact top/bottom edges, rather
than allowing a 2px centerline discrepancy, with coarse and fine pointers,
Settings open and closed, at 320px, 390px and phone landscape widths.

All eight targeted alignment checks passed before integration. Rebase preservation
guards reverse the independently reviewed mobile and Rezoidinator additions
without changing either frozen baseline or accepting unrelated source drift.

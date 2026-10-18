# Hybrinx mobile layout

At widths up to 980 CSS pixels, the existing masthead, compact graphic and
Play/Loop controls stay visible. The graphic/transport pane uses no more than
half the available workspace (and no more than 44% of the viewport height).
There is no mobile resize handle. On short landscape screens, Play and Loop sit
beside the graphic instead of taking height away from it.

The main preset row, editable timeline and remaining controls share one vertical
scrolling panel. Presets are not sticky. Timeline lanes expand vertically while
retaining horizontal scrolling; their menus remain reachable within the compact
layout. The tongue-pattern menu fits within the graphic.

The responsive layout moves the original DOM nodes, not copies. Returning to
desktop restores the existing splitter, timeline and transport positions without
resetting edits, Play/Loop, Audio or output level. No synthesis or audio scheduling
code changes are involved.

## Regression checks

- `node --test tests/hybrinx*.test.mjs tests/module-hierarchy.test.mjs`
- `npx playwright test e2e/hybrinx-mobile.spec.mjs --workers=1`

The browser suite covers source and generated WAX at 390×844, 844×390 and
320×568, native touch scrolling, non-overlapping controls, menu reachability,
Audio/transport separation, non-silent looping output and Stop silence. Desktop
round trips check splitter size, edited timeline state and DOM identity.

Browser emulation does not establish physical-phone touch feel, Safari behavior
or speaker quality. Those remain device checks.

The exact layout-controller amendment is recorded separately in
`hybrinx-mobile-runtime-changes.json`; the historical relocation hashes are
unchanged.

### Mechanical verification — 2026-10-18

- Focused Hybrinx/module tests: 49 passed.
- Source/WAX browser gate: 32 passed across `hybrinx-mobile`,
  `hybrinx-preset-loop`, `hybrinx-preset-volume-meter`, responsive and shared
  consistency suites (filtered to Hybrinx).
- `npm run verify`: passed; 8,681 Node tests passed, 6 skipped, no failures;
  runtime/WASM checks, XYFlow determinism and clean-build WAX parity passed.
- `npm run build:wax`: passed. Served Hybrinx HTML, layout JavaScript and CSS
  matched the source and generated WAX files byte-for-byte.
- `npm run build:site`: passed. Release portrait/landscape smoke checks passed;
  served artifacts matched the build, runtime files matched source, and the
  bundled WAX copy matched `dist-wax`. The release HTML differed from source
  only by the builder's expected social-preview metadata.
- Additional live-audio orientation pass: desktop → portrait → landscape →
  small phone → desktop retained Play/Loop, finite non-silent output and zero
  clipped samples. Reviewed screenshots at the three phone sizes.

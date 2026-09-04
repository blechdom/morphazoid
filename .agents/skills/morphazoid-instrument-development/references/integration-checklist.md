# Instrument integration checklist

Use this checklist when an instrument is added, consolidated, renamed, promoted,
or removed. Mark items not applicable with a reason rather than silently
omitting them.

## Source surface

- Page HTML, page stylesheet, application entry point, and pure model module.
- Optional audio engine, AudioWorklet processor, transport model, renderer, or
  device adapter.
- Native labelled controls, `<output>` elements, accessible Canvas fallback,
  primary transport marker, reset marker, and authored no-JS navigation.
- Explicit Audio arm separate from transport and lazy Web Audio creation,
  preserving the documented explicit MIDI-enable and WAX-host boundaries.
- Shared output-manager connection plus idempotent teardown.

## Discovery and capability records

- `nav.js`: canonical tool ID, label, href/page slug, primary group, order,
  fallback desktop/mobile nav, and Fave status only when requested. Membership
  in the `experiments` group derives Works-in-progress status.
- `src/instrument-catalog.js`: factual kind, description, start action, base
  features, optional plug-in link, and `ADDITIONAL_TAG_IDS` entries only for
  intentional secondary catalogue groups.
- `src/instrument-midi-capabilities.js`: exactly one `NOTE_MODE_IDS` policy
  (`processor`, `drums`, `pitched`, or `sequence`) plus every applicable native
  client, page/no-generic keyboard, audio-input, processor-starts-audio, and
  MIDI-output inclusion or exclusion. Check the derived `midiInputMode`,
  `computerKeyboardMode`, `audioInput`, `startsAudio`, and `midiOutput` values;
  do not rely on their defaults without review.
- `assets/instruments/<tool-id>.webp` or the explicitly configured icon path.
  The catalogue tests require a real RIFF/WEBP asset larger than a placeholder.
  Default new artwork to a square 512x512 WebP, matching the dominant catalogue
  convention. Capture or compose a representative instrument state with a
  legible central silhouette at card size; avoid tiny controls or explanatory
  text. Inspect the actual catalogue card on desktop and phone and record source
  provenance for non-procedural artwork.
- Update the new page's authored fallback navigation and any sibling whose
  static previous/next or option list must include the route. JavaScript
  enhancement is not a substitute for the no-JS contract.
- README/research/source/license records and `THIRD_PARTY_NOTICES.md` when the
  instrument introduces claims or third-party material.

## Build and release surface

- `scripts/build-site.sh` copies tracked runtime files. Confirm the clean output
  contains every dependency; do not assume that a brand-new untracked file was
  copied. Stage/track it before building or update an explicit curated list only
  when that list's contract actually requires the file.
- Route inventory is derived from source HTML, navigation, and catalogue data.
  Update focused deployment assertions only when their contract requires it;
  do not maintain a second hand-written global route list.
- Treat source files as canonical. Run `npm run build:wax`; never edit generated
  `dist-wax` files by hand.
- Run `npm run verify` after regeneration to prove committed WAX parity.
- Use `npm run build:deploy` when the full site/Storybook deployment artifact is
  part of the requested release.

## Tests

- Pure model: reproducibility under fixed seeds/fixtures, immutability where
  expected, hostile input clamping, finite results, semantic relationships, and
  declared resource limits.
- Page/app: required markup, control-to-state/DSP wiring, default/reset/preset
  behavior, teardown, and the intended audio/transport separation.
- Browser: route diagnostics, Audio-off primary transport, finite/non-silent
  output after explicit Audio arm, clipping, release to silence, parameter
  sensitivity, state transitions, pointer/keyboard/touch behavior, and console
  or request failures.
- Shared suites as applicable:

  ```sh
  npm run verify
  npm run test:browser:smoke
  npm run test:browser:audio
  npm run test:browser:midi
  npm run test:browser:audit
  ```

`npm run verify` covers syntax, Node tests, and WAX parity; it does not run the
Playwright browser suite.

## Preview and publication

- Start with `npm run dev` only when an interactive preview is needed. Verify
  the endpoint and report its exact URL and worktree.
- Before an authorized push, review the scoped diff, status, commit, and current
  remote tip. Do not sweep unrelated worktree changes into the commit.
- After an authorized deployment, verify the public page and a distinctive
  content signature. Account for CDN/browser caching; do not infer publication
  solely from a successful push or pipeline.

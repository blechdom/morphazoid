# Shared SoundFont utility

The modules in `src/sound-fonts/` let an instrument choose a bundled bank,
import SF2/SF3, or use a font saved or created on `/sound-fonts.html`.
Midiophilia's MIDI Mixer and Blech MIDI already use the shared picker. Their
existing sequencers, MIDI routing, synthesis controls and transport remain
owned by those instruments.

## Contract

1. Choose or import a bank. Fetch bytes lazily; verify bundled size and SHA-256.
2. Let the instrument load the bytes, preserving the previous bank on failure.
3. Save accepted bytes to the shared browser library.
4. Enable Audio explicitly, then send notes or start the instrument's transport.

Choosing a bank never creates or resumes an AudioContext. Audio and transport
remain separate. The picker serializes engine commits and ignores stale
selections; load failures report the retained bank. Dispose controls when the
instrument is destroyed. Use `stopAll()` when hiding a page or losing focus.

The limit is 128 MiB per SF2/SF3 file. ZIP archives must be extracted first.
Files remain in IndexedDB (`morphazoid-sound-fonts-v1`) on the same origin;
other hosts, ports, browsers and devices have separate libraries. Clearing
site data removes saved files. Download fonts for backup. Storage failures
allow session playback and display a warning. BroadcastChannel notifications
refresh other open pickers; the Refresh library button also reloads the list.

## Add the picker to an instrument with its own SoundFont engine

```js
import { mountSoundFontChooser } from './src/sound-fonts/chooser.js';

const chooser = mountSoundFontChooser(document.querySelector('#fontControls'), {
  fileInput: document.querySelector('#fontFile'), // accept=".sf2,.sf3"
  defaultButton: document.querySelector('#defaultFont'),
  async onLoad({ bytes, name, format }) {
    // Resolve only after the engine accepts the bank. Throw on failure.
    // This method must preserve the instrument's current Audio state.
    await engine.loadSoundFont(bytes, name);
  },
});
// On teardown:
// chooser.dispose();
```

The returned object provides `refresh()`, `select(id)` and `dispose()`.
Built-in IDs use `bundled-${catalogId}`, such as `bundled-generaluser-gs`.
Pass a unique `id` option if mounting multiple pickers on one page. The picker
uses Morphazoid's existing searchable Choose control.

For a custom UI, `createSoundFontService()` in `bank-service.js` provides
`catalog()`, `list()`, `resolve(id, { signal })`, `importFile(file, { signal })`,
`save(result)`, `subscribe(listener)`, `persistent()` and `dispose()`.
`resolve` and `importFile` return `{ bytes, name, format, id, entry }` without
saving. Call `save(result)` after the consuming engine accepts it. Await
`subscribe` to receive an unsubscribe function. `inspectSoundFont(bytes)`
reads preset metadata without allocating decoded audio; it is not a substitute
for full engine validation.

## Add playback to another instrument

`SoundFontPlayer` wraps the pinned SpessaSynth engine in an AudioWorklet. It
supports SF2 and compressed SF3, their sample loops, envelopes, modulators,
filters and effects. It accepts the instrument's own AudioContext and output
node, so it can feed existing effects and the shared output manager.

```js
import { SoundFontPlayer } from './src/sound-fonts/player.js';

// Create/resume context inside the instrument's explicit Audio gesture.
const player = new SoundFontPlayer(context, instrumentOutput, {
  onError: error => showError(error.message),
});
await player.load(bytes);
player.setPreset({ bank: 0, program: 0 }); // raw SoundFont bank, zero-based program
player.noteOn(60, 0.75);                 // MIDI key, normalized velocity
player.noteOff(60);
player.stopAll();                       // also fades effect tails
// On teardown:
player.dispose();
```

This adapter is a single-preset player; use an instrument's multichannel engine
for full MIDI arrangements. It bounds synthesis to 64 voices, holds notes for
at most 15 seconds, and guards output against nonfinite values and peaks above
0.98. `load` commits only a successfully prepared bank; superseded loads reject
with `AbortError`. It never owns, starts, suspends or closes the supplied context.
The Sound Fonts page uses this adapter. Its original PCM preview path remains
available for in-memory samples without an encoded bank.

Register consumers and new public dependencies in `scripts/site/runtime-files.tsv`.
The shared processor imports the existing pinned vendor bundle at
`src/instruments/midi-mixer/vendor/spessasynth-core.js`; include its notices.

## Verification

```sh
node --test tests/sound-font-{service,player,gm-banks}.test.mjs
npx playwright test e2e/sound-font-shared.spec.mjs
```

The suites check file integrity, GM programs and percussion, real SF2/SF3
playback, explicit Audio arming, created-font sharing between instruments,
import failures, selection races, and responsive pickers. Measured signals
verify functioning audio; they do not establish subjective sound quality.

# Morphazoid WAX host contract v1

This contract defines the boundary between the canonical Morphazoid browser site
and the separate **Morphazoid for WAX** web artifact. WAX is the AudioFusion
VST3/AU browser host; this artifact is a WAX-integrated build of Morphazoid, not
a new native plug-in binary.

## Artifact boundary

- The normal browser artifact remains the canonical Morphazoid site.
- The WAX artifact is built and published separately, with its own immutable,
  versioned URL or local bundle.
- The WAX build may reuse the normal HTML, JavaScript, worklets, styles, and
  assets, but it adds the host bootstrap only while producing the WAX artifact.
  Shared app modules may contain dormant adapter hooks; without that namespace,
  they return immediately and have no browser behavior.
- The normal browser artifact must not load the WAX bootstrap or declare WAX
  callbacks as a side effect of this integration.
- A WAX artifact opened in an ordinary browser must still fail open: the page
  runs as normal Morphazoid, while host-only MIDI activation, transport, state,
  and playhead behavior remain inactive.
- A project must target an immutable release such as `/wax/1.0.0/`, not a live
  development or mutable site root. Saved DAW projects must not silently change
  behavior when the browser site is updated.

The WAX artifact does not copy or depend on `morphazoid-v2`.

## Building the artifact

Run the separate release build from the active Morphazoid repository:

```sh
npm run build:wax
```

This first creates the normal static release in `dist-wax/`, then adds
`wax/wax-host-bootstrap.js`, `wax/wax-host-bridge.js`, the WAX-only universal
MIDI adapter and its stylesheet, one early bootstrap tag, and one late module
tag to every copied HTML page. It does not edit any source HTML. An explicit
output path is also supported for release automation:

```sh
node scripts/build-wax-site.mjs /tmp/morphazoid-wax-build
```

Load the resulting `index.html` tree as a WAX custom page or publish the whole
directory at one immutable HTTPS URL. The directory structure must stay intact
because Morphazoid uses relative ES modules, AudioWorklet modules, fetches, and
assets. A production deployment step is deliberately outside this v1 contract.

## Instrument adapters

Chaotic FM is the v1 pilot adapter. It registers `chaotic-fm` only when the WAX
artifact has installed `window.MorphazoidWAX`. After the bridge positively
detects WAX, the adapter restores and saves synthesis/performance controls,
enables the existing shared MIDI manager, and starts its audio engine in MIDI
mode. It does not persist held notes, expression, sustain, pitch-bend position,
audio objects, or the transient Audio button state.

Every catalog instrument also receives an artifact-only universal adapter. It
auto-enables the same shared MIDI manager after positive WAX detection, persists
only its routing controls, follows host play/stop/BPM/PPQ where the page exposes
a matching transport, and provides conservative note, CC, bend, program, and
pressure fallbacks through the page's existing controls. Pages with a native
MIDI client retain that implementation; the fallback does not double-trigger
their note, CC, or bend messages. A cancelable `morphazoid:midi-input` event is
the handoff for future page-specific mappings.

Selected rhythmic, geometric, and algorithmic pages expose a deterministic
companion sequence in Audio, MIDI only, or Audio + MIDI mode. Host PPQ drives a
short timestamped MIDI lookahead, and stop, seek, loop, output change, page
hide, and panic clear queued events and send channel panic messages. This is a
broad first pass, not a claim that each fallback exactly mirrors the page's
native audio-event stream; page-specific adapters replace it as their event
semantics are validated.

WAX Instrument, WAX Audio FX, and WAX MIDI FX are separate fixed DAW I/O roles.
They can load the same page URL, but changing the page's output-mode control
does not change the scanned plug-in's bus topology. The per-instrument guide on
`wax.html` records the recommended and compatible roles.

## Bootstrap timing and host detection

The WAX bootstrap is a small classic script loaded synchronously before page
modules. It must define these host callbacks early, as required by WAX:

```js
window.WAX_Play = function () {};
window.WAX_Stop = function () {};
window.WAX_BPM = function (bpm) {};
```

The callbacks retain the latest host play state and valid BPM until a page
adapter registers. If a callback already existed, the bootstrap must preserve
and safely invoke it. One failing callback or adapter must not prevent the
others from receiving an event.

AudioFusion does not currently document a WAX environment flag, version global,
or API-ready event. Detection must therefore be based on host capabilities:

```js
const hasDataTree =
  typeof window.WAX_DataTree?.pull === "function" &&
  typeof window.WAX_DataTree?.push === "function";

const hasPlayhead =
  typeof window.WAX_RequestPlayheadInfo === "function" &&
  typeof window.Request_PlayheadTimerStart === "function" &&
  typeof window.Request_PlayheadTimerStop === "function";

const isWax = callbackWasActuallyInvoked || hasDataTree || hasPlayhead;
```

The bridge must not infer WAX from Web MIDI support, Web Audio support, autoplay
state, the user agent, or the presence of its own `WAX_Play`, `WAX_Stop`, and
`WAX_BPM` callbacks. Each optional host capability is checked again immediately
before use. A bounded probe may accommodate delayed host injection, but it must
stop and leave no permanent polling loop in an ordinary browser.

## Page adapter API

The bootstrap exposes one integration namespace in the WAX artifact:

```js
window.MorphazoidWAX.register({
  id: "chaotic-fm",
  stateVersion: 1,

  getState() {},
  applyState(state, metadata) {},
  subscribeState(listener) {},

  enableMidi() {},

  transport: {
    play(playhead) {},
    stop(playhead) {},
    bpm(value) {},
    playhead(playhead) {},
    playheadIntervalMs: 16,
  },
});
```

All members except `id` are optional. `register()` returns an idempotent
unregister function. Registering an ID already owned by a live adapter is an
error; pages must unregister during teardown before registering it again.

- `id` is a stable route/instrument ID and must not be derived from a display
  label.
- `stateVersion` is a positive integer interpreted by that adapter.
- `getState()` synchronously returns a JSON-serializable persistent snapshot.
- `applyState()` validates and applies a snapshot without creating a user-change
  notification. Its metadata includes the stored `stateVersion` and source
  `"wax-hydration"`.
- `subscribeState(listener)` subscribes to persistent state changes and returns
  an unsubscribe function. A listener notification contains a complete current
  snapshot and a source such as `"user"`, `"preset"`, `"import"`, `"midi"`, or
  `"wax-hydration"`.
- `enableMidi()` returns a value or Promise and is called only after the page's
  MIDI client has registered, the document is ready, and WAX is strongly
  detected.
- Transport handlers are opt-in. The bridge must not synthesize clicks on an
  app's local play, stop, audio, or MIDI controls.
- `playheadIntervalMs` requests continuous playhead delivery and is clamped to
  the documented WAX range of 4 through 2000 ms. No continuous timer is started
  for an adapter without a `playhead` handler.

The public bridge also provides feature queries, a one-shot defensive playhead
request, an explicit dirty notification, and an explicit state flush. These
operations return neutral values rather than throwing when their host capability
is absent.

## MIDI lifecycle

WAX exposes DAW MIDI through the standard Web MIDI API. A mapped page adapter
must delegate `enableMidi()` to Morphazoid's existing shared MIDI manager rather
than opening a second MIDI connection.

The order is:

1. The page creates its audio/controller state and registers its MIDI client.
2. The document reaches `DOMContentLoaded` or a later ready state.
3. The bootstrap positively detects WAX.
4. The adapter calls the shared manager's idempotent `enable()` method once.
5. Rejection is reported as a nonfatal integration error; the page and its
   existing manual MIDI control continue to work.

Normal browser builds retain explicit, user-initiated MIDI permission. Merely
constructing a controller or importing an adapter must never call
`navigator.requestMIDIAccess()`.

Incoming MIDI or host automation updates audio and UI without echoing the same
message back to WAX. The universal layer has no MIDI-thru path. Only an explicit
algorithm-origin companion event or a user-originated automation change may use
MIDI output.

The shared manager accepts all MIDI 1.0 channel-voice messages used here: note
on/off, poly pressure, CC, program change, channel pressure, and pitch bend. It
also accepts timing clock, start, continue, stop, and song-position pointer as a
hardware/browser fallback. WAX playhead PPQ remains authoritative when present.
One selected output receives MIDI; Morphazoid never broadcasts to every output.
Explicit output selection, hot-plug, scheduled-send clearing, and all-channel
panic are part of the manager lifecycle.

## Transport and playhead

`WAX_Play`, `WAX_Stop`, and `WAX_BPM` update bridge state immediately and notify
the active adapter when present. BPM values must be finite and greater than
zero. An adapter registered after a callback receives the latest known BPM and
play state once.

A one-shot request calls `WAX_RequestPlayheadInfo()` and then defensively reads
`window.PlayheadInfo`. Continuous delivery uses
`Request_PlayheadTimerStart(intervalMs)` and stops with
`Request_PlayheadTimerStop()` on adapter unregister and `pagehide`.

The normalized playhead passed to adapters contains nullable values for:

- `isPlaying`, `isRecording`, and `isLooping`;
- `bpm`, `timeSigNumerator`, and `timeSigDenominator`;
- `timeInSamples`, `timeInSeconds`, `ppqPosition`, and
  `ppqPositionOfLastBarStart`;
- `ppqLoopStart` and `ppqLoopEnd`.

Missing objects, unavailable APIs, and non-finite numeric fields normalize to
`null` and do not break a page. Transport handlers must not assume that a
one-shot result is fresh or that a playhead is present with every callback.

Musical events are scheduled on the Web Audio timeline. JavaScript timers may
refill a lookahead window, but they are not the event clock. UI animation stays
separate from audio scheduling because animation frames and timers may be
throttled while the plug-in editor is hidden.

## DataTree envelope

The stable WAX DataTree application name is `com.morphazoid.wax`. State uses one
versioned whole-suite envelope so navigation does not discard other page states:

```json
{
  "schema": "morphazoid-wax",
  "schemaVersion": 1,
  "route": "chaotic-fm",
  "pages": {
    "chaotic-fm": {
      "stateVersion": 1,
      "state": {}
    }
  }
}
```

- `schema` and `schemaVersion` identify the envelope contract.
- `route` is the last active stable adapter ID. It is data, not permission to
  redirect from every page load.
- `pages` retains validated snapshots by stable adapter ID.
- Page adapters own migration of their `stateVersion`; the bridge owns migration
  of `schemaVersion`.
- Runtime objects, DOM nodes, AudioContexts, MIDI ports, held notes, active
  voices, analyser data, pending Promises, and functions are never persisted.
- User-selected local files or sample bytes are not persisted in v1 unless a
  later contract defines bounded, licensed, JSON-safe storage for them.

## DataTree lifecycle

The integration follows the WAX pull-before-push rule:

1. Register the page adapter and its state-change listener.
2. Register `WAX_DataTree.onHydrated()` when available.
3. Call `WAX_DataTree.pull("com.morphazoid.wax", 3000)`.
4. Validate the envelope before applying its matching page state.
5. On missing state, rejection, timeout, or invalid data, retain the page's
   existing defaults.
6. Mark hydration complete and install `setProvider()` when available.
7. Only after the pull attempt settles may user-originated changes call
   `WAX_DataTree.push(envelope, "com.morphazoid.wax")`.

Hydration suppresses state-change feedback. Duplicate delivery through both
`pull()` and `onHydrated()` is deduplicated. Later valid hydration is treated as
a host preset/project-state change and may be applied again.

If the user changes state while the initial pull is pending, the complete
user-edited snapshot wins; late hydration must not overwrite it. That snapshot
is merged into the pulled envelope and pushed after hydration settles.

High-frequency changes are debounced. The provider always returns a fresh,
synchronous, JSON-safe envelope. Deliberate Morphazoid navigation requests an
explicit flush before leaving the page; teardown also makes a best-effort flush
only after the initial pull attempt has settled.

No DataTree exception may prevent audio, MIDI, UI, or navigation from continuing.

## No-regression guarantees

- The canonical browser build has no new MIDI or microphone permission prompt.
- Browser AudioContexts retain their existing user-gesture behavior.
- Local play/stop, tempo, MIDI toolbar, presets, keyboard controls, navigation,
  downloads, and local storage keep their existing semantics.
- Host state never overwrites browser local storage.
- A missing or partial WAX API degrades per capability; it never disables the
  underlying Morphazoid page.
- WAX transport has no effect on a page that did not opt into transport.
- WAX state restore changes persistent controls only; it does not restore held
  notes or automatically resume transient recording/microphone capture.
- Shared application modules remain host-agnostic and testable with ordinary
  browser/runtime fakes.
- The WAX artifact cannot alter the deployed normal site merely by being built
  or published.

Conformance tests must prove that a runtime with Web MIDI and Web Audio but no
WAX globals makes zero automatic MIDI requests, zero DataTree calls, and zero
transport changes. Tests also cover delayed/partial host APIs, callbacks before
adapter registration, DataTree timeout and malformed state, an edit during
hydration, duplicate hydration, MIDI rejection, malformed playhead data, and
timer cleanup on teardown.

## Unsupported or uncertain in v1

The following are not promised by this contract:

- a separately branded native VST3/AU binary exported from WAX;
- native VST parameter enumeration; WAX automation currently uses MIDI CC;
- Linux support, because AudioFusion currently advertises macOS and Windows;
- faster-than-real-time/offline bounce or operation after the editor closes;
- WebGPU availability in WAX's embedded browser;
- automatic persistence of arbitrary local files, downloads, microphone
  recordings, sample bytes, or remote resources;
- automatic synchronization for pages whose musical logic still depends on
  `requestAnimationFrame`, visibility state, or unscheduled main-thread timers;
- sample-accurate preservation of Web MIDI timestamps by WAX; raw Web MIDI
  scheduling is standards-based but still requires a pinned-host recording test;
- exact equivalence between a universal companion MIDI sequence and every
  page's internal Web Audio event stream;
- automatic restoration/navigation to `route`; WAX URL persistence and initial
  route behavior require an integration test;
- DataTree payload limits, multiple application-name behavior, provider
  unregistration, or `push()` return/error semantics;
- whether `onHydrated()` fires only at startup or again for live DAW preset
  changes;
- whether a missing snapshot makes `pull()` resolve empty data or reject;
- exact WAX API injection timing, transport callbacks when a page loads during
  playback, seek/loop callback semantics, or a freshness token for
  `PlayheadInfo`.

Each uncertain item must fail safely and remain feature-detected until
AudioFusion publishes a stronger guarantee or it is verified against a pinned
WAX release.

## Official sources

The API names and ordering above were checked against AudioFusion's official
documentation on 2026-08-16:

- [WAX Developer Documentation](https://wp.audiofusion.com/docs/wax-developer-documentation/)
- [WAX Developer Helper](https://wp.audiofusion.com/docs/wax-dev-helper/)
- [WAX Performance Tips](https://audiofusion.com/docs/performance-tips/)
- [WAX Custom Pages](https://audiofusion.com/docs/custom-pages/)
- [WAX Debug Panel](https://audiofusion.com/docs/debug-panel/)
- [WAX product page](https://audiofusion.com/wax/)

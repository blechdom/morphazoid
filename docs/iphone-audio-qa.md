# iPhone audio startup and recovery

September 23, 2026. Based on `main` at `9a45aa0`. Physical-iPhone acceptance is
still required; desktop touch emulation does not reproduce the iOS audio route.

## Changed behavior

- On playback-only instruments, the explicit header Audio click requests
  `navigator.audioSession.type = "playback"` when supported. Nothing happens on
  page load or Play alone. WAX, unknown pages, and microphone-capable instruments
  retain browser-managed session routing. Existing recording/exclusive session
  choices are not overridden. This intentionally does not force playback-only
  routing on a microphone or request microphone permission to unlock sound.
- Shared `VoicePool` startup is bounded to eight seconds. Failed/cancelled
  attempts retire their context; stale completion cannot unmute a later session.
- Shapes shows Starting, On, Interrupted and Error distinctly. Startup can be
  cancelled with another speaker tap. Errors remain visible and retryable.
  Resuming an interrupted context preserves Play and the current controls.
- Julie Saw, Morphynx and Syrinx request resume before loading their worklets,
  bound resume/module waits, and show actual startup failures.
- The header respects engine-owned state and no longer interprets a pending
  armed flag as successful audio. Legacy buttons retain their text/pressed-state
  compatibility path.

## Device pass

Use the built site over **HTTPS on the iPhone**. A desktop localhost URL is not
the phone's localhost, and an ordinary LAN HTTP address is not a secure origin
for AudioWorklet. Do not test against a source tree another task is editing.

Record iPhone model, iOS/browser version, URL/build, preset, output route and
whether Silent mode is enabled.

1. On Shapes, load a known preset. Play alone must not arm Audio. Tap the speaker:
   startup should finish, then the playing scene should be audible.
2. Repeat with Silent mode on/off, first using the built-in speaker and then
   headphones if available. Playback-only instruments should use the playback
   session where the API is supported. Older/unsupported browsers may still
   require Silent mode off.
3. Load Julie Saw and a Syrinx instrument cold, with a slow network if possible.
   Audio must start or show a recoverable error, not remain indefinitely pending.
4. On Shapes, cancel startup, then retry. Verify that an older request never
   starts sound after Audio has been turned off.
5. Lock/unlock and switch apps while Shapes is armed. If the context resumes
   automatically, its status should follow it. Otherwise tap **Resume audio**.
   Repeat with Audio off: returning to the page must never arm it.
6. On Morphynx or Loopini, separately test microphone permission, refusal,
   recording and output routing. These pages deliberately retain automatic
   session selection rather than the playback-only override.
7. Check portrait and landscape: the speaker and any recovery message must
   remain reachable and legible.

## Automated checks and boundaries

`tests/audio-startup.test.mjs` covers bounded/cancelled/late startup, retry,
session-policy exclusions, and truthful header state. The browser suite
`e2e/iphone-audio-startup.spec.mjs` exercises the real page with deliberately
stalled resume promises, suspension and touch-size viewports. These are
controlled failure tests, not a claim to emulate iOS Silent mode.

Primary references: WebKit bug 237322 (ringer/Silent mode and playback session),
the W3C Web Audio specification (pending resume and secure AudioWorklet), and
the W3C Audio Session draft (playback versus capture categories).

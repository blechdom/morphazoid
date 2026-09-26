# Audio & MIDI setup

Open `settings.html` from the catalogue or an instrument's Settings gear →
**Full I/O setup ↗**. This is a browser diagnostic, not an instrument
or an OS audio control panel.

The public route remains `settings.html`; its controller, test engine and CSS
live in `src/site/settings-app.js`, `src/site/io-settings.js`, and
`src/site/styles/settings.css`. Input preferences remain a shared audio utility
at `src/audio-input-settings.js`. The September 22 integration preserves main's
relocated instrument modules and preset/navigation changes. Exact stereo-input
amendments to the frozen relocation proof are recorded in
`docs/io-settings-runtime-changes.json`, rather than replacing its baseline.

The **top-right gear** is available on catalogue, setup, guide and shared-header
instrument pages. On an instrument, click/tap the gear to edit its
**Audio Out**, **Mic / Audio In**, **MIDI In**, **MIDI Out**, and **MIDI Map**
controls directly, with the instrument still visible behind it. Availability
follows the instrument and browser: disabled routes remain honestly unavailable.
This changes only the menu layout, not the instrument's permission, transport,
or input lifecycle. The catalogue and setup-page gear retain their test shortcuts.
Keyboard users can press Enter/Space to open the gear, Tab through controls, or
Arrow Down to focus the first available control. Escape dismisses it and returns focus to the gear, while
preserving page panic/stop behavior (including Stop all on this setup page).
An outside click or tabbing away also dismisses it. Hover never opens or closes
the menu; clicking the gear again closes it.
The **Full I/O setup ↗** link is always at the bottom and opens in a new tab,
leaving the instrument page and its state in place. The guide opens separately
too. Browser/instrument background-audio policies still apply when switching
tabs; preserving an open page is not a promise of uninterrupted background
playback. Opening the gear or full setup never automatically starts a device.

## Quick menu

The page starts with three closed rows: **Speakers**, **Audio input**, and
**MIDI**. Open one test at a time. The everyday controls are the device,
test/stop action and immediate feedback; input gain and mono/stereo stay close
to the input meter. A stereo request shows both L/R meters, while mono shows
one level. MIDI shows its most recent message without opening a log.

**Device & surround options**, **Monitoring & input options**, and
**MIDI output & details** retain the advanced controls, raw meters and message
history. **Help & device limits** holds the longer explanation. Opening a row
never arms audio or requests permission. Closing the input row or its options
mutes monitoring but keeps capture available; connected-device badges remain
visible, and **Stop all / Escape** disconnects everything.

- **Audio** in the header explicitly creates/resumes the test context. Nothing
  sounds on load. Test/monitor output gain starts at −24 dB and is capped at
  −12 dB; start with your physical speakers turned down.
- Select a permitted output or use **Choose / allow output device** when the
  browser supplies that API. With no sink-selection API, use system settings.
  Output-device choices are remembered by the shared output manager and used
  by its instrument clients on subsequent pages, without auto-arming audio.
- Choose mono, stereo, quad, 5.1, or eight-channel 7.1. Layouts exceeding the
  destination's `maxChannelCount` are disabled. Tests use discrete buffers and
  an explicit discrete destination, not stereo panners or an HRTF simulation.
  The original direct output manager route is retained; its stereo meter tap
  does not downmix the audible graph. Tones are bounded one-shots with fades;
  **Play test sound** schedules up to eight channels against the audio clock.
- Standard channel order is mono; L/R; quad L/R/rear L/rear R; 5.1
  L/R/C/LFE/rear L/rear R. The eight-channel convention appends side L/R.
  Hardware mappings vary: verify all numbered channels physically. LFE uses
  80 Hz; other channels use 440 Hz or deterministic softly filtered noise.
- **Test input** separately requests audio-only access, for microphones,
  stereo line input and USB interfaces. The browser calls all of these
  "microphone" permission. Select mono or stereo capture. Raw and post-gain L/R
  peaks are metered independently in dBFS, with clipping indication.
  This gain is local to the test graph, not hardware capture gain. Echo
  cancellation is optional; automatic gain and noise suppression are requested
  off. The browser's actual reported settings are shown. No recording/upload.
- Monitoring is opt-in and starts muted. It preserves stereo to front L/R (or
  duplicates a mono input for headphones), with a
  compressor and conservative gain. These reduce output, but are not acoustic
  feedback protection: use headphones. Device/layout changes and hiding the
  page mute monitoring. Changing input/cancellation releases the old stream.
- **Test MIDI** requests access without SysEx. Filter by input and channel,
  see a bounded 40-message log, and optionally hear the bundled original
  “MIDI received” voice through the selected audio output. Audio must already
  be on. Notes/releases, CC, bend, pressure, program and realtime messages are
  displayed; clock, active sensing, time code and note releases do not trigger
  speech. Announcements are rate-limited and never overlap/queue with tests.
- MIDI output is **None** until a device is explicitly chosen (or restored
  from local test preferences). No message is sent without **Send C4 test
  note**. It sends note 60, velocity 64 on the selected send channel and queues
  a note-off 250 ms later. Stop/switch/teardown releases a pending test note.
  There is no MIDI thru, automatic clock, or instrument-output routing change.
- **Stop all / Escape** closes audio and microphone tracks, disables MIDI,
  cancels queued tests, and releases pending MIDI test notes. Page exit does
  the same. Pending microphone/MIDI permission results cannot rearm tests
  after cancellation. Device refresh itself never requests permissions.

Output selection is shared with compatible instruments. The input device,
mono/stereo capture and echo-cancellation preference also feed L-system Delay,
Graph Delay (including Graphs' microphone mode), Sandy Syrup and Candy Coil on
their next input start. Input gain remains local to each effect/test. The rest
of the test preferences stay on this page. Microphone/MIDI permissions, Audio arming and monitoring
are never persisted. Stored device IDs stay in local browser storage. WAX
positively detected hosts show a DAW-routing notice and disable browser tests.

## Stereo delay paths

Mono remains the default for compatibility. Stereo requests two channels and
shows the actual reported capture count; it does not fabricate a second hardware
input. Browser/OS drivers decide which interface pair is exposed. To capture
system/app audio, use a loopback/virtual capture device exposed by your OS;
this page does not silently capture another tab or the desktop.

The four delay pages link directly back to I/O setup. Their effect controls
retain existing input trim, mix, feedback, timing, pitch and geometry semantics:

- Sandy Syrup and Candy Coil already have stereo history/DSP; the capture
  selection now supplies both channels instead of relying on a browser default.
- Graph Delay's turn routers use two bounded histories in stereo mode instead
  of forcing every worklet input/output to one channel. Graph spatial panning
  still intentionally moves/mixes the stereo result.
- L-system Delay's Economy/granular and Silky/Signalsmith paths both preserve
  L/R separately through pitch histories and delayed taps. Stereo allocates
  twice the history memory per pitch slot; the existing voice/source bounds and
  adaptive rendering limits are retained. Mono uses the original single
  histories and processing cost. Branch pan remains an intentional spatial
  weighting; this is not a promise that all effect settings preserve the source
  image unchanged.

## Source references and provenance

- W3C Web Audio: https://www.w3.org/TR/webaudio/ — channel ordering,
  `maxChannelCount`, explicit/discrete routing, audio-clock scheduling.
- W3C Audio Output Devices: https://www.w3.org/TR/audio-output/ — explicit
  output selection and permissions.
- W3C Web MIDI: https://www.w3.org/TR/webmidi/ — port lifecycle, timestamped
  sends and clearing queued output.
- Voice asset: `assets/audio/CREDITS.md`; generator:
  `scripts/generate-midi-received.py`.

Automated tests cover routing buffers, measured signal/gain, silence/cleanup,
permissions and stale requests, MIDI filtering/releases, persistence and
responsive access. They do not prove audible voice quality, physical surround
mapping, microphone calibration, feedback safety or hardware MIDI latency;
those require a real-device/listening pass.

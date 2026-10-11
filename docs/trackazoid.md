# Trackazoid

Trackazoid is a desktop-first, two-deck DJ workspace at
[`trackazoid.html`](../trackazoid.html), inside Morphazoid's **App** chooser.
Its waveforms show the actual local recordings: seeking moves the playback
position, a highlighted beat loop repeats that section, and the crossfader
changes the audible balance between the decks. It is an independently written
browser instrument inspired by familiar DJ workflows, not a Traktor port.

## First mix

1. Use **Add files**, **Open folder**, or drop audio files into the library.
   Drop a file directly onto Deck A or B to load it there.
2. Enable **Audio** in the Morphazoid menubar, then press a deck's **Play**.
   Loading, seeking and playing never enable Audio for you. Space controls
   Deck A when focus is outside an editable field or an interactive control.
3. Set each track's **Source BPM** or use its **Tap** button. Place the cursor
   on a known beat and use **Set grid** to anchor the beat grid.
4. Adjust tempo and nudge the decks into alignment. **Sync** copies the other
   deck's effective BPM and aligns beat phase once, within the tempo range.
   It depends on the BPM and grid you entered; it is not automatic beat analysis
   or a continuous synchronization lock.
5. Use the deck faders, three-band EQ, filters and crossfader to mix.

Audio begins off; the decks begin stopped. Turning Audio off mutes output
without changing transport state. Reloading the page does not resume playback.
A file dropped onto a playing deck is staged: **Load pending** explicitly
replaces it, keeping an accidental drop from cutting off the current track.

## Deck controls

| Control | Behavior |
| --- | --- |
| Waveform | Seek within the file; its cursor follows the transport clock. |
| Tempo | Change playback speed from −16% to +16%. |
| Key lock | Preserve pitch while changing tempo through Signalsmith Stretch. It starts off. |
| Source BPM / Tap | Set the unmodified track tempo, between 40 and 240 BPM. This is metadata, not an automatic tempo detector. |
| Set grid | Place the beat-grid anchor at the cursor. |
| Sync | Match the other deck's tempo and beat phase once; the ±16% range still applies. |
| Hot cues 1–4 | Store a position in an empty slot or jump to its saved position. Shift-click clears a slot. |
| Beat loop | Repeat 1, 2, 4, 8 or 16 beats using the edited BPM/grid. |
| EQ and filter | Shape the deck before it reaches the master and cue mixes. |
| Crossfader | Blend the two decks. |

The first release does not implement vinyl scratching, slip mode, automatic
key/BPM detection, variable beat grids or DJ-controller profiles. Key lock is a
musical processing option: audition its transient quality and cue responsiveness
on your own tracks before relying on it for a performance.

## Local library

Music stays local: there is no account, upload service or required backend.
Folder selection grants access only to the directory you choose. Compatible
browsers can remember a read-only folder handle; a later visit may require an
explicit reconnect and another permission prompt. Other browsers use a folder
file picker and require reselection. A denied or cancelled picker leaves the
current mix available.

The library indexes up to 20,000 tracks without decoding every track. Audio is
decoded when a deck loads it, so two long recordings can still use substantial
memory. Imports recognize MP3, WAV, AIFF, FLAC, Ogg, Opus, M4A/AAC, MP4 and WebM
file extensions or an audio MIME type; actual decoding depends on the browser.
An unsupported or damaged file reports a load error. The library's search and folder controls help narrow large
collections before loading a deck.

Saved cues, source BPM and grid information live in browser storage. Identity
includes source, relative path, size and modification time, so same-named files
in different folders remain distinct. A changed file requires a refresh and
receives fresh track metadata. Saved entries never store the audio bytes. They do
not modify the original audio files. Clearing site data removes local metadata;
private browsing or disabled storage can prevent persistence. Reselect the
same files or reconnect the saved folder to use the saved track information.

## Output, cueing and recording

The standard Morphazoid menubar provides stereo meters, master volume, Audio,
Record and Settings. Choose the output device in Settings where the browser
supports device selection.

Normal output sends the stereo master to the selected device. Headphone cue is
available in **split output**: the left channel carries a mono master mix and
the right channel carries a mono cue mix. Use suitable cabling or an audio
interface to route those channels to speakers and headphones. Split output
sacrifices stereo separation; it is not separate browser audio-device routing
or a four-channel master/headphone interface. The master meters and recorder
continue to receive the stereo master before the split.

The shared **Record** button records the master mix. See
[main-output recording](main-output-recording.md) for saving, recording limits
and interrupted recordings. The first version has no dedicated hardware
jog-wheel or controller mapping. Morphazoid's shared MIDI controls remain
available in Settings; generic piano/drum typing keys are suppressed so the
page can own its transport and waveform keyboard controls.

## Engine and development boundaries

One Web Audio clock drives both decks; graphics follow transport state. Native
Web Audio mixer nodes provide EQ, filtering and gain. Optional key lock uses
the existing MIT-licensed Signalsmith Stretch WebAssembly/AudioWorklet engine;
see [third-party notices](THIRD_PARTY_NOTICES.md). No Rust toolchain, runtime Node
process, external audio service or new framework is required.

Desktop Chrome/Edge are the initial target. Controls remain reachable on small
screens, but the two-deck workspace is designed for a desktop display. Real
headphone routing, physical-controller behavior, long-session stability and
subjective time-stretch quality require device/listening verification; source
and browser tests cannot establish those properties.

## Next stages

1. **Prove the MVP:** long two-deck sessions, repeated cue/loop transitions,
   memory checks with long files, real split-output routing and listening tests
   with bass, percussion and vocals.
2. **Library and preparation:** automatic BPM/key suggestions with correction
   controls, richer tags and playlists, session export and resilient folder
   reconnection.
3. **Performance:** configurable keyboard/MIDI mappings, audio-interface cue
   routing, effects sends and loop editing informed by performance feedback.
4. **Advanced:** four decks, flexible beat grids, slip/scratch modes,
   Morphazoid effects and eventually optional stem processing.

The normal browser source remains static and uses the shared Morphazoid menu.
Any generated WAX wrapper stays separate; the MVP does not promise DJ-specific
host state, beat-grid or controller integration.

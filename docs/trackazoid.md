# Trackazoid

Trackazoid is a desktop-first, two-deck DJ workspace at
[`trackazoid.html`](../trackazoid.html), inside Morphazoid's **App** chooser.
Its waveforms show the actual local recordings: seeking moves the playback
position, a highlighted beat loop repeats that section, and the crossfader
changes the audible balance between the decks. It is an independently written
browser instrument inspired by familiar DJ workflows, not a Traktor port.

## First mix

1. Choose a **Demo track** from each deck's menu to start immediately, or use
   **Add files**, **Open folder**, or drop audio files into the library.
   Drop a file directly onto Deck A or B to load it there.
2. Enable **Audio** in the Morphazoid menubar, then press a deck's **Play**.
   Loading, seeking and playing never enable Audio for you. Space controls
   the selected deck (A/B), including when its waveform is focused. Fields, buttons and menus keep their native keys.
3. Tempo and beats are detected in the background when a deck loads a new track.
   The first playing deck becomes the **MASTER**. Enable **Sync** on the other
   deck, then press its **Play**: it matches the master's tempo and launches on
   a matching beat. Sync stays enabled and follows master tempo changes.
4. Use the deck faders, three-band EQ, filters and crossfader to mix. **Key lock**
   starts on to preserve pitch while changing tempo.

Use **Adjust** only when an estimate needs correcting. Enter Source BPM or Tap,
use **½ / ×2**, shift the grid with **Grid − / +**, or place the cursor on a
known downbeat and choose **Set downbeat here**. Corrections save with the track.
**Reanalyze** saves a new suggestion without replacing manual corrections;
**Use automatic grid** explicitly applies that suggestion. Turning Sync off,
seeking, nudging, or moving a follower's tempo slider gives you manual control.

Audio begins off; the decks begin stopped. Turning Audio off mutes output
without changing transport state. Reloading the page does not resume playback.
A file dropped onto a playing deck is staged: **Load replacement** explicitly
replaces it, keeping an accidental drop from cutting off the current track.

## Deck controls

| Control | Behavior |
| --- | --- |
| Waveform | Click to seek; drag to select a chunk; drag selection edges to trim. Shift-click extends a selection. |
| Waveform view | Shift-drag pans; − / + zoom; Fit shows the whole file; Follow returns to the moving playhead. |
| Snap | Align selection and marker edits to beats. Hold Alt to bypass snapping for a pointer edit. |
| Quantize | Keep cue and loop recalls at the current beat phase during playback (Q). Starts on; separate from Snap. |
| In / Out | Set selection boundaries at the playhead (I / O). Out must be at least 50 ms after In. |
| Loop selection | Repeat the selected chunk (L). Click again to stop that same loop. No detected BPM is required. |
| Clear selection | Clear the range or pending In point (Delete / Backspace), preserving any playing loop. |
| Mark | Add the next empty cue marker at the playhead (M), or double-click the waveform to seek and place one. Drag a numbered flag to move it. |
| Tempo | Change playback speed from −16% to +16%. |
| Key lock | Preserve pitch while changing tempo through Signalsmith Stretch. It starts on; turn it off for native playback. |
| Source BPM / Tap | Set the unmodified track tempo, between 40 and 240 BPM. Overrides the automatic estimate; available under Adjust. |
| Set downbeat here | Place the beat-grid anchor at the cursor. |
| Sync | Follow the master tempo and beat phase until disabled; the ±16% range still applies. |
| Saved cues & loops (1–8) | An empty pad saves the selection, then the active loop, or otherwise the playhead as a cue. A filled pad recalls it. Color means a marker is saved, not that a switch is on. Choose a slot beside **Clear pad** to remove it without recalling it, or Shift-click / Shift+1–8. Clearing a saved loop leaves any currently playing loop intact; use **Loop** to stop looping. |
| Edit pads | Name the selected slot or explicitly store a cue or loop. Names and ranges save with the track. |
| Beat loop | With no selection, Loop / L repeats the chosen length from ⅛ to 32 beats. The length menu resizes an active loop; ½ / ×2 halves or doubles it. Loops must last at least 50 ms. |
| Beat jump | Jump backward or forward by 1, 4, 8, 16 or 32 beats without losing beat phase. Use [ / ] for the selected size. |
| Move loop | Move the active loop backward or forward by the selected jump size (Shift+[ / Shift+]). |
| EQ knobs and filter | Shape the deck before it reaches the master and cue mixes. Drag EQ knobs up/down, hold Shift for fine adjustment, or use arrow keys. Double-click returns that band to 0 dB; Reset mixer resets all bands. |
| Crossfader | Blend the two decks. |

Selecting, trimming a selection, moving markers, panning and zooming preserve
transport and Sync. Press **Loop selection** to apply an edited range to playback.
With no selection, dragging an active loop edge changes the live loop.
The overview remains a full-track seek control. Arrow keys seek by one beat
(or half a second without BPM), Shift+Arrow by ten seconds, and Home/End reach the
track ends. **Space** plays/pauses the selected deck; **Esc** pauses both.
Selection and viewport reset when a new track loads; cue markers are saved with
the track. These controls never edit the original audio file.

Quantize uses the deck's beat phase at the audible transition, so a recall stays
in time without waiting for the next whole beat. A stopped deck recalls the exact
saved position and stays stopped. Turn Quantize off for free cueing; a free cue
jump releases follower Sync. Beat jumps retain phase with either setting.
Jumps outside a playing loop leave it. Moving a loop carries the playhead with
it; shortening a loop wraps the playhead into the new range. A move beyond a
track boundary is rejected. Off-grid and sub-beat loops can release Sync.

Saved loop pads appear as green flags marked L. Dragging a flag moves the saved
range without changing its length or name. Existing four-cue tracks migrate to
eight pads automatically. Recalls preserve Play/Pause and never enable Audio.

Each deck's demo menu contains six locally generated tracks: Mint Transmission
(120 BPM), Amber Circuit (126), Broken Orbit (110), Velvet Current (90), Chrome
Parade (116), and Cobalt Rush (174). **Try demo pair** loads the first two. The
menus can be used independently; choosing a demo on a playing deck stages a
replacement for **Load replacement**. Demos use the same saved preparation as
local files and need no download. Widely separated tempos still exceed Sync's
±16% range; the 120/126 pair is a convenient first mix.

This version does not implement vinyl scratching, slip mode, automatic
key detection, variable beat grids or DJ-controller profiles. Key lock is a
musical processing option: audition its transient quality and cue responsiveness
on your own tracks before relying on it for a performance. With key lock on,
commands are scheduled roughly 100 ms ahead to allow the stretch engine to process;
native playback is the more immediate option for cueing.

## Automatic beatmatching

Analysis runs locally in a worker using bounded sections of the decoded audio.
It estimates constant tempo and beat phase, not the musical phrase or which
beat should be the first beat of a bar. The waveforms show the estimated grid;
use Adjust if it lands on the wrong beats. Half/double-tempo ambiguity is normal,
and live drums or changing tempos may need manual preparation. Silence or an
unreliable result leaves BPM unknown and Sync/beat loops unavailable until you
enter a tempo. Playback is still available during or after failed analysis.

Results and their confidence are cached with the local track metadata. Existing
prepared tracks from the first MVP are retained as manual corrections. The
library indexes folders lazily; analysis happens on deck load, not across an
entire folder at once. No audio is uploaded and no model download is required.

Both decks use one audio clock. Play and synchronized tempo changes are scheduled
at a common future time so native and key-locked playback can align despite
different processing delays. The first playing deck leads; stopping it hands
master status to the remaining playing deck. A paused synced deck keeps its Sync
setting for its next launch. Beat loops preserve Sync; trimming a loop off-grid
releases it. Sync cannot exceed the existing ±16% tempo range: correct a possible
half/double BPM estimate or change the master tempo when the range is exceeded.

## Local library

Music stays local: there is no account, upload service or required backend.
Folder selection grants access only to the directory you choose. Compatible
browsers can remember a read-only folder handle; a later visit may require an
explicit reconnect and another permission prompt. Other browsers use a folder
file picker and require reselection. A denied or cancelled picker leaves the
current mix available.

The library indexes up to 20,000 tracks without decoding every track. Audio is
decoded when a deck loads it, so two long recordings can still use substantial
memory. The MVP limits a file to 160 MB and decoded PCM to 256 MB per deck;
those checks do not eliminate the browser’s transient memory use during decode. Imports recognize MP3, WAV, AIFF, FLAC, Ogg, Opus, M4A/AAC, MP4 and WebM
file extensions or an audio MIME type; actual decoding depends on the browser.
An unsupported or damaged file reports a load error. The library's search and folder controls help narrow large
collections before loading a deck.

Saved cue/loop pads, source BPM and grid information live in browser storage. Identity
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
process, external audio service or new framework is required. The demo catalog is
synthesized locally from deterministic oscillators and percussion; the catalogue
icon is original procedural Canvas artwork.

Desktop Chrome/Edge are the initial target. Controls remain reachable on small
screens, but the two-deck workspace is designed for a desktop display. Real
headphone routing, physical-controller behavior, long-session stability and
subjective time-stretch quality require device/listening verification; source
and browser tests cannot establish those properties.

## Next stages

1. **Prove the MVP:** long two-deck sessions, repeated cue/loop transitions,
   memory checks with long files, real split-output routing and listening tests
   with bass, percussion and vocals.
2. **Library and preparation:** key suggestions, richer tags and playlists,
   session export and resilient folder reconnection.
3. **Performance:** configurable keyboard/MIDI mappings, audio-interface cue
   routing, effects sends and loop editing informed by performance feedback.
4. **Advanced:** four decks, flexible beat grids, slip/scratch modes,
   Morphazoid effects and eventually optional stem processing.

The normal browser source remains static and uses the shared Morphazoid menu.
Any generated WAX wrapper stays separate; the MVP does not promise DJ-specific
host state, beat-grid or controller integration.

# Wobblini

Eight independent stereo sources for intercutting recordings and conversations.
Audio starts off; playing, loading, cueing, scratching and changing views never
arm it. Files and generated demo sources **play through once**. At the end the
deck stops; Play starts it again from the beginning. Loop controls have been
removed.

## Performance views

- **Classic:** two larger circular records. Left and Right select any two decks.
- **Pro:** two wide scratchable waveforms, stacked on narrow phones.
- **Eight decks:** all eight circular records, with padding around each one.
- **Prepare:** one source with its waveform, cue, source tempo and detailed controls.

Switching views or choosing another visible deck preserves all eight transports
and the mix. Hidden decks continue playing. The record waveform rotates past a
fixed needle at three o'clock; one revolution represents the complete file.
Reduced-motion preferences stop automatic rotation while preserving direct
scratching and position readouts. File names appear in waveform views and the
settings popup; platter view keeps them out of the playing surface.

Play/Pause sits at the center of each record. Its top-left corner contains the
number, master crown and **SYNC**; the top-right gear opens larger controls.
Bottom-left **S** and **M** mean solo and mute; bottom-right is volume. Muting
keeps the playhead moving. Pausing stops it. Multiple solos are allowed, and
mute still silences a soloed deck. All eight stereo decks feed one stereo output.

## Cue, scratch and Slip

**Set cue** (flag with plus) stores the current return point. It does not change
the beat grid. **Return to cue** jumps a playing deck back without stopping it.
On a paused deck, hold Return to cue to preview from that point; release returns
to the cue and pauses. Press Play during the hold to continue after release.
Pointer cancellation, window blur and changing views release held previews.
Space/Enter also support held preview on the focused Cue button.

Drag a record or waveform forward and backward to scratch actual samples. A
stationary held surface is silent. A playing deck resumes on release; a paused
deck stays paused. Keyboard Left/Right scratches; Shift makes finer movements.
The separate position slider seeks without a scratch sound.

Enable **Slip** to retain an inaudible uninterrupted timeline while scratching
or holding Cue. Releasing returns a previously playing deck to where it would
have reached. Slip does not wrap the file: if that timeline reaches the end,
playback stops. An enabled beat-sync follower rejoins the master's grid after
release when the master is available.

Space toggles all decks, and keys 1–8 toggle individual decks when focus is
outside controls. Stop pauses everything and returns all sources to zero.
Replacing a playing source asks before discarding it. Demo set replaces the
sources and asks first if local files are present.

## Gain, volume and crossfading

**Gain** trims the input from −24 to +12 dB, separately from the deck's volume
fader. Optional **Auto Gain** measures the decoded source's RMS and peak level
and applies a bounded correction toward −18 dBFS RMS, with −1 dB peak headroom
and a ±12 dB correction limit. This is static source matching, not LUFS matching
or a continuous speech compressor. Silence gets no boost.

Assign each deck to **A**, **B** or **Thru**. The master A/B crossfader blends
those groups; Thru bypasses it. Equal-power blending is used: at the center each
group is approximately −3 dB, while either end silences the opposite group.
Center resets the slider. Gain, volume, pan, mute/solo, EQ and filtering still
apply to each source. The geometric group pan/volume mixer has been removed.

Three EQ bands, a low/high filter and individual pan remain in Prepare.
**Wobble** modulates the filters: right increases depth and up increases rate.
Equivalent sliders and keyboard controls remain available. Reset mixer restores
levels, input trims, Auto Gain, assignments, pan, EQ, filter and mute/solo, and
dries wobble; it preserves files, cues, tempo, pitch and playback.

## Speed, pitch and SYNC

The manual speed range is selectable: **±8%, ±10%, ±16%, ±25%, ±50% or ±75%**.
The initial range is ±8%; Reset speed returns to 0% / 1×. Changing range clamps
the current manual speed to the chosen range. **Key Lock**, initially enabled,
preserves pitch while changing speed. **Pitch** shifts independently by −12 to
+12 semitones; it has its own reset. With Key Lock off, speed changes pitch too,
and the chosen pitch shift is applied on top.

Pitch processing reuses the repository's MIT-licensed Signalsmith Stretch
worklet. It is created only for armed, playing decks that need it. Scratching
bypasses the stretch processor. Source playback continues while the processor
prepares; a preparation or memory failure reports an error and returns to
ordinary playback with Key Lock off and pitch shift reset. Processing is
memory-bounded; it is not a guarantee of eight stretched voices on every phone.

Imported audio is analyzed in a background worker for BPM and a first-beat
position. An uncertain analysis falls back to **120 BPM**; speech often has no
stable beat. Source BPM and **First beat (s)** remain editable. The return cue is
independent of that grid. Manual grid edits made during analysis are preserved.

One crown chooses the master, initially deck 1. Every other deck independently
opts into **SYNC**, or keeps its own tempo. **SYNC ALL** enables all followers,
or releases them if all are already selected. Selecting a new master leaves
the old one independent and preserves other follower choices. The Master BPM
knob and shared Tap control change the selected master's speed.

The master options gear chooses **Tempo only** or **Beat** sync, and a **1 beat**
or **1 bar** alignment interval. Tempo-only matching preserves source position;
Beat also aligns phase to the analyzed or corrected grid. A bar is four beats,
not a detected spoken phrase. Sync can use the full supported 0.25×–1.75× rate
range even outside the manual slider's selected range; controls display the
actual matched speed. Impossible ratios report a warning.

Sync never starts a paused deck or arms Audio. While the master is paused or
being scratched, followers keep their matched tempo and suspend phase locking.
They rejoin when it resumes. Manual follower speed edits, including Reset speed,
release that follower from sync. A cue point alone is not a beat-grid correction.
There is no metronome, adaptive tempo grid or automatic master election.

## Source length and phone budgets

Imports load and decode **the whole file**. An over-limit source is rejected;
Wobblini does **not** silently load only the beginning. A failed import preserves
the prior source. For a long conversation, prepare shorter excerpts externally.
Streaming long compressed sources with sample-accurate reverse scratching is
not implemented.

| Profile | Encoded file / decoded deck | Shared decoded PCM | Decode rate |
| --- | --- | --- | --- |
| Phone / constrained | 16 MiB / 16 MiB | 64 MiB | 32 kHz |
| Standard | 64 MiB / 64 MiB | 192 MiB | 48 kHz |

There is also a ten-minute duration ceiling and a one/two-channel requirement;
the byte limits commonly apply first. On the phone profile, one source can fit
approximately **131 seconds mono or 65 seconds stereo**, subject to the shared
budget. Eight equally sized sources share roughly **65 seconds mono or 33
seconds stereo each**, before additional processing allocations. Pitch buffers
also count against the shared budget, so available capacity may be lower.

Coarse-pointer devices, devices reporting at most 4 GB memory, or at most four
logical processors select the constrained profile. Before mobile decoding,
metadata inspection rejects clips that could not fit even as mono PCM. Browser
decoders can still allocate temporary memory before exact decoded size is known.

Scratch transfers use bounded two-second windows rather than whole-file copies
on each touch. Long main-thread stalls can exhaust those windows. Graphics are
capped at 20 fps / DPR 1 on constrained devices and 30 fps / DPR 2 otherwise;
offscreen graphics skip redraws. Sound scheduling uses the audio clock.

## Continuous recording

Wobblini defaults to **Browser storage · continuous** in Settings → Recording.
The shared Record button captures the stereo master into IndexedDB as a single
continuous stream. It does not stop and restart at export boundaries. There is
no fixed duration cutoff in this mode; available browser storage and write speed
bound the session. PCM capture and pending writes are bounded in memory.

Stop opens stored recordings. Select a numbered WAV part, prepare it, then tap
Download. Each part is a self-contained stereo 24-bit WAV of up to **32 MiB**;
concatenating their audio data preserves the continuous frame sequence. Export
one part at a time. Starting another take does not delete previous stored takes.
After reload, Settings → Recording → Stored recordings recovers committed audio
without arming Audio. Delete removes a stored take explicitly.

Keep the page open and screen awake. A phone call, backgrounding, audio
interruption, slow writes or exhausted quota can stop capture. Committed chunks
remain recoverable, but uncommitted audio may be lost. Browser data can be cleared
or evicted; export important recordings. This does not promise unattended iOS
background recording. The optional buffered and direct-to-file modes retain
their existing size caps. See [recording modes and limits](main-output-recording.md).

## Alignment with djay

These names describe capabilities rather than a vague “basic” status. Availability
in djay can depend on device and subscription. Wobblini uses an original interface
and implementation inspired by the documented workflow, not proprietary code,
media or artwork.

| Capability | djay for iOS | Wobblini |
| --- | --- | --- |
| Alternative performance views | Classic, Pro and preparation workflows | Classic, Pro, eight-deck overview and single-deck Prepare; same live mix across views |
| Concurrent sources | Up to four decks in the four-deck interface | Eight independent stereo decks |
| Set / Return cue | Set a cue; jump back, with held preview | Separate Set and Return; paused hold previews, playing Return continues |
| Input gain / Auto Gain | Separate gain and automatic matching | Separate trim and static RMS/peak matching; not the same loudness algorithm |
| A/B crossfade assignment | Decks assigned to crossfader sides; Thru bypass | A/B/Thru on every deck, equal-power curve |
| Speed / Key Lock / pitch shift | Speed ranges, pitch preservation and key changes | ±8–±75% ranges; Key Lock; independent ±12-semitone pitch |
| BPM analysis / SYNC | Analysis plus tempo/beat sync options | Worker analysis, editable grid, 120 fallback; optional per-deck tempo/beat sync and 1-beat/1-bar alignment |
| Beat loops | Beat-length loops | Intentionally removed; sources play once |
| Slip | Background timeline resumes after manipulation | Timeline continues during scratching and Cue; file end stops playback |
| Geometric group mixer | No equivalent required for this workflow | Removed; gain, volume, pan and A/B remain |
| Maximum source length | No fixed duration ceiling stated in the cited import documentation | Whole-file decoding with the explicit phone and standard byte limits above; no partial import |
| Continuous master recording | Built-in mix recording; no fixed ceiling stated in the cited guide | Storage-backed capture, numbered WAV parts; storage and browser interruptions bound duration |
| Saved preparation / named cue bank / waveform zoom | Broader library and preparation tools | One session-only return cue per source; no saved preparation, named cue bank or waveform zoom |
| Private headphone audition | Pre-cueing with supported output routing | Cue preview goes to the master mix; no independent headphone bus |

References: [interface and cue controls](https://help.algoriddim.com/user-manual/djay-ios/getting-started/interface),
[appearance / cue layout](https://help.algoriddim.com/user-manual/djay-ios/settings/appearance),
[speed and sync settings](https://help.algoriddim.com/user-manual/djay-ios/settings/general),
[Key Lock](https://help.algoriddim.com/user-manual/djay-ios/dj-tools/key-lock/key-lock),
[independent key changes](https://help.algoriddim.com/user-manual/djay-ios/dj-tools/key-lock/changing-key),
[Slip](https://help.algoriddim.com/user-manual/djay-ios/dj-tools/cueing-looping/slip),
[external tracks](https://help.algoriddim.com/user-manual/djay-ios/music-library/advanced/adding-external-tracks),
[recording](https://help.algoriddim.com/user-manual/djay-ios/mixing-basics/recording).

The browser API compatibility target remains Safari on **iOS/iPadOS 15.4+** over
HTTPS. Current Linux WebKit tests do not establish old-iPhone CPU performance,
touch feel or audible quality. Physical-device and listening checks remain
necessary. Local source files and mix preparation remain session-only; stored
recordings are separate. No microphone, streaming account, stem separation,
private cue output or dedicated DJ-controller mapping is provided.

# MIDI Mixer view in Midiophilia

Open [Midiophilia](../midiphoria.html) and select its **MIDI Mixer** view. Choose a MIDI file in
each deck's song menu, enable **Audio**, then **Play**. The left and right
decks share one beat clock, so changing the master tempo keeps their timing
locked even when the decks use different speed ratios. A zoomed-out map shows the note
density of each voice across the whole arrangement, with muted voices in grey.

## Visualize and play one-shots

The mixer includes Midiophilia's shared-canvas note visualization. Deck A,
deck B and the sample buttons feed the same graphic, with distinct voice
colors. Muted parts disappear from the live graphic while their full-file
activity maps remain available below. Graphics follow note events; rendering
does not schedule the sound.

Heart, Square, Star and the other sample buttons play short MIDI drawings over
the decks. Type a message and send it as an upward-moving playable score, or
use **Play drawing** to play the current freehand canvas. Each shot follows
the shared tempo and finishes once; it does not replace a deck or its loop.
Shots can also play while the decks are paused. Audio remains an explicit,
separate control. Stop shots clears just the sample layer; Pause or Stop
releases both decks and shots.

Up to four shots can overlap; a fifth replaces the oldest. Picture, sample
sound and sample level are live performance controls, retained when recalling
deck mix presets. The sample layer shares the mixer's SoundFont and effects.

## Play an original file

Each deck has a **Play original** button. It opens that deck's unmodified MIDI
in the Visualize view and plays it alone at 1×, including its original tempo
changes, opening silence, instrument changes and controllers. Loop is off.
The single-file player uses the default SoundFont and bypasses mixer pitch,
slip, ratios, mute/solo, crossfade, filter, echo and sample buttons. MIDI files
specify instruments, not recorded instrument audio; the SoundFont still
determines their rendered sound.

The mix pauses with its settings and position retained. Select **MIDI Mixer**
to return. If Audio is off, Play original keeps it off and waits for explicit
Audio activation; Stop or Reset cancels that pending play request.

## Combine arrangements

- Choose songs independently for decks A and B, or open local MIDI files.
  Local files stay in this browser session and are not uploaded.
- **Master tempo** spans 30–300 BPM. Take either file's source tempo with its
  tempo button, adjust the master directly, or use the shared **Tap** control.
- **Tempo ratio** runs either deck at ¼×, ½×, 1×, 2× or 4× the shared tempo.
  For example, double-time drums from A stay synchronized with half-time guitar
  from B. Changing a ratio keeps the current source position and changes its speed.
- Use each channel's **Mute** and **Solo** to select parts. For example, solo
  drums in A and mute drums in B to hear A's rhythm with B's other instruments.
- Change an individual channel's General MIDI patch to replace its sound.
  Keep the file's patch when its original program changes should be heard.
- **Transpose** moves a deck by up to 24 semitones in either direction.
  Percussion is excluded, keeping drum note assignments intact.
- **Slip** moves a deck through its score while the master clock keeps running.
  Positive offsets bring a later part of the source forward; negative offsets
  move backwards. Bar-sized offsets use that source's initial meter.
- Deck gain and the crossfader balance the selected parts. Looping repeats
  arrangements; the default loop rounds up to the next initial-meter bar.
  Set a separate loop region in either deck to keep a chosen phrase repeating.
- Click a deck's map to jump to a section; drag to set its loop. Position controls
  and arrow keys also seek through the score. Muting a voice greys its map row while
  keeping its original density visible for comparison.
- Choose a local SF2 or SF3 SoundFont, up to 32 MB, to change the available
  instrument sounds. Shared filter and delay controls shape the mixed output
  without creating another audio context. The import applies to both mixer decks;
  it does not replace the visualizer/drawing SoundFont. This version offers
  MIDI seeking, not reverse-audio vinyl scratching.

Audio and Play are separate. Starting playback, loading a file, changing a
preset or tapping tempo does not arm Audio. Turning Audio off leaves the
visual transport running. Master output recording uses the standard red
Record button in the masthead.

## Inspect the MIDI

The inspector separates source information from the live remix controls.
Tempo and meter maps describe the original file even when both decks follow
the chosen master tempo. Channel rows identify the instruments and note
activity rather than treating every track as a separate instrument.

Embedded key signatures are shown when present. A key inferred from note
pitch classes and their durations is labeled **Estimated**. This is a guide
for trying transpositions; it is not a verified harmonic analysis and cannot
describe every modulation in a complex score.

General MIDI patches, channel controllers, bank changes, pitch bend and
sustain are retained. File SysEx is not replayed into the shared mixer: a
source cannot reset the other deck's synthesizer state. As a result,
source-specific GS/XG SysEx effects do not transfer into the remix.

## Scope and timing

This view mixes two MIDI-file decks inside the existing Midiophilia page.
Midiophilia retains its live-note and drawing views; the mixer does not add
a separate catalogue instrument, browser route or MIDI hardware client.
The mixer has no hardware MIDI output or WAX host adapter.

Drawing and letter/shape generation remain inside Midiophilia. Draw freehand
or use the stamps, then hear the resulting MIDI through the same page's
SoundFont playback. See [Midiophilia's drawing and text controls](midiphoria.md).

Both decks are scheduled in one AudioWorklet using the same audio-frame beat
clock. Canvas rendering follows that clock and does not schedule the notes.
The original tempo maps remain available for inspection, while playback locks
the score events to the master beat grid. Loops and bar slips use the initial
time signature; later meter changes are displayed in the source inspector.

The mixer accepts Standard MIDI Files in format 0 or 1 with ticks per quarter
note. Format 2 (independent timelines) and SMPTE-time files must be converted
before mixing. Each file is limited to 10 MB, 1,024 tracks, 1.2 million events,
600,000 notes and 64 distinct MIDI channels across ports. Oversized files are
rejected with an error rather than silently truncated.

SoundFont synthesis shares a maximum of 192 voices across both decks and all
four sample slots. One-shots are bounded to 2 MB, 32,768 notes, 131,072 events,
16 channels and 512 beats each, with a shared 2,048-event sample budget per
audio quantum. An
overload guard permits up to 8,192 events per deck per 128-frame audio quantum;
events beyond that bound are skipped and held voices are released to prevent
stuck notes. The engine reports skipped events. Analysis retains every accepted
note for the density map, while live note-event telemetry are bounded to 256
events per 30 Hz report. Those display limits do not remove notes from the
source analysis.

## Assets and credits

The song menus reuse [Midiophilia's collection](../assets/midiphoria/collection.json),
including each arrangement's source, author, license and download record.
No new song collection is bundled for the mixer. See the
[collection and arrangement credits](midiphoria.md#collection-and-arrangement-quality)
for the popular-song, experimental, Black MIDI and orchestral sources.

Sound comes from the same bundled TimGM6mb SoundFont. Its unmodified editable
SF2, copyright record and GPL-2.0 license are under
[`assets/midiphoria/soundfont/`](../assets/midiphoria/soundfont/COPYRIGHT.txt).
The owned mixer uses SpessaSynth Core 4.3.22 and stb-vorbis 0.0.6 under
Apache-2.0; [pinned bundle provenance](../src/instruments/midi-mixer/vendor/README.md)
and the license accompany the runtime.

The mixer and its rectangular renderer are independent Morphazoid code.
Midiophilia's original visual inspiration remains
[Nicholas C. Stanley's Midiphoria](https://github.com/NicholasCStanley/midiphoria).

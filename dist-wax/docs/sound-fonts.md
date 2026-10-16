# Sound Fonts

Open `/sound-fonts.html`, or follow **Sound Fonts** below the home catalogue.
This is a shared browser-local SF2/SF3 collection and a sample-to-SF2 creator. It does not add a
server, account, cloud library, or a new catalogue instrument.

## Collect and play

**Explore** opens with 814 searchable presets: 811 from the eight bundled banks
and three Morphazoid originals. The **Complete GM banks** choices appear first:
TimGM6mb, GeneralUser GS, FluidR3Mono GM and FluidR3 GM. Each supplies all 128 GM
instruments and standard drums. Choosing a bank filters its presets and opens
its first GM piano. Use **SoundFont → All SoundFonts** to return to every sound;
combine the SoundFont, instrument-family and search filters to explore.
Selecting a preset downloads its bank once and saves it to the
collection. Presets are identified by bank/program, independent of their SoundFont
storage order. **Next preset** steps through the filtered results.

**Find sounds** groups complete GM banks before single-instrument fonts.
The complete banks are TimGM6mb (136 presets) and these three larger banks:

| Bank | Format | Download | Presets |
| --- | --- | --- | --- |
| GeneralUser GS 2.0.3 | SF2 | 30.8 MiB | 287 |
| FluidR3Mono GM 2.312 | SF3 | 13.9 MiB | 195 |
| FluidR3 GM 3.1 | SF3 | 23.1 MiB | 189 |

Each new bank includes all 128 GM programs and standard percussion. Additional
presets include alternate instruments and drum kits. **Add to collection**
saves the bank in browser storage; subsequent clicks open the saved entry.
**Download SF2/SF3** exports the exact bundled file. Banks load on demand.
Credits and license links accompany every bank. Jaw Harp maps different
articulations to keys, rather than transposing a single pitched sound.
Kalimba, Ocarina, Jaw Harp and Lately Bass appear under **Single-instrument
fonts**. A single-instrument font contains one preset, which can still play
melodies and chords; it does not mean one-note polyphony.

The selected font is labelled **Complete GM bank**, **Single instrument**, or
**SoundFont bank**. The download description states whether the file contains
one instrument or every preset in a bank. Previewing one GM preset does not
extract it: downloading saves the complete original SF2/SF3, with its samples
and instrument settings. Created fonts export their single instrument as SF2.

Import SF2 or compressed SF3 (up to 128 MiB each, eight files per import), or
save an HTTP/HTTPS source link to revisit later. Search names, creators, and
notes; filter imports, creations, links, and favorites. Edit descriptive
metadata beside the selected font. Metadata edits preserve the original
download bytes, including their embedded name and credits.

Audio starts off. Use the **Audio** speaker button in the masthead,
then select a preset to hear it, press **Preview sound**, or use the two-row
computer keyboard. The shared Faves toolbar provides stereo output meters,
the master volume knob, Audio, and Settings. The visible keys also accept pointer and
keyboard activation. Stop and Escape release previews; leaving or hiding the
page stops active notes. No microphone permission is requested.
The keyboard follows each bundled preset's playable register, including drum
keys and the ocarina's higher range. Unmapped notes are disabled. Preview notes
are validated against both key and velocity ranges.

The page uses the shared SpessaSynth SoundFont player for SF2/SF3 decoding,
modulators, filters, envelopes, looping and effects. Original bank bytes remain
intact. Fonts created or imported here are also available in **BLECH MIDI →
Files → GM SoundFonts → SoundFont bank** and **Midiophilia → MIDI Mixer →
SoundFont & live effects → SoundFont bank**. Accepted imports in either instrument
appear here too. Other instruments
can adopt the [shared picker, library service and playback adapter](shared-sound-fonts.md).

MIDI Mixer supports choosing a program from the active bank for each MIDI
channel. Both consumers currently load one SoundFont bank for the whole
instrument; they do not assign separate SF2/SF3 files per channel or layer a
single-instrument font over the GM bank. With a single-preset bank, missing
programs and drum kits can fall back to that same sound. Use a complete GM bank
to retain a full MIDI arrangement's instrument roles. A player that supports
fonts per track/channel, or an editor that adds the custom preset to a GM bank,
can combine a single-instrument font with other sounds. Downloading itself does
not assign any channel. The page's **Using SoundFonts: MIDI channels and
downloads** guide explains these distinctions alongside the collection.

The lower-page **Use your sounds in other instruments** section links to the
existing BLECH MIDI and Midiophilia shared-bank controls. It also shows a
clearly labelled future example: GM piano on channel 1, a created sample
instrument on channel 2, and GM drums on channel 10. SpessaSynth supports loading
multiple banks and assigning their presets independently, but Morphazoid still
needs per-channel font selection, routing and saved state in its shared utility
and consumers. The example is explanatory, not an active routing control or a
claim that separate fonts per channel have shipped.

## Create a Sound Font

The three starter sounds and workshop templates are original deterministic
additive synthesis, not third-party recordings or authentic instrument models.
Brightness changes partial amplitudes; length controls the generated sample.

To use a recording, open **Create**, choose **Your sample**, and select an
**Audio sample** file. Browser-decodable audio files up to 20 MiB and 30 seconds
are supported.
The workshop decodes it at 22,050 Hz, mixes channels to mono, caps peaks, and adds
short edge fades. Choose the sample's recorded root pitch. One sample is mapped
across MIDI keys 0–127. Attack and release become instrument generators.

**Create sound font** stores an actual SF2 in the collection. **Download SF2**
exports it for a SoundFont player or further editing. This first workshop makes
one preset from one sample; it does not yet edit multisample zones or existing
banks. Keep source sample rights and attribution with the font.

## Persistence and limits

IndexedDB database `morphazoid-sound-fonts-v1` stores metadata separately from
binary files. Saves complete only when their transaction commits. Clearing
browser/site data removes the collection; separate browsers, hosts, and ports
have separate collections. Download fonts for backup or sharing. If IndexedDB
cannot open, a visible temporary-session notice explains that files must be
downloaded before closing. Quota failures are shown without claiming a save.

Full-bank playback is limited to 64 voices and a 15-second maximum held note.
The in-memory PCM fallback retains its 16-source cap and bounded buffer cache.
Oversized or malformed SoundFont data is rejected before unsafe indexing. Preview audio is
scheduled on the audio clock and does not depend on waveform drawing.
Single notes use a practical playback level; a compressor and a 0.98 peak guard
bound combined voices before the master volume.

## Sources and validation

SF2 layout follows the [Creative/E-mu SoundFont specification](https://www.synthfont.com/sfspec24.pdf).
The four FreePats banks are unmodified CC0 releases; original notices, exact
source URLs, and file/archive hashes are retained in
[`assets/sound-fonts/provenance.json`](../assets/sound-fonts/provenance.json).
TimGM6mb reuses the existing GPL-2.0-only bank and notices in
[`assets/midiphoria/soundfont/`](../assets/midiphoria/soundfont/).
GeneralUser GS retains its custom license and author credits. The two Fluid
banks retain their MIT notices. FluidR3 GM is redistributed as an SF3 converted
from the original SF2; compressed audio is lossy, while instrument programming
and loop points are preserved. Pinned sources, original and shipped hashes,
conversion instructions and upstream metadata caveats are recorded beside each
bank under `assets/sound-fonts/` and in `provenance.json`.

Focused verification:

```sh
node --test tests/sound-font-*.test.mjs
npx playwright test e2e/sound-fonts.spec.mjs e2e/sound-font-shared.spec.mjs
```

The browser suite checks actual import/export, uploaded audio, IndexedDB reload,
favorites, source links, deletion cancellation, explicit Audio arming, measured
signal and silence, and desktop/phone portrait/phone landscape layouts. It does
not substitute for human listening or physical touch-device checks.

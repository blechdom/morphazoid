# Sound Fonts

Open `/sound-fonts.html`, or follow **Sound Fonts** below the home catalogue.
This is a browser-local collection and a small SF2 workshop. It does not add a
server, account, cloud library, or a new catalogue instrument.

## Collect and play

**Explore** opens with 143 searchable presets: 140 from the five bundled banks
and three Morphazoid originals. Filter by instrument family or search for an
instrument. Selecting a preset downloads its bank once and saves it to the
collection. Presets are identified by bank/program, independent of their SF2
storage order. **Next preset** steps through the filtered results.

**Find sounds** includes five free banks: TimGM6mb (136 General MIDI presets),
FreePats Kalimba, Ocarina, Jaw Harp, and Lately Bass. **Add to collection** loads
the original SF2 into browser storage; subsequent clicks open that saved entry.
**Download SF2** exports the original file directly. Banks load on demand.
Credits and license links accompany every bank. Jaw Harp maps different
articulations to keys, rather than transposing a single pitched sound.

Import uncompressed SF2 files (up to 128 MiB each, eight files per import), or
save an HTTP/HTTPS source link to revisit later. Search names, creators, and
notes; filter imports, creations, links, and favorites. Edit descriptive
metadata beside the selected font. Metadata edits preserve the original
download bytes, including their embedded name and credits.

Audio starts off. Use **Enable audio** beside Preview or the masthead speaker,
then select a preset to hear it, press **Preview sound**, or use the two-row
computer keyboard. The shared Faves toolbar provides stereo output meters,
the master volume knob, Audio, and Settings. The visible keys also accept pointer and
keyboard activation. Stop and Escape release previews; leaving or hiding the
page stops active notes. No microphone permission is requested.
The keyboard follows each bundled preset's playable register, including drum
keys and the ocarina's higher range. Unmapped notes are disabled. Preview notes
are validated against both key and velocity ranges.

The player previews PCM sample zones with key and velocity ranges, pitch,
panning, loop points, attack, and release. It is not a complete SoundFont synth:
modulators, filters, effects, some envelope stages, exclusive classes, and some
generator offsets are omitted or reported. Unsupported banks fail visibly.
Preview warnings describe limitations; original imported files remain intact.

## Make a font

The three starter sounds and workshop templates are original deterministic
additive synthesis, not third-party recordings or authentic instrument models.
Brightness changes partial amplitudes; length controls the generated sample.

Alternatively, load a browser-decodable audio file up to 20 MiB and 30 seconds.
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

Audio is limited to 16 simultaneous sample sources, including release tails,
with a 15-second maximum note and a bounded PCM buffer cache. Oversized or
malformed SF2 data is rejected before unsafe indexing. Preview audio is
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
The additional links lead to [GeneralUser GS](https://schristiancollins.com/generaluser)
and [Polyphone](https://www.polyphone.io/en/documentation/manual/online-repository).
Those additional collections are not bundled or automatically downloaded.

Focused verification:

```sh
node --test tests/sound-font-codec.test.mjs tests/sound-font-preview.test.mjs
npx playwright test e2e/sound-fonts.spec.mjs
```

The browser suite checks actual import/export, uploaded audio, IndexedDB reload,
favorites, source links, deletion cancellation, explicit Audio arming, measured
signal and silence, and desktop/phone portrait/phone landscape layouts. It does
not substitute for human listening or physical touch-device checks.

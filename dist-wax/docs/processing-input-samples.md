# Bundled processing inputs

Rust L-system Delay and Synthesaurus share 33 local demo inputs: the original
nine choices plus 24 additions. Choose **Built-in samples** in L-system Delay,
or **Sample loops** in Synthesaurus, then select a sound. Enable Audio explicitly;
Synthesaurus also uses Play. Selecting a sample with Audio off does not fetch or
start it. Only the selected sound is decoded, and playback needs no external
server or Freesound account.

The additions are:

- Nature recordings: coyote howls, frog chorus, humpback whale song, house cricket.
- Recorded effects: sad trombone, record scratch, air horn, rimshot, applause and
  cheers, slide whistle.
- Recorded instruments: tabla rhythm, an original phrase arranged from five
  artist-recorded toy-gamelan metallophone notes.
- Original synthesized phrases: classical clockwork, rock & roll shuffle,
  country porch picking, 80s synth-pop homage, sparkle unicorn, midnight jazz,
  dub skank, disco strut, chiptune quest, cloud choir, acid circuit, bossa sunrise.

The **80s synth-pop homage** is original music. It contains no Rick Astley
recording, song melody, lyrics or voice imitation. The toy metallophone is not
a traditional gamelan ensemble recording. Synthesized genre and instrument names
describe artistic approximations, not acoustic performances.

The recorded additions carry individual CC0, CC BY or CC BY-SA licenses. The
original synthesized additions use the repository's MIT license. Credit links
appear beside the selected input, and source pages, transformations and hashes
are bundled with the media:

- [Nature credits](../assets/input-samples/nature/CREDITS.md) and
  [excerpt provenance](../assets/input-samples/nature/sources.json).
- [Recorded effects and instruments](../assets/input-samples/recorded/SOURCES.md)
  and [source provenance](../assets/input-samples/recorded/provenance.json).
- [Original music credits](../assets/synthesis/extra-loops/CREDITS.md) and
  [complete render recipes](../assets/synthesis/extra-loops/renders.json).

Short files keep the added bank below 18 MiB. The existing loader applies one
static gain to each input, preserving dynamics without added compression. Original
musical loops preserve their bar length and wrapped release tails; effects and
nature clips include a short release gap when repeated. Loop/restart/stop policy,
input/output gain, microphone permissions and delay voice allocation remain under
their existing owners. No additional realtime synthesizer or delay voice is
allocated to play a prerecorded sample.

Synthesaurus also includes one complete processing scene for each new sound,
bringing its sample-processing scenes to 36. These recall their sample and
processor settings while leaving Audio, Play and master output under the
performer's control. The L-system tree presets remain independent of input.

Automated checks cover asset identity, decoding, finite and bounded signal levels,
menu reachability and input lifecycle. Human listening and physical-device
acceptance remain unperformed.

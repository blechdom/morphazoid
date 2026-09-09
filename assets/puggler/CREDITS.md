# Puggler sound recordings

All eight bundled recordings are **CC0 1.0 Universal**. See
[the included license](CC0-1.0.txt) and
[Creative Commons' CC0 deed](https://creativecommons.org/publicdomain/zero/1.0/).
No audio is taken from *Xavier: Renegade Angel*, a commercial song, or a game.
Samples load from this site's own assets only, after explicit Audio activation.

## Recorded acoustic drums

Drum samples by **Karoryfer Samples**, selected from Big Rusty Drums, Unruly
Drums, and Swirly Drums. The creator confirms that all their free libraries are
CC0: <https://shop.karoryfer.com/pages/free-samples>.
[Big Rusty Drums](https://shop.karoryfer.com/pages/free-big-rusty-drums) records
an oversized Polish drum kit and modern cymbals; these are acoustic drum
recordings, not a synthesis approximation.

Retrieved from the [Stargate public-domain sample pack](https://github.com/stargatedaw/stargate-sample-pack/tree/dbfd6ec52d4ed53b60bdbea5fc6adf295127c027/stargate-sample-pack/karoryfer),
commit `dbfd6ec52d4ed53b60bdbea5fc6adf295127c027`.
The pack's Karoryfer readme identifies the source libraries, and its root
`LICENSE` is CC0 1.0. Original filenames below are relative to
`stargate-sample-pack/karoryfer/`.

| Bundled file | Original filename | Kept duration |
| --- | --- | --- |
| kick.wav | kicks/kick_Szpaderski_24_dampened.wav | 0.65 seconds |
| snare.wav | snares/snare_Pearl_alumunum_14x8.wav | 0.80 seconds |
| crash.wav | cymbals/crash_BRD_17.wav | 1.80 seconds |
| tom.wav | toms/tom_Szpaderski_18.wav | 0.80 seconds |
| hat.wav | hihats/hihat_BRD_closed.wav | 0.30 seconds |

## Recorded audience voices

- **oi.wav**: [Oi.wav by rhink](https://freesound.org/people/rhink/sounds/245867/),
  August 31, 2014; CC0. The creator labels the clip “Oi.” Retrieved from the
  [HQ preview](https://cdn.freesound.org/previews/245/245867_4516680-hq.mp3),
  with initial silence removed (0.1075 seconds), converted to mono 22050 Hz
  PCM, peak normalized, and given a 3 ms onset and 18 ms release fade. The
  remaining 0.4498-second call is repeated three times with level accents and
  pauses; its articulation is retained rather than replaced with formant synthesis.

- **boo.wav**: [Booing Crowd by NeoSpica](https://freesound.org/people/NeoSpica/sounds/504621/),
  January 29, 2020; CC0. The creator describes an audience booing, mixed from CC0
  sounds. Kept 2 seconds starting at 0.35 seconds from the [HQ preview](https://cdn.freesound.org/previews/504/504621_7704891-hq.mp3).
- **woo.wav**: [Woo 2.wav by jayfrosting](https://freesound.org/people/jayfrosting/sounds/333421/),
  January 19, 2016; CC0. A small audience yelling “woo.” Kept 1.8 seconds from
  the initial audible onset of the [HQ preview](https://cdn.freesound.org/previews/333/333421_5884138-hq.mp3).

## Processing and authored phrases

Bundled recordings were decoded/resampled by Chrome OfflineAudioContext,
converted to mono 22050 Hz 16-bit PCM WAV, normalized to a 0.92 peak, trimmed,
and given a 3 ms onset and 60 ms release fade. They may be pitched, panned,
compressed, filtered, or shortened during playback.

`src/puggler-samples.js` authors the other two sounds from scratch under the
repository's MIT license: a distorted plucked-string power-chord phrase,
a plucked bass phrase. They are rendered into small PCM buffers at Audio
activation. OI now uses the sampled call above; WOO uses the existing audience
recording. Vocal phrases avoid guitar overdrive and use gentle compression.
Their path-driven playback rate stays between 0.84× and 1.2× to retain the
recorded mouth resonances and complete syllables even at extreme juggling tempos.

Only airborne objects (including audience lobs and throws to the crowd) sound their looping
phrase. Rider and audience catches trigger the selected drum; drops trigger the audience boo.
Object position controls pan, height changes phrase playback pitch/speed, and
velocity changes phrase rate and brightness. Juggling pause releases riffs
while catch tails and visible, model-triggered crowd cheers/boos may continue.
Explicit Audio mute, zero level, and hidden-page `active: false` silence all
audio. There is no independent backing track or crowd loop.
Human listening approval remains a separate check from automated
finite-output and lifecycle tests.

# SPARTIAL organ voicing: research and model limits

SPARTIAL's organ section provides original additive registrations inspired by
tonewheel organs and pipe families. It retains the instrument's central idea:
individual spectral components can occupy different speakers. It is not a
reconstruction of a particular Hammond, Leslie cabinet, pipe rank, or room.

## Primary-source research ledger

Research checked on 11 October 2026. No media, sampled pipes, impulse responses,
manufacturer preset banks, or third-party implementation code were incorporated.

| Source | What was verified | Design consequence |
| --- | --- | --- |
| [Sormena Project — Additive Synthesis to Create Pipe Organ Sounds](https://www.youtube.com/watch?v=nlR2a7SC4xs) | The public YouTube page metadata and oEmbed identify the title, creator, and 273-second duration. The creator's description discusses balancing sine/triangle overtones for a sustained pipe-organ approximation and adding effects. | Use a sine foundation and triangle-like harmonic magnitudes as one starting point for original flute colors. This is conceptual inspiration, not a reproduction of the video's patch. |
| [Hammond SKX — Drawbars & Percussion](https://hammondorganco.com/wp-content/uploads/2022/03/SKX-03-DRAWBARS-PERCUSSION.pdf), pp. 3–6, 16–17, 31, 35 | Nine footage controls mix pitched components. Hammond describes attack/release key click, decaying second/third-harmonic percussion, and classic touch-response percussion that retriggers after all keys are released. | Keep registration, click, and percussion conceptually distinct. The footage map below uses ideal harmonic ratios; implementing click or percussion does not establish complete Hammond authenticity. |
| [Leslie 3300 owner's manual](https://hammondorganco.com/wp-content/uploads/2022/09/3300.pdf), pp. 4–7 | The cabinet has separate high horn and low drum rotors, independent slow/fast and rise/fall adjustments, and drive controls separate from overall volume. | A rotary approximation needs separate high/low motion and gradual speed changes. Drive should change tone without requiring the performer to raise master volume. |
| [Leslie 2101mk2 owner's manual](https://hammondorganco.com/wp-content/uploads/2022/09/Leslie-2101mk2.pdf), p. 16 and appended corrections | The manufacturer specifies 700/800/1000 Hz crossover choices and separate rotor rise, fall, and brake timing. Some earlier default values are superseded by the correction pages. | An approximately 800 Hz split and independent rotor acceleration are defensible design choices. No claim is made that one chosen setting reproduces a specific physical cabinet. |
| [Colin Pykett — A technique for simplifying parameter estimation in synthesised organ pipe sounds](https://www.colinpykett.org.uk/parameter-estimation-in-synthesising-pipe-organ-sounds.htm) | The author's documented synthesis method shapes sustained harmonic spectra with two slopes, a breakpoint, and optional odd/even balance. The article also discusses articulation, small fluctuations, and noise as additional aspects. | A few understandable spectral controls can create distinct original pipe families without copying an analyzed pipe spectrum. The article's broad fidelity claims are not claims made for SPARTIAL. |

The Sormena video description was accessible; usable captions and the complete
spoken lesson were not. Requests to the linked [Sormena.org](https://sormena.org)
site failed during this research. Consequently the implementation does not
attribute exact settings, a particular effect chain, or a transcript-derived
technique to that lesson. No listening assessment of its full video is claimed.

## Footages and the 32-partial bank

In the ordinary **Partials** mode, existing synthesis remains unchanged. Organ
modes use a base frequency one octave below the played note: the played note is
the **8′** pitch, and the bank begins at **16′**. This represents both the
sub-octave and the fifth correctly instead of mistaking drawbar order for
harmonic order.

| Drawbar | Ratio to played note | Partial on the 16′ base |
| --- | ---: | ---: |
| 16′ | 0.5 | 1 |
| 5⅓′ | 1.5 | 3 |
| 8′ | 1 | 2 |
| 4′ | 2 | 4 |
| 2⅔′ | 3 | 6 |
| 2′ | 4 | 8 |
| 1⅗′ | 5 | 10 |
| 1⅓′ | 6 | 12 |
| 1′ | 8 | 16 |

The helper uses nine integer levels from 0 through 8, with zero silent. Its
linear amplitude mapping, `level / 8`, is a SPARTIAL control choice rather than
a measured vintage drawbar taper. Tonewheel mode places one sinusoidal component
at each selected ratio. Pipe mode adds a harmonic family above each selected
footage and combines coincident frequencies into the same partial slot.

All pipe stops share the 32-component bank. This means the 16′ stop can have up
to 32 represented harmonics, an 8′ stop up to 16, and a 1′ stop only two. These
are available components before the DSP's Nyquist limit and active-partial
count apply. The module does not synthesize 32 independent harmonics for every
stop. It also does not model separately detuned ranks at coincident pitches.

Each pipe stop's represented spectrum has an absolute-amplitude sum of
`level / 8`. Summing nine stops therefore has a conservative bound of nine.
The engine owns the final normalization, smoothing, painted gain attenuation,
and out-of-band rejection. Normalizing by at least one, rather than always
dividing by the current sum, allows a solitary quiet drawbar to remain quiet.
All stops at zero produce a zero bank. Painting a partial remains an attenuation
of the derived bank; it does not rewrite the registration.

## Original pipe colors and registrations

The formulas are independently authored approximations, not sampled or fitted
spectra from the sources:

- **Open flute:** strong sine foundation, weak triangle-like odd harmonics, and
  a small even-harmonic component. “Triangle-like” describes magnitudes; the
  helper does not reproduce a triangle oscillator's alternating phase signs.
- **Stopped flute:** odd harmonics only, with brightness controlling their
  decay. This idealized hollow spectrum is not a claim about every stopped pipe.
- **Principal:** both harmonic groups with a moderate lower slope and steeper
  upper rolloff.
- **String pipe:** a restrained fundamental and raised middle harmonics,
  followed by upper rolloff.
- **Reed pipe:** a broad group of strong lower/middle harmonics followed by a
  steeper decline.

Brightness changes a family's harmonic envelope. It does not detune harmonics
or increase the stop's amplitude budget. All families remain exact harmonic
series until the performer changes the instrument's tuning controls.

The original registrations include four tonewheel starting points — clear,
late jazz, gospel lift, and copper drive — plus quiet flute, hollow wood,
principal chorus, silver strings, reed crown, and traveling tremulant. Their
registrations, effect amounts, and envelopes were chosen for this instrument;
they were not transcribed from Hammond preset tables or the Sormena lesson.
These are starting points requiring musical listening, not verified imitations
of named historical registrations.

Recipes restore an unpainted 32-partial bank, harmonic spacing, zero cascade,
and their own articulation/modulation/effect settings so a previous fingerprint
does not accidentally silence a stop. They omit master level, Audio state,
speaker layout, notes, and the main rotation transport. Section dice randomize
only organ mode, stop levels, pipe family, and brightness from a reproducible
seed, and ensure at least one stop is active.

## Modulation and approximation boundaries

Coherent shallow pitch/amplitude movement can suggest an organ tremulant.
Phase offsets that travel across partials deliberately extend this into a
SPARTIAL effect; independent harmonic ripples are not presented as measured
pipe behavior. The existing spatial rotation and a Leslie-inspired rotary
effect serve different purposes: changing speaker placement alone does not
reproduce a rotating cabinet's pitch and amplitude changes.

The organ voicing helper itself does not implement tube circuitry, cabinet
acoustics, tonewheel foldback, a shared electromechanical tone generator,
contact sequencing, scanner vibrato, wind-system coupling, or room acoustics.
Related DSP controls remain bounded creative approximations. Model and browser
tests can establish ratios, bounds, control response, and lifecycle behavior;
they cannot establish timbral authenticity or physical surround quality without
the corresponding listening and device checks.

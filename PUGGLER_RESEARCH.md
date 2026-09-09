# Puggler: research and implementation ledger

The instrument makes physical contacts into drums and airborne paths into a
punk band. User direction: **thrash and trash**; giant awkward props, flailing
performers, a filthy venue, musical phrases, passing, and crowd boos.

## Sources and interpretation

| Topic | Evidence | Implemented interpretation / limits |
| --- | --- | --- |
| Puggler | Adult Swim, [Escape from Squatopian Freedom](https://www.adultswim.com/videos/xavier-renegade-angel/escape-from-squatopian-freedom), [official video around 90 seconds](https://www.youtube.com/watch?v=KW0OHJXVv14&t=90s) | Orange curls, angular human face, towering green hat with pale ringed dots, broad dark brim, purple/pink sleeveless stripes, lime tie, burgundy trousers, red unicycle. Original Canvas likeness; no extracted model, episode picture, dialogue, or music. Roxy and Moss are original adult punk/rave partners. |
| Kick Man | [Museum of the Game](https://www.arcade-museum.com/Videogame/kick-man), [Midway manual scan](https://www.aurcade.com/games/manuals/00000118.pdf), [Commodore instructions](https://mocagh.org/forsale/kickman-manual.pdf) | 1981 arcade unicycle, left/right movement, falling balloons, head stack, emergency kick. Optional balloon mode retains an eight-balloon flourish alongside juggling. Scoring and replacement mechanics are invented here. |
| Siteswap | [Juggling Lab notation](https://jugglinglab.org/html/ssnotation.html), [generator](https://jugglinglab.org/html/ssgenerator.html) | Throw height denotes a future beat/hand reservation. Odd asynchronous throws cross hands; even throws return. Ground-state chunks can concatenate while retaining legal reservations. Arbitrary rotations or unrelated patterns cannot safely concatenate. |
| Rhythmic phrasing | Daniel Simu, [the rhythm problem](https://danielsimu.nl/research/posts/siteswap_and_rhythm_problem/), [rhythm solutions](https://danielsimu.nl/research/posts/siteswap_and_rhythm_solutions/) | Catch and throw rhythm are different; dwell, grouping, gaps, and double catches matter. Our verse/fill/break/refrain sequences combine compatible siteswap chunks, including rests and holds. They are authored compositions, not transcriptions of traditional musical routines. |
| Passing | Mark Weston, [Passing Patterns Compendium](https://jugglingedge.com/pdf/passingpatternscompendium.pdf) | Passing cadence and running-gap ideas inform trading every throw, every third throw, or the second half of an eight-beat phrase. Our ensemble shares **one to ten total props** and adapts a global siteswap schedule; it is not a canonical six-club passing simulator. |
| Juggling sonification | Arthur Wagenaar, [Juggling as a controller of electronic music](https://www.arthurwagenaar.nl/wp-content/uploads/Juggling-as-a-controller-of-electronic-music.pdf) | Contacts can trigger samples while trajectories modulate sound. Here, a prop has independent drum and airborne riff assignments, preserved when a replacement changes its physical material. |
| State planning | [Beyond the Cascade: Juggling Vanilla Siteswap Patterns](https://arxiv.org/abs/2410.19591) | Supports planning legal transitions rather than choosing throw digits independently. Our small deterministic generator uses a hand-validated compatible chunk bank, not the paper's robot implementation. |
| Motion | [NASA flight equations with drag](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/flight-equations-with-drag/) | Shared gravity; drag acceleration depends on mass. NASA describes quadratic aerodynamic drag; the browser uses an exact **linear-drag approximation**, invented masses, and world units. This is a stylized musical game, not calibrated biomechanics. |
| Recorded sounds | [Karoryfer free samples](https://shop.karoryfer.com/pages/free-samples), [NeoSpica crowd boo](https://freesound.org/people/NeoSpica/sounds/504621/), [jayfrosting woo](https://freesound.org/people/jayfrosting/sounds/333421/) | Five acoustic drums and two audience recordings are CC0. Exact source filenames, pinned source commit, processing, and license are in [sound credits](assets/puggler/CREDITS.md). Guitar/bass and an O→I formant chant are original synthesis; the chant is an approximation of “oi,” not recorded human speech. |

## Fixed and phrased patterns

| Objects | Fixed patterns | Compatible phrase chunks |
| --- | --- | --- |
| 1 | Zip `1`, alternating toss `300`, one-hand toss `2T0` | `1`, `20`, `300`, `4000`, `50000` |
| 2 | Columns `2T`, together columns `(2T,2T)`, shower `31`, two in one hand `40` | `2`, `31`, `330`, `420`, `4400`, `411` |
| 3 | Cascade/reverse `3`, shower `51`, half box `441`, high/middle/zip `531` | `3`, `441`, `531`, `423`, `522`, `55500`, `45141` |
| 4 | Fountain `4`, together fountain `(4,4)`, shower `71`, `534` | `4`, `534`, `552`, `633`, `5551`, `6424`, `7531`, `55550`, `7441` |

`T` explicitly marks a tossed 2, whose ordinary siteswap interpretation is a
hold. One/two-prop phrase 2s are tossed; phrase 2s are held for three or more props.
Zero reserves an empty beat. Synchronous patterns release both hands every two
beats. Arm geometry is authored separately from the numerical siteswap.

The 16-beat verses are `3001400030050000`, `3133031420440031`,
`3334415314235223`, and `4445555064244444` for one through four objects.

Counts five through ten add a cascade/fountain, shower, and (for even counts)
a synchronous fountain, bringing the fixed bank to 31 patterns. In source,
base36 siteswap encodes values above nine (`a`=10, `b`=11, `c`=12); the interface
shows spaced decimal throw values. For `n` objects, the extended chunk bank is:
`[n]`, `[n+1,n-1]`, `[n+1,n+1,n-2]`, `[n+2,n,n-2]`,
`[...(n-2 copies of n+2),2,2]`, `[...(n-1 copies of n+2),2,0]`,
and `[...(n copies of n+2),0,0]`. Each is validated to return to ground state.
The 16-beat high-count verse is `[(12-n copies of n),
(n-1 copies of n+2),2,0,n+1,n+1,n-2]`: a hold, rest, and closing fill.
Shower `[2n-1,1]` remains a separately initialized excited-state loop.
The evolving mode cycles through a steady opening, two varied compatible
chunks, and a short return. It avoids consecutive identical varied chunks,
keeps only the current chunk, and uses a seeded generator for reproducibility.
It can continue generating new phrasing without an ever-growing event list.
Each airborne sound retains its sample cursor across catches; held time pauses
that cursor, so even short flights develop through their riff.

## Play and causality

- Default: six props, automatic Roxy and Moss, 16-beat phrase, 360 siteswap beats/min,
  throw height 1.8×, catch reach 42 world units, throw wildness 40%, Audio off, output 48%, catch drums 125%.
- Each prop independently chooses physical material, catch drum
  (kick/snare/crash/tom/hat), and airborne riff (guitar/bass/oi/woo).
- Height changes riff pitch/playback speed; lateral position changes stereo;
  velocity brightens and pushes phrase rate. Material mass changes drag, spin,
  release impulse, body reaction, and contact energy. Common gravity is never
  made heavier for a heavier prop.
- A/D slowly steer the selected rider; Q/E ride faster; W/S change that rider's
  next throw height. Number keys 1/2/3 select Puggler/Roxy/Moss, so all riders
  are available without a numeric keypad. Roxy simultaneously uses J/L slow,
  U/O fast, I/K high/low, H kick, N to crowd. Moss can simultaneously use
  numpad 4/6 slow, 7/9 fast, 8/2 high/low, 5 kick, 0 to crowd. F/G kick/throw
  to crowd for the selected rider. Arrow keys no longer steer.
- Any rider can be dragged, including automatic partners; three touches can
  steer all three. Automatic assistance yields during direct steering and for
  0.65 seconds afterward. Held movement/height buttons target the selected
  rider. Space uses shared transport. Native controls retain keyboard behavior.
- Released trajectories stay in world space. Moving under them changes whether
  a hand catches. Descending contacts use a swept collision test to avoid
  skipping a hand at 1,200 beats/min. Catches attach props immediately and trigger
  their drum recording; holds do not invent contacts.
- Throw wildness perturbs actual release trajectories. Small errors are common
  and larger slips occasional; reaching the physical hand still determines
  every catch. At zero wildness, stationary exact throws remain catchable.
  Default wildness makes visible drops possible without forced failed catches.
- Drops trigger a recorded crowd boo, panicked faces, crowd reaction, and
  short-lived floor debris. After 0.24 seconds a front-row hand throws a different
  prop upward from world y=32; its arc rises above the hands, then descends into
  the receiver's catch region. It retains its drum/riff slot and future beat.
  Moving away can miss the incoming prop, which drops and is replaced again.
- G/N/numpad0 sends an owned held object to the crowd, or queues the action for
  the next available throw. Its outbound arc ends in a crowd hand, awards a
  crowd catch, and is followed by a different prop lobbed back onto the stage.
  Each prop's musical identity survives that exchange. This is cartoon catch
  play, with no injury mechanic.
- A blocked reservation pauses phrase progress until its required prop returns;
  other released objects continue moving. This is forgiving musical game timing.
- Throw height and tempo are separate musical controls. Launch gravity uses
  `2200 × gravity × loft × riderLoft × (tempo/180)²`, preserving high arcs as tempo rises.
  Audience lobs use a slower, readable 1.15-second arc. This is explicitly
  arcade time scaling, not unchanged terrestrial gravity. Existing flights keep
  their launch coefficients when settings change.
- A nonlinear camera projection compresses very high sky space toward the top
  of the frame without shrinking the riders. Physical trajectories remain
  unchanged. Long arms reach incoming props; torso lean/recoil, pedals, wheels,
  facial expressions, and mouths respond to motion and contact.
- Venue geometry includes battered amps, drum kit, 30 authored punk/hippie/rave
  poster slogans, leaking pipe,
  slime, floor rubbish, cables, and a crowd. Mix-the-flyers shuffles a seeded set covering punk, peace, and rave themes.
  Moss wears goggles, patchwork, and flared trousers. Puggler’s hat dots are muted
  green. All are authored Canvas graphics.

## Runtime and verification boundaries

Canonical route/ID: `puggler.html` / `puggler`, Misc catalogue group. Twenty-one
materials and 31 fixed patterns; one to ten total sound objects. New physical
props include a battered guitar, cassette, skateboard, vinyl, microphone, traffic
cone, glowstick, plush mushroom, and plush rat.

The simulation uses 120 Hz fixed steps on a bounded 20 ms timer. After explicit
Audio activation, `AudioContext.currentTime` drives scheduling; rAF only paints.
Stale time is skipped after backgrounding. Contacts receive a 35 ms scheduling
offset. Ten live riff voices, twenty brief release tails, and at most 48
transients bound audio allocation. Riff voices pass through a compressor; drums
bypass that compressor into the final saturator with a stronger, accented onset.
A final unity clip guard catches oversampling reconstruction peaks before the
unchanged output headroom.
Every audible catch briefly ducks the other riffs for 45 ms. Catch-drums zero
keeps that duck inactive, and crowd boos do not trigger it. Ten-percent output
headroom and smoothed parameters bound the mix. Density compensation above four
voices preserves headroom. Catch events
explicitly gate their own riff even if a short held state falls between timer
polls at 1,200 BPM. Sample-rate scaling compresses extreme tempo increases to
leave room for path modulation. No independent backing track plays.
Local recordings load only on Audio activation; failed loads show a retryable
error. Navigation aborts loading, closes sources/context, and releases output.

Display allocation is bounded: ten debris bodies, five bonus balloons, seven
hat balloons before an eight-item clear, 55 trail points per prop, and DPR 2.
Switching automatic/manual control for an unchanged rider count preserves all
released objects. Structural
count/pattern/phrase/performer-count changes rerack while transport and score continue.
Reset restores the default band. Shared MIDI control/transport and physical
contact output-preview hooks are retained; browser MIDI routing is not claimed.

Automated tests cover legal reservations, exact flight solutions, material
extremes, swept catches, replacement catch/miss, independent steering, immutable
configuration inputs, finite/bounded audio, recorded sample loading, phrase
continuation, onset/mute/pause, layout, three-player keyboard/pointer cancellation, crowd round trips, and cleanup.
Automation does **not** establish timbral authenticity, intelligibility of the
synthetic chant, musical usefulness, or physical touch/controller feel. Human
listening and device play remain unperformed.

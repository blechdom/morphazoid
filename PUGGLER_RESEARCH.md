# Puggler: research and implementation ledger

The instrument makes physical contacts into drums and airborne paths into a
punk band. User direction: **thrash and trash**; giant awkward props, flailing
performers, a filthy venue, musical phrases, passing, and crowd boos.

## Sources and interpretation

| Topic | Evidence | Implemented interpretation / limits |
| --- | --- | --- |
| Puggler | Adult Swim, [Escape from Squatopian Freedom](https://www.adultswim.com/videos/xavier-renegade-angel/escape-from-squatopian-freedom), [official video around 90 seconds](https://www.youtube.com/watch?v=KW0OHJXVv14&t=90s) | Orange curls, angular human face, towering green hat with pale ringed dots, broad dark brim, purple/pink sleeveless stripes, lime tie, burgundy trousers, red unicycle. Original Canvas likeness; no extracted model, episode picture, dialogue, or music. Roxy and Moss are original adult punk partners. |
| Kick Man | [Museum of the Game](https://www.arcade-museum.com/Videogame/kick-man), [Midway manual scan](https://www.aurcade.com/games/manuals/00000118.pdf), [Commodore instructions](https://mocagh.org/forsale/kickman-manual.pdf) | 1981 arcade unicycle, left/right movement, falling balloons, head stack, emergency kick. Historical inspiration for unicycle steering and rescue kicks. The optional balloon tower has been removed; free juggling is the only mode. |
| Siteswap | [Juggling Lab notation](https://jugglinglab.org/html/ssnotation.html), [generator](https://jugglinglab.org/html/ssgenerator.html) | Throw height denotes a future beat/hand reservation. Odd asynchronous throws cross hands; even throws return. Ground-state chunks can concatenate while retaining legal reservations. Arbitrary rotations or unrelated patterns cannot safely concatenate. |
| Rhythmic phrasing | Daniel Simu, [the rhythm problem](https://danielsimu.nl/research/posts/siteswap_and_rhythm_problem/), [rhythm solutions](https://danielsimu.nl/research/posts/siteswap_and_rhythm_solutions/) | Catch and throw rhythm are different; dwell, grouping, gaps, and double catches matter. Our verse/fill/break/refrain sequences combine compatible siteswap chunks, including rests and holds. They are authored compositions, not transcriptions of traditional musical routines. |
| Passing | Mark Weston, [Passing Patterns Compendium](https://jugglingedge.com/pdf/passingpatternscompendium.pdf) | Passing cadence and running-gap ideas inform trading every throw, every third throw, or the second half of an eight-beat phrase. Our ensemble shares **one to ten total props** and adapts a global siteswap schedule; it is not a canonical six-club passing simulator. |
| Juggling sonification | Arthur Wagenaar, [Juggling as a controller of electronic music](https://www.arthurwagenaar.nl/wp-content/uploads/Juggling-as-a-controller-of-electronic-music.pdf) | Contacts can trigger samples while trajectories modulate sound. Here, a prop has independent drum and airborne riff assignments, preserved when a replacement changes its physical material. |
| State planning | [Beyond the Cascade: Juggling Vanilla Siteswap Patterns](https://arxiv.org/abs/2410.19591) | Supports planning legal transitions rather than choosing throw digits independently. Our small deterministic generator uses a hand-validated compatible chunk bank, not the paper's robot implementation. |
| Motion | [NASA flight equations with drag](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/flight-equations-with-drag/) | Shared gravity; drag acceleration depends on mass. NASA describes quadratic aerodynamic drag; the browser uses an exact **linear-drag approximation**, invented masses, and world units. This is a stylized musical game, not calibrated biomechanics. |
| Recorded sounds | [Karoryfer free samples](https://shop.karoryfer.com/pages/free-samples), [NeoSpica crowd boo](https://freesound.org/people/NeoSpica/sounds/504621/), [jayfrosting woo](https://freesound.org/people/jayfrosting/sounds/333421/), [rhink Oi](https://freesound.org/people/rhink/sounds/245867/) | Five acoustic drums and three vocal recordings are CC0. Exact source filenames, pinned source commit, processing, and license are in [sound credits](assets/puggler/CREDITS.md). Guitar/bass are original synthesis; OI repeats three complete recorded calls and WOO uses recorded audience voices. Vocal playback is gently bent within 0.84–1.2× and avoids guitar overdrive. |

## Fixed and phrased patterns

The Pattern menu always offers every fixed pattern for the current object count.
The same menu includes “Verse / fill / break” and “Evolving phrases”;
choosing a fixed pattern switches to repeating that pattern. The adjacent arrow cycles all choices.
This re-racks the throws while preserving transport, Audio, and sound choices.

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

### Stage skins and lighting

The stage has three presentation skins: Trashpunk, History mash-up, and Future
3026. History pairs a cavewoman, a medieval performer, and a composer caricature;
Future pairs a future man, a cyber woman, and an alien. Each new skin remaps all
33 prop names and photographic-style sprites while keeping the base IDs, mass,
drag, contact timing, and drum/riff assignments. A skin change restyles existing
flights and their recorded trails without re-racking or resetting the model.
Starting acts preserve the chosen skin and lights; Reset returns to Trashpunk
and house lights. Cast name buttons follow the selected skin.
Vocal objects also use the selected character's voice treatment, as described
below; physical trajectories and drum/riff assignments remain unchanged.

The historical scene is a deliberately anachronistic global collage. The
[Met's astrolabe from Yemen](https://www.metmuseum.org/art/collection/search/444408),
its [lute overview](https://www.metmuseum.org/ja/essays/the-lute), and the
[Morgan's Mozart portrait description](https://www.themorgan.org/exhibitions/online/mozart/406)
anchor a few recognizable shapes and costume details. The generated objects,
composite stage, and performers are fictional interpretations, not museum
reproductions or accurate reconstructions. The Future 3026 objects are invented.

Lighting scenarios use the current performer motion and catch accents for
bounded intensity changes. They remain visual parameters, with no new sound
sources or timers. The expanded audience contains two distinct women and a baby,
all shown from behind. The baby appears supported beside an adult and has a
smaller, slower movement range. New cutout prompts and provenance are in
[skin artwork credits](assets/puggler/SKINS_CREDITS.md) and
[audience credits](assets/puggler/CROWD_EXTRA_CREDITS.md).

### Character vocals

All nine characters have distinct OI and WOO treatments of the existing CC0
human recordings. These are theatrical DSP variations, not recordings of nine
actors or voice imitations. The punk trio uses a direct midrange voice, brighter
higher Roxy, and lower darker Moss. The historical cast uses a deep-voiced cavewoman,
forward midrange Dame Roxy, and high bright Maestro. The future cast adds radio
color, short modulated doubling, and a more alien sideband treatment.

The voice follows the last performer to launch the prop. Normal passes keep the
thrower's voice through the flight; the receiver gets the next throw. A rescue
kick changes the voice immediately without changing passing statistics. Crowd
returns use the intended receiver, and crowd cheers/boos retain their originals.
Skin changes crossfade the active vocals at relative phrase position. Eighteen
short mono buffers are derived once after decoding; no per-frame sample building
or additional live effect nodes are required. Drums and guitar/bass retain their
existing sound assignments. Human listening approval remains separate from the
automated level, separation, continuity, and lifecycle checks.

- Default: six props, automatic Roxy and Moss, 16-beat phrase, 360 siteswap beats/min,
  throw height 1.8×, catch reach 42 world units, throw wildness 40%, Audio off, output 48%, catch drums 125%.
- Each prop independently chooses physical material, catch drum
  (kick/snare/crash/tom/hat), and airborne riff (guitar/bass/oi/woo).
- Height changes riff pitch/playback speed; lateral position changes stereo;
  velocity brightens and pushes phrase rate. Material mass changes drag, spin,
  release impulse, body reaction, and contact energy. Common gravity is never
  made heavier for a heavier prop.
- Name buttons (or 1/2/3) toggle membership; at least one juggler stays onstage.
  Eight shared stage knobs control riding speed, object count, juggling/music
  tempo, throw height, catch reach, wildness, gravity and wind. Sound knobs are
  alongside them in one wrapping bank (lime motion outlines, cyan sound outlines).
  Drag knobs vertically; arrows still edit their native ranges. Ride speed and tempo are independent.
- The old High/Low buttons only changed later throws; Kick required a low object
  inside rescue reach. These hard-to-see actions and the individual keypads are
  removed from the UI. The model retains rescue logic for existing simulation tests.
- Stage dragging or Left/Right steers the whole active cast. One captured pointer
  owns the ensemble gesture; extra touches cannot split the cast. Assistance yields
  during steering and for 0.65 seconds afterward. Cancellation/blur releases it.
  Space uses shared transport; native controls retain keyboard behavior.
- Pause gates new automatic throws and freezes the siteswap beat. Existing
  objects land naturally; riding, manual crowd exchanges and model-timed audience
  reactions continue. Armed Audio keeps crowd sounds and contact tails available.
  Audio off, output zero, hidden pages and teardown silence all sources.
- The stage stays borderless and sticky; its controls scroll, not the graphic.
  Desktop and short-landscape columns scroll independently; portrait stacks
  them with native page scrolling. On every layout shared controls begin directly
  below the graphic, with compact actions that wrap and a circular Play/Pause control. Knob labels sit
  below the dial, with smaller values underneath, following SIMD-303’s ordering.
  The right panel starts with full scenes, then focused choreography/riding,
  stage/lights and individual object assignments. The page intentionally omits
  shared Audio-off prose at the user's request; masthead Audio remains explicit.
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
- G or the shared To crowd button sends each rider’s held object to the crowd, or queues the action for
  the next available throw. Its outbound arc ends in a crowd hand, awards a
  crowd catch, and is followed by a different prop lobbed back onto the stage.
  Each prop's musical identity survives that exchange. This is cartoon catch
  play, with no injury mechanic.
- A blocked reservation pauses phrase progress until its required prop returns;
  other released objects continue moving. This is forgiving musical game timing.
- Throw height and tempo are separate musical controls. Launch gravity uses
  `2200 × gravity × (1.8 × (loft/1.8)^1.7) × riderLoft × (tempo/180)²`, preserving high arcs as tempo rises.
  Audience lobs use a slower, readable 1.15-second arc. This is explicitly
  arcade time scaling, not unchanged terrestrial gravity. Existing flights keep
  their launch coefficients when settings change.
- A nonlinear camera projection compresses very high sky space toward the top
  of the frame without shrinking the riders. Its reference is the pattern size,
  not the current apex: auto-framing no longer cancels the visible loft change. Long arms reach incoming props; torso lean/recoil, pedals, wheels,
  facial expressions, and mouths respond to motion and contact.
- Venue geometry includes battered amps, drum kit, 40 authored punk/thrash/gross
  poster slogans, leaking pipe,
  slime, floor rubbish, cables, and a crowd. Random flyers shuffles a seeded bank of trashpunk slogans.
  Moss wears goggles, patchwork, and flared trousers. Puggler’s hat dots are muted
  green. All are authored Canvas graphics.

## Runtime and verification boundaries

Canonical route/ID: `puggler.html` / `puggler`, Misc catalogue group. Thirty-three
materials and 31 fixed patterns; one to ten total sound objects. New physical
props include ice cream, an axe, a dead cat, a hydrant, a pickle, a violin, a skull,
a banana, a snake, a potted plant, a plunger, a CD, and a VHS tape. The plush
mushroom is removed. Their masses and material parameters are game-scaled
contrasts rather than measured replicas; they drive the existing drag, wind,
spin, recoil, and sound mappings. Four additional acts showcase the new bank.

The simulation uses 120 Hz fixed steps on a bounded 20 ms timer. After explicit
Audio activation, `AudioContext.currentTime` drives scheduling; rAF only paints.
Stale time is skipped after backgrounding. Contacts receive a 35 ms scheduling
offset. Ten live riff voices, twenty brief release tails, and at most 48
transients bound audio allocation. Guitar/bass riff voices pass through a compressor; vocals use a gentler separate compressor and no overdrive. Drums
bypass that compressor into the final saturator with a stronger, accented onset.
A final unity clip guard catches oversampling reconstruction peaks before the
unchanged output headroom.
Every audible catch briefly ducks the other riffs for 45 ms. Catch-drums zero
keeps that duck inactive for catches. Background boos do not trigger it; actual drops do. Ten-percent output
headroom and smoothed parameters bound the mix. Density compensation above four
voices preserves headroom. Catch events
explicitly gate their own riff even if a short held state falls between timer
polls at 1,200 BPM. Sample-rate scaling compresses extreme tempo increases to
leave room for path modulation. No independent backing track plays.
Local recordings load only on Audio activation; failed loads show a retryable
error. Navigation aborts loading, closes sources/context, and releases output.

Display allocation is bounded: ten debris bodies, 55 trail points per prop, and DPR 2.
Switching automatic/manual control for an unchanged rider count preserves all
released objects. Structural
count/pattern/phrase/cast-membership changes rerack while transport and score continue.
Reset restores the default band. Shared MIDI control/transport and physical
contact output-preview hooks are retained; browser MIDI routing is not claimed.

Automated tests cover legal reservations, exact flight solutions, material
extremes, swept catches, replacement catch/miss, independent steering, immutable
configuration inputs, finite/bounded audio, recorded sample loading, phrase
continuation, onset/mute/pause, layout, ensemble keyboard/pointer cancellation, crowd round trips, and cleanup.
Automation does **not** establish timbral authenticity, intelligibility of the
sampled chant, musical usefulness, or physical touch/controller feel. Human
listening and device play remain unperformed.

## Unicycle idling and preset riding

[Unicycle.com's idling guide](https://www.unicycle.com/blog/how-to-idle-why-it-matters/)
describes controlled forward/backward rocking around one spot. The show uses an
artistic approximation of that balancing stance: small real wheel travel for
every active rider, with larger preset-specific riding patterns layered over it.
Manual steering takes priority and sets a new local balance position after
release. Wheel rotation, pedals, hand positions, and contacts follow model motion;
this is not a full simulation of rider biomechanics.

## Crowd collage and musical motion

Five rear-view cutout types vary hair, age, clothing, and proportions; raised
hands include phones, lit lighters, open hands, peace signs, and horns with varied
skin tones. The generated images and exact prompts are documented in
[asset credits](assets/puggler/CREDITS.md).

Crowd motion consumes the same timestamped juggling contacts that trigger the
drums. Each listener has different drum preferences, reaction delays, short bounce
envelopes, and rest periods, with small independent fidgets between hits. This is
event-driven choreography, not microphone or audio-waveform analysis. It works
with Audio off and does not create or arm an audio context. Responses and drawing
cost remain bounded at the maximum object count and tempo.

Stage pyrotechnics accent occasional juggling contacts with short flame jets
and sparks. They use the model clock, a contact phrase threshold, and a cooldown
between bursts. Pause prevents new bursts while existing sparks finish; reset
and teardown clear their state. These are visual accents over the existing
drums, with no additional audio source or independent backing track.

### Historical cast and fluorescent future refresh

Cavewoman and Maestro Moss exchange their original skin and outline colors.
Cavewoman has long moving hair, a bone barrette, and a tied fur tunic; Cyberwoman
has a magenta swept bob and ponytail, tapered face, and a mechanical eye. Future
performers and the stage use fluorescent cyan, magenta, lime, and violet. A fixed
set of orbiting emitters and hanging pods moves smoothly, with local catch-driven
swells rather than a full-frame flashing effect.

History now has its own eight rear-view photographic audience members, including
women, children, and a baby beside the mother, in a fictional global-history
costume mash-up. Candles, a fan, open hands, and a tankard replace modern crowd
accessories. The existing independent drum reactions and gentle baby motion
remain the same. Failed photos retain period costume silhouettes.

Historical presentation overrides add bones, ham hock, a swaddled theatrical baby
prop, harpsichord, boulder, and wooden club. Future adds a fluorescent octopus.
These are additional photographic choices within the existing 33 prop identities:
their mass, sound, and trajectory remain tied to the corresponding physical slot.
Changing skins replaces both the current sprite and its echoes. Exact prompts
and generated image provenance are in `assets/puggler/ERA_PROPS_CREDITS.md` and
`assets/puggler/HISTORY_CROWD_CREDITS.md`.

The future skin also has a complete rear-view audience bank: fluorescent braids,
cybernetic implants, a tall ribbed helmet, mint hair, an alien with cranial fins,
and a little lavender alien baby beside the mother. Plasma capsules, holographic
slabs, robotic hands and alien hands replace the modern accessories. Foreground
listeners, distant silhouettes and crowd exchanges all use the future theme,
including when images are unavailable. Existing crowd motion and audio behavior
remain unchanged. Image provenance and the exact prompt are in
`assets/puggler/FUTURE_CROWD_CREDITS.md`.


## Sonic skins: history and a liquid future

Changing the visual skin also changes object instruments, character vocals and
hand-impact percussion. The cast remains one physical simulation: positions,
throw ownership, motion, mass-derived energy, catch timing and transport state
continue across the switch. The shared role IDs preserve existing presets and
object selections; only their visible sound names and sound bank change.

| Performer | Airborne lead / bass | Vocal direction |
| --- | --- | --- |
| Cavewoman | Mouth-bow-style twang / woody string bass | Earthy chant |
| Dame Roxy | Lute/oud-like plucks / gut bass | Chamber reply |
| Maestro Moss | Quill keys / plucked bass | Ornamented singing line |
| Futureman | Cyber-funk FM lead / resonant bass | Rhythmic cyber call |
| Cyberwoman | Liquid glass keys / rubber bass | Soprano opera contour |
| Quor | Underwater marimba / plasma bass | Liquid, wandering melisma |

Historical catches select frame drum, tabor, bronze gong, log drum or finger
cymbals. Future catches select sub kick, laser clap, splash crash, water tom or
glitch hat. All ten sounds are original finite synthesis; the punk kit retains
its existing CC0 recordings. These names describe a fictional sound collage,
not cultural or historical authenticity.

The acoustic phrases use decaying string partials, faster damping of higher
partials, short excitation noise and small resonant-body contributions. This
choice draws on Julius O. Smith's
[Virtual Musical Instruments](https://dsprelated.com/freebooks/pasp/Virtual_Musical_Instruments.html)
and Välimäki, Penttinen and Knif's
[Sound Synthesis of the Harpsichord Using a Physical Model](https://www.ee.columbia.edu/~dpwe/e6820/papers/ValPK04-harpsi.pdf).
The implementation uses a small additive approximation, not that paper's full
physical model. Future phrases use bounded FM, glides and inharmonic glass or
bar partials. Each performer has its own syncopated score with accents and rests.

Era vocals retain the licensed human recording as their main source and add a
smaller pitched-vowel layer driven by its syllable envelope. Source/filter
voice synthesis and parallel formant bands are described in Smith's
[Voice Synthesis](https://dsprelated.com/freebooks/pasp/Voice_Synthesis.html) and
[FM Voice](https://dsprelated.com/freebooks/sasp/FM_Voice.html).
Here a compact harmonic source, three resonant formants, gentle granular pitch
movement, vibrato and finite early reflections create theatrical singing colors.
The original words are processed sounds, not newly sung lyrics or AI-generated
speech. Future vocal colors use more moving formants and chorus; they remain
caused by airborne objects rather than an independent drone or backing track.

Motion still changes pan, pitch/phrase speed and brightness. Historical playback
rates bend more gently than punk guitar rates, and acoustic phrases bypass the
per-voice amplifier. String bite opens the acoustic tone; Cyber grit adds mild
drive and resonance. Hand impacts keep the existing direct percussion route and
briefly duck airborne sounds. Era/performer changes preserve normalized phrase
progress, with bounded crossfade tails. All buffers are generated once when
Audio is explicitly armed; live switches neither fetch nor resynthesize audio.

Mechanical checks cover PCM bounds, source-envelope retention, distinctions
between level-matched phrases and hits, era/performer routing, phrase continuity,
transport, teardown and the ten-object/1,200-BPM mix. Those checks do not establish
perceived instrument identity, operatic quality or musical balance. Human
listening and physical-device play remain unperformed.

## Prop voices, light shows and complete scenes (September 23, 2026)

The default Catch and Air selections are now **Own**: each of the 33 physical
prop types has its own voice in each skin (99 identities, 198 cached air/contact
samples). Motion continues to control rate, brightness and pan; catches interrupt
that prop's flight sound and trigger its matching hit. Passing preserves prop
identity; audience replacement changes an Own voice with the visible prop.
Explicit voice choices remain fixed when the object changes. Original recorded
kit, guitar/bass and performer-owned OI/WOO selections remain available.

The revised sound bank separates the eras rather than sharing FM/chirp recipes:

- **History:** Chinese plucked-zither color, sitar-like bridge buzz and sympathetic
  partials, detuned bronze/gong pairs, tabla-like modal percussion, harpsichord
  Alberti bass and trills, piano scales/cadences, harp arpeggios, vibrato strings,
  timpani, tuba/trombone, flute, oboe and penny whistle. Vocal colors use the
  existing licensed human OI/WOO clips: call-and-response, cak-like syllabic
  gating, pitched operatic arpeggios, chamber laughter and low grunts. These are
  theatrical approximations, **not recordings of traditional performers** or
  authenticated reconstructions. The syllabic proxy is not a Kecak performance;
  see [Hocket Luigi's cultural framing](HOCKET_LOOM_RESEARCH.md).
- **Punk:** picked bass, palm-muted/power-chord/shredding electric strings, ebow
  excitation and moving-delay whammy bends; the existing acoustic drum and
  cymbal recordings; stomps, tambourine/glass/clatter approximations, sampled
  shouts and screams, and harmonic amp feedback. No FM/laser voice families are
  assigned to punk. Two original eSpeak-generated mic-check/count-in clips add
  “check check / is this thing on?” and “one two three four”; they are **synthetic
  speech**, not new actor recordings. [Asset provenance](assets/puggler/CREDITS.md).
- **Future:** coupled-phase “gizzle” packets, targeting glides, beep-beep pulses,
  seven-step unquantized contours, ring-modulated textures, swept filters,
  reversed voice fragments and two finite echoes. “Gizzle” is a sound-design
  nickname, not a claim about a separate hardware synthesis engine.

Guitar strings use recirculating pick-excited delay lines. Historical instruments
use decaying partials, membrane modes, paired beating, breath/rosin noise and
harmonic wind/string bodies. These follow the broad synthesis ideas in Julius
O. Smith's [Virtual Musical Instruments](https://www.dsprelated.com/freebooks/pasp/Virtual_Musical_Instruments.html),
not a validated physical model of each named instrument. The owner's explicit
request for Alberti bass, scales, cadences and operatic arpeggios authorizes those
**local classical scores**; they do not quantize the other instruments or future
voices onto a Western/pentatonic scale.

Instrumental object notes now take their onset from the **juggling beat**, while
pitch is a separate playback-rate control. Raising an object no longer speeds
up its entire phrase. At extreme tempos, power-of-two subdivisions preserve a
relationship to catches while capping new attacks at 12 per prop per second.
After a UI stall only a current pulse can start: missed notes are not replayed.
Catches still interrupt the object's air sound and trigger its contact voice.
Legacy OI/WOO/lead/bass loops and the longer spoken mic-check clips retain their
paused sample cursors across catches, so words are not restarted at every throw.

Every new mono buffer is edge-faded, peak-capped at 0.68 and normalized using its
active energy, not its silent padding. A small prefix-energy table calibrates
short audible note windows; no sample synthesis or energy scanning occurs in the
update loop. Fixed family trims and a count/tempo-based ensemble gain reduce
mix differences without a signal-following AGC that might amplify silence.
Added pre-ceiling headroom and lower contact gains keep ordinary acoustic voices
away from the safety ceiling. Limits remain 10 air voices, 20 crossfade tails
and 48 contacts. The two new speech WAVs total under 200 KB. The 198-buffer bank
and its small energy tables are built during explicit Audio startup and reused.

Factory scenes no longer use 22–100% scene-level changes as their soft/loud
contrast: they share 80% Scene level and comparable air/contact mixes. Dice uses
77–83%, favors denser 5–10-object acts (with occasional 2–4-object acts), limits
throw wildness and selects within the prop voice palette. Manual sound choices,
all original focused acts and the full manual control ranges remain available.
The **Scene level** control remains smoothed attenuation after the ceiling;
Audio arm, Play, master Output and explicit flash consent are never recalled.

The first control-panel row has 48 complete scenes (16 per skin, interleaved), Next and a generative dice
button. Snapshots include object/sound assignments, cast, physics, juggling and
ride patterns, rhythm, tempo, sound mix, skin, lights, trails and poster seed.
The body **Juggling act** remains a focused physics/pattern selector. Full recall
preserves live time; changes of count/cast/pattern re-rack using the existing
model semantics. Dice varies every scene-owned field within explicit bounds.

Eleven light looks include colored fans, footlights, blacklight, mirror-ball
spots, party beams, lasers, prism and aether curtains. Intensity and motion speed
are independently adjustable. Strobe and light-riot accents require the separate
**Enable flashing lights** checkbox, start off and cannot be enabled by presets
or dice. Their shared pulse is capped at two flashes/second and disabled by the
OS reduced-motion preference, which also freezes new light movement. This is
not a guarantee of medical safety: leave flashes off if sensitive. The relevant
accessibility reference is W3C's
[Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html).
The drawing budget is fixed at eight beams, 24 spots and a small mirror-ball grid.

Twenty original fictional historical flyers and twenty futuristic flyers join
the untouched punk bills. Random flyers works in all skins. They are playful
stage text, not claims about historical events or cultural traditions.

Focused PCM, routing, preset, resource, lighting and browser checks are separate
from listening acceptance. Physical iPhone testing and human judgments of sound
identity, balance, harshness and performance feel still require owner review.

## September 2026 shared controls / drop feedback pass

The main bank mixes eras and density instead of three skin blocks. Added scenes
include still wheels with fast shredding, fast wheels with slow bass, low throws,
high aerial relays, mono/choked basement mixes, gong space, chamber strings,
call-and-response, reverse scatter and dense hyper-wave scenes. Output, Audio,
Play, flashing consent and live clocks remain outside recall. Scene level is
still nominally 80%; dynamic variety is not implemented as arbitrary master jumps.

Actual drops now use the original CC0 human boo with two envelope syllables and
falling playback-rate sweeps (0.84 to 0.60×). They have a separate Drops / boos
control (default 70%) and stronger foreground gain; incidental crowd reactions
retain Audience. Both paths retain the shared ceiling and master mute. Audience
and Drops now each have a smoothed live gain, separate from a clip's envelope:
turning either knob changes an already-playing voice, including while juggling
is paused, without restarting it. Scene level attenuates the whole mix (objects,
catches, drop boos and audience), then the header Output provides the overall
level; Scene level at zero silences everything. These relationships are also
available as knob tooltips/accessibility descriptions. No new recordings or
voice-identity claims. Scene snapshots are v2; exact v1 shapes
migrate with the default drop level without mutating the saved input.

Automated checks exercise model timing, fixed projection height leverage,
real recorded drop rendering, every shared knob, touch cancellation, five layout
sizes, audio lifecycle and preset/dice levels. Mechanical evidence does not
approve the timbre or phone feel; human listening and physical-device review
remain required.

The compact controls sit directly at the stage's lower edge. Desktop and short
landscape have independent left-control and right-panel scrollers; resizing or
collapsing the right panel does not move the left controls. Portrait keeps the
borderless graphic sticky while the page scrolls. Motion and sound share one
wrapping knob bank, distinguished by lime/cyan dial outlines, with labels below
the dials and smaller values below the labels. The transport is circular (48px
on touch), and the bordered To crowd action is beside Objects. There is no
visible drag-instruction strip or sound disclosure.

The live-level regression renders the original boo, woo and crash recordings
at 48 kHz, changes the gain at 250 ms without retriggering, and compares the
450–800 ms window to an unchanged render. Audience, Drops and whole-scene
attenuation retain proportional 0/25/100% amplitude, source continuity and
cleanup. This is automated characterization, not listening approval.


Audience now extends to 300% (three times its former maximum gain, approximately
+9.5 dB before the shared ceiling). The original 0–100% response, 28% default,
factory mixes and 12–30% dice range are unchanged. Custom scenes can retain the
boosted value; Drops stays separate at 0–100%. Both new attacks and live edits
use the expanded, bounded range. The ceiling, Scene level and header Output
remain unchanged; their protection may limit the gain increase in dense mixes.

# Domino Run

Domino Run turns connected falling tiles into percussion. **Tone Henge** is its
default stone-circle preset. It is a new instrument under Work in Progress;
Falling Forms remains a separate instrument. Dominoes and stair supports are
drawn as transparent wireframes; material colors, selection, and impact flashes
appear on their edges. Click inside a wireframe to push or select it.

## Play

Enable **Audio**, then **Run**, or tap any tile in Push mode. Each domino-to-domino
contact makes a brighter impact; each tile's final fall makes a lower impact.
Pause freezes the run and releases its sound. Stand up restores the current
arrangement; if the transport was running, it starts the run again. Loop whole run raises
the tiles during a short silent reset between runs when Stand again is off. Audio can be switched off
while the visual run continues.

The preset menu contains 24 complete scenes from gentle clatter to extreme runs.
**New random run** and the
preset dice generate new bounded parameter combinations rather than choosing a
preset. The seed reproduces the generated arrangement. Preset and parameter
changes preserve Audio, master volume, and whether the transport is running.
Structural changes and scene recalls map the current progress into the new run.
A recall during the short reset pause starts the new run at its beginning.
Changes to a circulating run’s recovery or speed retain elapsed time and replay
the model with the new settings; sound-only edits keep its current wave. **Loop whole
run**, **Stand again**, and **After landing** stay as you set them across presets,
preset arrows, both randomizers, and Undo. They are live repeat controls outside
the scene snapshot. Reset all restores their defaults, returns to Tone Henge,
stops transport and disarms Audio.

## Dry domino sounds

**Tone Henge** now starts with short stone impacts. **Classic Plastic**,
**Ceramic Clatter**, and **Stone Thuds** are quick starting points for lighter
clacks, hard clicks, and heavier knocks. The material voices favor brief contact
noise and damped body sound; larger pieces change that body color subtly instead
of strongly transposing a ringing note. **Resonance** reaches zero for the driest
setting, and its upper range keeps some optional ringing color. The randomizer
also favors shorter decays. These remain synthesized material approximations.

**Sound variation** adds small differences in strike strength, brightness, initial
snap, and body weight to repeated impacts. It does not alter pitch, pan, geometry,
or fall timing. The default 20% is subtle; 0% removes the extra per-hit variation.
The **↺ 0** buttons reset Sound variation, Size variation, Size gradient, Step
height, Rotation, Sound tuning, and Resonance to zero. They update the same
controls used for dragging and keyboard adjustment.

Try **Ant March** for tiny plastic ticks, **Monolith Crawl** for very slow giant
stones, **Porcelain Petals** for a ceramic flower, or **Figure Eight Frenzy** for
a fast reversed loop. **Rising Coil**, **Reverse Weave**, **Colossus Growth**, and
**Thousand Clacks** explore height, convergence, growth, and dense fields.

## Circulating runs

Enable **Stand again** to raise each domino independently. **After landing** is
its wait before rising; the rise takes another 0.4 seconds. These are actual
seconds, so Run speed changes the fall timing without shortening the recovery.
A Henge circle connects its last stone back to its first. With a short enough
recovery, the returning wave can knock the first stone down again and keep going.
If that stone is still down or rising, the wave stops. Re-standing never starts a
new fall by itself. Whole-run Loop is disabled while this mode is active.

The same setting works on drawn closed loops. Open paths can stand up again but
need another push after their wave ends. This powered re-standing is an artistic
mechanism, not a claim about ordinary unassisted dominoes.

## Draw a pattern

Choose **Draw**, draw a path on the stage, and release to place dominoes. The
first stroke replaces the generated run; further strokes add independent paths.
**New pattern** clears the stage. **Undo** reverses one complete stroke or edit,
including a cleared pattern. A cancelled touch leaves the pattern unchanged.

**Close loops** connects a stroke back to its beginning only when its endpoints
are close together. Bring your stroke back near its start to draw a circulating
ring. An open stroke never gets a long closing jump. Separate strokes each have
a starter; Run starts them together, while tapping a domino starts only its path.
Crossing strokes do not automatically collide, join, or make a fork.

Dominoes are sampled along the whole stroke, including between fast pointer
moves. Gentle curves transfer better than sharp corners. Spacing and size controls
resample the preserved path; sound and material changes keep its shape. Choosing
a generated Path or preset leaves drawing mode’s pattern. Patterns hold at most
1,024 dominoes across 64 strokes. Individual Arrange edits and Undo still work.

For keyboard drawing, focus the canvas in Draw mode. Arrows move the cursor;
Enter adds a waypoint, Shift+Enter or **Finish path** commits it, Escape cancels,
and Ctrl/Cmd+Z undoes the last edit. Hold Shift with an arrow for smaller moves.

## Make a run

- **Path:** circle, serpentine, spiral, fork, upstairs, downstairs, tapestry,
  wave, zigzag, polygon, flower, figure-eight, or a supported helix. Terraces
  have visible supports; forked paths share a starter.
- **Run direction:** Forward follows the path; Reverse starts at its ends.
  Reversed forks converge from their leaves, and closed loops circulate the
  other way. Manual pushes can still start anywhere.
- **Rotation, Stretch, Bend / turns:** rotate the pattern through a full turn,
  squeeze or stretch it from 0.2× to 5×, and reshape curves from 0.2× to 3×.
  Bend / turns applies to generated paths; drawings keep their authored curves.
- **Dominoes:** 4–1,024 pieces. Larger fields receive the same contact checks as
  small runs.
- **Spacing:** center separation relative to tile height. Gaps, overlap,
  direction and step height can prevent propagation. Broken transfers are
  shown in red when Paths is enabled.
- **Size, variation, gradient:** change height, width, thickness, mass and fall
  timing together. Overall size spans 0.1×–6×. Variation reaches strong size
  contrasts; the gradient reaches roughly 55-fold growth or shrinkage along a
  path before the individual height limits. Each piece stays between 0.03 and
  64 scene units. Size continuously shifts its impact color.
  Changing Overall size visibly changes the camera scale too; **Fit** frames
  the complete pattern again.
- **Step height:** ranges from −1 to +1 scene unit between stair terraces or
  helix pieces. Negative values reverse the climb; zero levels the path.
- **Material:** stone, wood, ceramic, glass, metal, plastic, or mixed materials.
  These have distinct synthesized attacks and resonances, plus model density
  and transfer loss. They are expressive approximations, not measured recordings.
- **Run speed:** spans 0.05×–12×, from slow toppling to dense rattles, without
  transposing material sounds. **After landing** spans 0.05–60 seconds.
- **Sound tuning:** continuously shifts the impact spectrum three octaves down
  or up (−36 to +36 semitones), independently of fall speed and piece size.
  It preserves the short attack; zero retains the material's original tuning.
  Resonance and Brightness change impact decay and spectrum.

Open **Edit one domino** and press **Choose on stage** to enter Arrange mode.
Tap a piece to select it; its number appears in the editor. Height and Material
there affect only that piece. **Push selected** adds a push there;
**Lift out** removes it from the chain, leaving a gap, and **Put back** restores it.
Drag a tile in Arrange mode to change its position and connections.
Undo edit restores the previous edit. Changing a global structural control
generates a fresh layout and clears individual edits.

In **Push** mode, click any visible face of a standing domino to start it. Click
elsewhere to add another falling wave while the earlier falls and sound tails
continue. Enter, **Push selected**, and MIDI notes use the same action. Waves
share one set of pieces: a tile already falling or down cannot topple again until
it stands. **Stand all** resets the run; **Stand again** lets recovered pieces
receive another push naturally. A cancelled pointer gesture never pushes.

Manual pushes resume a paused run without resetting its existing falls or arming
Audio. Sound-only edits preserve all active waves. Whole-run Loop repeats the
current pattern of timed pushes; a scene or structural rebuild starts a new
pattern. Circulating runs retain a bounded current-time simulation alongside the
four-second audio lookahead, so each added push updates future contacts without
replaying the entire performance.

Orbit the scene by dragging empty space or choosing Orbit; Fit restores the
camera. Zoom spans 0.05×–32×, with a wider low-to-high viewing angle. Camera
and path visibility do not change the score.

## Keyboard and MIDI

Focus the canvas. Arrow keys select adjacent tile IDs; Enter pushes the selected
tile. In Arrange mode arrows move it in the ground plane, with Shift for fine
movement. Space uses Morphazoid's shared Run/Pause transport.

Enable MIDI explicitly in Settings. MIDI note numbers address tiles modulo the
current tile count and velocity controls the push. Notes are one-shot; note-off
does not stop the chain. CC7 controls master level, CC74 brightness, and CC120 /
CC123 stop the run. Start restarts, Continue resumes, and Stop pauses. There is
no fabricated companion MIDI output score. Clock-to-tempo synchronization is
not provided: the native timing comes from the fall model.

## Model and audio boundaries

The model uses directed candidate contacts, lower-edge pivots, slab reach,
lateral overlap, relative elevation, material loss, and a bounded energy-transfer
approximation. A monotonic gravity-based fall table drives both visible tilt and
contact times. It includes a follow-through allowance for continued contact.
It does not solve unconstrained rigid bodies, sliding, rebounding, sustained
multi-body stacks, spontaneous contacts between unlinked paths, or fracture.
Fallen pieces continue to their support plane; exact final stacking is not
solved. These are musical runs, not an engineering prediction of a real build.

The randomizer explores small and giant pieces, slow and fast runs, broad shape
changes and occasional broken transfers. Its seed reproduces the same result;
presets and Reset all provide a route back. Extremely different neighboring
pieces, excessive steps and gaps can stop a chain. Push elsewhere to start a
separate wave. Research distinguishes
floor grip from face friction; this model assumes stable pivots and represents
transfer loss rather than exposing an uncalibrated friction simulator.

The audio worklet receives timestamped events independently of animation
frames. Finite runs are scheduled ahead as complete scores; circulating runs use
a resumable event model and a four-second scheduling window with queue
backpressure. History and pending work stay bounded. It plays deterministic noise-driven impacts, with up to 96 audible voices
and 4,096 queued events. Future events do not consume active voice slots. A
bounded cache, smooth releases, DC filtering and output limiting protect dense
fields. Graphics follow the audio clock; Audio-off previews use a monotonic clock.
Hiding or leaving the page pauses/releases the instrument. No microphone is used.

## Technique research

See [the research ledger](domino-run-research.md) for builder techniques, physics
papers, source links and observation limits. In particular, H5 documents an
actual five-piece **Stonehenge Trick** and a **Sonimod Staircase**. Their motion
sequences were not observed for this implementation. Tone Henge is a stone-circle
interpretation; the supported stair layouts are not reconstructions of those
specialty mechanisms. No source imagery, recordings or third-party code were
copied into the instrument. The catalogue icon is drawn from its own viewport.

## Verification

Automated checks cover deterministic layouts and randomization, broken gaps,
forks and supported stairs, material/size response, bounded audio, MIDI input,
editing and recovery, and desktop and mobile viewport layouts. A dense test runs
all 512 mixed-material dominoes with no dropped events; expanded mixer tests
cover 1,024 mixed extreme-size events through cache eviction with no drops.
A browser test plays all 2,047 impacts from a 1,024-piece run at 12× without
dropped events. Dense recurring forecasts retain every upcoming impact and
current pose across the full scheduling window.
Audio is also checked
while the main browser thread is deliberately stalled. Touch automation covers
drawing, tile dragging and cancellation; its recovery step uses keyboard Undo.
Further tests cover closed-loop recurrence, a wave stopping when recovery is too
slow, mouse/keyboard stroke creation, full-scene capture, and per-stroke Undo.
Repeat-control preservation is checked across actual later loop boundaries after
presets and both randomizers, including reset-pause recalls and delayed UI
updates. Per-hit variation is checked for zero-depth identity, controllable
strength/timbre spread, unchanged event timing, and bounded voice/cache use.
Zero-reset buttons and one-piece editing are exercised on desktop and touch
layouts. Extreme tests exercise all 13 layouts, reversed roots, finite geometry
and sound at the new limits, continuous tuning, camera recovery, transformed
drawings, and immediate direction changes followed by Run or MIDI Start.

Human listening, touch feel on a physical phone, and physical MIDI-controller
checks remain unperformed. Synthesized material identity and musical usefulness
need that listening and playing pass.

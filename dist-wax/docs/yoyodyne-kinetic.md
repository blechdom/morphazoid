# Yoyodyne — kinetic string contract

The yo-yo is the instrument, not a playhead crossing note objects.
Throw / tug / hand movement -> taut/slack motion, spin and response engagement ->
a continuously excited string resonator -> a spatial musical phrase.
No tines, timeline, recorded vocals, microphone or hidden note sequence.

## First playable model
A 64 g body has linear position/velocity plus separate axial spin and inertia.
A unilateral compliant string constrains extension. Its solver couples axial
rotation and payout in unwinding/rewinding states; a sleeping bearing decouples
spin from travel. A bind engages a lossy response; return can stall if spin is
insufficient. Gravity and a moving hand supply forces; nothing attracts the body
to an authored yo-yo trajectory. Cradle is a prescribed finger-pinch geometry,
not automatic knot detection. Around-the-World uses a lateral throw and circular
hand pumping; tension transfers the hand's work into orbital motion.

The controller moves the hand and requests throw/bind actions. Sleeper, Cradle,
Around the World and Gravity Pull have distinct timing and hand actions.
Manual controls and dragging use that same model. Changing a trick does not
reset the body's state. Audio arm/mute never changes motion; Perform loops
tricks, Pause freezes motion and releases audio, Throw runs one manual gesture.
Recall restores settings and model in place and preserves Audio/Perform state.

## Sonic mapping
| Source | Sound destination | Visual evidence |
| --- | --- | --- |
| Spin, friction, tension | Energy into a harmonic periodic exciter | Disc spin and axle glow |
| Sounding length, tensile force | String resonator frequency, proportional to sqrt(T)/L | String span, thickness and live frequency |
| Throw, tug, bind, floor contact | Bounded transient excitation | String ripple and axle glow |
| Travel speed | Excitation brightness and dynamics | Moving body and trail |
| Position, angle | Equal-power stereo and harmonic shading | Body location and string direction |
| Catch | Excitation damping | Body back in the hand |

Synthesis is a sonification: a harmonically tuned, rotor-modulated exciter drives
a damped fractional-delay string resonator. It is not a literal recording or a
validated acoustic replica of nylon yo-yo string. There is no noise generator.
Controls are smoothed in the audio processor; physics never runs at display rate.

## Defaults / bounds
Tempo45–180/90 BPM; length0.35–1.2/.86m; throw energy.1–1/.6;
friction0–1/.24; gravity0–1.8/1x; compliance0–1/.3;
tone0–1/.28; musical rootMIDI38–74/50; output0–.8/.4.
Physical dimensions are authored approximations, not measured product specs.
Fixed240Hz physics; 50ms lookahead; bounded catch-up; worklet queue128 frames;
one continuous voice, 16384-sample delay, no unbounded voice allocation;
DPR<=2 and 140 trail points. Worklet stale-input watchdog fades the excitation.
Hidden pages freeze/mute and resume without stale bursts. Navigation releases
the shared output connection, context, processor, timers and listeners.
MIDI keeps the existing shared control/transport policy; no fabricated continuous
note-on stream is published. Research notes are in yoyodyne-research.md.

## Evidence and limits
[UCSB yo-yo dynamics](https://web.physics.ucsb.edu/~lecturedemonstrations/Composer/Pages/28.33.html)
supports separating translation and axle rotation. The unilateral compliant
constraint and prescribed mounts are approximations informed by the yo-yo
research notebook. Full 3-D orientation, gyroscopic precession, string twist,
arbitrary self-contact and realistic response-pad contact are not modeled.
[UNSW strings](https://newt.phys.unsw.edu.au/jw/strings.html) supports the ideal
length/tension pitch relationship. The musical register, exciter and level maps
are artistic extensions. No external code, samples or assets are copied.

## Acceptance
Deterministic throw/return; independent sleeper spin; finite energy/extension;
gravity, length, friction and throw-energy sensitivity; actual moving-hand
response; distinct trick trajectories; continuity during edits; explicit arm;
mute while moving; stale-clock recovery; stop/hide/teardown; finite bounded
non-silent stereo with decay and control leverage. Exercise all four tricks,
desktop1440x900, portrait390x844 and landscape844x390. Human listening and real
touch/MIDI/controller feel remain separate from automated characterization.

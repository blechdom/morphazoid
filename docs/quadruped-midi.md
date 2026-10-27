# Quadruped browser MIDI

MIDI notes now play the selected animal's temporary **Call** gesture, using the
same sound and animation as a head gesture or the C shortcut. Velocity controls
that call's intensity, not master volume, movement speed or score content.
Notes 36/37/38 select its three call rows; the three-note pattern repeats across
the keyboard. These are finite calls, not a new pitched-keyboard mode.

CC11 expression and channel pressure affect subsequent calls. Note Off, sustain,
poly pressure and bend neither retrigger a call nor alter the walking ensemble.
Calls retain their natural envelopes/tails; each animal has one manual call at a
time, so a new call replaces its previous one. CC121 resets performance
controllers. CC120/MIDI Off cancels calls and stops transport. CC7 remains an
explicit master-volume control; controller-profile macros retain priority.
Audio must be enabled (the explicit MIDI-enable action may arm it). No output
MIDI echo is added. WAX keeps its existing host mapping.

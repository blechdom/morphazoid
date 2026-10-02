# Audio input testing list

Preview: `http://localhost:4430/` after starting the source server on port 4430.

Each page uses the same gain knob → input meter(s) → mic icon, from left to right. A shared violet accent groups the knob, borderless meters, and square button. Input errors open a small popup beside the mic button with Retry and Dismiss actions; they never resize the strip. Select a mic input mode first where the instrument has several modes. SIMD supports microphone input in its Resonator, Freeze, and Granular engines.

On desktop, the strip sits in the menubar immediately before the output meters.
On phones and short landscape layouts, it sits inline to the left of the existing
preset dropdown. Mic/File and upload controls fit below that compact row when
needed. Pages with preset buttons keep the strip before their bank; pages without
presets keep it with their input controls. The Settings sound check keeps its
strip in the input test. Resizing moves the same controls and retains live capture.

For each page:

1. Open it: microphone permission should not be requested automatically.
2. Click the mic icon: grant permission and check the input meter.
3. Turn Gain down to its minimum and up to 150% (1.5×): the meter and captured/processed input should follow. Every input supports at least this boost for soft vocals; dB controls reach it at about +3.5 dB.
4. Click the mic icon again: the browser microphone indicator should turn off.
5. Start once more, then navigate away: capture should stop.
6. Try denying permission, and cancel a pending request by clicking the icon again.

Mic capture can run with master Audio off. Turn Audio on to hear the instrument. On sample recorders, Record remains the action that records a loop/sample. Finite capture pages stop automatically when their capture window ends. In Mic/File pages, choose File and use the upload icon to choose local audio.

| Page | Input behavior |
| --- | --- |
| [Graph Delay](http://localhost:4430/graph-delay.html) | live |
| [L-system Delay](http://localhost:4430/l-mic.html) | live |
| [Fabric Filter](http://localhost:4430/moire-drone.html) | live |
| [Sandy Syrup Delay](http://localhost:4430/sandy-syrup-delay.html) | mic/file |
| [Candy Coil Delay](http://localhost:4430/candy-coil-delay.html) | mic/file |
| [L-Systems](http://localhost:4430/l-systems.html) | live |
| [Graphs](http://localhost:4430/graphs.html) | live |
| [Throatazoid](http://localhost:4430/throatazoid.html) | live |
| [Morphynx](http://localhost:4430/morphynx.html) | live |
| [Alien Larynx](http://localhost:4430/alien-larynx.html) | live |
| [Micromorph](http://localhost:4430/micromorph.html) | live |
| [SIMD Resonator](http://localhost:4430/simd-resonator.html) | live |
| [SIMD Audio Lab](http://localhost:4430/simd-lab.html) | live |
| [Fractal Synthesis](http://localhost:4430/fractal-synthesis.html) | live |
| [Head Shed](http://localhost:4430/head-shed.html) | sample |
| [Crab Loom](http://localhost:4430/crab-loom.html) | sample |
| [Freeze Point](http://localhost:4430/freeze-point.html) | sample |
| [Scatter Ghost](http://localhost:4430/scatter-ghost.html) | sample |
| [Exceptional](http://localhost:4430/exceptional.html) | sample |
| [Lumber Loops](http://localhost:4430/lumber.html) | sample |
| [Slippery Resynthesis](http://localhost:4430/slippery-resynthesis.html) | mic/file |
| [Gesturama](http://localhost:4430/gesturama.html) | sample |
| [Acoustic Manifold](http://localhost:4430/acoustic-manifold.html) | sample |
| [Recursion](http://localhost:4430/recursion.html) | sample/file |
| [Tape Worm](http://localhost:4430/tape-worm.html) | sample/file |
| [Loop Soup](http://localhost:4430/loop-soup.html) | sample/file |
| [Hollowphonic](http://localhost:4430/hollowphonic.html) | live |
| [Loopini](http://localhost:4430/loopini.html) | sample |
| [Synthesaurus](http://localhost:4430/synthesis.html?method=fx-biquad) | mic/file |
| [Input settings](http://localhost:4430/settings.html#inputTest) | test |

Splice Ring, Onset Atlas, and Synaptic Resonance currently use demo audio and have no microphone capture. Strophe Lab, Nightingale Manifolds, and Crickets accept uploaded recordings but have no microphone capture.

Implementation: `src/ui/patterns/audio-input-strip.js` provides pure UI, `src/audio-input-control.js` binds instrument-owned callbacks, and `src/audio-input-meter.js` measures independent channels through a silent tap. The catalogue gear retains device/channel preferences; it does not replace the input strip.

import {
  FAVE_TOOL_IDS,
  TOOL_GROUPS,
} from "../nav.js?v=catalog-20260829-9";
import { instrumentMidiCapabilityForId } from "./instrument-midi-capabilities.js";

const define = (kind, description, start, features = [], pluginHref = null) => Object.freeze({
  kind,
  description,
  start,
  features: Object.freeze(features),
  pluginHref,
});

const CATALOG_DETAILS = Object.freeze({
  combo: define(
    "2D / 3D / 4D instrument",
    "A self-contained Polygon, Polyhedra, and Hyperpolyhedra instrument with one canvas, one shared transport, and dimension-aware form and rotation controls.",
    "Choose 2D, 3D, or 4D, then play the same running form continuously, as notes, or as triggers from the responsive Twin Rack panel.",
    ["Built-in synth", "Pointer", "Shared transport", "Self-contained app"],
  ),
  shape: define(
    "Synth",
    "Scans a 2D contour with moving points, lines, or rays; each geometric contact shapes pitch, pan, level, and timbre.",
    "Turn on audio, choose a reader, then move the contour or play a MIDI or computer key.",
    ["MIDI", "Computer keys"],
  ),
  "playhead-paint": define(
    "Drawing synth",
    "Turns freehand pointer strokes into playable sound gestures, mapping position, color, and pen size to pitch and timbre while mirrored axes create polyphonic reflections.",
    "Turn on audio, choose X and Y mappings and a pen, then draw; release to end the note or loop the recorded path.",
    ["Pointer", "Built-in synth"],
  ),
  boidzoid: define(
    "Flocking sine field",
    "Makes autonomous arrow playheads into continuous sine voices: height sweeps frequency without note divisions, horizontal position sets stereo, and speed breathes the level.",
    "Turn on audio, let the arrows drift, then drag the open surface to steer the sine field.",
    ["Pointer", "Built-in synth"],
  ),
  "vector-flight": define(
    "Circular flight geometry",
    "Keeps a wireframe ship centered inside a full 360-degree star field, mapping a circular listening contour, azimuth, proximity, radial velocity, and tangential motion directly into continuous voices, free-pitch flybys, or triggers without a scale grid.",
    "Turn on audio, choose Continuous, Notes, or Triggers, drag around the ship to rotate the physics mapping, then raise the throttle until points become hyperspace rays and full-circle plaid.",
    ["Pointer", "Built-in synth", "Spatial audio"],
  ),
  "surround-field": define(
    "Multichannel spatial instrument",
    "Places a playable synth source inside 7:4:1, 4:1, eight-speaker circle, eight-speaker cube, and two-to-thirty-two-channel custom arrays, with visible equal-power sends and per-output calibration.",
    "Turn on audio to probe the active device, choose an array, then drag the coral source, play the A–K pads, orbit a phrase, or test each numbered output.",
    ["Pointer", "Built-in synth", "Spatial audio", "Discrete output", "Device probe"],
  ),
  lattice: define(
    "Synth",
    "Slides an editable isohedral tiling beneath a reader so every crossed edge becomes a polyphonic synth event.",
    "Turn on audio, choose a tiling, then start the motion and move the reader.",
  ),
  "escher-tessellation": define(
    "Geometry synth",
    "Builds original procedural motifs on Euclidean wallpaper groups, similarity recursions, and exact Poincaré-disk reflection tilings whose rendered contours become the playhead paths.",
    "Tap a shape, then follow its literal outline, real shared-border neighbors, or matching pattern family; smaller measured contours naturally recur faster.",
  ),
  spiral: define(
    "Synth",
    "Warps an isohedral tiling into log-polar space and scans its radial and spiral edges for sound.",
    "Turn on audio, choose a reader, then run or drag the warped lattice.",
  ),
  solid: define(
    "Synth",
    "Cuts a moving 3D wireframe with a plane; every wire-plane intersection becomes a voice.",
    "Turn on audio, choose a solid, then rotate it or move the cutting plane.",
  ),
  hyper: define(
    "Synth",
    "Cuts a rotating 4D wireframe with a W hyperplane and sonifies the crossing edges.",
    "Turn on audio, choose a 4D form, then move the W reader or start rotation.",
  ),
  "graph-synth": define(
    "Network synth",
    "Sends inherited-pitch note pulses through editable directed graphs; edge length sets time, route turns set intervals, and cycle-closing edges create quieter, darker repeats.",
    "Turn on audio, choose or generate a graph, then send one note or run the pulse clock while dragging nodes and switching routes.",
    ["Built-in synth", "Pointer", "MIDI", "Feedback sequencing"],
  ),
  "hyper-rubix": define(
    "4D shape sequencer",
    "Separates five instrument presets—color drums, resonant prisms, bit voices, WebGPU acid, and seed-shell rattles—from three playback views: one selected cell, four view-facing cells, or all 64, 216, or 512 distinct notes in an order-2, order-3, or order-4 tesseract boundary.",
    "Turn on audio and Play shape loop, then orbit, Fold W, or make manual quarter-turns: the view chooses the clocked stickers while transformed position, depth, neighbors, fault lines, displacement, and disorder reshape each note without resetting time or adding a separate motion synth.",
    ["Pointer", "Built-in synth"],
  ),

  "shape-drums": define(
    "Drum machine",
    "Turns contour contacts and corner events into drum hits whose voices change with position, angle, and phase.",
    "Turn on audio, choose a reader and drum bank, then move the contour through it.",
  ),
  "lattice-drums": define(
    "Drum machine",
    "Turns tiling-reader contacts into drum hits selected and retuned by edge class, orientation, height, and angle.",
    "Turn on audio, choose a tiling and bank, then start the lattice motion.",
  ),
  "spiral-drums": define(
    "Drum machine",
    "Turns contacts in a log-polar tiling into drum patterns that follow its radial and spiral geometry.",
    "Turn on audio, choose a bank and reader, then run the spiral field.",
  ),
  "solid-drums": define(
    "Drum machine",
    "Turns intersections between a cutting plane and a 3D wireframe into a changing drum pattern.",
    "Turn on audio, choose a bank, then rotate the solid or move the plane.",
  ),
  rubix: define(
    "Geometric sequencer",
    "Offers five mutually exclusive banks: four sample-free drum kits read the two side faces, while 303 Acid reads only the upper face through its Classic or WebGPU engine; hidden stickers stay hard-silent.",
    "Choose one bank or preset, then drag the cube or enable Random Twists; in WebGPU 303 mode, sticker row, column, edge, current face, and visibility reshape each acid step.",
    ["Pointer"],
  ),
  "sliding-puzzle": define(
    "2D puzzle sequencer",
    "Reads a resizable 2 × 2 through 8 × 8 square or rectangular tile field as either a serial score or Rubix-style parallel rows, with four fixed home-row colors and one moving silent cell.",
    "Choose Lines together or One tile, set independent rows and columns, then slide complete lines, rotate the rectangle, scramble, or let Solve unwind the exact move history.",
    ["Pointer", "Built-in synth"],
  ),
  "wave-pool": define(
    "Hydroacoustic physical-model sequencer",
    "Couples piston paddles or pneumatic caissons to a slow gravity-wave clock, then makes breaking spray, entrained bubbles, wet boundary slaps, structural modes, and aerated whirlpools into four interlocking sample-free rhythm lanes.",
    "Turn on audio, run the four-lane sequence, then tap the pool or use keys 1–4 while changing water depth, wave height, bubble radius, wall system, and receiver position.",
    ["Built-in source", "Pointer", "Computer keys", "Physical-model DSP"],
  ),
  "hyper-drums": define(
    "Drum machine",
    "Turns 4D hyperplane intersections into drum hits selected by position and four-dimensional rotation.",
    "Turn on audio, choose a bank, then move the W reader or start rotation.",
  ),
  "l-system-drums": define(
    "Drum machine",
    "Walks through recursive branch heads and maps depth, angle, generation, phase, and position to drums.",
    "Turn on audio, choose a grammar and drum bank, then generate and play the tree.",
  ),
  "graph-drums": define(
    "Network drum machine",
    "Propagates percussion triggers through editable directed graphs, mapping node position, degree, route turn, path depth, and cycle pass to a shared sixteen-voice FM drum bank.",
    "Turn on audio, choose a topology and drum style, then seed a pulse or run the clock; cyclic routes return later with reduced amplitude and tone.",
    ["Built-in drums", "Pointer", "MIDI", "Feedback sequencing"],
  ),
  "linear-drums-machine": define(
    "Drum machine",
    "Paints notes, glissandi, rings, and parameter fields onto a looping time-frequency canvas powered by continuous percussion.",
    "Turn on audio, choose a preset and paint tool, draw on the canvas, then start the loop.",
  ),
  gesturama: define(
    "Camera gesture instrument",
    "Turns live motion into painted drums, continuously shaped resonant pads, recorded microphone samples, or a Karplus–Strong video harp.",
    "Start the camera, choose a preset, then move through the grid or strings; use the pointer only to paint new sound zones.",
    ["Camera input", "Mic input", "Color tracking", "Pointer"],
  ),

  "image-to-instrument-3": define(
    "Vocal formant instrument",
    "Grows every typed letter into its own morphable glottal mouth on a quiet one-shot wheel, sounding wet nasal and slime cavities only when each organ crosses the fixed three-o'clock reader.",
    "Turn on audio, set the letter wheel, and spin; it accelerates, coasts, and brakes before the final organ sustains and fades, then unlocks for another spin.",
    ["Built-in synth", "Pointer", "Computer keys"],
  ),

  lumber: define(
    "Loop instrument",
    "Records microphone loops as playable rings with pitch handles, filters, direction, pan, mute, solo, and shared delay.",
    "Allow microphone access, record a first ring, then drag its playheads and pitch handles.",
    ["Mic input"],
  ),
  micmic: define(
    "Mic processor",
    "Runs live microphone audio through an L-system tree where branches become delays and turns become pitch shifts.",
    "Allow microphone access, start input, then change the grammar or branch timing.",
    ["Mic input"],
  ),
  "graph-delay": define(
    "Mic processor",
    "Routes live microphone audio through a generated delay graph with switchable paths, pitch shifts, and feedback.",
    "Allow microphone access, choose a graph preset, then start input and open or close routes.",
    ["Mic input"],
  ),
  micromorph: define(
    "Realtime generative mic effect",
    "Streams microphone audio and sample-clocked performance controls to an optional local diffusion model, while five visible membranes expose the path from source to imaginary descendant.",
    "Use headphones, turn on the microphone, move Ancestor distance through the five derivation stages, then connect an MGA Stream v1 model host for neural audio; without one, the page identifies its bounded rehearsal DSP honestly.",
    ["Mic input", "Local model host", "Streaming PCM", "Parameter conditioning"],
  ),
  throatazoid: define(
    "Voice instrument",
    "Feeds microphone input, an internal glottis, or both through up to seven editable vocal tracts.",
    "Choose the glottis or microphone source, turn on audio, then drag the tongue and tract controls.",
    ["Mic input", "Built-in source"],
  ),
  "pink-trombonazoid": define(
    "Articulatory voice sequencer",
    "Turns a written word into editable phoneme blocks and automation lanes that animate pitch, breath, tongue, lips, nasal coupling, and mutation through a physical vocal tract.",
    "Enter a word, turn on audio, press Say word, then reshape its phoneme timing and articulatory automation lanes.",
    ["Built-in source", "Pointer"],
  ),
  syrinx: define(
    "Physical animal voice",
    "Models mammal folds, paired bird labia, frog membranes, and a rodent jet whistle through species-bounded vocal anatomy.",
    "Choose an animal and call, turn on audio, then trigger the gesture or hold Breath while reshaping its biological controls.",
    ["Built-in source", "Pointer"],
  ),
  "tongued-beasts": define(
    "Articulatory voice instrument",
    "Grafts human, macaque, canine, and avian tongue mechanics onto physical animal voice sources so tongue shape and motion continuously reshape the tract.",
    "Turn on audio, choose a host animal and tongue entity, then drag the anatomy or trigger a tongue movement preset.",
    ["Built-in source", "Pointer", "Computer keys"],
  ),
  hybrinx: define(
    "Animal voice sequencer",
    "Reveals the native keyframed pressure, pitch, closure, mouth, cavity, roughness, source-split, and bilateral-balance contours that animate physical animal calls through a playable tongue-shaped tract.",
    "Turn on audio, choose a host beast and native call, then play or loop it while the live timeline traces every sounding parameter contour beneath the animal.",
    ["Built-in source", "Pointer", "Computer keys"],
  ),
  "colony-syrinx": define(
    "Pressure-network voice sequencer",
    "Routes sixteen staggered lungs through eight coupled folds and a twelve-valve manifold into three differently shaped, polymetric mouths whose closures push pressure back through the whole organism.",
    "Turn on audio, hold Breath, then open source-to-mouth valves with C2–B2 or draw three interlocking mouth rhythms in the sequencer.",
    ["Built-in source", "Pointer", "Computer keys", "Physical-model DSP"],
  ),
  blowhole: define(
    "Cetacean physical-model instrument",
    "Separates delphinid phonic lips, the sperm whale's right-sided spermaceti pathway, and the coupled U-fold/cricoid-cushion source of baleen-whale song while the external blowhole remains a valve rather than the underwater sound source.",
    "Turn on audio, choose a dolphin or whale call, then play its visible gesture or hold pressure while dragging the paired source, air sac, and radiator anatomy.",
    ["Built-in source", "Pointer", "Computer keys", "Physical-model DSP"],
  ),
  "jaw-harp": define(
    "Physical-model instrument",
    "Couples a plucked cantilever reed to an interactive mouth cavity so one fixed reed fundamental excites harmonics selected by the tongue, jaw, lips, and cavity.",
    "Turn on audio, choose a harp and vowel preset, then pull and release the copper trigger or press Space to pluck.",
    ["Built-in source", "Pointer", "Computer keys"],
  ),
  harmonica: define(
    "Southern blues free-reed instrument",
    "Models a ten-hole diatonic harmonica as paired blow and draw reeds for single notes, double-stops, chords, bends, scoops, dips, falls, shakes, slaps, hand wah, throat vibrato, flutter, growl, octave tongue blocks, overbends, and signed blues breath rhythms.",
    "Turn on audio, choose a one- to four-hole mouth aperture and a blues gesture, then hold blow or draw; shape its rhythm, breath envelope, cover-hand filter, tongue, tract, bend, or overbend in real time.",
    ["Built-in source", "Pointer", "Computer keys", "MIDI expression", "Physical-model DSP"],
  ),
  hambone: define(
    "Monophonic physical beatbox sequencer",
    "Moves a fully mutable face and one persistent Pink Trombone–lineage oral waveguide between twenty-five exclusive gestures: plosives, clicks, PHSHSHK, two resonant hand slaps, a low kick, reversible breath, pitched DOO, suction and trills, BURP, eight open-throat, vibrato, register-break, subharmonic, nasal, and rattle voices, plus FWEE from a pressure-driven jet at the missing upper-left central incisor.",
    "Turn on audio, tap a pad, face zone, or the visible missing-tooth gap, drag either animated multi-contact hand to slap, then sequence one gesture per column at any length from 1 through 64 steps and up to 520 BPM; live-mutate preset face effects and choose, solo, mutate, or modulate one to eight sequential voice characters without layering mouths.",
    ["Built-in source", "Pointer", "Computer keys"],
  ),
  "breath-atlas": define(
    "Breath physical-model atlas",
    "Compares nineteen mouth and breath instruments through six physical source topologies, from quill-driven strings and bidirectional free reeds to lip valves, flutes, jaw reeds, and mouth bows.",
    "Choose an instrument by evidence tier, turn on audio, then hold inhale or exhale; for hand-driven strings, pluck, rub, or bow against a linked breath rhythm.",
    ["Built-in source", "Pointer", "Computer keys"],
  ),
  morphynx: define(
    "Hybrid physical voice",
    "Crossfades persistent Syrinx and larynx models while multiple physical voices, tongue constrictions, nasal resonances, microphone formants, and letter-key mutations reshape the tract.",
    "Choose an animal and voice, move the Syrinx–Larynx morph, then play a call or hold A–Z; add voices, tongues, or nasal cavities to hear the anatomy branch out.",
    ["Mic input", "Built-in source", "Computer keys", "Pointer"],
  ),
  "hyper-syrinx": define(
    "Modular physical voice",
    "Multiplies breaths, membranes, labia, tracheas, tracts, mouths, and lips into a patchable polyphonic physical-voice laboratory.",
    "Turn on audio, duplicate or remove organ modules, choose how they share signals, then hold Breath while reshaping the combined voice.",
    ["Built-in source", "Pointer", "Computer keys"],
  ),
  "alien-larynx": define(
    "Experimental voice instrument",
    "Keeps the recognizable Throatazoid voice beneath five optional systems for coupled folds, true-scale propagation, mouth genomes, robot glands, and wormhole routing.",
    "Start with every alien system bypassed, turn on audio, then bring the five mutations online one at a time or return instantly to the anchored voice.",
    ["Mic input", "Built-in source", "Computer keys"],
  ),
  "spelling-synthesizer": define(
    "Voice instrument",
    "Sounds each typed letter through the Bellazoid tract, sustained KAL phone samples, or the twenty-band Voxazoid vocoder while typing rhythm shapes the voice.",
    "Begin typing, choose an engine and personality, then adjust rhythm dynamics and the vowel-pair delay.",
    ["Built-in synth", "Computer keys"],
  ),
  vocalzoid: define(
    "Singing sequencer",
    "Turns one written word into editable pitched notes, sustained vowel bodies, and overlapped phoneme joins using bundled open sample voices or a local UTAU bank.",
    "Turn on audio, drag the syllable notes into a melody, choose KAL16 or one of eight bundled open demo voices, then press Sing word; extracted UTAU folders can be imported locally.",
    ["Open sample banks", "Local file input", "Pointer"],
  ),

  "shepard-risset": define(
    "Synth",
    "Builds the illusion of endlessly rising or falling pitch from overlapping octave layers.",
    "Turn on audio, choose a direction or preset, then adjust speed, density, and range.",
  ),
  "slippery-resynthesis": define(
    "Spectral resynthesizer",
    "Tracks microphone or local-file audio across logarithmic FFT bands, then rebuilds it through endlessly slipping Shepard glissando banks with adaptive consonant excitation.",
    "Choose Mic or File, turn on audio, then shape the glide, transpose, spectral tilt, carrier color, consonant detail, stereo spread, and dry/slip mix.",
    ["Mic input", "Local file input", "Speech-detail resynthesis"],
  ),
  "moire-drone": define(
    "Noise-field drone",
    "Sends correlated colored noise through colliding two-dimensional wave fields and a Shepard-wrapped filter lattice whose rotating mass-spring frequency fabric is crossed by drops, circular harmonics, spirals, and shock fronts.",
    "Turn on audio, choose a preset, then pluck to launch a 1–50 Hz propagation or drag vertically to tug the fabric; shape its wave mode, travel, repetition, tension, damping, rotation, and pull.",
    ["Built-in noise", "Pointer", "Spectral propagation", "Adaptive DSP"],
  ),
  "drum-roll-please": define(
    "Rhythm synth",
    "Translates the Shepard–Risset illusion into overlapping tempo octaves whose struck voices morph from kick through tom, hand drum, and air.",
    "Choose a direction and tempo glissando, then optionally make pitch follow the endlessly changing rhythm rate.",
    ["Built-in synth"],
  ),
  ouroborousel: define(
    "Rhythm-pitch synth",
    "Builds an endless roll from higher-note chunks, Ouroboros drum bodies, or both, carrying octave-related pulses through the rhythm–pitch fusion threshold.",
    "Choose Notes, Ouroboros Drums, or Notes + Drums, start the carousel, and shape its direction, roll rate, bank width, and shared rhythm-to-pitch fusion; Notes and Combo also expose note-chunk controls.",
    ["Built-in synth", "Pointer"],
  ),
  ourorourobouroboros: define(
    "Recursive rhythm-pitch synth",
    "Purple-and-blue octave rings carry slow drum or note rhythms into pitch, then slower phase-locked gates carve silences into the high spectrum so the next rhythm seems to emerge from inside it.",
    "Choose Notes, Drums, or Layered, add or remove Shepard rings, then shape the pitch threshold, note-lift/nested distance, interruption reach, silence depth, and rhythm-to-sustain audio mix.",
    ["Built-in synth", "Pointer"],
  ),
  ouroboros: define(
    "Percussion synth",
    "Strikes a Rattlesnake-style drum through octave-related Shepard bodies whose pitch keeps rising or falling while the audible register appears never to leave.",
    "Turn on audio, choose Rise or Fall, then balance glissando speed, hit rate, octave-bank width, and the kick-to-air timbre morph.",
    ["Built-in synth"],
  ),
  "ouroboros-borealis": define(
    "Percussion synth",
    "Crosses an endless Shepard pitch bank with an endless Risset rhythm bank, giving one Rattlesnake percussion body independent illusory pitch and tempo motion.",
    "Start the dual playheads, send pitch and rhythm together or in opposite directions, then reshape their intervals, phase, coupling, ranges, and timbre.",
    ["Built-in synth", "Pointer"],
  ),
  "sandy-syrup-delay": define(
    "Delay instrument",
    "Processes microphone or file audio with staggered grains that can hold their rates or glide together.",
    "Choose microphone or a file, start the source, then move between Sand and Syrup behavior.",
    ["Mic input", "File input"],
  ),
  "candy-coil-delay": define(
    "Delay instrument",
    "Uses staggered centered-hump delay heads that pass below, through, and above the source pitch.",
    "Choose microphone or a file, start the source, then tap a range or lock its reciprocal relationship with head speed.",
    ["Mic input", "File input"],
  ),

  "l-system": define(
    "Synth",
    "Expands turtle grammars into branching scores whose recursion, turns, taper, and timing shape a voice tree.",
    "Turn on audio, select a grammar, generate the tree, then play its branch traversal.",
  ),
  recursion: define(
    "DSP instrument",
    "Runs noise, impulses, microphone capture, or a file through the recursive Fuzzy Donut signal process.",
    "Choose a source, turn on audio, then raise the recursion depth and switch visual views.",
    ["Mic input", "File input"],
  ),
  julia: define(
    "Synth",
    "Traces a Julia-set boundary and maps left and right turns to cyclic Shepard pitch.",
    "Turn on audio, choose or drag the Julia parameter, then start the boundary trace.",
  ),
  "striped-staircase": define(
    "Fractal sequencer",
    "Browses a live Mandelbrot field and turns escape-depth stripes into discrete steps or sliding musical moments while zoom and traversal reshape timing.",
    "Turn on audio, choose Steps or Slide, then play the depth motion and drag, scroll, or pinch through the live fractal.",
    ["Pointer", "Computer keys", "WebGL"],
  ),

  "recursive-fm": define(
    "Synth",
    "Nests FM operators so every recursion level modulates the next while depth changes are crossfaded.",
    "Turn on audio, then play a MIDI or computer key and adjust depth and modulation amount.",
    ["MIDI", "Computer keys"],
  ),
  "recursive-pm": define(
    "Synth",
    "Folds a carrier through recursive phase operators, adding progressively smaller offsets at deeper levels.",
    "Turn on audio, then play a MIDI or computer key and adjust depth and phase amount.",
    ["MIDI", "Computer keys"],
  ),
  "chaotic-fm": define(
    "Synth",
    "Sends oscillators through a nonlinear FM cascade with a bounded shaping stage between levels.",
    "Turn on audio, then play a MIDI or computer key and shape the cascade depth.",
    ["MIDI", "Computer keys"],
    "plugins.html#chaotic-fm",
  ),
  "chaotic-pm": define(
    "Synth",
    "Applies nonlinear shaping at each recursive phase-modulation level, with smooth and raw comparison modes.",
    "Turn on audio, then play a MIDI or computer key and compare smooth and raw modes.",
    ["MIDI", "Computer keys"],
  ),
  "cascading-fm": define(
    "Synth",
    "Chains sine oscillators across rising, equal, or falling base frequencies, each one frequency-modulating the next with tapered depth.",
    "Turn on audio, then adjust the stage count, cascade ratio, modulation depth, and depth taper.",
  ),
  "cascading-pm": define(
    "Synth",
    "Chains sine operators across rising, equal, or falling base frequencies, with every stage offsetting the next stage's phase in radians.",
    "Turn on audio, then adjust the stage count, cascade ratio, phase index, and index taper.",
  ),
  weierstrass: define(
    "Synth",
    "Sums exponentially spaced oscillators as a waveform or uses the same fractal bank for FM and phase modulation.",
    "Turn on audio, choose Wave, FM, or Phase, then adjust the oscillator bank.",
  ),
  "plasma-ball": define(
    "Chaotic synth",
    "Fires quiet, intermittent synth-static through branching paths across the near and far surfaces of a three-dimensional glass globe.",
    "Turn on audio, then move or touch the glass to gather some discharges while the rest keep searching the globe.",
    ["Built-in synth", "Pointer"],
  ),
  "webgpu-303": define(
    "WebGPU synth",
    "Streams a WGSL compute-shader acid voice into Web Audio chunks as a separate GPU synthesis instrument.",
    "Use a WebGPU-capable browser, turn on Audio, then shape the pattern, partials, filter, and chunk settings.",
  ),
  "webgpu-synths": define(
    "GPU shader synth laboratory",
    "Runs four control lanes, six adjustable synthesis models, editable additive ranks, a causal FIR, feed-forward delay taps, and waveshaping across two WGSL compute passes.",
    "Use a WebGPU-capable browser, turn on Audio, choose a theme or sequence generator, then draw pitch, pulse, timbre, and model motion directly on the stage.",
    ["WebGPU", "Pointer", "Built-in synth"],
  ),
  "shader-synth-playground": define(
    "Modular WebGPU synth",
    "Patches typed synthesis, modulation, shaping, control, and spatial modules into an editable graph that renders stereo audio with WGSL compute shaders.",
    "Use a WebGPU-capable browser, select a patch, turn on Audio, then select modules to change their parameters and signal routing.",
    ["WebGPU", "Pointer", "Built-in synth"],
  ),

  "fm-drums": define(
    "Drum synth",
    "Edits the sixteen-voice FM and shaped-noise percussion bank used by the drum machines.",
    "Turn on audio or MIDI, hit a pad, then edit and save its synthesized voice.",
    ["MIDI", "Computer keys"],
  ),
  "linear-drums": define(
    "Five-model percussion synth",
    "Maps frequency onto one continuous body with four Rattlesnake models plus a Karplus Strong model whose four complete presets morph across the snake.",
    "Turn on audio, choose a sound model, then drag across the spectrum or silently reposition its dotted morph boundaries.",
  ),
  "karplus-strong": define(
    "Physical-model synth",
    "Plucks noise or impulse excitation into a tunable feedback-delay model with spectral loss, polarity, nonlinearity, modulation, pickup, body, and sympathetic-string controls.",
    "Turn on audio, choose a string or preset, then click or drag across the stage to pluck and strum.",
    ["Built-in synth", "MIDI", "Pointer", "Computer keys"],
  ),
  "karplus-carpet": define(
    "Microsound physical-model synth",
    "Turns a dense two-dimensional surface of close areas into freshly synthesized Karplus attacks with adjustable one-shot amplitude ADSR, two sound-variety banks, deterministic cell color, and coupled resonators across a tunable microtonal pitch field, without loading sample grains.",
    "Press and drag across the surface: each newly crossed area sounds once per gesture, while moving inside an area or holding still stays silent.",
    ["Built-in synth", "MIDI", "Pointer", "Computer keys"],
  ),
  "sample-drums": define(
    "Sample instrument",
    "Edits a sixteen-slot 808/909-style sample bank that can also replace the Lattice Drum Machine synth bank.",
    "Turn on audio or MIDI, hit a pad, then load or trim samples in the selected slot.",
    ["MIDI", "Computer keys", "File input"],
  ),

  "sorting-algorithms": define(
    "Algorithmic sequencer",
    "Runs five sorting algorithms on the same shuffle and maps comparisons, swaps, and writes to sound.",
    "Choose an algorithm, randomize the values, then press Play to hear each operation.",
  ),
  dijkstra: define(
    "Algorithmic synth",
    "Spreads a weighted search frontier across a grid and maps node distance, weight, and position into a spatial path score.",
    "Turn on audio, rewire the graph, then play or scrub the frontier.",
  ),
  hanoi: define(
    "Recursive bell synth",
    "Rings every legal Towers of Hanoi transfer as a metallic voice whose pitch follows disk size and pan follows the peg.",
    "Turn on audio, choose the disk count, then play the recursive transfer sequence.",
  ),
  minimax: define(
    "Adversarial search synth",
    "Turns minimax evaluations into tense calls and answers while alpha-beta pruning cuts branches with percussive noise.",
    "Turn on audio, reseed the contest, then play or scrub the search tree.",
  ),
  nqueens: define(
    "Constraint harmony synth",
    "Builds harmony from valid queen placements, noise from conflicts, and falling gestures from backtracking.",
    "Turn on audio, shuffle the columns, then play the board search.",
  ),
  euclid: define(
    "Number theory rhythm synth",
    "Turns Euclidean remainders into descending bass and each exact quotient into a repeated rhythmic pulse cell.",
    "Turn on audio, choose a new ratio, then play or scrub its division chain.",
  ),

  "orbital-ferris": define(
    "Nested contour synth",
    "Carries an audible Level 1 contour through nested moving shapes whose inherited positions control pitch, amplitude modulation, delay time, and feedback.",
    "Turn on audio, start the Ferris transport, then assign shapes and Pass, Modulator, or Delay processing to the higher levels.",
    ["Built-in synth"],
  ),

  "order-tones": define(
    "Quantum sonification",
    "Turns modular repetition and an inverse-QFT model into a probability comb used to estimate order and factors.",
    "Turn on audio, choose a preset, then run shots and listen to the probability peaks.",
  ),
  morphazoidical: define(
    "Mapping workbench",
    "Shows the live form, contact, reader, and event data available for geometry-to-sound mappings.",
    "Turn on audio, choose a form and reader, then drag the stage and inspect its live values.",
  ),
  "bell-square": define(
    "Quantum sonification",
    "Simulates two atoms with a controlled collision phase and sonifies correlated measurements along chosen axes.",
    "Turn on audio, choose measurement axes, then run repeated shots.",
  ),
  "entanglement-dance": define(
    "Quantum sonification",
    "Hears quantum entanglement as a slowed-down square dance — two qubits precess together or in opposition based on their Bell state.",
    "Turn on audio, press play, then try each Bell state and listen for correlated or anti-correlated melodic motion.",
  ),
  "quantum-square-dance": define(
    "Quantum sonification",
    "Runs an exact classical simulation of controlled spin exchange in paired atoms and sonifies the evolving joint state, phase, and correlations.",
    "Turn on audio, then play or scrub the exchange dance and compare its paired-atom scenes.",
    ["Built-in synth"],
  ),
  annealogue: define(
    "Quantum sonification",
    "Moves eight three-qubit states through an anneal, mapping energy, probability, and phase to a cube and choir.",
    "Turn on audio, choose a problem preset, then run or scrub the anneal.",
  ),
  "gravity-walk": define(
    "Physics sonification",
    "Moves a bead along a polygon, star, or circle and maps height, speed, and impacts to sound.",
    "Turn on audio, choose a path, then release the bead or change gravity.",
  ),
  ricochet: define(
    "Physics sonification",
    "Bounces balls through editable arenas where wall angle controls pitch and impact speed controls level.",
    "Turn on audio, choose an arena, then launch balls and move its walls.",
  ),
  rigidity: define(
    "Physics sonification",
    "Loads pinned bar-and-joint structures under gravity to reveal which constraints hold, flex, or fail.",
    "Turn on audio, choose a structure, then apply load or move a joint.",
  ),
  "rolling-measure": define(
    "Physics sonification",
    "Rolls regular polygons vertex to vertex while centroid lift, contact changes, and impact loss shape the sound.",
    "Turn on audio, choose a polygon, then start rolling and adjust the surface.",
  ),
  "falling-forms": define(
    "Physics sonification",
    "Drops rigid forms into a stage and maps impacts, rotation, friction, and settling to sound.",
    "Turn on audio, choose a form, then drop copies into the stage.",
  ),
  "charge-garden": define(
    "Field sonification",
    "Combines positive and negative charges in a softened field with visible tracers and equipotential lines.",
    "Turn on audio, place or drag charges, then release tracers into the field.",
  ),
  "packing-pressure": define(
    "Physics sonification",
    "Compresses falling disks into a contact network and maps force, density, coordination, and jams to sound.",
    "Turn on audio, add disks, then lower the press or change their packing.",
  ),
  "geodesic-drift": define(
    "Geometry sonification",
    "Compares nearby straightest paths on a plane, cylinder, sphere, and torus as their separation evolves.",
    "Turn on audio, choose a surface, then launch nearby paths and vary their starting angle.",
  ),
  "kinetic-hull": define(
    "Geometry sonification",
    "Recomputes a convex hull and Delaunay edges around moving points; boundary changes and edge flips trigger sound.",
    "Turn on audio, add or move points, then start their motion.",
  ),
  "moire-organ": define(
    "Synth",
    "Crosses rising and falling Shepard lattices so weighted line intersections emphasize audible coincidences.",
    "Turn on audio, start both layers, then change their angles and glissando rates.",
  ),
  "chladni-plate": define(
    "Physical-model synth",
    "Draws standing-wave nodal curves on a square plate and uses mode and strike position to shape its partials.",
    "Turn on audio, choose a plate mode, then click or drag a strike point.",
  ),
  "spring-choir": define(
    "Physical-model synth",
    "Simulates a coupled mass-spring chain and turns its normal modes into a quiet oscillator choir.",
    "Turn on audio, pull a mass, then release it and change the coupling.",
  ),
  "gear-ratio-drums": define(
    "Drum machine",
    "Rotates two meshed cogs at tooth-locked rates so contacts become a gear-ratio polyrhythm.",
    "Turn on audio, choose tooth counts, then start the gears and change their speed.",
  ),
  "cellular-automata": define(
    "Algorithmic texture",
    "Scrolls elementary automata while each generation becomes a short mono black-and-white pulse texture.",
    "Turn on audio, choose a rule and seed, then hear every new row scan from beginning to end.",
  ),
  "prime-sieve": define(
    "Algorithmic sequencer",
    "Runs the sieve of Eratosthenes, turning prime discoveries into a rising melody and eliminations into ticks.",
    "Turn on audio, reset the grid, then run or step through the sieve.",
  ),
  "lissajous-orbits": define(
    "Synth",
    "Uses one integer ratio for both a closed Lissajous curve and its two-oscillator musical interval.",
    "Turn on audio, choose an axis ratio, then change phase and speed.",
  ),
  "pendulum-wave": define(
    "Physics sonification",
    "Sets neighboring pendulums to related periods so they drift apart, form waves, and reunite.",
    "Turn on audio, release the pendulums, then change their count or period spread.",
  ),
  "double-pendulum": define(
    "Physics sonification",
    "Releases two nearly identical double pendulums and widens an interval as their chaotic paths diverge.",
    "Turn on audio, set a small starting difference, then release both pendulums.",
  ),
  "reaction-diffusion": define(
    "Simulation synth",
    "Evolves a Gray-Scott chemical field through spots, bands, and splits that control a small sound field.",
    "Turn on audio, choose a reaction preset, then seed or paint the field.",
  ),
  "atomic-orbitals": define(
    "Scientific sonification",
    "Draws signed planar slices of hydrogen orbitals and maps quantum numbers and nodes to a harmonic bank.",
    "Turn on audio, choose quantum numbers, then move through the orbital slice.",
  ),
  "dna-translator": define(
    "Biological sequencer",
    "Scans editable DNA through four base pitches and adds a tone for each completed amino-acid codon.",
    "Turn on audio, edit or randomize the strand, then start the scanner.",
  ),
  "neural-pulse": define(
    "Network sonification",
    "Sends four inputs through a fixed weighted network and triggers sound as activity crosses each layer.",
    "Turn on audio, change the four inputs, then send a pulse through the network.",
  ),
  "fourier-epicycles": define(
    "Additive synth",
    "Chains rotating harmonic vectors into classic waveforms, with every visible vector acting as an audible partial.",
    "Turn on audio, choose a waveform, then change the number of epicycles.",
  ),
  "gravity-lens": define(
    "Scientific sonification",
    "Uses an idealized gravitational lens to split one source into two apparent images and a paired interval.",
    "Turn on audio, move the source or lens, then compare image position, level, and delay.",
  ),
  "cantor-lock": define(
    "Fourier experiment",
    "Searches for a finite signal inside matching Cantor-shaped position and frequency masks, mapping addresses to pitch and pulse while retained energy and leakage divide a glass-and-amber ensemble.",
    "Turn on audio, compare an interval with Cantor masks, then tighten the trap and listen to retained energy separate from leakage.",
  ),
  "escape-dust": define(
    "Chaos experiment",
    "Compares classical survivors with a leaking finite wave in an open triadic baker map: phase-space position writes melody and pan, survival orchestrates the chord, and escape flux strikes its accents.",
    "Turn on audio, release a packet, then step or play the map while escaped points and wave energy enter the flux monitor.",
  ),
  linebreaker: define(
    "Fourier experiment",
    "Probes crossed lines, a Sierpiński carpet, and Cantor dust while occupied runs sustain organ rails, gaps fracture the phrase, and two-dimensional Fourier peaks orchestrate the harmony.",
    "Turn on audio, rotate the line probe across each structure, then compare its sampled gaps with the two-dimensional Fourier pattern.",
  ),
});

const ADDITIONAL_TAG_IDS = Object.freeze({
  "pink-trombonazoid": Object.freeze(["sequencers"]),
  hybrinx: Object.freeze(["sequencers"]),
  "colony-syrinx": Object.freeze(["sequencers"]),
  blowhole: Object.freeze(["sequencers"]),
  hambone: Object.freeze(["sequencers"]),
  "l-system-drums": Object.freeze(["fractals-recursion"]),
  "graph-drums": Object.freeze(["fractals-recursion"]),
  "graph-synth": Object.freeze(["fractals-recursion"]),
  "fm-drums": Object.freeze(["geometry-drums"]),
  "linear-drums": Object.freeze(["geometry-drums"]),
  "sample-drums": Object.freeze(["geometry-drums"]),
  "wave-pool": Object.freeze(["geometry-drums"]),
  micmic: Object.freeze(["fractals-recursion"]),
  "recursive-fm": Object.freeze(["fractals-recursion"]),
  "recursive-pm": Object.freeze(["fractals-recursion"]),
  "chaotic-fm": Object.freeze(["fractals-recursion"]),
  "chaotic-pm": Object.freeze(["fractals-recursion"]),
  "cascading-fm": Object.freeze(["fractals-recursion"]),
  "cascading-pm": Object.freeze(["fractals-recursion"]),
  weierstrass: Object.freeze(["fractals-recursion"]),
});
const FAVES_TAG = Object.freeze({ id: "faves", label: "Faves" });

const instrumentToolGroups = TOOL_GROUPS
  .filter((group) => group.catalogue !== false)
  .map((group) => ({
    ...group,
    tools: group.tools.filter((tool) => tool.catalogue !== false),
  }))
  .filter((group) => group.tools.length > 0);
const instrumentTools = instrumentToolGroups.flatMap((group) => group.tools);
const instrumentIds = new Set(instrumentTools.map((tool) => tool.id));
const groupById = new Map(instrumentToolGroups.map((group) => [group.id, group]));
const primaryGroupByToolId = new Map(instrumentToolGroups.flatMap((group) => (
  group.tools.map((tool) => [tool.id, group])
)));
const missingDetails = instrumentTools.filter((tool) => !CATALOG_DETAILS[tool.id]);
const unusedDetails = Object.keys(CATALOG_DETAILS).filter((id) => !instrumentIds.has(id));
const invalidAdditionalTags = Object.entries(ADDITIONAL_TAG_IDS).flatMap(
  ([instrumentId, tagIds]) => tagIds
    .filter((tagId) => !instrumentIds.has(instrumentId) || !groupById.has(tagId))
    .map((tagId) => `${instrumentId}:${tagId}`),
);
const invalidFaveIds = FAVE_TOOL_IDS.filter((id) => (
  !instrumentIds.has(id) || primaryGroupByToolId.get(id)?.id === "experiments"
));

if (
  missingDetails.length
  || unusedDetails.length
  || invalidAdditionalTags.length
  || invalidFaveIds.length
) {
  throw new Error([
    missingDetails.length
      ? `Missing catalogue details: ${missingDetails.map((tool) => tool.id).join(", ")}`
      : "",
    unusedDetails.length ? `Unused catalogue details: ${unusedDetails.join(", ")}` : "",
    invalidAdditionalTags.length
      ? `Invalid catalogue tags: ${invalidAdditionalTags.join(", ")}`
      : "",
    invalidFaveIds.length ? `Invalid faves: ${invalidFaveIds.join(", ")}` : "",
  ].filter(Boolean).join(". "));
}

const instrumentByToolId = new Map(instrumentTools.map((tool) => {
  const primaryGroup = primaryGroupByToolId.get(tool.id);
  const tagIds = primaryGroup.id === "experiments"
    ? [primaryGroup.id]
    : [
      primaryGroup.id,
      ...(ADDITIONAL_TAG_IDS[tool.id] ?? []),
      ...(FAVE_TOOL_IDS.includes(tool.id) ? [FAVES_TAG.id] : []),
    ];
  const tags = Object.freeze([...new Set(tagIds)].map((tagId) => {
    if (tagId === FAVES_TAG.id) return FAVES_TAG;
    const group = groupById.get(tagId);
    return Object.freeze({ id: group.id, label: group.label });
  }));
  const midiCapability = instrumentMidiCapabilityForId(tool.id);
  return [tool.id, Object.freeze({
    ...tool,
    ...CATALOG_DETAILS[tool.id],
    features: Object.freeze([...new Set([
      ...CATALOG_DETAILS[tool.id].features,
      "MIDI",
      ...(midiCapability?.computerKeyboardMode === "none" ? [] : ["Computer keys"]),
    ])]),
    tags,
    status: primaryGroup.id === "experiments" ? "Works in progress" : null,
    imageHref: tool.imageHref ?? `assets/instruments/${tool.id}.webp`,
  })];
}));

export const INSTRUMENT_GROUPS = Object.freeze(instrumentToolGroups.map((group) => Object.freeze({
  id: group.id,
  label: group.label,
  tools: Object.freeze(group.tools.map((tool) => instrumentByToolId.get(tool.id))),
})));

export const INSTRUMENTS = Object.freeze(instrumentTools.map((tool) => instrumentByToolId.get(tool.id)));

export function instrumentById(id) {
  return INSTRUMENTS.find((instrument) => instrument.id === id) ?? null;
}

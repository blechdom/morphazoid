// Presentation-only ownership for the original 154-field Chiptune sound ABI.
// These groups never change synthesis values or preset defaults.
// Song-only marks the normal explicit-note Pattern workflow. Legacy imported
// Pattern cells marked auto can still read procedural drum timing.
// Sequence lane activeLength / stepBeats / gate and performance Volume are
// intentionally separate from this ABI and should stay with their performers.
const freeze = Object.freeze;

const groups = [
  {
    "id": "globalMix",
    "label": "Mix + tuning",
    "owner": "global",
    "tab": "mix",
    "core": [
      "tempo",
      "transpose",
      "pitchRange",
      "gain",
      "synthMix",
      "stereoWidth",
      "scaleMask"
    ],
    "detail": [
      "tuningCents",
      "voiceCrossfeed",
      "fadeIn",
      "fadeCurve"
    ],
    "description": "Master timing, pitch classes, output and the pitched-voice/Noise bus. Drum bus is in Drums."
  },
  {
    "id": "globalTimbre",
    "label": "Shared tone",
    "owner": "global",
    "tab": "tone",
    "core": [
      "pulseWidth",
      "pwmDepth",
      "pwmRate",
      "noiseRate",
      "noiseColor"
    ],
    "detail": [],
    "description": "Pulse controls affect Upper A/B; noise clock/color affect Snare, Hats, Shaker and Noise."
  },
  {
    "id": "echo",
    "label": "Echo",
    "owner": "global",
    "tab": "echo",
    "core": [
      "echoWet",
      "echoTime",
      "echoDecay",
      "echoStereo"
    ],
    "detail": [
      "echoTaps",
      "echoCrossfeed",
      "echoAlternate"
    ],
    "description": "Echoes of pitched voices and Noise. Drum repeats are controlled by Ghosts in Drums."
  },
  {
    "id": "songArrangement",
    "label": "Song",
    "owner": "global",
    "tab": "song",
    "core": [
      "patternSeed",
      "gateLength",
      "gateRate",
      "sectionUnits",
      "leadSectionShare"
    ],
    "detail": [
      "gateAttack",
      "gateRelease",
      "gatePatternSteps",
      "gatePatternPhase",
      "gateShortRatio",
      "gateLongRatio",
      "gateFastRatio",
      "fastGateShare",
      "longGateBoostShare",
      "gateSwitchShortUnits",
      "gateSwitchLongUnits",
      "gateSwitchShortPhase",
      "gateSwitchLongPhase",
      "sectionPhase",
      "gateA0",
      "gateA1",
      "gateA2",
      "gateA3",
      "gateB0",
      "gateB1",
      "gateB2",
      "gateB3"
    ],
    "description": "Procedural pitch, gate patterns and the Upper/Lead arrangement. Pattern uses each lane’s Steps, Rate and Gate controls. Pitch range still changes the Arp contour in Pattern."
  },
  {
    "id": "drumsTone",
    "label": "Drum bus",
    "owner": "drums",
    "tab": "tone",
    "core": [
      "drumMix",
      "drumDecay",
      "ghostDrums"
    ],
    "detail": [
      "ghostDelayDivisor",
      "ghostPan"
    ],
    "description": "Bus level, shared decay and the independent drum-repeat layer."
  },
  {
    "id": "drumsRhythm",
    "label": "Drum rhythm",
    "owner": "drums",
    "tab": "rhythm",
    "core": [
      "drumRate"
    ],
    "detail": [],
    "description": "Song’s procedural drum rate. Pattern timing is set separately for each drum lane."
  },
  {
    "id": "kickTone",
    "label": "Kick",
    "owner": "drums",
    "tab": "tone",
    "core": [
      "kickLevel",
      "kickTone",
      "kickDecayRate",
      "kickClipKnee"
    ],
    "detail": [
      "kickAttackTime",
      "kickBodySweep",
      "kickTransientSweep",
      "kickBodyPhase",
      "kickTransientPhase"
    ],
    "description": "Body/transient pitch sweeps, envelope and nonlinear clipping.",
    "part": "kick"
  },
  {
    "id": "kickRhythm",
    "label": "Kick rhythm",
    "owner": "drums",
    "tab": "rhythm",
    "core": [
      "kickCycle",
      "kickSubcycle"
    ],
    "detail": [
      "kickPhase"
    ],
    "description": "",
    "part": "kick"
  },
  {
    "id": "snareTone",
    "label": "Snare",
    "owner": "drums",
    "tab": "tone",
    "core": [
      "snareLevel",
      "snareNoiseMix",
      "snareTone",
      "snareDecayRate",
      "snareNoiseColor"
    ],
    "detail": [
      "snareHoldTime",
      "snareNoiseSweep",
      "snareNoiseRate",
      "snareModRate",
      "snareModDepth",
      "snareCarrierRate"
    ],
    "description": "A swept noise layer blended with an FM tone; Noise/Tone selects which circuit dominates.",
    "part": "snare"
  },
  {
    "id": "snareRhythm",
    "label": "Snare rhythm",
    "owner": "drums",
    "tab": "rhythm",
    "core": [
      "snareCycle"
    ],
    "detail": [
      "snarePhase"
    ],
    "description": "",
    "part": "snare"
  },
  {
    "id": "hatsTone",
    "label": "Hats",
    "owner": "drums",
    "tab": "tone",
    "core": [
      "hatLevel",
      "hatBalance",
      "hatADecayRate",
      "hatBDecayRate",
      "hatANoiseColor",
      "hatBNoiseColor"
    ],
    "detail": [
      "hatANoiseRate",
      "hatBLowNoiseRate",
      "hatBHighNoiseRate",
      "hatBHighMix"
    ],
    "description": "Two hat layers share one sequence lane. A/B balance determines which controls are audible.",
    "part": "hats"
  },
  {
    "id": "hatsRhythm",
    "label": "Hat rhythm",
    "owner": "drums",
    "tab": "rhythm",
    "core": [
      "hatACycle",
      "hatARepeat",
      "hatBCycle"
    ],
    "detail": [
      "hatASubcycle",
      "hatAPhase",
      "hatBPhase",
      "hatARepeatPhase"
    ],
    "description": "",
    "part": "hats"
  },
  {
    "id": "shakerTone",
    "label": "Shaker",
    "owner": "drums",
    "tab": "tone",
    "core": [
      "shakerLevel",
      "shakerDecayRate",
      "shakerNoiseRate",
      "shakerNoiseColor"
    ],
    "detail": [],
    "description": "",
    "part": "shaker"
  },
  {
    "id": "shakerRhythm",
    "label": "Shaker rhythm",
    "owner": "drums",
    "tab": "rhythm",
    "core": [
      "shakerCycle"
    ],
    "detail": [
      "shakerPhase"
    ],
    "description": "",
    "part": "shaker"
  },
  {
    "id": "bassTone",
    "label": "Bass tone",
    "owner": "bass",
    "tab": "tone",
    "core": [
      "bassPulseWidth",
      "bassPulseLevel",
      "bassSineLevel",
      "bassRegister"
    ],
    "detail": [],
    "description": "Independent pulse and sine amplitudes are the Bass tone blend; the always-visible voice Volume scales both."
  },
  {
    "id": "bassRhythm",
    "label": "Bass rhythm",
    "owner": "bass",
    "tab": "rhythm",
    "core": [
      "bassClock",
      "bassSpan",
      "bassGateRateRatio"
    ],
    "detail": [
      "bassPhase"
    ],
    "description": "Song clock, generated pitch spread and gate multiplier. The generated Bass basis can also transpose Arp."
  },
  {
    "id": "arpTone",
    "label": "Arp tone",
    "owner": "arp",
    "tab": "tone",
    "core": [
      "arpTone",
      "arpRegister",
      "arpSpan",
      "arpLevel"
    ],
    "detail": [],
    "description": "Saw-to-sine warmth and drive; span sets the range of the normalized Arp contour in both modes."
  },
  {
    "id": "arpRhythm",
    "label": "Arp rhythm",
    "owner": "arp",
    "tab": "rhythm",
    "core": [
      "arpRate",
      "arpOctaves",
      "arpOctaveRate",
      "arpGateDepth"
    ],
    "detail": [
      "arpBassFollow",
      "arpPhase",
      "arpOctavePhase"
    ],
    "description": "Song contour speed, octave motion and optional Bass gate/follow. Pattern plays its own explicit loop."
  },
  {
    "id": "leadTone",
    "label": "Lead tone",
    "owner": "lead",
    "tab": "tone",
    "core": [
      "leadTone",
      "leadRegister",
      "leadLevel"
    ],
    "detail": [],
    "description": "Saw-to-sine warmth/drive and register. Shared pulse-width controls do not affect Lead."
  },
  {
    "id": "leadRhythm",
    "label": "Lead rhythm",
    "owner": "lead",
    "tab": "rhythm",
    "core": [
      "leadClock",
      "leadSpan",
      "leadInterval",
      "leadTrillRate",
      "leadTrillShare",
      "leadPhraseUnits"
    ],
    "detail": [
      "leadGateRateRatio",
      "leadPhase",
      "leadTrillPhase",
      "leadPhrasePhase"
    ],
    "description": "Song note generation, trill and gate phrase. Pattern bypasses trill, phrase and section switching."
  },
  {
    "id": "upperOneTone",
    "label": "Upper A tone",
    "owner": "upperOne",
    "tab": "tone",
    "core": [
      "upperOneTone",
      "upperOneRegister",
      "upperOneLevel"
    ],
    "detail": [],
    "description": "Pulse-to-sine warmth/drive and register. Shared pulse width and PWM are in Shared tone."
  },
  {
    "id": "upperOneRhythm",
    "label": "Upper A rhythm",
    "owner": "upperOne",
    "tab": "rhythm",
    "core": [
      "pitchClock",
      "upperOneSpan"
    ],
    "detail": [
      "upperOnePhase"
    ],
    "description": "Upper A’s Song clock also clocks Upper B, scaled by its B/A rate multiplier."
  },
  {
    "id": "upperTwoTone",
    "label": "Upper B tone",
    "owner": "upperTwo",
    "tab": "tone",
    "core": [
      "upperTwoTone",
      "upperTwoRegister",
      "upperTwoLevel"
    ],
    "detail": [],
    "description": "Pulse-to-sine warmth/drive and register. Shared pulse width and PWM are in Shared tone."
  },
  {
    "id": "upperTwoRhythm",
    "label": "Upper B rhythm",
    "owner": "upperTwo",
    "tab": "rhythm",
    "core": [
      "upperTwoClockRatio",
      "upperTwoSpan",
      "upperTwoGateRateRatio"
    ],
    "detail": [
      "upperTwoPhase"
    ],
    "description": "Song note-rate multiplier relative to Upper A, pitch spread and gate multiplier."
  },
  {
    "id": "noiseTone",
    "label": "Noise sweep",
    "owner": "noise",
    "tab": "tone",
    "core": [
      "textureSweep",
      "textureDecay",
      "noiseLevel"
    ],
    "detail": [],
    "description": "Song’s decaying noise sweep. Shared noise clock/color are in Shared tone. No Noise voice is synthesized in Pattern."
  },
  {
    "id": "noiseRhythm",
    "label": "Noise rhythm",
    "owner": "noise",
    "tab": "rhythm",
    "core": [
      "texturePeriod"
    ],
    "detail": [
      "texturePhase"
    ],
    "description": "Sweep period and offset in Song beats; Noise has no step-sequence lane."
  }
];

const songOnly = new Set([
  "patternSeed",
  "gateRate",
  "gateLength",
  "sectionUnits",
  "pitchClock",
  "bassClock",
  "gateFastRatio",
  "gateSwitchShortUnits",
  "gateSwitchLongUnits",
  "leadTrillRate",
  "leadInterval",
  "leadPhraseUnits",
  "arpRate",
  "arpOctaveRate",
  "arpOctaves",
  "drumRate",
  "gateAttack",
  "gateRelease",
  "texturePeriod",
  "textureDecay",
  "kickCycle",
  "kickSubcycle",
  "gateA0",
  "gateA1",
  "gateA2",
  "gateA3",
  "gateB0",
  "gateB1",
  "gateB2",
  "gateB3",
  "gatePatternSteps",
  "gateShortRatio",
  "gateLongRatio",
  "fastGateShare",
  "longGateBoostShare",
  "leadSectionShare",
  "leadTrillShare",
  "leadClock",
  "arpBassFollow",
  "snareCycle",
  "snarePhase",
  "hatACycle",
  "hatASubcycle",
  "hatARepeat",
  "hatAPhase",
  "hatBCycle",
  "shakerCycle",
  "shakerPhase",
  "textureSweep",
  "upperTwoClockRatio",
  "kickPhase",
  "hatBPhase",
  "hatARepeatPhase",
  "arpPhase",
  "arpGateDepth",
  "bassGateRateRatio",
  "leadGateRateRatio",
  "upperTwoGateRateRatio",
  "upperOnePhase",
  "upperTwoPhase",
  "bassPhase",
  "leadPhase",
  "gatePatternPhase",
  "gateSwitchShortPhase",
  "gateSwitchLongPhase",
  "sectionPhase",
  "leadTrillPhase",
  "leadPhrasePhase",
  "arpOctavePhase",
  "texturePhase",
  "upperOneSpan",
  "upperTwoSpan",
  "bassSpan",
  "leadSpan",
  "noiseLevel"
]);

export const PARAM_GROUPS = freeze(groups.map(group => freeze({
  ...group,
  core: freeze(group.core),
  detail: freeze(group.detail),
  keys: freeze([...group.core, ...group.detail]),
  mode: [...group.core, ...group.detail].every(key => songOnly.has(key)) ? "song" : "both",
})));
export const PARAM_MODES = freeze(Object.fromEntries(PARAM_GROUPS.flatMap(group =>
  group.keys.map(key => [key, songOnly.has(key) ? "song" : "both"]),
)));
export const PARAM_OWNERS = freeze(Object.fromEntries(PARAM_GROUPS.flatMap(group =>
  group.keys.map(key => [key, group.id]),
)));
export const PARAM_SPECIAL = freeze({
  "scaleMask": "pitch-classes",
  "echoAlternate": "toggle",
  "gateA0": "gate-durations",
  "gateA1": "gate-durations",
  "gateA2": "gate-durations",
  "gateA3": "gate-durations",
  "gateB0": "gate-durations",
  "gateB1": "gate-durations",
  "gateB2": "gate-durations",
  "gateB3": "gate-durations"
});

export const PARAM_LABELS = freeze({
  "tempo": "Tempo",
  "transpose": "Transpose",
  "gain": "Patch gain",
  "synthMix": "Synth + noise",
  "stereoWidth": "Voice width",
  "scaleMask": "Scale",
  "tuningCents": "Fine tune",
  "voiceCrossfeed": "Voice blend",
  "fadeIn": "Intro time",
  "fadeCurve": "Intro curve",
  "pulseWidth": "Upper pulse",
  "pwmDepth": "Upper PWM",
  "pwmRate": "PWM speed",
  "noiseRate": "Noise clock",
  "noiseColor": "Noise color",
  "echoWet": "Return",
  "echoTime": "Time",
  "echoDecay": "Decay",
  "echoStereo": "Echo width",
  "echoTaps": "Taps",
  "echoCrossfeed": "Echo blend",
  "echoAlternate": "Alternate",
  "patternSeed": "Seed",
  "pitchRange": "Pitch range",
  "gateLength": "Gate length",
  "gateRate": "Gate rate",
  "sectionUnits": "Section beats",
  "leadSectionShare": "Lead share",
  "gateAttack": "Attack",
  "gateRelease": "Release",
  "gatePatternSteps": "Gate steps",
  "gatePatternPhase": "Gate offset",
  "gateShortRatio": "Short length",
  "gateLongRatio": "Long length",
  "gateFastRatio": "Fast ratio",
  "fastGateShare": "Fast share",
  "longGateBoostShare": "Boost share",
  "gateSwitchShortUnits": "Switch A beats",
  "gateSwitchLongUnits": "Switch B beats",
  "gateSwitchShortPhase": "Switch A offset",
  "gateSwitchLongPhase": "Switch B offset",
  "sectionPhase": "Section offset",
  "drumMix": "Drum bus",
  "drumDecay": "Drum tails",
  "ghostDrums": "Ghosts",
  "ghostDelayDivisor": "Ghost spacing",
  "ghostPan": "Ghost pan",
  "drumRate": "Song rate",
  "kickLevel": "Level",
  "kickTone": "Pitch",
  "kickDecayRate": "Decay rate",
  "kickClipKnee": "Clip knee",
  "kickAttackTime": "Attack",
  "kickBodySweep": "Body sweep",
  "kickTransientSweep": "Click sweep",
  "kickBodyPhase": "Body pitch",
  "kickTransientPhase": "Click amount",
  "kickCycle": "Cycle",
  "kickSubcycle": "Subcycle",
  "kickPhase": "Offset",
  "snareLevel": "Level",
  "snareNoiseMix": "Noise / tone",
  "snareTone": "Pitch",
  "snareDecayRate": "Decay rate",
  "snareNoiseColor": "Color",
  "snareHoldTime": "Hold",
  "snareNoiseSweep": "Noise sweep",
  "snareNoiseRate": "Noise speed",
  "snareModRate": "Mod rate",
  "snareModDepth": "Mod depth",
  "snareCarrierRate": "Carrier",
  "snareCycle": "Cycle",
  "snarePhase": "Offset",
  "hatLevel": "Level",
  "hatBalance": "A / B mix",
  "hatADecayRate": "A decay rate",
  "hatBDecayRate": "B decay rate",
  "hatANoiseColor": "A color",
  "hatBNoiseColor": "B color",
  "hatANoiseRate": "A noise speed",
  "hatBLowNoiseRate": "B low speed",
  "hatBHighNoiseRate": "B high speed",
  "hatBHighMix": "B high mix",
  "hatACycle": "A cycle",
  "hatARepeat": "A repeat",
  "hatBCycle": "B cycle",
  "hatASubcycle": "A subcycle",
  "hatAPhase": "A offset",
  "hatBPhase": "B offset",
  "hatARepeatPhase": "Repeat offset",
  "shakerLevel": "Level",
  "shakerDecayRate": "Decay rate",
  "shakerNoiseRate": "Noise speed",
  "shakerNoiseColor": "Color",
  "shakerCycle": "Cycle",
  "shakerPhase": "Offset",
  "bassPulseWidth": "Pulse width",
  "bassPulseLevel": "Pulse mix",
  "bassSineLevel": "Sine mix",
  "bassRegister": "Register",
  "bassClock": "Song rate",
  "bassSpan": "Note span",
  "bassGateRateRatio": "Gate ratio",
  "bassPhase": "Offset",
  "arpTone": "Tone",
  "arpRegister": "Register",
  "arpSpan": "Note span",
  "arpLevel": "Level",
  "arpRate": "Song rate",
  "arpOctaves": "Octaves",
  "arpOctaveRate": "Octave speed",
  "arpGateDepth": "Gate depth",
  "arpBassFollow": "Bass follow",
  "arpPhase": "Offset",
  "arpOctavePhase": "Octave offset",
  "leadTone": "Tone",
  "leadRegister": "Register",
  "leadLevel": "Level",
  "leadClock": "Song rate",
  "leadSpan": "Note span",
  "leadInterval": "Trill interval",
  "leadTrillRate": "Trill rate",
  "leadTrillShare": "Trill share",
  "leadPhraseUnits": "Phrase beats",
  "leadGateRateRatio": "Gate ratio",
  "leadPhase": "Offset",
  "leadTrillPhase": "Trill offset",
  "leadPhrasePhase": "Phrase offset",
  "upperOneTone": "Tone",
  "upperOneRegister": "Register",
  "upperOneLevel": "Level",
  "pitchClock": "A + B rate",
  "upperOneSpan": "Note span",
  "upperOnePhase": "Offset",
  "upperTwoTone": "Tone",
  "upperTwoRegister": "Register",
  "upperTwoLevel": "Level",
  "upperTwoClockRatio": "B / A rate",
  "upperTwoSpan": "Note span",
  "upperTwoGateRateRatio": "Gate ratio",
  "upperTwoPhase": "Offset",
  "textureSweep": "Sweep",
  "textureDecay": "Decay rate",
  "noiseLevel": "Level",
  "texturePeriod": "Period beats",
  "texturePhase": "Offset",
  "gateA0": "A 1–8",
  "gateA1": "A 9–16",
  "gateA2": "A 17–24",
  "gateA3": "A 25–32",
  "gateB0": "B 1–8",
  "gateB1": "B 9–16",
  "gateB2": "B 17–24",
  "gateB3": "B 25–32"
});

export const PARAM_NOTES = freeze({
  "tempo": "Master beats per second. Display as BPM when desired; all rhythmic clocks follow it.",
  "transpose": "Semitone shift of all five pitched voices. Drum tuning is separate.",
  "gain": "Final sound-engine gain, after synth echoes and drum ghosts.",
  "synthMix": "Scales all five pitched voices plus the Noise sweep, before echo. Does not scale drums.",
  "stereoWidth": "Widens Upper A, Upper B and Arp; centered Bass, Lead and Noise are unaffected.",
  "voiceCrossfeed": "Cross-mixes and normalizes the Upper A/B and Arp channels before echo.",
  "fadeIn": "Duration of the fade from transport time zero; has no effect after the fade completes.",
  "fadeCurve": "Shape of the opening fade only; has no effect after the fade completes.",
  "scaleMask": "Enabled pitch classes used by nearest-note quantization in both modes; keep at least one enabled.",
  "tuningCents": "Fine tuning of the five pitched voices. Percussion frequencies are unaffected.",
  "pulseWidth": "Base duty cycle of Upper A/B pulse oscillators only. Lead/Arp use saws; Bass has its own pulse width.",
  "pwmDepth": "Depth of the Upper A/B pulse-width modulation only; zero makes PWM speed inaudible.",
  "pwmRate": "Upper A/B pulse-width sine modulation speed, in radians per second; audible only with nonzero PWM depth.",
  "noiseRate": "Clock of the shared hash-noise generator used by Snare, both Hats, Shaker and Noise; not the kick.",
  "noiseColor": "Shared two-sample noise-difference spacing for Snare, Hats, Shaker and Noise; not a conventional low-pass cutoff.",
  "echoWet": "Gain of taps after the dry tap; zero has no echo return.",
  "echoTime": "Seconds between analytic synth/Noise taps; independent of beat tempo.",
  "echoDecay": "Successive echo gain ratio; zero suppresses every delayed tap.",
  "echoTaps": "Includes the dry tap: one means no delayed echoes; maximum eight.",
  "echoStereo": "Stereo widening of every synth/Noise tap, including the dry tap.",
  "echoCrossfeed": "Attenuation of the opposite channel in each tap; also changes the dry tap’s right channel.",
  "echoAlternate": "Swaps successive synth/Noise tap channels when enabled.",
  "patternSeed": "Changes generated Song notes through fract(step² × seed). Explicitly edited notes do not use it.",
  "pitchRange": "Song: scales generated pitch ranges and Arp contour. Pattern: only scales Arp’s normalized contour.",
  "gateLength": "Multiplies Song gate durations; bypassed by Pattern’s per-lane Gate control.",
  "gateRate": "Scales Song gate clocks for Upper A/B, Bass, Lead and optionally Arp.",
  "gateAttack": "Song gate attack width, in gate-clock units; bypassed in Pattern.",
  "gateRelease": "Song gate release width, in gate-clock units; bypassed in Pattern.",
  "gatePatternSteps": "Shared Song gate-bank length, separate from each voice’s editable sequence Steps.",
  "gatePatternPhase": "Offset shared by Song gate banks A/B.",
  "gateShortRatio": "Duration for Song gate-pad states marked short.",
  "gateLongRatio": "Duration for Song gate-pad states marked long.",
  "gateFastRatio": "Fast Song gate-clock multiplier for Upper A/B.",
  "fastGateShare": "Fraction of each short switch period that uses the fast Upper gate clock.",
  "longGateBoostShare": "Fraction of the long switch period that boosts Upper B’s gate clock.",
  "gateSwitchShortUnits": "Length of the Upper gate-speed switch A cycle, in Song beats.",
  "gateSwitchLongUnits": "Length of Upper B’s extra gate-speed switch B cycle, in Song beats.",
  "gateSwitchShortPhase": "Phase offset of gate-speed switch A.",
  "gateSwitchLongPhase": "Phase offset of gate-speed switch B.",
  "sectionUnits": "Upper/Lead alternating section length in Song beats; also used when capturing later sections into Pattern.",
  "leadSectionShare": "Fraction of each Song section assigned to Lead; Upper A/B occupy the remainder.",
  "sectionPhase": "Moves the Upper/Lead alternation through each Song section.",
  "drumMix": "Common dry and ghost drum-bus level, controlled once by Bus in the Drums footer.",
  "drumDecay": "Divides the kick, snare, hats and shaker decay rates; larger values lengthen all drum tails.",
  "ghostDrums": "Level of the separate drum repeat layer; independent of synth Echo return.",
  "ghostDelayDivisor": "Larger values bring drum repeats closer: delay seconds = tempo / divisor.",
  "ghostPan": "Stereo placement of the drum repeat layer only.",
  "drumRate": "Procedural Song drum clock; Pattern uses each drum lane’s step duration.",
  "kickTone": "Scales the body and transient phases, changing perceived kick pitch and click.",
  "kickDecayRate": "Larger values shorten the kick’s exponential tail; Drum tails scales the time constant.",
  "kickClipKnee": "Smaller values hard-clip the kick more strongly; larger values soften and reduce it.",
  "kickAttackTime": "Attenuates the beginning of the kick up to the specified attack time.",
  "kickBodyPhase": "Amplitude of the kick’s decaying body phase: affects its pitch and initial phase, not just an offset.",
  "kickTransientPhase": "Amplitude of the kick’s rapidly decaying transient phase.",
  "kickBodySweep": "Exponential body-phase decay rate: changes kick pitch sweep.",
  "kickTransientSweep": "Exponential transient-phase decay rate: changes kick click duration.",
  "snareNoiseMix": "Crossfade between swept noise and FM tone; all-noise bypasses snare pitch/carrier/modulation controls.",
  "snareTone": "Scales snare FM modulator and carrier speed; inaudible when Noise / tone is fully noise.",
  "snareDecayRate": "Larger values shorten the snare tail after Hold; Drum tails scales the time constant.",
  "snareHoldTime": "Full-level hold before the snare’s exponential decay starts.",
  "snareNoiseSweep": "Sweep speed of the snare-noise input; inaudible on a fully tonal snare.",
  "snareNoiseRate": "Multiplier of snare-noise input; inaudible on a fully tonal snare.",
  "snareNoiseColor": "Difference spacing of the snare-noise filter; combines with global Noise color.",
  "snareModRate": "FM modulator speed of the tonal snare component.",
  "snareModDepth": "FM modulation index of the tonal snare component.",
  "snareCarrierRate": "Carrier speed of the tonal snare component.",
  "hatBalance": "Crossfade from Hat A to Hat B; both share the Hats lane and overall Hats level.",
  "hatADecayRate": "Hat A exponential decay rate; higher means a shorter tail.",
  "hatBDecayRate": "Hat B exponential decay rate; higher means a shorter tail.",
  "hatANoiseRate": "Speed of Hat A’s noise input.",
  "hatANoiseColor": "Hat A noise-difference spacing, multiplied by global Noise color.",
  "hatBLowNoiseRate": "Speed of Hat B’s low noise component.",
  "hatBHighNoiseRate": "Speed of Hat B’s high noise component.",
  "hatBHighMix": "Gain of Hat B’s high noise component.",
  "hatBNoiseColor": "Hat B noise-difference spacing, multiplied by global Noise color.",
  "shakerDecayRate": "Shaker exponential decay rate; higher means a shorter tail.",
  "shakerNoiseRate": "Speed of the shaker’s noise input.",
  "shakerNoiseColor": "Shaker noise-difference spacing, multiplied by global Noise color.",
  "bassPulseWidth": "Bass-only pulse duty cycle; inaudible if Pulse mix is zero.",
  "bassPulseLevel": "Gain of the Bass pulse component. Voice Volume scales both pulse and sine after this mix.",
  "bassSineLevel": "Gain of the Bass sine component. Voice Volume scales both pulse and sine after this mix.",
  "bassClock": "Song Bass note rate; also changes the source Bass basis followed by Arp.",
  "bassSpan": "Song Bass generated note span; also affects Arp when Bass follow is nonzero.",
  "bassGateRateRatio": "Song Bass gate multiplier; also affects Arp when its Gate depth is nonzero.",
  "bassPhase": "Song Bass note/sequence phase; also moves the basis followed by Arp.",
  "arpSpan": "Semitone range of the Arp contour in both modes, before Pitch range and scale quantization.",
  "arpRate": "Song Arp contour/sequence rate. Pattern uses its own step duration.",
  "arpOctaves": "Range of stepped Song octave modulation; zero disables octave motion.",
  "arpOctaveRate": "Speed of Song octave modulation; inaudible when Octaves is zero.",
  "arpGateDepth": "Song crossfade from continuous Arp to the Bass gate pattern.",
  "arpBassFollow": "How much of the generated Song Bass basis transposes Arp; independent of Bass volume/mute.",
  "arpPhase": "Song Arp contour and sequence phase.",
  "arpOctavePhase": "Song octave-motion phase offset.",
  "leadClock": "Procedural Song Lead note rate.",
  "leadSpan": "Procedural Song Lead note span; explicit notes bypass it.",
  "leadInterval": "Semitone interval added during the trill-on part of Song Lead notes.",
  "leadTrillRate": "Song Lead trill speed; requires nonzero interval and an audible trill share.",
  "leadTrillShare": "Portion of the Song trill cycle with the interval applied.",
  "leadPhraseUnits": "Period of the Song Lead gate phrase, in beats.",
  "leadGateRateRatio": "Song Lead gate multiplier within its phrase.",
  "leadPhase": "Song Lead note/sequence phase.",
  "leadTrillPhase": "Song Lead trill phase offset.",
  "leadPhrasePhase": "Song Lead gate-phrase phase offset.",
  "pitchClock": "Song Upper A note rate; also drives Upper B before its B/A rate multiplier.",
  "upperOneSpan": "Procedural Song Upper A note span; explicit notes bypass it.",
  "upperOnePhase": "Song Upper A note/sequence phase.",
  "upperTwoClockRatio": "Multiplier of Upper A’s Song note rate for Upper B.",
  "upperTwoSpan": "Procedural Song Upper B note span; explicit notes bypass it.",
  "upperTwoGateRateRatio": "Song Upper B gate-speed multiplier.",
  "upperTwoPhase": "Song Upper B note/sequence phase.",
  "textureSweep": "Rate of the Noise input’s exponential sweep, in Song beats.",
  "textureDecay": "Noise amplitude decay rate, in Song beats; higher means a shorter sweep.",
  "texturePeriod": "Noise sweep repeat length, in Song beats. Noise has no step sequence and is silent in Pattern.",
  "texturePhase": "Phase of the Noise sweep cycle.",
  "noiseLevel": "Noise sweep level in its character footer, before the shared Synth + noise bus. Noise is absent in Pattern.",
  "upperOneTone": "Upper A: negative blends the oscillator toward a sine; positive applies soft drive. Zero preserves the source waveform.",
  "upperOneLevel": "Upper A level, controlled once in its character footer. Existing XY and trim offsets are included in that displayed value.",
  "upperTwoTone": "Upper B: negative blends the oscillator toward a sine; positive applies soft drive. Zero preserves the source waveform.",
  "upperTwoLevel": "Upper B level, controlled once in its character footer. Existing XY and trim offsets are included in that displayed value.",
  "leadTone": "Lead: negative blends the oscillator toward a sine; positive applies soft drive. Zero preserves the source waveform.",
  "leadLevel": "Lead level, controlled once in its character footer. Existing XY and trim offsets are included in that displayed value.",
  "arpTone": "Arp: negative blends the oscillator toward a sine; positive applies soft drive. Zero preserves the source waveform.",
  "arpLevel": "Arp level, controlled once in its character footer. Existing XY and trim offsets are included in that displayed value.",
  "upperOneRegister": "Upper A register in semitones, after scale quantization; active in both modes.",
  "upperTwoRegister": "Upper B register in semitones, after scale quantization; active in both modes.",
  "bassRegister": "Bass register in semitones, after scale quantization; active in both modes.",
  "leadRegister": "Lead register in semitones, after scale quantization; active in both modes.",
  "arpRegister": "Arp register in semitones, after scale quantization; active in both modes.",
  "kickLevel": "Kick level, controlled once in the Drums footer. Existing part trims are included in that displayed value.",
  "snareLevel": "Snare level, controlled once in the Drums footer. Existing part trims are included in that displayed value.",
  "hatLevel": "Hats level, controlled once in the Drums footer. Existing part trims are included in that displayed value.",
  "shakerLevel": "Shaker level, controlled once in the Drums footer. Existing part trims are included in that displayed value.",
  "kickCycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "kickSubcycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "snareCycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "hatACycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "hatASubcycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "hatARepeat": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "hatBCycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "shakerCycle": "Procedural Song drum period in drum-clock beats; explicit Pattern hits bypass it.",
  "kickPhase": "Procedural Song drum-cycle phase; explicit Pattern hits bypass it.",
  "snarePhase": "Procedural Song drum-cycle phase; explicit Pattern hits bypass it.",
  "hatAPhase": "Procedural Song drum-cycle phase; explicit Pattern hits bypass it.",
  "hatBPhase": "Procedural Song drum-cycle phase; explicit Pattern hits bypass it.",
  "hatARepeatPhase": "Procedural Song drum-cycle phase; explicit Pattern hits bypass it.",
  "shakerPhase": "Procedural Song drum-cycle phase; explicit Pattern hits bypass it.",
  "gateA0": "Eight packed 2-bit durations for Song gate bank A, steps 1–8: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateA1": "Eight packed 2-bit durations for Song gate bank A, steps 9–16: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateA2": "Eight packed 2-bit durations for Song gate bank A, steps 17–24: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateA3": "Eight packed 2-bit durations for Song gate bank A, steps 25–32: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateB0": "Eight packed 2-bit durations for Song gate bank B, steps 1–8: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateB1": "Eight packed 2-bit durations for Song gate bank B, steps 9–16: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateB2": "Eight packed 2-bit durations for Song gate bank B, steps 17–24: off, short, normal, long. Render as pads, never a numeric knob.",
  "gateB3": "Eight packed 2-bit durations for Song gate bank B, steps 25–32: off, short, normal, long. Render as pads, never a numeric knob."
});

export function simdChiptuneParameterGroups(owner, { part = null, tab = null } = {}) {
  return PARAM_GROUPS.filter(group => group.owner === owner
    && (part === null || !group.part || group.part === part)
    && (tab === null || group.tab === tab));
}

export function simdChiptuneParameterActive(key, mode = "song") {
  return mode !== "pattern" || PARAM_MODES[key] === "both";
}

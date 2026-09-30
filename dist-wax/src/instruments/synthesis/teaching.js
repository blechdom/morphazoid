// Implementation audit and controlled touchstones for the original synthesis bank.
export const TEACHING_DATA = {
  "sampling": {
    "depth": "Working sample-playback core",
    "implementation": "One mono source is read through a movable looping region; playback increment supplies transposition, reversal and slow rate variation. Nearest/linear reads, start jitter and a boundary fade are implemented.",
    "limitations": [
      "The built-in source is original procedural audio, not a recorded instrument. Uploads share a 262144-sample mono buffer.",
      "Loop crossfade is currently a fade to zero at each boundary, not an equal-power overlap between loop ends. Playback speed changes pitch and duration together."
    ],
    "touchstones": [
      {
        "id": "tape-speed-pitch-and-duration",
        "title": "Tape-speed pitch and duration",
        "presetId": "whole-phrase",
        "listenFor": "Halving playback rate lowers every pitch an octave and doubles source-event duration; doubling reverses both changes.",
        "listen": "Halving playback rate lowers every pitch an octave and doubles source-event duration; doubling reverses both changes.",
        "gesture": "Hold a note. Compare Frequency 220, 110 and 440 Hz with Rate variation at zero and a full forward loop.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "loop-length",
            "label": "Loop length",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "rate-variation",
            "label": "Rate variation",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "direction",
            "label": "Direction",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ],
            "optionLabels": [
              "Forward"
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "a-slice-becomes-an-oscillator",
        "title": "A slice becomes an oscillator",
        "presetId": "tiny-bright-loop",
        "listenFor": "Short repetitions expose a loop pitch and the timbre of the selected region; moving the region changes the repeated waveform.",
        "listen": "Short repetitions expose a loop pitch and the timbre of the selected region; moving the region changes the repeated waveform.",
        "gesture": "Hold at 220 Hz. Sweep Loop length from 25% to 3%, then move Position through 0%, 50% and 90%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "loop-length",
            "label": "Loop length",
            "unit": "%",
            "physicalValues": [
              25,
              3
            ],
            "normalizedValues": [
              0.2268041237113402,
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "position",
            "label": "Position",
            "unit": "%",
            "physicalValues": [
              0,
              50,
              90
            ],
            "normalizedValues": [
              0,
              0.5,
              0.9
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "reverse-the-internal-event-shape",
        "title": "Reverse the internal event shape",
        "presetId": "backward-bloom",
        "listenFor": "The source event develops backwards while the common ADSR still moves forwards.",
        "listen": "The source event develops backwards while the common ADSR still moves forwards.",
        "gesture": "Hold the same pitch and switch Direction between Forward and Reverse. Keep Rate variation at zero to isolate reversal.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "rate-variation",
            "label": "Rate variation",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "direction",
            "label": "Direction",
            "unit": "",
            "physicalValues": [
              0,
              1
            ],
            "normalizedValues": [
              0,
              1
            ],
            "optionLabels": [
              "Forward",
              "Reverse"
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "wavetable": {
    "depth": "Working four-table oscillator",
    "implementation": "Four 2048-point tables contain sine, triangle, saw and square shapes, generated with up to 64 harmonics. Continuous shape interpolation, phase warping, lower table resolution, filtering, folding and a detuned voice are real.",
    "limitations": [
      "Only four built-in shapes are present; arbitrary wavetable import and scanned multi-frame tables are absent.",
      "These are fixed harmonic-limited tables, not a pitch-dependent mipmap bank. Reduced Table resolution quantizes phase rather than rebuilding a smaller table; interpolation cannot remove those deliberate phase steps. Warping/folding can add aliases."
    ],
    "touchstones": [
      {
        "id": "sine-triangle-saw-square",
        "title": "Sine, triangle, saw, square",
        "presetId": "round-fundamental",
        "listenFor": "A sine has one line; triangle/square emphasize odd harmonics; saw adds both odd and even harmonics.",
        "listen": "A sine has one line; triangle/square emphasize odd harmonics; saw adds both odd and even harmonics.",
        "gesture": "Hold 220 Hz with Brightness 100%, Pulse width 50%, Wavefold and Unison mix zero. Move Shape through 0%, 33.333%, 66.667% and 100%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "brightness",
            "label": "Brightness",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "pulse-width",
            "label": "Pulse width",
            "unit": "%",
            "physicalValues": [
              50
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "fold",
            "label": "Wavefold",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "unison-mix",
            "label": "Unison mix",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "shape",
            "label": "Shape",
            "unit": "%",
            "physicalValues": [
              0,
              33.333,
              66.667,
              100
            ],
            "normalizedValues": [
              0,
              0.33332999999999996,
              0.66667,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "coarse-phase-sampling-leaves-steps",
        "title": "Coarse phase sampling leaves steps",
        "presetId": "stepped-high-note",
        "listenFor": "Lower Table resolution deliberately quantizes phase and creates visible plateaus plus additional high-frequency components. Interpolation within the underlying 2048-point table does not remove these coarse phase steps.",
        "listen": "Lower Table resolution deliberately quantizes phase and creates visible plateaus plus additional high-frequency components. Interpolation within the underlying 2048-point table does not remove these coarse phase steps.",
        "gesture": "Hold 880 Hz with Interpolation 100%. Compare Table resolution 2048, 128, 32 and 16 samples while watching the waveform and spectrum.",
        "frequencyHz": 880,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "interpolation",
            "label": "Interpolation",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "table-resolution",
            "label": "Table resolution",
            "unit": "samples",
            "physicalValues": [
              2048,
              128,
              32,
              16
            ],
            "normalizedValues": [
              1,
              0.42857142857142855,
              0.14285714285714285,
              0
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "additive": {
    "depth": "Working eight-partial additive bank",
    "implementation": "Eight independent phase accumulators and amplitudes form a sinusoidal bank. Stretch, offset, detune, tilt, odd/even weighting, phase spread and slow amplitude motion alter the actual partials.",
    "limitations": [
      "There are eight directly editable amplitudes, not hundreds of arbitrary partial trajectories. Above-band partials are omitted.",
      "The summed amplitudes are normalized when their sum exceeds one, so adding a partial can lower existing partial levels."
    ],
    "touchstones": [
      {
        "id": "build-a-harmonic-tone-one-partial-at-a-time",
        "title": "Build a harmonic tone one partial at a time",
        "presetId": "single-sine",
        "listenFor": "Each raised amplitude adds a line at an integer multiple of 220 Hz. The waveform changes as those sinusoids sum.",
        "listen": "Each raised amplitude adds a line at an integer multiple of 220 Hz. The waveform changes as those sinusoids sum.",
        "gesture": "Hold 220 Hz; keep Partial 1 at 100%. Add Partial 2 at 50%, Partial 3 at 33.333% and Partial 4 at 25%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "partial-1",
            "label": "Partial 1",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "partial-2",
            "label": "Partial 2",
            "unit": "%",
            "physicalValues": [
              0,
              50
            ],
            "normalizedValues": [
              0,
              0.5
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "partial-3",
            "label": "Partial 3",
            "unit": "%",
            "physicalValues": [
              0,
              33.333
            ],
            "normalizedValues": [
              0,
              0.33332999999999996
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "partial-4",
            "label": "Partial 4",
            "unit": "%",
            "physicalValues": [
              0,
              25
            ],
            "normalizedValues": [
              0,
              0.25
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "missing-fundamental-versus-an-octave-shift",
        "title": "Missing fundamental versus an octave shift",
        "presetId": "missing-fundamental",
        "listenFor": "With harmonics 2 and 3 together, the ear may infer the absent 220 Hz fundamental. Keeping only even harmonics instead supports an octave-higher repetition.",
        "listen": "With harmonics 2 and 3 together, the ear may infer the absent 220 Hz fundamental. Keeping only even harmonics instead supports an octave-higher repetition.",
        "gesture": "Hold 220 Hz. Compare Partial 1 at 0% and 100%. Then return it to zero and mute Partials 3, 5 and 7 to leave the even series.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "partial-1",
            "label": "Partial 1",
            "unit": "%",
            "physicalValues": [
              0,
              100,
              0
            ],
            "normalizedValues": [
              0,
              1,
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "partial-3",
            "label": "Partial 3",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "partial-5",
            "label": "Partial 5",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "partial-7",
            "label": "Partial 7",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "phase-changes-shape-more-than-the-line-spectrum",
        "title": "Phase changes shape more than the line spectrum",
        "presetId": "eight-part-saw",
        "listenFor": "Relative phase reorganizes peaks in the oscilloscope while a stationary magnitude spectrum retains the same harmonic locations and approximately the same amplitudes.",
        "listen": "Relative phase reorganizes peaks in the oscilloscope while a stationary magnitude spectrum retains the same harmonic locations and approximately the same amplitudes.",
        "gesture": "Hold 220 Hz with detune and partial motion zero. Sweep Phase spread from 0 to 1 cycle.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 11,
            "controlId": "detune",
            "label": "Partial detune",
            "unit": "cents",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 14,
            "controlId": "partial-motion",
            "label": "Partial motion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 12,
            "controlId": "phase-spread",
            "label": "Phase spread",
            "unit": "cycles",
            "physicalValues": [
              0,
              1
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "walsh": {
    "depth": "Working two-basis Walsh construction",
    "implementation": "Gray-coded Walsh sign functions are evaluated on a 1024-position phase grid. The output interpolates two selected basis functions, with sequency/order motion and a smoothing pole.",
    "limitations": [
      "The Odd / even control crossfades two Walsh functions; it is not a full independently weighted Walsh expansion.",
      "Basis order/sequency are discrete choices. Smoothing is a simple low-pass operation, not an alias-free reconstruction filter."
    ],
    "touchstones": [
      {
        "id": "sequency-is-not-sinusoidal-harmonic-number",
        "title": "Sequency is not sinusoidal harmonic number",
        "presetId": "binary-reed",
        "listenFor": "Increasing Walsh order adds sign changes and reorganizes many Fourier harmonics at once.",
        "listen": "Increasing Walsh order adds sign changes and reorganizes many Fourier harmonics at once.",
        "gesture": "Hold 173 Hz, set Smoothing and Sequency motion to zero, then compare Basis order 1, 4, 8 and 16 with Sequency 1.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "smoothing",
            "label": "Smoothing",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "sequency-motion",
            "label": "Sequency motion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "sequency",
            "label": "Sequency",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "basis-order",
            "label": "Basis order",
            "unit": "",
            "physicalValues": [
              1,
              4,
              8,
              16
            ],
            "normalizedValues": [
              0,
              0.2,
              0.4666666666666667,
              1
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "smooth-the-binary-edges",
        "title": "Smooth the binary edges",
        "presetId": "checker-buzz",
        "listenFor": "Rectangular transitions round off and upper spectral energy decreases without changing the selected basis sequence.",
        "listen": "Rectangular transitions round off and upper spectral energy decreases without changing the selected basis sequence.",
        "gesture": "Hold the preset and sweep Smoothing from 0% to 95%, leaving the basis controls fixed.",
        "frequencyHz": 117,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "smoothing",
            "label": "Smoothing",
            "unit": "%",
            "physicalValues": [
              0,
              95
            ],
            "normalizedValues": [
              0,
              0.95
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "multiple-wavetable": {
    "depth": "Working four-corner vector mixer",
    "implementation": "Bilinear X/Y mixing combines four continuously selectable built-in waveforms. Two corners use detuned phase accumulators; drift and quadrature motion move the mix coordinates.",
    "limitations": [
      "Corners use the same four analytic/table shapes, not four independently loaded multisamples or evolving wavetable sequences.",
      "Vector motion is an internal sine orbit with clamping at the square boundary."
    ],
    "touchstones": [
      {
        "id": "read-the-four-vector-corners",
        "title": "Read the four vector corners",
        "presetId": "pure-corner",
        "listenFor": "The X/Y position changes source balance while nominal note pitch remains fixed.",
        "listen": "The X/Y position changes source balance while nominal note pitch remains fixed.",
        "gesture": "Hold 220 Hz with Drift, Vector orbit and Detune zero. Visit X/Y=(0, 0), (100, 0), (100, 100), (0, 100), then (50, 50).",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "drift",
            "label": "Drift",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "orbit-depth",
            "label": "Vector orbit",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "detune",
            "label": "Detune",
            "unit": "cents",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "vector-x",
            "label": "Vector X",
            "unit": "%",
            "physicalValues": [
              0,
              100,
              100,
              0,
              50
            ],
            "normalizedValues": [
              0,
              1,
              1,
              0,
              0.5
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "vector-y",
            "label": "Vector Y",
            "unit": "%",
            "physicalValues": [
              0,
              0,
              100,
              100,
              50
            ],
            "normalizedValues": [
              0,
              0,
              1,
              1,
              0.5
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "separate-timbral-motion-from-beating",
        "title": "Separate timbral motion from beating",
        "presetId": "slow-vector-cloud",
        "listenFor": "With zero detune, orbiting changes the spectrum. Added detune introduces beating on top of that motion.",
        "listen": "With zero detune, orbiting changes the spectrum. Added detune introduces beating on top of that motion.",
        "gesture": "Hold a note. Set Drift zero, Vector orbit 0.4 and Orbit rate 0.2 Hz; compare Detune 0 and 20 cents.",
        "frequencyHz": 107,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "drift",
            "label": "Drift",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "orbit-depth",
            "label": "Vector orbit",
            "unit": "",
            "physicalValues": [
              0.4
            ],
            "normalizedValues": [
              0.4
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "orbit-rate",
            "label": "Orbit rate",
            "unit": "Hz",
            "physicalValues": [
              0.2
            ],
            "normalizedValues": [
              0.018036072144288578
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "detune",
            "label": "Detune",
            "unit": "cents",
            "physicalValues": [
              0,
              20
            ],
            "normalizedValues": [
              0,
              0.5
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "wave-terrain": {
    "depth": "Working analytic wave-terrain model",
    "implementation": "Two phase-driven coordinates trace a rotated, offset elliptical/Lissajous path across a fixed nonlinear two-dimensional trigonometric surface.",
    "limitations": [
      "The terrain is one hard-coded analytic surface; height changes its spatial frequency/shape rather than loading a measured heightmap.",
      "Nonlinear coordinate-to-amplitude mapping can create high-frequency components; there is no general antialiasing of the terrain."
    ],
    "touchstones": [
      {
        "id": "trajectory-size-reads-more-surface-detail",
        "title": "Trajectory size reads more surface detail",
        "presetId": "small-round-orbit",
        "listenFor": "A wider path crosses more ripples, producing a denser spectrum without adding another oscillator bank.",
        "listen": "A wider path crosses more ripples, producing a denser spectrum without adding another oscillator bank.",
        "gesture": "Hold 173 Hz. Set Path ratio 1 and offsets zero; sweep X radius and Y radius together from 10% to 90%.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "path-ratio",
            "label": "Path ratio",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.2
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "x-offset",
            "label": "X offset",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "y-offset",
            "label": "Y offset",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "x-radius",
            "label": "X radius",
            "unit": "%",
            "physicalValues": [
              10,
              90
            ],
            "normalizedValues": [
              0.05263157894736842,
              0.8947368421052632
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "y-radius",
            "label": "Y radius",
            "unit": "%",
            "physicalValues": [
              10,
              90
            ],
            "normalizedValues": [
              0.05263157894736842,
              0.8947368421052632
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "rational-and-noninteger-paths",
        "title": "Rational and noninteger paths",
        "presetId": "uneven-orbit-bell",
        "listenFor": "Simple ratios retrace a short path; a noninteger ratio lengthens or complicates the waveform repetition.",
        "listen": "Simple ratios retrace a short path; a noninteger ratio lengthens or complicates the waveform repetition.",
        "gesture": "Hold 173 Hz with the radii fixed. Compare Path ratio 1, 1.5, 1.4142 and 2.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "path-ratio",
            "label": "Path ratio",
            "unit": "×",
            "physicalValues": [
              1,
              1.5,
              1.4142,
              2
            ],
            "normalizedValues": [
              0.2,
              0.3333333333333333,
              0.3104533333333333,
              0.4666666666666667
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "granular": {
    "depth": "Working sampled granular engine",
    "implementation": "A pool of 128 windowed grains reads the mono source, with independent grain length, launch density, source scan, position spray, pitch scatter and probabilistic reversal.",
    "limitations": [
      "Launches are regularly timed; random position/pitch does not make the scheduler itself asynchronous.",
      "There is no per-grain stereo position, arbitrary grain-envelope editor or independent voice-pool scheduling API. Pool size and source length are bounded."
    ],
    "touchstones": [
      {
        "id": "from-isolated-grains-to-a-cloud",
        "title": "From isolated grains to a cloud",
        "presetId": "sparse-grains",
        "listenFor": "At low density each windowed fragment is exposed; overlap fuses events into texture.",
        "listen": "At low density each windowed fragment is exposed; overlap fuses events into texture.",
        "gesture": "Hold 220 Hz. Set Grain size 80 ms, Scan speed zero and both spreads zero. Increase Density from 2 to 20 to 100 grains/s.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "grain-size",
            "label": "Grain size",
            "unit": "ms",
            "physicalValues": [
              80
            ],
            "normalizedValues": [
              0.15831663326653306
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "scan-speed",
            "label": "Scan speed",
            "unit": "×",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "position-spray",
            "label": "Position spray",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "pitch-spread",
            "label": "Pitch spread",
            "unit": "st",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "density",
            "label": "Density",
            "unit": "/s",
            "physicalValues": [
              2,
              20,
              100
            ],
            "normalizedValues": [
              0.005025125628140704,
              0.09547738693467336,
              0.49748743718592964
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "freeze-position-without-freezing-pitch",
        "title": "Freeze position without freezing pitch",
        "presetId": "frozen-cloud",
        "listenFor": "Zero scan speed reuses a fixed neighborhood while grains continue playing; pitch scatter spreads their spectral locations.",
        "listen": "Zero scan speed reuses a fixed neighborhood while grains continue playing; pitch scatter spreads their spectral locations.",
        "gesture": "Hold 220 Hz, set Scan speed zero, then move Source position from 0.2 to 0.8. At a fixed position compare Pitch spread 0 and 12 semitones.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "scan-speed",
            "label": "Scan speed",
            "unit": "×",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "source-position",
            "label": "Source position",
            "unit": "",
            "physicalValues": [
              0.2,
              0.8
            ],
            "normalizedValues": [
              0.2,
              0.8
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "pitch-spread",
            "label": "Pitch spread",
            "unit": "st",
            "physicalValues": [
              0,
              12
            ],
            "normalizedValues": [
              0,
              0.5
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "time-localization-broadens-the-spectrum",
        "title": "Time localization broadens the spectrum",
        "presetId": "fine-sand",
        "listenFor": "Shortening grains from tens of milliseconds toward one millisecond reduces recognizable source structure and broadens the spectrum.",
        "listen": "Shortening grains from tens of milliseconds toward one millisecond reduces recognizable source structure and broadens the spectrum.",
        "gesture": "Hold 220 Hz at Density 120/s and Pitch spread zero. Compare Grain size 100, 20 and 2 ms.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "density",
            "label": "Density",
            "unit": "/s",
            "physicalValues": [
              120
            ],
            "normalizedValues": [
              0.5979899497487438
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "pitch-spread",
            "label": "Pitch spread",
            "unit": "st",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "grain-size",
            "label": "Grain size",
            "unit": "ms",
            "physicalValues": [
              100,
              20,
              2
            ],
            "normalizedValues": [
              0.19839679358717435,
              0.03807615230460922,
              0.002004008016032064
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "subtractive": {
    "depth": "Working source/filter subtractive voice",
    "implementation": "Sine/saw/pulse and noise feed a state-variable filter with low-pass, band-pass, high-pass and notch outputs, resonance, input drive and an envelope-to-cutoff mapping.",
    "limitations": [
      "This is one filter topology; it does not emulate every ladder, diode or zero-delay-feedback circuit.",
      "Filter response and source antialiasing have numerical limits near Nyquist. No general external-audio input is connected to this voice."
    ],
    "touchstones": [
      {
        "id": "cutoff-removes-harmonics-resonance-emphasizes-its-edge",
        "title": "Cutoff removes harmonics; resonance emphasizes its edge",
        "presetId": "open-saw-lead",
        "listenFor": "The low-pass removes upper harmonics as cutoff falls; resonance adds a peak around the moving cutoff.",
        "listen": "The low-pass removes upper harmonics as cutoff falls; resonance adds a peak around the moving cutoff.",
        "gesture": "Hold 110 Hz. Select Lowpass, set Cutoff envelope zero and Resonance 10%; sweep Cutoff 10000→200 Hz. Repeat at Resonance 75%.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "filter-mode",
            "label": "Filter mode",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ],
            "optionLabels": [
              "Lowpass"
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "envelope-depth",
            "label": "Cutoff envelope",
            "unit": "octaves",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "resonance",
            "label": "Resonance",
            "unit": "%",
            "physicalValues": [
              10,
              75
            ],
            "normalizedValues": [
              0.1,
              0.75
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "cutoff",
            "label": "Cutoff",
            "unit": "Hz",
            "physicalValues": [
              10000,
              200
            ],
            "normalizedValues": [
              0.8996566681120063,
              0.33333333333333337
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "four-filter-responses-on-the-same-broadband-source",
        "title": "Four filter responses on the same broadband source",
        "presetId": "breathing-noise",
        "listenFor": "Low-pass keeps the bottom, high-pass keeps the top, band-pass isolates a region and notch removes a region.",
        "listen": "Low-pass keeps the bottom, high-pass keeps the top, band-pass isolates a region and notch removes a region.",
        "gesture": "Hold a note with Noise 100%, Cutoff 1500 Hz and Cutoff envelope zero. Compare all four Filter mode choices.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "noise",
            "label": "Noise",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "cutoff",
            "label": "Cutoff",
            "unit": "Hz",
            "physicalValues": [
              1500
            ],
            "normalizedValues": [
              0.6250204211305667
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "envelope-depth",
            "label": "Cutoff envelope",
            "unit": "octaves",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "filter-mode",
            "label": "Filter mode",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2,
              3
            ],
            "normalizedValues": [
              0,
              0.3333333333333333,
              0.6666666666666666,
              1
            ],
            "optionLabels": [
              "Lowpass",
              "Bandpass",
              "Highpass",
              "Notch"
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "spectral-attack-independent-of-loudness-attack",
        "title": "Spectral attack independent of loudness attack",
        "presetId": "muted-saw-bass",
        "listenFor": "A positive cutoff envelope opens the filter during the note attack, then the common envelope closes it toward the base cutoff.",
        "listen": "A positive cutoff envelope opens the filter during the note attack, then the common envelope closes it toward the base cutoff.",
        "gesture": "Retrigger the same 110 Hz note. Keep base Cutoff at 250 Hz and compare Cutoff envelope 0, 3 and 6 octaves.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "cutoff",
            "label": "Cutoff",
            "unit": "Hz",
            "physicalValues": [
              250
            ],
            "normalizedValues": [
              0.3656366710026855
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "envelope-depth",
            "label": "Cutoff envelope",
            "unit": "octaves",
            "physicalValues": [
              0,
              3,
              6
            ],
            "normalizedValues": [
              0.5,
              0.6875,
              0.875
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "lpc": {
    "depth": "Real single-frame LPC analysis and synthesis",
    "implementation": "Autocorrelation and Levinson–Durbin estimate 2–24 all-pole coefficients from a selected, Hann-windowed source frame. Pre-emphasis, analysis stride and pole-radius contraction alter the model; pulse/saw/noise excite its recursive filter.",
    "limitations": [
      "Model / vowel selects source position, not a named phoneme. The default source is synthetic.",
      "Only one frame is modeled at a time; there is no time-varying speech analysis, residual-excitation extraction, formant tracking, articulatory model or LPC codec."
    ],
    "touchstones": [
      {
        "id": "one-spectral-envelope-voiced-or-whispered",
        "title": "One spectral envelope, voiced or whispered",
        "presetId": "dark-voiced-model",
        "listenFor": "The harmonic comb becomes noisy while the resonant spectral envelope remains recognizable.",
        "listen": "The harmonic comb becomes noisy while the resonant spectral envelope remains recognizable.",
        "gesture": "Hold 137 Hz, keep Model / vowel and Analysis spectral scale fixed, and sweep Breath from 0% to 100%.",
        "frequencyHz": 137,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "breath",
            "label": "Breath",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "model-order-controls-spectral-detail",
        "title": "Model order controls spectral detail",
        "presetId": "bright-voiced-model",
        "listenFor": "Few poles give a broad fit; more poles can resolve more resonant detail from the same analyzed frame.",
        "listen": "Few poles give a broad fit; more poles can resolve more resonant detail from the same analyzed frame.",
        "gesture": "Hold 137 Hz with Breath zero. Compare Model order 2, 8, 16 and 24 poles; then compare Pole radius 0.96 and 0.995.",
        "frequencyHz": 137,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "breath",
            "label": "Breath",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "model-order",
            "label": "Model order",
            "unit": "poles",
            "physicalValues": [
              2,
              8,
              16,
              24
            ],
            "normalizedValues": [
              0,
              0.2727272727272727,
              0.6363636363636364,
              1
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "pole-radius",
            "label": "Pole radius",
            "unit": "",
            "physicalValues": [
              0.96,
              0.995
            ],
            "normalizedValues": [
              0.3361344537815123,
              0.9243697478991588
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "analysis-stride-is-not-an-anatomical-vocal-tract",
        "title": "Analysis stride is not an anatomical vocal tract",
        "presetId": "long-tract",
        "listenFor": "Changing analysis spectral scale moves the source content sampled by the analysis and hence the fitted resonances; it is not a physical tube-length control.",
        "listen": "Changing analysis spectral scale moves the source content sampled by the analysis and hence the fitted resonances; it is not a physical tube-length control.",
        "gesture": "Hold pitch at 137 Hz and compare Analysis spectral scale 0.65, 1 and 1.7 while leaving the frame position fixed.",
        "frequencyHz": 137,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "analysis-spectral-scale",
            "label": "Analysis spectral scale",
            "unit": "×",
            "physicalValues": [
              0.65,
              1,
              1.7
            ],
            "normalizedValues": [
              0,
              0.33333333333333337,
              1
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "am": {
    "depth": "Working amplitude modulation voice",
    "implementation": "A carrier is multiplied by an offset sine-to-square modulator; ratio, absolute-Hz offset, depth, bias and carrier harmonics independently affect the product.",
    "limitations": [
      "At low Bias the multiplier can be bipolar, so this panel overlaps ring modulation rather than representing only positive tremolo.",
      "The carrier has no independent sample input; a rich or high-frequency modulator can introduce aliases."
    ],
    "touchstones": [
      {
        "id": "tremolo-becomes-audio-rate-sidebands",
        "title": "Tremolo becomes audio-rate sidebands",
        "presetId": "slow-tremolo-edge",
        "listenFor": "Slow modulation is heard as level pulsing; faster modulation creates separate sum/difference spectral lines.",
        "listen": "Slow modulation is heard as level pulsing; faster modulation creates separate sum/difference spectral lines.",
        "gesture": "Hold 110 Hz with sine carrier/modulator, Bias 100%, Depth 100% and Modulator offset 0 Hz. Compare Frequency ratio 0.0625, 0.25 and 1.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "carrier-shape",
            "label": "Carrier shape",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "modulator-shape",
            "label": "Modulator shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "bias",
            "label": "Bias",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "depth",
            "label": "Depth",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "mod-detune",
            "label": "Modulator offset",
            "unit": "Hz",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              0.0625,
              0.25,
              1
            ],
            "normalizedValues": [
              0,
              0.005870841487279843,
              0.029354207436399216
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "carrier-and-the-first-sideband-pair",
        "title": "Carrier and the first sideband pair",
        "presetId": "dry-carrier",
        "listenFor": "At ratio 0.5 the 220 Hz carrier acquires components at 110 and 330 Hz as depth increases; the bias preserves carrier energy.",
        "listen": "At ratio 0.5 the 220 Hz carrier acquires components at 110 and 330 Hz as depth increases; the bias preserves carrier energy.",
        "gesture": "Hold 220 Hz, set Frequency ratio 0.5, Bias 100% and sine shapes. Sweep Depth 0→100%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              0.5
            ],
            "normalizedValues": [
              0.0136986301369863
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "bias",
            "label": "Bias",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "carrier-shape",
            "label": "Carrier shape",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "modulator-shape",
            "label": "Modulator shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "depth",
            "label": "Depth",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "ring": {
    "depth": "Working bipolar product/ring modulation",
    "implementation": "An independently transposed sine-to-saw carrier is multiplied by a sine-to-square modulator. Offset restores carrier content; rectification and drive add further nonlinear shaping.",
    "limitations": [
      "Both signals are internally generated, so this is not yet a ring-modulation processor for microphone or files.",
      "Offset, rectification and drive change the simple product identity; use neutral values for the textbook sideband demo."
    ],
    "touchstones": [
      {
        "id": "two-inputs-sum-and-difference-without-a-carrier",
        "title": "Two inputs, sum and difference without a carrier",
        "presetId": "two-sine-sidebands",
        "listenFor": "With a 440 Hz carrier and a 110 Hz modulator the product has components at 330 and 550 Hz; the original 440 Hz line is absent.",
        "listen": "With a 440 Hz carrier and a 110 Hz modulator the product has components at 330 and 550 Hz; the original 440 Hz line is absent.",
        "gesture": "Hold 440 Hz. Set Frequency ratio 0.25, both shapes to sine, Offset zero, Carrier transpose zero, Rectification zero and Input drive 1.",
        "frequencyHz": 440,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              0.25
            ],
            "normalizedValues": [
              0.005870841487279843
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "carrier-shape",
            "label": "Carrier shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "modulator-shape",
            "label": "Modulator shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "offset",
            "label": "Offset",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "carrier-transpose",
            "label": "Carrier transpose",
            "unit": "semitones",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "rectification",
            "label": "Rectification",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "input-drive",
            "label": "Input drive",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "dc-offset-restores-the-carrier",
        "title": "DC offset restores the carrier",
        "presetId": "carrier-restored",
        "listenFor": "A nonzero modulator offset brings the carrier line back alongside the sidebands, connecting ring modulation with biased AM.",
        "listen": "A nonzero modulator offset brings the carrier line back alongside the sidebands, connecting ring modulation with biased AM.",
        "gesture": "Hold 440 Hz with Frequency ratio 0.25 and sine shapes. Compare Offset 0%, 50% and 100%.",
        "frequencyHz": 440,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              0.25
            ],
            "normalizedValues": [
              0.005870841487279843
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "carrier-shape",
            "label": "Carrier shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "modulator-shape",
            "label": "Modulator shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "offset",
            "label": "Offset",
            "unit": "%",
            "physicalValues": [
              0,
              50,
              100
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "fm": {
    "depth": "Working direct-FM oscillator network",
    "implementation": "The carrier phase increment is modulated directly by a sine operator; negative increments are permitted. A second operator can act in parallel/serial, with delayed feedback and an exponentially falling index contribution.",
    "limitations": [
      "There are three oscillatory components with one fixed routing blend, not an arbitrary multi-operator algorithm editor or a full commercial FM architecture.",
      "High index, ratios and feedback can alias. Index envelope is a fixed exponential influence rather than an independent ADSR."
    ],
    "touchstones": [
      {
        "id": "index-distributes-energy-into-fm-sidebands",
        "title": "Index distributes energy into FM sidebands",
        "presetId": "pure-starting-tone",
        "listenFor": "Increasing index produces more sidebands at carrier plus/minus integer multiples of the modulator; carrier amplitude does not increase monotonically.",
        "listen": "Increasing index produces more sidebands at carrier plus/minus integer multiples of the modulator; carrier amplitude does not increase monotonically.",
        "gesture": "Hold 220 Hz with Frequency ratio 1, Feedback zero, Index envelope zero and Second operator depth zero. Compare Index 0, 1, 2.405 and 5.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.029354207436399216
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "feedback",
            "label": "Feedback",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "index-envelope",
            "label": "Index envelope",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "second-depth",
            "label": "Second operator depth",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "index",
            "label": "Index",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2.405,
              5
            ],
            "normalizedValues": [
              0,
              0.03125,
              0.07515625,
              0.15625
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "harmonic-versus-inharmonic-ratio",
        "title": "Harmonic versus inharmonic ratio",
        "presetId": "inharmonic-bell",
        "listenFor": "Integer ratios align sidebands with a harmonic grid; a noninteger ratio produces a more bell-like inharmonic set.",
        "listen": "Integer ratios align sidebands with a harmonic grid; a noninteger ratio produces a more bell-like inharmonic set.",
        "gesture": "Retrigger 220 Hz at Index 4 with Feedback and second-operator depth zero. Compare Frequency ratio 1, 2 and 1.4142.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "index",
            "label": "Index",
            "unit": "",
            "physicalValues": [
              4
            ],
            "normalizedValues": [
              0.125
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "feedback",
            "label": "Feedback",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "second-depth",
            "label": "Second operator depth",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              1,
              2,
              1.4142
            ],
            "normalizedValues": [
              0.029354207436399216,
              0.060665362035225046,
              0.042323287671232876
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "bright-attack-simpler-tail",
        "title": "Bright attack, simpler tail",
        "presetId": "electric-tine",
        "listenFor": "A large initial index can decay while pitch and the common amplitude envelope remain otherwise unchanged.",
        "listen": "A large initial index can decay while pitch and the common amplitude envelope remain otherwise unchanged.",
        "gesture": "Retrigger the preset. Set Index 6 and compare Index envelope 0% versus 100%.",
        "frequencyHz": 307,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "index",
            "label": "Index",
            "unit": "",
            "physicalValues": [
              6
            ],
            "normalizedValues": [
              0.1875
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "index-envelope",
            "label": "Index envelope",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "pm": {
    "depth": "Working phase-modulation oscillator network",
    "implementation": "The carrier phase argument receives modulator, second-operator and delayed-feedback terms. The first modulator continuously changes from sine to triangle.",
    "limitations": [
      "PM and FM are related modulation formulations; they are not unrelated families. Fixed sinusoidal cases can have equivalent steady spectra, while changing envelopes and non-sinusoidal modulators differ.",
      "This is a limited operator network without independent per-operator ADSRs or anti-alias guarantees."
    ],
    "touchstones": [
      {
        "id": "phase-depth-produces-the-sideband-family",
        "title": "Phase depth produces the sideband family",
        "presetId": "plain-phase-reference",
        "listenFor": "Increasing phase depth adds sideband pairs at the modulator spacing. At a fixed sinusoidal modulation, compare its spectral structure with the FM touchstone.",
        "listen": "Increasing phase depth adds sideband pairs at the modulator spacing. At a fixed sinusoidal modulation, compare its spectral structure with the FM touchstone.",
        "gesture": "Hold 220 Hz with Frequency ratio 1, Feedback zero, Modulator shape zero and Second operator depth zero. Compare Phase depth 0, 1, 2.405 and 5 radians.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.029354207436399216
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "feedback",
            "label": "Feedback",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "modulator-shape",
            "label": "Modulator shape",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "second-depth",
            "label": "Second operator depth",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "phase-depth",
            "label": "Phase depth",
            "unit": "rad",
            "physicalValues": [
              0,
              1,
              2.405,
              5
            ],
            "normalizedValues": [
              0,
              0.03125,
              0.07515625,
              0.15625
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "the-shape-of-phase-motion-matters",
        "title": "The shape of phase motion matters",
        "presetId": "bent-triangle",
        "listenFor": "Triangle modulation changes within-cycle phase velocity and the sideband distribution even at the same depth and ratio.",
        "listen": "Triangle modulation changes within-cycle phase velocity and the sideband distribution even at the same depth and ratio.",
        "gesture": "Hold 220 Hz at Frequency ratio 2 and Phase depth 3 radians, with Feedback and Second operator depth zero. Sweep Modulator shape from 0% to 100%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-ratio",
            "label": "Frequency ratio",
            "unit": "×",
            "physicalValues": [
              2
            ],
            "normalizedValues": [
              0.060665362035225046
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "phase-depth",
            "label": "Phase depth",
            "unit": "rad",
            "physicalValues": [
              3
            ],
            "normalizedValues": [
              0.09375
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "feedback",
            "label": "Feedback",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "second-depth",
            "label": "Second operator depth",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "modulator-shape",
            "label": "Modulator shape",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "phase-distortion": {
    "depth": "Working breakpoint phase-distortion model",
    "implementation": "A cosine reads a piecewise-linear phase map, optionally warped a second time; resonance multiplier, window and damping add a formant-like variant.",
    "limitations": [
      "The map is a compact phase-distortion construction, not an emulation of a particular instrument’s complete architecture.",
      "The resonance and window controls make this more than a pure two-segment phase warp; high settings are not generally band-limited."
    ],
    "touchstones": [
      {
        "id": "bend-phase-while-keeping-period",
        "title": "Bend phase while keeping period",
        "presetId": "unbent-reference",
        "listenFor": "Changing the breakpoint compresses part of the phase cycle and expands another, adding harmonics without changing the master period.",
        "listen": "Changing the breakpoint compresses part of the phase cycle and expands another, adding harmonics without changing the master period.",
        "gesture": "Hold 220 Hz with Resonance 1, Pulse character zero and Second distortion zero. Set Distortion amount 100%; compare Breakpoint 50%, 10% and 90%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "resonance",
            "label": "Resonance",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "pulse-character",
            "label": "Pulse character",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "second-warp",
            "label": "Second distortion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "distortion-amount",
            "label": "Distortion amount",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "breakpoint",
            "label": "Breakpoint",
            "unit": "%",
            "physicalValues": [
              50,
              10,
              90
            ],
            "normalizedValues": [
              0.5,
              0.08333333333333333,
              0.9166666666666666
            ]
          }
        ],
        "source": {
          "label": "Kleimola et al., Vector Phaseshaping Synthesis (2011)",
          "url": "https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "windowed-phase-resonance",
        "title": "Windowed phase resonance",
        "presetId": "resonant-synthetic-vowel",
        "listenFor": "More internal cosine cycles emphasize an upper region; the pulse window and damping change its bandwidth and edge.",
        "listen": "More internal cosine cycles emphasize an upper region; the pulse window and damping change its bandwidth and edge.",
        "gesture": "Hold 137 Hz. Compare Resonance 1, 3 and 6 with Pulse character 100%; then compare Resonance damping 0 and 0.6.",
        "frequencyHz": 137,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "pulse-character",
            "label": "Pulse character",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "resonance",
            "label": "Resonance",
            "unit": "×",
            "physicalValues": [
              1,
              3,
              6
            ],
            "normalizedValues": [
              0,
              0.2857142857142857,
              0.7142857142857143
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "resonance-damping",
            "label": "Resonance damping",
            "unit": "",
            "physicalValues": [
              0,
              0.6
            ],
            "normalizedValues": [
              0,
              0.6
            ]
          }
        ],
        "source": {
          "label": "Kleimola et al., Vector Phaseshaping Synthesis (2011)",
          "url": "https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "waveshaping": {
    "depth": "Working nonlinear transfer-function voice",
    "implementation": "A built-in source passes through sine/tanh transfer curves and reflected wavefolding with input bias, wet mix and optional output quantization.",
    "limitations": [
      "Transfer shape interpolates two supplied functions rather than accepting arbitrary transfer tables or Chebyshev coefficients.",
      "Direct waveshaping can alias; the ADAA panel demonstrates an alternative for two other supported transfer functions."
    ],
    "touchstones": [
      {
        "id": "symmetry-determines-odd-and-even-harmonics",
        "title": "Symmetry determines odd and even harmonics",
        "presetId": "hard-odd-harmonics",
        "listenFor": "Symmetric shaping of a sine emphasizes odd harmonics; shifting the input breaks symmetry and adds even components.",
        "listen": "Symmetric shaping of a sine emphasizes odd harmonics; shifting the input breaks symmetry and adds even components.",
        "gesture": "Hold 220 Hz with sine Source waveform, Fold zero and Transfer shape 100%. Set Drive 5; compare Asymmetry 0 and 0.4.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "source-shape",
            "label": "Source waveform",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "fold",
            "label": "Fold",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "transfer-shape",
            "label": "Transfer shape",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "drive",
            "label": "Drive",
            "unit": "×",
            "physicalValues": [
              5
            ],
            "normalizedValues": [
              0.36363636363636365
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "asymmetry",
            "label": "Asymmetry",
            "unit": "",
            "physicalValues": [
              0,
              0.4
            ],
            "normalizedValues": [
              0.5,
              0.7
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "folding-creates-new-turning-points",
        "title": "Folding creates new turning points",
        "presetId": "folded-sine-lead",
        "listenFor": "Wavefolding reflects large excursions back into the range, adding reversals and a different harmonic pattern from saturation.",
        "listen": "Wavefolding reflects large excursions back into the range, adding reversals and a different harmonic pattern from saturation.",
        "gesture": "Hold 220 Hz with sine Source waveform, Asymmetry zero and Fold 100%. Compare Drive 1, 3 and 7 while watching the waveform.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "source-shape",
            "label": "Source waveform",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "asymmetry",
            "label": "Asymmetry",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "fold",
            "label": "Fold",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "drive",
            "label": "Drive",
            "unit": "×",
            "physicalValues": [
              1,
              3,
              7
            ],
            "normalizedValues": [
              0,
              0.18181818181818182,
              0.5454545454545454
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "dsf": {
    "depth": "Working closed-form finite sinusoidal sum",
    "implementation": "A finite geometric series of complex sinusoids implements DSF in constant work per sample, with geometric rolloff, spacing, alternate-component mix, phase and a 1–8 count multiplier.",
    "limitations": [
      "Direct count 1–256 becomes at most 2048 with the multiplier; the actual count is reduced to omit above-band components.",
      "The amplitudes follow a geometric law, so this is not an arbitrary additive spectrum editor."
    ],
    "touchstones": [
      {
        "id": "geometric-rolloff-changes-brightness",
        "title": "Geometric rolloff changes brightness",
        "presetId": "falling-harmonic-comb",
        "listenFor": "A larger geometric radius retains more high components; count alone has little effect when the higher terms are already tiny.",
        "listen": "A larger geometric radius retains more high components; count alone has little effect when the higher terms are already tiny.",
        "gesture": "Hold 110 Hz at Partial spacing 1, Partial count 64 and multiplier 1. Compare Rolloff 20%, 70% and 95%.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "partial-spacing",
            "label": "Partial spacing",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.060665362035225046
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "partial-count",
            "label": "Partial count",
            "unit": "",
            "physicalValues": [
              64
            ],
            "normalizedValues": [
              0.24705882352941178
            ]
          },
          {
            "controlIndex": 8,
            "controlId": "count-multiplier",
            "label": "Partial count multiplier",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "rolloff",
            "label": "Rolloff",
            "unit": "%",
            "physicalValues": [
              20,
              70,
              95
            ],
            "normalizedValues": [
              0.20408163265306123,
              0.7142857142857143,
              0.9693877551020408
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "spacing-is-independent-of-carrier-offset",
        "title": "Spacing is independent of carrier offset",
        "presetId": "wide-metal-spacing",
        "listenFor": "Changing the spacing moves the gaps between neighboring components while carrier offset translates the series origin.",
        "listen": "Changing the spacing moves the gaps between neighboring components while carrier offset translates the series origin.",
        "gesture": "Hold 173 Hz at Partial count 12 and Rolloff 85%. Compare Partial spacing 1, 1.5 and 2.4142, then Carrier offset 0 and 0.5 partials.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "partial-count",
            "label": "Partial count",
            "unit": "",
            "physicalValues": [
              12
            ],
            "normalizedValues": [
              0.043137254901960784
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "rolloff",
            "label": "Rolloff",
            "unit": "%",
            "physicalValues": [
              85
            ],
            "normalizedValues": [
              0.8673469387755102
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "partial-spacing",
            "label": "Partial spacing",
            "unit": "×",
            "physicalValues": [
              1,
              1.5,
              2.4142
            ],
            "normalizedValues": [
              0.060665362035225046,
              0.09197651663405088,
              0.14922583170254403
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "carrier-offset",
            "label": "Carrier offset",
            "unit": "partials",
            "physicalValues": [
              0,
              0.5
            ],
            "normalizedValues": [
              0.5,
              0.625
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "physical": {
    "depth": "Working nonlinear mass–spring chain",
    "implementation": "An 8–32-mass one-dimensional chain advances by two symplectic substeps per sample. Coupling, bounded cubic nonlinearity, damping, mass gradient, end constraints and spatial strike/pickup affect the state.",
    "limitations": [
      "An abstract chain, not a measured bar/string or a complete physical-modeling library. Numerical stiffness and displacement are bounded.",
      "The pickup includes a mirrored secondary point rather than one calibrated displacement sensor."
    ],
    "touchstones": [
      {
        "id": "excitation-and-observation-select-modes",
        "title": "Excitation and observation select modes",
        "presetId": "balanced-elastic-bar",
        "listenFor": "Moving strike or pickup changes which spatial motions are strongly excited or heard while the chain remains unchanged.",
        "listen": "Moving strike or pickup changes which spatial motions are strongly excited or heard while the chain remains unchanged.",
        "gesture": "Retrigger 110 Hz with Mass gradient 0 and Pickup position 0.32. Compare Strike position 50%, 20%, 5%; then hold the strike fixed and move Pickup position 0.2→0.7.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "mass-gradient",
            "label": "Mass gradient",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "pickup",
            "label": "Pickup position",
            "unit": "",
            "physicalValues": [
              0.32
            ],
            "normalizedValues": [
              0.32
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "strike-position",
            "label": "Strike position",
            "unit": "%",
            "physicalValues": [
              50,
              20,
              5
            ],
            "normalizedValues": [
              0.5,
              0.2,
              0.05
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "pickup",
            "label": "Pickup position",
            "unit": "",
            "physicalValues": [
              0.2,
              0.7
            ],
            "normalizedValues": [
              0.2,
              0.7
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "loss-versus-nonlinear-stiffness",
        "title": "Loss versus nonlinear stiffness",
        "presetId": "rigid-bright-bar",
        "listenFor": "Damping shortens vibration. Spring nonlinearity changes the motion itself and can make its spectrum depend on excitation strength.",
        "listen": "Damping shortens vibration. Spring nonlinearity changes the motion itself and can make its spectrum depend on excitation strength.",
        "gesture": "Retrigger. First compare Damping 5%, 30%, 70% with Spring nonlinearity 0; restore low damping and compare Spring nonlinearity 0 and 1.5.",
        "frequencyHz": 347,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "spring-nonlinearity",
            "label": "Spring nonlinearity",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "damping",
            "label": "Damping",
            "unit": "%",
            "physicalValues": [
              5,
              30,
              70,
              5
            ],
            "normalizedValues": [
              0.05,
              0.3,
              0.7,
              0.05
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "spring-nonlinearity",
            "label": "Spring nonlinearity",
            "unit": "",
            "physicalValues": [
              0,
              1.5
            ],
            "normalizedValues": [
              0,
              0.75
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "modal": {
    "depth": "Working 16-mode struck resonator",
    "implementation": "Up to 16 damped complex oscillators carry independent modal state. Frequency dispersion, per-mode decay/tilt and position-dependent initial excitation determine the ringing mixture.",
    "limitations": [
      "Mode frequencies/decays follow supplied laws; arbitrary measured modal datasets cannot be loaded.",
      "Excitation is an initial state update, not continuous bowing or external acoustic input."
    ],
    "touchstones": [
      {
        "id": "harmonic-series-becomes-an-inharmonic-object",
        "title": "Harmonic series becomes an inharmonic object",
        "presetId": "harmonic-resonator",
        "listenFor": "Harmonic modes sound pitch-centered; increased inharmonicity spreads upper modes into a metallic pattern.",
        "listen": "Harmonic modes sound pitch-centered; increased inharmonicity spreads upper modes into a metallic pattern.",
        "gesture": "Retrigger 173 Hz with Mode count 8, Mode detune 0 and Modal decay 2 s. Compare Inharmonicity 0%, 30%, 80%.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "mode-count",
            "label": "Mode count",
            "unit": "",
            "physicalValues": [
              8
            ],
            "normalizedValues": [
              0.4666666666666667
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "mode-detune",
            "label": "Mode detune",
            "unit": "cents",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "modal-decay",
            "label": "Modal decay",
            "unit": "s",
            "physicalValues": [
              2
            ],
            "normalizedValues": [
              0.06635545181727243
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "inharmonicity",
            "label": "Inharmonicity",
            "unit": "%",
            "physicalValues": [
              0,
              30,
              80
            ],
            "normalizedValues": [
              0,
              0.3,
              0.8
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "a-nodal-strike-suppresses-modes",
        "title": "A nodal strike suppresses modes",
        "presetId": "center-muted-chime",
        "listenFor": "At the center, even-numbered modes receive little positional excitation; an off-center strike restores a different mixture.",
        "listen": "At the center, even-numbered modes receive little positional excitation; an off-center strike restores a different mixture.",
        "gesture": "Retrigger 173 Hz with Inharmonicity 0, Mode count 12 and Strike noise 0. Compare Strike position 50% and 20%.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "inharmonicity",
            "label": "Inharmonicity",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "mode-count",
            "label": "Mode count",
            "unit": "",
            "physicalValues": [
              12
            ],
            "normalizedValues": [
              0.7333333333333333
            ]
          },
          {
            "controlIndex": 9,
            "controlId": "strike-noise",
            "label": "Strike noise",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "strike-position",
            "label": "Strike position",
            "unit": "%",
            "physicalValues": [
              50,
              20
            ],
            "normalizedValues": [
              0.5,
              0.2
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "waveguide": {
    "depth": "Working nonlinear reed/delay-loop model",
    "implementation": "A fractional delay models a traveling-wave round trip. A nonlinear reed pressure/flow approximation supplies energy; reflection, loss, bore smoothing and breath pressure/noise complete the loop.",
    "limitations": [
      "One lumped reed/bore abstraction, not calibrated wind instruments. Bore character is a smoothing mix, not a measured bore profile.",
      "Pressure includes the common envelope and output is also enveloped. Oscillation thresholds are real interacting parameter effects."
    ],
    "touchstones": [
      {
        "id": "blowing-changes-a-nonlinear-feedback-system",
        "title": "Blowing changes a nonlinear feedback system",
        "presetId": "gentle-reed",
        "listenFor": "Pressure can change oscillation strength and harmonic balance; it is not merely output volume.",
        "listen": "Pressure can change oscillation strength and harmonic balance; it is not merely output volume.",
        "gesture": "Hold 173 Hz with factory reed/loss settings. Compare Pressure 35%, 50%, 70%, 90%; keep output level fixed.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "pressure",
            "label": "Pressure",
            "unit": "%",
            "physicalValues": [
              35,
              50,
              70,
              90
            ],
            "normalizedValues": [
              0.35,
              0.5,
              0.7,
              0.9
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "reed-and-loss-act-inside-the-loop",
        "title": "Reed and loss act inside the loop",
        "presetId": "clear-pipe-line",
        "listenFor": "Increasing loop loss softens resonance and may stop sustained oscillation; reed stiffness changes energy input.",
        "listen": "Increasing loop loss softens resonance and may stop sustained oscillation; reed stiffness changes energy input.",
        "gesture": "Hold 173 Hz at Pressure 70%. Compare Loss 5%, 30%, 60%; restore 15% Loss, then compare Reed stiffness 20% and 80%.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "pressure",
            "label": "Pressure",
            "unit": "%",
            "physicalValues": [
              70
            ],
            "normalizedValues": [
              0.7
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "loss",
            "label": "Loss",
            "unit": "%",
            "physicalValues": [
              5,
              30,
              60,
              15
            ],
            "normalizedValues": [
              0.05,
              0.3,
              0.6,
              0.15
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "reed-stiffness",
            "label": "Reed stiffness",
            "unit": "%",
            "physicalValues": [
              20,
              80
            ],
            "normalizedValues": [
              0.2,
              0.8
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "karplus-strong": {
    "depth": "Working extended Karplus–Strong loop",
    "implementation": "Noise/displacement fills a fractional delay loop. Low-pass loss, frequency-related decay, first-order allpass dispersion, feedback polarity and a pick-noise burst shape its response.",
    "limitations": [
      "One abstract string loop, without frets, bridge/body coupling or sympathetic strings.",
      "Feedback inversion passes through zero feedback at its midpoint; it is not a pure phase rotation."
    ],
    "touchstones": [
      {
        "id": "short-excitation-long-resonant-response",
        "title": "Short excitation, long resonant response",
        "presetId": "natural-string-pluck",
        "listenFor": "The loop recirculates initial excitation; loss changes spectral decay and apparent material.",
        "listen": "The loop recirculates initial excitation; loss changes spectral decay and apparent material.",
        "gesture": "Retrigger 173 Hz with Decay 3 s. Compare Damping 5%, 40%, 85%, keeping excitation fixed.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "decay",
            "label": "Decay",
            "unit": "s",
            "physicalValues": [
              3
            ],
            "normalizedValues": [
              0.09969989996665557
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "damping",
            "label": "Damping",
            "unit": "%",
            "physicalValues": [
              5,
              40,
              85
            ],
            "normalizedValues": [
              0.05,
              0.4,
              0.85
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "pluck-position-creates-spectral-notches",
        "title": "Pluck position creates spectral notches",
        "presetId": "hollow-center-pluck",
        "listenFor": "A center displacement pluck suppresses part of the harmonic series; an edgeward pluck excites a brighter mixture.",
        "listen": "A center displacement pluck suppresses part of the harmonic series; an edgeward pluck excites a brighter mixture.",
        "gesture": "Retrigger 173 Hz with Noise / displacement 0, Excitation length 1 and String dispersion 0. Compare Pick position 50%, 20%, 5%.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 7,
            "controlId": "excitation-mix",
            "label": "Noise / displacement",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "excitation-length",
            "label": "Excitation length",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "dispersion",
            "label": "String dispersion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "pick-position",
            "label": "Pick position",
            "unit": "%",
            "physicalValues": [
              50,
              20,
              5
            ],
            "normalizedValues": [
              0.5,
              0.1875,
              0.03125
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "dispersion-changes-resonance-spacing",
        "title": "Dispersion changes resonance spacing",
        "presetId": "long-wire",
        "listenFor": "An allpass inside the loop changes phase delay by frequency, shifting upper resonances away from ideal harmonic alignment.",
        "listen": "An allpass inside the loop changes phase delay by frequency, shifting upper resonances away from ideal harmonic alignment.",
        "gesture": "Retrigger with low damping and Feedback inversion 0. Compare String dispersion 0, 0.3, 0.7.",
        "frequencyHz": 397,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "inversion",
            "label": "Feedback inversion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "dispersion",
            "label": "String dispersion",
            "unit": "",
            "physicalValues": [
              0,
              0.3,
              0.7
            ],
            "normalizedValues": [
              0,
              0.37499999999999994,
              0.8749999999999999
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "fof": {
    "depth": "Working FOF-style formant-grain generator",
    "implementation": "Fundamental-period launches create overlapping exponentially decaying sine bursts with a finite attack. Formant, bandwidth, duration in decay constants and a second related formant shape the sum.",
    "limitations": [
      "Two related formants, not a complete multi-formant CHANT voice with independent trajectories and articulation rules.",
      "Active grains use current formant controls; onset is a linear ramp and finite support differs from particular historical CHANT implementations."
    ],
    "touchstones": [
      {
        "id": "separate-pitch-from-formant-center",
        "title": "Separate pitch from formant center",
        "presetId": "open-low-vowel",
        "listenFor": "Harmonic spacing follows note frequency; the strongest spectral region follows formant frequency.",
        "listen": "Harmonic spacing follows note frequency; the strongest spectral region follows formant frequency.",
        "gesture": "Hold 137 Hz with Bandwidth 100 Hz and Second formant 0. Compare Formant 500, 1000, 2000 Hz. Then hold Formant 1000 Hz and compare note pitches 110 and 220 Hz.",
        "frequencyHz": 137,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "bandwidth",
            "label": "Bandwidth",
            "unit": "Hz",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              0.12280701754385964
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "second-formant",
            "label": "Second formant",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              500,
              1000,
              2000,
              1000
            ],
            "normalizedValues": [
              0.03523489932885906,
              0.07718120805369127,
              0.1610738255033557,
              0.07718120805369127
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: fof",
          "url": "https://csound.com/docs/manual/fof.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      },
      {
        "id": "bandwidth-is-related-to-grain-decay",
        "title": "Bandwidth is related to grain decay",
        "presetId": "narrow-singing-band",
        "listenFor": "Narrow bandwidth produces longer ringing bursts and a tighter spectral region; broad bandwidth shortens bursts and spreads energy.",
        "listen": "Narrow bandwidth produces longer ringing bursts and a tighter spectral region; broad bandwidth shortens bursts and spreads energy.",
        "gesture": "Hold 137 Hz at Formant 1000 Hz and Grain decay span 6 time constants. Compare Bandwidth 40, 150, 500 Hz.",
        "frequencyHz": 137,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              1000
            ],
            "normalizedValues": [
              0.07718120805369127
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "grain-decay-span",
            "label": "Grain decay span",
            "unit": "τ",
            "physicalValues": [
              6
            ],
            "normalizedValues": [
              0.6
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "bandwidth",
            "label": "Bandwidth",
            "unit": "Hz",
            "physicalValues": [
              40,
              150,
              500
            ],
            "normalizedValues": [
              0.017543859649122806,
              0.21052631578947367,
              0.8245614035087719
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: fof",
          "url": "https://csound.com/docs/manual/fof.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      },
      {
        "id": "hear-individual-formant-grains",
        "title": "Hear individual formant grains",
        "presetId": "separated-vocal-pulses",
        "listenFor": "At low repetition rate, each damped sine burst becomes an event rather than a fused vowel-like tone.",
        "listen": "At low repetition rate, each damped sine burst becomes an event rather than a fused vowel-like tone.",
        "gesture": "Set Frequency 20 Hz and Formant 800 Hz. Compare Grain onset 0.1 and 8 ms, then raise Frequency to 100 Hz to hear fusion.",
        "frequencyHz": 20,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              800
            ],
            "normalizedValues": [
              0.06040268456375839
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "onset-time",
            "label": "Grain onset",
            "unit": "ms",
            "physicalValues": [
              0.1,
              8
            ],
            "normalizedValues": [
              0,
              0.797979797979798
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: fof",
          "url": "https://csound.com/docs/manual/fof.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      }
    ]
  },
  "vosim": {
    "depth": "Working VOSIM-style pulse packets",
    "implementation": "Each fundamental period contains a damped packet of squared-sine pulses followed by silence. Count, damping, curvature, chirp and alternating polarity modify the train.",
    "limitations": [
      "A compact VOSIM variant, not a copy of a complete historical voice synthesizer. Packets can be truncated by the available fundamental period.",
      "The implementation uses multiplicative per-pulse damping with optional polarity/curvature extensions."
    ],
    "touchstones": [
      {
        "id": "build-a-packet-of-squared-sine-pulses",
        "title": "Build a packet of squared-sine pulses",
        "presetId": "single-pulse-whistle",
        "listenFor": "More pulses lengthen the packet and concentrate its formant structure; the scope reveals the sub-pulses.",
        "listen": "More pulses lengthen the packet and concentrate its formant structure; the scope reveals the sub-pulses.",
        "gesture": "Hold 50 Hz at Formant 1000 Hz, Damping 20%, Silence 0 and Pulse curvature 1. Compare Pulses 1, 4, 12.",
        "frequencyHz": 50,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              1000
            ],
            "normalizedValues": [
              0.07718120805369127
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "damping",
            "label": "Damping",
            "unit": "%",
            "physicalValues": [
              20
            ],
            "normalizedValues": [
              0.2
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "silence",
            "label": "Silence",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "pulse-power",
            "label": "Pulse curvature",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.2105263157894737
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "pulses",
            "label": "Pulses",
            "unit": "",
            "physicalValues": [
              1,
              4,
              12
            ],
            "normalizedValues": [
              0,
              0.0967741935483871,
              0.3548387096774194
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: vosim",
          "url": "https://csound.com/docs/manual/vosim.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      },
      {
        "id": "silence-and-within-packet-loss-differ",
        "title": "Silence and within-packet loss differ",
        "presetId": "gapped-vocal-rhythm",
        "listenFor": "Silence changes available gap/truncation; Damping changes the heights of successive pulses.",
        "listen": "Silence changes available gap/truncation; Damping changes the heights of successive pulses.",
        "gesture": "Hold 50 Hz at Formant 1000 Hz and Pulses 8. Compare Silence 0% and 80%; restore 0% and compare Damping 10% and 80%.",
        "frequencyHz": 50,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              1000
            ],
            "normalizedValues": [
              0.07718120805369127
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "pulses",
            "label": "Pulses",
            "unit": "",
            "physicalValues": [
              8
            ],
            "normalizedValues": [
              0.22580645161290322
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "silence",
            "label": "Silence",
            "unit": "%",
            "physicalValues": [
              0,
              80,
              0
            ],
            "normalizedValues": [
              0,
              0.8,
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "damping",
            "label": "Damping",
            "unit": "%",
            "physicalValues": [
              10,
              80
            ],
            "normalizedValues": [
              0.1,
              0.8
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: vosim",
          "url": "https://csound.com/docs/manual/vosim.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      }
    ]
  },
  "window-formant": {
    "depth": "Working windowed-formant oscillator",
    "implementation": "A Gaussian/Hann/triangle window multiplies one or two sinusoids inside each fundamental cycle, with movable center, width, phase and drift.",
    "limitations": [
      "A finite periodic construction rather than arbitrary STFT or FOF analysis/resynthesis.",
      "Window width/center interact with the cycle boundary; large drift can truncate effective packet support."
    ],
    "touchstones": [
      {
        "id": "longer-time-window-narrower-spectrum",
        "title": "Longer time window, narrower spectrum",
        "presetId": "narrow-spectral-band",
        "listenFor": "A wide time window concentrates energy around the formant; a short one broadens it.",
        "listen": "A wide time window concentrates energy around the formant; a short one broadens it.",
        "gesture": "Hold 110 Hz at Formant 1200 Hz, Window skew 50%, Second formant 0 and Gaussian window. Compare Window width 90%, 35%, 8%.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              1200
            ],
            "normalizedValues": [
              0.09395973154362416
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "window-skew",
            "label": "Window skew",
            "unit": "%",
            "physicalValues": [
              50
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "second-formant",
            "label": "Second formant",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "window-shape",
            "label": "Window: Gaussian → Hann → triangle",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "window-width",
            "label": "Window width",
            "unit": "%",
            "physicalValues": [
              90,
              35,
              8
            ],
            "normalizedValues": [
              0.9,
              0.35,
              0.08
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "window-shape-controls-spectral-skirts",
        "title": "Window shape controls spectral skirts",
        "presetId": "rounded-vowel-window",
        "listenFor": "Gaussian, Hann and triangle windows produce different side-lobe/edge behavior at the same nominal width.",
        "listen": "Gaussian, Hann and triangle windows produce different side-lobe/edge behavior at the same nominal width.",
        "gesture": "Hold 110 Hz at Formant 1200 Hz, Window width 50% and Second formant 0. Compare Window selector 0, 1, 2.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "formant",
            "label": "Formant",
            "unit": "Hz",
            "physicalValues": [
              1200
            ],
            "normalizedValues": [
              0.09395973154362416
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "window-width",
            "label": "Window width",
            "unit": "%",
            "physicalValues": [
              50
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "second-formant",
            "label": "Second formant",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "window-shape",
            "label": "Window: Gaussian → Hann → triangle",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "waveform-segment": {
    "depth": "Working two-segment waveform construction",
    "implementation": "A quantized phase ramp traverses two power-curved segments with adjustable endpoints and join. Rectification further transforms the result.",
    "limitations": [
      "Two amplitude segments and 2–32 phase steps, not an arbitrary breakpoint/function language.",
      "Steps and joins are not band-limited. Curvature is an exponent, not a guaranteed monotonic softness control."
    ],
    "touchstones": [
      {
        "id": "move-the-join-while-holding-the-period",
        "title": "Move the join while holding the period",
        "presetId": "balanced-bent-ramp",
        "listenFor": "The waveform becomes asymmetric and redistributes harmonics while cycle length remains constant.",
        "listen": "The waveform becomes asymmetric and redistributes harmonics while cycle length remains constant.",
        "gesture": "Hold 220 Hz with Steps 32 and Rectification 0. Compare Breakpoint 50%, 15%, 85%, keeping endpoints fixed.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "steps",
            "label": "Steps",
            "unit": "",
            "physicalValues": [
              32
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "rectification",
            "label": "Rectification",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "breakpoint",
            "label": "Breakpoint",
            "unit": "%",
            "physicalValues": [
              50,
              15,
              85
            ],
            "normalizedValues": [
              0.5,
              0.1111111111111111,
              0.8888888888888888
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "quantize-phase-not-output-amplitude",
        "title": "Quantize phase, not output amplitude",
        "presetId": "stepped-staircase",
        "listenFor": "Fewer Steps create longer horizontal plateaus on the underlying curve.",
        "listen": "Fewer Steps create longer horizontal plateaus on the underlying curve.",
        "gesture": "Hold 220 Hz and compare Steps 32, 8, 4, 2 while watching the scope; keep level/curvature controls fixed.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "steps",
            "label": "Steps",
            "unit": "",
            "physicalValues": [
              32,
              8,
              4,
              2
            ],
            "normalizedValues": [
              1,
              0.2,
              0.06666666666666667,
              0
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "graphic": {
    "depth": "Working editable single-cycle waveform",
    "implementation": "Eight main amplitudes plus eight relative midpoint offsets define a periodic piecewise-linear waveform whose last segment wraps to its first point.",
    "limitations": [
      "A 16-knot single cycle, not arbitrary-resolution drawing, image-to-sound or graphical-score synthesis.",
      "Interpolation is linear and does not provide a complete band-limited playback system."
    ],
    "touchstones": [
      {
        "id": "connected-amplitudes-define-a-waveform",
        "title": "Connected amplitudes define a waveform",
        "presetId": "drawn-sine",
        "listenFor": "Changing one point creates a localized deviation and introduces further harmonics.",
        "listen": "Changing one point creates a localized deviation and introduces further harmonics.",
        "gesture": "Hold 220 Hz. Compare Point 3 at 1, 0, -1; restore 1 and compare Midpoint 3 offset 0 and 0.8.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "point-3",
            "label": "Point 3",
            "unit": "",
            "physicalValues": [
              1,
              0,
              -1,
              1
            ],
            "normalizedValues": [
              1,
              0.5,
              0,
              1
            ]
          },
          {
            "controlIndex": 10,
            "controlId": "midpoint-3",
            "label": "Midpoint 3 offset",
            "unit": "",
            "physicalValues": [
              0,
              0.8
            ],
            "normalizedValues": [
              0.5,
              0.9
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "break-the-symmetry-of-two-hills",
        "title": "Break the symmetry of two hills",
        "presetId": "double-hill",
        "listenFor": "Repeated half-cycle shapes emphasize the second harmonic; breaking their symmetry restores lower-period structure.",
        "listen": "Repeated half-cycle shapes emphasize the second harmonic; breaking their symmetry restores lower-period structure.",
        "gesture": "Hold 220 Hz. Set Point 3 to 1 and move Point 7 from 1 to 0, leaving the other points fixed.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "point-3",
            "label": "Point 3",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "point-7",
            "label": "Point 7",
            "unit": "",
            "physicalValues": [
              1,
              0
            ],
            "normalizedValues": [
              1,
              0.5
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "noise-modulation": {
    "depth": "Working stochastic AM/FM modulation",
    "implementation": "A held random process is smoothed for correlation and applied to amplitude or oscillator frequency. Rate, distribution, seed and envelope-dependent depth are explicit.",
    "limitations": [
      "AM → FM crossfades two modulation outputs rather than changing one connection continuously.",
      "Gaussian excitation approximates normal noise by summing uniform variables; arbitrary stochastic processes are absent."
    ],
    "touchstones": [
      {
        "id": "correlated-drift-versus-independent-jumps",
        "title": "Correlated drift versus independent jumps",
        "presetId": "random-pitch-drift",
        "listenFor": "Strong correlation creates smoother pitch wandering; less correlation produces sharper steps.",
        "listen": "Strong correlation creates smoother pitch wandering; less correlation produces sharper steps.",
        "gesture": "Hold 220 Hz with AM → FM 100%, Depth 3% and Noise rate 2 Hz. Compare Correlation 0%, 90%, 99%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "am-fm",
            "label": "AM → FM",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "depth",
            "label": "Depth",
            "unit": "%",
            "physicalValues": [
              3
            ],
            "normalizedValues": [
              0.03
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "noise-rate",
            "label": "Noise rate",
            "unit": "Hz",
            "physicalValues": [
              2
            ],
            "normalizedValues": [
              0.25
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "correlation",
            "label": "Correlation",
            "unit": "%",
            "physicalValues": [
              0,
              90,
              99
            ],
            "normalizedValues": [
              0,
              0.9,
              0.99
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "move-random-modulation-into-the-audio-band",
        "title": "Move random modulation into the audio band",
        "presetId": "rough-amplitude-hiss",
        "listenFor": "Slow random amplitude motion becomes spectral broadening/noise around the carrier as update rate rises.",
        "listen": "Slow random amplitude motion becomes spectral broadening/noise around the carrier as update rate rises.",
        "gesture": "Hold 220 Hz with AM → FM 0%, Depth 70% and Correlation 0. Compare Noise rate 2, 100, 1500 Hz.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "am-fm",
            "label": "AM → FM",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "depth",
            "label": "Depth",
            "unit": "%",
            "physicalValues": [
              70
            ],
            "normalizedValues": [
              0.7
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "correlation",
            "label": "Correlation",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "noise-rate",
            "label": "Noise rate",
            "unit": "Hz",
            "physicalValues": [
              2,
              100,
              1500
            ],
            "normalizedValues": [
              0.25,
              0.6747425010840046,
              0.9687653158479249
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "stochastic": {
    "depth": "Working dynamic-stochastic breakpoint model",
    "implementation": "A cyclic 3–32-point waveform undergoes bounded amplitude/duration walks. Uniform-to-heavy-tailed amplitude variation, interpolation and attraction to a sine contour shape its evolution.",
    "limitations": [
      "GENDY-inspired, not a reproduction of a particular Xenakis score or every GENDY variant.",
      "Amplitude reflects while duration clamps; the two probability laws are not independently selectable from a full distribution library."
    ],
    "touchstones": [
      {
        "id": "amplitude-walks-change-shape-duration-walks-change-timing",
        "title": "Amplitude walks change shape; duration walks change timing",
        "presetId": "stable-polygon-drone",
        "listenFor": "With duration fixed, amplitude variation reshapes the cycle; duration variation also disturbs timing and apparent pitch.",
        "listen": "With duration fixed, amplitude variation reshapes the cycle; duration variation also disturbs timing and apparent pitch.",
        "gesture": "Hold with Waveform elasticity 0. Set Duration step 0% and raise Amplitude step 0→30%; then set Amplitude step 10% and raise Duration step 0→40%.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 6,
            "controlId": "elasticity",
            "label": "Waveform elasticity",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "duration-step",
            "label": "Duration step",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "amplitude-step",
            "label": "Amplitude step",
            "unit": "%",
            "physicalValues": [
              0,
              30,
              10
            ],
            "normalizedValues": [
              0,
              0.3,
              0.1
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "duration-step",
            "label": "Duration step",
            "unit": "%",
            "physicalValues": [
              0,
              40
            ],
            "normalizedValues": [
              0,
              0.4
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: gendy",
          "url": "https://csound.com/docs/manual/gendy.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      },
      {
        "id": "few-moving-points-expose-the-mechanism",
        "title": "Few moving points expose the mechanism",
        "presetId": "three-point-lurch",
        "listenFor": "Three points reveal individual large changes; a larger population gives finer, denser motion.",
        "listen": "Three points reveal individual large changes; a larger population gives finer, denser motion.",
        "gesture": "Hold 110 Hz with Amplitude step 25% and Duration step 10%. Compare Breakpoints 3, 8, 24, then Interpolation 0 and 2.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "amplitude-step",
            "label": "Amplitude step",
            "unit": "%",
            "physicalValues": [
              25
            ],
            "normalizedValues": [
              0.25
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "duration-step",
            "label": "Duration step",
            "unit": "%",
            "physicalValues": [
              10
            ],
            "normalizedValues": [
              0.1
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "breakpoints",
            "label": "Breakpoints",
            "unit": "",
            "physicalValues": [
              3,
              8,
              24
            ],
            "normalizedValues": [
              0,
              0.1724137931034483,
              0.7241379310344828
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "interpolation",
            "label": "Interpolation: linear → cosine → cubic",
            "unit": "",
            "physicalValues": [
              0,
              2
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: gendy",
          "url": "https://csound.com/docs/manual/gendy.html",
          "type": "official implementation manual",
          "access": "retrieved"
        }
      }
    ]
  },
  "pulsar": {
    "depth": "Working pulsaret-plus-silence oscillator",
    "implementation": "Each period contains a windowed sinusoidal pulsaret and a silent remainder. Duty, internal cycles, random duty variation, masking, damping and skew shape the train.",
    "limitations": [
      "Pulsaret shape is a sinusoid with an internal-cycle multiplier, not an arbitrary sample/wavetable.",
      "Scatter changes duty and masking drops pulses; the underlying repetition clock stays regular."
    ],
    "touchstones": [
      {
        "id": "separate-repetition-clock-and-pulsaret-duration",
        "title": "Separate repetition clock and pulsaret duration",
        "presetId": "continuous-pulsaret",
        "listenFor": "Shortening the active part broadens/shifts formant structure while repetition rate stays fixed.",
        "listen": "Shortening the active part broadens/shifts formant structure while repetition rate stays fixed.",
        "gesture": "Hold 110 Hz with Scatter 0, Pulse masking 0, Window 100% and Pulsaret formant 1. Compare Duty 100%, 50%, 20%, 5%.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "scatter",
            "label": "Scatter",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "masking",
            "label": "Pulse masking",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "window",
            "label": "Window",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "pulsaret-formant",
            "label": "Pulsaret formant",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "duty",
            "label": "Duty",
            "unit": "%",
            "physicalValues": [
              100,
              50,
              20,
              5
            ],
            "normalizedValues": [
              1,
              0.4897959183673469,
              0.1836734693877551,
              0.030612244897959183
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "expose-and-omit-individual-pulsarets",
        "title": "Expose and omit individual pulsarets",
        "presetId": "sparse-low-knocks",
        "listenFor": "At 20 Hz individual events become perceptible; masking removes events without changing surviving shapes.",
        "listen": "At 20 Hz individual events become perceptible; masking removes events without changing surviving shapes.",
        "gesture": "Set Frequency 20 Hz, Duty 20%, Scatter 0 and Pulsaret formant 4. Compare Pulse masking 0 and 0.7.",
        "frequencyHz": 20,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "duty",
            "label": "Duty",
            "unit": "%",
            "physicalValues": [
              20
            ],
            "normalizedValues": [
              0.1836734693877551
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "scatter",
            "label": "Scatter",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "pulsaret-formant",
            "label": "Pulsaret formant",
            "unit": "×",
            "physicalValues": [
              4
            ],
            "normalizedValues": [
              0.2727272727272727
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "masking",
            "label": "Pulse masking",
            "unit": "",
            "physicalValues": [
              0,
              0.7
            ],
            "normalizedValues": [
              0,
              0.7
            ]
          }
        ],
        "source": {
          "label": "Curtis Roads, The Computer Music Tutorial (1996)",
          "url": "https://mitpress.mit.edu/9780262680820/the-computer-music-tutorial/",
          "type": "textbook; full text not retrieved in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "phase-vocoder": {
    "depth": "Real bounded offline phase-vocoder resynthesis",
    "implementation": "A 512-point Hann STFT stores 64 analysis frames with phase-derived instantaneous frequencies. A 128-sample-hop overlap-add resynthesizer moves/freezes frames, remaps bins, filters/gates bands and applies local phase locking/diffusion.",
    "limitations": [
      "Fixed-size offline analysis, with no live STFT input. A long uploaded file is represented by only 64 frames.",
      "Pitch remapping rounds to output bins and phase locking is local; this is not a transparent modern transient-preserving stretcher."
    ],
    "touchstones": [
      {
        "id": "time-stretch-without-tape-speed-pitch-shift",
        "title": "Time stretch without tape-speed pitch shift",
        "presetId": "analysis-reference",
        "listenFor": "Frame travel changes event duration while spectral pitch stays approximately fixed; transpose moves pitch separately.",
        "listen": "Frame travel changes event duration while spectral pitch stays approximately fixed; transpose moves pitch separately.",
        "gesture": "Hold 220 Hz with Transpose 0 and Phase diffusion 0. Compare Time stretch 0.5, 1, 4; restore 1 and compare Transpose-12, 0, 12 semitones.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "transpose",
            "label": "Transpose",
            "unit": "st",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "phase-diffusion",
            "label": "Phase diffusion",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "time-stretch",
            "label": "Time stretch",
            "unit": "×",
            "physicalValues": [
              0.5,
              1,
              4,
              1
            ],
            "normalizedValues": [
              0.25,
              0.5,
              1,
              0.5
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "transpose",
            "label": "Transpose",
            "unit": "st",
            "physicalValues": [
              -12,
              0,
              12
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "freeze-a-spectrum-while-phases-continue",
        "title": "Freeze a spectrum while phases continue",
        "presetId": "diffuse-frozen-texture",
        "listenFor": "Frozen analysis stops frame travel while synthesis oscillations continue. Phase diffusion weakens temporal coherence.",
        "listen": "Frozen analysis stops frame travel while synthesis oscillations continue. Phase diffusion weakens temporal coherence.",
        "gesture": "Hold 220 Hz. Set Freeze analysis to Frozen and Source offset 40%; compare Phase diffusion 0% and 80%, then move Source offset 20%→70% while frozen.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "freeze",
            "label": "Freeze analysis",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              1
            ],
            "optionLabels": [
              "Frozen"
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "position-offset",
            "label": "Source offset",
            "unit": "%",
            "physicalValues": [
              40
            ],
            "normalizedValues": [
              0.4
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "phase-diffusion",
            "label": "Phase diffusion",
            "unit": "%",
            "physicalValues": [
              0,
              80
            ],
            "normalizedValues": [
              0,
              0.8
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "position-offset",
            "label": "Source offset",
            "unit": "%",
            "physicalValues": [
              20,
              70
            ],
            "normalizedValues": [
              0.2,
              0.7
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "scanned": {
    "depth": "Working scanned mass–spring waveform",
    "implementation": "A slowly updated 64-mass ring evolves a waveform; an independent audio-rate trajectory reads it. Stiffness, damping, mass gradient, centering and localized bow-like drive change the evolution.",
    "limitations": [
      "Fixed ring topology and linear-to-cosine trajectory; arbitrary matrices, paths and initial shapes are absent.",
      "Model update stride is in samples, so its physical update rate changes with host sample rate unless the stride is adjusted."
    ],
    "touchstones": [
      {
        "id": "separate-shape-dynamics-from-readout-pitch",
        "title": "Separate shape dynamics from readout pitch",
        "presetId": "slow-elastic-scan",
        "listenFor": "Stiffness speeds spectral evolution while the audio readout period stays at the held note frequency.",
        "listen": "Stiffness speeds spectral evolution while the audio readout period stays at the held note frequency.",
        "gesture": "Hold 173 Hz with Damping 10% and Bow force 0. Compare Stiffness 10%, 40%, 80%, keeping Frequency and Scan shape fixed.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "damping",
            "label": "Damping",
            "unit": "%",
            "physicalValues": [
              10
            ],
            "normalizedValues": [
              0.1
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "bow-force",
            "label": "Bow force",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "stiffness",
            "label": "Stiffness",
            "unit": "%",
            "physicalValues": [
              10,
              40,
              80
            ],
            "normalizedValues": [
              0.1,
              0.4,
              0.8
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: scanu",
          "url": "https://csound.com/docs/manual/scanu.html",
          "type": "official implementation manual; not fetched in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "another-trajectory-reads-the-same-evolving-shape",
        "title": "Another trajectory reads the same evolving shape",
        "presetId": "sharp-scan-reed",
        "listenFor": "Nonuniform scan motion spends different time in different parts of the model, changing waveform and harmonics.",
        "listen": "Nonuniform scan motion spends different time in different parts of the model, changing waveform and harmonics.",
        "gesture": "Hold 173 Hz with physical controls fixed. Compare Scan shape 0% and 100%, then Scan offset 0 and 0.25 cycle.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "scan-shape",
            "label": "Scan shape",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "pickup-offset",
            "label": "Scan offset",
            "unit": "cycles",
            "physicalValues": [
              0,
              0.25
            ],
            "normalizedValues": [
              0,
              0.25
            ]
          }
        ],
        "source": {
          "label": "Csound reference implementation: scanu",
          "url": "https://csound.com/docs/manual/scanu.html",
          "type": "official implementation manual; not fetched in this audit",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "corpus": {
    "depth": "Working small descriptor-guided concatenator",
    "implementation": "Forty-eight equal source segments receive brightness and one-step-correlation noisiness descriptors. A distance cost with continuity/randomness chooses windowed fragments with overlap/reversal.",
    "limitations": [
      "Descriptors select material rather than directly filtering it. Descriptor sharpness 0 removes descriptor influence.",
      "One source split into 48 equal segments and two simple descriptors; no multi-file corpus, onset segmentation, target-audio analyzer or sequence optimizer."
    ],
    "touchstones": [
      {
        "id": "search-for-timbre-instead-of-specifying-partials",
        "title": "Search for timbre instead of specifying partials",
        "presetId": "dark-tonal-mosaic",
        "listenFor": "Target brightness selects different fragments; target noisiness prefers noisy material rather than adding output noise.",
        "listen": "Target brightness selects different fragments; target noisiness prefers noisy material rather than adding output noise.",
        "gesture": "Hold 220 Hz with Descriptor sharpness 4 and Continuity 20%. Compare Target brightness 0% and 100%, then Target noisiness 0% and 100%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "descriptor-sharpness",
            "label": "Descriptor sharpness",
            "unit": "",
            "physicalValues": [
              4
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "continuity",
            "label": "Continuity",
            "unit": "%",
            "physicalValues": [
              20
            ],
            "normalizedValues": [
              0.2
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "target-brightness",
            "label": "Target brightness",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "target-noisiness",
            "label": "Target noisiness",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Schwarz, Concatenative Sound Synthesis: The Early Years (2006)",
          "url": "https://doi.org/10.1162/comj.2006.30.3.5",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "continuity-and-overlap-change-different-parts-of-a-join",
        "title": "Continuity and overlap change different parts of a join",
        "presetId": "cut-up-syllables",
        "listenFor": "Continuity favors neighboring source regions; overlap blends fragments in time.",
        "listen": "Continuity favors neighboring source regions; overlap blends fragments in time.",
        "gesture": "Hold 220 Hz at Fragment length 100 ms. Compare Continuity 0% and 95%; restore 30% and compare Fragment overlap 0 and 0.8.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "fragment-length",
            "label": "Fragment length",
            "unit": "ms",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              0.34782608695652173
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "continuity",
            "label": "Continuity",
            "unit": "%",
            "physicalValues": [
              0,
              95,
              30
            ],
            "normalizedValues": [
              0,
              0.95,
              0.3
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "fragment-overlap",
            "label": "Fragment overlap",
            "unit": "",
            "physicalValues": [
              0,
              0.8
            ],
            "normalizedValues": [
              0,
              0.8421052631578948
            ]
          }
        ],
        "source": {
          "label": "Schwarz, Concatenative Sound Synthesis: The Early Years (2006)",
          "url": "https://doi.org/10.1162/comj.2006.30.3.5",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "padsynth": {
    "depth": "Working PADsynth spectrum-to-table generator",
    "implementation": "Up to 96 harmonic-centered magnitude bands receive random phase and an 8192-point inverse FFT. Bandwidth, profile, scaling, harmonic stretch/balance and seed affect the loop.",
    "limitations": [
      "One finite periodic table, not unbounded stochastic texture or a stereo multi-table instrument.",
      "The table is prepared around 220 Hz and transposed on playback; bandwidths transpose too. FFT resolution and above-band omission limit narrow/high partials."
    ],
    "touchstones": [
      {
        "id": "broaden-harmonics-into-ensemble-bands",
        "title": "Broaden harmonics into ensemble bands",
        "presetId": "narrow-harmonic-organ",
        "listenFor": "Narrow bands resemble stable harmonic lines; wider bands create beating and ensemble texture.",
        "listen": "Narrow bands resemble stable harmonic lines; wider bands create beating and ensemble texture.",
        "gesture": "Hold 173 Hz with Bandwidth multiplier 1 and Harmonic count 32. Compare Bandwidth 2, 20, 80 cents.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 8,
            "controlId": "bandwidth-scale",
            "label": "Bandwidth multiplier",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "harmonic-count",
            "label": "Harmonic count",
            "unit": "partials",
            "physicalValues": [
              32
            ],
            "normalizedValues": [
              0.3263157894736842
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "bandwidth",
            "label": "Bandwidth",
            "unit": "cents",
            "physicalValues": [
              2,
              20,
              80
            ],
            "normalizedValues": [
              0,
              0.20454545454545456,
              0.8863636363636364
            ]
          }
        ],
        "source": {
          "label": "Paul Nasca, PADsynth algorithm (2005)",
          "url": "https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "phase-seed-changes-temporal-structure",
        "title": "Phase seed changes temporal structure",
        "presetId": "wide-string-ensemble",
        "listenFor": "Random phase changes the waveform/fluctuation pattern while preserving the designed magnitude-band recipe.",
        "listen": "Random phase changes the waveform/fluctuation pattern while preserving the designed magnitude-band recipe.",
        "gesture": "Hold 173 Hz with spectral controls fixed. Compare Phase seed 0%, 25%, 50%, 75%; inspect scope and averaged spectrum.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 7,
            "controlId": "phase-seed",
            "label": "Phase seed",
            "unit": "%",
            "physicalValues": [
              0,
              25,
              50,
              75
            ],
            "normalizedValues": [
              0,
              0.25,
              0.5,
              0.75
            ]
          }
        ],
        "source": {
          "label": "Paul Nasca, PADsynth algorithm (2005)",
          "url": "https://zynaddsubfx.sourceforge.io/doc/PADsynth/PADsynth.htm",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "vector-phase": {
    "depth": "Working single-vector phase map",
    "implementation": "A two-segment phase map passes through a movable horizontal/vertical point; vertical can exceed one. Independent slow horizontal/vertical motion animates its cosine readout.",
    "limitations": [
      "One breakpoint vector; the source paper also describes multi-vector maps and further antialiasing.",
      "The central factory preset is a UI-center reference, not phase identity. At Horizontal 50%, identity requires Vertical 0.5."
    ],
    "touchstones": [
      {
        "id": "find-identity-then-add-phase-travel",
        "title": "Find identity, then add phase travel",
        "presetId": "neutral-phase-vector",
        "listenFor": "At horizontal 0.5/vertical 0.5 the straight map yields a sinusoid; vertical above 1 adds extra phase travel before returning to the endpoint.",
        "listen": "At horizontal 0.5/vertical 0.5 the straight map yields a sinusoid; vertical above 1 adds extra phase travel before returning to the endpoint.",
        "gesture": "Hold 220 Hz with Modulation depth 0 and Vertical motion 0. Set Horizontal breakpoint 50%; compare Vertical breakpoint 0.5, 1, 1.8.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "modulation-depth",
            "label": "Modulation depth",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "vertical-motion",
            "label": "Vertical motion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "horizontal-breakpoint",
            "label": "Horizontal breakpoint",
            "unit": "%",
            "physicalValues": [
              50
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "vertical-breakpoint",
            "label": "Vertical breakpoint",
            "unit": "",
            "physicalValues": [
              0.5,
              1,
              1.8
            ],
            "normalizedValues": [
              0.24489795918367346,
              0.5,
              0.9081632653061225
            ]
          }
        ],
        "source": {
          "label": "Kleimola et al., Vector Phaseshaping Synthesis (2011)",
          "url": "https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "move-the-two-vector-coordinates-independently",
        "title": "Move the two vector coordinates independently",
        "presetId": "slow-moving-phase-pad",
        "listenFor": "Horizontal movement changes segment durations; vertical movement changes phase excursion.",
        "listen": "Horizontal movement changes segment durations; vertical movement changes phase excursion.",
        "gesture": "Hold 220 Hz at Modulation rate 0.3 Hz and Vertical motion ratio 1. Compare Modulation depth 0% and 70%, then Vertical motion 0 and 0.6.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "modulation-rate",
            "label": "Modulation rate",
            "unit": "Hz",
            "physicalValues": [
              0.3
            ],
            "normalizedValues": [
              0.010050251256281407
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "motion-ratio",
            "label": "Vertical motion ratio",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.2
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "modulation-depth",
            "label": "Modulation depth",
            "unit": "%",
            "physicalValues": [
              0,
              70
            ],
            "normalizedValues": [
              0,
              0.7
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "vertical-motion",
            "label": "Vertical motion",
            "unit": "",
            "physicalValues": [
              0,
              0.6
            ],
            "normalizedValues": [
              0,
              0.6
            ]
          }
        ],
        "source": {
          "label": "Kleimola et al., Vector Phaseshaping Synthesis (2011)",
          "url": "https://www.dafx.de/paper-archive/2011/Papers/55_e.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "neural-ar": {
    "depth": "Genuine trained miniature autoregressive model",
    "implementation": "A 241-parameter 8→24→1 network predicts waveform samples from two previous predictions, phase conditions and three learned timbre conditions; temperature adds Gaussian sampling. Prediction clock 3–24 kHz is interpolated to host rate.",
    "limitations": [
      "A small periodic-sound teaching model trained on original synthetic data, not WaveNet or a speech/music generator.",
      "History stride/gain are experimental inference settings outside the original stride-one training task. Prediction bandwidth and training pitch coverage are limited."
    ],
    "touchstones": [
      {
        "id": "ask-the-learned-predictor-for-another-timbre",
        "title": "Ask the learned predictor for another timbre",
        "presetId": "clean-dark-prediction",
        "listenFor": "The same recurrent sample predictor generates a different harmonic shape when its condition changes.",
        "listen": "The same recurrent sample predictor generates a different harmonic shape when its condition changes.",
        "gesture": "Hold 220 Hz with Temperature 0%, History amount 100% and Prediction rate 12000 Hz. Sweep Timbre 0%→100% while retaining the other learned conditions.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "temperature",
            "label": "Temperature",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "history-amount",
            "label": "History amount",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              0.6666666666666666
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "prediction-rate",
            "label": "Prediction rate",
            "unit": "Hz",
            "physicalValues": [
              12000
            ],
            "normalizedValues": [
              0.6666666666666667
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "timbre",
            "label": "Timbre",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "van den Oord et al., WaveNet (2016): family reference",
          "url": "https://arxiv.org/abs/1609.03499",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "deterministic-prediction-versus-sampled-variation",
        "title": "Deterministic prediction versus sampled variation",
        "presetId": "warm-uncertain-pad",
        "listenFor": "Temperature perturbs each predicted sample; changing the seed affects variation only when temperature is active.",
        "listen": "Temperature perturbs each predicted sample; changing the seed affects variation only when temperature is active.",
        "gesture": "Hold 220 Hz. Compare Temperature 0%, 30%, 70%; at 70% retrigger with Sampling seed 0% and 50%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "temperature",
            "label": "Temperature",
            "unit": "%",
            "physicalValues": [
              0,
              30,
              70
            ],
            "normalizedValues": [
              0,
              0.3,
              0.7
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "sampling-seed",
            "label": "Sampling seed",
            "unit": "%",
            "physicalValues": [
              0,
              50
            ],
            "normalizedValues": [
              0,
              0.5
            ]
          }
        ],
        "source": {
          "label": "van den Oord et al., WaveNet (2016): family reference",
          "url": "https://arxiv.org/abs/1609.03499",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "neural-latent": {
    "depth": "Genuine trained miniature latent decoder",
    "implementation": "A learned four-dimensional latent vector decodes through 4→32→64 layers to a periodic waveform. A jointly trained encoder exists in source/tests; runtime provides band-limited table playback and latent-orbit control.",
    "limitations": [
      "This is a 64-sample periodic autoencoder, not RAVE or a continuous audio autoencoder. No live input is encoded by this panel.",
      "Coordinates span learned percentile ranges; arbitrary combinations/spread can leave well-supported training regions."
    ],
    "touchstones": [
      {
        "id": "one-learned-coordinate-is-a-timbral-direction",
        "title": "One learned coordinate is a timbral direction",
        "presetId": "latent-center",
        "listenFor": "Moving X changes the decoded waveform at fixed pitch; X is learned, not a manually labeled oscillator coefficient.",
        "listen": "Moving X changes the decoded waveform at fixed pitch; X is learned, not a manually labeled oscillator coefficient.",
        "gesture": "Hold 220 Hz with Y/Z/W 0, Latent spread 1 and Orbit depth 0. Compare Latent X-1, 0, 1.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "latent-y",
            "label": "Latent Y",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "latent-z",
            "label": "Latent Z",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "latent-w",
            "label": "Latent W",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "latent-spread",
            "label": "Latent spread",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "orbit-depth",
            "label": "Orbit depth",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "latent-x",
            "label": "Latent X",
            "unit": "",
            "physicalValues": [
              -1,
              0,
              1
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          }
        ],
        "source": {
          "label": "Caillon & Esling, RAVE (2021): family reference",
          "url": "https://arxiv.org/abs/2111.05011",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "travel-through-the-decoder-space",
        "title": "Travel through the decoder space",
        "presetId": "y-to-z-diagonal",
        "listenFor": "An orbit changes actual latent coordinates and decoded spectral shape, rather than applying vibrato to a fixed sound.",
        "listen": "An orbit changes actual latent coordinates and decoded spectral shape, rather than applying vibrato to a fixed sound.",
        "gesture": "Hold 220 Hz. Set Orbit planeYZ, Orbit rate 0.2 Hz and compare Orbit depth 0% and 50%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 7,
            "controlId": "orbit-plane",
            "label": "Orbit plane",
            "unit": "",
            "physicalValues": [
              3
            ],
            "normalizedValues": [
              0.6
            ],
            "optionLabels": [
              "YZ"
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "orbit-rate",
            "label": "Orbit rate",
            "unit": "Hz",
            "physicalValues": [
              0.2
            ],
            "normalizedValues": [
              0.4481535196957681
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "orbit-depth",
            "label": "Orbit depth",
            "unit": "%",
            "physicalValues": [
              0,
              50
            ],
            "normalizedValues": [
              0,
              0.5
            ]
          }
        ],
        "source": {
          "label": "Caillon & Esling, RAVE (2021): family reference",
          "url": "https://arxiv.org/abs/2111.05011",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "ddsp": {
    "depth": "Genuine trained miniature DDSP controller",
    "implementation": "A 345-parameter 4→24→9 network predicts eight harmonic amplitudes and one noise amplitude; differentiable waveform synthesis was inside its training loss. Runtime uses the learned controller plus a harmonic/noise bank.",
    "limitations": [
      "This is a small original DDSP teaching model, not the full Google DDSP package or recorded-instrument timbre transfer.",
      "Only eight harmonics and four learned conditions are modeled; stretch, color and attack extensions do not add newly trained conditioning dimensions."
    ],
    "touchstones": [
      {
        "id": "a-network-controls-the-harmonic-bank",
        "title": "A network controls the harmonic bank",
        "presetId": "dark-learned-harmonics",
        "listenFor": "Brightness changes amplitudes inferred by the learned controller; it does not simply turn one output low-pass filter.",
        "listen": "Brightness changes amplitudes inferred by the learned controller; it does not simply turn one output low-pass filter.",
        "gesture": "Hold 220 Hz at Partial count 8, Harmonic stretch 1 and Noise 0%. Compare Brightness 0%, 50%, 100%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "partial-count",
            "label": "Partial count",
            "unit": "partials",
            "physicalValues": [
              8
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "harmonic-stretch",
            "label": "Harmonic stretch",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "noise",
            "label": "Noise",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "brightness",
            "label": "Brightness",
            "unit": "%",
            "physicalValues": [
              0,
              50,
              100
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          }
        ],
        "source": {
          "label": "Engel et al., DDSP (2020): family reference",
          "url": "https://arxiv.org/abs/2001.04643",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "learned-harmonic-balance-and-noise-contribution",
        "title": "Learned harmonic balance and noise contribution",
        "presetId": "odd-learned-reed",
        "listenFor": "Odd/even conditioning changes predicted harmonic weighting; noise conditioning changes the model’s noise branch.",
        "listen": "Odd/even conditioning changes predicted harmonic weighting; noise conditioning changes the model’s noise branch.",
        "gesture": "Hold 220 Hz. Compare Odd / even 0% and 100%; return 50% and compare Noise 0% and 100%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "odd-even",
            "label": "Odd / even",
            "unit": "%",
            "physicalValues": [
              0,
              100,
              50
            ],
            "normalizedValues": [
              0,
              1,
              0.5
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "noise",
            "label": "Noise",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Engel et al., DDSP (2020): family reference",
          "url": "https://arxiv.org/abs/2001.04643",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "diffusion": {
    "depth": "Genuine trained miniature diffusion frame model",
    "implementation": "An 8512-parameter denoiser predicts clean 64-sample frames during 4–20 DDIM reverse steps. Conditions, seed, endpoint, stochasticity and regeneration affect generated periodic waveforms.",
    "limitations": [
      "Periodic 64-sample generation, not DiffWave speech or unrestricted long-form/text-to-audio synthesis.",
      "Every normal step-count setting reaches the clean endpoint; fewer steps do not mean a defined amount of leftover noise. Condition contrast uses a neutral-conditioned reference, not a trained unconditional branch."
    ],
    "touchstones": [
      {
        "id": "compare-reverse-step-approximations-at-one-seed",
        "title": "Compare reverse-step approximations at one seed",
        "presetId": "denoised-dark-frame",
        "listenFor": "Step count changes the reverse trajectory and resulting frame; differences need not be a monotonic noise-to-clean ladder.",
        "listen": "Step count changes the reverse trajectory and resulting frame; differences need not be a monotonic noise-to-clean ladder.",
        "gesture": "Hold 220 Hz with Residual noise 0%, Sampling stochasticity 0%, Regeneration rate 0 and fixed Variation. Compare Denoising steps 4, 8, 20.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "noise-endpoint",
            "label": "Residual noise",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "stochasticity",
            "label": "Sampling stochasticity",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "regeneration-rate",
            "label": "Regeneration rate",
            "unit": "Hz",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "denoising-steps",
            "label": "Denoising steps",
            "unit": "steps",
            "physicalValues": [
              4,
              8,
              20
            ],
            "normalizedValues": [
              0,
              0.25,
              1
            ]
          }
        ],
        "source": {
          "label": "Kong et al., DiffWave (2020): family reference",
          "url": "https://arxiv.org/abs/2009.09761",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "residual-endpoint-and-repeated-regeneration",
        "title": "Residual endpoint and repeated regeneration",
        "presetId": "alternate-noise-seed",
        "listenFor": "An earlier endpoint retains more noise-like frame structure; regeneration replaces the periodic frame with newly generated variants.",
        "listen": "An earlier endpoint retains more noise-like frame structure; regeneration replaces the periodic frame with newly generated variants.",
        "gesture": "Hold 220 Hz. Compare Residual noise 0% and 60%; return 0%, then compare Regeneration rate 0 and 1 Hz with Sampling stochasticity 50%.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "noise-endpoint",
            "label": "Residual noise",
            "unit": "%",
            "physicalValues": [
              0,
              60,
              0
            ],
            "normalizedValues": [
              0,
              0.75,
              0
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "stochasticity",
            "label": "Sampling stochasticity",
            "unit": "%",
            "physicalValues": [
              50
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "regeneration-rate",
            "label": "Regeneration rate",
            "unit": "Hz",
            "physicalValues": [
              0,
              1
            ],
            "normalizedValues": [
              0,
              0.25
            ]
          }
        ],
        "source": {
          "label": "Kong et al., DiffWave (2020): family reference",
          "url": "https://arxiv.org/abs/2009.09761",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "antialias-oscillator": {
    "depth": "Working comparison of four oscillator algorithms",
    "implementation": "Naive saw/pulse, polyBLEP, differentiated polynomial waveform and short minimum-phase BLEP correction are separate code paths. Quantization, dither, drive and 1×/2×/4× internal sampling are explicit.",
    "limitations": [
      "These reduce different aliases; none guarantees alias-free output under every pitch, pulse width or nonlinear drive.",
      "The oversampling path averages sub-samples rather than providing a full high-order decimation filter."
    ],
    "touchstones": [
      {
        "id": "matched-saw-alias-comparison",
        "title": "Matched saw alias comparison",
        "presetId": "high-na-ve-saw",
        "listenFor": "At the same non-harmonically convenient high note, correction reduces folded components unrelated to the intended harmonic ladder.",
        "listen": "At the same non-harmonically convenient high note, correction reduces folded components unrelated to the intended harmonic ladder.",
        "gesture": "Hold 1907 Hz with Saw → square 0%, Drive 1, Quantization 24 bits, Dither 0 and Oversampling 1×. Compare Algorithm Naive, PolyBLEP, DPW and MinBLEP.",
        "frequencyHz": 1907,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "saw-square",
            "label": "Saw → square",
            "unit": "%",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "drive",
            "label": "Drive",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "bit-depth",
            "label": "Quantization",
            "unit": "bits",
            "physicalValues": [
              24
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "dither",
            "label": "Dither",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "oversampling",
            "label": "Oversampling",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ],
            "optionLabels": [
              "1×"
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "algorithm",
            "label": "Algorithm",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2,
              3
            ],
            "normalizedValues": [
              0,
              0.3333333333333333,
              0.6666666666666666,
              1
            ],
            "optionLabels": [
              "Naïve",
              "PolyBLEP",
              "DPW",
              "MinBLEP"
            ]
          }
        ],
        "source": {
          "label": "Välimäki et al., Alias-Suppressed Oscillators Based on Differentiated Polynomial Waveforms (2010)",
          "url": "https://doi.org/10.1109/TASL.2009.2026507",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "narrow-pulses-challenge-discontinuity-correction",
        "title": "Narrow pulses challenge discontinuity correction",
        "presetId": "na-ve-narrow-pulse",
        "listenFor": "A narrow pulse has strong high-frequency content; corrected algorithms reduce edge aliases while preserving the intended pulse spectrum.",
        "listen": "A narrow pulse has strong high-frequency content; corrected algorithms reduce edge aliases while preserving the intended pulse spectrum.",
        "gesture": "Hold 1907 Hz with Saw → square 100%, Pulse width 10%, Drive 1 and Oversampling 1×. Compare Algorithm Naive, PolyBLEP and MinBLEP.",
        "frequencyHz": 1907,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "saw-square",
            "label": "Saw → square",
            "unit": "%",
            "physicalValues": [
              100
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "pulse-width",
            "label": "Pulse width",
            "unit": "%",
            "physicalValues": [
              10
            ],
            "normalizedValues": [
              0.05555555555555555
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "drive",
            "label": "Drive",
            "unit": "×",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "oversampling",
            "label": "Oversampling",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ],
            "optionLabels": [
              "1×"
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "algorithm",
            "label": "Algorithm",
            "unit": "",
            "physicalValues": [
              0,
              1,
              3
            ],
            "normalizedValues": [
              0,
              0.3333333333333333,
              1
            ],
            "optionLabels": [
              "Naïve",
              "PolyBLEP",
              "MinBLEP"
            ]
          }
        ],
        "source": {
          "label": "Välimäki et al., Alias-Suppressed Oscillators Based on Differentiated Polynomial Waveforms (2010)",
          "url": "https://doi.org/10.1109/TASL.2009.2026507",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "antiderivative-waveshaping": {
    "depth": "Working first-order antiderivative antialiasing",
    "implementation": "Exact antiderivatives of tanh and x/sqrt(1+x²) form a divided-difference ADAA output, with a near-zero-difference fallback. Direct/ADAA mix, bias, drive and pre-emphasis are implemented.",
    "limitations": [
      "Only two supported transfer functions and first-order ADAA are present; this is not a universal distortion antialiaser.",
      "ADAA also changes delay/frequency response, so audible differences are not exclusively alias removal."
    ],
    "touchstones": [
      {
        "id": "same-nonlinearity-direct-versus-adaa",
        "title": "Same nonlinearity, direct versus ADAA",
        "presetId": "high-direct-saturation",
        "listenFor": "At high pitch and drive, ADAA changes the folded spectrum while retaining the intended saturation family.",
        "listen": "At high pitch and drive, ADAA changes the folded spectrum while retaining the intended saturation family.",
        "gesture": "Hold 1487 Hz with Drive 9, Asymmetry 0, Sine / saw source 0, Shaping mix 1 and Input quantization 24 bits. Compare ADAA mix 0% and 100%.",
        "frequencyHz": 1487,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "drive",
            "label": "Drive",
            "unit": "×",
            "physicalValues": [
              9
            ],
            "normalizedValues": [
              0.7272727272727273
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "asymmetry",
            "label": "Asymmetry",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "source-shape",
            "label": "Sine / saw source",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "wet",
            "label": "Shaping mix",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "input-bit-depth",
            "label": "Input quantization",
            "unit": "bits",
            "physicalValues": [
              24
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "adaa-mix",
            "label": "ADAA mix",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Parker, Zavalishin & Le Bivic, Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution (2016)",
          "url": "https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "compare-asymmetric-clipping-at-matched-settings",
        "title": "Compare asymmetric clipping at matched settings",
        "presetId": "biased-direct-clipping",
        "listenFor": "Bias creates even harmonics; the ADAA comparison should keep that bias and the transfer curve unchanged.",
        "listen": "Bias creates even harmonics; the ADAA comparison should keep that bias and the transfer curve unchanged.",
        "gesture": "Hold 1487 Hz at Asymmetry 0.4 and Drive 7. Compare ADAA mix 0% and 100%, then compare Transfer shape 0% and 100% with ADAA enabled.",
        "frequencyHz": 1487,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "asymmetry",
            "label": "Asymmetry",
            "unit": "",
            "physicalValues": [
              0.4
            ],
            "normalizedValues": [
              0.7
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "drive",
            "label": "Drive",
            "unit": "×",
            "physicalValues": [
              7
            ],
            "normalizedValues": [
              0.5454545454545454
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "adaa-mix",
            "label": "ADAA mix",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "transfer-shape",
            "label": "Transfer shape",
            "unit": "%",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0,
              1
            ]
          }
        ],
        "source": {
          "label": "Parker, Zavalishin & Le Bivic, Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution (2016)",
          "url": "https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "hard-sync": {
    "depth": "Working fractional-event hard-sync oscillator",
    "implementation": "A master wrap resets a faster slave at the fractional crossing time. Sine/saw/pulse slave shapes, reset depth/phase, jitter, envelope-driven ratio and value-jump BLEP correction are real.",
    "limitations": [
      "Correction handles value discontinuities, not every derivative discontinuity. Master/slave increments are bounded.",
      "This is an oscillator model, not a full emulation of any named analog synthesizer."
    ],
    "touchstones": [
      {
        "id": "sweep-the-slave-while-the-master-anchors-repetition",
        "title": "Sweep the slave while the master anchors repetition",
        "presetId": "classic-synced-saw",
        "listenFor": "At full sync, the slave shape changes strongly while the master fixes the repeat period.",
        "listen": "At full sync, the slave shape changes strongly while the master fixes the repeat period.",
        "gesture": "Hold 173 Hz with Slave waveform Saw, Sync envelope 0, Sync depth 1 and Sync jitter 0. Sweep Slave ratio 1→2.3→5.7→10.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "slave-waveform",
            "label": "Slave waveform",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.5
            ],
            "optionLabels": [
              "Saw"
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "sync-envelope",
            "label": "Sync envelope",
            "unit": "semitones",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "sync-depth",
            "label": "Sync depth",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "sync-jitter",
            "label": "Sync jitter",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "slave-ratio",
            "label": "Slave ratio",
            "unit": "",
            "physicalValues": [
              1,
              2.3,
              5.7,
              10
            ],
            "normalizedValues": [
              0,
              0.04193548387096774,
              0.15161290322580645,
              0.2903225806451613
            ]
          }
        ],
        "source": {
          "label": "Eli Brandt, Hard Sync Without Aliasing (2001)",
          "url": "https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      },
      {
        "id": "correct-the-same-reset-event",
        "title": "Correct the same reset event",
        "presetId": "direct-reset-comparison",
        "listenFor": "Toggling correction changes folded high-frequency artifacts without changing the intended master/slave settings.",
        "listen": "Toggling correction changes folded high-frequency artifacts without changing the intended master/slave settings.",
        "gesture": "Hold the preset at its existing pitch and compare Antialias sync Off and On; keep ratio, waveform and reset phase fixed.",
        "frequencyHz": 1487,
        "parameterGestures": [
          {
            "controlIndex": 7,
            "controlId": "antialias",
            "label": "Antialias sync",
            "unit": "",
            "physicalValues": [
              0,
              1
            ],
            "normalizedValues": [
              0,
              1
            ],
            "optionLabels": [
              "Off",
              "On"
            ]
          }
        ],
        "source": {
          "label": "Eli Brandt, Hard Sync Without Aliasing (2001)",
          "url": "https://www.cs.cmu.edu/~eli/papers/icmc01-hardsync.pdf",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "retrieved"
        }
      }
    ]
  },
  "single-sideband": {
    "depth": "Working analytic-source single-sideband synthesis",
    "implementation": "Exact sine/cosine quadrature for a 1–32-harmonic source permits additive-Hz translation. Upper/lower and dry/wet blends mix analytic modulation products.",
    "limitations": [
      "No Hilbert/analytic transform is applied to imported audio: this is an internal source, not yet a general frequency-shifting effect.",
      "Modulator ratio/harmonics actually describe the source harmonic bank. Out-of-band translated components are omitted."
    ],
    "touchstones": [
      {
        "id": "frequency-translation-is-not-transposition",
        "title": "Frequency translation is not transposition",
        "presetId": "unshifted-harmonic-source",
        "listenFor": "Adding 100 Hz changes 220/440/660/880 Hz to 320/540/760/980 Hz; the spacing stays 220 Hz and harmonic ratios change.",
        "listen": "Adding 100 Hz changes 220/440/660/880 Hz to 320/540/760/980 Hz; the spacing stays 220 Hz and harmonic ratios change.",
        "gesture": "Hold 220 Hz with Modulator ratio 1, Modulator harmonics 4, Upper / lower 0, Sideband mix 1 and Shift motion 0. Compare Frequency shift 0 and 100 Hz.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "modulator-ratio",
            "label": "Modulator ratio",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.05660377358490566
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "harmonic-count",
            "label": "Modulator harmonics",
            "unit": "",
            "physicalValues": [
              4
            ],
            "normalizedValues": [
              0.0967741935483871
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "sideband",
            "label": "Upper / lower",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "wet",
            "label": "Sideband mix",
            "unit": "",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "shift-motion",
            "label": "Shift motion",
            "unit": "Hz",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "frequency-shift",
            "label": "Frequency shift",
            "unit": "Hz",
            "physicalValues": [
              0,
              100
            ],
            "normalizedValues": [
              0.5,
              0.5125
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      },
      {
        "id": "dry-plus-slightly-shifted-creates-beating",
        "title": "Dry plus slightly shifted creates beating",
        "presetId": "near-zero-beating",
        "listenFor": "A tiny additive shift produces a common beating offset across source partials, unlike proportional detuning.",
        "listen": "A tiny additive shift produces a common beating offset across source partials, unlike proportional detuning.",
        "gesture": "Hold 220 Hz with Frequency shift 2 Hz and Shift motion 0. Compare Sideband mix 1 and 0.5; then compare Frequency shift 2 and 10 Hz.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "frequency-shift",
            "label": "Frequency shift",
            "unit": "Hz",
            "physicalValues": [
              2
            ],
            "normalizedValues": [
              0.50025
            ]
          },
          {
            "controlIndex": 7,
            "controlId": "shift-motion",
            "label": "Shift motion",
            "unit": "Hz",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "wet",
            "label": "Sideband mix",
            "unit": "",
            "physicalValues": [
              1,
              0.5
            ],
            "normalizedValues": [
              1,
              0.5
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "frequency-shift",
            "label": "Frequency shift",
            "unit": "Hz",
            "physicalValues": [
              2,
              10
            ],
            "normalizedValues": [
              0.50025,
              0.50125
            ]
          }
        ],
        "source": {
          "label": "Miller Puckette, The Theory and Technique of Electronic Music",
          "url": "https://msp.ucsd.edu/techniques/latest/book.pdf",
          "type": "author-hosted textbook",
          "access": "retrieved"
        }
      }
    ]
  },
  "wavelet": {
    "depth": "Working finite multiscale wavelet construction",
    "implementation": "Periodic sums of scaled/translated Morlet-like, Ricker and Haar mother functions use configurable scale count, spacing, decay, translation, motion and optional chirp.",
    "limitations": [
      "Arbitrary scales are not an orthonormal wavelet transform or an invertible audio analysis/reconstruction system.",
      "Sub-sample packets are omitted. Haar has no chirp dependency; chirped Ricker is a modified mother function."
    ],
    "touchstones": [
      {
        "id": "add-finer-localized-scales",
        "title": "Add finer localized scales",
        "presetId": "one-scale-morlet-pulse",
        "listenFor": "More scales add localized high-frequency detail to a broader packet; coarse/fine structure is visible in the scope.",
        "listen": "More scales add localized high-frequency detail to a broader packet; coarse/fine structure is visible in the scope.",
        "gesture": "Hold 110 Hz with Wavelet family Morlet, Scale spacing 2, Wavelet width 0.25 and Scale motion 0. Compare Scale count 1, 3, 6.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "wavelet-family",
            "label": "Wavelet family",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ],
            "optionLabels": [
              "Morlet"
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "scale-spacing",
            "label": "Scale spacing",
            "unit": "",
            "physicalValues": [
              2
            ],
            "normalizedValues": [
              0.2727272727272727
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "wavelet-width",
            "label": "Wavelet width",
            "unit": "",
            "physicalValues": [
              0.25
            ],
            "normalizedValues": [
              0.4736842105263158
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "scale-motion",
            "label": "Scale motion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "scale-count",
            "label": "Scale count",
            "unit": "",
            "physicalValues": [
              1,
              3,
              6
            ],
            "normalizedValues": [
              0,
              0.2857142857142857,
              0.7142857142857143
            ]
          }
        ],
        "source": {
          "label": "Mallat, A theory for multiresolution signal decomposition: the wavelet representation (1989)",
          "url": "https://doi.org/10.1109/34.192463",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "mother-wavelet-determines-local-shape",
        "title": "Mother wavelet determines local shape",
        "presetId": "mexican-hat-layers",
        "listenFor": "Morlet oscillates within a smooth envelope, Ricker has a central lobe and side lobes, and Haar has abrupt opposite-sign steps.",
        "listen": "Morlet oscillates within a smooth envelope, Ricker has a central lobe and side lobes, and Haar has abrupt opposite-sign steps.",
        "gesture": "Hold 110 Hz with Wavelet chirp 0 and Scale count 3. Compare Wavelet family Morlet, Mexican hat/Ricker and Haar; keep width/spacing fixed.",
        "frequencyHz": 110,
        "parameterGestures": [
          {
            "controlIndex": 7,
            "controlId": "chirp",
            "label": "Wavelet chirp",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "scale-count",
            "label": "Scale count",
            "unit": "",
            "physicalValues": [
              3
            ],
            "normalizedValues": [
              0.2857142857142857
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "wavelet-family",
            "label": "Wavelet family",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ],
            "optionLabels": [
              "Morlet",
              "Mexican hat",
              "Haar"
            ]
          }
        ],
        "source": {
          "label": "Mallat, A theory for multiresolution signal decomposition: the wavelet representation (1989)",
          "url": "https://doi.org/10.1109/34.192463",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "colored-noise": {
    "depth": "Working finite-band colored-noise synthesis",
    "implementation": "Twelve logarithmic bands of independent filtered noise approximate power slope P(f)∝f^-alpha. Distribution, sample hold with variance compensation, band limits, resonance and flutter alter the result.",
    "limitations": [
      "A finite-band approximation, not an exact 1/f process over every frequency/time scale. Cutoffs and sample hold modify final slope.",
      "Gaussian excitation sums six uniforms; binary excitation is variance-normalized two-level noise, not a chip LFSR."
    ],
    "touchstones": [
      {
        "id": "white-pink-and-brown-describe-spectral-slope",
        "title": "White, pink and brown describe spectral slope",
        "presetId": "white-noise-reference",
        "listenFor": "White is roughly flat power density; pink favors lower octaves and brown more strongly emphasizes slow motion.",
        "listen": "White is roughly flat power density; pink favors lower octaves and brown more strongly emphasizes slow motion.",
        "gesture": "Hold with Sample hold 1, Low cut 20 Hz, High cut 20000 Hz and Resonance 0. Compare Spectral exponent 0, 1, 2, then-1 for blue.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "hold-length",
            "label": "Sample hold",
            "unit": "samples",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "low-cut",
            "label": "Low cut",
            "unit": "Hz",
            "physicalValues": [
              20
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "high-cut",
            "label": "High cut",
            "unit": "Hz",
            "physicalValues": [
              20000
            ],
            "normalizedValues": [
              1
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "resonance",
            "label": "Resonance",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "spectral-exponent",
            "label": "Spectral exponent",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2,
              -1
            ],
            "normalizedValues": [
              0.5,
              0.75,
              1,
              0.25
            ]
          }
        ],
        "source": {
          "label": "Voss & Clarke, 1/f noise in music (1978)",
          "url": "https://doi.org/10.1121/1.381721",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "distribution-and-hold-are-different-controls",
        "title": "Distribution and hold are different controls",
        "presetId": "held-binary-crackle",
        "listenFor": "Binary excitation changes amplitude statistics; holding samples creates longer steps and a changed high-frequency spectrum.",
        "listen": "Binary excitation changes amplitude statistics; holding samples creates longer steps and a changed high-frequency spectrum.",
        "gesture": "Hold with Spectral exponent 0 and Resonance 0. Compare Distribution Uniform and Binary at Sample hold 1; keep Binary and compare Sample hold 1, 8, 32.",
        "frequencyHz": 220,
        "parameterGestures": [
          {
            "controlIndex": 0,
            "controlId": "spectral-exponent",
            "label": "Spectral exponent",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 6,
            "controlId": "resonance",
            "label": "Resonance",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "hold-length",
            "label": "Sample hold",
            "unit": "samples",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "distribution",
            "label": "Distribution",
            "unit": "",
            "physicalValues": [
              0,
              2
            ],
            "normalizedValues": [
              0,
              1
            ],
            "optionLabels": [
              "Uniform",
              "Binary"
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "hold-length",
            "label": "Sample hold",
            "unit": "samples",
            "physicalValues": [
              1,
              8,
              32
            ],
            "normalizedValues": [
              0,
              0.1111111111111111,
              0.49206349206349204
            ]
          }
        ],
        "source": {
          "label": "Voss & Clarke, 1/f noise in music (1978)",
          "url": "https://doi.org/10.1121/1.381721",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "particle-shaker": {
    "depth": "Working physically informed stochastic shaker",
    "implementation": "A decaying energy reservoir controls random collision probability/energy; four damped complex resonators represent an abstract container. Particle count, contact spectrum, Q and continuous replenishment affect real state.",
    "limitations": [
      "A probabilistic collision/resonator model, not a geometric simulation of individual particles.",
      "Collision statistics depend on RNG state/sample rate. Factory trims use sampled rate/state headroom, not an absolute bound over every sequence."
    ],
    "touchstones": [
      {
        "id": "sparse-collisions-become-a-dense-shake",
        "title": "Sparse collisions become a dense shake",
        "presetId": "sparse-beads",
        "listenFor": "Particle count and collision rate alter event density and overlap; they are not simply noise volume.",
        "listen": "Particle count and collision rate alter event density and overlap; they are not simply noise volume.",
        "gesture": "Retrigger with Continuous shake 0 and Energy decay 1 s. Compare Particle count 4, 32, 128 at Collision rate 0.2, then compare Collision rate 0.05 and 0.8.",
        "frequencyHz": 2300,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "shake-force",
            "label": "Continuous shake",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "energy-decay",
            "label": "Energy decay",
            "unit": "s",
            "physicalValues": [
              1
            ],
            "normalizedValues": [
              0.6836408181204355
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "collision-rate",
            "label": "Collision rate",
            "unit": "",
            "physicalValues": [
              0.2
            ],
            "normalizedValues": [
              0.19191919191919193
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "particle-count",
            "label": "Particle count",
            "unit": "",
            "physicalValues": [
              4,
              32,
              128
            ],
            "normalizedValues": [
              0.14285714285714285,
              0.5714285714285714,
              0.8571428571428571
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "collision-rate",
            "label": "Collision rate",
            "unit": "",
            "physicalValues": [
              0.05,
              0.8
            ],
            "normalizedValues": [
              0.04040404040404041,
              0.797979797979798
            ]
          }
        ],
        "source": {
          "label": "Cook, Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds (1997)",
          "url": "https://doi.org/10.2307/3681012",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "replenish-energy-versus-strike-and-decay",
        "title": "Replenish energy versus strike and decay",
        "presetId": "continuous-shake-gesture",
        "listenFor": "Without replenishment collisions run down; continuous shaking sustains their energy while the gate remains held.",
        "listen": "Without replenishment collisions run down; continuous shaking sustains their energy while the gate remains held.",
        "gesture": "Hold a note with the common Sustain at 100%. Compare Continuous shake 0, 0.3, 0.8; then release the note and hear the reservoir decay.",
        "frequencyHz": 3100,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "shake-force",
            "label": "Continuous shake",
            "unit": "",
            "physicalValues": [
              0,
              0.3,
              0.8
            ],
            "normalizedValues": [
              0,
              0.3,
              0.8
            ]
          }
        ],
        "source": {
          "label": "Cook, Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds (1997)",
          "url": "https://doi.org/10.2307/3681012",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "fdtd-membrane": {
    "depth": "Working two-dimensional finite-difference membrane",
    "implementation": "A 6–16-node-per-side grid uses three time planes to solve a damped 2 D wave equation. Gaussian strike, bilinear pickup, aspect, boundary blend and tension affect the field.",
    "limitations": [
      "A small abstract membrane, not a calibrated drum or stiff plate. No bending-stiffness term or acoustic radiation model is implemented.",
      "A conservative CFL bound limits effective speed at extreme tension/pitch; grid resolution changes dispersion and the represented spatial modes."
    ],
    "touchstones": [
      {
        "id": "strike-and-pickup-select-two-dimensional-modes",
        "title": "Strike and pickup select two-dimensional modes",
        "presetId": "central-low-membrane",
        "listenFor": "Center and off-center strikes excite different spatial symmetries; pickup location changes which modes are observed.",
        "listen": "Center and off-center strikes excite different spatial symmetries; pickup location changes which modes are observed.",
        "gesture": "Retrigger 97 Hz with Strike X/Y 0.5 and factory pickup. Compare Strike X 0.5 and 0.2; then keep strike fixed and move Pickup X 0.3→0.7.",
        "frequencyHz": 97,
        "parameterGestures": [
          {
            "controlIndex": 2,
            "controlId": "strike-x",
            "label": "Strike X",
            "unit": "",
            "physicalValues": [
              0.5,
              0.2
            ],
            "normalizedValues": [
              0.5,
              0.2
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "strike-y",
            "label": "Strike Y",
            "unit": "",
            "physicalValues": [
              0.5
            ],
            "normalizedValues": [
              0.5
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "pickup-x",
            "label": "Pickup X",
            "unit": "",
            "physicalValues": [
              0.3,
              0.7
            ],
            "normalizedValues": [
              0.3,
              0.7
            ]
          }
        ],
        "source": {
          "label": "Bilbao, Numerical Sound Synthesis (2009)",
          "url": "https://doi.org/10.1002/9780470749012",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "strike-width-selects-spatial-detail",
        "title": "Strike width selects spatial detail",
        "presetId": "wide-soft-mallet",
        "listenFor": "A broad soft strike suppresses fine spatial detail; a harder narrow strike excites more high modes.",
        "listen": "A broad soft strike suppresses fine spatial detail; a harder narrow strike excites more high modes.",
        "gesture": "Retrigger 97 Hz at a fixed strike/pickup position. Compare Strike hardness 0.1, 0.5, 0.95; then compare Aspect ratio 1 and 1.7.",
        "frequencyHz": 97,
        "parameterGestures": [
          {
            "controlIndex": 8,
            "controlId": "strike-hardness",
            "label": "Strike hardness",
            "unit": "",
            "physicalValues": [
              0.1,
              0.5,
              0.95
            ],
            "normalizedValues": [
              0.1,
              0.5,
              0.95
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "aspect",
            "label": "Aspect ratio",
            "unit": "",
            "physicalValues": [
              1,
              1.7
            ],
            "normalizedValues": [
              0.3333333333333333,
              0.7999999999999999
            ]
          }
        ],
        "source": {
          "label": "Bilbao, Numerical Sound Synthesis (2009)",
          "url": "https://doi.org/10.1002/9780470749012",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "fdn-resonator": {
    "depth": "Working feedback-delay-network resonator",
    "implementation": "Two to eight fractional delays use Householder mixing blended with identity, lossy feedback, damping, allpass dispersion, saturation and polarity. A short pitched/noise burst excites the network.",
    "limitations": [
      "An internally struck resonator, not a general external-input reverberator. Storage bounds common network size while preserving path ratios.",
      "Intermediate Feedback inversion reduces gain; its midpoint removes feedback. It is not an allpass phase knob."
    ],
    "touchstones": [
      {
        "id": "separate-delay-tones-become-a-mixed-resonator",
        "title": "Separate delay tones become a mixed resonator",
        "presetId": "few-coupled-delay-tones",
        "listenFor": "With weak mixing, individual loop responses remain apparent; stronger diffusion distributes excitation among paths.",
        "listen": "With weak mixing, individual loop responses remain apparent; stronger diffusion distributes excitation among paths.",
        "gesture": "Retrigger 173 Hz with Delay lines 4, Decay 2 s and Feedback inversion 0. Compare Diffusion 0, 0.5, 1 while holding Network size fixed.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 4,
            "controlId": "line-count",
            "label": "Delay lines",
            "unit": "",
            "physicalValues": [
              4
            ],
            "normalizedValues": [
              0.3333333333333333
            ]
          },
          {
            "controlIndex": 1,
            "controlId": "decay",
            "label": "Decay",
            "unit": "s",
            "physicalValues": [
              2
            ],
            "normalizedValues": [
              0.6962360309717192
            ]
          },
          {
            "controlIndex": 9,
            "controlId": "inversion",
            "label": "Feedback inversion",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 3,
            "controlId": "diffusion",
            "label": "Diffusion",
            "unit": "",
            "physicalValues": [
              0,
              0.5,
              1
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          }
        ],
        "source": {
          "label": "Julius O. Smith, Feedback Delay Networks (FDN)",
          "url": "https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "size-decay-and-damping-are-independent-dimensions",
        "title": "Size, decay and damping are independent dimensions",
        "presetId": "long-metal-chamber",
        "listenFor": "Size changes path delays/resonance density; decay controls persistence and damping removes high frequencies from repeated circulation.",
        "listen": "Size changes path delays/resonance density; decay controls persistence and damping removes high frequencies from repeated circulation.",
        "gesture": "Retrigger 173 Hz at Decay 3 s. Compare Network size 0.01, 0.05, 0.15 s; then hold size 0.05 s and compare Damping 0.1 and 0.8.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 1,
            "controlId": "decay",
            "label": "Decay",
            "unit": "s",
            "physicalValues": [
              3
            ],
            "normalizedValues": [
              0.7727631772442599
            ]
          },
          {
            "controlIndex": 0,
            "controlId": "network-size",
            "label": "Network size",
            "unit": "s",
            "physicalValues": [
              0.01,
              0.05,
              0.15,
              0.05
            ],
            "normalizedValues": [
              0.3494850021680094,
              0.6989700043360187,
              0.9375306316958498,
              0.6989700043360187
            ]
          },
          {
            "controlIndex": 2,
            "controlId": "damping",
            "label": "Damping",
            "unit": "",
            "physicalValues": [
              0.1,
              0.8
            ],
            "normalizedValues": [
              0.1,
              0.8
            ]
          }
        ],
        "source": {
          "label": "Julius O. Smith, Feedback Delay Networks (FDN)",
          "url": "https://ccrma.stanford.edu/~jos/pasp/Feedback_Delay_Networks_FDN.html",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  },
  "rossler": {
    "depth": "Working numerical Rössler-system sonification",
    "implementation": "Fourth-order Runge–Kutta integrates the actual three-state Rössler ODE in double precision. Coordinate mix/rotation maps state to audio; adaptive substeps and escape resets bound numerics.",
    "limitations": [
      "Frequency controls nominal simulation speed, not an exactly tuned fundamental. Some settings are subsonic, periodic or escaping rather than chaotic.",
      "Escape handling restarts the initial condition; this is not a universal chaos generator or physical acoustic model."
    ],
    "touchstones": [
      {
        "id": "observe-the-same-system-from-another-coordinate",
        "title": "Observe the same system from another coordinate",
        "presetId": "classic-chaotic-orbit",
        "listenFor": "X, Y and Z have different waveform statistics; changing observation does not change the underlying equations.",
        "listen": "X, Y and Z have different waveform statistics; changing observation does not change the underlying equations.",
        "gesture": "Hold the preset with Projection rotation 0. Compare Output X, Y and Z by values 0, 1, 2; then compare Projection rotation 0 and 90 degrees.",
        "frequencyHz": 173,
        "parameterGestures": [
          {
            "controlIndex": 5,
            "controlId": "rotation",
            "label": "Projection rotation",
            "unit": "",
            "physicalValues": [
              0
            ],
            "normalizedValues": [
              0
            ]
          },
          {
            "controlIndex": 4,
            "controlId": "output-axis",
            "label": "Output: X → Y → Z",
            "unit": "",
            "physicalValues": [
              0,
              1,
              2
            ],
            "normalizedValues": [
              0,
              0.5,
              1
            ]
          },
          {
            "controlIndex": 5,
            "controlId": "rotation",
            "label": "Projection rotation",
            "unit": "",
            "physicalValues": [
              0,
              90
            ],
            "normalizedValues": [
              0,
              0.25
            ]
          }
        ],
        "source": {
          "label": "Rössler, An equation for continuous chaos (1976)",
          "url": "https://doi.org/10.1016/0375-9601(76)90101-8",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      },
      {
        "id": "integration-speed-differs-from-oscillator-pitch",
        "title": "Integration speed differs from oscillator pitch",
        "presetId": "slow-irregular-drone",
        "listenFor": "Time scale accelerates the nonlinear trajectory, moving irregular spectral features; the result is not a guaranteed equal-tempered note.",
        "listen": "Time scale accelerates the nonlinear trajectory, moving irregular spectral features; the result is not a guaranteed equal-tempered note.",
        "gesture": "Hold Frequency 132.5 Hz with equation parameters fixed. Compare Time scale 0.5, 1, 1.5; retrigger to compare the same initial condition.",
        "frequencyHz": 132.5,
        "parameterGestures": [
          {
            "controlIndex": 3,
            "controlId": "time-scale",
            "label": "Time scale",
            "unit": "",
            "physicalValues": [
              0.5,
              1,
              1.5
            ],
            "normalizedValues": [
              0.16666666666666666,
              0.4444444444444445,
              0.7222222222222222
            ]
          }
        ],
        "source": {
          "label": "Rössler, An equation for continuous chaos (1976)",
          "url": "https://doi.org/10.1016/0375-9601(76)90101-8",
          "type": "family research/author reference; implementation is the audited local model",
          "access": "Citation retained; full source was not retrieved in this audit"
        }
      }
    ]
  }
};

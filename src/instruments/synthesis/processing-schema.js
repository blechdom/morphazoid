// Physical schemas for the shared stereo Rust processor bank.
const spectralParams = [
  { label: 'Mode', min: 0, max: 3, default: 1, unit: '', scale: 'linear', choices: ['Resynthesis', 'Spectral gate', 'Freeze', 'Spectral tilt'] },
  { label: 'Threshold', min: -90, max: -12, default: -48, unit: 'dBFS', scale: 'linear', modes: [1] },
  { label: 'Reduction', min: 0, max: 96, default: 48, unit: 'dB', scale: 'linear', modes: [1] },
  { label: 'Response', min: .005, max: .5, default: .04, unit: 's', scale: 'log', modes: [1, 3] },
  { label: 'Tilt', min: -12, max: 12, default: 0, unit: 'dB/oct', scale: 'linear', modes: [3] }
].map((param, index) => ({ ...param, index, defaultNormalized: param.scale === 'log'
  ? Math.log(param.default / param.min) / Math.log(param.max / param.min)
  : (param.default - param.min) / (param.max - param.min) }));
const spectralSchema = {
  processorId: 16, id: 'spectral', name: 'FFT spectral processing', kind: 'processor',
  defaultSource: 7, defaultFrequency: 220, latencyFrames: 1024, fftSize: 1024, hopFrames: 256,
  params: spectralParams,
  defaultParams: Array.from({ length: 16 }, (_, index) => spectralParams[index]?.defaultNormalized ?? 0)
};

export const PROCESSING_SCHEMA = {
  "version": 1,
  "blockFrames": 128,
  "parameterCount": 16,
  "sources": [
    "External input",
    "Sine",
    "Two-tone",
    "Noise",
    "Impulse train",
    "Pulse / saw",
    "Drum pattern",
    "Voiced phrase",
    "Pink noise",
    "Brown noise",
    "Gaussian white noise"
  ],
  "methods": [
    {
      "processorId": 0,
      "id": "biquad",
      "name": "Biquad filter / EQ",
      "kind": "processor",
      "defaultSource": 3,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Response",
          "min": 0,
          "max": 7,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Low-pass",
            "High-pass",
            "Band-pass",
            "Notch",
            "All-pass",
            "Bell EQ",
            "Low shelf",
            "High shelf"
          ],
          "index": 0,
          "defaultNormalized": 0.0
        },
        {
          "label": "Frequency",
          "min": 20,
          "max": 20000,
          "default": 1200,
          "unit": "Hz",
          "scale": "log",
          "index": 1,
          "defaultNormalized": 0.5927170834612145
        },
        {
          "label": "Q",
          "min": 0.25,
          "max": 16,
          "default": 0.707,
          "unit": "",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.24996368669121863
        },
        {
          "label": "EQ gain",
          "min": -24,
          "max": 24,
          "default": 0,
          "unit": "dB",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.5
        }
      ],
      "defaultParams": [
        0.0,
        0.5927170834612145,
        0.24996368669121863,
        0.5,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 1,
      "id": "svf",
      "name": "State-variable filter",
      "kind": "processor",
      "defaultSource": 3,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Cutoff",
          "min": 20,
          "max": 20000,
          "default": 900,
          "unit": "Hz",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.5510708379251146
        },
        {
          "label": "Q",
          "min": 0.5,
          "max": 16,
          "default": 0.707,
          "unit": "",
          "scale": "log",
          "index": 1,
          "defaultNormalized": 0.09995642402946234
        },
        {
          "label": "Response",
          "min": 0,
          "max": 3,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Low-pass",
            "Band-pass",
            "High-pass",
            "Notch"
          ],
          "index": 2,
          "defaultNormalized": 0.0
        },
        {
          "label": "Drive",
          "min": 0,
          "max": 18,
          "default": 0,
          "unit": "dB",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.0
        }
      ],
      "defaultParams": [
        0.5510708379251146,
        0.09995642402946234,
        0.0,
        0.0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 2,
      "id": "ladder",
      "name": "Nonlinear ladder filter",
      "kind": "processor",
      "defaultSource": 5,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Cutoff",
          "min": 30,
          "max": 18000,
          "default": 800,
          "unit": "Hz",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.5132797330870178
        },
        {
          "label": "Resonance",
          "min": 0,
          "max": 1,
          "default": 0.3,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.3
        },
        {
          "label": "Drive",
          "min": 0,
          "max": 24,
          "default": 6,
          "unit": "dB",
          "scale": "linear",
          "index": 2,
          "defaultNormalized": 0.25
        },
        {
          "label": "Poles",
          "min": 2,
          "max": 4,
          "default": 4,
          "unit": "",
          "scale": "linear",
          "choices": [
            "2-pole",
            "4-pole"
          ],
          "index": 3,
          "defaultNormalized": 1.0
        }
      ],
      "defaultParams": [
        0.5132797330870178,
        0.3,
        0.25,
        1.0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 3,
      "id": "fir",
      "name": "Windowed-sinc FIR filter",
      "kind": "processor",
      "defaultSource": 3,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Response",
          "min": 0,
          "max": 2,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Low-pass",
            "High-pass",
            "Band-pass"
          ],
          "index": 0,
          "defaultNormalized": 0.0
        },
        {
          "label": "Frequency",
          "min": 40,
          "max": 16000,
          "default": 1800,
          "unit": "Hz",
          "scale": "log",
          "index": 1,
          "defaultNormalized": 0.6353475781823255
        },
        {
          "label": "Bandwidth",
          "min": 0.25,
          "max": 4,
          "default": 1,
          "unit": "oct",
          "scale": "linear",
          "index": 2,
          "defaultNormalized": 0.2
        },
        {
          "label": "Window",
          "min": 0,
          "max": 2,
          "default": 2,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Hann",
            "Hamming",
            "Blackman"
          ],
          "index": 3,
          "defaultNormalized": 1.0
        }
      ],
      "defaultParams": [
        0.0,
        0.6353475781823255,
        0.2,
        1.0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 4,
      "id": "comb",
      "name": "Feedback / feedforward comb",
      "kind": "processor",
      "defaultSource": 4,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Resonance frequency",
          "min": 20,
          "max": 2000,
          "default": 220,
          "unit": "Hz",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.5206963425791125
        },
        {
          "label": "Feedback",
          "min": -0.98,
          "max": 0.98,
          "default": 0.65,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.8316326530612245
        },
        {
          "label": "Damping",
          "min": 200,
          "max": 18000,
          "default": 6000,
          "unit": "Hz",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.7558536095622292
        },
        {
          "label": "Feedforward",
          "min": -1,
          "max": 1,
          "default": 0.5,
          "unit": "",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.75
        }
      ],
      "defaultParams": [
        0.5206963425791125,
        0.8316326530612245,
        0.7558536095622292,
        0.75,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 5,
      "id": "delay",
      "name": "Stereo feedback delay",
      "kind": "processor",
      "defaultSource": 6,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Delay",
          "min": 0.01,
          "max": 2,
          "default": 0.28,
          "unit": "s",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.6289174995846284
        },
        {
          "label": "Feedback",
          "min": 0,
          "max": 0.92,
          "default": 0.4,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.43478260869565216
        },
        {
          "label": "Damping",
          "min": 200,
          "max": 18000,
          "default": 7000,
          "unit": "Hz",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.7901107651134204
        },
        {
          "label": "Cross feedback",
          "min": 0,
          "max": 1,
          "default": 0.7,
          "unit": "",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.7
        },
        {
          "label": "Stereo offset",
          "min": 0,
          "max": 0.5,
          "default": 0.13,
          "unit": "",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.26
        }
      ],
      "defaultParams": [
        0.6289174995846284,
        0.43478260869565216,
        0.7901107651134204,
        0.7,
        0.26,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 6,
      "id": "modulated-delay",
      "name": "Flanger / chorus",
      "kind": "processor",
      "defaultSource": 5,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Base delay",
          "min": 0.0005,
          "max": 0.03,
          "default": 0.006,
          "unit": "s",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.6069119518459338
        },
        {
          "label": "Depth",
          "min": 0,
          "max": 0.015,
          "default": 0.003,
          "unit": "s",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.2
        },
        {
          "label": "Rate",
          "min": 0.02,
          "max": 10,
          "default": 0.3,
          "unit": "Hz",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.43575558719297985
        },
        {
          "label": "Feedback",
          "min": -0.9,
          "max": 0.9,
          "default": 0.25,
          "unit": "",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.6388888888888888
        },
        {
          "label": "Stereo phase",
          "min": 0,
          "max": 1,
          "default": 0.5,
          "unit": "",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.5
        }
      ],
      "defaultParams": [
        0.6069119518459338,
        0.2,
        0.43575558719297985,
        0.6388888888888888,
        0.5,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 7,
      "id": "phaser",
      "name": "Allpass phaser",
      "kind": "processor",
      "defaultSource": 5,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Rate",
          "min": 0.02,
          "max": 8,
          "default": 0.3,
          "unit": "Hz",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.45198468251128315
        },
        {
          "label": "Sweep",
          "min": 0,
          "max": 1,
          "default": 0.7,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.7
        },
        {
          "label": "Center",
          "min": 100,
          "max": 4000,
          "default": 750,
          "unit": "Hz",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.5462100471445852
        },
        {
          "label": "Feedback",
          "min": -0.85,
          "max": 0.85,
          "default": 0.3,
          "unit": "",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.676470588235294
        },
        {
          "label": "Stages",
          "min": 2,
          "max": 12,
          "default": 6,
          "unit": "",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.4
        }
      ],
      "defaultParams": [
        0.45198468251128315,
        0.7,
        0.5462100471445852,
        0.676470588235294,
        0.4,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 8,
      "id": "reverb",
      "name": "Feedback delay network reverb",
      "kind": "processor",
      "defaultSource": 6,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Size",
          "min": 0.2,
          "max": 2,
          "default": 1,
          "unit": "",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.4444444444444445
        },
        {
          "label": "Decay",
          "min": 0.1,
          "max": 12,
          "default": 2.4,
          "unit": "s",
          "scale": "log",
          "index": 1,
          "defaultNormalized": 0.6638243993087611
        },
        {
          "label": "Damping",
          "min": 500,
          "max": 18000,
          "default": 6000,
          "unit": "Hz",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.6934264036172708
        },
        {
          "label": "Predelay",
          "min": 0,
          "max": 0.1,
          "default": 0.018,
          "unit": "s",
          "scale": "linear",
          "index": 3,
          "defaultNormalized": 0.17999999999999997
        },
        {
          "label": "Stereo width",
          "min": 0,
          "max": 1,
          "default": 0.85,
          "unit": "",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.85
        }
      ],
      "defaultParams": [
        0.4444444444444445,
        0.6638243993087611,
        0.6934264036172708,
        0.17999999999999997,
        0.85,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 9,
      "id": "saturation",
      "name": "Antialiased saturation",
      "kind": "processor",
      "defaultSource": 1,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Drive",
          "min": 0,
          "max": 36,
          "default": 12,
          "unit": "dB",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.3333333333333333
        },
        {
          "label": "Curve",
          "min": 0,
          "max": 2,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Tanh",
            "Hard clip",
            "Cubic"
          ],
          "index": 1,
          "defaultNormalized": 0.0
        },
        {
          "label": "Bias",
          "min": -0.5,
          "max": 0.5,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "index": 2,
          "defaultNormalized": 0.5
        },
        {
          "label": "Antialiasing",
          "min": 0,
          "max": 1,
          "default": 1,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Direct",
            "ADAA"
          ],
          "index": 3,
          "defaultNormalized": 1.0
        },
        {
          "label": "Tone",
          "min": 200,
          "max": 20000,
          "default": 14000,
          "unit": "Hz",
          "scale": "log",
          "index": 4,
          "defaultNormalized": 0.9225490200071285
        }
      ],
      "defaultParams": [
        0.3333333333333333,
        0.0,
        0.5,
        1.0,
        0.9225490200071285,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 10,
      "id": "decimator",
      "name": "Bit depth / sample-rate reduction",
      "kind": "processor",
      "defaultSource": 7,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Bits",
          "min": 2,
          "max": 16,
          "default": 8,
          "unit": "",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.42857142857142855
        },
        {
          "label": "Sample rate",
          "min": 200,
          "max": 48000,
          "default": 12000,
          "unit": "Hz",
          "scale": "log",
          "index": 1,
          "defaultNormalized": 0.7470560676391805
        },
        {
          "label": "Dither",
          "min": 0,
          "max": 1,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "index": 2,
          "defaultNormalized": 0.0
        },
        {
          "label": "Output low-pass",
          "min": 200,
          "max": 20000,
          "default": 16000,
          "unit": "Hz",
          "scale": "log",
          "index": 3,
          "defaultNormalized": 0.9515449934959717
        }
      ],
      "defaultParams": [
        0.42857142857142855,
        0.7470560676391805,
        0.0,
        0.9515449934959717,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 11,
      "id": "compressor",
      "name": "Compressor",
      "kind": "processor",
      "defaultSource": 6,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Threshold",
          "min": -60,
          "max": 0,
          "default": -24,
          "unit": "dB",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.6
        },
        {
          "label": "Ratio",
          "min": 1,
          "max": 20,
          "default": 4,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.15789473684210525
        },
        {
          "label": "Attack",
          "min": 0.0001,
          "max": 0.1,
          "default": 0.006,
          "unit": "s",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.5927170834612145
        },
        {
          "label": "Release",
          "min": 0.01,
          "max": 2,
          "default": 0.18,
          "unit": "s",
          "scale": "log",
          "index": 3,
          "defaultNormalized": 0.5455263544885197
        },
        {
          "label": "Knee",
          "min": 0,
          "max": 24,
          "default": 6,
          "unit": "dB",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.25
        },
        {
          "label": "Makeup",
          "min": 0,
          "max": 24,
          "default": 6,
          "unit": "dB",
          "scale": "linear",
          "index": 5,
          "defaultNormalized": 0.25
        },
        {
          "label": "Detector",
          "min": 0,
          "max": 1,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Peak",
            "RMS"
          ],
          "index": 6,
          "defaultNormalized": 0.0
        }
      ],
      "defaultParams": [
        0.6,
        0.15789473684210525,
        0.5927170834612145,
        0.5455263544885197,
        0.25,
        0.25,
        0.0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 12,
      "id": "expander",
      "name": "Downward expander / gate",
      "kind": "processor",
      "defaultSource": 6,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Threshold",
          "min": -80,
          "max": -6,
          "default": -32,
          "unit": "dB",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.6486486486486487
        },
        {
          "label": "Ratio",
          "min": 1,
          "max": 10,
          "default": 4,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.3333333333333333
        },
        {
          "label": "Attack",
          "min": 0.0001,
          "max": 0.1,
          "default": 0.003,
          "unit": "s",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.49237375157322083
        },
        {
          "label": "Release",
          "min": 0.01,
          "max": 2,
          "default": 0.12,
          "unit": "s",
          "scale": "log",
          "index": 3,
          "defaultNormalized": 0.46899920821597907
        },
        {
          "label": "Maximum reduction",
          "min": 0,
          "max": 80,
          "default": 60,
          "unit": "dB",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.75
        },
        {
          "label": "Hold",
          "min": 0,
          "max": 0.2,
          "default": 0.025,
          "unit": "s",
          "scale": "linear",
          "index": 5,
          "defaultNormalized": 0.125
        }
      ],
      "defaultParams": [
        0.6486486486486487,
        0.3333333333333333,
        0.49237375157322083,
        0.46899920821597907,
        0.75,
        0.125,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 13,
      "id": "envelope-filter",
      "name": "Envelope-following filter",
      "kind": "processor",
      "defaultSource": 6,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Sensitivity",
          "min": -24,
          "max": 24,
          "default": 6,
          "unit": "dB",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.625
        },
        {
          "label": "Base frequency",
          "min": 60,
          "max": 2000,
          "default": 180,
          "unit": "Hz",
          "scale": "log",
          "index": 1,
          "defaultNormalized": 0.31330219572526247
        },
        {
          "label": "Sweep",
          "min": 0,
          "max": 5,
          "default": 3,
          "unit": "oct",
          "scale": "linear",
          "index": 2,
          "defaultNormalized": 0.6
        },
        {
          "label": "Q",
          "min": 0.5,
          "max": 10,
          "default": 2,
          "unit": "",
          "scale": "log",
          "index": 3,
          "defaultNormalized": 0.46275642631951835
        },
        {
          "label": "Attack",
          "min": 0.0005,
          "max": 0.2,
          "default": 0.008,
          "unit": "s",
          "scale": "log",
          "index": 4,
          "defaultNormalized": 0.46275642631951835
        },
        {
          "label": "Release",
          "min": 0.01,
          "max": 1.5,
          "default": 0.15,
          "unit": "s",
          "scale": "log",
          "index": 5,
          "defaultNormalized": 0.5404604490558215
        },
        {
          "label": "Direction",
          "min": 0,
          "max": 1,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Up",
            "Down"
          ],
          "index": 6,
          "defaultNormalized": 0.0
        }
      ],
      "defaultParams": [
        0.625,
        0.31330219572526247,
        0.6,
        0.46275642631951835,
        0.46275642631951835,
        0.5404604490558215,
        0.0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 14,
      "id": "frequency-shifter",
      "name": "Hilbert frequency shifter",
      "kind": "processor",
      "defaultSource": 2,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Shift",
          "min": -2000,
          "max": 2000,
          "default": 80,
          "unit": "Hz",
          "scale": "linear",
          "index": 0,
          "defaultNormalized": 0.52
        },
        {
          "label": "Fine shift",
          "min": -10,
          "max": 10,
          "default": 0,
          "unit": "Hz",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.5
        },
        {
          "label": "Sideband",
          "min": 0,
          "max": 1,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "choices": [
            "Up",
            "Down"
          ],
          "index": 2,
          "defaultNormalized": 0.0
        },
        {
          "label": "Input high-pass",
          "min": 20,
          "max": 1000,
          "default": 40,
          "unit": "Hz",
          "scale": "log",
          "index": 3,
          "defaultNormalized": 0.17718382013555792
        }
      ],
      "defaultParams": [
        0.52,
        0.5,
        0.0,
        0.17718382013555792,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    {
      "processorId": 15,
      "id": "vocoder",
      "name": "Eight-band vocoder",
      "kind": "processor",
      "defaultSource": 7,
      "defaultFrequency": 220,
      "params": [
        {
          "label": "Carrier frequency",
          "min": 40,
          "max": 800,
          "default": 130,
          "unit": "Hz",
          "scale": "log",
          "index": 0,
          "defaultNormalized": 0.39344470356937045
        },
        {
          "label": "Pulse / saw",
          "min": 0,
          "max": 1,
          "default": 0.7,
          "unit": "",
          "scale": "linear",
          "index": 1,
          "defaultNormalized": 0.7
        },
        {
          "label": "Attack",
          "min": 0.0005,
          "max": 0.05,
          "default": 0.003,
          "unit": "s",
          "scale": "log",
          "index": 2,
          "defaultNormalized": 0.38907562519182176
        },
        {
          "label": "Release",
          "min": 0.005,
          "max": 0.5,
          "default": 0.09,
          "unit": "s",
          "scale": "log",
          "index": 3,
          "defaultNormalized": 0.6276362525516529
        },
        {
          "label": "Band Q",
          "min": 1,
          "max": 8,
          "default": 2.5,
          "unit": "",
          "scale": "linear",
          "index": 4,
          "defaultNormalized": 0.21428571428571427
        },
        {
          "label": "Formant scale",
          "min": 0.5,
          "max": 2,
          "default": 1,
          "unit": "",
          "scale": "log",
          "index": 5,
          "defaultNormalized": 0.5
        },
        {
          "label": "Unvoiced carrier",
          "min": 0,
          "max": 1,
          "default": 0.1,
          "unit": "",
          "scale": "linear",
          "index": 6,
          "defaultNormalized": 0.1
        },
        {
          "label": "Spectral tilt",
          "min": -1,
          "max": 1,
          "default": 0,
          "unit": "",
          "scale": "linear",
          "index": 7,
          "defaultNormalized": 0.5
        }
      ],
      "defaultParams": [
        0.39344470356937045,
        0.7,
        0.38907562519182176,
        0.6276362525516529,
        0.21428571428571427,
        0.5,
        0.1,
        0.5,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    },
    spectralSchema
  ]
};

import {
  DEFAULT_FM_DRUM_VOICES,
  FM_DRUM_STORAGE_KEY,
  sanitizeFmDrumVoice,
} from "./src/fm-drums.js";
import { unlockAudioContext } from "./src/audio.js";
import { connectAudioOutput } from "./src/audio-output-manager.js";
import {
  RUBIX_ACID_MIDI_BY_COLOR,
  RUBIX_DRUM_LEFT_VOICE_BY_COLOR,
  RUBIX_DRUM_RIGHT_VOICE_BY_COLOR,
  rubixTwistIntervalMs,
  rubixTwistSpeedMultiplier,
} from "./src/rubix.js";
import {
  SLIDING_PLAYBACK_MODES,
  SLIDING_PUZZLE_SIZE,
  SLIDING_READ_PATHS,
  SLIDING_TILE_COLOR_ORDER,
  appendSlidingMoveHistory,
  createSlidingPuzzlePlaybackFrames,
  createSlidingPuzzleScramble,
  createSlidingPuzzleSequence,
  createSolvedSlidingPuzzle,
  invertSlidingMoves,
  isSlidingPuzzleSolved,
  normalizeSlidingRotation,
  slidePuzzleTile,
  slidingPuzzleBlankIndex,
  slidingPuzzleDimensions,
  slidingPuzzleLegalTileIds,
  slidingPuzzleMetrics,
  slidingPuzzleMoveTileIds,
  slidingPuzzleReadOrder,
  slidingPuzzleScreenCellForBoardCell,
  slidingPuzzleScreenDimensions,
  slidingTileColor,
} from "./src/sliding-puzzle.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);
const countLabel = (count, singular, plural = `${singular}s`) => (
  `${count} ${count === 1 ? singular : plural}`
);
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 24;
const SCRAMBLE_DELAY_MS = 54;
const SOLVE_DELAY_MS = 68;

const COLOR_HEX = Object.freeze({
  white: "#edf6ee",
  yellow: "#f5c95c",
  green: "#70e06f",
  blue: "#458cff",
  red: "#ff5f72",
  orange: "#ff784f",
  rest: "#62dbff",
});

const COLOR_INSTRUMENT_LABELS = Object.freeze({
  white: "glass / open",
  yellow: "low / warm",
  green: "wood / round",
  blue: "deep / glide",
  red: "body / accent",
  orange: "rim / bright",
});

const SOUND_BANKS = Object.freeze({
  "soft-fm": Object.freeze({
    id: "soft-fm",
    label: "Soft FM kit",
    description: "Each fixed tile identity chooses an FM drum body; color shifts pitch and modulation. The moving empty cell is always a hard rest.",
  }),
  analog: Object.freeze({
    id: "analog",
    label: "Analog kit",
    description: "Sine, triangle, and square attacks follow tile identity while color changes the pitch drop, waveform, and brightness.",
  }),
  modal: Object.freeze({
    id: "modal",
    label: "Modal colors",
    description: "Every tile strikes a tuned three-part resonator. Tile identity follows the selected scale and color changes its inharmonic body.",
  }),
  noise: Object.freeze({
    id: "noise",
    label: "Noise grid",
    description: "Colored filter bursts turn tile identity, row, and column into a dry spatial rhythm. The gap remains completely silent.",
  }),
  "acid-303": Object.freeze({
    id: "acid-303",
    label: "303 acid",
    description: "The selected scale becomes a resonant acid line. Green and blue tiles glide; red and yellow tiles accent; the empty cell gates the voice off.",
  }),
});

const SCALES = Object.freeze({
  dorian: Object.freeze({
    id: "dorian",
    label: "D dorian",
    root: 50,
    intervals: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  }),
  "minor-pentatonic": Object.freeze({
    id: "minor-pentatonic",
    label: "A minor pentatonic",
    root: 45,
    intervals: Object.freeze([0, 3, 5, 7, 10]),
  }),
  "whole-tone": Object.freeze({
    id: "whole-tone",
    label: "C whole tone",
    root: 48,
    intervals: Object.freeze([0, 2, 4, 6, 8, 10]),
  }),
  chromatic: Object.freeze({
    id: "chromatic",
    label: "Chromatic",
    root: 48,
    intervals: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  }),
});

const DEFAULTS = Object.freeze({
  tempo: 124,
  swing: 0,
  pulseDivision: 8,
  playbackMode: "parallel",
  playbackDirection: "forward",
  soundBank: "soft-fm",
  scale: "dorian",
  brightness: 0.62,
  decay: 0.42,
  colorDepth: 0.74,
  stereoWidth: 0.68,
  pitchSpan: 36,
  positionInfluence: 0.72,
  filterInfluence: 0.72,
  neighborResponse: 0.65,
  disorderInfluence: 0.6,
  microStrum: 0.012,
  output: 0.54,
  autoSlideSpeed: 36,
});

const NOTE_NAMES = Object.freeze(["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]);

function midiFrequency(midi) {
  return 440 * 2 ** ((Number(midi) - 69) / 12);
}

function scaleFor(id = DEFAULTS.scale) {
  return SCALES[id] ?? SCALES[DEFAULTS.scale];
}

function tileMidi(
  tileId,
  scaleId = DEFAULTS.scale,
  colorDepth = DEFAULTS.colorDepth,
  pitchSpan = DEFAULTS.pitchSpan,
  tileColor = slidingTileColor(tileId),
) {
  const tile = Math.max(1, Math.round(Number(tileId) || 1));
  const scale = scaleFor(scaleId);
  const degree = tile - 1;
  const unfoldedMidi = scale.root
    + scale.intervals[degree % scale.intervals.length]
    + Math.floor(degree / scale.intervals.length) * 12;
  const span = clamp(pitchSpan, 12, 48);
  const scaleMidi = scale.root + ((unfoldedMidi - scale.root) % span + span) % span;
  const rubixOffset = RUBIX_ACID_MIDI_BY_COLOR[tileColor] - RUBIX_ACID_MIDI_BY_COLOR.white;
  return scaleMidi + Math.round(rubixOffset * clamp(colorDepth, 0, 1) * 0.22);
}

function noteName(midi) {
  const safeMidi = Math.round(Number(midi) || 0);
  const pitchClass = ((safeMidi % 12) + 12) % 12;
  return `${NOTE_NAMES[pitchClass]}${Math.floor(safeMidi / 12) - 1}`;
}

function tileNoteName(tileId) {
  return noteName(tileMidi(
    tileId,
    state.scale,
    state.colorDepth,
    state.pitchSpan,
    slidingTileColor(tileId, slidingPuzzleDimensions(state.puzzle).columns),
  ));
}

function eventMidi(event, settings) {
  const base = tileMidi(
    event.tileId,
    settings.scale,
    settings.colorDepth,
    settings.pitchSpan,
    event.color,
  );
  const x = event.screenColumn / Math.max(1, event.screenColumns - 1);
  const y = event.screenRow / Math.max(1, event.screenRows - 1);
  const screenPitch = ((0.5 - y) * 5 + (x - 0.5) * 2.5)
    * clamp(settings.positionInfluence, 0, 2);
  const displacementDirection = (
    (event.boardRow - event.homeRow) + (event.boardColumn - event.homeColumn) * 0.5
  ) / Math.max(1, event.boardRows + event.boardColumns - 2);
  const displacementPitch = displacementDirection * 8 * clamp(settings.positionInfluence, 0, 2);
  const stableJitter = (((event.tileId * 29) % 17) / 8 - 1)
    * 1.2
    * clamp(settings.disorder, 0, 1)
    * clamp(settings.disorderInfluence, 0, 2);
  return base + screenPitch + displacementPitch + stableJitter;
}

function eventSettings(event, settings) {
  const y = event.screenRow / Math.max(1, event.screenRows - 1);
  const filterMotion = ((0.5 - y) * 0.34 + event.normalizedDisplacement * 0.22)
    * clamp(settings.filterInfluence, 0, 2);
  const neighborCount = Math.max(1, event.neighborCount);
  const cohesion = event.matchingNeighbors / neighborCount;
  const faults = event.mixedNeighbors / neighborCount;
  const neighborDepth = clamp(settings.neighborResponse, 0, 2);
  const disorderDepth = clamp(settings.disorderInfluence, 0, 2) * clamp(settings.disorder, 0, 1);
  return {
    ...settings,
    brightness: clamp(settings.brightness + filterMotion + faults * neighborDepth * 0.08 + disorderDepth * 0.1, 0, 1),
    decay: clamp(settings.decay * (1 + cohesion * neighborDepth * 0.22 - faults * neighborDepth * 0.08), 0.08, 0.9),
    colorDepth: clamp(settings.colorDepth + faults * neighborDepth * 0.12 + disorderDepth * 0.1, 0, 1),
    pitchMidi: eventMidi(event, settings),
  };
}

function loadDrumBank() {
  const defaults = DEFAULT_FM_DRUM_VOICES.map((voice) => sanitizeFmDrumVoice(voice));
  const editableKeys = [
    "frequency", "attack", "decay", "modRatio", "modIndex",
    "pitchBend", "noise", "tone", "level",
  ];
  try {
    const stored = JSON.parse(localStorage.getItem(FM_DRUM_STORAGE_KEY));
    if (!Array.isArray(stored) || stored.length !== defaults.length) return defaults;
    return defaults.map((fallback) => {
      const saved = stored.find((voice) => voice?.id === fallback.id);
      const merged = { ...fallback };
      for (const key of editableKeys) {
        if (saved && Object.hasOwn(saved, key)) merged[key] = saved[key];
      }
      return sanitizeFmDrumVoice(merged);
    });
  } catch {
    return defaults;
  }
}

class SlidingPuzzleAudio {
  constructor(runtime = globalThis, voices = DEFAULT_FM_DRUM_VOICES) {
    this.runtime = runtime;
    this.voices = voices;
    this.context = null;
    this.compressor = null;
    this.transportBus = null;
    this.gestureBus = null;
    this.master = null;
    this.analyser = null;
    this.noiseBuffer = null;
    this.panners = new Map();
    this.releaseAudioOutput = null;
    this.output = DEFAULTS.output;
    this.transportActive = false;
    this.lifecycleGeneration = 0;
  }

  async start(settings) {
    const lifecycleGeneration = this.lifecycleGeneration;
    if (!this.context || this.context.state === "closed") {
      const Context = this.runtime.AudioContext ?? this.runtime.webkitAudioContext;
      if (!Context) throw new Error("Web Audio is not available in this browser.");
      this.context = new Context({ latencyHint: "interactive" });
      this.buildGraph(settings);
    }
    const context = this.context;
    if (context.state === "suspended") {
      unlockAudioContext(context);
      await context.resume();
    }
    if (
      lifecycleGeneration !== this.lifecycleGeneration
      || context !== this.context
      || context.state === "closed"
    ) {
      const error = new Error("Sliding puzzle audio start was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    this.setOutput(settings.output);
    return context;
  }

  buildGraph(settings) {
    const context = this.context;
    this.compressor = context.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 10;
    this.compressor.ratio.value = 7;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.17;

    this.transportBus = context.createGain();
    this.transportBus.gain.value = 0.0001;
    this.gestureBus = context.createGain();
    this.gestureBus.gain.value = 0.42;
    this.master = context.createGain();
    this.master.gain.value = clamp(settings.output, 0, 0.9);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.78;

    this.transportBus.connect(this.compressor);
    this.gestureBus.connect(this.compressor);
    this.compressor.connect(this.master);
    this.master.connect(this.analyser);
    this.releaseAudioOutput = connectAudioOutput(context, this.analyser, { runtime: this.runtime });

    this.noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) {
      noise[index] = Math.random() * 2 - 1;
    }
  }

  resetTransportBus(active = false) {
    if (!this.context || !this.compressor) return;
    const context = this.context;
    const previousBus = this.transportBus;
    if (previousBus) {
      const now = context.currentTime;
      previousBus.gain.cancelScheduledValues(now);
      previousBus.gain.setValueAtTime(Math.max(0.0001, previousBus.gain.value), now);
      previousBus.gain.linearRampToValueAtTime(0.0001, now + 0.008);
      const disconnect = () => {
        try {
          previousBus.disconnect();
        } catch {
          // It may already be detached by context shutdown.
        }
      };
      if (typeof this.runtime.setTimeout === "function") this.runtime.setTimeout(disconnect, 32);
      else disconnect();
    }
    for (const key of [...this.panners.keys()]) {
      if (key.startsWith("transport:")) this.panners.delete(key);
    }
    this.transportBus = context.createGain();
    this.transportBus.gain.value = active ? 1 : 0.0001;
    this.transportBus.connect(this.compressor);
    this.transportActive = Boolean(active);
  }

  setOutput(value) {
    this.output = clamp(value, 0, 0.9);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.output, this.context.currentTime, 0.015);
    }
  }

  setTransportActive(active) {
    if (!this.transportBus || !this.context) return;
    const next = Boolean(active);
    if (next && !this.transportActive) {
      this.resetTransportBus(true);
      return;
    }
    const now = this.context.currentTime;
    this.transportBus.gain.cancelScheduledValues(now);
    this.transportBus.gain.setTargetAtTime(next ? 1 : 0.0001, now, next ? 0.008 : 0.018);
    this.transportActive = next;
  }

  destination(event, settings, audition = false) {
    const context = this.context;
    const bus = audition ? this.gestureBus : this.transportBus;
    if (!context.createStereoPanner) return bus;
    const key = `${audition ? "gesture" : "transport"}:${event.screenColumn}`;
    let panner = this.panners.get(key);
    if (!panner) {
      panner = context.createStereoPanner();
      panner.connect(bus);
      this.panners.set(key, panner);
    }
    const normalizedColumn = event.screenColumn / Math.max(1, event.screenColumns - 1);
    panner.pan.setTargetAtTime(
      (normalizedColumn * 2 - 1) * clamp(settings.stereoWidth, 0, 1),
      context.currentTime,
      0.008,
    );
    return panner;
  }

  schedule(event, when, stepDuration, settings, options = {}) {
    if (!this.context || !event || event.isRest) return;
    const audition = options.audition === true;
    const level = clamp(options.level ?? 1, 0, 1.2);
    const modulatedSettings = eventSettings(event, settings);
    const destination = this.destination(event, modulatedSettings, audition);
    if (modulatedSettings.soundBank === "acid-303") {
      this.scheduleAcid(event, when, stepDuration, modulatedSettings, destination, level);
    } else if (modulatedSettings.soundBank === "analog") {
      this.scheduleAnalog(event, when, stepDuration, modulatedSettings, destination, level);
    } else if (modulatedSettings.soundBank === "modal") {
      this.scheduleModal(event, when, stepDuration, modulatedSettings, destination, level);
    } else if (modulatedSettings.soundBank === "noise") {
      this.scheduleNoiseVoice(event, when, stepDuration, modulatedSettings, destination, level);
    } else {
      this.scheduleFm(event, when, stepDuration, modulatedSettings, destination, level);
    }
  }

  scheduleFm(event, when, stepDuration, settings, destination, level) {
    const context = this.context;
    const colorMap = event.tileId % 2
      ? RUBIX_DRUM_LEFT_VOICE_BY_COLOR
      : RUBIX_DRUM_RIGHT_VOICE_BY_COLOR;
    const voice = sanitizeFmDrumVoice(this.voices[colorMap[event.color]] ?? this.voices[0]);
    const colorIndex = SLIDING_TILE_COLOR_ORDER.indexOf(event.color);
    const identityDetune = ((event.tileId - 1) % 3 - 1) * 0.055;
    const base = clamp(
      voice.frequency * 2 ** (
        identityDetune
        + colorIndex * settings.colorDepth * 0.012
        + (settings.pitchMidi - tileMidi(
          event.tileId,
          settings.scale,
          settings.colorDepth,
          settings.pitchSpan,
          event.color,
        )) / 12
      ),
      28,
      4200,
    );
    const decay = clamp(0.055 + settings.decay * 0.56, 0.055, stepDuration * 1.8 + 0.12);
    const attack = clamp(voice.attack, 0.001, 0.035);
    const stopAt = when + attack + decay + 0.06;
    const carrier = context.createOscillator();
    const modulator = context.createOscillator();
    const modulation = context.createGain();
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    carrier.type = voice.family === "hat" ? "triangle" : "sine";
    modulator.type = "triangle";
    carrier.frequency.setValueAtTime(clamp(base * (1.45 + Math.abs(voice.pitchBend)), 20, 12_000), when);
    carrier.frequency.exponentialRampToValueAtTime(base, when + Math.min(0.08, decay * 0.42));
    modulator.frequency.value = clamp(base * voice.modRatio, 20, 16_000);
    modulation.gain.setValueAtTime(
      Math.max(0.001, base * voice.modIndex * (0.22 + settings.colorDepth * 0.42)),
      when,
    );
    modulation.gain.exponentialRampToValueAtTime(0.001, when + decay);
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.exponentialRampToValueAtTime(
      Math.max(0.001, voice.level * level * 0.34),
      when + attack,
    );
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    filter.type = voice.family === "hat" ? "highpass" : "lowpass";
    filter.frequency.value = voice.family === "hat"
      ? 1700 + settings.brightness * 6500
      : 500 + settings.brightness * 10_500;
    filter.Q.value = 0.65 + settings.colorDepth * 1.1;
    modulator.connect(modulation);
    modulation.connect(carrier.frequency);
    carrier.connect(amplitude);
    amplitude.connect(filter);
    filter.connect(destination);
    carrier.start(when);
    modulator.start(when);
    carrier.stop(stopAt);
    modulator.stop(stopAt);
    if (voice.noise > 0.04) {
      this.scheduleNoiseBurst(
        when,
        Math.min(decay, 0.22),
        1000 + settings.brightness * 6500,
        voice.noise * level * 0.15,
        destination,
        voice.family === "kick" ? "bandpass" : "highpass",
      );
    }
  }

  scheduleAnalog(event, when, stepDuration, settings, destination, level) {
    const context = this.context;
    const colorIndex = SLIDING_TILE_COLOR_ORDER.indexOf(event.color);
    const frequency = clamp(midiFrequency(settings.pitchMidi) * 0.5, 32, 2400);
    const decay = clamp(0.05 + settings.decay * 0.43, 0.05, stepDuration * 1.45 + 0.08);
    const oscillator = context.createOscillator();
    const amplitude = context.createGain();
    const filter = context.createBiquadFilter();
    oscillator.type = ["sine", "triangle", "triangle", "square", "sawtooth", "square"][colorIndex];
    oscillator.frequency.setValueAtTime(frequency * (1.4 + colorIndex * 0.11), when);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, when + Math.min(0.075, decay * 0.55));
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.exponentialRampToValueAtTime(0.18 * level, when + 0.003);
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    filter.type = "lowpass";
    filter.frequency.value = 650 + settings.brightness * 7800;
    filter.Q.value = 0.8 + settings.colorDepth * 2.4;
    oscillator.connect(amplitude);
    amplitude.connect(filter);
    filter.connect(destination);
    oscillator.start(when);
    oscillator.stop(when + decay + 0.06);
    if ([1, 3, 5].includes(colorIndex)) {
      this.scheduleNoiseBurst(
        when,
        Math.min(0.12, decay),
        900 + colorIndex * 620 + settings.brightness * 2800,
        0.055 * level,
        destination,
        "bandpass",
      );
    }
  }

  scheduleModal(event, when, stepDuration, settings, destination, level) {
    const context = this.context;
    const colorIndex = SLIDING_TILE_COLOR_ORDER.indexOf(event.color);
    const root = midiFrequency(settings.pitchMidi);
    const colorSkew = 1 + (colorIndex - 2.5) * settings.colorDepth * 0.018;
    const ratios = [1, 2.73 * colorSkew, 5.81 / colorSkew];
    const partialLevels = [0.2, 0.075, 0.033];
    const decay = clamp(0.09 + settings.decay * 0.78, 0.09, stepDuration * 2.2 + 0.2);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200 + settings.brightness * 8800;
    filter.Q.value = 0.9;
    filter.connect(destination);
    ratios.forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const amplitude = context.createGain();
      const partialDecay = decay * [1, 0.62, 0.38][index];
      oscillator.type = "sine";
      oscillator.frequency.value = clamp(root * ratio, 24, 14_000);
      amplitude.gain.setValueAtTime(0.0001, when);
      amplitude.gain.exponentialRampToValueAtTime(partialLevels[index] * level, when + 0.003);
      amplitude.gain.exponentialRampToValueAtTime(0.0001, when + partialDecay);
      oscillator.connect(amplitude);
      amplitude.connect(filter);
      oscillator.start(when);
      oscillator.stop(when + partialDecay + 0.05);
    });
  }

  scheduleNoiseVoice(event, when, stepDuration, settings, destination, level) {
    const colorIndex = SLIDING_TILE_COLOR_ORDER.indexOf(event.color);
    const frequency = clamp(
      280 + midiFrequency(settings.pitchMidi)
        * (1.2 + colorIndex * 0.32),
      180,
      9800,
    );
    const decay = clamp(0.035 + settings.decay * 0.28, 0.035, stepDuration * 1.1 + 0.06);
    this.scheduleNoiseBurst(
      when,
      decay,
      frequency + settings.brightness * 2400,
      (0.11 + colorIndex * 0.008) * level,
      destination,
      colorIndex === 3 ? "highpass" : "bandpass",
      0.7 + settings.colorDepth * 3.2,
    );
  }

  scheduleAcid(event, when, stepDuration, settings, destination, level) {
    const context = this.context;
    const colorIndex = SLIDING_TILE_COLOR_ORDER.indexOf(event.color);
    const frequency = midiFrequency(settings.pitchMidi);
    const glide = event.color === "green" || event.color === "blue";
    const accent = event.color === "red" || event.color === "yellow" ? 1.18 : 0.92;
    const decay = clamp(0.06 + settings.decay * 0.62, 0.06, stepDuration * 1.75 + 0.08);
    const stopAt = when + decay + 0.08;
    const saw = context.createOscillator();
    const sub = context.createOscillator();
    const sawLevel = context.createGain();
    const subLevel = context.createGain();
    const filter = context.createBiquadFilter();
    const amplitude = context.createGain();
    saw.type = "sawtooth";
    sub.type = "square";
    const startFrequency = glide ? frequency * 2 ** (-2 / 12) : frequency;
    saw.frequency.setValueAtTime(startFrequency, when);
    sub.frequency.setValueAtTime(startFrequency * 0.5, when);
    if (glide) {
      saw.frequency.exponentialRampToValueAtTime(frequency, when + Math.min(0.07, stepDuration * 0.5));
      sub.frequency.exponentialRampToValueAtTime(frequency * 0.5, when + Math.min(0.07, stepDuration * 0.5));
    }
    sawLevel.gain.value = 0.34;
    subLevel.gain.value = 0.09;
    filter.type = "lowpass";
    const floor = 180 + settings.brightness * 1200;
    const peak = clamp(floor * (2.4 + colorIndex * settings.colorDepth * 0.38), 300, 12_000);
    filter.frequency.setValueAtTime(peak, when);
    filter.frequency.exponentialRampToValueAtTime(floor, when + decay);
    filter.Q.value = 7 + settings.colorDepth * 9;
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.exponentialRampToValueAtTime(0.15 * accent * level, when + 0.004);
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    saw.connect(sawLevel);
    sub.connect(subLevel);
    sawLevel.connect(filter);
    subLevel.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    saw.start(when);
    sub.start(when);
    saw.stop(stopAt);
    sub.stop(stopAt);
  }

  scheduleNoiseBurst(when, decay, frequency, peak, destination, type = "highpass", q = 0.8) {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const amplitude = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.value = clamp(frequency, 80, 14_000);
    filter.Q.value = q;
    amplitude.gain.setValueAtTime(0.0001, when);
    amplitude.gain.linearRampToValueAtTime(Math.max(0.001, peak), when + 0.002);
    amplitude.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    source.connect(filter);
    filter.connect(amplitude);
    amplitude.connect(destination);
    const stopAt = when + decay + 0.04;
    const offset = Math.random() * Math.max(0, this.noiseBuffer.duration - (stopAt - when));
    source.start(when, offset);
    source.stop(stopAt);
  }

  async close() {
    this.lifecycleGeneration += 1;
    const context = this.context;
    this.releaseAudioOutput?.();
    this.releaseAudioOutput = null;
    this.context = null;
    this.compressor = null;
    this.transportBus = null;
    this.gestureBus = null;
    this.master = null;
    this.analyser = null;
    this.noiseBuffer = null;
    this.transportActive = false;
    this.panners.clear();
    if (context && context.state !== "closed") await context.close();
  }
}

const state = {
  puzzle: createSolvedSlidingPuzzle(),
  rotationTurns: 0,
  pathId: "rows",
  squareLock: true,
  history: Object.freeze([]),
  audioOn: false,
  playing: false,
  currentStep: 0,
  autoSlide: false,
  busy: false,
  ...DEFAULTS,
};

const tileButtons = new Map();
const readerCells = [];
const stageStepCells = [];
const clockStepCells = [];
const audio = new SlidingPuzzleAudio(globalThis, loadDrumBank());
let blankCellElement = null;

let sequenceSnapshot = createSlidingPuzzlePlaybackFrames(state.puzzle, {
  playbackMode: state.playbackMode,
});
let audioLifecycleGeneration = 0;
let schedulerTimer = null;
let nextStepTime = 0;
let transportStep = 0;
let transportDirection = 1;
let transportPulse = 0;
let committedTransportDirection = 1;
let committedTransportPulse = -1;
let transportHasCommitted = false;
let randomTransportOrder = [];
let randomTransportIndex = 0;
let visualTimers = new Set();
let autoSlideTimer = null;
let previousAutoTile = null;
let motionTimer = null;
let motionGeneration = 0;
let invalidPulseTimer = null;

function announce(message) {
  const live = $("liveStatus");
  if (!live) return;
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

function settingsSnapshot() {
  const metrics = slidingPuzzleMetrics(state.puzzle);
  return {
    soundBank: state.soundBank,
    scale: state.scale,
    brightness: state.brightness,
    decay: state.decay,
    colorDepth: state.colorDepth,
    stereoWidth: state.stereoWidth,
    pitchSpan: state.pitchSpan,
    positionInfluence: state.positionInfluence,
    filterInfluence: state.filterInfluence,
    neighborResponse: state.neighborResponse,
    disorderInfluence: state.disorderInfluence,
    disorder: metrics.disorder,
    output: state.output,
  };
}

function currentSequence() {
  return createSlidingPuzzleSequence(state.puzzle, {
    rotationQuarterTurns: state.rotationTurns,
    pathId: state.pathId,
  });
}

function currentPlaybackFrames() {
  return createSlidingPuzzlePlaybackFrames(state.puzzle, {
    rotationQuarterTurns: state.rotationTurns,
    pathId: state.pathId,
    playbackMode: state.playbackMode,
  });
}

function createTransportDom(frameCount = currentPlaybackFrames().length) {
  const stageSequence = $("stageSequence");
  const stepStrip = $("stepStrip");
  if (!stageSequence || !stepStrip) return;
  stageSequence.replaceChildren();
  stepStrip.replaceChildren();
  stageStepCells.length = 0;
  clockStepCells.length = 0;
  stageSequence.style.setProperty("--sequence-steps", String(frameCount));
  stepStrip.style.setProperty("--sequence-steps", String(frameCount));
  for (let step = 0; step < frameCount; step += 1) {
    const stageStep = document.createElement("span");
    stageStep.className = "sliding-stage-step";
    stageSequence.append(stageStep);
    stageStepCells.push(stageStep);

    const clockStep = document.createElement("span");
    clockStep.className = "sliding-clock-step";
    clockStep.setAttribute("aria-hidden", "true");
    stepStrip.append(clockStep);
    clockStepCells.push(clockStep);
  }
}

function createBoardDom() {
  const slots = $("boardSlots");
  const reader = $("puzzleReader");
  const board = $("puzzleBoard");
  if (!slots || !reader || !board) return;
  const dimensions = slidingPuzzleDimensions(state.puzzle);
  slots.replaceChildren();
  reader.replaceChildren();
  board.replaceChildren();
  tileButtons.clear();
  readerCells.length = 0;

  for (let index = 0; index < dimensions.cellCount; index += 1) {
    const slot = document.createElement("span");
    slot.className = "sliding-board-slot";
    slots.append(slot);

    const readerCell = document.createElement("span");
    readerCell.className = "sliding-reader-cell";
    reader.append(readerCell);
    readerCells.push(readerCell);

  }

  blankCellElement = document.createElement("span");
  const blankFace = document.createElement("span");
  blankCellElement.className = "sliding-blank-cell";
  blankCellElement.setAttribute("role", "gridcell");
  blankFace.className = "sliding-blank-face";
  blankCellElement.append(blankFace);
  board.append(blankCellElement);

  for (let tileId = 1; tileId < dimensions.cellCount; tileId += 1) {
    const button = document.createElement("button");
    const face = document.createElement("span");
    button.type = "button";
    button.className = "sliding-tile";
    button.dataset.tileId = String(tileId);
    button.dataset.color = slidingTileColor(tileId, dimensions.columns);
    button.setAttribute("role", "gridcell");
    face.className = "sliding-tile-face";
    face.setAttribute("aria-hidden", "true");
    button.append(face);
    button.addEventListener("click", () => requestTileMove(tileId));
    board.append(button);
    tileButtons.set(tileId, button);
  }

  board.removeEventListener("keydown", handleBoardKeydown);
  board.addEventListener("keydown", handleBoardKeydown);
  createTransportDom();
}

function createColorKey() {
  const key = $("colorKey");
  if (!key) return;
  key.replaceChildren();
  for (const color of SLIDING_TILE_COLOR_ORDER) {
    const item = document.createElement("div");
    const swatch = document.createElement("span");
    const copy = document.createElement("span");
    const label = document.createElement("b");
    const detail = document.createElement("small");
    item.className = "sliding-color-key-item";
    item.style.setProperty("--key-color", COLOR_HEX[color]);
    swatch.className = "sliding-color-key-swatch";
    copy.className = "sliding-color-key-copy";
    label.textContent = color;
    detail.textContent = COLOR_INSTRUMENT_LABELS[color];
    copy.append(label, detail);
    item.append(swatch, copy);
    key.append(item);
  }
}

function updateSequenceSnapshot() {
  sequenceSnapshot = currentPlaybackFrames();
  if (stageStepCells.length !== sequenceSnapshot.length) {
    createTransportDom(sequenceSnapshot.length);
  }
}

function currentRotationDegrees() {
  return normalizeSlidingRotation(state.rotationTurns) * 90;
}

function renderBoard() {
  const board = $("puzzleBoard");
  const frame = $("puzzleFrame");
  if (!board || !frame) return;
  const dimensions = slidingPuzzleDimensions(state.puzzle);
  const screen = slidingPuzzleScreenDimensions(state.puzzle, state.rotationTurns);
  const legal = new Set(slidingPuzzleLegalTileIds(state.puzzle));
  const focusedTileId = Number(document.activeElement?.dataset?.tileId);
  const rovingTileId = legal.has(focusedTileId)
    ? focusedTileId
    : legal.values().next().value;
  const blankIndex = slidingPuzzleBlankIndex(state.puzzle);
  const blankBoardRow = Math.floor(blankIndex / dimensions.columns);
  const blankBoardColumn = blankIndex % dimensions.columns;
  const blankScreen = slidingPuzzleScreenCellForBoardCell(
    state.puzzle,
    blankBoardRow,
    blankBoardColumn,
    state.rotationTurns,
  );
  for (const element of [frame, $("boardSlots"), $("puzzleReader"), board]) {
    element?.style.setProperty("--board-rows", String(screen.rows));
    element?.style.setProperty("--board-columns", String(screen.columns));
  }
  frame.dataset.screenColumns = String(screen.columns);
  frame.style.setProperty("--board-aspect", `${screen.columns} / ${screen.rows}`);
  const stageHeight = $("stageWrap")?.clientHeight || globalThis.innerHeight;
  const reservedHeight = stageHeight < 400 ? 82 : 145;
  const boardMaxHeight = Math.min(500, Math.max(130, stageHeight - reservedHeight));
  frame.style.setProperty("--board-max-height", `${Math.round(boardMaxHeight)}px`);
  frame.style.setProperty(
    "--board-target-width",
    `${Math.round(boardMaxHeight * screen.columns / screen.rows)}px`,
  );
  board.style.setProperty("--board-turn", "0deg");
  board.classList.toggle("is-busy", state.busy);
  board.setAttribute("aria-busy", String(state.busy));
  frame.dataset.rotation = String(currentRotationDegrees());
  blankCellElement.style.setProperty("--tile-row", String(blankScreen.row));
  blankCellElement.style.setProperty("--tile-column", String(blankScreen.column));
  blankCellElement.setAttribute("aria-rowindex", String(blankScreen.row + 1));
  blankCellElement.setAttribute("aria-colindex", String(blankScreen.column + 1));
  blankCellElement.setAttribute(
    "aria-label",
    `Empty rest cell, screen row ${blankScreen.row + 1}, column ${blankScreen.column + 1}.`,
  );

  for (const [tileId, button] of tileButtons) {
    const index = state.puzzle.tiles.indexOf(tileId);
    const boardRow = Math.floor(index / dimensions.columns);
    const boardColumn = index % dimensions.columns;
    const screenCell = slidingPuzzleScreenCellForBoardCell(
      state.puzzle,
      boardRow,
      boardColumn,
      state.rotationTurns,
    );
    const canSlide = legal.has(tileId) && !state.busy;
    const slideLength = slidingPuzzleMoveTileIds(state.puzzle, tileId).length;
    const note = tileNoteName(tileId);
    button.style.setProperty("--tile-row", String(screenCell.row));
    button.style.setProperty("--tile-column", String(screenCell.column));
    button.classList.toggle("can-slide", canSlide);
    button.tabIndex = canSlide && tileId === rovingTileId ? 0 : -1;
    button.setAttribute("aria-disabled", String(!canSlide));
    button.setAttribute("aria-rowindex", String(screenCell.row + 1));
    button.setAttribute("aria-colindex", String(screenCell.column + 1));
    button.setAttribute(
      "aria-label",
      `Tile ${tileId}, ${slidingTileColor(tileId, dimensions.columns)}, ${note}, screen row ${screenCell.row + 1}, column ${screenCell.column + 1}. ${canSlide ? `Slides ${slideLength} ${slideLength === 1 ? "tile" : "tiles"} toward the empty cell.` : "Cannot slide now."}`,
    );
  }

  board.setAttribute("aria-rowcount", String(screen.rows));
  board.setAttribute("aria-colcount", String(screen.columns));
  board.setAttribute(
    "aria-label",
    `${dimensions.rows} by ${dimensions.columns} sliding note puzzle with ${dimensions.cellCount - 1} tiles and one empty cell, viewed as ${screen.rows} screen rows by ${screen.columns} screen columns, ${isSlidingPuzzleSolved(state.puzzle) ? "solved" : "mixed"}, rotated ${currentRotationDegrees()} degrees.`,
  );
}

function renderSequence() {
  updateSequenceSnapshot();
  sequenceSnapshot.forEach((frame, index) => {
    const firstSound = frame.events.find((event) => !event.isRest);
    const color = COLOR_HEX[firstSound?.color] ?? COLOR_HEX.rest;
    for (const cell of [stageStepCells[index], clockStepCells[index]]) {
      if (!cell) continue;
      cell.style.setProperty("--step-color", color);
      cell.classList.toggle("is-rest", frame.isRest);
      cell.classList.toggle("has-rest", frame.restCount > 0);
      cell.classList.toggle("has-dense-lanes", frame.events.length >= 7);
      const pips = document.createElement("span");
      pips.className = "sliding-step-pips";
      for (const event of frame.events) {
        const pip = document.createElement("i");
        pip.className = event.isRest ? "is-rest" : "";
        pip.style.setProperty("--pip-color", COLOR_HEX[event.color] ?? COLOR_HEX.rest);
        pips.append(pip);
      }
      cell.replaceChildren(pips);
      cell.title = frame.playbackMode === "parallel"
        ? `Step ${index + 1}: ${countLabel(frame.soundingCount, "note")}${frame.restCount ? `, ${countLabel(frame.restCount, "rest")}` : ""}`
        : frame.isRest
          ? `Step ${index + 1}: rest`
          : `Step ${index + 1}: tile ${firstSound.tileId}, ${firstSound.color}, ${tileNoteName(firstSound.tileId)}`;
    }
  });
  updatePlayhead(state.currentStep, { preserveState: true });
}

function renderReadouts() {
  const dimensions = slidingPuzzleDimensions(state.puzzle);
  const screen = slidingPuzzleScreenDimensions(state.puzzle, state.rotationTurns);
  const metrics = slidingPuzzleMetrics(state.puzzle);
  const blank = slidingPuzzleBlankIndex(state.puzzle);
  const blankRow = Math.floor(blank / dimensions.columns) + 1;
  const blankColumn = blank % dimensions.columns + 1;
  const rotation = currentRotationDegrees();
  const bank = SOUND_BANKS[state.soundBank];
  const scale = scaleFor(state.scale);
  const path = SLIDING_READ_PATHS[state.pathId];
  const mode = SLIDING_PLAYBACK_MODES[state.playbackMode];
  const frameCount = sequenceSnapshot.length;
  const noteCount = dimensions.cellCount - 1;
  const stateLabel = metrics.solved ? "Solved" : "Mixed";
  const autoLabel = state.autoSlide ? "auto" : state.busy ? "moving" : "manual";

  $("puzzleState").textContent = `${stateLabel} · ${dimensions.rows} × ${dimensions.columns} · ${noteCount} notes / one rest`;
  const topology = state.playbackMode === "parallel"
    ? `${screen.rows} lines × ${frameCount} steps`
    : `${frameCount} steps`;
  $("sequenceState").textContent = `${mode.label} · ${topology} · ${rotation}° · ${bank.label}`;
  $("moveSummary").textContent = `${stateLabel.toLowerCase()} · ${state.history.length} moves`;
  $("blankCell").textContent = `board row ${blankRow} · column ${blankColumn}`;
  $("disorderState").textContent = `${metrics.manhattan} steps from home`;
  $("historyState").textContent = state.history.length
    ? `${state.history.length} reversible · ${autoLabel}`
    : `ready · ${autoLabel}`;
  $("rotationOut").textContent = `${rotation}°`;
  $("orientationLabel").textContent = `${rotation}°`;
  $("orientationLabel").previousElementSibling.style.transform = `rotate(${rotation}deg)`;
  $("readPathState").textContent = state.playbackMode === "parallel"
    ? `${path.label} saved · available in One tile mode`
    : `${path.label.toLowerCase()} · ${path.detail}`;
  $("clockSummary").textContent = `${Math.round(state.tempo)} BPM · 1/${state.pulseDivision} · ${state.swing > 0.005 ? `${Math.round(state.swing * 100)}% swing` : "straight"}`;
  $("soundSummary").textContent = `${bank.label} · ${scale.label}`;
  $("soundBankState").textContent = bank.label;
  $("scaleState").textContent = scale.label;
  $("soundDescription").textContent = bank.description;
  $("scoreSummary").textContent = `${noteCount} sounding · 1 rest · ${frameCount} steps`;
  $("dimensionOut").textContent = `${dimensions.rows} × ${dimensions.columns} · ${noteCount} tiles`;
  $("rowsOut").textContent = String(dimensions.rows);
  $("columnsOut").textContent = String(dimensions.columns);
  $("scramblePuzzle").textContent = `Scramble ${scrambleMoveCount()}`;
  $("solvePuzzle").disabled = state.busy || state.history.length === 0;
  $("undoMove").disabled = state.busy || state.history.length === 0;
  $("scramblePuzzle").disabled = state.busy;
  $("resetPuzzle").disabled = state.busy;
  $("autoSlide").disabled = state.busy;
  $("rows").disabled = state.busy;
  $("columns").disabled = state.busy;
  $("squareLock").disabled = state.busy;
  $("stageReadout").textContent = `${stateLabel.toUpperCase()} · ${dimensions.rows}×${dimensions.columns} · ${mode.label.toUpperCase()} · STEP ${String(state.currentStep + 1).padStart(2, "0")}/${String(frameCount).padStart(2, "0")} · AUDIO ${state.audioOn ? "ON" : "OFF"}`;
  $("stageScoreLabel").textContent = `${noteCount} NOTES + ONE REST`;
}

function renderControls() {
  $("tempo").value = String(state.tempo);
  $("tempoOut").textContent = `${Math.round(state.tempo)} BPM`;
  $("swing").value = String(state.swing);
  $("swingOut").textContent = `${Math.round(state.swing * 100)}%`;
  $("pulseDivision").value = String(state.pulseDivision);
  $("playbackDirection").value = state.playbackDirection;
  $("soundBank").value = state.soundBank;
  $("scale").value = state.scale;
  $("brightness").value = String(state.brightness);
  $("brightnessOut").textContent = `${Math.round(state.brightness * 100)}%`;
  $("decay").value = String(state.decay);
  $("decayOut").textContent = `${Math.round(state.decay * 100)}%`;
  $("colorDepth").value = String(state.colorDepth);
  $("colorDepthOut").textContent = `${Math.round(state.colorDepth * 100)}%`;
  $("stereoWidth").value = String(state.stereoWidth);
  $("stereoWidthOut").textContent = `${Math.round(state.stereoWidth * 100)}%`;
  $("pitchSpan").value = String(state.pitchSpan);
  $("pitchSpanOut").textContent = `${Math.round(state.pitchSpan)} st`;
  $("positionInfluence").value = String(state.positionInfluence);
  $("filterInfluence").value = String(state.filterInfluence);
  $("neighborResponse").value = String(state.neighborResponse);
  $("disorderInfluence").value = String(state.disorderInfluence);
  for (const id of ["positionInfluence", "filterInfluence", "neighborResponse", "disorderInfluence"]) {
    $(`${id}Out`).textContent = `${Math.round(state[id] * 100)}%`;
  }
  $("microStrum").value = String(state.microStrum);
  $("microStrumOut").textContent = `${Math.round(state.microStrum * 1000)} ms`;
  $("microStrum").disabled = state.playbackMode !== "parallel";
  $("microStrum").closest(".control")?.classList.toggle(
    "is-disabled",
    state.playbackMode !== "parallel",
  );
  $("output").value = String(state.output);
  $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
  $("autoSlideSpeed").value = String(state.autoSlideSpeed);
  updateAutoSlideSpeedUi();
  const dimensions = slidingPuzzleDimensions(state.puzzle);
  $("rows").value = String(dimensions.rows);
  $("columns").value = String(dimensions.columns);
  $("squareLock").setAttribute("aria-pressed", String(state.squareLock));
  $("squareLockState").textContent = state.squareLock ? "on" : "off";
  for (const button of document.querySelectorAll("[data-playback-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.playbackMode === state.playbackMode));
  }
  for (const button of document.querySelectorAll("[data-read-path]")) {
    button.setAttribute("aria-pressed", String(button.dataset.readPath === state.pathId));
    button.disabled = state.playbackMode === "parallel";
  }
}

function renderAll() {
  renderBoard();
  renderSequence();
  renderReadouts();
}

function updatePlayhead(step, options = {}) {
  if (!sequenceSnapshot.length) return;
  const safeStep = ((Math.round(Number(step) || 0) % sequenceSnapshot.length) + sequenceSnapshot.length)
    % sequenceSnapshot.length;
  const frame = sequenceSnapshot[safeStep];
  if (!options.preserveState) state.currentStep = safeStep;
  const currentCells = new Set(frame.events.map((event) => event.screenIndex));
  const restCells = new Set(
    frame.events.filter((event) => event.isRest).map((event) => event.screenIndex),
  );
  readerCells.forEach((cell, index) => {
    const current = currentCells.has(index);
    cell.classList.toggle("is-current", current);
    cell.classList.toggle("is-rest", current && restCells.has(index));
  });
  stageStepCells.forEach((cell, index) => cell.classList.toggle("is-current", index === safeStep));
  clockStepCells.forEach((cell, index) => cell.classList.toggle("is-current", index === safeStep));
  const soundingTileIds = new Set(
    frame.events.filter((event) => !event.isRest).map((event) => event.tileId),
  );
  for (const [tileId, button] of tileButtons) {
    button.classList.toggle("is-sounding", soundingTileIds.has(tileId));
  }
  const event = frame.events[0];
  const soundingLabel = countLabel(frame.soundingCount, "NOTE", "NOTES");
  const restLabel = countLabel(frame.restCount, "REST", "RESTS");
  $("nowPlaying").textContent = frame.playbackMode === "parallel"
    ? `STEP ${String(safeStep + 1).padStart(2, "0")} / ${String(sequenceSnapshot.length).padStart(2, "0")} · ${soundingLabel}${frame.restCount ? ` · ${restLabel}` : ""}`
    : event.isRest
      ? `STEP ${String(safeStep + 1).padStart(2, "0")} · REST · EMPTY CELL`
      : `STEP ${String(safeStep + 1).padStart(2, "0")} · TILE ${String(event.tileId).padStart(2, "0")} · ${event.color.toUpperCase()} · ${tileNoteName(event.tileId)}`;
  const dimensions = slidingPuzzleDimensions(state.puzzle);
  $("stageReadout").textContent = `${isSlidingPuzzleSolved(state.puzzle) ? "SOLVED" : "MIXED"} · ${dimensions.rows}×${dimensions.columns} · ${SLIDING_PLAYBACK_MODES[state.playbackMode].label.toUpperCase()} · STEP ${String(safeStep + 1).padStart(2, "0")}/${String(sequenceSnapshot.length).padStart(2, "0")} · AUDIO ${state.audioOn ? "ON" : "OFF"}`;
}

function flashInvalidMove() {
  const board = $("puzzleBoard");
  board.classList.remove("is-invalid");
  requestAnimationFrame(() => board.classList.add("is-invalid"));
  if (invalidPulseTimer !== null) clearTimeout(invalidPulseTimer);
  invalidPulseTimer = setTimeout(() => {
    board.classList.remove("is-invalid");
    invalidPulseTimer = null;
  }, 210);
}

function auditionTile(tileId) {
  if (!state.audioOn || !audio.context || tileId <= 0) return;
  const event = currentSequence().find((candidate) => candidate.tileId === tileId);
  if (!event) return;
  audio.schedule(
    event,
    audio.context.currentTime + 0.008,
    0.16,
    settingsSnapshot(),
    { audition: true, level: 0.52 },
  );
}

function commitTileMove(tileId, options = {}) {
  const movedTileIds = slidingPuzzleMoveTileIds(state.puzzle, tileId);
  const next = slidePuzzleTile(state.puzzle, tileId);
  if (next === state.puzzle) {
    if (options.feedback !== false) flashInvalidMove();
    return false;
  }
  state.puzzle = next;
  if (options.record !== false) {
    state.history = appendSlidingMoveHistory(state.history, tileId, movedTileIds[0]);
  }
  updateSequenceSnapshot();
  renderAll();
  if (options.audition !== false) auditionTile(tileId);
  if (options.announce === true) {
    const count = movedTileIds.length;
    announce(`${count} ${count === 1 ? "tile" : "tiles"} slid toward the empty cell. ${state.history.length} reversible moves.`);
  }
  return true;
}

function requestTileMove(tileId) {
  if (state.busy) return;
  commitTileMove(tileId, { announce: true });
}

function cancelMotionSequence() {
  motionGeneration += 1;
  if (motionTimer !== null) clearTimeout(motionTimer);
  motionTimer = null;
  state.busy = false;
}

function runMotionSequence(moves, options = {}) {
  cancelMotionSequence();
  const queue = [...moves];
  if (!queue.length) {
    options.onComplete?.();
    return;
  }
  const generation = motionGeneration;
  state.busy = true;
  renderBoard();
  renderReadouts();
  let index = 0;
  const advance = () => {
    if (generation !== motionGeneration) return;
    const tileId = queue[index];
    commitTileMove(tileId, {
      announce: false,
      audition: options.audition !== false,
      record: options.record !== false,
    });
    index += 1;
    if (index < queue.length) {
      motionTimer = setTimeout(advance, options.delayMs ?? SCRAMBLE_DELAY_MS);
      return;
    }
    motionTimer = null;
    state.busy = false;
    renderAll();
    options.onComplete?.();
  };
  advance();
}

function setAutoSlide(active, options = {}) {
  state.autoSlide = Boolean(active) && !state.busy;
  if (!state.autoSlide && autoSlideTimer !== null) {
    clearTimeout(autoSlideTimer);
    autoSlideTimer = null;
  }
  $("autoSlide").setAttribute("aria-pressed", String(state.autoSlide));
  $("autoSlideState").textContent = state.autoSlide ? "running" : "off";
  if (state.autoSlide) scheduleAutoSlide();
  renderReadouts();
  if (options.announce !== false) {
    announce(`Auto slide ${state.autoSlide ? "started" : "stopped"}.`);
  }
}

function scheduleAutoSlide() {
  if (!state.autoSlide || state.busy) return;
  if (autoSlideTimer !== null) clearTimeout(autoSlideTimer);
  autoSlideTimer = setTimeout(() => {
    autoSlideTimer = null;
    if (!state.autoSlide || state.busy) return;
    const legal = slidingPuzzleLegalTileIds(state.puzzle);
    const candidates = legal.length > 1
      ? legal.filter((tileId) => tileId !== previousAutoTile)
      : [...legal];
    const tileId = candidates[Math.floor(Math.random() * candidates.length)];
    previousAutoTile = slidingPuzzleMoveTileIds(state.puzzle, tileId)[0] ?? tileId;
    commitTileMove(tileId, { announce: false });
    scheduleAutoSlide();
  }, rubixTwistIntervalMs(state.autoSlideSpeed));
}

function scrambleMoveCount() {
  const { cellCount } = slidingPuzzleDimensions(state.puzzle);
  return Math.max(18, Math.min(64, cellCount * 3));
}

function updateAutoSlideSpeedUi() {
  const multiplier = rubixTwistSpeedMultiplier(state.autoSlideSpeed);
  const label = multiplier < 1
    ? `${multiplier.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`
    : `${multiplier.toFixed(multiplier < 10 ? 1 : 0).replace(/\.0$/, "")}×`;
  $("autoSlideSpeedOut").textContent = label;
  $("autoSlideSpeed").setAttribute("aria-valuetext", `${label} normal slide speed`);
}

function scramblePuzzle() {
  if (state.busy) return;
  setAutoSlide(false, { announce: false });
  const moveCount = scrambleMoveCount();
  const scramble = createSlidingPuzzleScramble(state.puzzle, { moves: moveCount });
  runMotionSequence(scramble.moves, {
    delayMs: SCRAMBLE_DELAY_MS,
    onComplete: () => announce(`Scramble complete. ${state.history.length} moves can be unwound.`),
  });
  announce(`Scrambling with ${scramble.moves.length} legal slides.`);
}

function solvePuzzle() {
  if (state.busy || state.history.length === 0) return;
  setAutoSlide(false, { announce: false });
  const moves = invertSlidingMoves(state.history);
  runMotionSequence(moves, {
    delayMs: SOLVE_DELAY_MS,
    onComplete: () => announce("Puzzle solved. Sound, clock, and board orientation were preserved."),
  });
  announce(`Solving by unwinding ${moves.length} legal moves.`);
}

function undoMove() {
  if (state.busy || state.history.length === 0) return;
  const tileId = state.history.at(-1);
  if (commitTileMove(tileId, { announce: false })) {
    announce(`Undid tile ${tileId}. ${state.history.length} reversible moves remain.`);
  }
}

function resetPuzzle() {
  setAutoSlide(false, { announce: false });
  cancelMotionSequence();
  const { rows, columns } = slidingPuzzleDimensions(state.puzzle);
  state.puzzle = createSolvedSlidingPuzzle(rows, columns);
  state.history = Object.freeze([]);
  previousAutoTile = null;
  renderAll();
  if (state.playing) resyncRunningScheduler();
  announce("Puzzle reset to its solved arrangement. Orientation and sound were preserved.");
}

function setPuzzleDimensions(rows, columns) {
  const nextRows = Math.round(clamp(rows, 2, 8));
  const nextColumns = Math.round(clamp(columns, 2, 8));
  const current = slidingPuzzleDimensions(state.puzzle);
  if (current.rows === nextRows && current.columns === nextColumns) return;
  setAutoSlide(false, { announce: false });
  cancelMotionSequence();
  state.puzzle = createSolvedSlidingPuzzle(nextRows, nextColumns);
  state.history = Object.freeze([]);
  createBoardDom();
  updateSequenceSnapshot();
  const firstStep = state.playbackDirection === "reverse"
    ? Math.max(0, sequenceSnapshot.length - 1)
    : 0;
  state.currentStep = firstStep;
  transportStep = firstStep;
  transportDirection = state.playbackDirection === "reverse" ? -1 : 1;
  transportPulse = 0;
  randomTransportOrder = [];
  randomTransportIndex = 0;
  committedTransportDirection = transportDirection;
  committedTransportPulse = -1;
  transportHasCommitted = false;
  previousAutoTile = null;
  renderControls();
  renderAll();
  if (state.playing) setPlaying(true, { restart: true, announce: false });
  announce(`Puzzle resized to ${nextRows} rows by ${nextColumns} columns. The solved board and playhead were rebuilt; sound and orientation were preserved.`);
}

function applyDimensionControl(changedAxis) {
  let rows = Math.round(clamp($("rows").value, 2, 8));
  let columns = Math.round(clamp($("columns").value, 2, 8));
  if (state.squareLock) {
    if (changedAxis === "rows") columns = rows;
    else rows = columns;
  }
  setPuzzleDimensions(rows, columns);
}

function rotateBoard(direction) {
  state.rotationTurns += direction < 0 ? -1 : 1;
  updateSequenceSnapshot();
  transportStep %= Math.max(1, sequenceSnapshot.length);
  state.currentStep %= Math.max(1, sequenceSnapshot.length);
  renderAll();
  if (state.playing) resyncRunningScheduler();
  else reconcileTransportCursor();
  const degrees = currentRotationDegrees();
  const screen = slidingPuzzleScreenDimensions(state.puzzle, state.rotationTurns);
  announce(`Board rotated ${direction < 0 ? "left" : "right"} to ${degrees} degrees. Playback is now ${sequenceSnapshot.length} steps across ${screen.rows} lines without restarting the clock.`);
}

function handleBoardKeydown(event) {
  if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) return;
  event.preventDefault();
  if (state.busy) return;
  const blankIndex = slidingPuzzleBlankIndex(state.puzzle);
  const screenOrder = slidingPuzzleReadOrder(state.puzzle, state.rotationTurns, "rows");
  const blankScreen = screenOrder.find((cell) => cell.boardIndex === blankIndex);
  const deltas = {
    ArrowUp: [-1, 0],
    ArrowRight: [0, 1],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
  };
  const [rowDelta, columnDelta] = deltas[event.key];
  const targetRow = blankScreen.screenRow + rowDelta;
  const targetColumn = blankScreen.screenColumn + columnDelta;
  const target = screenOrder.find((cell) => (
    cell.screenRow === targetRow && cell.screenColumn === targetColumn
  ));
  if (!target) {
    flashInvalidMove();
    return;
  }
  const tileId = state.puzzle.tiles[target.boardIndex];
  if (commitTileMove(tileId, { announce: true })) {
    const movedTile = tileButtons.get(tileId);
    for (const button of tileButtons.values()) button.tabIndex = button === movedTile ? 0 : -1;
    movedTile?.focus({ preventScroll: true });
  }
}

function schedulerNow() {
  return state.audioOn && audio.context
    ? audio.context.currentTime
    : performance.now() / 1000;
}

function resyncRunningScheduler() {
  if (!state.playing) return;
  reconcileTransportCursor();
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  clearVisualTimers();
  audio.resetTransportBus(state.audioOn);
  nextStepTime = schedulerNow() + 0.045;
  schedulerTick();
}

function stepDurationSeconds(step) {
  const base = 60 / clamp(state.tempo, 36, 260) * (4 / clamp(state.pulseDivision, 4, 64));
  const swing = clamp(state.swing, 0, 0.42);
  return base * (step % 2 === 0 ? 1 + swing : 1 - swing);
}

function rebuildRandomTransportOrder(length) {
  randomTransportOrder = Array.from({ length }, (_, index) => index);
  for (let index = randomTransportOrder.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [randomTransportOrder[index], randomTransportOrder[swapIndex]] = [
      randomTransportOrder[swapIndex],
      randomTransportOrder[index],
    ];
  }
  randomTransportIndex = 0;
}

function randomStepForSchedule(length) {
  if (randomTransportOrder.length !== length || randomTransportIndex >= length) {
    rebuildRandomTransportOrder(length);
  }
  const step = randomTransportOrder[randomTransportIndex];
  randomTransportIndex += 1;
  return step;
}

function advanceTransportStep(length) {
  if (length <= 1) {
    transportStep = 0;
    return;
  }
  if (state.playbackDirection === "reverse") {
    transportStep = (transportStep - 1 + length) % length;
    return;
  }
  if (state.playbackDirection === "pendulum") {
    let next = transportStep + transportDirection;
    if (next >= length) {
      transportDirection = -1;
      next = length - 2;
    } else if (next < 0) {
      transportDirection = 1;
      next = 1;
    }
    transportStep = next;
    return;
  }
  transportStep = (transportStep + 1) % length;
}

function reconcileTransportCursor() {
  const length = Math.max(1, sequenceSnapshot.length);
  transportStep = ((state.currentStep % length) + length) % length;
  randomTransportOrder = [];
  randomTransportIndex = 0;
  if (!transportHasCommitted) {
    transportDirection = state.playbackDirection === "reverse" ? -1 : 1;
    transportPulse = 0;
    return;
  }
  transportPulse = committedTransportPulse + 1;
  if (state.playbackDirection === "random") return;
  transportDirection = state.playbackDirection === "pendulum"
    ? committedTransportDirection
    : state.playbackDirection === "reverse" ? -1 : 1;
  advanceTransportStep(length);
}

function clearVisualTimers() {
  for (const timer of visualTimers) clearTimeout(timer);
  visualTimers = new Set();
}

function scheduleVisualStep(step, when, scheduledDirection, scheduledPulse) {
  const delay = Math.max(0, (when - schedulerNow()) * 1000);
  const timer = setTimeout(() => {
    visualTimers.delete(timer);
    if (state.playing) {
      updatePlayhead(step);
      committedTransportDirection = scheduledDirection;
      committedTransportPulse = scheduledPulse;
      transportHasCommitted = true;
    }
  }, delay);
  visualTimers.add(timer);
}

function schedulerTick() {
  if (!state.playing) return;
  const now = schedulerNow();
  if (nextStepTime < now - LOOKAHEAD_SECONDS) {
    nextStepTime = now + 0.045;
  }
  const horizon = now + LOOKAHEAD_SECONDS;
  const frames = sequenceSnapshot;
  const settings = state.audioOn ? settingsSnapshot() : null;
  let scheduled = 0;
  while (nextStepTime < horizon && scheduled < 32) {
    const step = state.playbackDirection === "random"
      ? randomStepForSchedule(frames.length)
      : ((transportStep % frames.length) + frames.length) % frames.length;
    const frame = frames[step];
    const duration = stepDurationSeconds(transportPulse);
    const soundingEvents = frame.events.filter((event) => !event.isRest);
    if (state.audioOn && soundingEvents.length) {
      const parallelLevel = 1 / Math.sqrt(soundingEvents.length);
      const bankTrim = state.soundBank === "acid-303" && soundingEvents.length > 1 ? 0.86 : 1;
      const strumSpread = frame.playbackMode === "parallel"
        ? Math.min(state.microStrum, duration * 0.8)
        : 0;
      const lastLane = Math.max(1, frame.events.length - 1);
      frame.events.forEach((event) => {
        if (event.isRest) return;
        const strum = strumSpread * event.screenRow / lastLane;
        audio.schedule(event, nextStepTime + strum, duration, settings, {
          level: parallelLevel * bankTrim,
        });
      });
    }
    scheduleVisualStep(step, nextStepTime, transportDirection, transportPulse);
    nextStepTime += duration;
    if (state.playbackDirection !== "random") advanceTransportStep(frames.length);
    transportPulse += 1;
    scheduled += 1;
  }
  schedulerTimer = setTimeout(schedulerTick, SCHEDULER_INTERVAL_MS);
}

function setPlaying(active, options = {}) {
  const next = Boolean(active);
  if (state.playing === next && options.restart !== true) return;
  if (state.playing && !next && options.restart !== true) reconcileTransportCursor();
  if (schedulerTimer !== null) clearTimeout(schedulerTimer);
  schedulerTimer = null;
  clearVisualTimers();
  state.playing = next;
  $("playButton").setAttribute("aria-pressed", String(next));
  $("playLabel").textContent = next ? "Pause puzzle" : "Play puzzle";
  $("playState").textContent = next
    ? "clock running"
    : `${sequenceSnapshot.length}-step ${state.playbackMode === "parallel" ? "line" : "tile"} loop`;
  if (next) {
    if (options.restart === true) {
      transportStep = state.playbackDirection === "reverse"
        ? Math.max(0, sequenceSnapshot.length - 1)
        : 0;
      transportDirection = state.playbackDirection === "reverse" ? -1 : 1;
      transportPulse = 0;
      randomTransportOrder = [];
      randomTransportIndex = 0;
      committedTransportDirection = transportDirection;
      committedTransportPulse = -1;
      transportHasCommitted = false;
    }
    audio.resetTransportBus(state.audioOn);
    nextStepTime = schedulerNow() + 0.045;
    schedulerTick();
  } else {
    audio.resetTransportBus(false);
  }
  if (options.announce !== false) {
    const audioDetail = state.audioOn ? "audio on" : "audio off, visual clock only";
    announce(`${next ? "Puzzle playback started" : "Puzzle playback paused"}; ${audioDetail}.`);
  }
}

function restartLoop(options = {}) {
  const firstStep = state.playbackDirection === "reverse"
    ? Math.max(0, sequenceSnapshot.length - 1)
    : 0;
  transportStep = firstStep;
  transportDirection = state.playbackDirection === "reverse" ? -1 : 1;
  transportPulse = 0;
  randomTransportOrder = [];
  randomTransportIndex = 0;
  committedTransportDirection = transportDirection;
  committedTransportPulse = -1;
  transportHasCommitted = false;
  state.currentStep = firstStep;
  updatePlayhead(firstStep);
  if (state.playing) setPlaying(true, { restart: true, announce: false });
  if (options.announce !== false) announce("Sliding puzzle playhead returned to its first step.");
}

async function setAudioOn(active) {
  const generation = ++audioLifecycleGeneration;
  const button = $("audioButton");
  const error = $("audioError");
  error.hidden = true;
  if (!active) {
    state.audioOn = false;
    button.setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    audio.setTransportActive(false);
    renderReadouts();
    resyncRunningScheduler();
    await audio.close();
    if (generation !== audioLifecycleGeneration) return;
    announce("Audio off. The visual clock and puzzle remain available.");
    return;
  }

  button.disabled = true;
  $("audioState").textContent = "starting";
  try {
    await audio.start(settingsSnapshot());
    if (generation !== audioLifecycleGeneration) return;
    state.audioOn = true;
    button.setAttribute("aria-pressed", "true");
    $("audioState").textContent = "on";
    renderReadouts();
    resyncRunningScheduler();
    announce(`Audio on. ${state.playing ? "The running puzzle is now audible." : "Press Play puzzle or slide a tile."}`);
  } catch (caught) {
    if (generation !== audioLifecycleGeneration) return;
    const isAbortError = caught?.name === "AbortError";
    state.audioOn = false;
    button.setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    if (!isAbortError) {
      error.textContent = caught?.message ?? "Could not start audio.";
      error.hidden = false;
    }
    try {
      await audio.close();
    } catch {
      // The original startup error is the useful one to report.
    }
    resyncRunningScheduler();
  } finally {
    if (generation === audioLifecycleGeneration) button.disabled = false;
  }
}

function resetSound() {
  Object.assign(state, DEFAULTS);
  audio.setOutput(state.output);
  updateSequenceSnapshot();
  transportStep = 0;
  transportDirection = 1;
  transportPulse = 0;
  randomTransportOrder = [];
  randomTransportIndex = 0;
  committedTransportDirection = transportDirection;
  committedTransportPulse = -1;
  transportHasCommitted = false;
  state.currentStep = 0;
  if (state.autoSlide) scheduleAutoSlide();
  renderControls();
  renderAll();
  setPlaying(state.playing, { restart: true, announce: false });
  announce("Sliding puzzle sound and clock settings reset. Puzzle arrangement was preserved.");
}

function bindControls() {
  $("audioButton").addEventListener("click", () => setAudioOn(!state.audioOn));
  $("playButton").addEventListener("click", () => setPlaying(!state.playing));
  $("restartLoop").addEventListener("click", restartLoop);
  $("scramblePuzzle").addEventListener("click", scramblePuzzle);
  $("solvePuzzle").addEventListener("click", solvePuzzle);
  $("undoMove").addEventListener("click", undoMove);
  $("resetPuzzle").addEventListener("click", resetPuzzle);
  $("rotateLeft").addEventListener("click", () => rotateBoard(-1));
  $("rotateLeftStage").addEventListener("click", () => rotateBoard(-1));
  $("rotateRight").addEventListener("click", () => rotateBoard(1));
  $("rotateRightStage").addEventListener("click", () => rotateBoard(1));
  $("autoSlide").addEventListener("click", () => setAutoSlide(!state.autoSlide));
  $("resetSound").addEventListener("click", resetSound);
  $("squareLock").addEventListener("click", () => {
    state.squareLock = !state.squareLock;
    renderControls();
    announce(`Square lock ${state.squareLock ? "on" : "off"}. ${state.squareLock ? "Changing either dimension now changes both." : "Rows and columns can now differ."}`);
  });

  for (const axis of ["rows", "columns"]) {
    $(axis).addEventListener("input", (event) => {
      const value = Math.round(clamp(event.target.value, 2, 8));
      $(`${axis}Out`).textContent = String(value);
      if (state.squareLock) {
        const pairedAxis = axis === "rows" ? "columns" : "rows";
        $(pairedAxis).value = String(value);
        $(`${pairedAxis}Out`).textContent = String(value);
      }
      const previewRows = Math.round(clamp($("rows").value, 2, 8));
      const previewColumns = Math.round(clamp($("columns").value, 2, 8));
      $("dimensionOut").textContent = `${previewRows} × ${previewColumns} · ${previewRows * previewColumns - 1} tiles · loads on release`;
    });
    $(axis).addEventListener("change", () => applyDimensionControl(axis));
  }

  for (const button of document.querySelectorAll("[data-playback-mode]")) {
    button.addEventListener("click", () => {
      const mode = button.dataset.playbackMode;
      if (!Object.hasOwn(SLIDING_PLAYBACK_MODES, mode) || mode === state.playbackMode) return;
      state.playbackMode = mode;
      updateSequenceSnapshot();
      transportStep %= Math.max(1, sequenceSnapshot.length);
      state.currentStep %= Math.max(1, sequenceSnapshot.length);
      randomTransportOrder = [];
      renderControls();
      renderAll();
      if (state.playing) resyncRunningScheduler();
      else reconcileTransportCursor();
      announce(`${SLIDING_PLAYBACK_MODES[mode].label} selected: ${sequenceSnapshot.length} steps. The running clock phase was preserved.`);
    });
  }

  for (const button of document.querySelectorAll("[data-read-path]")) {
    button.addEventListener("click", () => {
      const pathId = button.dataset.readPath;
      if (!Object.hasOwn(SLIDING_READ_PATHS, pathId)) return;
      state.pathId = pathId;
      renderControls();
      renderAll();
      if (state.playing) resyncRunningScheduler();
      else reconcileTransportCursor();
      announce(`${SLIDING_READ_PATHS[pathId].label} read path selected. The clock phase was preserved.`);
    });
  }

  $("tempo").addEventListener("input", (event) => {
    state.tempo = clamp(event.target.value, 36, 260);
    $("tempoOut").textContent = `${Math.round(state.tempo)} BPM`;
    renderReadouts();
  });
  $("swing").addEventListener("input", (event) => {
    state.swing = clamp(event.target.value, 0, 0.42);
    $("swingOut").textContent = `${Math.round(state.swing * 100)}%`;
    renderReadouts();
  });
  $("pulseDivision").addEventListener("change", (event) => {
    state.pulseDivision = [4, 8, 16, 32, 64].includes(Number(event.target.value))
      ? Number(event.target.value)
      : DEFAULTS.pulseDivision;
    renderReadouts();
    announce(`Pulse rate set to one ${state.pulseDivision}th note.`);
  });
  $("playbackDirection").addEventListener("change", (event) => {
    state.playbackDirection = ["forward", "reverse", "pendulum", "random"].includes(event.target.value)
      ? event.target.value
      : DEFAULTS.playbackDirection;
    restartLoop({ announce: false });
    announce(`${state.playbackDirection} playback direction selected; the loop restarted at its new first step.`);
  });
  $("soundBank").addEventListener("change", (event) => {
    state.soundBank = Object.hasOwn(SOUND_BANKS, event.target.value)
      ? event.target.value
      : DEFAULTS.soundBank;
    renderAll();
    announce(`${SOUND_BANKS[state.soundBank].label} selected.`);
  });
  $("scale").addEventListener("change", (event) => {
    state.scale = Object.hasOwn(SCALES, event.target.value) ? event.target.value : DEFAULTS.scale;
    renderAll();
    announce(`${scaleFor(state.scale).label} tile tuning selected.`);
  });

  for (const [id, minimum, maximum] of [
    ["brightness", 0, 1],
    ["decay", 0.08, 0.9],
    ["colorDepth", 0, 1],
    ["stereoWidth", 0, 1],
    ["positionInfluence", 0, 2],
    ["filterInfluence", 0, 2],
    ["neighborResponse", 0, 2],
    ["disorderInfluence", 0, 2],
  ]) {
    $(id).addEventListener("input", (event) => {
      state[id] = clamp(event.target.value, minimum, maximum);
      $(`${id}Out`).textContent = `${Math.round(state[id] * 100)}%`;
      if (id === "colorDepth") renderAll();
    });
  }

  $("pitchSpan").addEventListener("input", (event) => {
    state.pitchSpan = clamp(event.target.value, 12, 48);
    $("pitchSpanOut").textContent = `${Math.round(state.pitchSpan)} st`;
    renderAll();
  });
  $("microStrum").addEventListener("input", (event) => {
    state.microStrum = clamp(event.target.value, 0, 0.04);
    $("microStrumOut").textContent = `${Math.round(state.microStrum * 1000)} ms`;
  });

  $("output").addEventListener("input", (event) => {
    state.output = clamp(event.target.value, 0, 0.9);
    $("outputOut").textContent = `${Math.round(state.output * 100)}%`;
    audio.setOutput(state.output);
  });
  $("autoSlideSpeed").addEventListener("input", (event) => {
    state.autoSlideSpeed = clamp(event.target.value, 0, 100);
    updateAutoSlideSpeedUi();
    if (state.autoSlide) scheduleAutoSlide();
  });

  globalThis.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || event.defaultPrevented || event.repeat) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, input, select, textarea, [contenteditable]")) {
      return;
    }
    event.preventDefault();
    setPlaying(!state.playing);
  });

  globalThis.addEventListener("pagehide", cleanup);
  globalThis.addEventListener("resize", renderBoard);
}

function cleanup() {
  globalThis.removeEventListener("resize", renderBoard);
  setAutoSlide(false, { announce: false });
  cancelMotionSequence();
  setPlaying(false, { announce: false });
  audioLifecycleGeneration += 1;
  audio.close();
}

createBoardDom();
createColorKey();
bindControls();
renderControls();
renderAll();

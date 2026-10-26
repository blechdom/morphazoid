import { clampEye, eyeClusterLayout, eyeEnsemblePose, eyePose, eyePoseWithRetractor,
  eyeSoundTargets, normalizeOculoid, normalizeOculoidEnsemble, oculoidSonicWardrobe,
  oculoidLitPupil, OCULOID_DEFAULTS, OCULOID_CRY_TEMPO_RANGE, OCULOID_EYE_COUNTS, OCULOID_SURFACE_DEFAULTS,
  OCULOID_SURFACE_RANGES, TAU, TEAR_CYCLE_BEATS, TEAR_RELEASE_BEAT } from "./oculoid-model.js";

const lerp = (a, b, t) => a + (b - a) * t;
const eyeInterval = Object.freeze({
  banter: [1, 1.12, 1.27, 1.38, 0.84, 1.49, 1.08, 0.93, 1.61, 0.77, 1.32, 1.19],
  harmony: [1, 5 / 4, 3 / 2, 7 / 4, 7 / 6, 4 / 3, 11 / 8, 13 / 8,
    9 / 8, 8 / 5, 5 / 3, 16 / 9],
  rock: [1, 3 / 4, 3 / 2, 9 / 8, 11 / 10, 7 / 8, 13 / 10, 6 / 5,
    2 / 3, 8 / 5, 10 / 9, 5 / 4],
});

function hatSound(style, phase, secondary, grain) {
  switch (style) {
    case "top": return 0.095 * Math.sin(secondary * 2);
    case "cowboy": return 0.09 * Math.sin(phase * 3);
    case "frosting": return 0.075 * Math.sin(secondary * 1.5);
    case "cherry": return 0.085 * Math.sin(phase * 4);
    case "cat": return 0.055 * Math.sin(phase * 0.75) + grain * 0.035;
    default: return 0;
  }
}

/** Event-excited stereo eyes and an independent lid/tear rhythm: all voices
 * decay to silence. Hits follow the audio clock, not RAF or a step grid. */
export class OculoidDsp {
  constructor(sampleRate = 48000) {
    this.sampleRate = clampEye(sampleRate, 8000, 192000, 48000);
    this.config = normalizeOculoid(OCULOID_DEFAULTS);
    this.playing = false;
    this.anchorBeat = 0;
    this.anchorLidBeat = 0;
    this.anchorTime = 0;
    this.eyeCount = 1;
    this.ensembleStyle = "banter";
    this.wardrobe = oculoidSonicWardrobe();
    this.lidsVisible = true;
    // No nodes or oscillators are added when the count changes. Bounded
    // per-eye event voices are reused; one eye keeps the original sound path.
    this.eyeVoices = Array.from({ length: OCULOID_EYE_COUNTS.at(-1) }, () => ({
      phase: 0, secondary: 0, pitch: this.config.rootHz, pan: 0, gate: 0,
      target: 0, level: 0, gazeDistance: 0, pupilDistance: 0,
      lastGazeEvent: -Infinity, lastPupilEvent: -Infinity,
    }));
    this.lastEnsemblePoses = null;
    this.enabled = false;
    this.audible = 0;
    this.phase = 0;
    this.secondary = 0;
    this.impactPhase = 0;
    this.mouthPhase = 0;
    this.motionTarget = this.motionLevel = 0;
    this.lidTarget = this.lidLevel = 0;
    this.pokeEnvelope = this.pokeLevel = this.pokePressure = this.pokePhase = 0;
    this.pokeBend = this.pokePan = this.pokePanTarget = 0;
    this.pokeDiameter = OCULOID_SURFACE_DEFAULTS.pokeDiameter;
    this.pokeReleasing = false;
    this.surfaceEnvelope = this.surfaceLevel = this.surfacePhase = 0;
    this.surfaceStrength = this.surfacePan = 0;
    this.lastSurfaceEvent = -Infinity;
    this.tearMode = "off";
    this.tearAnchorTime = this.tearAnchorBeat = 0;
    this.tearTempo = OCULOID_DEFAULTS.tempo;
    this.lastTearCycle = -1;
    this.tearSize = this.config.wetness;
    this.tearEnvelope = this.tearLevel = this.tearPhase = 0;
    this.retracted = false;
    this.flashlightExposure = 0;
    this.lastPokeEvent = -Infinity;
    this.audioTime = 0;
    this.glide = 0;
    this.lastPose = null;
    this.skipMotion = true;
    this.gazeDistance = 0;
    this.pupilDistance = 0;
    this.manualLidDistance = 0;
    this.lastGazeEvent = this.lastLidEvent = this.lastPupilEvent = -Infinity;
    this.pitch = this.config.rootHz;
    this.pan = 0;
    this.gate = 0;
    this.noiseState = 0;
    this.seed = 0x129fc8ae;
    this.peak = 0;
    this.rms = 0;
  }

  setConfig(value) {
    const beat = this.beatAt(this.audioTime), lidBeat = this.lidBeatAt(this.audioTime);
    const next = { ...normalizeOculoid(value),
      midiHz: Number.isFinite(value?.midiHz) && value.midiHz > 0
        ? clampEye(value.midiHz, 25, 3000) : null };
    if (next.eyeballStyle !== this.config.eyeballStyle
      || next.eyelidStyle !== this.config.eyelidStyle) {
      this.skipMotion = true;
      this.gazeDistance = this.pupilDistance = this.manualLidDistance = 0;
      for (const voice of this.eyeVoices) voice.gazeDistance = voice.pupilDistance = 0;
    } else if (this.enabled && !this.retracted && this.lidsVisible) {
      this.manualLidDistance = Math.min(1, this.manualLidDistance
        + Math.abs(next.blink - this.config.blink)
        + Math.abs(next.lowerLid - this.config.lowerLid));
    }
    this.config = next;
    this.anchorBeat = beat;
    this.anchorLidBeat = lidBeat;
    this.anchorTime = this.audioTime;
  }

  setTransport({ playing = this.playing, beat = this.anchorBeat, lidBeat = beat,
    audioTime = this.anchorTime } = {}) {
    if (this.playing !== (playing === true)) {
      this.skipMotion = true;
      this.gazeDistance = this.pupilDistance = 0;
      for (const voice of this.eyeVoices) voice.gazeDistance = voice.pupilDistance = 0;
    }
    this.playing = playing === true;
    this.anchorBeat = clampEye(beat, 0, 1e9, this.anchorBeat);
    this.anchorLidBeat = clampEye(lidBeat, 0, 1e9, this.anchorLidBeat);
    this.anchorTime = clampEye(audioTime, 0, 1e9, this.anchorTime);
  }

  setEnsemble({ count = 1, style = "banter" } = {}) {
    const nextCount = OCULOID_EYE_COUNTS.includes(Number(count)) ? Number(count) : 1;
    const nextStyle = normalizeOculoidEnsemble(style);
    if (this.eyeCount !== nextCount || this.ensembleStyle !== nextStyle) {
      this.lastEnsemblePoses = null;
      this.skipMotion = true;
      this.gazeDistance = this.pupilDistance = 0;
      for (const voice of this.eyeVoices) {
        voice.gazeDistance = voice.pupilDistance = 0;
        voice.target = voice.level = 0;
      }
    }
    this.eyeCount = nextCount;
    this.ensembleStyle = nextStyle;
  }

  setWardrobe(value) { this.wardrobe = oculoidSonicWardrobe(value); }

  setLidsVisible(value) {
    this.lidsVisible = value === true;
    if (!this.lidsVisible) {
      this.lidTarget = this.lidLevel = 0;
      this.manualLidDistance = 0;
    }
  }

  /** A played MIDI note is an explicit glance strike, even when the same note
   * is repeated and its gaze/pitch targets have not changed. */
  excite(amount = 1) {
    if (!this.enabled) return;
    const level = clampEye(amount, 0, 1) * 0.85;
    if (this.eyeCount > 1 && this.ensembleStyle !== "together") {
      for (let index = 0; index < this.eyeCount; index++)
        this.eyeVoices[index].target = Math.max(this.eyeVoices[index].target, level);
    } else this.motionTarget = Math.max(this.motionTarget, level);
    this.glide = Math.max(this.glide, 0.38);
    this.gazeDistance = 0;
  }

  /** A poke is a pressure-shaped *event*, not a sustained note. Still holding
   * the globe decays to silence; scrubbing or releasing may strike it again. */
  poke({ pressure = 0, travel = 0, pan = 0, cancel = false,
    diameter = OCULOID_SURFACE_DEFAULTS.pokeDiameter } = {}) {
    const next = clampEye(pressure, 0, 1, 0);
    const previous = this.pokePressure;
    this.pokePressure = cancel ? 0 : next;
    this.pokePanTarget = clampEye(pan, -0.84, 0.84, 0);
    this.pokeDiameter = clampEye(diameter, ...OCULOID_SURFACE_RANGES.pokeDiameter,
      OCULOID_SURFACE_DEFAULTS.pokeDiameter);
    if (cancel) {
      // Do not enqueue a release hit for a stolen/lost gesture. An existing
      // audible press still fades through the per-sample attack/release filter.
      this.pokeEnvelope = this.pokeBend = 0;
      return;
    }
    if (!this.enabled) return;
    if (next === 0 && previous >= 0.08) {
      this.pokeEnvelope = Math.max(this.pokeEnvelope, 0.23 + previous * 0.46);
      this.pokeBend = 0.3;
      this.pokeReleasing = true;
      this.lastPokeEvent = this.audioTime;
    } else if (next > 0 && (previous === 0
      || (next - previous >= 0.075 || clampEye(travel, 0, 1, 0) >= 0.12)
        && this.audioTime - this.lastPokeEvent >= 0.055)) {
      this.pokeEnvelope = Math.max(this.pokeEnvelope,
        Math.min(0.92, 0.28 + next * 0.45 + clampEye(travel, 0, 1, 0) * 0.24));
      this.pokeBend = 0.55;
      this.pokeReleasing = false;
      this.lastPokeEvent = this.audioTime;
    }
  }

  /** One bounded, decaying stretch voice. No sustained contact oscillator,
   * AudioContext nodes, RAF clock or per-frame worklet messages. */
  surface({ kind, strength = 0, pan = 0, release = false,
    cancel = false } = {}) {
    if (cancel) { this.surfaceEnvelope = 0; return; }
    if (kind !== "stretch" || !this.enabled) return;
    const amount = clampEye(strength, 0, 1, 0);
    if (!amount || (!release && this.audioTime - this.lastSurfaceEvent < 0.065)) return;
    this.surfaceEnvelope = Math.max(this.surfaceEnvelope, 0.23 + amount * 0.53);
    this.surfaceStrength = amount;
    this.surfacePan = clampEye(pan, -0.84, 0.84, 0);
    this.lastSurfaceEvent = this.audioTime;
  }

  setRetractor(active) {
    const next = active === true;
    if (next === this.retracted) return;
    this.retracted = next;
    this.skipMotion = true;
    this.manualLidDistance = 0;
    if (this.enabled && this.lidsVisible) this.lidTarget = Math.max(this.lidTarget, 0.62);
  }

  setFlashlight(exposure) {
    this.flashlightExposure = clampEye(exposure, 0, 1, 0);
  }

  tearingBeatAt(time) {
    return this.tearAnchorBeat + Math.max(0, time - this.tearAnchorTime)
      * this.tearTempo / 60;
  }

  setCryTempo(value) {
    const beat = this.tearingBeatAt(this.audioTime);
    this.tearTempo = clampEye(value, ...OCULOID_CRY_TEMPO_RANGE, OCULOID_DEFAULTS.tempo);
    this.tearAnchorBeat = beat;
    this.tearAnchorTime = this.audioTime;
  }

  /** The offset is the current *visual* phase, used on explicit Audio arm as
   * well as Cry toggles. No past drops are replayed after arming or stalls. */
  setCry({ active = false, beat = 0 } = {}) {
    this.tearMode = active === true ? "loop" : "off";
    this.tearAnchorTime = this.audioTime;
    this.tearAnchorBeat = clampEye(beat, 0, 1e9, 0) % TEAR_CYCLE_BEATS;
    this.lastTearCycle = Math.floor((this.tearAnchorBeat - TEAR_RELEASE_BEAT) / TEAR_CYCLE_BEATS);
  }

  /** A manual Tear starts its own single four-beat cycle, without Motion. */
  tear({ size = this.config.wetness } = {}) {
    this.tearSize = clampEye(size, 0, 1, OCULOID_DEFAULTS.wetness);
    this.tearMode = "once";
    this.tearAnchorBeat = 0;
    this.tearAnchorTime = this.audioTime;
    this.lastTearCycle = -1;
  }

  tearOnset(startTime, length) {
    if (!this.enabled || this.tearMode === "off") return -1;
    const beat = this.tearingBeatAt(startTime);
    const beatsPerSample = this.tearTempo / (this.sampleRate * 60);
    // A release can land *exactly* between two 128-sample worklet blocks.
    // Floating-point rounding must not make the first block skip it and the
    // next mistake it for a past cycle (especially for one-shot Tear).
    const cycle = Math.max(0, Math.ceil(
      (beat - TEAR_RELEASE_BEAT - beatsPerSample * 2) / TEAR_CYCLE_BEATS));
    if (this.tearMode === "once" && cycle > 0) {
      this.tearMode = "off";
      return -1;
    }
    const atBeat = TEAR_RELEASE_BEAT + cycle * TEAR_CYCLE_BEATS;
    if (cycle <= this.lastTearCycle) return -1;
    const offset = Math.max(0, Math.round((atBeat - beat) / beatsPerSample));
    if (offset >= length) return -1;
    this.lastTearCycle = cycle;
    return offset;
  }

  beatAt(time) {
    return this.anchorBeat + (this.playing
      ? Math.max(0, time - this.anchorTime) * this.config.tempo / 60 : 0);
  }

  lidBeatAt(time) {
    return this.anchorLidBeat + (this.playing
      ? Math.max(0, time - this.anchorTime)
        * this.config.tempo * this.config.lidRate / 60 : 0);
  }

  render(left, right, startTime = 0) {
    if (!left || !right || left.length !== right.length) throw new RangeError("Stereo buffers must match.");
    const length = left.length, fs = this.sampleRate;
    this.audioTime = startTime + length / fs;
    if (!length) { this.rms = this.peak = 0; return; }
    const begin = eyePoseWithRetractor(
      eyePose(this.config, this.beatAt(startTime), this.playing,
        this.lidBeatAt(startTime)), this.retracted);
    const finish = eyePoseWithRetractor(
      eyePose(this.config, this.beatAt(startTime + length / fs), this.playing,
        this.lidBeatAt(startTime + length / fs)), this.retracted);
    begin.pupil = oculoidLitPupil(begin.pupil, this.flashlightExposure);
    finish.pupil = oculoidLitPupil(finish.pupil, this.flashlightExposure);
    const previous = this.lastPose ?? begin;
    this.lastPose = finish;
    const skip = this.skipMotion;
    this.skipMotion = false;
    if (!this.enabled && this.audible < 0.0001) {
      left.fill(0); right.fill(0);
      this.motionTarget = this.motionLevel = this.lidTarget = this.lidLevel = this.glide = 0;
      for (const voice of this.eyeVoices) voice.target = voice.level = 0;
      this.lastEnsemblePoses = null;
      this.skipMotion = true;
      this.pokeEnvelope = this.pokeLevel = this.pokePressure = this.pokeBend = 0;
      this.surfaceEnvelope = this.surfaceLevel = 0;
      this.tearEnvelope = this.tearLevel = 0;
      this.gazeDistance = this.pupilDistance = this.manualLidDistance = 0;
      this.rms = this.peak = 0;
      return;
    }
    const from = eyeSoundTargets(this.config, begin), to = eyeSoundTargets(this.config, finish);
    const ensemble = this.eyeCount > 1 && this.ensembleStyle !== "together";
    const layout = ensemble ? eyeClusterLayout(this.eyeCount) : [];
    const spread = ensemble ? Math.max(0.1, ...layout.map(position => Math.abs(position.x))) : 1;
    const previousEyes = this.lastEnsemblePoses;
    const eyeFrames = ensemble ? Array.from({ length: this.eyeCount }, (_, index) => {
      const start = eyeEnsemblePose(begin, this.config, this.beatAt(startTime),
        index, this.eyeCount, this.ensembleStyle, this.playing);
      const end = eyeEnsemblePose(finish, this.config, this.beatAt(startTime + length / fs),
        index, this.eyeCount, this.ensembleStyle, this.playing);
      const position = layout[index];
      const startTargets = eyeSoundTargets(this.config, start);
      const endTargets = eyeSoundTargets(this.config, end);
      const ratio = eyeInterval[this.ensembleStyle][index];
      return {
        start, end,
        fromHz: startTargets.hz * ratio, toHz: endTargets.hz * ratio,
        fromPan: clampEye(startTargets.pan * 0.35 + position.x / spread * 0.52,
          -0.84, 0.84),
        toPan: clampEye(endTargets.pan * 0.35 + position.x / spread * 0.52,
          -0.84, 0.84),
        from: startTargets, to: endTargets,
      };
    }) : [];
    this.lastEnsemblePoses = ensemble ? eyeFrames.map(frame => frame.end) : null;
    if (this.enabled) {
      if (!skip && !ensemble) {
        const travel = Math.hypot(finish.gazeX - previous.gazeX, finish.gazeY - previous.gazeY);
        this.gazeDistance = Math.min(0.3, this.gazeDistance + travel);
        if (this.gazeDistance >= 0.105 && startTime - this.lastGazeEvent >= 0.11) {
          this.motionTarget = Math.max(this.motionTarget,
            Math.min(1, 0.72 + travel / Math.max(0.002, length / fs) * 0.045));
          this.glide = Math.max(this.glide, 0.38);
          this.gazeDistance = 0;
          this.lastGazeEvent = startTime;
        }
        const dilation = Math.abs(finish.pupil - previous.pupil);
        this.pupilDistance = Math.min(0.25, this.pupilDistance + dilation);
        if (this.pupilDistance >= 0.095 && startTime - this.lastPupilEvent >= 0.12) {
          // Pupil-only LFOs (and a manual pupil drag) excite discrete squishes,
          // not a held tone. Brightness/cutoff still follow the actual aperture.
          this.motionTarget = Math.max(this.motionTarget, Math.min(0.85,
            0.56 + dilation / Math.max(0.002, length / fs) * 0.03));
          this.glide = Math.max(this.glide, 0.22);
          this.pupilDistance = 0;
          this.lastPupilEvent = startTime;
        }
      }
      if (ensemble && !skip && previousEyes) for (let index = 0; index < eyeFrames.length; index++) {
        const { end } = eyeFrames[index], voice = this.eyeVoices[index], previousEye = previousEyes[index];
        const travel = Math.hypot(end.gazeX - previousEye.gazeX, end.gazeY - previousEye.gazeY);
        voice.gazeDistance = Math.min(0.3, voice.gazeDistance + travel);
        if (voice.gazeDistance >= 0.105 && startTime - voice.lastGazeEvent >= 0.11) {
          voice.target = Math.max(voice.target, Math.min(0.9,
            (0.67 + travel / Math.max(0.002, length / fs) * 0.038) * (end.energy ?? 1)));
          voice.gazeDistance = 0;
          voice.lastGazeEvent = startTime;
          this.glide = Math.max(this.glide, 0.38);
        }
        const dilation = Math.abs(end.pupil - previousEye.pupil);
        voice.pupilDistance = Math.min(0.25, voice.pupilDistance + dilation);
        if (voice.pupilDistance >= 0.095 && startTime - voice.lastPupilEvent >= 0.12) {
          voice.target = Math.max(voice.target, Math.min(0.8,
            (0.5 + dilation / Math.max(0.002, length / fs) * 0.03) * (end.energy ?? 1)));
          voice.pupilDistance = 0;
          voice.lastPupilEvent = startTime;
        }
      }
      const upperCloses = !skip && previous.blink < 0.54 && finish.blink >= 0.54;
      const lowerLifts = !skip && previous.lowerLid > -0.16 && finish.lowerLid <= -0.16;
      if (this.lidsVisible && (upperCloses || lowerLifts || this.manualLidDistance >= 0.12)
        && startTime - this.lastLidEvent >= 0.08) {
        this.lidTarget = Math.max(this.lidTarget, upperCloses ? 1 : 0.72);
        this.glide = Math.max(this.glide, 0.19);
        this.manualLidDistance = 0;
        this.lastLidEvent = startTime;
      }
    }
    const tearAtSample = this.tearOnset(startTime, length);
    if (this.enabled && tearAtSample < 0 && !this.motionTarget && !this.lidTarget && !this.pokeEnvelope
      && !this.surfaceEnvelope && !this.surfaceLevel
      && !this.motionLevel && !this.lidLevel && !this.pokeLevel
      && !this.tearEnvelope && !this.tearLevel
      && !eyeFrames.some((_, index) => this.eyeVoices[index].target || this.eyeVoices[index].level)) {
      left.fill(0); right.fill(0);
      this.audible = 1;
      this.pitch = to.hz; this.pan = to.pan; this.gate = to.gate;
      for (let index = 0; index < eyeFrames.length; index++) {
        const voice = this.eyeVoices[index], frame = eyeFrames[index];
        voice.pitch = frame.toHz;
        voice.pan = frame.toPan;
        voice.gate = frame.to.gate;
      }
      this.rms = this.peak = 0;
      return;
    }
    const attack = 1 - Math.exp(-1 / (fs * 0.0028));
    const motionDecay = Math.exp(-1 / (fs * 0.05));
    const lidDecay = Math.exp(-1 / (fs * 0.032));
    const glideDecay = Math.exp(-1 / (fs * 0.034));
    const pokeDecay = Math.exp(-1 / (fs * 0.105));
    const surfaceDecay = Math.exp(-1 / (fs * 0.096));
    const pokeBendDecay = Math.exp(-1 / (fs * 0.06));
    const tearDecay = Math.exp(-1 / (fs * 0.09));
    const outfit = this.wardrobe;
    const flutterLids = this.config.eyelidStyle === "flutter"
      || this.config.eyelidStyle === "lid-flutter";
    const mouthful = this.lidsVisible && (outfit.tongue || outfit.teeth);
    const cigar = this.lidsVisible && outfit.cigar;
    const scarf = this.lidsVisible && outfit.scarf;
    const hair = outfit.hair === "mullet" ? 1.12 : outfit.hair === "mom-bob" ? 0.88 : 1;
    const earSpread = outfit.catEars ? 1.12 : outfit.humanEars ? 1.08 : 1;
    const lidHz = mouthful ? 87 + this.config.rootHz * 0.23
      : flutterLids ? 305 + this.config.rootHz * 0.72
        : this.config.eyelidStyle === "wild" ? 110 + this.config.rootHz * 0.32
          : 155 + this.config.rootHz * 0.37;
    const muffled = (outfit.sunglasses ? 0.78 : 1)
      * (this.lidsVisible && outfit.coat ? 0.78 : 1);
    let sum = 0, peak = 0;
    for (let i = 0; i < length; i++) {
      if (i === tearAtSample) {
        const size = this.tearMode === "loop" ? this.config.wetness : this.tearSize;
        this.tearEnvelope = Math.max(this.tearEnvelope, 0.12 + size * 0.66);
        this.tearPhase = 0;
      }
      const t = (i + 1) / Math.max(1, length);
      const hz = clampEye(lerp(from.hz, to.hz, t), 20, fs * 0.4);
      this.audible += ((this.enabled ? 1 : 0) - this.audible) * 0.004;
      this.pitch += (hz - this.pitch) * 0.0018;
      this.pan += (lerp(from.pan, to.pan, t) - this.pan) * 0.003;
      this.gate += (lerp(from.gate, to.gate, t) - this.gate) * 0.0024;
      this.motionLevel += (this.motionTarget - this.motionLevel) * attack;
      this.lidLevel += (this.lidTarget - this.lidLevel) * attack;
      this.pokeLevel += (this.pokeEnvelope - this.pokeLevel) * attack;
      this.surfaceLevel += (this.surfaceEnvelope - this.surfaceLevel) * attack;
      this.tearLevel += (this.tearEnvelope - this.tearLevel) * attack;
      this.pokePan += (this.pokePanTarget - this.pokePan) * 0.003;
      this.motionTarget *= motionDecay;
      this.lidTarget *= lidDecay;
      this.pokeEnvelope *= pokeDecay;
      this.surfaceEnvelope *= surfaceDecay;
      this.tearEnvelope *= tearDecay;
      this.pokeBend *= pokeBendDecay;
      this.glide *= glideDecay;
      const bentHz = this.pitch * (1 + this.glide);
      this.phase = (this.phase + TAU * bentHz / fs) % TAU;
      this.secondary = (this.secondary + TAU * bentHz * (1.27 + this.config.irisTint * 0.31) / fs) % TAU;
      const color = lerp(from.color, to.color, t);
      const partial = Math.sin(this.phase + color * 1.55 * Math.sin(this.secondary));
      const pupilOvertone = Math.sin(this.phase * 2 + Math.sin(this.secondary) * 0.4)
        * (0.04 + color * 0.14 + lerp(from.brightness, to.brightness, t) * 0.16);
      const glass = Math.sin(this.secondary * 1.01) * (0.055 + lerp(from.shimmer, to.shimmer, t) * 0.13);
      this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0;
      const white = this.seed / 2147483648 - 1;
      const cutoff = lerp(from.cutoff, to.cutoff, t);
      this.noiseState += (white - this.noiseState) * Math.min(0.8, cutoff / (fs * 0.3));
      const breath = this.noiseState * lerp(from.grain, to.grain, t);
      this.impactPhase = (this.impactPhase + TAU * lidHz / fs) % TAU;
      this.mouthPhase = (this.mouthPhase + TAU * (51 + this.config.rootHz * 0.15) / fs) % TAU;
      const lidNoise = (flutterLids && !mouthful ? 0.15 : 0.09)
        * (outfit.mustache ? 0.58 : 1) * (outfit.lipstick ? 0.68 : 1)
        * (outfit.headband ? 0.73 : 1);
      const lid = this.lidsVisible ? this.lidLevel * (
        (mouthful ? 0.35 : flutterLids ? 0.19 : 0.27) * Math.sin(this.impactPhase)
        + white * lidNoise
        + (outfit.tongue ? 0.17 * Math.sin(this.mouthPhase
          + 0.6 * Math.sin(this.impactPhase)) : 0)
        + (outfit.teeth ? 0.085 * Math.sin(this.impactPhase * 4) : 0))
        * (outfit.headband ? 0.85 : 1) : 0;
      const hatRing = hatSound(outfit.hat, this.phase, this.secondary, this.noiseState);
      const squish = ((partial * 0.5 + pupilOvertone * (cigar ? 0.57 : 1)
        + glass * muffled + breath * hair * (scarf ? 0.54 : 1) + hatRing
        + (outfit.bowTie ? 0.065 * Math.sin(this.secondary * 2) : 0)
        + (cigar ? this.noiseState * 0.09 : 0)) * this.gate * this.motionLevel);
      const pokeHz = clampEye(this.config.rootHz * (this.pokeReleasing ? 1.22
        : 0.86 - this.pokePressure * 0.23) * (1 + this.pokeBend)
          * (1.2 - this.pokeDiameter * 0.4), 28, fs * 0.2);
      this.pokePhase = (this.pokePhase + TAU * pokeHz / fs) % TAU;
      const poke = this.pokeLevel * (
        Math.sin(this.pokePhase + (0.2 + this.config.wetness * 0.38) * Math.sin(this.pokePhase * 2))
          * (0.33 + this.pokePressure * 0.15)
        + this.noiseState * (0.22 + this.config.wetness * 0.24)
        + Math.sin(this.pokePhase * 1.63) * 0.065);
      const surfaceHz = clampEye(this.config.rootHz
        * (0.62 + this.surfaceStrength * 0.42), 25, fs * 0.2);
      this.surfacePhase = (this.surfacePhase + TAU * surfaceHz / fs) % TAU;
      const surface = this.surfaceLevel
        * (0.34 * Math.sin(this.surfacePhase + Math.sin(this.surfacePhase * 1.12))
          + 0.07 * this.noiseState);
      this.tearPhase = (this.tearPhase + TAU * clampEye(this.config.rootHz
        * (2.2 + 0.7 * this.tearEnvelope), 25, fs * 0.25) / fs) % TAU;
      const tear = this.tearLevel * (0.28 * Math.sin(this.tearPhase
        + 0.3 * Math.sin(this.tearPhase * 1.9)) + 0.13 * this.noiseState);
      const sample = Math.tanh(squish + lid + poke + surface + tear)
        * (0.52 * this.audible);
      const pokeWeight = Math.min(1, this.pokeLevel);
      const surfaceWeight = Math.min(1, this.surfaceLevel);
      const tearWeight = Math.min(1, this.tearLevel);
      const pan = clampEye((((this.pan * earSpread)
        * (1 - pokeWeight) + this.pokePan * pokeWeight)
        * (1 - surfaceWeight) + this.surfacePan * surfaceWeight) * (1 - tearWeight)
        - 0.68 * tearWeight, -0.84, 0.84);
      let l = sample * Math.sqrt((1 - pan) * 0.5);
      let r = sample * Math.sqrt((1 + pan) * 0.5);
      if (ensemble) {
        const gain = 0.52 * this.audible / Math.sqrt(this.eyeCount);
        for (let index = 0; index < eyeFrames.length; index++) {
          const frame = eyeFrames[index], voice = this.eyeVoices[index];
          voice.level += (voice.target - voice.level) * attack;
          voice.target *= motionDecay;
          voice.pitch += (clampEye(lerp(frame.fromHz, frame.toHz, t), 20, fs * 0.4)
            - voice.pitch) * 0.0018;
          voice.pan += (lerp(frame.fromPan, frame.toPan, t) - voice.pan) * 0.003;
          voice.gate += (lerp(frame.from.gate, frame.to.gate, t) - voice.gate) * 0.0024;
          if (voice.level < 1e-7) continue;
          const hz = voice.pitch * (1 + this.glide);
          voice.phase = (voice.phase + TAU * hz / fs) % TAU;
          voice.secondary = (voice.secondary + TAU * hz
            * (1.27 + this.config.irisTint * 0.31) / fs) % TAU;
          const color = lerp(frame.from.color, frame.to.color, t);
          const body = 0.48 * Math.sin(voice.phase
            + color * 1.55 * Math.sin(voice.secondary));
          const overtone = Math.sin(voice.phase * 2 + Math.sin(voice.secondary) * 0.4)
            * (0.04 + color * 0.14 + lerp(frame.from.brightness, frame.to.brightness, t) * 0.16)
            * (cigar ? 0.57 : 1);
          const glassy = Math.sin(voice.secondary * 1.01)
            * (0.055 + lerp(frame.from.shimmer, frame.to.shimmer, t) * 0.13) * muffled;
          const hat = hatSound(outfit.hat, voice.phase, voice.secondary, this.noiseState);
          const grain = this.noiseState * lerp(frame.from.grain, frame.to.grain, t)
            * hair * (scarf ? 0.54 : 1);
          const hit = Math.tanh((body + overtone + glassy + hat + grain
            + (outfit.bowTie ? 0.065 * Math.sin(voice.secondary * 2) : 0))
            * voice.gate * voice.level) * gain;
          const position = clampEye(voice.pan * earSpread, -0.84, 0.84);
          l += hit * Math.sqrt((1 - position) * 0.5);
          r += hit * Math.sqrt((1 + position) * 0.5);
        }
        l = Math.tanh(l); r = Math.tanh(r);
      }
      left[i] = l; right[i] = r;
      sum += (l * l + r * r) * 0.5;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }
    if (this.motionTarget < 1e-7 && this.motionLevel < 1e-6) this.motionTarget = this.motionLevel = 0;
    for (const voice of this.eyeVoices) if (voice.target < 1e-7 && voice.level < 1e-6)
      voice.target = voice.level = 0;
    if (this.lidTarget < 1e-7 && this.lidLevel < 1e-6) this.lidTarget = this.lidLevel = 0;
    if (this.pokeEnvelope < 1e-7 && this.pokeLevel < 1e-6) this.pokeEnvelope = this.pokeLevel = 0;
    if (this.surfaceEnvelope < 1e-7 && this.surfaceLevel < 1e-6)
      this.surfaceEnvelope = this.surfaceLevel = 0;
    if (this.tearEnvelope < 1e-7 && this.tearLevel < 1e-6)
      this.tearEnvelope = this.tearLevel = 0;
    this.peak = peak;
    this.rms = Math.sqrt(sum / Math.max(1, length));
  }
}

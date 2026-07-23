import SignalsmithStretch from "../vendor/signalsmith-stretch/SignalsmithStretch.mjs";

function clamp(value, low, high, fallback = low) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
}

function semitonesForVoice(voice) {
  return Math.round(12 * Math.log2(clamp(voice?.rate, 0.125, 8, 1)) * 100) / 100;
}

function pitchKey(semitones) {
  return Math.abs(semitones) < 0.005 ? "0" : semitones.toFixed(2);
}

function setImmediately(parameter, value, time) {
  parameter.cancelScheduledValues?.(time);
  if (parameter.setValueAtTime) parameter.setValueAtTime(value, time);
  else parameter.setTargetAtTime?.(value, time, 0.001);
}

function fadeTo(parameter, from, to, time, duration) {
  setImmediately(parameter, from, time);
  if (parameter.linearRampToValueAtTime) parameter.linearRampToValueAtTime(to, time + duration);
  else parameter.setTargetAtTime?.(to, time, duration / 3);
}

/**
 * Groups branch voices by transposition.  Each unique pitch gets one
 * Signalsmith spectral processor, then fans out through crossfaded Web Audio
 * delay pairs so time and pitch remain separate controls.  Delay times never
 * move while audible: changing a timing rule prepares a silent tap at the new
 * position and fades across, avoiding Doppler scrubbing and buffer tearing.
 */
export class SignalsmithGenerationBank {
  constructor(context, input, output, {
    maxPitchSources = 7,
    stretchFactory = SignalsmithStretch,
  } = {}) {
    this.context = context;
    this.input = input;
    this.output = output;
    this.maxPitchSources = Math.max(1, Math.round(maxPitchSources));
    this.stretchFactory = stretchFactory;
    this.pitchSources = new Map();
    this.taps = new Map();
    this.desired = [];
    this.revision = 0;
    this.disposed = false;
    this.timingTimer = null;
  }

  static async create(context, input, output, options) {
    const bank = new SignalsmithGenerationBank(context, input, output, options);
    // Force the official worklet/WASM module to load before replacing the
    // lightweight fallback.  The probe never enters the audible graph.
    const probe = await bank.stretchFactory(context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    await probe.configure?.({ blockMs: 160, intervalMs: 30, splitComputation: true });
    await probe.stop?.();
    probe.disconnect?.();
    return bank;
  }

  setVoices(voices) {
    const desired = (Array.isArray(voices) ? voices : []).map((voice, index) => {
      const semitones = semitonesForVoice(voice);
      return {
        key: typeof voice?.key === "string" ? voice.key : `stretch:${index}`,
        semitones,
        pitchKey: pitchKey(semitones),
        delay: clamp(voice?.delay, 0.00002, 58, 0.2),
        gain: clamp(voice?.gain, 0, 1, 0),
        pan: clamp(voice?.pan, -1, 1, 0),
      };
    });
    this.desired = desired;
    const revision = ++this.revision;
    if (this.timingTimer !== null) clearTimeout(this.timingTimer);
    if (desired.length && this.taps.size) {
      // Range inputs can fire every animation frame.  Coalesce the complete
      // gesture before changing either delay taps or spectral pitch sources.
      // Otherwise Branch Angle can allocate dozens of abandoned WASM
      // AudioWorklets during a single drag and exhaust the live graph.
      this.timingTimer = setTimeout(() => {
        this.timingTimer = null;
        void this.reconcile(revision);
      }, 90);
    } else {
      this.timingTimer = null;
      void this.reconcile(revision);
    }
  }

  selectedPitchKeys() {
    const power = new Map();
    for (const voice of this.desired) {
      if (voice.pitchKey === "0") continue;
      power.set(voice.pitchKey, (power.get(voice.pitchKey) ?? 0) + voice.gain ** 2);
    }
    return [...power]
      .sort((first, second) => second[1] - first[1])
      .slice(0, this.maxPitchSources)
      .map(([key]) => key);
  }

  async ensurePitchSource(key) {
    if (key === "0") return { node: this.input, latency: 0, semitones: 0 };
    if (this.pitchSources.has(key)) return this.pitchSources.get(key);

    const semitones = Number(key);
    const pending = (async () => {
      const node = await this.stretchFactory(this.context, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      await node.configure?.({ blockMs: 160, intervalMs: 30, splitComputation: true });
      this.input.connect(node);
      await node.schedule?.({
        active: true,
        output: this.context.currentTime,
        semitones,
        tonalityHz: 8_000,
        formantSemitones: 0,
        // Moving the spectral envelope with the pitch is closer to tape and
        // avoids the fixed-formant "voice changer" colour on microphones.
        formantCompensation: false,
        formantBaseHz: 0,
      });
      const latency = clamp(await node.latency?.(), 0, 1, 0);
      return { node, latency, semitones };
    })();
    this.pitchSources.set(key, pending);
    try {
      const source = await pending;
      this.pitchSources.set(key, source);
      return source;
    } catch (error) {
      this.pitchSources.delete(key);
      throw error;
    }
  }

  nearestPitchKey(semitones, availableKeys) {
    if (!availableKeys.length || Math.abs(semitones) < 0.005) return "0";
    return availableKeys.reduce((best, key) => (
      Math.abs(Number(key) - semitones) < Math.abs(Number(best) - semitones) ? key : best
    ), availableKeys[0]);
  }

  removeTap(key) {
    const tap = this.taps.get(key);
    if (!tap) return;
    for (let lane = 0; lane < tap.delays.length; lane += 1) {
      tap.source?.disconnect?.(tap.delays[lane]);
      tap.delays[lane].disconnect?.();
      tap.laneGains[lane].disconnect?.();
    }
    tap.gain.disconnect?.();
    tap.pan.disconnect?.();
    this.taps.delete(key);
  }

  retireUnusedPitchSources(keepKeys) {
    const retained = new Set(keepKeys);
    for (const [key, candidate] of this.pitchSources) {
      if (retained.has(key)) continue;
      void (async () => {
        try {
          const source = await candidate;
          if (this.pitchSources.get(key) !== candidate && this.pitchSources.get(key) !== source) return;
          if ([...this.taps.values()].some((tap) => tap.source === source.node)) return;
          this.pitchSources.delete(key);
          this.input.disconnect?.(source.node);
          await source.node.stop?.();
          source.node.disconnect?.();
        } catch {
          this.pitchSources.delete(key);
        }
      })();
    }
  }

  async reconcile(revision) {
    const selectedKeys = this.selectedPitchKeys();
    const sources = new Map([["0", { node: this.input, latency: 0, semitones: 0 }]]);
    await Promise.all(selectedKeys.map(async (key) => {
      try {
        sources.set(key, await this.ensurePitchSource(key));
      } catch {
        // A failed high-quality source falls back to the exact neutral buffer.
      }
    }));
    if (this.disposed || revision !== this.revision) return;

    const activeKeys = new Set(this.desired.map((voice) => voice.key));
    for (const key of this.taps.keys()) {
      if (!activeKeys.has(key)) this.removeTap(key);
    }

    const now = this.context.currentTime;
    const availableKeys = [...sources.keys()].filter((key) => key !== "0");
    for (const voice of this.desired) {
      const selectedKey = sources.has(voice.pitchKey)
        ? voice.pitchKey
        : this.nearestPitchKey(voice.semitones, availableKeys);
      const sourceInfo = sources.get(selectedKey) ?? sources.get("0");
      let tap = this.taps.get(voice.key);
      if (!tap || tap.source !== sourceInfo.node) {
        this.removeTap(voice.key);
        const delays = [this.context.createDelay(60), this.context.createDelay(60)];
        const laneGains = [this.context.createGain(), this.context.createGain()];
        const gain = this.context.createGain();
        const pan = this.context.createStereoPanner();
        for (let lane = 0; lane < delays.length; lane += 1) {
          sourceInfo.node.connect(delays[lane]);
          delays[lane].connect(laneGains[lane]);
          laneGains[lane].connect(gain);
        }
        gain.connect(pan);
        pan.connect(this.output);
        const initialDelay = Math.max(0, voice.delay - sourceInfo.latency);
        setImmediately(delays[0].delayTime, initialDelay, now);
        setImmediately(delays[1].delayTime, initialDelay, now);
        setImmediately(laneGains[0].gain, 1, now);
        setImmediately(laneGains[1].gain, 0, now);
        tap = {
          source: sourceInfo.node,
          delays,
          laneGains,
          delayValues: [initialDelay, initialDelay],
          activeLane: 0,
          gain,
          pan,
        };
        this.taps.set(voice.key, tap);
      }
      const audibleDelay = Math.max(0, voice.delay - sourceInfo.latency);
      const sampleRate = Number(this.context.sampleRate) || 48_000;
      if (Math.abs(audibleDelay - tap.delayValues[tap.activeLane]) > 1 / sampleRate) {
        const previousLane = tap.activeLane;
        const nextLane = 1 - previousLane;
        // Collapse any interrupted fade before reusing its quiet lane.
        setImmediately(tap.laneGains[previousLane].gain, 1, now);
        setImmediately(tap.laneGains[nextLane].gain, 0, now);
        setImmediately(tap.delays[nextLane].delayTime, audibleDelay, now);
        tap.delayValues[nextLane] = audibleDelay;
        fadeTo(tap.laneGains[previousLane].gain, 1, 0, now, 0.065);
        fadeTo(tap.laneGains[nextLane].gain, 0, 1, now, 0.065);
        tap.activeLane = nextLane;
      }
      tap.gain.gain.setTargetAtTime(voice.gain, now, 0.025);
      tap.pan.pan.setTargetAtTime(voice.pan, now, 0.025);
    }
    this.retireUnusedPitchSources(selectedKeys);
  }

  async dispose() {
    this.disposed = true;
    this.revision += 1;
    if (this.timingTimer !== null) clearTimeout(this.timingTimer);
    this.timingTimer = null;
    for (const key of [...this.taps.keys()]) this.removeTap(key);
    for (const source of this.pitchSources.values()) {
      try {
        const resolved = await source;
        this.input.disconnect?.(resolved.node);
        await resolved.node.stop?.();
        resolved.node.disconnect?.();
      } catch {
        // Already unavailable.
      }
    }
    this.pitchSources.clear();
  }
}

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

async function defaultMixerFactory(context, { maxInputs, maxVoices, historySeconds }) {
  const WorkletNode = globalThis.AudioWorkletNode;
  if (!context.audioWorklet?.addModule || !WorkletNode) {
    throw new Error("The bounded generation mixer requires AudioWorklet.");
  }
  await context.audioWorklet.addModule(
    new URL("./signalsmith-generation-mixer-processor.js?v=20260723-fixed-pool", import.meta.url),
  );
  return new WorkletNode(context, "morphazoid-signalsmith-generation-mixer", {
    numberOfInputs: maxInputs,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { maxInputs, maxVoices, historySeconds },
  });
}

/**
 * A fixed pool of high-quality pitch processors feeding one bounded rolling
 * multi-tap history.  Grammar edits retune slots and virtual read heads; they
 * never allocate pitch worklets or 60-second DelayNodes during a gesture.
 */
export class SignalsmithGenerationBank {
  constructor(context, input, output, {
    maxPitchSources = 5,
    maxVoices = 48,
    historySeconds = 32,
    stretchFactory = SignalsmithStretch,
    mixerFactory = defaultMixerFactory,
  } = {}) {
    this.context = context;
    this.input = input;
    this.output = output;
    this.maxPitchSources = Math.max(1, Math.min(7, Math.round(maxPitchSources)));
    this.maxVoices = Math.max(1, Math.min(64, Math.round(maxVoices)));
    this.historySeconds = clamp(historySeconds, 4, 40, 32);
    this.stretchFactory = stretchFactory;
    this.mixerFactory = mixerFactory;
    this.slots = [];
    this.mixer = null;
    this.desired = [];
    this.revision = 0;
    this.rendered = false;
    this.disposed = false;
    this.gestureTimer = null;
  }

  static async create(context, input, output, options) {
    const bank = new SignalsmithGenerationBank(context, input, output, options);
    try {
      await bank.initialize();
      return bank;
    } catch (error) {
      await bank.dispose();
      throw error;
    }
  }

  async initialize() {
    const maxInputs = this.maxPitchSources + 1;
    this.mixer = await this.mixerFactory(this.context, {
      maxInputs,
      maxVoices: this.maxVoices,
      historySeconds: this.historySeconds,
    });
    this.input.connect(this.mixer, 0, 0);
    this.mixer.connect(this.output);

    // This is the entire lifetime allocation.  Slots are retuned in place and
    // never keyed to transient slider values.
    for (let index = 0; index < this.maxPitchSources; index += 1) {
      const node = await this.stretchFactory(this.context, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      await node.configure?.({ blockMs: 160, intervalMs: 30, splitComputation: true });
      this.input.connect(node);
      node.connect(this.mixer, 0, index + 1);
      await node.schedule?.({
        active: true,
        output: this.context.currentTime,
        semitones: 0,
        tonalityHz: 8_000,
        formantSemitones: 0,
        formantCompensation: false,
        formantBaseHz: 0,
      });
      this.slots.push({
        node,
        inputIndex: index + 1,
        latency: clamp(await node.latency?.(), 0, 1, 0),
        key: null,
        semitones: 0,
      });
    }
  }

  setVoices(voices) {
    this.desired = (Array.isArray(voices) ? voices : [])
      .slice(0, this.maxVoices)
      .map((voice, index) => {
        const semitones = semitonesForVoice(voice);
        return {
          key: typeof voice?.key === "string" ? voice.key : `stretch:${index}`,
          semitones,
          pitchKey: pitchKey(semitones),
          delay: clamp(voice?.delay, 0.00002, this.historySeconds - 0.01, 0.2),
          gain: clamp(voice?.gain, 0, 1, 0),
          pan: clamp(voice?.pan, -1, 1, 0),
        };
      });
    const revision = ++this.revision;
    if (this.gestureTimer !== null) clearTimeout(this.gestureTimer);
    if (this.desired.length && this.rendered) {
      this.gestureTimer = setTimeout(() => {
        this.gestureTimer = null;
        void this.reconcile(revision).catch(() => {});
      }, 90);
    } else {
      this.gestureTimer = null;
      void this.reconcile(revision).catch(() => {});
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

  nearestPitchKey(semitones, availableKeys) {
    if (!availableKeys.length || Math.abs(semitones) < 0.005) return "0";
    return availableKeys.reduce((best, key) => (
      Math.abs(Number(key) - semitones) < Math.abs(Number(best) - semitones) ? key : best
    ), availableKeys[0]);
  }

  async assignPitchSlots(keys) {
    const assignments = new Map();
    const retained = new Set();
    for (const key of keys) {
      const slot = this.slots.find((candidate) => candidate.key === key);
      if (!slot) continue;
      assignments.set(key, slot);
      retained.add(slot);
    }
    const available = this.slots.filter((slot) => !retained.has(slot));
    for (const key of keys) {
      if (assignments.has(key)) continue;
      const slot = available.shift();
      if (!slot) break;
      const semitones = Number(key);
      await slot.node.schedule?.({
        active: true,
        output: this.context.currentTime + slot.latency,
        semitones,
        tonalityHz: 8_000,
        formantSemitones: 0,
        formantCompensation: false,
        formantBaseHz: 0,
      });
      slot.key = key;
      slot.semitones = semitones;
      assignments.set(key, slot);
    }
    for (const slot of this.slots) {
      if (!retained.has(slot) && ![...assignments.values()].includes(slot)) slot.key = null;
    }
    return assignments;
  }

  async reconcile(revision) {
    if (this.disposed || !this.mixer) return;
    const selectedKeys = this.selectedPitchKeys();
    const assignments = await this.assignPitchSlots(selectedKeys);
    if (this.disposed || revision !== this.revision) return;
    const availableKeys = [...assignments.keys()];
    const renderedVoices = this.desired.map((voice) => {
      const selectedKey = assignments.has(voice.pitchKey)
        ? voice.pitchKey
        : this.nearestPitchKey(voice.semitones, availableKeys);
      const slot = assignments.get(selectedKey);
      return {
        key: voice.key,
        sourceIndex: slot?.inputIndex ?? 0,
        delay: Math.max(0, voice.delay - (slot?.latency ?? 0)),
        gain: voice.gain,
        pan: voice.pan,
      };
    });
    this.mixer.port?.postMessage?.({ type: "voices", voices: renderedVoices });
    this.rendered = renderedVoices.length > 0;
  }

  async dispose() {
    this.disposed = true;
    this.revision += 1;
    if (this.gestureTimer !== null) clearTimeout(this.gestureTimer);
    this.gestureTimer = null;
    this.mixer?.port?.postMessage?.({ type: "voices", voices: [] });
    try { this.input.disconnect?.(this.mixer); } catch { /* already disconnected */ }
    this.mixer?.disconnect?.();
    this.mixer?.port?.close?.();
    for (const slot of this.slots) {
      try {
        this.input.disconnect?.(slot.node);
        await slot.node.stop?.();
        slot.node.disconnect?.();
        slot.node.port?.close?.();
      } catch {
        // Already unavailable.
      }
    }
    this.slots = [];
    this.mixer = null;
  }
}

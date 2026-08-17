import SignalsmithStretch from "../vendor/signalsmith-stretch/SignalsmithStretch.mjs";
import {
  DEFAULT_SIGNALSMITH_PITCH_SOURCES,
  MAX_SIGNALSMITH_PITCH_SOURCES,
} from "./signalsmith-generation-limits.js";

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
    new URL("./signalsmith-generation-mixer-processor.js?v=20260724-economy-24", import.meta.url),
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
    maxPitchSources = DEFAULT_SIGNALSMITH_PITCH_SOURCES,
    maxVoices = 48,
    historySeconds = 30,
    stretchFactory = SignalsmithStretch,
    mixerFactory = defaultMixerFactory,
    onRenderLoad = null,
    onPitchDetail = null,
  } = {}) {
    this.context = context;
    this.input = input;
    this.output = output;
    this.maxPitchSources = Math.round(clamp(
      maxPitchSources,
      1,
      MAX_SIGNALSMITH_PITCH_SOURCES,
      DEFAULT_SIGNALSMITH_PITCH_SOURCES,
    ));
    this.maxVoices = Math.max(1, Math.min(1024, Math.round(maxVoices)));
    this.historySeconds = clamp(historySeconds, 4, 40, 30);
    this.stretchFactory = stretchFactory;
    this.mixerFactory = mixerFactory;
    this.onRenderLoad = typeof onRenderLoad === "function" ? onRenderLoad : null;
    this.onPitchDetail = typeof onPitchDetail === "function" ? onPitchDetail : null;
    this.slots = [];
    this.mixer = null;
    this.desired = [];
    this.revision = 0;
    this.rendered = false;
    this.disposed = false;
    this.gestureTimer = null;
    this.requestedVoiceCount = 0;
    this.runtimeVoiceLimit = this.maxVoices;
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
    if (this.mixer.port) {
      this.mixer.port.onmessage = (event) => {
        const report = event?.data;
        if (report?.type !== "render-load") return;
        try {
          this.onRenderLoad?.(report);
        } catch {
          // Capacity presentation must never interrupt audio rendering.
        }
      };
      this.mixer.port.start?.();
    }

    // This is the entire lifetime allocation.  Slots are retuned in place and
    // never keyed to transient slider values.
    for (let index = 0; index < this.maxPitchSources; index += 1) {
      const node = await this.stretchFactory(this.context, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const slot = {
        node,
        inputIndex: index + 1,
        latency: 0,
        key: null,
        semitones: 0,
      };
      // Register immediately so a configure/schedule failure can still stop
      // and release this partially initialized WASM lane.
      this.slots.push(slot);
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
      slot.latency = clamp(await node.latency?.(), 0, 1, 0);
    }
  }

  setVoices(voices, { requestedVoiceCount, voiceLimit } = {}) {
    this.runtimeVoiceLimit = Math.max(0, Math.min(
      this.maxVoices,
      Math.floor(clamp(voiceLimit, 0, this.maxVoices, this.maxVoices)),
    ));
    this.requestedVoiceCount = Math.max(
      0,
      Math.floor(Number(requestedVoiceCount) || voices?.length || 0),
    );
    this.desired = (Array.isArray(voices) ? voices : [])
      .slice(0, this.runtimeVoiceLimit)
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
      if (voice.pitchKey === "0" || voice.gain <= 0.000001) continue;
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
    this.mixer.port?.postMessage?.({
      type: "voices",
      voices: renderedVoices,
      requestedVoiceCount: this.requestedVoiceCount,
      voiceLimit: this.runtimeVoiceLimit,
    });
    const audibleVoices = this.desired.filter((voice) => voice.gain > 0.000001);
    const shiftedVoices = audibleVoices.filter((voice) => voice.pitchKey !== "0");
    const requestedShiftedKeys = new Set(shiftedVoices.map((voice) => voice.pitchKey));
    const exactShiftedKeys = new Set(
      [...requestedShiftedKeys].filter((key) => assignments.has(key)),
    );
    const unisonVoices = audibleVoices.filter((voice) => voice.pitchKey === "0").length;
    const report = Object.freeze({
      pitchSourceLimit: this.maxPitchSources,
      requestedShiftedPitches: requestedShiftedKeys.size,
      exactShiftedPitches: exactShiftedKeys.size,
      mergedShiftedPitches: Math.max(0, requestedShiftedKeys.size - exactShiftedKeys.size),
      requestedPitchClasses: requestedShiftedKeys.size + (unisonVoices > 0 ? 1 : 0),
      renderedPitchClasses: exactShiftedKeys.size + (unisonVoices > 0 ? 1 : 0),
      unisonActive: unisonVoices > 0,
      unisonVoices,
      exactShiftedVoices: shiftedVoices.filter((voice) => assignments.has(voice.pitchKey)).length,
      mergedShiftedVoices: shiftedVoices.filter((voice) => !assignments.has(voice.pitchKey)).length,
    });
    try {
      this.onPitchDetail?.(report);
    } catch {
      // Pitch-detail presentation must never interrupt audio rendering.
    }
    this.rendered = renderedVoices.length > 0;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    if (this.gestureTimer !== null) clearTimeout(this.gestureTimer);
    this.gestureTimer = null;
    try {
      this.mixer?.port?.postMessage?.({ type: "voices", voices: [] });
    } catch {
      // The worklet may already be stopping.
    }
    try { this.input.disconnect?.(this.mixer); } catch { /* already disconnected */ }
    try { this.mixer?.disconnect?.(); } catch { /* already disconnected */ }
    if (this.mixer?.port) {
      try { this.mixer.port.onmessage = null; } catch { /* already closed */ }
      try { this.mixer.port.close?.(); } catch { /* already closed */ }
    }
    for (const slot of this.slots) {
      try { this.input.disconnect?.(slot.node); } catch { /* not connected */ }
      try { await slot.node.stop?.(); } catch { /* already stopped */ }
      try { slot.node.disconnect?.(); } catch { /* already disconnected */ }
      try { slot.node.port?.close?.(); } catch { /* already closed */ }
    }
    this.slots = [];
    this.mixer = null;
  }
}

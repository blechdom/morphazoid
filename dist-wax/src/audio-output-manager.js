const MANAGERS = new WeakMap();
const METER_INTERVAL_MS = 1000 / 30;
const DEFAULT_FFT_SIZE = 256;
const SILENCE_FLOOR = 0.001;

function frozenOutputDevice(id, label) {
  return Object.freeze({
    id,
    deviceId: id,
    label,
    kind: "audiooutput",
  });
}

function safeRuntime(runtime) {
  return runtime && (typeof runtime === "object" || typeof runtime === "function")
    ? runtime
    : globalThis;
}

function noOpRelease() {}

function silentLevel() {
  return Object.freeze({
    leftRms: 0,
    leftPeak: 0,
    rightRms: 0,
    rightPeak: 0,
    rms: 0,
    peak: 0,
    clipped: false,
    active: false,
  });
}

function configuredAnalyser(context) {
  try {
    if (typeof context?.createAnalyser !== "function") return null;
    const analyser = context.createAnalyser();
    analyser.fftSize = DEFAULT_FFT_SIZE;
    if ("smoothingTimeConstant" in analyser) analyser.smoothingTimeConstant = 0;
    if (typeof analyser.getFloatTimeDomainData === "function") return analyser;
    safeDisconnect(analyser);
    return null;
  } catch {
    return null;
  }
}

function safeDisconnect(node, target) {
  try {
    if (target === undefined) node?.disconnect?.();
    else node?.disconnect?.(target);
  } catch {
    // Audio graph teardown is best-effort; the context may already be closed.
  }
}

function readAnalyserChannel(record, analyser, samplesKey) {
  const length = Math.max(1, Math.trunc(Number(analyser.fftSize) || DEFAULT_FFT_SIZE));
  if (!record[samplesKey] || record[samplesKey].length !== length) {
    record[samplesKey] = new Float32Array(length);
  }
  try {
    analyser.getFloatTimeDomainData(record[samplesKey]);
  } catch {
    return null;
  }
  let squareSum = 0;
  let sampleCount = 0;
  let peak = 0;
  for (const sample of record[samplesKey]) {
    if (!Number.isFinite(sample)) continue;
    const magnitude = Math.abs(sample);
    if (magnitude > peak) peak = magnitude;
    squareSum += sample * sample;
    sampleCount += 1;
  }
  return { squareSum, sampleCount, peak };
}

/**
 * Shared, opt-in output metering for Morphazoid's Web Audio graphs.
 *
 * The manager owns a non-audible stereo meter tap for each AudioContext. Final
 * mix nodes keep a direct connection to `destination`, while a parallel
 * two-channel tap feeds independent left and right AnalyserNodes. Nothing is
 * patched onto AudioNode prototypes, so native, embedded/WAX, and test runtimes
 * keep their normal Web Audio semantics.
 */
export class AudioOutputManager {
  constructor(runtime = globalThis) {
    this.runtime = safeRuntime(runtime);
    this.contexts = new Map();
    this.sources = new WeakMap();
    this.subscribers = new Set();
    this.timer = null;
    this.listeningForVisibility = false;
    this.listeningForDevices = false;
    this.selectedOutputId = "";
    this.outputDevices = [];
    this.lastLevel = silentLevel();

    this.handleVisibilityChange = () => {
      if (this.isVisible()) {
        this.ensureMeterLoop();
        return;
      }
      this.stopMeterLoop();
      this.lastLevel = silentLevel();
      this.publish();
    };
    this.handleDeviceChange = () => {
      this.refreshOutputDevices().catch(() => {});
    };
  }

  isWaxHost() {
    return Boolean(this.runtime?.MorphazoidWAX);
  }

  isVisible() {
    const documentObject = this.runtime?.document;
    return documentObject?.hidden !== true && documentObject?.visibilityState !== "hidden";
  }

  meteredContextCount() {
    let count = 0;
    for (const record of this.contexts.values()) {
      if (record.leftAnalyser) count += 1;
    }
    return count;
  }

  connectionCount() {
    let count = 0;
    for (const record of this.contexts.values()) count += record.sources.size;
    return count;
  }

  supportsSinkSelection() {
    if (this.isWaxHost()) return false;
    for (const { context } of this.contexts.values()) {
      if (typeof context?.setSinkId === "function") return true;
    }
    const AudioContextConstructor = this.runtime?.AudioContext
      ?? this.runtime?.webkitAudioContext;
    return typeof AudioContextConstructor?.prototype?.setSinkId === "function";
  }

  outputStatus() {
    if (this.isWaxHost()) {
      return Object.freeze({
        mode: "wax-host",
        canSelect: false,
        selectedId: "wax-host",
        label: "DAW / plug-in host",
      });
    }

    const canSelect = this.supportsSinkSelection();
    const hasAudioContext = this.contexts.size > 0
      || typeof (this.runtime?.AudioContext ?? this.runtime?.webkitAudioContext) === "function";
    const device = this.outputDevices.find(({ id }) => id === this.selectedOutputId);
    return Object.freeze({
      mode: canSelect
        ? "browser-selectable"
        : hasAudioContext
        ? "system-default"
        : "unavailable",
      canSelect,
      selectedId: this.selectedOutputId,
      label: device?.label || (this.selectedOutputId ? "Selected audio output" : "System default"),
    });
  }

  getStatus() {
    return Object.freeze({
      ...this.lastLevel,
      monitoring: Boolean(
        this.timer !== null
        && this.subscribers.size > 0
        && this.isVisible()
        && this.meteredContextCount() > 0
      ),
      connectionCount: this.connectionCount(),
      output: this.outputStatus(),
    });
  }

  publish() {
    if (this.subscribers.size === 0) return;
    const status = this.getStatus();
    for (const listener of this.subscribers) {
      try {
        listener(status);
      } catch {
        // One UI observer must not disable metering for the others.
      }
    }
  }

  scheduleMeterTick() {
    if (this.timer !== null || this.subscribers.size === 0 || !this.isVisible()) return;
    if (this.meteredContextCount() === 0) return;
    const schedule = typeof this.runtime?.setTimeout === "function"
      ? this.runtime.setTimeout.bind(this.runtime)
      : globalThis.setTimeout?.bind(globalThis);
    if (!schedule) return;
    this.timer = schedule(() => {
      this.timer = null;
      this.sample();
      this.scheduleMeterTick();
      this.publish();
    }, METER_INTERVAL_MS);
    this.timer?.unref?.();
  }

  ensureMeterLoop() {
    this.scheduleMeterTick();
  }

  stopMeterLoop() {
    if (this.timer === null) return;
    const cancel = typeof this.runtime?.clearTimeout === "function"
      ? this.runtime.clearTimeout.bind(this.runtime)
      : globalThis.clearTimeout?.bind(globalThis);
    cancel?.(this.timer);
    this.timer = null;
  }

  sample() {
    let leftSquareSum = 0;
    let leftSampleCount = 0;
    let leftPeak = 0;
    let rightSquareSum = 0;
    let rightSampleCount = 0;
    let rightPeak = 0;

    for (const record of this.contexts.values()) {
      const { leftAnalyser, rightAnalyser, context } = record;
      if (!leftAnalyser || context?.state === "closed" || context?.state === "suspended") {
        continue;
      }

      const left = readAnalyserChannel(record, leftAnalyser, "leftSamples");
      if (!left) continue;
      const right = rightAnalyser === leftAnalyser
        ? left
        : readAnalyserChannel(record, rightAnalyser, "rightSamples");

      leftSquareSum += left.squareSum;
      leftSampleCount += left.sampleCount;
      if (left.peak > leftPeak) leftPeak = left.peak;
      if (!right) continue;
      rightSquareSum += right.squareSum;
      rightSampleCount += right.sampleCount;
      if (right.peak > rightPeak) rightPeak = right.peak;
    }

    const rawLeftRms = leftSampleCount > 0
      ? Math.sqrt(leftSquareSum / leftSampleCount)
      : 0;
    const rawRightRms = rightSampleCount > 0
      ? Math.sqrt(rightSquareSum / rightSampleCount)
      : 0;
    const sampleCount = leftSampleCount + rightSampleCount;
    const rawRms = sampleCount > 0
      ? Math.sqrt((leftSquareSum + rightSquareSum) / sampleCount)
      : 0;
    const rawPeak = Math.max(leftPeak, rightPeak);
    this.lastLevel = Object.freeze({
      leftRms: Math.min(1, Math.max(0, rawLeftRms)),
      leftPeak: Math.min(1, Math.max(0, leftPeak)),
      rightRms: Math.min(1, Math.max(0, rawRightRms)),
      rightPeak: Math.min(1, Math.max(0, rightPeak)),
      rms: Math.min(1, Math.max(0, rawRms)),
      peak: Math.min(1, Math.max(0, rawPeak)),
      clipped: rawPeak >= 1,
      active: rawPeak >= SILENCE_FLOOR,
    });
    return this.lastLevel;
  }

  addLifecycleListeners() {
    if (!this.listeningForVisibility && this.runtime?.document?.addEventListener) {
      this.runtime.document.addEventListener("visibilitychange", this.handleVisibilityChange);
      this.listeningForVisibility = true;
    }
    const mediaDevices = this.runtime?.navigator?.mediaDevices;
    if (!this.listeningForDevices && mediaDevices?.addEventListener) {
      mediaDevices.addEventListener("devicechange", this.handleDeviceChange);
      this.listeningForDevices = true;
    }
  }

  removeLifecycleListeners() {
    if (this.listeningForVisibility) {
      this.runtime?.document?.removeEventListener?.("visibilitychange", this.handleVisibilityChange);
      this.listeningForVisibility = false;
    }
    if (this.listeningForDevices) {
      this.runtime?.navigator?.mediaDevices?.removeEventListener?.(
        "devicechange",
        this.handleDeviceChange,
      );
      this.listeningForDevices = false;
    }
  }

  subscribe(listener) {
    if (typeof listener !== "function") return noOpRelease;
    this.subscribers.add(listener);
    this.addLifecycleListeners();
    try {
      listener(this.getStatus());
    } catch {
      // Subscription remains valid even if its first render fails.
    }
    this.ensureMeterLoop();

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.subscribers.delete(listener);
      if (this.subscribers.size > 0) return;
      this.stopMeterLoop();
      this.removeLifecycleListeners();
      this.lastLevel = silentLevel();
    };
  }

  createContextRecord(context) {
    let meterInput = null;
    let meterBus = null;
    let splitter = null;
    let leftAnalyser = null;
    let rightAnalyser = null;

    // An explicit two-channel, speaker-interpreted GainNode up-mixes a mono
    // final mix to dual mono before splitting, matching destination playback.
    // It leaves an existing stereo mix (including panning) intact.
    if (
      typeof context?.createGain === "function"
      && typeof context?.createChannelSplitter === "function"
    ) {
      try {
        meterBus = context.createGain();
        meterBus.channelCount = 2;
        meterBus.channelCountMode = "explicit";
        meterBus.channelInterpretation = "speakers";
        if (meterBus.gain) meterBus.gain.value = 1;
        splitter = context.createChannelSplitter(2);
        leftAnalyser = configuredAnalyser(context);
        rightAnalyser = configuredAnalyser(context);
        if (!leftAnalyser || !rightAnalyser) throw new Error("Stereo analyser unavailable");
        meterBus.connect(splitter);
        splitter.connect(leftAnalyser, 0, 0);
        splitter.connect(rightAnalyser, 1, 0);
        meterInput = meterBus;
      } catch {
        safeDisconnect(meterBus);
        safeDisconnect(splitter);
        safeDisconnect(leftAnalyser);
        safeDisconnect(rightAnalyser);
        meterInput = null;
        meterBus = null;
        splitter = null;
        leftAnalyser = null;
        rightAnalyser = null;
      }
    }

    // Minimal Web Audio/test runtimes can still provide a useful dual-mono
    // meter without changing or interrupting their direct destination route.
    if (!meterInput) {
      leftAnalyser = configuredAnalyser(context);
      rightAnalyser = leftAnalyser;
      meterInput = leftAnalyser;
    }

    const record = {
      context,
      meterInput,
      meterBus,
      splitter,
      leftAnalyser,
      rightAnalyser,
      sources: new Set(),
      leftSamples: leftAnalyser ? new Float32Array(DEFAULT_FFT_SIZE) : null,
      rightSamples: rightAnalyser && rightAnalyser !== leftAnalyser
        ? new Float32Array(DEFAULT_FFT_SIZE)
        : null,
    };
    this.contexts.set(context, record);

    if (this.selectedOutputId && typeof context?.setSinkId === "function" && !this.isWaxHost()) {
      Promise.resolve(context.setSinkId(this.selectedOutputId)).catch(() => {});
    }
    return record;
  }

  connect(context, source) {
    if (!context?.destination || typeof source?.connect !== "function") return noOpRelease;
    if (context.state === "closed") return noOpRelease;

    const existing = this.sources.get(source);
    if (existing) {
      existing.references += 1;
      return this.createRelease(source, existing);
    }

    const record = this.contexts.get(context) ?? this.createContextRecord(context);
    const audibleTarget = context.destination;
    try {
      source.connect(audibleTarget);
    } catch {
      if (record.sources.size === 0) this.removeEmptyContextRecord(record);
      return noOpRelease;
    }

    let meterTarget = null;
    if (record.meterInput) {
      try {
        source.connect(record.meterInput);
        meterTarget = record.meterInput;
      } catch {
        // Metering is optional; the direct audible route remains valid.
      }
    }

    const sourceRecord = {
      contextRecord: record,
      audibleTarget,
      meterTarget,
      references: 1,
    };
    record.sources.add(source);
    this.sources.set(source, sourceRecord);
    this.publish();
    this.ensureMeterLoop();
    return this.createRelease(source, sourceRecord);
  }

  createRelease(source, sourceRecord) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      sourceRecord.references -= 1;
      if (sourceRecord.references > 0) return;

      this.sources.delete(source);
      const record = sourceRecord.contextRecord;
      record.sources.delete(source);
      try {
        source.disconnect?.(sourceRecord.audibleTarget);
      } catch {
        // Engines may disconnect their full graph before releasing this lease.
      }
      if (sourceRecord.meterTarget) {
        try {
          source.disconnect?.(sourceRecord.meterTarget);
        } catch {
          // Engines may disconnect their full graph before releasing this lease.
        }
      }
      if (record.sources.size === 0) this.removeEmptyContextRecord(record);
      this.publish();
    };
  }

  removeEmptyContextRecord(record) {
    if (record.sources.size > 0) return;
    if (this.contexts.get(record.context) !== record) return;
    this.contexts.delete(record.context);
    safeDisconnect(record.meterBus);
    safeDisconnect(record.splitter);
    safeDisconnect(record.leftAnalyser);
    if (record.rightAnalyser !== record.leftAnalyser) safeDisconnect(record.rightAnalyser);
    if (this.meteredContextCount() === 0) {
      this.stopMeterLoop();
      this.lastLevel = silentLevel();
    }
  }

  async refreshOutputDevices() {
    if (this.isWaxHost()) {
      this.outputDevices = [frozenOutputDevice("wax-host", "DAW / plug-in host")];
      this.publish();
      return Object.freeze([...this.outputDevices]);
    }
    const enumerate = this.runtime?.navigator?.mediaDevices?.enumerateDevices;
    if (typeof enumerate !== "function") {
      this.outputDevices = [];
      this.publish();
      return Object.freeze([]);
    }
    try {
      const devices = await enumerate.call(this.runtime.navigator.mediaDevices);
      this.outputDevices = devices
        .filter(({ kind }) => kind === "audiooutput")
        .map(({ deviceId, label }, index) => frozenOutputDevice(
          String(deviceId || ""),
          String(label || `Audio output ${index + 1}`),
        ));
    } catch {
      this.outputDevices = [];
    }
    this.publish();
    return Object.freeze([...this.outputDevices]);
  }

  async listOutputDevices() {
    return this.refreshOutputDevices();
  }

  async setOutputDevice(deviceId = "") {
    if (this.isWaxHost()) return false;
    const id = String(deviceId ?? "");
    const contexts = [...this.contexts.values()]
      .map(({ context }) => context)
      .filter((context) => typeof context?.setSinkId === "function");
    if (contexts.length === 0) {
      if (!this.supportsSinkSelection()) return false;
      this.selectedOutputId = id;
      this.publish();
      return true;
    }
    try {
      await Promise.all(contexts.map((context) => context.setSinkId(id)));
    } catch {
      return false;
    }
    this.selectedOutputId = id;
    this.publish();
    return true;
  }
}

/** Return the one manager associated with a browser/WAX runtime. */
export function getSharedAudioOutputManager(runtime = globalThis) {
  const key = safeRuntime(runtime);
  let manager = MANAGERS.get(key);
  if (!manager) {
    manager = new AudioOutputManager(key);
    MANAGERS.set(key, manager);
  }
  return manager;
}

/**
 * Route an engine's final mix node through shared output metering.
 * Returns an idempotent release function for engine teardown.
 */
export function connectAudioOutput(context, source, { runtime = globalThis } = {}) {
  return getSharedAudioOutputManager(runtime).connect(context, source);
}

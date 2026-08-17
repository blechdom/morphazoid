const APP_NAME = "com.morphazoid.wax";
const SCHEMA = "morphazoid-wax";
const SCHEMA_VERSION = 1;
const DEFAULT_PULL_TIMEOUT_MS = 3000;
const DEFAULT_PUSH_DEBOUNCE_MS = 150;
const DEFAULT_PLAYHEAD_READ_DELAY_MS = 50;
const DEFAULT_PROBE_DELAYS_MS = [100, 500, 1500];

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

function cloneJson(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { ok: false, value: null };
    return { ok: true, value: JSON.parse(serialized) };
  } catch {
    return { ok: false, value: null };
  }
}

function clampPlayheadInterval(value) {
  const interval = finiteNumber(value);
  if (interval === null) return 16;
  return Math.min(2000, Math.max(4, Math.round(interval)));
}

export function normalizePlayhead(value) {
  const playhead = isRecord(value) ? value : {};
  const state = isRecord(playhead.state) ? playhead.state : {};
  const tempo = isRecord(playhead.tempo) ? playhead.tempo : {};
  const timing = isRecord(playhead.timing) ? playhead.timing : {};
  const loop = isRecord(playhead.loop) ? playhead.loop : {};

  return {
    isPlaying: nullableBoolean(state.isPlaying),
    isRecording: nullableBoolean(state.isRecording),
    isLooping: nullableBoolean(state.isLooping),
    bpm: finiteNumber(tempo.bpm),
    timeSigNumerator: finiteNumber(tempo.timeSigNumerator),
    timeSigDenominator: finiteNumber(tempo.timeSigDenominator),
    timeInSamples: finiteNumber(timing.timeInSamples),
    timeInSeconds: finiteNumber(timing.timeInSeconds),
    ppqPosition: finiteNumber(timing.ppqPosition),
    ppqPositionOfLastBarStart: finiteNumber(timing.ppqPositionOfLastBarStart),
    ppqLoopStart: finiteNumber(loop.ppqLoopStart),
    ppqLoopEnd: finiteNumber(loop.ppqLoopEnd),
  };
}

export function validateWaxEnvelope(value) {
  if (!isRecord(value)) return null;
  if (value.schema !== SCHEMA || value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isRecord(value.pages)) return null;
  if (value.route !== null && value.route !== undefined && typeof value.route !== "string") return null;

  const pages = {};
  for (const [id, entry] of Object.entries(value.pages)) {
    if (!id || !isRecord(entry)) continue;
    if (!Number.isInteger(entry.stateVersion) || entry.stateVersion < 1) continue;
    const state = cloneJson(entry.state);
    if (!state.ok) continue;
    pages[id] = {
      stateVersion: entry.stateVersion,
      state: state.value,
    };
  }

  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    route: typeof value.route === "string" && value.route ? value.route : null,
    pages,
  };
}

function emptyEnvelope() {
  return {
    schema: SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    route: null,
    pages: {},
  };
}

function validateAdapter(adapter) {
  if (!isRecord(adapter) || typeof adapter.id !== "string" || !adapter.id.trim()) {
    throw new TypeError("MorphazoidWAX.register() requires a stable adapter id");
  }
  if (adapter.id !== adapter.id.trim()) {
    throw new TypeError("Morphazoid WAX adapter ids cannot start or end with whitespace");
  }
  if (adapter.stateVersion !== undefined
      && (!Number.isInteger(adapter.stateVersion) || adapter.stateVersion < 1)) {
    throw new TypeError("Morphazoid WAX stateVersion must be a positive integer");
  }
}

export function createWaxHostBridge(runtime, options = {}) {
  if (!runtime) throw new TypeError("A window-like runtime is required");

  const pullTimeoutMs = options.pullTimeoutMs ?? DEFAULT_PULL_TIMEOUT_MS;
  const pushDebounceMs = options.pushDebounceMs ?? DEFAULT_PUSH_DEBOUNCE_MS;
  const playheadReadDelayMs = options.playheadReadDelayMs ?? DEFAULT_PLAYHEAD_READ_DELAY_MS;
  const probeDelaysMs = options.probeDelaysMs ?? DEFAULT_PROBE_DELAYS_MS;
  const adapters = new Map();
  const dirtyAdapterIds = new Set();
  const listenerCleanup = [];
  const probeTimers = new Set();

  let activeAdapterId = null;
  let callbackWasInvoked = Boolean(options.callbackWasInvoked);
  let continuousPlayheadTimer = null;
  let continuousPlayheadStarted = false;
  let debounceTimer = null;
  let detected = false;
  let disposed = false;
  let documentReady = runtime.document?.readyState !== "loading";
  let envelope = emptyEnvelope();
  let hydrationSignature = null;
  let initialPullPromise = Promise.resolve(null);
  let pullSettled = false;
  let pullStarted = false;
  let providerInstalled = false;
  let revision = 0;
  let started = false;
  let latestBpm = null;
  let latestPlayState = null;
  let suppressDirty = false;

  const reportError = (scope, error) => {
    runtime.console?.error?.(`Morphazoid WAX: ${scope}`, error);
    if (typeof runtime.dispatchEvent === "function" && typeof runtime.CustomEvent === "function") {
      try {
        runtime.dispatchEvent(new runtime.CustomEvent("morphazoid:wax-error", {
          detail: { scope, error },
        }));
      } catch {
        // Error reporting must never interfere with the page.
      }
    }
  };

  const capabilities = () => {
    const dataTree = runtime.WAX_DataTree;
    return {
      dataTree: Boolean(
        dataTree
        && typeof dataTree.pull === "function"
        && typeof dataTree.push === "function",
      ),
      midi: Boolean(runtime.navigator && typeof runtime.navigator.requestMIDIAccess === "function"),
      playhead: Boolean(
        typeof runtime.WAX_RequestPlayheadInfo === "function"
        && typeof runtime.Request_PlayheadTimerStart === "function"
        && typeof runtime.Request_PlayheadTimerStop === "function",
      ),
      transport: callbackWasInvoked,
    };
  };

  const safeAdapterCall = (record, scope, callback, ...args) => {
    if (typeof callback !== "function") return undefined;
    try {
      return callback.apply(record.adapter, args);
    } catch (error) {
      reportError(`${record.id} ${scope} failed`, error);
      return undefined;
    }
  };

  const captureRecordState = (record, suppliedState) => {
    let candidate = suppliedState;
    if (candidate === undefined && typeof record.adapter.getState === "function") {
      candidate = safeAdapterCall(record, "getState", record.adapter.getState);
    }
    const snapshot = cloneJson(candidate);
    if (!snapshot.ok) return false;

    envelope.pages[record.id] = {
      stateVersion: record.stateVersion,
      state: snapshot.value,
    };
    return true;
  };

  const snapshotEnvelope = () => {
    const base = validateWaxEnvelope(envelope) || emptyEnvelope();
    for (const record of adapters.values()) captureRecordState(record);
    base.pages = { ...base.pages, ...envelope.pages };
    base.route = activeAdapterId || base.route;
    const snapshot = cloneJson(base);
    return snapshot.ok ? snapshot.value : emptyEnvelope();
  };

  const installProvider = () => {
    if (providerInstalled || !pullSettled) return;
    const dataTree = runtime.WAX_DataTree;
    if (!dataTree || typeof dataTree.setProvider !== "function") return;
    try {
      dataTree.setProvider(() => snapshotEnvelope());
      providerInstalled = true;
    } catch (error) {
      reportError("DataTree provider registration failed", error);
    }
  };

  const applyStoredState = (record, source) => {
    const stored = envelope.pages[record.id];
    if (!stored || typeof record.adapter.applyState !== "function") return;
    const cloned = cloneJson(stored.state);
    if (!cloned.ok) return;

    suppressDirty = true;
    try {
      safeAdapterCall(record, "applyState", record.adapter.applyState, cloned.value, {
        source: "wax-hydration",
        stateVersion: stored.stateVersion,
        delivery: source,
      });
    } finally {
      suppressDirty = false;
    }
  };

  const applyHydration = (value, source) => {
    if (disposed) return false;
    const validated = validateWaxEnvelope(value);
    if (!validated) return false;

    const signature = JSON.stringify(validated);
    if (signature === hydrationSignature) return false;
    hydrationSignature = signature;

    const preserveInitialEdits = !pullSettled;
    const localPages = {};
    if (preserveInitialEdits) {
      for (const id of dirtyAdapterIds) {
        const record = adapters.get(id);
        if (record) captureRecordState(record);
        if (envelope.pages[id]) localPages[id] = envelope.pages[id];
      }
    } else {
      if (debounceTimer !== null && typeof runtime.clearTimeout === "function") {
        runtime.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      dirtyAdapterIds.clear();
    }

    envelope = validated;
    Object.assign(envelope.pages, localPages);

    for (const record of adapters.values()) {
      if (!preserveInitialEdits || !dirtyAdapterIds.has(record.id)) {
        applyStoredState(record, source);
      }
    }
    return true;
  };

  const schedulePush = () => {
    if (!pullSettled || disposed) return false;
    if (debounceTimer !== null && typeof runtime.clearTimeout === "function") {
      runtime.clearTimeout(debounceTimer);
    }
    if (typeof runtime.setTimeout !== "function") return false;
    debounceTimer = runtime.setTimeout(() => {
      debounceTimer = null;
      void flush();
    }, Math.max(0, pushDebounceMs));
    return true;
  };

  const noteStateChange = (record, suppliedState, source = "user") => {
    if (disposed || suppressDirty || source === "wax-hydration") return false;
    if (!captureRecordState(record, suppliedState)) return false;
    activeAdapterId = record.id;
    envelope.route = record.id;
    dirtyAdapterIds.add(record.id);
    hydrationSignature = null;
    revision += 1;
    if (pullSettled) schedulePush();
    return true;
  };

  const maybeEnableMidi = (record) => {
    if (record.midiAttempted || !documentReady || !detected) return;
    if (pullStarted && !pullSettled) return;
    if (typeof record.adapter.enableMidi !== "function") return;
    record.midiAttempted = true;
    try {
      Promise.resolve(record.adapter.enableMidi()).catch((error) => {
        reportError(`${record.id} MIDI enable failed`, error);
      });
    } catch (error) {
      reportError(`${record.id} MIDI enable failed`, error);
    }
  };

  const stopContinuousPlayhead = () => {
    if (continuousPlayheadTimer !== null && typeof runtime.clearInterval === "function") {
      runtime.clearInterval(continuousPlayheadTimer);
    }
    continuousPlayheadTimer = null;

    if (continuousPlayheadStarted && typeof runtime.Request_PlayheadTimerStop === "function") {
      try {
        runtime.Request_PlayheadTimerStop();
      } catch (error) {
        reportError("playhead timer stop failed", error);
      }
    }
    continuousPlayheadStarted = false;
  };

  const startContinuousPlayhead = () => {
    stopContinuousPlayhead();
    if (!detected || !capabilities().playhead || typeof runtime.setInterval !== "function") return;

    const activeRecord = activeAdapterId ? adapters.get(activeAdapterId) : null;
    const recipients = activeRecord
      && typeof activeRecord.adapter.transport?.playhead === "function"
      ? [activeRecord]
      : [];
    if (!recipients.length) return;

    const interval = Math.min(...recipients.map(
      (record) => clampPlayheadInterval(record.adapter.transport.playheadIntervalMs),
    ));
    try {
      runtime.Request_PlayheadTimerStart(interval);
      continuousPlayheadStarted = true;
    } catch (error) {
      reportError("playhead timer start failed", error);
      return;
    }

    continuousPlayheadTimer = runtime.setInterval(() => {
      const playhead = normalizePlayhead(runtime.PlayheadInfo);
      const record = activeAdapterId ? adapters.get(activeAdapterId) : null;
      if (record) {
        safeAdapterCall(record, "transport.playhead", record.adapter.transport?.playhead, playhead);
      }
    }, interval);
  };

  const maybeStartDataTree = () => {
    if (disposed || pullStarted || !detected || !capabilities().dataTree) return initialPullPromise;
    const dataTree = runtime.WAX_DataTree;
    pullStarted = true;

    if (typeof dataTree.onHydrated === "function") {
      try {
        dataTree.onHydrated((value) => applyHydration(value, "onHydrated"));
      } catch (error) {
        reportError("DataTree hydration callback registration failed", error);
      }
    }

    let pullResult;
    try {
      pullResult = dataTree.pull(APP_NAME, pullTimeoutMs);
    } catch (error) {
      pullResult = Promise.reject(error);
    }

    initialPullPromise = Promise.resolve(pullResult)
      .then((value) => {
        applyHydration(value, "pull");
        return value;
      })
      .catch((error) => {
        reportError("DataTree pull failed; using page defaults", error);
        return null;
      })
      .finally(() => {
        pullSettled = true;
        installProvider();
        for (const record of adapters.values()) maybeEnableMidi(record);
        if (dirtyAdapterIds.size) schedulePush();
      });

    return initialPullPromise;
  };

  const refreshDetection = () => {
    if (disposed) return false;
    const available = capabilities();
    const wasDetected = detected;
    detected = callbackWasInvoked || available.dataTree || available.playhead;
    if (!detected) return false;

    void maybeStartDataTree();
    for (const record of adapters.values()) maybeEnableMidi(record);
    if (!wasDetected || !continuousPlayheadStarted) startContinuousPlayhead();
    return true;
  };

  function flush() {
    if (debounceTimer !== null && typeof runtime.clearTimeout === "function") {
      runtime.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (disposed || !pullSettled || !capabilities().dataTree) return Promise.resolve(false);

    const dataTree = runtime.WAX_DataTree;
    const snapshot = snapshotEnvelope();
    const pushedRevision = revision;
    let result;
    try {
      result = dataTree.push(snapshot, APP_NAME);
    } catch (error) {
      reportError("DataTree push failed", error);
      return Promise.resolve(false);
    }

    return Promise.resolve(result)
      .then(() => {
        if (revision === pushedRevision) dirtyAdapterIds.clear();
        else schedulePush();
        return true;
      })
      .catch((error) => {
        reportError("DataTree push failed", error);
        return false;
      });
  }

  const markDirty = (source = "user") => {
    const record = activeAdapterId ? adapters.get(activeAdapterId) : null;
    if (!record) return false;
    return noteStateChange(record, undefined, source);
  };

  const requestPlayhead = () => {
    if (!capabilities().playhead) return Promise.resolve(null);
    detected = true;
    try {
      runtime.WAX_RequestPlayheadInfo();
    } catch (error) {
      reportError("playhead request failed", error);
      return Promise.resolve(null);
    }

    if (typeof runtime.setTimeout !== "function") {
      return Promise.resolve(normalizePlayhead(runtime.PlayheadInfo));
    }
    return new Promise((resolve) => {
      runtime.setTimeout(
        () => resolve(normalizePlayhead(runtime.PlayheadInfo)),
        Math.max(0, playheadReadDelayMs),
      );
    });
  };

  const handleTransport = (type, value) => {
    if (disposed) return false;
    callbackWasInvoked = true;
    refreshDetection();

    if (type === "bpm") {
      const bpm = finiteNumber(value);
      if (bpm === null || bpm <= 0) return false;
      latestBpm = bpm;
      const record = activeAdapterId ? adapters.get(activeAdapterId) : null;
      if (record) {
        safeAdapterCall(record, "transport.bpm", record.adapter.transport?.bpm, bpm);
      }
      return true;
    }

    if (type !== "play" && type !== "stop") return false;
    latestPlayState = type === "play";
    const playhead = normalizePlayhead(runtime.PlayheadInfo);
    const record = activeAdapterId ? adapters.get(activeAdapterId) : null;
    if (record) {
      const callback = latestPlayState
        ? record.adapter.transport?.play
        : record.adapter.transport?.stop;
      safeAdapterCall(record, `transport.${type}`, callback, playhead);
    }
    return true;
  };

  const register = (adapter) => {
    validateAdapter(adapter);
    if (disposed) throw new Error("The Morphazoid WAX bridge has been disposed");
    if (adapters.has(adapter.id)) {
      throw new Error(`Morphazoid WAX adapter already registered: ${adapter.id}`);
    }

    const record = {
      adapter,
      id: adapter.id,
      midiAttempted: false,
      stateVersion: adapter.stateVersion ?? 1,
      unsubscribe: null,
    };
    adapters.set(record.id, record);
    activeAdapterId = record.id;
    envelope.route = record.id;

    if (typeof adapter.subscribeState === "function") {
      suppressDirty = true;
      let unsubscribe;
      try {
        unsubscribe = safeAdapterCall(
          record,
          "subscribeState",
          adapter.subscribeState,
          (state, source) => noteStateChange(record, state, source),
        );
      } finally {
        suppressDirty = false;
      }
      if (typeof unsubscribe === "function") record.unsubscribe = unsubscribe;
    }

    if (pullSettled || envelope.pages[record.id]) applyStoredState(record, "registration");
    if (latestBpm !== null) {
      safeAdapterCall(record, "transport.bpm", adapter.transport?.bpm, latestBpm);
    }
    if (latestPlayState !== null) {
      const type = latestPlayState ? "play" : "stop";
      const callback = latestPlayState ? adapter.transport?.play : adapter.transport?.stop;
      safeAdapterCall(record, `transport.${type}`, callback, normalizePlayhead(runtime.PlayheadInfo));
    }

    maybeEnableMidi(record);
    startContinuousPlayhead();

    let unregistered = false;
    return function unregisterWaxAdapter() {
      if (unregistered) return;
      unregistered = true;
      const current = adapters.get(record.id);
      if (current !== record) return;
      if (typeof record.unsubscribe === "function") {
        try {
          record.unsubscribe();
        } catch (error) {
          reportError(`${record.id} state unsubscribe failed`, error);
        }
      }
      captureRecordState(record);
      adapters.delete(record.id);
      if (activeAdapterId === record.id) {
        activeAdapterId = [...adapters.keys()].at(-1) || null;
      }
      startContinuousPlayhead();
    };
  };

  const start = () => {
    if (started || disposed) return;
    started = true;

    const onDocumentReady = () => {
      documentReady = true;
      refreshDetection();
      for (const record of adapters.values()) maybeEnableMidi(record);
    };
    if (!documentReady && typeof runtime.document?.addEventListener === "function") {
      runtime.document.addEventListener("DOMContentLoaded", onDocumentReady, { once: true });
      listenerCleanup.push(() => runtime.document.removeEventListener?.("DOMContentLoaded", onDocumentReady));
    }

    const onPageHide = () => {
      for (const record of adapters.values()) captureRecordState(record);
      void flush();
      stopContinuousPlayhead();
    };
    const onPageShow = (event) => {
      if (!event?.persisted) return;
      documentReady = true;
      for (const record of adapters.values()) record.midiAttempted = false;
      refreshDetection();
    };
    if (typeof runtime.addEventListener === "function") {
      runtime.addEventListener("pagehide", onPageHide);
      runtime.addEventListener("pageshow", onPageShow);
      listenerCleanup.push(() => runtime.removeEventListener?.("pagehide", onPageHide));
      listenerCleanup.push(() => runtime.removeEventListener?.("pageshow", onPageShow));
    }

    refreshDetection();
    for (const delay of probeDelaysMs) {
      if (typeof runtime.setTimeout !== "function") break;
      const token = runtime.setTimeout(() => {
        probeTimers.delete(token);
        refreshDetection();
      }, Math.max(0, delay));
      probeTimers.add(token);
    }
  };

  const dispose = () => {
    if (disposed) return;
    for (const record of adapters.values()) captureRecordState(record);
    void flush();
    disposed = true;

    if (debounceTimer !== null && typeof runtime.clearTimeout === "function") {
      runtime.clearTimeout(debounceTimer);
    }
    debounceTimer = null;
    for (const token of probeTimers) runtime.clearTimeout?.(token);
    probeTimers.clear();
    stopContinuousPlayhead();
    for (const cleanup of listenerCleanup.splice(0)) cleanup();
    for (const record of adapters.values()) {
      try {
        record.unsubscribe?.();
      } catch (error) {
        reportError(`${record.id} state unsubscribe failed`, error);
      }
    }
    adapters.clear();
  };

  const bridge = {
    capabilities,
    dispose,
    flush,
    handleTransport,
    markDirty,
    refreshDetection,
    register,
    requestPlayhead,
    start,
    get initialPull() {
      return initialPullPromise;
    },
    get detected() {
      return detected;
    },
  };

  return bridge;
}

export function installWaxHostBridge(runtime, bootstrapState) {
  if (!runtime || !bootstrapState) throw new TypeError("WAX bootstrap state is required");
  if (bootstrapState.implementation) return bootstrapState.facade;

  const bridge = createWaxHostBridge(runtime, {
    callbackWasInvoked: bootstrapState.callbackWasInvoked,
  });
  bootstrapState.implementation = bridge;
  bridge.start();

  for (const event of bootstrapState.transportEvents.splice(0)) {
    bridge.handleTransport(event.type, event.value);
  }
  for (const pending of bootstrapState.registrations.splice(0)) {
    if (!pending.active) continue;
    try {
      pending.unregister = bridge.register(pending.adapter);
    } catch (error) {
      runtime.console?.error?.("Morphazoid WAX: queued adapter registration failed", error);
    }
  }
  for (const command of bootstrapState.commands.splice(0)) {
    if (command.type === "markDirty") bridge.markDirty(command.value);
  }

  return bootstrapState.facade;
}

export const WAX_HOST_CONSTANTS = Object.freeze({
  APP_NAME,
  SCHEMA,
  SCHEMA_VERSION,
});

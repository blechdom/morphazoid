export const ACOUSTIC_LIVE_CAPTURE_LIMITS = Object.freeze({
  minDurationSeconds: 1,
  maxDurationSeconds: 30,
  defaultDurationSeconds: 12,
  bufferSize: 2048,
});

export const ACOUSTIC_CAPTURE_ERROR_CODES = Object.freeze({
  insecureContext: "insecure-context",
  unavailable: "unavailable",
  permissionDenied: "permission-denied",
  noInputDevice: "no-input-device",
  deviceBusy: "device-busy",
  unsupportedPcm: "unsupported-pcm",
  startFailed: "start-failed",
  processingFailed: "processing-failed",
  cancelled: "cancelled",
});

export class AcousticCaptureError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AcousticCaptureError";
    this.code = code;
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeCaptureDuration(durationSeconds) {
  const value = Number(durationSeconds);
  if (!Number.isFinite(value)) return ACOUSTIC_LIVE_CAPTURE_LIMITS.defaultDurationSeconds;
  return clamp(
    value,
    ACOUSTIC_LIVE_CAPTURE_LIMITS.minDurationSeconds,
    ACOUSTIC_LIVE_CAPTURE_LIMITS.maxDurationSeconds,
  );
}

function isLocalHostname(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "[::1]"
    || hostname === "::1";
}

function contextIsInsecure(secureContext, locationRef) {
  if (secureContext === false) return true;
  if (secureContext === true) return false;
  const protocol = locationRef?.protocol;
  if (!protocol) return false;
  return protocol !== "https:" && !isLocalHostname(locationRef?.hostname);
}

function stopStreamTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // A device track may already have ended independently.
    }
  }
}

function disconnectNode(node) {
  try {
    node?.disconnect?.();
  } catch {
    // Closing an AudioContext can disconnect its nodes first.
  }
}

function makeCancelledError() {
  const error = new AcousticCaptureError(
    ACOUSTIC_CAPTURE_ERROR_CODES.cancelled,
    "Microphone capture was cancelled.",
  );
  error.name = "AbortError";
  return error;
}

function mapStartError(error) {
  if (error instanceof AcousticCaptureError) return error;
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return new AcousticCaptureError(
      ACOUSTIC_CAPTURE_ERROR_CODES.permissionDenied,
      "Microphone permission was denied. Allow microphone access and try again.",
      { cause: error },
    );
  }
  if (error?.name === "SecurityError") {
    return new AcousticCaptureError(
      ACOUSTIC_CAPTURE_ERROR_CODES.insecureContext,
      "Microphone capture requires HTTPS or localhost.",
      { cause: error },
    );
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return new AcousticCaptureError(
      ACOUSTIC_CAPTURE_ERROR_CODES.noInputDevice,
      "No microphone input device is available.",
      { cause: error },
    );
  }
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return new AcousticCaptureError(
      ACOUSTIC_CAPTURE_ERROR_CODES.deviceBusy,
      "The microphone is unavailable or already in use by another application.",
      { cause: error },
    );
  }
  return new AcousticCaptureError(
    ACOUSTIC_CAPTURE_ERROR_CODES.startFailed,
    "Microphone capture could not start.",
    { cause: error },
  );
}

function makeFinishedPromise() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  // Capture can end automatically before a caller awaits `finished`.
  promise.catch(() => {});
  return { promise, reject, resolve };
}

function concatenateChunks(chunks, sampleCount) {
  const samples = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

function peakLevel(samples) {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  return clamp(peak, 0, 1);
}

function callSafely(callback, value) {
  if (typeof callback !== "function") return;
  try {
    callback(value);
  } catch {
    // Meter and presentation callbacks must not interrupt PCM capture.
  }
}

function audioContextClassFromGlobal() {
  return globalThis.AudioContext ?? globalThis.webkitAudioContext;
}

function exactDeviceId(deviceId) {
  if (typeof deviceId !== "string") return null;
  const value = deviceId.trim();
  return value && value !== "default" ? value : null;
}

/**
 * Bounded mono microphone capture for analysis, not continuous streaming.
 * `start()` is the only operation that requests device permission. Await
 * `stop()` or `finished` for `{ samples, sampleRate, duration }`.
 */
export class AcousticLiveCapture {
  constructor({
    maxDurationSeconds = ACOUSTIC_LIVE_CAPTURE_LIMITS.defaultDurationSeconds,
    onLevel = null,
    onProgress = null,
    navigatorRef = globalThis.navigator,
    AudioContextClass = audioContextClassFromGlobal(),
    secureContext = globalThis.isSecureContext,
    locationRef = globalThis.location,
    setTimeoutFn = globalThis.setTimeout?.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout?.bind(globalThis),
    queueMicrotaskFn = globalThis.queueMicrotask?.bind(globalThis),
    bufferSize = ACOUSTIC_LIVE_CAPTURE_LIMITS.bufferSize,
  } = {}) {
    this.maxDurationSeconds = normalizeCaptureDuration(maxDurationSeconds);
    this.onLevel = onLevel;
    this.onProgress = onProgress;
    this.navigatorRef = navigatorRef;
    this.AudioContextClass = AudioContextClass;
    this.secureContext = secureContext;
    this.locationRef = locationRef;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.queueMicrotaskFn = queueMicrotaskFn ?? ((callback) => Promise.resolve().then(callback));
    this.bufferSize = Number.isInteger(bufferSize) ? bufferSize : ACOUSTIC_LIVE_CAPTURE_LIMITS.bufferSize;
    this.finished = Promise.resolve(null);
    this._generation = 0;
    this._session = null;
    this._state = "idle";
  }

  get state() {
    return this._state;
  }

  get isRecording() {
    return this._state === "recording";
  }

  get duration() {
    const session = this._session;
    if (!session?.sampleRate) return 0;
    return session.sampleCount / session.sampleRate;
  }

  _validateSupport() {
    if (contextIsInsecure(this.secureContext, this.locationRef)) {
      throw new AcousticCaptureError(
        ACOUSTIC_CAPTURE_ERROR_CODES.insecureContext,
        "Microphone capture requires HTTPS or localhost.",
      );
    }
    if (typeof this.navigatorRef?.mediaDevices?.getUserMedia !== "function") {
      throw new AcousticCaptureError(
        ACOUSTIC_CAPTURE_ERROR_CODES.unavailable,
        "Microphone access is not available in this browser.",
      );
    }
    if (typeof this.AudioContextClass !== "function") {
      throw new AcousticCaptureError(
        ACOUSTIC_CAPTURE_ERROR_CODES.unavailable,
        "Web Audio capture is not available in this browser.",
      );
    }
  }

  _makeSession(maxDurationSeconds) {
    const settlement = makeFinishedPromise();
    return {
      autoStopScheduled: false,
      chunks: [],
      context: null,
      endedListeners: [],
      finished: settlement.promise,
      generation: ++this._generation,
      inputEnded: false,
      maxDurationSeconds,
      mute: null,
      processor: null,
      rejectFinished: settlement.reject,
      resolveFinished: settlement.resolve,
      sampleCount: 0,
      sampleRate: 0,
      settled: false,
      source: null,
      stream: null,
      timer: null,
    };
  }

  _settle(session, method, value) {
    if (session.settled) return;
    session.settled = true;
    session[method](value);
  }

  async _cleanup(session) {
    if (!session) return;
    if (session.timer !== null && typeof this.clearTimeoutFn === "function") {
      try {
        this.clearTimeoutFn(session.timer);
      } catch {
        // A host timer can already have fired.
      }
      session.timer = null;
    }
    if (session.processor) session.processor.onaudioprocess = null;
    for (const { track, listener } of session.endedListeners) {
      try {
        track.removeEventListener?.("ended", listener);
      } catch {
        // Some MediaStreamTrack shims only implement addEventListener.
      }
    }
    session.endedListeners.length = 0;
    disconnectNode(session.source);
    disconnectNode(session.processor);
    disconnectNode(session.mute);
    stopStreamTracks(session.stream);
    if (session.context && session.context.state !== "closed") {
      try {
        await session.context.close?.();
      } catch {
        // Device release above remains effective if context shutdown fails.
      }
    }
    if (this._session === session) {
      this._session = null;
      this._state = "idle";
    }
  }

  _schedule(callback) {
    this.queueMicrotaskFn(callback);
  }

  _handleAudioProcess(session, event) {
    if (this._session !== session || this._state !== "recording") return;
    try {
      const input = event?.inputBuffer?.getChannelData?.(0);
      if (!input || typeof input.length !== "number") {
        throw new Error("The microphone supplied an invalid PCM buffer.");
      }
      const maximumSamples = Math.round(session.sampleRate * session.maxDurationSeconds);
      const remaining = maximumSamples - session.sampleCount;
      if (remaining <= 0) return;
      const recorded = Float32Array.from(
        remaining < input.length ? input.subarray(0, remaining) : input,
      );
      session.chunks.push(recorded);
      session.sampleCount += recorded.length;

      callSafely(this.onLevel, peakLevel(recorded));
      const elapsedSeconds = session.sampleCount / session.sampleRate;
      callSafely(this.onProgress, Object.freeze({
        elapsedSeconds,
        maxDurationSeconds: session.maxDurationSeconds,
        progress: clamp(elapsedSeconds / session.maxDurationSeconds, 0, 1),
      }));

      if (session.sampleCount >= maximumSamples && !session.autoStopScheduled) {
        session.autoStopScheduled = true;
        this._schedule(() => {
          if (this._session === session && this._state === "recording") void this.stop();
        });
      }
    } catch (error) {
      const captureError = new AcousticCaptureError(
        ACOUSTIC_CAPTURE_ERROR_CODES.processingFailed,
        "The microphone audio stream could not be captured.",
        { cause: error },
      );
      this._schedule(() => {
        void this._fail(session, captureError);
      });
    }
  }

  async _fail(session, error) {
    if (this._session !== session || session.settled) return;
    this._state = "stopping";
    await this._cleanup(session);
    this._settle(session, "rejectFinished", error);
  }

  async start({ maxDurationSeconds = this.maxDurationSeconds, deviceId = null } = {}) {
    if (this._state !== "idle") {
      throw new AcousticCaptureError(
        ACOUSTIC_CAPTURE_ERROR_CODES.startFailed,
        "A microphone capture is already in progress.",
      );
    }
    this._validateSupport();

    const duration = normalizeCaptureDuration(maxDurationSeconds);
    const session = this._makeSession(duration);
    this._session = session;
    this._state = "starting";
    this.finished = session.finished;

    try {
      const selectedDeviceId = exactDeviceId(deviceId);
      const audio = {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
      if (selectedDeviceId) audio.deviceId = { exact: selectedDeviceId };
      const stream = await this.navigatorRef.mediaDevices.getUserMedia({ audio });
      if (this._session !== session || session.generation !== this._generation) {
        stopStreamTracks(stream);
        throw makeCancelledError();
      }
      session.stream = stream;

      const context = new this.AudioContextClass();
      session.context = context;
      session.sampleRate = Number(context.sampleRate);
      if (!Number.isFinite(session.sampleRate) || session.sampleRate <= 0) {
        throw new Error("The audio device reported an invalid sample rate.");
      }
      const createProcessor = context.createScriptProcessor?.bind(context)
        ?? context.createJavaScriptNode?.bind(context);
      if (!createProcessor) {
        throw new AcousticCaptureError(
          ACOUSTIC_CAPTURE_ERROR_CODES.unsupportedPcm,
          "Uncompressed microphone capture is not supported in this browser.",
        );
      }

      session.source = context.createMediaStreamSource(stream);
      session.processor = createProcessor(this.bufferSize, 1, 1);
      session.mute = context.createGain();
      session.mute.gain.value = 0;
      session.processor.onaudioprocess = (event) => this._handleAudioProcess(session, event);
      session.source.connect(session.processor);
      session.processor.connect(session.mute);
      session.mute.connect(context.destination);

      for (const track of stream.getTracks?.() ?? []) {
        const listener = () => {
          session.inputEnded = true;
          if (this._session === session && this._state === "recording") void this.stop();
        };
        track.addEventListener?.("ended", listener, { once: true });
        session.endedListeners.push({ listener, track });
      }

      if (context.state === "suspended" && typeof context.resume === "function") {
        await context.resume();
      }
      if (session.inputEnded) {
        throw new AcousticCaptureError(
          ACOUSTIC_CAPTURE_ERROR_CODES.noInputDevice,
          "The microphone stopped before capture could begin.",
        );
      }
      if (this._session !== session || session.generation !== this._generation) {
        throw makeCancelledError();
      }

      this._state = "recording";
      if (typeof this.setTimeoutFn === "function") {
        session.timer = this.setTimeoutFn(() => {
          if (this._session === session && this._state === "recording") void this.stop();
        }, duration * 1000);
      }
      callSafely(this.onLevel, 0);
      callSafely(this.onProgress, Object.freeze({
        elapsedSeconds: 0,
        maxDurationSeconds: duration,
        progress: 0,
      }));
      return this;
    } catch (error) {
      const mappedError = session.generation !== this._generation
        ? makeCancelledError()
        : mapStartError(error);
      await this._cleanup(session);
      if (!session.settled) this._settle(session, "rejectFinished", mappedError);
      throw mappedError;
    }
  }

  async stop() {
    const session = this._session;
    if (!session) return this.finished;
    if (this._state === "starting") return this.cancel();
    if (this._state === "stopping") return session.finished;

    this._state = "stopping";
    const samples = concatenateChunks(session.chunks, session.sampleCount);
    const result = Object.freeze({
      samples,
      sampleRate: session.sampleRate,
      duration: samples.length / session.sampleRate,
    });
    await this._cleanup(session);
    this._settle(session, "resolveFinished", result);
    return result;
  }

  async cancel() {
    this._generation += 1;
    const session = this._session;
    if (!session) return null;
    this._state = "stopping";
    await this._cleanup(session);
    this._settle(session, "resolveFinished", null);
    return null;
  }
}

export const AUDIO_STARTUP_TIMEOUT_MS = 8_000;

/** Bound browser operations which may remain pending rather than reject. */
export function withAudioTimeout(operation, {
  timeoutMs = AUDIO_STARTUP_TIMEOUT_MS,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => finish(reject, new DOMException("Audio startup cancelled.", "AbortError"));
    // Attach rejection handling even if the attempt has already been cancelled.
    Promise.resolve(operation).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      const error = new Error("Audio did not start. Tap Audio to retry.");
      error.name = "AudioStartupTimeoutError";
      finish(reject, error);
    }, timeoutMs);
  });
}

/** Call immediately from the Audio gesture, before fetching worklets/assets. */
export function resumeAudioContext(context, options) {
  if (!context || context.state === "closed") {
    return Promise.reject(new Error("Audio is closed. Tap Audio to restart."));
  }
  let operation;
  try {
    operation = context.state === "running" ? Promise.resolve() : context.resume();
  } catch (error) {
    return Promise.reject(error);
  }
  return withAudioTimeout(operation, options).then(() => {
    if (context.state !== "running") {
      throw new Error("Audio is interrupted. Tap Audio to resume.");
    }
    return context;
  });
}

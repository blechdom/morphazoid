import { ANALYSIS_LIMITS, BEAT_ANALYSIS_VERSION } from "./beat-analysis.js";
export { BEAT_ANALYSIS_VERSION };

const abortError = () => new DOMException("Beat analysis cancelled", "AbortError");
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** Copy at most 72 seconds/two channels at <=12 kHz, with task-queue yields.
 * Only these owned copies may be transferred; never detach playback's PCM.
 * A short box average before decimation suppresses high-frequency aliasing.
 */
export async function copyAnalysisWindows(buffer, { isCancelled = () => false, yieldControl = yieldTask } = {}) {
  if (!Number.isFinite(buffer?.sampleRate) || buffer.sampleRate < 1000 || buffer.sampleRate > 384000 ||
      !Number.isSafeInteger(buffer.length) || buffer.length < 0 || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1) throw new TypeError("Invalid decoded audio buffer");
  const stride = Math.max(1, Math.ceil(buffer.sampleRate / ANALYSIS_LIMITS.sampleRate));
  const sampleRate = buffer.sampleRate / stride;
  const duration = buffer.length / buffer.sampleRate;
  const span = Math.min(ANALYSIS_LIMITS.windowSeconds, duration);
  const lastStart = Math.max(0, duration - span);
  const starts = duration <= span ? [0] : duration < span * 2 ? [0, lastStart] : [0, lastStart / 2, lastStart];
  const windows = [];
  const sourceChannels = Array.from({ length: Math.min(buffer.numberOfChannels, ANALYSIS_LIMITS.channels) }, (_, index) => buffer.getChannelData(index));
  let budget = 0;
  for (const start of starts) {
    const first = Math.round(start * buffer.sampleRate);
    const length = Math.floor(Math.min(span * buffer.sampleRate, buffer.length - first) / stride);
    const channels = [];
    for (const source of sourceChannels) {
      const samples = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        if (isCancelled()) throw abortError();
        let sum = 0;
        for (let j = 0; j < stride; j++) sum += source[first + i * stride + j];
        samples[i] = sum / stride;
        // Bound work between yields by original sample count, including high
        // sample-rate files. Abort/dispose are observed between copied chunks.
        budget += stride;
        if (budget >= 32768) {
          budget = 0;
          await yieldControl();
          if (isCancelled()) throw abortError();
        }
      }
      channels.push(samples);
    }
    windows.push({ startTime: first / buffer.sampleRate, channels });
  }
  if (isCancelled()) throw abortError();
  return { sampleRate, windows };
}

/** One cancellable analysis at a time. Use one instance per deck. No main-thread
 * analysis fallback: if Worker is unavailable the caller retains a manual grid.
 */
export function createBeatAnalyzer({ WorkerClass = globalThis.Worker, timeoutMs = 15000 } = {}) {
  let current = null; let serial = 0; let disposed = false;
  function finish(job, error, result) {
    if (job.finished) return;
    job.finished = true;
    job.worker?.terminate();
    clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.abort);
    if (current === job) current = null;
    if (error) job.reject(error); else job.resolve(result);
  }
  function cancel() { if (current) finish(current, abortError()); }
  function analyze(buffer, { signal } = {}) {
    cancel();
    if (disposed || signal?.aborted) return Promise.reject(abortError());
    if (typeof WorkerClass !== "function") return Promise.reject(new Error("Background beat analysis is unavailable in this browser"));
    return new Promise((resolve, reject) => {
      const job = { id: ++serial, resolve, reject, signal, worker: null, timer: null, finished: false, abort: null };
      current = job;
      job.abort = () => finish(job, abortError());
      signal?.addEventListener("abort", job.abort, { once: true });
      job.timer = setTimeout(() => finish(job, new Error("Beat analysis timed out")), Math.max(1, Math.min(60000, Number(timeoutMs) || 15000)));
      void (async () => {
        try {
          const request = await copyAnalysisWindows(buffer, { isCancelled: () => job.finished });
          if (job.finished) return;
          job.worker = new WorkerClass(new URL("./beat-analysis-worker.js", import.meta.url), { type: "module", name: "trackazoid-beat-analysis" });
          job.worker.onmessage = ({ data }) => {
            if (job.finished || data?.id !== job.id) return;
            if (data.error) finish(job, new Error(data.error));
            else if (!data.result || data.result.version !== BEAT_ANALYSIS_VERSION) finish(job, new Error("Invalid beat analysis result"));
            else finish(job, null, data.result);
          };
          job.worker.onerror = event => { event.preventDefault?.(); finish(job, new Error(event.message || "Beat analysis worker failed")); };
          job.worker.onmessageerror = () => finish(job, new Error("Beat analysis message could not be read"));
          job.worker.postMessage({ id: job.id, ...request }, request.windows.flatMap(window => window.channels.map(channel => channel.buffer)));
        } catch (error) { finish(job, error); }
      })();
    });
  }
  return { analyze, cancel, dispose() { disposed = true; cancel(); } };
}

import { renderFractalImageAsync } from './fractal-explorer.js';

/** Latest-wins worker: at most one render and one pending request are retained. */
export function installExplorerWorker(scope, options = {}) {
  let revision = 0, pending = null, running = false, disposed = false;
  // Each chunk must yield a task so incoming requests can cancel it. Chained
  // timers impose a ~4 ms delay per chunk even when the calculation is cheap.
  const channel = options.yieldTask ? null : new MessageChannel();
  let resume;
  if (channel) channel.port1.onmessage = () => { const next = resume; resume = undefined; next?.(); };
  const yieldTask = options.yieldTask || (() => new Promise(resolve => {
    resume = resolve; channel.port2.postMessage(0);
  }));
  async function drain() {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const request = pending, activeRevision = revision; pending = null;
        const image = await renderFractalImageAsync(request, { ...options, yieldTask,
          isCancelled: () => disposed || activeRevision !== revision });
        if (image && !disposed && activeRevision === revision) scope.postMessage(image, [image.pixels.buffer]);
      }
    } finally { running = false; }
  }
  scope.onmessage = ({ data }) => {
    if (disposed) return;
    revision++; pending = data && typeof data === 'object' ? data : {};
    void drain();
  };
  return () => {
    disposed = true; revision++; pending = null; scope.onmessage = null;
    resume?.(); resume = undefined; channel?.port1.close(); channel?.port2.close();
  };
}

if (typeof self !== 'undefined') installExplorerWorker(self);

import { renderFractalImageAsync } from './fractal-explorer.js';

/** Latest-wins worker: at most one render and one pending request are retained. */
export function installExplorerWorker(scope, options = {}) {
  let revision = 0, pending = null, running = false, disposed = false;
  async function drain() {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const request = pending, activeRevision = revision; pending = null;
        const image = await renderFractalImageAsync(request, { ...options,
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
  return () => { disposed = true; revision++; pending = null; scope.onmessage = null; };
}

if (typeof self !== 'undefined') installExplorerWorker(self);

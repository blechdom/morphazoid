import { buildNetwork } from './model.js';

let queued = null;
let scheduled = false;
let latestRevision = -1;

// Main-thread revision guards remain necessary: synchronous computation cannot
// see messages that arrived during that computation. Coalesce queued requests
// before starting a build; never emit a partial graph or animate preparation.
self.addEventListener('message', event => {
  const message = event.data;
  if (!message || message.type !== 'build' || !Number.isSafeInteger(message.revision) || message.revision <= latestRevision) return;
  latestRevision = message.revision;
  queued = message;
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const request = queued; queued = null;
    try {
      const started = performance.now();
      const network = buildNetwork(request.parameters, request.budget, request.options);
      self.postMessage({ type: 'network', revision: request.revision, network, buildMs: performance.now() - started });
    } catch (error) {
      self.postMessage({ type: 'error', revision: request.revision, message: String(error?.message ?? error) });
    }
  }, 0);
});

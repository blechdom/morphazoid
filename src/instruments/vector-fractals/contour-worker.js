import { computeContoursAsync, sanitizeContourRequest } from "./contour-model.js";

let revision = 0;
let pending = null;
let running = false;

function postResult(id, phase, result) {
  self.postMessage({ id, phase, result }, [
    result.points.buffer, result.offsets.buffer, result.closed.buffer,
  ]);
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending) {
      const { request, token } = pending;
      pending = null;
      const isCancelled = () => token !== revision;
      try {
        // A small first pass makes pan/zoom feedback useful before detailed work.
        if (request.resolution > 112) {
          const preview = await computeContoursAsync({ ...request, resolution: 112 }, { isCancelled });
          if (!preview || isCancelled()) continue;
          postResult(request.id, "preview", preview);
          // A real task-queue yield lets new messages replace a finished preview.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (isCancelled()) continue;
        const result = await computeContoursAsync(request, { isCancelled });
        if (result && !isCancelled()) postResult(request.id, "complete", result);
      } catch (error) {
        if (!isCancelled()) self.postMessage({
          id: request.id, phase: "error", error: error?.message ?? String(error),
        });
      }
    }
  } finally {
    running = false;
  }
}

self.onmessage = ({ data }) => {
  if (!data || typeof data !== "object") return;
  if (data.type === "cancel") {
    revision += 1;
    pending = null;
    return;
  }
  if (data.type && data.type !== "compute") return;
  revision += 1;
  pending = { request: sanitizeContourRequest(data), token: revision };
  void drain();
};

import { computeContoursAsync, sanitizeContourRequest } from "./contour-model.js";

let revision = 0;
let pending = null;
let running = false;

function postResult(id, phase, result, layers = null) {
  // Fine is both the legacy result and layers[2]. Transfer its buffers only
  // once; structured clone preserves that shared identity in the receiving UI.
  const geometry = layers || [result];
  const transfers = [...new Set(geometry.flatMap(layer => [
    layer.points.buffer, layer.offsets.buffer, layer.closed.buffer,
  ]))];
  self.postMessage(layers ? { id, phase, result, layers } : { id, phase, result }, transfers);
}

async function computePass(request, isCancelled) {
  if (!request.layered) {
    const result = await computeContoursAsync(request, { isCancelled });
    return result && { result };
  }
  const layers = [];
  // These are distinct field levels, rather than simplified copies of one
  // outline. The common sampling grid keeps every level spatially comparable.
  const spacing = Math.min(4, (request.depth - .5) / 2);
  for (const depth of [request.depth - 2 * spacing, request.depth - spacing, request.depth]) {
    if (isCancelled()) return null;
    const result = await computeContoursAsync({ ...request, depth }, { isCancelled });
    if (!result || isCancelled()) return null;
    layers.push(result);
  }
  return { result: layers[2], layers };
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
          const preview = await computePass({ ...request, resolution: 112 }, isCancelled);
          if (!preview || isCancelled()) continue;
          postResult(request.id, "preview", preview.result, preview.layers);
          // A real task-queue yield lets new messages replace a finished preview.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (isCancelled()) continue;
        const result = await computePass(request, isCancelled);
        if (result && !isCancelled()) postResult(request.id, "complete", result.result, result.layers);
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
  pending = { request: { ...sanitizeContourRequest(data), layered: data.layered === true }, token: revision };
  void drain();
};

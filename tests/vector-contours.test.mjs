import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { Worker } from "node:worker_threads";
import {
  computeContours,
  computeContoursAsync,
  contourDepthForView,
  logGreenPotential,
  sanitizeContourRequest,
  sanitizeContourView,
} from "../src/instruments/vector-fractals/contour-model.js";

const whole = { view: { x: -0.5, y: 0, width: 4, aspect: 1 }, depth: 2, resolution: 128 };
const cusp = {
  view: { x: 0.25004571205576365, y: 0, width: 1e-10, aspect: 1 },
  depth: 320, resolution: 96,
};

function validateGeometry(result) {
  const { points, offsets, closed, view, stats } = result;
  assert.ok(points instanceof Float32Array);
  assert.ok(offsets instanceof Uint32Array);
  assert.ok(closed instanceof Uint8Array);
  assert.equal(offsets.length, closed.length + 1);
  assert.equal(offsets[0], 0);
  assert.equal(offsets.at(-1), points.length / 2);
  assert.equal(stats.vertices, points.length / 2);
  assert.equal(stats.pathCount, closed.length);
  assert.ok(stats.computationMs >= 0 && Number.isFinite(stats.computationMs));
  assert.ok(stats.grid.columns * stats.grid.rows <= 240_000);
  let segments = 0;
  for (let path = 0; path < closed.length; path += 1) {
    const begin = offsets[path];
    const end = offsets[path + 1];
    assert.ok(end - begin >= (closed[path] ? 3 : 2));
    segments += end - begin - (closed[path] ? 0 : 1);
    for (let i = begin; i < end; i += 1) {
      const x = points[2 * i];
      const y = points[2 * i + 1];
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(Math.abs(x) <= 0.5000001 && Math.abs(y) <= 0.5 / view.aspect + 1e-7);
    }
    if (!closed[path]) {
      for (const i of [begin, end - 1]) {
        const x = points[2 * i];
        const y = points[2 * i + 1];
        assert.ok(Math.abs(Math.abs(x) - 0.5) < 1e-6
          || Math.abs(Math.abs(y) - 0.5 / view.aspect) < 1e-6,
        "an open fragment must end on the crop boundary, never inside the view");
      }
    }
  }
  assert.equal(stats.segments, segments);
}

test("log Green potential matches independent high-radius orbit values and conjugation", () => {
  // Oracle uses z0=c, a 1e40 escape radius, and a long independent iteration cap.
  const oracle = [
    [1, 0, -0.8980714094529989],
    [2, 0, -0.09478374725979588],
    [0.5, 0.5, -2.5142435259499623],
    [-0.75, 0.1, -22.148363531864256],
    [0.2501, 0, -215.68379684377467],
    [0.25005, 0, -305.8802230622349],
    [0.25004, 0, -342.229091820589],
  ];
  for (const [x, y, expected] of oracle) {
    assert.ok(Math.abs(logGreenPotential(x, y) - expected) < 1e-10);
    assert.equal(logGreenPotential(x, -y), logGreenPotential(x, y));
  }
  assert.equal(logGreenPotential(0), -Infinity);
  assert.equal(logGreenPotential(-1), -Infinity);
  assert.ok(logGreenPotential(0.25005) > -320);
  assert.ok(logGreenPotential(0.25004) < -320);
  assert.ok(Math.abs(logGreenPotential(0, 1e160) - Math.log(160 * Math.LN10)) < 1e-12);
  assert.ok(Number.isFinite(logGreenPotential(Number.MAX_VALUE, Number.MAX_VALUE)));
});

test("a fully visible low-depth equipotential forms one ordered closed loop", () => {
  const result = computeContours(whole);
  validateGeometry(result);
  assert.deepEqual(Array.from(result.closed), [1]);
  assert.ok(result.stats.vertices > 200);
  let largestStep = 0;
  for (let i = 0; i < result.stats.vertices; i += 1) {
    const j = (i + 1) % result.stats.vertices;
    largestStep = Math.max(largestStep, Math.hypot(
      result.points[2 * i] - result.points[2 * j],
      result.points[2 * i + 1] - result.points[2 * j + 1],
    ));
    const ell = logGreenPotential(result.view.x + result.points[2 * i] * result.view.width,
      result.view.y + result.points[2 * i + 1] * result.view.width);
    assert.ok(Math.abs(ell + result.depth) < 0.002, "each vertex lies on the requested field level");
  }
  assert.ok(largestStep < Math.SQRT2 / whole.resolution);
});

test("a cropped contour is an open arc with no artificial crop-boundary closure", () => {
  const result = computeContours({
    view: { x: 0.595723344651244, y: 0, width: 0.3, aspect: 1 },
    depth: 2, resolution: 96,
  });
  validateGeometry(result);
  assert.deepEqual(Array.from(result.closed), [0]);
  assert.equal(result.stats.segments, result.stats.vertices - 1);
  assert.ok(Math.abs(result.points[1] - result.points.at(-1)) > 0.99);
});

test("depth 320 at a 1e-10-wide cusp retains distinct normalized geometry", () => {
  const result = computeContours(cusp);
  validateGeometry(result);
  assert.deepEqual(Array.from(result.closed), [0]);
  assert.ok(result.stats.maxIterations >= 465 && result.stats.maxIterations < 470);
  assert.ok(result.stats.vertices >= 97);
  assert.ok(new Set(result.points).size > 90, "normalization precedes the Float32 conversion");
  for (let i = 0; i < result.points.length; i += 2) {
    assert.ok(Math.abs(result.points[i]) < 0.001, "the independent real-axis intersection remains centered");
  }
});

test("deep Seahorse fragments preserve complete paths and boundary endpoints", () => {
  const result = computeContours({
    view: { x: -0.743643887037151, y: 0.13182590420533, width: 0.0005, aspect: 1.4 },
    depth: 160, resolution: 160,
  });
  validateGeometry(result);
  assert.ok(result.stats.pathCount > 20);
  assert.ok(result.closed.includes(0) && result.closed.includes(1));
  assert.equal(result.stats.underresolved, true);
  assert.ok(result.stats.uncertainClosedPaths > 0);
});

test("finite-grid topology is flagged and centered views sample the real-axis antenna", () => {
  const result = computeContours({
    view: { x: -0.5, y: 0, width: 3.4, aspect: 1.4 }, depth: 12, resolution: 360,
  });
  validateGeometry(result);
  assert.equal(result.stats.grid.rows % 2, 0);
  let leftmost = Infinity;
  for (let i = 0; i < result.points.length; i += 2) leftmost = Math.min(leftmost, result.points[i]);
  assert.ok(result.view.x + leftmost * result.view.width < -1.999);
  assert.ok(result.stats.uncertainClosedPaths > 0);
  assert.equal(result.stats.underresolved, true);
});

function unorderedPoints(result, reflectY = false) {
  const points = [];
  for (let i = 0; i < result.points.length; i += 2) {
    points.push(`${result.points[i].toFixed(5)},${((reflectY ? -1 : 1) * result.points[i + 1]).toFixed(5)}`);
  }
  return points.sort();
}

test("repeated requests are byte-stable and reflected views preserve conjugate geometry", () => {
  const request = { view: { x: -0.6, y: 0.7, width: 1, aspect: 1.3 }, depth: 4, resolution: 120 };
  const first = computeContours(request);
  const repeat = computeContours(request);
  assert.deepEqual(first.points, repeat.points);
  assert.deepEqual(first.offsets, repeat.offsets);
  assert.deepEqual(first.closed, repeat.closed);
  const reflection = computeContours({ ...request, view: { ...request.view, y: -request.view.y } });
  assert.deepEqual(unorderedPoints(first), unorderedPoints(reflection, true));
});

function distanceToSegments(x, y, result) {
  let best = Infinity;
  for (let path = 0; path < result.closed.length; path += 1) {
    const begin = result.offsets[path];
    const end = result.offsets[path + 1];
    for (let i = begin; i < end - (result.closed[path] ? 0 : 1); i += 1) {
      const j = i + 1 === end ? begin : i + 1;
      const ax = result.points[2 * i];
      const ay = result.points[2 * i + 1];
      const dx = result.points[2 * j] - ax;
      const dy = result.points[2 * j + 1] - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return best;
}

test("doubling resolution converges geometrically to a high-resolution reference", () => {
  const reference = computeContours({ ...whole, resolution: 384 });
  const errorFor = (resolution) => {
    const result = computeContours({ ...whole, resolution });
    let maximum = 0;
    for (let i = 0; i < reference.points.length; i += 2) {
      maximum = Math.max(maximum, distanceToSegments(reference.points[i], reference.points[i + 1], result));
    }
    return maximum;
  };
  const coarse = errorFor(48);
  const fine = errorFor(96);
  assert.ok(fine < coarse * 0.6, `${fine} must improve substantially from ${coarse}`);
  assert.ok(fine < 0.001);
});

test("interior and far exterior crops return valid empty results", () => {
  for (const view of [
    { x: 0, y: 0, width: 0.1, aspect: 1 },
    { x: 3, y: 3, width: 0.1, aspect: 1 },
  ]) {
    const result = computeContours({ view, depth: 160, resolution: 32 });
    validateGeometry(result);
    assert.equal(result.points.length, 0);
    assert.deepEqual(Array.from(result.offsets), [0]);
  }
});

test("invalid and oversized requests are bounded before allocating the grid", () => {
  assert.deepEqual(sanitizeContourView(null), sanitizeContourView({}));
  const request = sanitizeContourRequest({
    view: { x: 1e300, y: NaN, width: -4, aspect: 0 }, depth: Infinity, resolution: 1e300,
  });
  assert.deepEqual(request.view, { x: 4, y: 0, width: 1e-10, aspect: 0.2 });
  assert.equal(request.resolution, 900);
  assert.equal(request.depth, 320);
  assert.equal(contourDepthForView({ width: 3.4 }), 12);
  assert.equal(contourDepthForView({ width: 1e-10 }), 320);
  const result = computeContours({ view: { x: 3, y: 3, width: 1, aspect: 1 }, resolution: 900 });
  validateGeometry(result);
  assert.equal(result.stats.limited, true);
});

test("cooperative computation yields to real tasks and returns null after cancellation", async () => {
  let cancelled = false;
  const timer = setTimeout(() => { cancelled = true; }, 0);
  try {
    const result = await computeContoursAsync({ ...cusp, resolution: 900 }, {
      isCancelled: () => cancelled, sliceMs: 1,
    });
    assert.equal(cancelled, true);
    assert.equal(result, null);
  } finally {
    clearTimeout(timer);
  }
  const result = await computeContoursAsync(whole);
  assert.deepEqual(result.points, computeContours(whole).points);
});

async function startWorker(t) {
  const url = new URL("../src/instruments/vector-fractals/contour-worker.js", import.meta.url);
  const worker = new Worker(`
    const { parentPort } = require("node:worker_threads");
    globalThis.self = { postMessage: (...args) => parentPort.postMessage(...args) };
    import(${JSON.stringify(url.href)}).then(() => {
      parentPort.on("message", data => self.onmessage({ data }));
      parentPort.postMessage({ boot: true });
    });
  `, { eval: true });
  t.after(() => worker.terminate());
  const [ready] = await once(worker, "message");
  assert.equal(ready.boot, true);
  return worker;
}

function nextComplete(worker, id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Worker result timed out")); }, 5000);
    const listener = (message) => {
      if (message.id !== id) return;
      if (message.phase === "error") { cleanup(); reject(new Error(message.error)); }
      if (message.phase === "complete") { cleanup(); resolve(message.result); }
    };
    const cleanup = () => { clearTimeout(timeout); worker.off("message", listener); };
    worker.on("message", listener);
  });
}

test("actual Worker transfers preview/full buffers and only completes the latest request", { timeout: 10_000 }, async (t) => {
  const worker = await startWorker(t);
  const messages = [];
  worker.on("message", (message) => messages.push(message));
  worker.postMessage({ ...cusp, resolution: 900, id: "stale", type: "compute" });
  const completed = nextComplete(worker, "latest");
  await new Promise((resolve) => setTimeout(resolve, 4));
  worker.postMessage({ ...whole, id: "latest" });
  const result = await completed;
  validateGeometry(result);
  assert.equal(messages.some(({ id, phase }) => id === "stale" && phase === "complete"), false);
  const latest = messages.filter(({ id }) => id === "latest");
  assert.deepEqual(latest.map(({ phase }) => phase), ["preview", "complete"]);
  assert.ok(latest[0].result.points.byteLength > 0);
  assert.deepEqual(result.points, computeContours(whole).points);
});

test("Worker cancel suppresses full output after a preview and accepts the next request", { timeout: 10_000 }, async (t) => {
  const worker = await startWorker(t);
  const messages = [];
  worker.on("message", (message) => {
    messages.push(message);
    if (message.id === "cancelled" && message.phase === "preview") worker.postMessage({ type: "cancel" });
  });
  worker.postMessage({ ...cusp, resolution: 900, id: "cancelled" });
  while (!messages.some(({ phase }) => phase === "preview")) await once(worker, "message");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(messages.some(({ phase }) => phase === "complete"), false);
  const completed = nextComplete(worker, "next");
  worker.postMessage({ ...whole, resolution: 64, id: "next" });
  validateGeometry(await completed);
  assert.deepEqual(messages.filter(({ id }) => id === "next").map(({ phase }) => phase), ["complete"]);
});

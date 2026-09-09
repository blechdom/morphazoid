let sharedControl = null;

function publish(type, value = {}) {
  globalThis.postMessage({ type, ...value });
}

globalThis.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "ping") {
    if (sharedControl) Atomics.add(sharedControl, 2, 1);
    publish("pong", { shared: Boolean(sharedControl) });
    return;
  }
  if (message.type !== "init") return;
  try {
    const bytes = message.simdBytes || message.scalarBytes;
    if (!bytes) throw new TypeError("Worker kernel bytes are missing.");
    const started = globalThis.performance.now();
    const module = await WebAssembly.compile(bytes);
    const instance = new WebAssembly.Instance(module);
    const laneWidth = Number(instance.exports.lane_width?.() || 1);
    const sharedAvailable = typeof SharedArrayBuffer === "function"
      && message.sharedBuffer instanceof SharedArrayBuffer;
    sharedControl = sharedAvailable ? new Int32Array(message.sharedBuffer) : null;
    if (sharedControl) {
      Atomics.store(sharedControl, 0, 1);
      Atomics.store(sharedControl, 1, laneWidth);
      Atomics.notify(sharedControl, 0);
    }
    publish("ready", {
      shared: sharedAvailable,
      laneWidth,
      compileMs: Math.max(0, globalThis.performance.now() - started),
    });
  } catch (error) {
    publish("error", { message: error?.message || "Worker prep failed." });
  }
};

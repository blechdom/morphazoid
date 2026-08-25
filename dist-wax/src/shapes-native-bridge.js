export const SHAPES_BRIDGE_PROPERTY = "morphazoidShapesBridge";
export const SHAPES_BRIDGE_READY_EVENT = "morphazoid:shapes-bridge-ready";

const optionalMethod = (adapter, name, fallback) => (
  typeof adapter?.[name] === "function" ? adapter[name].bind(adapter) : fallback
);

/**
 * Publish a small same-origin adapter without moving DSP or transport ownership
 * out of the native instrument. The Shapes host uses this only for state
 * handoff, audio gating, and bank-local resets.
 */
export function installShapesNativeBridge(adapter = {}, runtime = globalThis) {
  const bridge = Object.freeze({
    version: 1,
    geometry: adapter.geometry ?? "shape",
    sound: adapter.sound ?? "synth",
    capabilities: Object.freeze({ ...(adapter.capabilities ?? {}) }),
    captureState: optionalMethod(adapter, "captureState", () => ({})),
    applyState: optionalMethod(adapter, "applyState", () => undefined),
    prepareAudio: optionalMethod(adapter, "prepareAudio", async () => undefined),
    setHostGain: optionalMethod(adapter, "setHostGain", () => undefined),
    parkAudio: optionalMethod(adapter, "parkAudio", () => undefined),
    disableAudio: optionalMethod(adapter, "disableAudio", () => undefined),
    resetBank: optionalMethod(adapter, "resetBank", () => false),
  });

  try {
    Object.defineProperty(runtime, SHAPES_BRIDGE_PROPERTY, {
      configurable: true,
      value: bridge,
    });
  } catch {
    runtime[SHAPES_BRIDGE_PROPERTY] = bridge;
  }

  const EventConstructor = runtime.CustomEvent ?? globalThis.CustomEvent;
  if (typeof runtime.dispatchEvent === "function" && typeof EventConstructor === "function") {
    runtime.dispatchEvent(new EventConstructor(SHAPES_BRIDGE_READY_EVENT, {
      detail: { geometry: bridge.geometry, sound: bridge.sound, version: bridge.version },
    }));
  }
  return bridge;
}

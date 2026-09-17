import { runInNewContext } from "node:vm";

// Execute a frozen/current resize callback against observable canvas/owner
// stand-ins. No page app, audio graph, worker, or DOM is constructed.
export function runCanvasResize(source, bounds, devicePixelRatio, {
  disposed = false,
  activeGesture = false,
  scheduledFrame = 0,
  repetitions = 1,
} = {}) {
  const calls = [];
  const backing = { width: 300, height: 150 };
  const styles = {};
  const runtime = {
    cssWidth: 1, cssHeight: 1, pixelRatio: 1,
    visualizationDirty: false, tileEditorDirty: false,
    worldScale: 1, viewBounds: null, layout: null,
    currentSpatialCell: "previous-cell",
    activePointerGesture: activeGesture ? { lastPoint: { x: 1, y: 2 } } : null,
    disposed, scheduledFrame,
    performance: { now: () => 1234 },
    stageWrap: { getBoundingClientRect() { calls.push(["measure"]); return bounds; } },
    window: { devicePixelRatio },
    runtime: { devicePixelRatio },
    devicePixelRatio,
  };
  runtime.canvas = {
    get width() { return backing.width; },
    set width(value) {
      backing.width = value;
      calls.push(["width", value, runtime.cssWidth, runtime.cssHeight, runtime.pixelRatio]);
    },
    get height() { return backing.height; },
    set height(value) { backing.height = value; calls.push(["height", value]); },
    style: new Proxy(styles, {
      set(target, name, value) { target[name] = value; calls.push(["style", name, value]); return true; },
    }),
  };
  for (const name of ["context", "context2d"]) {
    runtime[name] = { setTransform(...args) { calls.push([name, "setTransform", ...args]); } };
  }
  for (const name of [
    "scheduleFrame", "scheduleVisualization", "invalidate", "invalidateGeometry",
    "draw", "drawStage", "paintReadouts", "cancelAnimationFrame",
  ]) {
    runtime[name] = (...args) => { calls.push([name, ...args]); };
  }
  runtime.computeLayout = () => {
    calls.push(["computeLayout", runtime.cssWidth, runtime.cssHeight]);
    return { width: runtime.cssWidth, height: runtime.cssHeight };
  };
  runtime.currentSpatialGrid = () => {
    calls.push(["currentSpatialGrid", runtime.cssWidth, runtime.cssHeight]);
    return { width: runtime.cssWidth, height: runtime.cssHeight };
  };
  return {
    execute(canvasSizing) {
      runtime.canvasSizing = canvasSizing;
      runInNewContext(`${source}\n${"resizeCanvas();\n".repeat(repetitions)}`, runtime);
      return structuredClone({
        cssWidth: runtime.cssWidth, cssHeight: runtime.cssHeight, pixelRatio: runtime.pixelRatio,
        backing, styles, calls,
        worldScale: runtime.worldScale, viewBounds: runtime.viewBounds, layout: runtime.layout,
        visualizationDirty: runtime.visualizationDirty, tileEditorDirty: runtime.tileEditorDirty,
        currentSpatialCell: runtime.currentSpatialCell, activePointerGesture: runtime.activePointerGesture,
        scheduledFrame: runtime.scheduledFrame,
      });
    },
  };
}

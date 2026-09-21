import assert from "node:assert/strict";
import test from "node:test";
import { anchorChoosePickerPanel, choosePickerPanelBounds } from "../src/ui/patterns/choose-picker-shell.js";

test("preset popups start below their own heading rather than at the navigation edge", () => {
  assert.deepEqual(
    choosePickerPanelBounds({ left: 820, bottom: 48 }, { width: 1440, height: 900 }),
    { left: 820, top: 52, width: 380, height: 540 },
  );
});

test("a trigger near the right edge keeps the whole popup on screen", () => {
  const result = choosePickerPanelBounds({ left: 1190, bottom: 50 }, { width: 1440, height: 900 });
  assert.equal(result.left, 1052);
  assert.equal(result.left + result.width, 1432);
  assert.equal(result.top, 54);
  assert.ok(result.left <= 1190 && result.left + result.width >= 1190);
});

test("phone and landscape placement follows the actual header row and fits below it", () => {
  for (const [width, height, left, bottom] of [
    [390, 844, 92, 108],
    [844, 390, 292, 108],
    [320, 568, 8, 164],
  ]) {
    const result = choosePickerPanelBounds({ left, bottom }, { width, height });
    assert.equal(result.top, bottom + 4);
    assert.ok(result.left >= 8);
    assert.ok(result.left + result.width <= width - 8);
    assert.ok(result.top + result.height <= height - 8);
    assert.ok(result.height > 0);
  }
});

test("visual viewport offsets and a smaller visible area are respected", () => {
  const viewport = { width: 390, height: 400, offsetLeft: 100, offsetTop: 40 };
  const result = choosePickerPanelBounds({ left: 150, bottom: 130 }, viewport);
  assert.equal(result.left, 108);
  assert.equal(result.top, 134);
  assert.equal(result.width, 374);
  assert.ok(result.top + result.height <= 432);
  const tiny = choosePickerPanelBounds({ left: 0, bottom: 80 }, { width: 6, height: 5 });
  assert.ok(Object.values(tiny).every(value => Number.isFinite(value) && value >= 0));
  assert.ok(tiny.left + tiny.width <= 6);
  assert.ok(tiny.top + tiny.height <= 5);
});

function eventSource(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    listeners,
    addEventListener(type, callback, options) {
      if (!listeners.has(type)) listeners.set(type, new Map());
      listeners.get(type).set(callback, options);
    },
    removeEventListener(type, callback, options) {
      assert.equal(listeners.get(type)?.get(callback), options);
      listeners.get(type)?.delete(callback);
    },
    emit(type, event = {}) {
      for (const callback of listeners.get(type)?.keys() ?? []) callback(event);
    },
  };
}

test("anchoring updates on open, header resize, document scroll and visual viewport changes; teardown releases listeners", () => {
  let rect = { left: 820, bottom: 48 };
  let measurements = 0;
  const doc = eventSource({ documentElement: { clientWidth: 1440, clientHeight: 900 } });
  const header = {};
  const summary = eventSource({
    ownerDocument: doc,
    closest: () => header,
    getBoundingClientRect() { measurements++; return rect; },
  });
  const details = eventSource({ open: false });
  const panel = { style: {}, contains: target => target === panel };
  const visualViewport = eventSource({ width: 1440, height: 900, offsetLeft: 0, offsetTop: 0 });
  let observer;
  const runtime = eventSource({
    visualViewport,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.observed = []; observer = this; }
      observe(target) { this.observed.push(target); }
      disconnect() { this.disconnected = true; }
    },
  });
  const anchor = anchorChoosePickerPanel({ details, summary, panel }, runtime);
  assert.equal(panel.style.left, "820px");
  assert.equal(panel.style.top, "52px");
  assert.deepEqual(observer.observed, [summary, header]);

  rect = { left: 870, bottom: 54 };
  summary.emit("click");
  assert.equal(panel.style.left, "870px");
  assert.equal(panel.style.top, "58px");
  details.open = true;
  rect = { left: 900, bottom: 64 };
  details.emit("toggle");
  assert.equal(panel.style.top, "68px");

  rect = { left: 920, bottom: 72 };
  runtime.emit("resize");
  assert.equal(panel.style.left, "920px");
  rect = { left: 940, bottom: 76 };
  observer.callback();
  assert.equal(panel.style.left, "940px");
  const beforePanelScroll = measurements;
  doc.emit("scroll", { target: panel });
  assert.equal(measurements, beforePanelScroll);
  rect = { left: 920, bottom: 70 };
  doc.emit("scroll", { target: doc });
  assert.equal(panel.style.top, "74px");

  visualViewport.width = 390;
  visualViewport.height = 844;
  rect = { left: 92, bottom: 108 };
  visualViewport.emit("resize");
  assert.equal(panel.style.left, "8px");
  assert.equal(panel.style.top, "112px");
  assert.equal(panel.style.width, "374px");
  visualViewport.offsetTop = 30;
  visualViewport.emit("scroll");
  assert.equal(panel.style.top, "112px");

  details.open = false;
  const beforeClosedResize = measurements;
  runtime.emit("resize");
  assert.equal(measurements, beforeClosedResize);
  rect = { left: 88, bottom: 100 };
  summary.emit("keydown", { key: "Enter" });
  assert.equal(panel.style.top, "104px");

  anchor.destroy();
  assert.equal(observer.disconnected, true);
  for (const source of [summary, details, doc, runtime, visualViewport]) {
    assert.equal([...source.listeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0);
  }
  const finalMeasurements = measurements;
  details.open = true;
  observer.callback(); // Already-queued callbacks must also be harmless.
  assert.equal(measurements, finalMeasurements);
});

test("positioning still works without optional viewport or ResizeObserver support", () => {
  const doc = eventSource({ documentElement: { clientWidth: 844, clientHeight: 390 } });
  const summary = eventSource({ ownerDocument: doc, closest: () => null, getBoundingClientRect: () => ({ left: 210, bottom: 92 }) });
  const details = eventSource({ open: false });
  const panel = { style: {}, contains: () => false };
  const runtime = eventSource({});
  const anchor = anchorChoosePickerPanel({ summary, details, panel }, runtime);
  assert.equal(panel.style.left, "210px");
  assert.equal(panel.style.top, "96px");
  assert.equal(panel.style.height, "273px");
  anchor.destroy();
});

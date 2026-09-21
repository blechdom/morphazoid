import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { parse } from "acorn";
import * as model from "../src/instruments/shepard-risset/shepard-risset.js";

const html = await readFile(new URL("../shepard-risset.html", import.meta.url), "utf8");
const source = await readFile(new URL("../src/instruments/shepard-risset/shepard-risset-app.js", import.meta.url), "utf8");
const imports = parse(source, { sourceType: "module", ecmaVersion: "latest" }).body.filter(node => node.type === "ImportDeclaration");
let script = source;
for (const node of imports.toReversed()) script = script.slice(0, node.start) + script.slice(node.end);

// Actual page IDs, actual controller and real model/default sanitizers.
// Only DOM/Audio/render scheduling are stubbed; missing IDs return null.
function boot(code = script) {
  const ids = new Map(), globalEvents = new Map(), documentEvents = new Map();
  const frames = new Map(), audioCalls = { starts: 0, stops: 0, closes: 0, parameters: [] };
  let nextFrame = 0, observerDisconnected = false;
  function element(tag = "") {
    const attrs = new Map([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    const listeners = new Map(), classes = new Set();
    const node = {
      attrs, listeners, children: [], dataset: {}, style: {}, textContent: "",
      value: attrs.get("value") ?? "", hidden: /\bhidden\b/.test(tag),
      disabled: false, width: 300, height: 150,
      classList: {
        add: name => classes.add(name),
        toggle(name, active) {
          const on = active ?? !classes.has(name);
          if (on) classes.add(name); else classes.delete(name);
          return on;
        },
      },
      setAttribute: (name, value) => attrs.set(name, String(value)),
      getAttribute: name => attrs.get(name) ?? null,
      addEventListener: (name, callback) => listeners.set(name, callback),
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      querySelectorAll(selector) { return this.children.filter(child => selector === "[data-preset]" && child.dataset.preset); },
      closest(selector) {
        return selector === "[data-mode]" && this.dataset.mode
          || selector === "[data-preset]" && this.dataset.preset
          || selector === "[data-value]" && this.dataset.value ? this : null;
      },
      getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    };
    for (const [key, value] of attrs) if (key.startsWith("data-")) node.dataset[key.slice(5)] = value;
    return node;
  }
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) ids.set(match[1], element(match[0]));
  const resetTag = html.match(/<button\b[^>]*\bdata-reset-all\b[^>]*>/)?.[0];
  assert.ok(resetTag, "test uses the real Reset button");
  const reset = element(resetTag);
  ids.get("stage").getContext = () => ({ setTransform() {} });
  const doc = {
    hidden: false, body: element(),
    getElementById: id => ids.get(id) ?? null,
    querySelector: selector => selector === "[data-reset-all]" ? reset : null,
    createElement: () => element(),
    addEventListener: (name, callback) => documentEvents.set(name, callback),
    removeEventListener: name => documentEvents.delete(name),
  };
  const context = vm.createContext({
    ...model,
    ShepardRissetAudio: class {
      context = null;
      setParameters(parameters) { audioCalls.parameters.push(structuredClone(parameters)); }
      async start() { audioCalls.starts++; }
      stop() { audioCalls.stops++; }
      close() { audioCalls.closes++; }
    },
    document: doc,
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener: (name, callback) => globalEvents.set(name, callback),
    removeEventListener: name => globalEvents.delete(name),
    performance: { now: () => 100 },
    ResizeObserver: class {
      observe() {}
      disconnect() { observerDisconnected = true; }
    },
  });
  vm.runInContext(code, context, { filename: "shepard-risset-app.js", timeout: 5000 });
  const state = () => JSON.parse(vm.runInContext("JSON.stringify(state)", context));
  const trigger = (node, event, target = node) => node.listeners.get(event)?.({ target, currentTarget: node });
  const setRange = (id, value) => { ids.get(id).value = String(value); trigger(ids.get(id), "input"); };
  return { ids, reset, state, trigger, setRange, frames, audioCalls, globalEvents, documentEvents, disconnected: () => observerDisconnected };
}

test("Shepard initializes fully with the real markup and leaves Audio off", () => {
  const page = boot();
  assert.equal(page.audioCalls.starts, 0);
  assert.equal(page.ids.get("audioButton").getAttribute("aria-pressed"), "false");
  assert.equal(page.ids.get("presetGrid").children.length, model.SHEPARD_PRESETS.length);
  assert.equal(page.reset.listeners.has("click"), true);
  assert.equal(page.globalEvents.has("pagehide"), true, "startup reaches teardown registration after Reset");
  assert.ok(page.frames.size > 0, "startup schedules drawing");
  assert.throws(() => boot(script.replace(
    'document.querySelector("[data-reset-all]")',
    '$("[data-reset-all]")',
  )), /Cannot read properties of null/, "the old selector reproduces the reported crash");
});

test("Reset restores both mode memories without losing the selected mode or arming Audio", () => {
  const page = boot(), defaults = page.state();
  page.setRange("speed", 0.8);
  page.trigger(page.ids.get("modeSelector"), "click", page.ids.get("modeMorphisma"));
  page.setRange("voices", 18);
  page.setRange("sweepSpeed", 0.5);
  page.setRange("level", 0.23);
  page.trigger(page.reset, "click");
  const current = page.state();
  assert.equal(current.mode, model.SHEPARD_MODES.MORPHISMA);
  assert.deepEqual(current.octave, defaults.octave);
  assert.deepEqual(current.morphisma, defaults.morphisma);
  assert.equal(current.level, defaults.level);
  assert.equal(current.audioOn, false);
  assert.equal(page.audioCalls.starts, 0);
  assert.equal(page.ids.get("presetGrid").children.length, model.MORPHISMA_SWEEP_PRESETS.length);
});

test("Reset preserves an explicitly armed Audio session and pagehide cleans it up", async () => {
  const page = boot();
  await page.trigger(page.ids.get("audioButton"), "click");
  assert.equal(page.audioCalls.starts, 1);
  assert.equal(page.state().audioOn, true);
  page.trigger(page.reset, "click");
  assert.equal(page.state().audioOn, true);
  assert.equal(page.audioCalls.stops, 0);
  page.globalEvents.get("pagehide")();
  assert.equal(page.audioCalls.closes, 1);
  assert.equal(page.frames.size, 0);
  assert.equal(page.disconnected(), true);
  assert.equal(page.globalEvents.has("resize"), false);
  assert.equal(page.documentEvents.has("visibilitychange"), false);
});

test("Automatopoeia's legacy redirect declares an existing favicon without changing its destination", async () => {
  const page = new URL("../automatopoeia.html", import.meta.url);
  const markup = await readFile(page, "utf8");
  assert.match(markup, /http-equiv="refresh" content="0; url=automatapoeia.html"/);
  const icon = markup.match(/<link rel="icon" href="([^"]+)"/)?.[1];
  assert.ok(icon);
  assert.equal(new URL(icon, page).href, new URL("../favicon.svg", import.meta.url).href);
  assert.ok((await readFile(new URL(icon, page))).length);
});

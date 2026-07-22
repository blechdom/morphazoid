import assert from "node:assert/strict";
import test from "node:test";

test("Reset all preserves Shape sides for one reload", async () => {
  const listeners = new Map();
  const removedKeys = [];
  const sessionValues = new Map();
  let reloads = 0;
  const resetButton = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };

  globalThis.document = {
    getElementById(id) {
      return id === "sides" ? { value: "11" } : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-reset-all]") return [resetButton];
      return [];
    },
  };
  globalThis.localStorage = {
    removeItem(key) { removedKeys.push(key); },
  };
  globalThis.sessionStorage = {
    getItem(key) { return sessionValues.get(key) ?? null; },
    setItem(key, value) { sessionValues.set(key, String(value)); },
    removeItem(key) { sessionValues.delete(key); },
  };
  globalThis.location = {
    href: "",
    reload() { reloads += 1; },
  };

  await import(`../nav.js?reset-preserve=${Date.now()}`);
  listeners.get("click")();

  assert.equal(sessionValues.get("morphazoid:shape:reset:sides"), "11");
  assert.equal(reloads, 1);
  assert.deepEqual(removedKeys, [
    "morphazoid:shape:audio:v1",
    "morphazoid:lattice:audio:v2",
    "morphazoid:lumber:audio:v2",
    "morphazoid:shape:audio:v1",
    "morphazoid:lattice:audio:v2",
    "morphazoid:lumber:audio:v2",
  ]);
});

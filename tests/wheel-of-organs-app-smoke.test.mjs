import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WHEEL_ORGAN_PRESETS,
  mountWheelOfOrgans,
} from "../wheel-of-organs-app.js";

function fakeWheelDocument(html) {
  const elements = new Map();

  function makeNode(id = "", tagName = "div") {
    const listeners = new Map();
    const attributes = new Map();
    const classes = new Set();
    const node = {
      id,
      tagName: tagName.toUpperCase(),
      type: "",
      value: "",
      textContent: "",
      disabled: false,
      dataset: {},
      children: [],
      clientWidth: 900,
      clientHeight: 650,
      classList: {
        add(...names) {
          names.forEach((name) => classes.add(name));
        },
        remove(...names) {
          names.forEach((name) => classes.delete(name));
        },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
        contains(name) {
          return classes.has(name);
        },
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
      dispatch(type, additions = {}) {
        return listeners.get(type)?.({
          currentTarget: node,
          target: node,
          preventDefault() {},
          ...additions,
        });
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = [...children];
      },
      querySelector(selector) {
        const wanted = selector.toUpperCase();
        return this.children.find(({ tagName: childTag }) => childTag === wanted) ?? null;
      },
      querySelectorAll(selector) {
        if (selector === "button[data-mouth-index]") {
          return this.children.filter((child) => (
            child.tagName === "BUTTON" && child.dataset.mouthIndex !== undefined
          ));
        }
        return [];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 900, height: 650 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    Object.defineProperty(node, "options", {
      get() {
        return node.children.filter(({ tagName: childTag }) => childTag === "OPTION");
      },
    });
    if (id) elements.set(id, node);
    return node;
  }

  for (const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const [, tagName, id] = match;
    const node = makeNode(id, tagName);
    const openingTag = match[0];
    const value = openingTag.match(/\bvalue="([^"]*)"/i)?.[1];
    if (value !== undefined) node.value = value;
    node.type = openingTag.match(/\btype="([^"]*)"/i)?.[1] ?? "";
  }

  const context = new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "createRadialGradient" || property === "createLinearGradient") {
        return () => ({ addColorStop() {} });
      }
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  const canvas = elements.get("stage");
  canvas.getContext = () => context;

  const documentListeners = new Map();
  const doc = {
    body: {},
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    createElement(tagName) {
      return makeNode("", tagName);
    },
    querySelectorAll(selector) {
      if (selector === "[data-reset-all]") return [];
      return [];
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type) {
      documentListeners.delete(type);
    },
  };
  return { doc, elements, documentListeners };
}

function pointOnMouth(mouth, radial = 0, tangential = 0) {
  const radialX = Math.cos(mouth.angle);
  const radialY = Math.sin(mouth.angle);
  return {
    x: mouth.centerX + radialX * radial - radialY * tangential,
    y: mouth.centerY + radialY * radial + radialX * tangential,
  };
}

test("a spin accelerates through the 3 o'clock reader, holds one winner, and stays locked through decay", async (context) => {
  const html = await readFile(new URL("../image-to-instrument-3.html", import.meta.url), "utf8");
  const { doc, elements, documentListeners } = fakeWheelDocument(html);
  const animationFrames = [];
  let frameId = 0;
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    frameId += 1;
    return frameId;
  };
  globalThis.cancelAnimationFrame = () => {};
  context.after(() => {
    globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  });

  const app = mountWheelOfOrgans(doc);
  let time = 16;
  function runFrame(deltaMilliseconds = 50) {
    const callback = animationFrames.shift();
    assert.ok(callback, "the mounted instrument should keep requesting animation frames");
    time += deltaMilliseconds;
    callback(time);
  }
  runFrame(0);
  const idleRotation = app.spin.rotation;
  runFrame();
  assert.equal(app.spin.phase, "idle");
  assert.equal(app.spin.rotation, idleRotation, "the ready wheel must remain still");
  assert.equal(elements.get("transportButton").disabled, false);

  const crossed = [];
  const sustained = [];
  const released = [];
  app.audio.enable = async () => {};
  app.audio.disable = async () => {};
  app.audio.syncMouths = () => {};
  app.audio.articulate = (slot, mouth) => crossed.push({ slot, id: mouth.id });
  app.audio.sustain = (slot, mouth) => sustained.push({ slot, id: mouth.id });
  app.audio.release = (slot, options) => released.push({ slot, options });

  await elements.get("transportButton").dispatch("click");
  const spinNumber = app.spin.spinNumber;
  assert.equal(app.state.running, true);
  assert.equal(app.spin.phase, "accelerating");
  assert.equal(elements.get("audioButton").getAttribute("aria-pressed"), "false");
  assert.equal(elements.get("transportButton").disabled, true);
  assert.equal(crossed.length, 0, "Spin itself is silent until a mouth reaches the reader");
  assert.match(elements.get("liveStatus").textContent, /spinning silently/i);

  documentListeners.get("keydown")({
    code: "Space",
    key: " ",
    target: { tagName: "DIV" },
    preventDefault() {},
  });
  assert.equal(app.spin.spinNumber, spinNumber, "Space cannot stop or restart a locked spin");
  assert.equal(app.state.running, true);

  for (let index = 0; index < 10; index += 1) runFrame();
  await elements.get("audioButton").dispatch("click");
  assert.equal(elements.get("audioButton").getAttribute("aria-pressed"), "true");
  assert.equal(crossed.length, 0, "arming Audio mid-spin must wait for the next crossing");

  let maximumVelocity = app.spin.angularVelocity;
  let sawVelocityFall = false;
  let winnerAngle = null;
  let sawSustain = false;
  let sawDecay = false;
  let guard = 0;
  while (app.spin.phase !== "idle" && guard < 320) {
    const priorVelocity = app.spin.angularVelocity;
    runFrame();
    maximumVelocity = Math.max(maximumVelocity, app.spin.angularVelocity);
    if (priorVelocity > 0 && app.spin.angularVelocity < priorVelocity) sawVelocityFall = true;
    if (app.spin.phase === "sustaining") {
      sawSustain = true;
      winnerAngle = app.layout.mouths[app.spin.finalMouthIndex]?.angle ?? null;
      assert.equal(elements.get("transportButton").disabled, true);
    }
    if (app.spin.phase === "decaying") {
      sawDecay = true;
      assert.equal(elements.get("transportButton").disabled, true);
    }
    guard += 1;
  }

  assert.ok(maximumVelocity > 1, "the spin must accelerate");
  assert.equal(sawVelocityFall, true, "the wheel must brake after reaching speed");
  assert.ok(crossed.length > app.state.mouths.length, "many reader crossings should sound");
  assert.equal(new Set(crossed.map(({ id }) => id)).size, app.state.mouths.length);
  assert.equal(sustained.length, 1, "only the final aligned organ sustains");
  assert.equal(released.length, 1, "the winner receives one decay envelope");
  assert.equal(released[0].options.release, 2.4);
  assert.equal(sawSustain, true);
  assert.equal(sawDecay, true);
  assert.ok(Number.isFinite(winnerAngle));
  assert.ok(
    Math.abs(Math.atan2(Math.sin(winnerAngle), Math.cos(winnerAngle))) < 1e-8,
    "the winning mouth must stop exactly at 3 o'clock",
  );
  assert.equal(app.state.running, false);
  assert.equal(elements.get("transportButton").disabled, false);
  assert.match(elements.get("liveStatus").textContent, /quiet, still, and ready/i);

  await elements.get("transportButton").dispatch("click");
  assert.equal(app.spin.spinNumber, spinNumber + 1, "a new spin unlocks only after silence");
  await elements.get("audioButton").dispatch("click");
  assert.equal(elements.get("audioButton").getAttribute("aria-pressed"), "false");
  app.dispose();
});

test("an empty or fully muted letter wheel cannot spin", async (context) => {
  const html = await readFile(new URL("../image-to-instrument-3.html", import.meta.url), "utf8");
  const { doc, elements } = fakeWheelDocument(html);
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  context.after(() => {
    globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  });

  const app = mountWheelOfOrgans(doc);
  elements.get("wordInput").value = "";
  elements.get("wordInput").dispatch("input");
  assert.equal(app.state.mouths.length, 0);
  assert.equal(elements.get("transportButton").disabled, true);
  assert.equal(elements.get("transportState").textContent, "unvoiced");

  elements.get("wordInput").value = "A";
  elements.get("wordInput").dispatch("input");
  assert.equal(app.state.mouths.length, 1);
  assert.equal(elements.get("transportButton").disabled, false);
  elements.get("petalActive").dispatch("click");
  assert.equal(app.state.mouths[0].active, false);
  assert.equal(elements.get("transportButton").disabled, true);
  elements.get("transportButton").dispatch("click");
  assert.equal(app.spin.phase, "idle");
  app.dispose();
});

test("the preset bank preserves the wet original and adds genuinely quieter voices", async (context) => {
  const html = await readFile(new URL("../image-to-instrument-3.html", import.meta.url), "utf8");
  const { doc, elements } = fakeWheelDocument(html);
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  context.after(() => {
    globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
  });

  assert.equal(WHEEL_ORGAN_PRESETS.length, 7);
  assert.equal(WHEEL_ORGAN_PRESETS[0].id, "original");
  for (const preset of WHEEL_ORGAN_PRESETS.slice(1)) {
    assert.ok(preset.globals.dirt <= 0.015, `${preset.name} should keep internal dirt low`);
    assert.ok(preset.globals.growl <= 0.08, `${preset.name} should keep added growl low`);
    assert.ok(preset.mouth.breath <= 0.015, `${preset.name} should keep breath noise low`);
    assert.ok(preset.mouth.screech <= 0.02, `${preset.name} should keep screech noise low`);
  }

  const app = mountWheelOfOrgans(doc);
  assert.equal(app.activePreset, "clear", "the lower-noise choir should be the initial voice");
  elements.get("wheelPresetOriginal").dispatch("click");
  const originalNoise = app.vocalParameters(0).noiseGain;
  elements.get("wheelPresetClear").dispatch("click");
  const clearNoise = app.vocalParameters(0).noiseGain;
  assert.equal(app.activePreset, "clear");
  assert.equal(app.state.dirt, 0.01);
  assert.equal(app.state.slime, 0.03);
  assert.ok(clearNoise < originalNoise * 0.35, "Clear choir should remove most additive vowel noise");
  assert.ok(app.state.mouths.every(({ breath, screech }) => breath <= 0.01 && screech === 0));
  assert.equal(elements.get("wheelPresetClear").getAttribute("aria-pressed"), "true");
  assert.equal(elements.get("wheelPresetOriginal").getAttribute("aria-pressed"), "false");
  assert.equal(elements.get("dirt").value, "0.01");

  elements.get("wheelPresetGiant").dispatch("click");
  assert.equal(app.activePreset, "giant");
  assert.ok(app.state.mouths.every(({ size }) => size === 1.62));
  assert.equal(elements.get("pulseRate").value, "150");

  elements.get("emphasis").value = "0.4";
  elements.get("emphasis").dispatch("input");
  assert.equal(app.activePreset, null, "manual anatomy edits should clearly leave the named preset");
  assert.ok(WHEEL_ORGAN_PRESETS.every(({ buttonId }) => (
    elements.get(buttonId).getAttribute("aria-pressed") === "false"
  )));

  elements.get("wheelPresetOriginal").dispatch("click");
  assert.equal(app.activePreset, "original");
  assert.equal(app.state.dirt, 0.62);
  assert.ok(app.state.mouths[0].screech >= 0.3);
  app.dispose();
});

test("fast playback never steals slider focus from the selected mouth", async (context) => {
  const html = await readFile(new URL("../image-to-instrument-3.html", import.meta.url), "utf8");
  const { doc, elements } = fakeWheelDocument(html);
  const animationFrames = [];
  let frameId = 0;
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const priorDevicePixelRatio = globalThis.devicePixelRatio;
  globalThis.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    frameId += 1;
    return frameId;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.devicePixelRatio = 1;
  context.after(() => {
    globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
    globalThis.devicePixelRatio = priorDevicePixelRatio;
  });

  const app = mountWheelOfOrgans(doc);
  assert.ok(app);
  app.setSelected(5, false);
  const selectedId = app.state.mouths[5].id;

  elements.get("pulseRate").value = "720";
  elements.get("pulseRate").dispatch("input");
  app.setTransport(true, false);
  assert.equal(app.state.running, true);
  assert.equal(app.state.selectedMouth, 5);

  const seenCurrentMouths = new Set();
  function recordCurrentMouth() {
    for (const button of elements.get("petalButtons").children) {
      if (button.classList.contains("is-current")) {
        seenCurrentMouths.add(Number(button.dataset.mouthIndex));
      }
    }
  }
  function runFrame(time) {
    const callbacks = animationFrames.splice(0);
    assert.ok(callbacks.length > 0, "the mounted instrument should keep animating");
    callbacks.forEach((callback) => callback(time));
    recordCurrentMouth();
  }

  recordCurrentMouth();
  const edits = [
    ["pull", "0.91", "pull", 0.91],
    ["pinch", "0.77", "pinch", 0.77],
    ["mouthSize", "2.31", "size", 2.31],
    ["tongueOut", "0.88", "tongueOut", 0.88],
  ];
  for (let frame = 1; frame <= 18; frame += 1) {
    if (frame <= edits.length) {
      const [id, value, property, expected] = edits[frame - 1];
      elements.get(id).value = value;
      elements.get(id).dispatch("input");
      assert.equal(app.state.mouths[5][property], expected);
    }
    runFrame(frame * 55);
    assert.equal(app.state.selectedMouth, 5);
    assert.equal(app.state.mouths[5].id, selectedId);
    assert.equal(elements.get("selectedPetalOut").textContent, "06 · I");
    const selectedButton = elements.get("petalButtons").children[5];
    assert.equal(selectedButton.getAttribute("aria-pressed"), "true");
  }

  assert.ok(seenCurrentMouths.size >= 5, "the fast playhead must actually traverse the wheel");
  assert.ok(seenCurrentMouths.has(5), "the selected mouth may sing without becoming a new selection");
  assert.equal(app.state.selectedMouth, 5);
  assert.equal(app.state.mouths[5].pull, 0.91);
  assert.equal(app.state.mouths[5].pinch, 0.77);
  assert.equal(app.state.mouths[5].size, 2.31);
  assert.equal(app.state.mouths[5].tongueOut, 0.88);

  app.dispose();
});

test("captured gestures reach mutation-scale anatomy and keep mutation controls in sync", async (context) => {
  const html = await readFile(new URL("../image-to-instrument-3.html", import.meta.url), "utf8");
  const { doc, elements } = fakeWheelDocument(html);
  const animationFrames = [];
  let frameId = 0;
  const priorRequestAnimationFrame = globalThis.requestAnimationFrame;
  const priorCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const priorDevicePixelRatio = globalThis.devicePixelRatio;
  globalThis.requestAnimationFrame = (callback) => {
    animationFrames.push(callback);
    frameId += 1;
    return frameId;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.devicePixelRatio = 1;
  context.after(() => {
    globalThis.requestAnimationFrame = priorRequestAnimationFrame;
    globalThis.cancelAnimationFrame = priorCancelAnimationFrame;
    globalThis.devicePixelRatio = priorDevicePixelRatio;
  });

  const app = mountWheelOfOrgans(doc);
  assert.ok(app);
  animationFrames.shift()(16);
  const canvas = elements.get("stage");
  const { mouths, outerRadius, innerRadius } = app.layout;
  const radialSpan = outerRadius - innerRadius;

  function dragMouth(index, {
    pointerId,
    startRadial = -0.42,
    radialTravel = 0,
    tangentialTravel = 0,
    shiftKey = false,
    altKey = false,
  }) {
    const layoutMouth = mouths[index];
    const start = pointOnMouth(
      layoutMouth,
      layoutMouth.radialRadius * startRadial,
      0,
    );
    const end = pointOnMouth(
      layoutMouth,
      layoutMouth.radialRadius * startRadial + radialSpan * radialTravel,
      layoutMouth.tangentialRadius * 1.35 * tangentialTravel,
    );
    canvas.dispatch("pointerdown", {
      pointerId,
      pointerType: "mouse",
      clientX: start.x,
      clientY: start.y,
      shiftKey,
      altKey,
      pressure: 0,
    });
    canvas.dispatch("pointermove", {
      pointerId,
      pointerType: "mouse",
      clientX: end.x,
      clientY: end.y,
      shiftKey,
      altKey,
      pressure: 0,
    });
    canvas.dispatch("pointerup", {
      pointerId,
      pointerType: "mouse",
      clientX: end.x,
      clientY: end.y,
      shiftKey,
      altKey,
      pressure: 0,
    });
    return app.state.mouths[index];
  }

  const bloomed = dragMouth(0, {
    pointerId: 1,
    radialTravel: 2.5,
    tangentialTravel: 1.2,
  });
  assert.equal(bloomed.pull, 1);
  assert.equal(bloomed.size, 2.6, "bare outward drag should grow to the visual size ceiling");
  assert.equal(bloomed.stretch, 2.8, "raw travel beyond the ring should keep elongating");
  assert.equal(bloomed.tongueOut, 1);
  assert.equal(bloomed.screech, 1);
  assert.equal(elements.get("mouthSize").value, "2.6");
  assert.equal(elements.get("stretch").value, "2.8");
  assert.equal(elements.get("tongueOut").value, "1");

  const crushed = dragMouth(1, {
    pointerId: 2,
    radialTravel: -1.7,
    tangentialTravel: 1.2,
    shiftKey: true,
  });
  assert.equal(crushed.pinch, 1, "Shift-drag should make an unmistakable lip clamp");
  assert.equal(crushed.aperture, 0.04);
  assert.equal(crushed.push, 1);
  assert.ok(crushed.size < 0.4, "a hard Shift crush should visibly collapse the organ");
  assert.equal(crushed.screech, 1);

  const warped = dragMouth(2, {
    pointerId: 3,
    radialTravel: 1.8,
    tangentialTravel: 2.1,
    altKey: true,
  });
  assert.equal(warped.size, 2.6, "Alt tangential travel should independently reach huge size");
  assert.equal(warped.stretch, 2.8, "Alt radial travel should independently reach full stretch");
  assert.equal(warped.screech, 1);

  const licked = dragMouth(3, {
    pointerId: 4,
    startRadial: 0.2,
    radialTravel: 1.5,
    tangentialTravel: -1.1,
  });
  assert.equal(licked.tongueOut, 1);
  assert.ok(licked.stretch > 1.7, "pulling the tongue should deform its surrounding tract");
  assert.equal(licked.screech, 1);

  const touchMouth = mouths[4];
  const first = pointOnMouth(
    touchMouth,
    -touchMouth.radialRadius * 0.3,
    -touchMouth.tangentialRadius * 0.24,
  );
  const second = pointOnMouth(
    touchMouth,
    -touchMouth.radialRadius * 0.3,
    touchMouth.tangentialRadius * 0.24,
  );
  const expandedSecond = pointOnMouth(
    touchMouth,
    -touchMouth.radialRadius * 0.3 + radialSpan * 1.2,
    touchMouth.tangentialRadius * 2.8,
  );
  canvas.dispatch("pointerdown", {
    pointerId: 5,
    pointerType: "touch",
    clientX: first.x,
    clientY: first.y,
    pressure: 0.5,
  });
  canvas.dispatch("pointerdown", {
    pointerId: 6,
    pointerType: "touch",
    clientX: second.x,
    clientY: second.y,
    pressure: 0.5,
  });
  canvas.dispatch("pointermove", {
    pointerId: 6,
    pointerType: "touch",
    clientX: expandedSecond.x,
    clientY: expandedSecond.y,
    pressure: 0.5,
  });
  const expanded = app.state.mouths[4];
  assert.equal(expanded.size, 2.6, "two-pointer spreading should reach full-scale anatomy");
  assert.ok(expanded.stretch > 1.5);
  assert.ok(expanded.screech > 0.8);
  canvas.dispatch("pointerup", {
    pointerId: 6,
    pointerType: "touch",
    clientX: expandedSecond.x,
    clientY: expandedSecond.y,
    pressure: 0.5,
  });

  const selectedBeforeMutation = app.state.selectedMouth;
  elements.get("mutateButton").dispatch("click");
  const mutated = app.state.mouths[selectedBeforeMutation];
  assert.equal(app.state.running, false, "editing an idle wheel must not start a spin");
  assert.equal(app.state.selectedMouth, selectedBeforeMutation);
  for (const [id, property] of [
    ["pull", "pull"],
    ["aperture", "aperture"],
    ["pinch", "pinch"],
    ["push", "push"],
    ["nasality", "nasality"],
    ["screech", "screech"],
    ["mouthSize", "size"],
    ["stretch", "stretch"],
    ["tongueOut", "tongueOut"],
  ]) {
    assert.equal(elements.get(id).value, String(mutated[property]), `${id} should mirror mutation`);
  }
  const selectedButton = elements.get("petalButtons").children[selectedBeforeMutation];
  assert.equal(selectedButton.getAttribute("aria-pressed"), "true");
  assert.equal(selectedButton.classList.contains("is-active"), mutated.active);

  app.dispose();
});

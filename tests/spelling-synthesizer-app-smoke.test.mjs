import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Spelling Synthesizer joins mobile input pairs and safely resumes fake readback", async (t) => {
  const html = await readFile(
    new URL("../spelling-synthesizer.html", import.meta.url),
    "utf8",
  );
  const tags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)]
      .map((match) => [match[1], match[0]]),
  );
  const elements = new Map();
  const attributes = new Map();
  const pageListeners = new Map();
  const documentListeners = new Map();

  function classList() {
    const names = new Set();
    return {
      add(...next) { next.forEach((name) => names.add(name)); },
      remove(...next) { next.forEach((name) => names.delete(name)); },
      contains(name) { return names.has(name); },
      toggle(name, force) {
        const enabled = force === undefined ? !names.has(name) : Boolean(force);
        if (enabled) names.add(name);
        else names.delete(name);
        return enabled;
      },
    };
  }

  function style() {
    const values = new Map();
    return {
      width: "",
      setProperty(name, value) { values.set(name, String(value)); },
      getPropertyValue(name) { return values.get(name) ?? ""; },
    };
  }

  let document;

  function makeNode(id, tag = "") {
    const listeners = new Map();
    const node = {
      id,
      value: tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "",
      selectionStart: 0,
      selectionEnd: 0,
      textContent: "",
      hidden: /\bhidden\b/.test(tag),
      disabled: /\bdisabled\b/.test(tag),
      dataset: {},
      style: style(),
      classList: classList(),
      addEventListener(type, listener) {
        const group = listeners.get(type) ?? [];
        group.push(listener);
        listeners.set(type, group);
      },
      emit(type, event = {}) {
        for (const listener of listeners.get(type) ?? []) {
          listener({ target: node, currentTarget: node, ...event });
        }
      },
      setAttribute(name, value) {
        attributes.set(`${id}:${name}`, String(value));
      },
      getAttribute(name) {
        return attributes.get(`${id}:${name}`) ?? null;
      },
      removeAttribute(name) {
        attributes.delete(`${id}:${name}`);
      },
      querySelectorAll() { return []; },
      focus() { document.activeElement = node; },
    };
    return node;
  }

  for (const [id, tag] of tags) elements.set(id, makeNode(id, tag));

  function dataButtons(attribute, containerId) {
    const dataKey = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const buttons = [...html.matchAll(
      new RegExp(`<button[^>]+data-${attribute}="([^"]+)"[^>]*>`, "g"),
    )].map((match) => {
      const value = match[1];
      const button = makeNode(`${attribute}-${value}`, match[0]);
      button.dataset[dataKey] = value;
      return button;
    });
    elements.get(containerId).querySelectorAll = (selector) => (
      selector === `[data-${attribute}]` ? buttons : []
    );
    return buttons;
  }

  dataButtons("engine", "engineButtons");
  dataButtons("personality", "personalityButtons");

  const body = {
    style: style(),
    classList: classList(),
  };
  document = {
    activeElement: null,
    body,
    documentElement: { lang: "en" },
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) {
      const group = documentListeners.get(type) ?? [];
      group.push(listener);
      documentListeners.set(type, group);
    },
  };

  let nextTimerId = 1;
  const timers = new Map();
  function fakeSetTimeout(callback, delay = 0, ...args) {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay: Number(delay) || 0, args });
    return id;
  }
  function fakeClearTimeout(id) {
    timers.delete(id);
  }
  function runTimersWithDelay(delay) {
    const ready = [...timers.entries()]
      .filter(([, timer]) => timer.delay === delay);
    for (const [id, timer] of ready) {
      timers.delete(id);
      timer.callback(...timer.args);
    }
    return ready.length;
  }

  class FakeAudioParam {
    constructor(value = 0) { this.value = value; }
    cancelAndHoldAtTime() {}
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
  }

  class FakeAudioNode {
    constructor() { this.connections = []; }
    connect(destination, output, input) {
      this.connections.push({ destination, output, input });
      return destination;
    }
    disconnect() { this.connections.length = 0; }
  }

  let playbackStarts = 0;

  class FakeBufferSource extends FakeAudioNode {
    constructor() {
      super();
      this.buffer = null;
      this.loop = false;
      this.playbackRate = new FakeAudioParam(1);
      this.onended = null;
    }
    start() { playbackStarts += 1; }
    stop() {}
  }

  class FakeOscillator extends FakeAudioNode {
    constructor() {
      super();
      this.type = "sine";
      this.frequency = new FakeAudioParam(440);
      this.detune = new FakeAudioParam(0);
    }
    start() { playbackStarts += 1; }
    stop() {}
    setPeriodicWave() {}
  }

  class FakeGain extends FakeAudioNode {
    constructor() {
      super();
      this.gain = new FakeAudioParam(1);
    }
  }

  class FakeFilter extends FakeAudioNode {
    constructor() {
      super();
      this.type = "lowpass";
      this.frequency = new FakeAudioParam(350);
      this.Q = new FakeAudioParam(1);
      this.gain = new FakeAudioParam(0);
    }
  }

  class FakeCompressor extends FakeAudioNode {
    constructor() {
      super();
      this.threshold = new FakeAudioParam(-24);
      this.knee = new FakeAudioParam(30);
      this.ratio = new FakeAudioParam(12);
      this.attack = new FakeAudioParam(0.003);
      this.release = new FakeAudioParam(0.25);
    }
  }

  let audioContextConstructions = 0;

  class FakeAudioContext {
    constructor() {
      audioContextConstructions += 1;
      this.currentTime = 1;
      this.sampleRate = 48_000;
      this.state = "suspended";
      this.destination = new FakeAudioNode();
      this.audioWorklet = { addModule: async () => {} };
    }
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData(channel) { return data[channel]; },
      };
    }
    createBufferSource() { return new FakeBufferSource(); }
    createOscillator() { return new FakeOscillator(); }
    createGain() { return new FakeGain(); }
    createBiquadFilter() { return new FakeFilter(); }
    createDynamicsCompressor() { return new FakeCompressor(); }
    createPeriodicWave(real, imaginary) { return { real, imaginary }; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
  }

  class FakeAudioWorkletNode extends FakeAudioNode {
    constructor(context, name, options) {
      super();
      this.context = context;
      this.name = name;
      this.options = options;
      this.messages = [];
      this.port = { postMessage: (message) => this.messages.push(message) };
    }
  }

  class FakeSpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.listeners = new Map();
      this.voice = null;
      this.lang = "";
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
    }
    addEventListener(type, listener) {
      const group = this.listeners.get(type) ?? [];
      group.push(listener);
      this.listeners.set(type, group);
    }
    emit(type, details = {}) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ type, ...details });
      }
    }
  }

  const speechSynthesis = {
    spoken: [],
    cancellations: 0,
    getVoices() {
      return [{ default: true, lang: "en-US", name: "Fake English" }];
    },
    cancel() { this.cancellations += 1; },
    speak(utterance) {
      this.spoken.push(utterance);
      utterance.emit("start");
    },
  };

  const originalGlobals = new Map();
  for (const name of [
    "AudioContext",
    "AudioWorkletNode",
    "SpeechSynthesisUtterance",
    "addEventListener",
    "clearTimeout",
    "document",
    "requestAnimationFrame",
    "setTimeout",
    "speechSynthesis",
  ]) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  t.after(() => {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  globalThis.AudioContext = FakeAudioContext;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  globalThis.SpeechSynthesisUtterance = FakeSpeechSynthesisUtterance;
  globalThis.addEventListener = (type, listener) => {
    const group = pageListeners.get(type) ?? [];
    group.push(listener);
    pageListeners.set(type, group);
  };
  globalThis.clearTimeout = fakeClearTimeout;
  globalThis.document = document;
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
  globalThis.setTimeout = fakeSetTimeout;
  globalThis.speechSynthesis = speechSynthesis;

  await import(`../spelling-synthesizer-app.js?smoke=${Date.now()}`);

  assert.equal(audioContextConstructions, 0, "module load must not construct Web Audio");
  assert.equal(playbackStarts, 0, "module load must not start any fake audio source");
  assert.equal(speechSynthesis.spoken.length, 0, "module load must not request speech");
  assert.equal(speechSynthesis.cancellations, 0, "module load must not touch the speech queue");

  const input = elements.get("spellingInput");
  const letterBeforePair = elements.get("currentLetter").textContent;
  input.value = "t";
  input.selectionStart = 1;
  input.selectionEnd = 1;
  input.emit("input", { inputType: "insertText" });
  assert.equal(
    elements.get("currentLetter").textContent,
    letterBeforePair,
    "T waits for a possible pair",
  );

  input.value = "th";
  input.selectionStart = 2;
  input.selectionEnd = 2;
  input.emit("input", { inputType: "insertText" });
  assert.equal(elements.get("currentLetter").textContent, "TH");
  assert.equal(elements.get("currentSound").textContent, "TH");
  assert.equal(elements.get("currentPair").textContent, "TH · DIGRAPH");
  assert.equal(
    [...timers.values()].some(({ delay }) => delay === 180),
    false,
    "the first-letter hold is cleared when H completes TH",
  );

  elements.get("pairGlidesButton").emit("click");
  assert.equal(elements.get("pairGlidesButton").getAttribute("aria-checked"), "false");
  assert.equal(elements.get("pairGlidesState").textContent, "off");

  input.value = "tht";
  input.selectionStart = 3;
  input.selectionEnd = 3;
  input.emit("input", { inputType: "insertText" });
  assert.equal(elements.get("currentLetter").textContent, "T");

  input.value = "thth";
  input.selectionStart = 4;
  input.selectionEnd = 4;
  input.emit("input", { inputType: "insertText" });
  assert.equal(elements.get("currentLetter").textContent, "H");
  assert.notEqual(elements.get("currentPair").textContent, "TH · DIGRAPH");

  for (let pass = 0; pass < 8; pass += 1) await Promise.resolve();
  assert.ok(audioContextConstructions > 0, "typing is the first action that requests fake audio");

  elements.get("readbackButton").emit("click");
  assert.equal(speechSynthesis.spoken.length, 1);
  assert.equal(speechSynthesis.spoken[0].text, "thth");
  assert.equal(elements.get("readbackButton").textContent, "Pause readback");
  speechSynthesis.spoken[0].emit("boundary", { charIndex: 2 });

  const cancellationsBeforeTyping = speechSynthesis.cancellations;
  input.value = "ththz";
  input.selectionStart = 5;
  input.selectionEnd = 5;
  input.emit("input", { inputType: "insertText" });
  assert.equal(speechSynthesis.cancellations, cancellationsBeforeTyping + 1);
  assert.equal(elements.get("readbackButton").textContent, "Continue readback");
  assert.equal(runTimersWithDelay(900), 1, "typing schedules one idle continuation");
  assert.equal(speechSynthesis.spoken.length, 2);
  assert.equal(speechSynthesis.spoken[1].text, "thz", "continuation preserves the boundary offset");
  assert.equal(elements.get("readbackButton").textContent, "Pause readback");
});

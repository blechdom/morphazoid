import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SPELLING_DIPHONE_CLIPS } from "../src/spelling-diphone-atlas.js";

const MOCK_ATLAS_DURATION = Math.max(
  ...Object.values(SPELLING_DIPHONE_CLIPS)
    .map((clip) => clip.offset + clip.duration),
) + 0.018;

test("Spelling Synthesizer sustains held vowels, joins pairs, and resumes local readback", async (t) => {
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
        const dispatched = {
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          ...event,
          target: node,
          currentTarget: node,
        };
        for (const listener of listeners.get(type) ?? []) {
          listener(dispatched);
        }
        return dispatched;
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
  function runNextTimer() {
    const next = [...timers.entries()].sort(([left], [right]) => left - right)[0];
    if (!next) return false;
    const [id, timer] = next;
    timers.delete(id);
    timer.callback(...timer.args);
    return true;
  }
  function runTimersUntil(predicate, message, limit = 80) {
    for (let pass = 0; pass < limit; pass += 1) {
      if (predicate()) return;
      assert.ok(runNextTimer(), message);
    }
    assert.fail(`${message} (timer limit reached)`);
  }
  async function flushMicrotasksUntil(predicate, message, limit = 40) {
    for (let pass = 0; pass < limit; pass += 1) {
      if (predicate()) return;
      await Promise.resolve();
    }
    assert.ok(predicate(), message);
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
  const bufferSources = [];

  class FakeBufferSource extends FakeAudioNode {
    constructor() {
      super();
      this.buffer = null;
      this.loop = false;
      this.playbackRate = new FakeAudioParam(1);
      this.onended = null;
      this.startCalls = [];
      this.stopCalls = [];
    }
    start(...args) {
      this.startCalls.push(args);
      playbackStarts += 1;
    }
    stop(...args) { this.stopCalls.push(args); }
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
    createBufferSource() {
      const source = new FakeBufferSource();
      bufferSources.push(source);
      return source;
    }
    createOscillator() { return new FakeOscillator(); }
    createGain() { return new FakeGain(); }
    createBiquadFilter() { return new FakeFilter(); }
    createDynamicsCompressor() { return new FakeCompressor(); }
    createPeriodicWave(real, imaginary) { return { real, imaginary }; }
    decodeAudioData(bytes, onSuccess) {
      const buffer = {
        bytes,
        duration: MOCK_ATLAS_DURATION,
        length: Math.round(MOCK_ATLAS_DURATION * 16_000),
        sampleRate: 16_000,
      };
      onSuccess?.(buffer);
      return Promise.resolve(buffer);
    }
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

  const originalGlobals = new Map();
  for (const name of [
    "AudioContext",
    "AudioWorkletNode",
    "addEventListener",
    "clearTimeout",
    "document",
    "fetch",
    "requestAnimationFrame",
    "setTimeout",
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
  globalThis.addEventListener = (type, listener) => {
    const group = pageListeners.get(type) ?? [];
    group.push(listener);
    pageListeners.set(type, group);
  };
  globalThis.clearTimeout = fakeClearTimeout;
  globalThis.document = document;
  let dictionaryFetches = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith(".dict")) {
      dictionaryFetches += 1;
      return {
        ok: true,
        async text() {
          return [
            "the DH AH",
            "words W ER D Z",
            "cat K AE T",
            "b B IY",
          ].join("\n");
        },
      };
    }
    return {
      ok: true,
      async arrayBuffer() { return new ArrayBuffer(32); },
    };
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback(0);
    return 1;
  };
  globalThis.setTimeout = fakeSetTimeout;

  await import(`../spelling-synthesizer-app.js?smoke=${Date.now()}`);

  assert.equal(audioContextConstructions, 0, "module load must not construct Web Audio");
  assert.equal(playbackStarts, 0, "module load must not start any fake audio source");

  const input = elements.get("spellingInput");
  input.value = "hello";
  elements.get("readbackButton").emit("click");
  assert.equal(audioContextConstructions, 0, "Readback must not implicitly turn Audio on");
  assert.equal(elements.get("audioButton").getAttribute("aria-pressed"), "false");
  assert.equal(elements.get("readbackButton").textContent, "Read it back to me");
  assert.match(elements.get("liveStatus").textContent, /Turn Audio on/);
  input.value = "";
  const initialVowel = input.emit("keydown", {
    key: "e",
    code: "KeyE",
    repeat: false,
  });
  assert.equal(initialVowel.defaultPrevented, false);
  input.value = "e";
  input.selectionStart = 1;
  input.selectionEnd = 1;
  input.emit("input", { inputType: "insertText" });

  const firstVowelRepeat = input.emit("keydown", {
    key: "e",
    code: "KeyE",
    repeat: true,
  });
  assert.equal(firstVowelRepeat.defaultPrevented, true, "held vowels suppress native repeat text");
  assert.equal(input.value, "e", "a held vowel stays one character");
  assert.equal(elements.get("currentPair").textContent, "HELD VOWEL · SUSTAIN");
  for (let pass = 0; pass < 24; pass += 1) await Promise.resolve();
  const heldSourcesAfterFirstRepeat = bufferSources.filter((source) => (
    source.buffer?.sampleRate === 16_000
  )).length;
  assert.equal(heldSourcesAfterFirstRepeat, 1);
  const secondVowelRepeat = input.emit("keydown", {
    key: "e",
    code: "KeyE",
    repeat: true,
  });
  assert.equal(secondVowelRepeat.defaultPrevented, true);
  for (let pass = 0; pass < 4; pass += 1) await Promise.resolve();
  assert.equal(
    bufferSources.filter((source) => source.buffer?.sampleRate === 16_000).length,
    heldSourcesAfterFirstRepeat,
    "later repeat events sustain the existing source rather than retriggering",
  );
  const startsAfterHeldVowel = playbackStarts;
  input.emit("keyup", { key: "e", code: "KeyE" });
  assert.equal(elements.get("currentPair").textContent, "VOWEL · RELEASE");

  elements.get("clearButton").emit("click");
  assert.equal(input.value, "");
  const initialConsonant = input.emit("keydown", {
    key: "s",
    code: "KeyS",
    repeat: false,
  });
  assert.equal(initialConsonant.defaultPrevented, false);
  input.value = "s";
  input.selectionStart = 1;
  input.selectionEnd = 1;
  input.emit("input", { inputType: "insertText" });
  const consonantRepeat = input.emit("keydown", {
    key: "s",
    code: "KeyS",
    repeat: true,
  });
  assert.equal(consonantRepeat.defaultPrevented, false, "consonant repeat remains native");
  input.value = "ss";
  input.selectionStart = 2;
  input.selectionEnd = 2;
  input.emit("input", { inputType: "insertText" });
  for (let pass = 0; pass < 4; pass += 1) await Promise.resolve();
  assert.equal(input.value, "ss", "held consonants continue typing repeated letters");
  assert.ok(playbackStarts > startsAfterHeldVowel, "native consonant repeat retriggers sound");

  elements.get("clearButton").emit("click");
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

  elements.get("pairGlidesButton").emit("click");
  assert.equal(elements.get("pairGlidesButton").getAttribute("aria-checked"), "true");

  input.value = "the words";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.emit("input", { inputType: "insertReplacementText" });
  const atlasSources = () => bufferSources.filter((source) => (
    source.buffer?.sampleRate === 16_000
  ));
  const atlasKey = (source) => Object.entries(SPELLING_DIPHONE_CLIPS)
    .find(([, clip]) => source.startCalls[0]?.[1] === clip.offset)?.[0] ?? "";
  const kalSourcesBeforeReadback = bufferSources.filter((source) => (
    source.buffer?.sampleRate === 16_000
  )).length;
  elements.get("readbackButton").emit("click");
  assert.equal(elements.get("readbackButton").textContent, "Preparing voice…");
  await flushMicrotasksUntil(
    () => (
      elements.get("readbackButton").textContent === "Pause readback"
      && atlasSources().length > kalSourcesBeforeReadback
    ),
    "word readback should prepare and start its first local sample",
  );
  assert.equal(elements.get("readbackButton").textContent, "Pause readback");
  const firstReadbackSource = atlasSources()[kalSourcesBeforeReadback];
  assert.ok(firstReadbackSource, "readback starts through the local KAL sample engine");
  assert.deepEqual(
    firstReadbackSource.startCalls[0].slice(1),
    [SPELLING_DIPHONE_CLIPS.dh.offset, SPELLING_DIPHONE_CLIPS.dh.duration],
    "the word THE begins with its voiced DH pronunciation",
  );
  assert.equal(elements.get("currentLetter").textContent, "THE");
  assert.equal(elements.get("currentSound").textContent, "DH AH");
  assert.match(elements.get("currentPair").textContent, /^WORD · /);

  const expectedWordPhones = ["dh", "u", "w", "er", "d", "z"];
  runTimersUntil(
    () => atlasSources().length >= kalSourcesBeforeReadback + expectedWordPhones.length,
    "word readback should advance through every pronunciation phone",
  );
  assert.deepEqual(
    atlasSources()
      .slice(kalSourcesBeforeReadback, kalSourcesBeforeReadback + expectedWordPhones.length)
      .map(atlasKey),
    expectedWordPhones,
    "THE WORDS is synthesized as DH AH, then W ER D Z rather than letter names",
  );
  assert.equal(elements.get("currentLetter").textContent, "WORDS");
  assert.equal(elements.get("currentSound").textContent, "W ER D Z");
  runTimersUntil(
    () => elements.get("readbackButton").textContent === "Read it again",
    "word readback should finish after its final phone",
  );
  assert.equal(
    elements.get("readbackStartOver").hidden,
    true,
    "Read it again is the only restart control after completion",
  );

  const kalSourcesBeforeReplay = atlasSources().length;
  elements.get("readbackButton").emit("click");
  await flushMicrotasksUntil(
    () => atlasSources().length > kalSourcesBeforeReplay,
    "Read it again should restart local synthesis",
  );
  const firstReplaySource = atlasSources()[kalSourcesBeforeReplay];
  assert.equal(atlasKey(firstReplaySource), "dh", "Read it again restarts from the first word");

  const typedVowel = input.emit("keydown", {
    key: "e",
    code: "KeyE",
    repeat: false,
  });
  assert.equal(typedVowel.defaultPrevented, false);
  input.value = "the wordse";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.emit("input", { inputType: "insertText" });
  const sustainedVowel = input.emit("keydown", {
    key: "e",
    code: "KeyE",
    repeat: true,
  });
  assert.equal(sustainedVowel.defaultPrevented, true);
  assert.ok(firstReplaySource.stopCalls.length > 0, "typing releases the active readback clip");
  assert.equal(elements.get("readbackButton").textContent, "Continue readback");
  assert.equal(
    elements.get("readbackStartOver").hidden,
    false,
    "Start over remains available while the primary action continues",
  );
  const atlasSourcesWhileHeld = atlasSources().length;
  assert.equal(
    runTimersWithDelay(900),
    1,
    "the first idle continuation checks the held vowel",
  );
  assert.equal(
    atlasSources().length,
    atlasSourcesWhileHeld,
    "readback stays interrupted while the vowel key remains held",
  );
  assert.equal(elements.get("readbackButton").textContent, "Continue readback");
  assert.equal(
    [...timers.values()].some(({ delay }) => delay === 900),
    true,
    "a held vowel reschedules the idle continuation check",
  );

  input.emit("keyup", { key: "e", code: "KeyE" });
  const kalSourcesBeforeContinuation = atlasSources().length;
  assert.equal(runTimersWithDelay(900), 1, "readback may continue after the vowel is released");
  await flushMicrotasksUntil(
    () => atlasSources().length > kalSourcesBeforeContinuation,
    "idle continuation should resume through the local engine",
  );
  const continuedReadbackSource = atlasSources()[kalSourcesBeforeContinuation];
  assert.ok(continuedReadbackSource, "idle continuation resumes through the local engine");
  assert.equal(
    atlasKey(continuedReadbackSource),
    "dh",
    "an interrupted word resumes from its first phone instead of its middle",
  );
  assert.equal(elements.get("readbackButton").textContent, "Pause readback");

  input.value = "the wordse.";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.emit("input", { inputType: "insertText" });
  assert.ok(continuedReadbackSource.stopCalls.length > 0);
  assert.equal(elements.get("readbackButton").textContent, "Continue readback");
  document.hidden = true;
  for (const listener of documentListeners.get("visibilitychange") ?? []) {
    listener({ type: "visibilitychange" });
  }
  const playbackStartsWhenHidden = playbackStarts;
  assert.equal(elements.get("readbackButton").textContent, "Resume readback");
  assert.equal(runTimersWithDelay(900), 0, "hiding clears interrupted readback continuation");
  for (let pass = 0; pass < 8; pass += 1) await Promise.resolve();
  assert.equal(playbackStarts, playbackStartsWhenHidden, "hidden readback cannot restart audio");

  document.hidden = false;
  elements.get("audioButton").emit("click");
  await flushMicrotasksUntil(
    () => elements.get("audioButton").getAttribute("aria-pressed") === "true",
    "returning from the background requires an explicit Audio press",
  );
  elements.get("clearButton").emit("click");
  input.value = "cat.";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.emit("input", { inputType: "insertReplacementText" });
  const kalKClipCount = () => bufferSources.filter((source) => (
    source.buffer?.sampleRate === 16_000
    && source.startCalls[0]?.[1] === SPELLING_DIPHONE_CLIPS.k.offset
  )).length;
  const kalKBeforeBoundaryReadback = kalKClipCount();

  elements.get("readbackButton").emit("click");
  await flushMicrotasksUntil(
    () => kalKClipCount() === kalKBeforeBoundaryReadback + 1,
    "dictionary-backed CAT should begin through the local engine",
  );
  assert.equal(dictionaryFetches, 1, "dictionary-backed words lazily load the pronunciation data");
  assert.equal(kalKClipCount(), kalKBeforeBoundaryReadback + 1);
  runTimersUntil(
    () => elements.get("currentPair").textContent === "PHRASE END",
    "CAT should advance through K AE T into its final punctuation pause",
  );
  assert.equal(elements.get("currentPair").textContent, "PHRASE END");
  assert.equal(
    [...timers.values()].some(({ delay }) => delay === 420),
    true,
    "the final period is still waiting when readback is paused",
  );

  elements.get("readbackButton").emit("click");
  assert.equal(elements.get("readbackButton").textContent, "Resume readback");
  const kalKAtBoundaryPause = kalKClipCount();
  elements.get("readbackButton").emit("click");
  await flushMicrotasksUntil(
    () => elements.get("readbackButton").textContent === "Read it again",
    "resuming after the final boundary should finish readback",
  );
  assert.equal(elements.get("readbackButton").textContent, "Read it again");
  assert.equal(
    kalKClipCount(),
    kalKAtBoundaryPause,
    "resuming during final punctuation completes without replaying CAT",
  );

  elements.get("readbackButton").emit("click");
  await flushMicrotasksUntil(
    () => kalKClipCount() === kalKAtBoundaryPause + 1,
    "replaying CAT should start its first phone",
  );
  assert.equal(kalKClipCount(), kalKAtBoundaryPause + 1);
  runTimersUntil(
    () => elements.get("currentPair").textContent === "PHRASE END",
    "the replay should reach CAT's final period",
  );
  const kalKBeforeLiveAppend = kalKClipCount();
  input.value = "cat.b";
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.emit("input", { inputType: "insertText" });
  assert.equal(elements.get("readbackButton").textContent, "Continue readback");
  assert.equal(runTimersWithDelay(900), 1, "live typing resumes after its idle delay");
  await flushMicrotasksUntil(
    () => elements.get("readbackButton").textContent === "Read it again",
    "continuation after the appended suffix should settle",
  );
  assert.equal(
    kalKClipCount(),
    kalKBeforeLiveAppend,
    "continuing after a live append does not restart the already-read prefix",
  );
  assert.equal(elements.get("readbackButton").textContent, "Read it again");
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Throatazoid renders, awakens mic and glottis sources, and mutates specimens", async (t) => {
  const html = await readFile(new URL("../throatazoid.html", import.meta.url), "utf8");
  const tags = new Map(
    [...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map((match) => [match[1], match[0]]),
  );
  const elements = new Map();
  const listeners = new Map();
  const documentListeners = new Map();
  const attributes = new Map();

  function classList() {
    const classes = new Set();
    return {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        const next = force === undefined ? !classes.has(name) : Boolean(force);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains(name) { return classes.has(name); },
    };
  }

  function initialValue(tag) {
    return tag?.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
  }

  function element(id) {
    const tag = tags.get(id) ?? "";
    const node = {
      id,
      value: initialValue(tag),
      textContent: "",
      hidden: /\bhidden\b/.test(tag),
      disabled: /\bdisabled\b/.test(tag),
      open: false,
      href: "",
      download: "",
      dataset: {},
      style: {},
      classList: classList(),
      addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
      setAttribute(name, value) { attributes.set(`${id}:${name}`, String(value)); },
      getAttribute(name) { return attributes.get(`${id}:${name}`) ?? null; },
      removeAttribute(name) {
        attributes.delete(`${id}:${name}`);
        if (name === "href") this.href = "";
      },
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 940, height: 610 }; },
      setPointerCapture() {},
      releasePointerCapture() {},
    };
    elements.set(id, node);
    return node;
  }

  for (const id of tags.keys()) element(id);

  const specimenButtons = [...html.matchAll(/<button[^>]+data-specimen="([^"]+)"[^>]*>/g)]
    .map((match) => {
      const button = {
        dataset: { specimen: match[1] },
        addEventListener(type, listener) {
          listeners.set(`specimen-${match[1]}:${type}`, listener);
        },
        setAttribute(name, value) {
          attributes.set(`specimen-${match[1]}:${name}`, String(value));
        },
      };
      return button;
    });

  const sourceButtons = [...html.matchAll(/<button[^>]+data-source="([^"]+)"[^>]*>/g)]
    .map((match) => {
      const source = match[1];
      return {
        dataset: { source },
        addEventListener(type, listener) {
          listeners.set(`source-${source}:${type}`, listener);
        },
        setAttribute(name, value) {
          attributes.set(`source-${source}:${name}`, String(value));
        },
        getAttribute(name) {
          return attributes.get(`source-${source}:${name}`) ?? null;
        },
        closest(selector) {
          return selector === "[data-source]" ? this : null;
        },
      };
    });
  elements.get("sourceButtons").querySelectorAll = (selector) => (
    selector === "[data-source]" ? sourceButtons : []
  );

  function dataButtons(attribute, containerId) {
    const dataKey = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const buttons = [...html.matchAll(
      new RegExp(`<button[^>]+data-${attribute}="([^"]+)"[^>]*>`, "g"),
    )].map((match) => {
      const value = match[1];
      const key = `${attribute}-${value}`;
      const status = { textContent: "" };
      return {
        dataset: { [dataKey]: value },
        disabled: false,
        status,
        classList: classList(),
        addEventListener(type, listener) {
          listeners.set(`${key}:${type}`, listener);
        },
        setAttribute(name, next) {
          attributes.set(`${key}:${name}`, String(next));
        },
        getAttribute(name) {
          return attributes.get(`${key}:${name}`) ?? null;
        },
        removeAttribute(name) {
          attributes.delete(`${key}:${name}`);
        },
        querySelector(selector) {
          return selector === "small" ? status : null;
        },
        closest(selector) {
          return selector === `[data-${attribute}]` ? this : null;
        },
      };
    });
    const container = elements.get(containerId);
    assert.ok(container, `missing #${containerId}`);
    container.querySelectorAll = (selector) => (
      selector === `[data-${attribute}]` ? buttons : []
    );
    return buttons;
  }

  const tongueButtons = dataButtons("tongue", "tongueButtons");
  const noseButtons = dataButtons("nose", "noseButtons");
  const phonemeButtons = dataButtons("phoneme", "phonemeButtons");
  const voicePresetButtons = dataButtons("voice-preset", "presetButtons");
  elements.get("presetButtons").querySelectorAll = (selector) => {
    if (selector === "[data-specimen]") return specimenButtons;
    if (selector === "[data-voice-preset]") return voicePresetButtons;
    return [];
  };
  const alphabetKeycaps = [...html.matchAll(
    /<kbd[^>]+data-letter="([a-z])"[^>]*>/g,
  )].map((match) => ({
    dataset: { letter: match[1] },
    classList: classList(),
  }));
  elements.get("alphabetKeyMap").querySelectorAll = (selector) => (
    selector === "[data-letter]" ? alphabetKeycaps : []
  );
  const pressureSourceButtons = dataButtons(
    "pressure-source",
    "pressureSourceButtons",
  );
  const mouthGateButtons = dataButtons("mouth-gate", "mouthGateButtons");

  let strokes = 0;
  let fills = 0;
  const context = {
    arc() {},
    beginPath() {},
    bezierCurveTo() {},
    clearRect() {},
    closePath() {},
    ellipse() {},
    fill() { fills += 1; },
    fillText() {},
    lineTo() {},
    moveTo() {},
    quadraticCurveTo() {},
    rect() {},
    restore() {},
    rotate() {},
    roundRect() {},
    save() {},
    setTransform() {},
    stroke() { strokes += 1; },
    translate() {},
  };
  elements.get("stage").getContext = () => context;
  elements.get("stageWrap").getBoundingClientRect = () => ({ width: 940, height: 610 });

  let queuedFrame = null;
  let frameId = 0;
  const originalGlobals = new Map();
  for (const name of [
    "AudioContext",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement",
    "ResizeObserver",
    "cancelAnimationFrame",
    "document",
    "navigator",
    "requestAnimationFrame",
  ]) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  t.after(() => {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  globalThis.requestAnimationFrame = (callback) => {
    queuedFrame = callback;
    frameId += 1;
    return frameId;
  };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
  };
  globalThis.document = {
    hidden: false,
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  globalThis.HTMLInputElement = class {};
  globalThis.HTMLSelectElement = class {};
  globalThis.HTMLTextAreaElement = class {};

  function audioParam(value = 0) {
    return {
      value,
      cancelScheduledValues() {},
      exponentialRampToValueAtTime(next) { this.value = next; },
      linearRampToValueAtTime(next) { this.value = next; },
      setTargetAtTime(next) { this.value = next; },
      setValueAtTime(next) { this.value = next; },
    };
  }

  function audioNode(properties = {}) {
    return {
      ...properties,
      connect(destination) { return destination; },
      disconnect() {},
    };
  }

  const contexts = [];
  const analysers = [];
  const bufferSources = [];
  const periodicWaves = [];
  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48_000;
      this.state = "running";
      this.destination = audioNode();
      contexts.push(this);
    }
    addEventListener() {}
    createGain() { return audioNode({ gain: audioParam(0) }); }
    createBiquadFilter() {
      return audioNode({
        type: "lowpass",
        frequency: audioParam(0),
        Q: audioParam(0),
        gain: audioParam(0),
      });
    }
    createWaveShaper() { return audioNode({ curve: null, oversample: "none" }); }
    createStereoPanner() { return audioNode({ pan: audioParam(0) }); }
    createAnalyser() {
      const analyser = audioNode({
        fftSize: 2048,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(samples) { samples.fill(0.02); },
      });
      analysers.push(analyser);
      return analyser;
    }
    createDynamicsCompressor() {
      return audioNode({
        threshold: audioParam(0),
        knee: audioParam(0),
        ratio: audioParam(0),
        attack: audioParam(0),
        release: audioParam(0),
      });
    }
    createOscillator() {
      return audioNode({
        type: "sine",
        frequency: audioParam(0),
        detune: audioParam(0),
        setPeriodicWave(wave) { this.periodicWave = wave; },
        start() {},
        stop() {},
      });
    }
    createBuffer(numberOfChannels, length, sampleRate) {
      const channels = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(length),
      );
      return {
        numberOfChannels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData(channel) { return channels[channel]; },
      };
    }
    createBufferSource() {
      const source = audioNode({
        buffer: null,
        loop: false,
        playbackRate: audioParam(1),
        start() { this.started = true; },
        stop() { this.stopped = true; },
      });
      bufferSources.push(source);
      return source;
    }
    createPeriodicWave(real, imaginary, options = {}) {
      const wave = { real, imaginary, options };
      periodicWaves.push(wave);
      return wave;
    }
    createMediaStreamDestination() { return audioNode({ stream: { id: "processed" } }); }
    createMediaStreamSource() { return audioNode(); }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  };

  let requestedConstraints = null;
  let getUserMediaCalls = 0;
  let stopped = 0;
  const track = {
    addEventListener() {},
    stop() { stopped += 1; },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          getUserMediaCalls += 1;
          requestedConstraints = constraints;
          return {
            getAudioTracks: () => [track],
            getTracks: () => [track],
          };
        },
      },
    },
  });

  await import(`../throatazoid-app.js?smoke=${Date.now()}`);
  assert.equal(typeof queuedFrame, "function");
  queuedFrame(performance.now() + 100);
  assert.ok(strokes > 15, "the dormant alien anatomy should have visible structure");
  assert.ok(fills > 5, "the organism should render solid black chambers");
  assert.equal(
    elements.get("stageReadout").textContent,
    "DORMANT · PLAYABLE DEFAULT · 1P/1M/1G/1N",
  );
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(elements.get("stage").width, 940);
  assert.equal(elements.get("stage").height, 610);
  assert.deepEqual(sourceButtons.map((button) => button.dataset.source), [
    "mic",
    "glottis",
    "hybrid",
  ]);
  assert.deepEqual(
    tongueButtons.map((button) => button.dataset.tongue),
    ["0", "1", "2", "3", "4"],
  );
  assert.deepEqual(noseButtons.map((button) => button.dataset.nose), ["0", "1", "2"]);
  assert.deepEqual(
    pressureSourceButtons.map((button) => button.dataset.pressureSource),
    ["0", "1", "2", "3"],
  );
  assert.deepEqual(
    mouthGateButtons.map((button) => button.dataset.mouthGate),
    ["0", "1", "2", "3", "4", "5", "6"],
  );
  assert.deepEqual(phonemeButtons.map((button) => button.dataset.phoneme), [
    "a",
    "e",
    "i",
    "o",
    "u",
    "glottal",
    "k",
    "t",
    "p",
    "s",
    "sh",
    "f",
    "m",
    "n",
    "ng",
  ]);
  assert.deepEqual(
    voicePresetButtons.map((button) => button.dataset.voicePreset),
    [
      "clear",
      "deep",
      "bright",
      "warm",
      "alto",
      "mezzo",
      "soprano",
      "airy",
      "bell",
      "coloratura",
      "whisper",
      "reed",
      "nasal",
      "growl",
      "beatbox",
      "singer",
      "choir",
      "alien",
    ],
  );
  assert.equal(elements.get("articulationSummary").textContent, "1 tongue · 1 nose");
  assert.equal(attributes.get("voice-preset-clear:aria-pressed"), "true");
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "true");
  assert.equal(elements.get("pressureSourceCount").value, "1");
  assert.equal(elements.get("exciterPitch").value, "140");
  assert.equal(elements.get("exciterIntensity").value, "1");
  assert.equal(elements.get("exciterTenseness").value, "0.6");
  assert.equal(elements.get("exciterVibrato").value, "0.12");
  assert.equal(elements.get("pressureSourceCountOut").textContent, "1");
  assert.deepEqual(
    pressureSourceButtons.map((button) => ({
      connected: button.dataset.connected,
      pressed: button.getAttribute("aria-pressed"),
      status: button.status.textContent,
    })),
    [
      { connected: "true", pressed: "true", status: "pulsing" },
      { connected: "false", pressed: "false", status: "offline" },
      { connected: "false", pressed: "false", status: "offline" },
      { connected: "false", pressed: "false", status: "offline" },
    ],
  );
  assert.deepEqual(
    mouthGateButtons.map((button) => ({
      connected: button.dataset.connected,
      disabled: button.disabled,
      pressed: button.getAttribute("aria-pressed"),
    })),
    [
      { connected: "true", disabled: false, pressed: "true" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
    ],
  );

  function selectSource(source) {
    const button = sourceButtons.find((candidate) => candidate.dataset.source === source);
    assert.ok(button, `missing ${source} source button`);
    const direct = listeners.get(`source-${source}:click`);
    const delegated = listeners.get("sourceButtons:click");
    assert.ok(direct || delegated, `missing source listener for ${source}`);
    if (direct) direct({ currentTarget: button, target: button });
    else delegated({ currentTarget: elements.get("sourceButtons"), target: button });
  }

  function clickDataButton(attribute, value, containerId, buttons) {
    const dataKey = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const button = buttons.find((candidate) => candidate.dataset[dataKey] === value);
    assert.ok(button, `missing ${attribute} ${value} button`);
    const direct = listeners.get(`${attribute}-${value}:click`);
    const delegated = listeners.get(`${containerId}:click`);
    assert.ok(direct || delegated, `missing ${attribute} listener for ${value}`);
    const event = {
      currentTarget: direct ? button : elements.get(containerId),
      target: button,
      preventDefault() {},
    };
    if (direct) direct(event);
    else delegated(event);
  }

  function inputControl(id, value) {
    const node = elements.get(id);
    assert.ok(node, `missing #${id}`);
    node.value = String(value);
    const listener = listeners.get(`${id}:input`);
    assert.ok(listener, `missing input listener for #${id}`);
    listener({ currentTarget: node, target: node });
  }

  function keyEvent(key, options = {}) {
    let prevented = false;
    return {
      key,
      code: options.code
        ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : ""),
      target: options.target ?? {},
      repeat: Boolean(options.repeat),
      ctrlKey: Boolean(options.ctrlKey),
      metaKey: Boolean(options.metaKey),
      altKey: Boolean(options.altKey),
      isComposing: Boolean(options.isComposing),
      preventDefault() { prevented = true; },
      get defaultPrevented() { return prevented; },
    };
  }

  function isHeld(button) {
    return button.classList.contains("is-held")
      || button.dataset.held === "true"
      || button.getAttribute("data-held") === "true";
  }

  const keydown = documentListeners.get("keydown");
  const keyup = documentListeners.get("keyup");
  assert.equal(typeof keydown, "function", "type-to-speak needs a document keydown listener");
  assert.equal(typeof keyup, "function", "type-to-speak needs a document keyup listener");
  assert.equal(attributes.get("typingModeButton:aria-checked"), "false");
  assert.equal(elements.get("typingModeState").textContent, "momentary");
  assert.equal(attributes.get("source-glottis:aria-pressed"), "true");
  assert.equal(attributes.get("source-mic:aria-pressed"), "false");

  const typingOffEvent = keyEvent("i");
  keydown(typingOffEvent);
  assert.equal(typingOffEvent.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "false");
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "true");
  const typingOffRelease = keyEvent("i");
  keyup(typingOffRelease);
  assert.equal(typingOffRelease.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "true");
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "false");

  const stageFocus = listeners.get("stage:focus");
  assert.equal(typeof stageFocus, "function", "the canvas needs a beatbox focus listener");
  stageFocus();
  assert.equal(elements.get("stageWrap").classList.contains("is-beatbox-focused"), true);
  assert.match(elements.get("liveStatus").textContent, /works throughout Throatazoid/i);

  const dockMappings = {
    K: "k",
    T: "t",
    P: "p",
    S: "s",
    F: "f",
    M: "m",
    N: "n",
  };
  for (const [key, articulation] of Object.entries(dockMappings)) {
    const button = phonemeButtons.find(
      (candidate) => candidate.dataset.phoneme === articulation,
    );
    assert.ok(button, `missing focused-stage articulation ${articulation}`);
    const down = keyEvent(key, { target: elements.get("stage") });
    keydown(down);
    assert.equal(down.defaultPrevented, true, `${key} should be claimed by the stage`);
    assert.equal(button.getAttribute("aria-pressed"), "true");
    assert.ok(isHeld(button), `${articulation} should show held feedback`);
    assert.equal(elements.get("typingModeState").textContent, "momentary");

    const up = keyEvent(key, { target: elements.get("stage") });
    keyup(up);
    assert.equal(up.defaultPrevented, true);
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(isHeld(button), false);
  }

  const alphabetSymbols = {
    a: "A",
    b: "B",
    c: "CH",
    d: "D",
    e: "E",
    f: "F",
    g: "G",
    h: "H",
    i: "I",
    j: "J",
    k: "K",
    l: "L",
    m: "M",
    n: "N",
    o: "O",
    p: "P",
    q: "Q",
    r: "R",
    s: "S",
    t: "T",
    u: "U",
    v: "V",
    w: "W",
    x: "X",
    y: "Y",
    z: "Z",
  };
  const alphabetSettings = {
    b: { articulationVoicingOut: "92%", oralClosureOut: "100%" },
    c: { articulationVoicingOut: "4%", oralClosureOut: "76%" },
    h: { articulationVoicingOut: "4%", oralClosureOut: "42%" },
    l: { articulationVoicingOut: "92%", oralClosureOut: "24%" },
    p: { articulationVoicingOut: "4%", oralClosureOut: "100%" },
    w: {
      articulationVoicingOut: "92%",
      articulationLipOut: "8%",
      oralClosureOut: "18%",
    },
  };
  for (const [letter, symbol] of Object.entries(alphabetSymbols)) {
    const keycap = alphabetKeycaps.find(
      (candidate) => candidate.dataset.letter === letter,
    );
    assert.ok(keycap, `missing alphabet keycap ${letter}`);
    const down = keyEvent(letter, { target: elements.get("stage") });
    keydown(down);
    assert.equal(down.defaultPrevented, true, `${letter} must reshape the focused stage`);
    assert.equal(keycap.classList.contains("is-held"), true);
    assert.ok(
      elements.get("articulationGestureOut").textContent.startsWith(`${symbol} ·`),
      `${letter} should expose its ${symbol} articulation settings`,
    );
    for (const [outputId, expected] of Object.entries(alphabetSettings[letter] ?? {})) {
      assert.equal(
        elements.get(outputId).textContent,
        expected,
        `${letter} should update ${outputId}`,
      );
    }
    const up = keyEvent(letter, { target: elements.get("stage") });
    keyup(up);
    assert.equal(up.defaultPrevented, true);
    assert.equal(keycap.classList.contains("is-held"), false);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(contexts.length, 1, "the first stage phoneme should start the synth voice");
  assert.equal(getUserMediaCalls, 0);

  for (const vowel of ["A", "E", "I", "O", "U"]) {
    const down = keyEvent(vowel, { target: elements.get("stage") });
    keydown(down);
    assert.equal(
      down.defaultPrevented,
      true,
      `${vowel} should play whenever the stage has focus`,
    );
    assert.equal(
      attributes.get(`phoneme-${vowel.toLowerCase()}:aria-pressed`),
      "true",
    );
    const up = keyEvent(vowel, { target: elements.get("stage") });
    keyup(up);
    assert.equal(up.defaultPrevented, true);
    assert.equal(
      attributes.get(`phoneme-${vowel.toLowerCase()}:aria-pressed`),
      vowel === "A" ? "true" : "false",
      "focused vowel performance should return to the latched A vowel",
    );
  }

  const kButton = phonemeButtons.find((button) => button.dataset.phoneme === "k");
  const pointerDownK = listeners.get("phoneme-k:pointerdown");
  const pointerUpK = listeners.get("phoneme-k:pointerup");
  assert.equal(typeof pointerDownK, "function");
  assert.equal(typeof pointerUpK, "function");
  pointerDownK({
    pointerId: 7,
    preventDefault() {},
  });
  assert.equal(attributes.get("phoneme-k:aria-pressed"), "true");
  assert.ok(isHeld(kButton), "a pressed consonant button must show held feedback");
  assert.equal(elements.get("articulationApertureOut").textContent, "0%");
  assert.match(elements.get("articulationGestureOut").textContent, /PRESSURE BUILDING/);
  await new Promise((resolve) => setTimeout(resolve, 110));
  pointerUpK({ pointerId: 7 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "true");
  assert.equal(attributes.get("phoneme-k:aria-pressed"), "false");
  assert.equal(isHeld(kButton), false);
  assert.match(elements.get("liveStatus").textContent, /K released into A/i);

  const typingToggle = listeners.get("typingModeButton:click");
  assert.equal(typeof typingToggle, "function", "type-to-speak switch needs a click listener");
  typingToggle({ currentTarget: elements.get("typingModeButton"), preventDefault() {} });
  assert.equal(attributes.get("typingModeButton:aria-checked"), "true");
  assert.equal(elements.get("typingModeState").textContent, "armed");

  const typedI = keyEvent("I");
  keydown(typedI);
  assert.equal(typedI.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "false");
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "true");
  assert.ok(
    isHeld(phonemeButtons.find((button) => button.dataset.phoneme === "i")),
    "the active typed phoneme should expose held feedback",
  );

  const firstHeldStatus = elements.get("liveStatus").textContent;
  keydown(keyEvent("i", { repeat: true }));
  assert.equal(
    elements.get("liveStatus").textContent,
    firstHeldStatus,
    "key repeat should not retrigger the held articulation",
  );

  const releasedI = keyEvent("i", { target: new HTMLInputElement() });
  keyup(releasedI);
  assert.equal(releasedI.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "false");
  assert.equal(
    isHeld(phonemeButtons.find((button) => button.dataset.phoneme === "i")),
    false,
  );

  const aButton = phonemeButtons.find((button) => button.dataset.phoneme === "a");
  const oButton = phonemeButtons.find((button) => button.dataset.phoneme === "o");
  keydown(keyEvent("a"));
  keydown(keyEvent("o"));
  assert.equal(attributes.get("phoneme-o:aria-pressed"), "true");
  assert.ok(isHeld(aButton), "earlier held keys should remain visibly held");
  assert.ok(isHeld(oButton), "the most recent key should be visibly held");
  keyup(keyEvent("o"));
  assert.equal(attributes.get("phoneme-o:aria-pressed"), "false");
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "true");
  assert.ok(isHeld(aButton), "releasing the top key should restore the prior gesture");
  keyup(keyEvent("a"));
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "false");
  assert.equal(isHeld(aButton), false);

  keydown(keyEvent("k"));
  assert.equal(attributes.get("phoneme-k:aria-pressed"), "true");
  assert.equal(elements.get("oralClosureOut").textContent, "100%");
  assert.equal(elements.get("articulationApertureOut").textContent, "0%");
  keyup(keyEvent("k"));
  assert.equal(attributes.get("phoneme-k:aria-pressed"), "false");
  assert.equal(elements.get("oralClosureOut").textContent, "6%");
  assert.equal(elements.get("articulationApertureOut").textContent, "94%");

  const editableTarget = new HTMLInputElement();
  editableTarget.type = "text";
  editableTarget.isContentEditable = false;
  const editableEvent = keyEvent("o", { target: editableTarget });
  keydown(editableEvent);
  assert.equal(editableEvent.defaultPrevented, false);
  assert.equal(attributes.get("phoneme-o:aria-pressed"), "false");

  const rangeTarget = new HTMLInputElement();
  rangeTarget.type = "range";
  const rangeLetter = keyEvent("u", { target: rangeTarget });
  keydown(rangeLetter);
  assert.equal(rangeLetter.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-u:aria-pressed"), "true");
  assert.equal(
    isHeld(phonemeButtons.find((button) => button.dataset.phoneme === "u")),
    true,
    "letters must play while a range control has focus",
  );
  const rangeRelease = keyEvent("u", { target: rangeTarget });
  keyup(rangeRelease);
  assert.equal(rangeRelease.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-u:aria-pressed"), "false");

  const rangeArrow = keyEvent("ArrowRight", { target: rangeTarget });
  keydown(rangeArrow);
  assert.equal(rangeArrow.defaultPrevented, false, "range arrow keys retain native behavior");

  const buttonTarget = elements.get("quickSynthButton");
  const buttonLetter = keyEvent("e", { target: buttonTarget });
  keydown(buttonLetter);
  assert.equal(buttonLetter.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-e:aria-pressed"), "true");
  keyup(keyEvent("e", { target: buttonTarget }));
  const buttonEnter = keyEvent("Enter", { target: buttonTarget });
  keydown(buttonEnter);
  assert.equal(buttonEnter.defaultPrevented, false, "button activation keys stay native");

  for (const protectedTarget of [
    new HTMLSelectElement(),
    new HTMLTextAreaElement(),
    {
      isContentEditable: false,
      closest(selector) {
        return selector.includes('[role="combobox"]') ? this : null;
      },
    },
  ]) {
    const protectedEvent = keyEvent("e", { target: protectedTarget });
    keydown(protectedEvent);
    assert.equal(protectedEvent.defaultPrevented, false);
  }

  const contentEditableEvent = keyEvent("u", { target: { isContentEditable: true } });
  keydown(contentEditableEvent);
  assert.equal(contentEditableEvent.defaultPrevented, false);
  assert.equal(attributes.get("phoneme-u:aria-pressed"), "false");

  for (const options of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
  ]) {
    const modifiedEvent = keyEvent("e", options);
    keydown(modifiedEvent);
    assert.equal(modifiedEvent.defaultPrevented, false);
    assert.equal(attributes.get("phoneme-e:aria-pressed"), "false");
  }

  const typedM = keyEvent("m");
  keydown(typedM);
  assert.equal(typedM.defaultPrevented, true);
  assert.equal(attributes.get("phoneme-m:aria-pressed"), "true");
  const stageFocusOut = listeners.get("stageWrap:focusout");
  assert.equal(typeof stageFocusOut, "function");
  stageFocusOut({ relatedTarget: elements.get("quickSynthButton") });
  assert.equal(
    attributes.get("phoneme-m:aria-pressed"),
    "true",
    "moving focus into the control UI must not cancel a held letter",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getUserMediaCalls, 0, "typed M must not invoke the microphone shortcut");
  keyup(keyEvent("m"));

  const contextsBeforeAlphabetKeys = contexts.length;
  for (const [key, symbol] of [["g", "G"], ["h", "H"]]) {
    const down = keyEvent(key);
    keydown(down);
    assert.equal(down.defaultPrevented, true);
    assert.ok(elements.get("articulationGestureOut").textContent.startsWith(`${symbol} ·`));
    keyup(keyEvent(key));
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    contexts.length,
    contextsBeforeAlphabetKeys,
    "alphabet play must not trigger legacy source shortcuts",
  );
  assert.equal(getUserMediaCalls, 0);

  const glottalKey = keyEvent("?");
  keydown(glottalKey);
  assert.equal(glottalKey.defaultPrevented, true);
  assert.match(elements.get("articulationGestureOut").textContent, /^ʔ ·/);
  keyup(keyEvent("?"));
  const unsupportedNumber = keyEvent("1");
  keydown(unsupportedNumber);
  assert.equal(unsupportedNumber.defaultPrevented, false);

  typingToggle({ currentTarget: elements.get("typingModeButton"), preventDefault() {} });
  assert.equal(attributes.get("typingModeButton:aria-checked"), "false");
  assert.equal(elements.get("typingModeState").textContent, "momentary");

  inputControl("pressureSourceCount", 4);
  assert.equal(elements.get("pressureSourceCount").value, "4");
  assert.equal(elements.get("pressureSourceCountOut").textContent, "4");
  assert.ok(pressureSourceButtons.every(
    (button) => button.dataset.connected === "true"
      && button.getAttribute("aria-pressed") === "true"
      && button.status.textContent === "pulsing",
  ));

  for (const button of pressureSourceButtons) {
    clickDataButton(
      "pressure-source",
      button.dataset.pressureSource,
      "pressureSourceButtons",
      pressureSourceButtons,
    );
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(button.status.textContent, "sealed");
  }
  assert.match(elements.get("liveStatus").textContent, /P4 closed from the root airway/i);

  inputControl("pressureSourceCount", 2);
  assert.equal(elements.get("pressureSourceCountOut").textContent, "2");
  assert.deepEqual(
    pressureSourceButtons.map((button) => ({
      connected: button.dataset.connected,
      status: button.status.textContent,
    })),
    [
      { connected: "true", status: "sealed" },
      { connected: "true", status: "sealed" },
      { connected: "false", status: "offline" },
      { connected: "false", status: "offline" },
    ],
  );

  clickDataButton(
    "pressure-source",
    "3",
    "pressureSourceButtons",
    pressureSourceButtons,
  );
  assert.equal(elements.get("pressureSourceCount").value, "4");
  assert.equal(elements.get("pressureSourceCountOut").textContent, "4");
  assert.equal(pressureSourceButtons[3].dataset.connected, "true");
  assert.equal(pressureSourceButtons[3].getAttribute("aria-pressed"), "true");
  assert.equal(pressureSourceButtons[3].status.textContent, "pulsing");

  inputControl("throatCount", 7);
  assert.equal(elements.get("throatCount").value, "7");
  assert.equal(elements.get("throatCountOut").textContent, "7");
  assert.ok(mouthGateButtons.every(
    (button) => button.dataset.connected === "true"
      && button.disabled === false
      && button.getAttribute("aria-pressed") === "true",
  ));

  for (const button of mouthGateButtons) {
    clickDataButton(
      "mouth-gate",
      button.dataset.mouthGate,
      "mouthGateButtons",
      mouthGateButtons,
    );
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-pressed"), "false");
  }
  assert.match(
    elements.get("liveStatus").textContent,
    /Mouth 7 airway sealed; the manifold pressure has been redistributed\./i,
  );

  inputControl("throatCount", 3);
  assert.equal(elements.get("throatCountOut").textContent, "3");
  assert.deepEqual(
    mouthGateButtons.map((button) => ({
      connected: button.dataset.connected,
      disabled: button.disabled,
      pressed: button.getAttribute("aria-pressed"),
    })),
    [
      { connected: "true", disabled: false, pressed: "false" },
      { connected: "true", disabled: false, pressed: "false" },
      { connected: "true", disabled: false, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
      { connected: "false", disabled: true, pressed: "false" },
    ],
  );

  inputControl("tongueCount", 3);
  clickDataButton("tongue", "2", "tongueButtons", tongueButtons);
  inputControl("selectedTonguePosition", 0.91);
  inputControl("selectedTongueHeight", 0.82);
  inputControl("selectedTongueCurl", 0.73);
  assert.equal(elements.get("tongueCountOut").textContent, "3");
  assert.equal(elements.get("selectedTonguePositionOut").textContent, "91%");
  assert.equal(elements.get("selectedTongueHeightOut").textContent, "82%");
  assert.equal(elements.get("selectedTongueCurlOut").textContent, "73%");

  inputControl("noseCount", 3);
  clickDataButton("nose", "2", "noseButtons", noseButtons);
  inputControl("selectedNoseOpenness", 0.88);
  inputControl("selectedNoseLength", 0.77);
  inputControl("selectedNoseResonance", 0.66);
  inputControl("oralClosure", 0.57);
  assert.equal(elements.get("noseCountOut").textContent, "3");
  assert.equal(elements.get("selectedNoseOpennessOut").textContent, "88%");
  assert.equal(elements.get("selectedNoseLengthOut").textContent, "77%");
  assert.equal(elements.get("selectedNoseResonanceOut").textContent, "66%");
  assert.equal(elements.get("oralClosureOut").textContent, "57%");
  assert.equal(elements.get("articulationSummary").textContent, "3 tongues · 3 noses");

  clickDataButton("phoneme", "i", "phonemeButtons", phonemeButtons);
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "true");
  assert.match(elements.get("liveStatus").textContent, /I vowel sounding/i);
  assert.equal(elements.get("articulationLipOut").textContent, "100%");
  clickDataButton("phoneme", "u", "phonemeButtons", phonemeButtons);
  assert.equal(attributes.get("phoneme-u:aria-pressed"), "true");
  assert.equal(elements.get("articulationLipOut").textContent, "6%");
  clickDataButton("phoneme", "i", "phonemeButtons", phonemeButtons);
  clickDataButton("phoneme", "m", "phonemeButtons", phonemeButtons);
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "false");
  assert.equal(attributes.get("phoneme-m:aria-pressed"), "true");
  assert.match(elements.get("liveStatus").textContent, /M sounding over I/i);

  assert.equal(contexts.length, 1);
  assert.equal(getUserMediaCalls, 0, "the internal glottis must not request microphone access");
  assert.equal(requestedConstraints, null);
  assert.ok(periodicWaves.length >= 1, "the glottis should build a periodic vocal waveform");
  assert.ok(bufferSources.length >= 1, "the glottis should build its breath-noise source");
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("stateMetric").textContent, "awake");
  assert.ok(analysers.length >= 3);

  clickDataButton(
    "voice-preset",
    "deep",
    "presetButtons",
    voicePresetButtons,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("voice-preset-deep:aria-pressed"), "true");
  assert.equal(elements.get("throatCount").value, "1");
  assert.equal(elements.get("exciterPitch").value, "72");
  assert.equal(attributes.get("phoneme-o:aria-pressed"), "true");
  assert.equal(attributes.get("specimen-oracle:aria-pressed"), "false");
  assert.equal(getUserMediaCalls, 0, "voice presets must remain permission-free");

  clickDataButton(
    "voice-preset",
    "coloratura",
    "presetButtons",
    voicePresetButtons,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attributes.get("voice-preset-coloratura:aria-pressed"), "true");
  assert.equal(elements.get("exciterPitch").value, "392");
  assert.equal(attributes.get("phoneme-e:aria-pressed"), "true");

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(stopped, 0, "stopping the internal glottis should not touch a media track");

  selectSource("glottis");
  listeners.get("awakenButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "on");
  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));

  selectSource("mic");
  listeners.get("awakenButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getUserMediaCalls, 1);
  const constraintValue = (value) => (
    typeof value === "object" && value !== null ? value.ideal : value
  );
  assert.equal(constraintValue(requestedConstraints.audio.echoCancellation), false);
  assert.equal(constraintValue(requestedConstraints.audio.noiseSuppression), false);
  assert.equal(constraintValue(requestedConstraints.audio.autoGainControl), false);
  assert.equal(elements.get("audioState").textContent, "on");

  listeners.get("specimen-hive:click")();
  assert.equal(elements.get("throatCount").value, "5");
  assert.equal(elements.get("anatomySummary").textContent, "Hive · 5 mouths");
  assert.equal(attributes.get("specimen-hive:aria-pressed"), "true");
  assert.equal(attributes.get("voice-preset-coloratura:aria-pressed"), "false");

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.ok(stopped >= 1);
});

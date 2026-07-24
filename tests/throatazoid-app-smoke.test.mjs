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
  elements.get("specimenButtons").querySelectorAll = () => specimenButtons;

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
      return {
        dataset: { [dataKey]: value },
        disabled: false,
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
  assert.equal(elements.get("stageReadout").textContent, "DORMANT · TRIUNE · 3T/2G/2N");
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
  assert.equal(elements.get("articulationSummary").textContent, "2 tongues · 2 noses");
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "true");

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
  assert.equal(elements.get("typingModeState").textContent, "off");

  const typingOffEvent = keyEvent("i");
  keydown(typingOffEvent);
  assert.equal(typingOffEvent.defaultPrevented, false);
  assert.equal(attributes.get("phoneme-a:aria-pressed"), "true");
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "false");

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
  editableTarget.isContentEditable = false;
  const editableEvent = keyEvent("o", { target: editableTarget });
  keydown(editableEvent);
  assert.equal(editableEvent.defaultPrevented, false);
  assert.equal(attributes.get("phoneme-o:aria-pressed"), "false");

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
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getUserMediaCalls, 0, "typed M must not invoke the microphone shortcut");
  keyup(keyEvent("m"));

  const contextsBeforeUnsupportedKeys = contexts.length;
  for (const key of ["g", "h"]) keydown(keyEvent(key));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    contexts.length,
    contextsBeforeUnsupportedKeys,
    "typing mode must suppress the legacy G/H source shortcuts",
  );
  assert.equal(getUserMediaCalls, 0);

  typingToggle({ currentTarget: elements.get("typingModeButton"), preventDefault() {} });
  assert.equal(attributes.get("typingModeButton:aria-checked"), "false");
  assert.equal(elements.get("typingModeState").textContent, "off");

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
  assert.match(elements.get("liveStatus").textContent, /articulation loaded\./i);
  clickDataButton("phoneme", "m", "phonemeButtons", phonemeButtons);
  assert.equal(attributes.get("phoneme-i:aria-pressed"), "false");
  assert.equal(attributes.get("phoneme-m:aria-pressed"), "true");
  assert.match(elements.get("liveStatus").textContent, /articulation loaded\./i);

  selectSource("glottis");
  listeners.get("awakenButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(contexts.length, 1);
  assert.equal(getUserMediaCalls, 0, "the internal glottis must not request microphone access");
  assert.equal(requestedConstraints, null);
  assert.ok(periodicWaves.length >= 1, "the glottis should build a periodic vocal waveform");
  assert.ok(bufferSources.length >= 1, "the glottis should build its breath-noise source");
  assert.equal(elements.get("audioState").textContent, "on");
  assert.equal(elements.get("stateMetric").textContent, "awake");
  assert.ok(analysers.length >= 3);

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.equal(stopped, 0, "stopping the internal glottis should not touch a media track");

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
  assert.equal(elements.get("anatomySummary").textContent, "Hive · 5 throats");
  assert.equal(attributes.get("specimen-hive:aria-pressed"), "true");

  listeners.get("stopButton:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get("audioState").textContent, "off");
  assert.ok(stopped >= 1);
});

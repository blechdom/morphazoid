import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyBrowserMidiMessage,
  browserMidiControls,
  browserMidiNoteValue,
  browserMidiPitchControl,
  browserPitchBendValue,
  installBrowserMidiAdapter,
  isBrowserMidiControl,
  isWaxWrappedDocument,
} from "../src/browser-midi-adapter.js";
import {
  INSTRUMENT_MIDI_CAPABILITIES,
  NATIVE_INSTRUMENT_MIDI_IDS,
  NO_GENERIC_NOTE_KEYBOARD_IDS,
  PAGE_KEYBOARD_INSTRUMENT_IDS,
  instrumentMidiCapabilityForId,
} from "../src/instrument-midi-capabilities.js";
import { INSTRUMENTS } from "../src/instrument-catalog.js";
import { MidiClockTempoTracker } from "../src/wax-midi-routing.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
  }
}

class FakeCustomEvent extends FakeEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.cancelable = Boolean(options.cancelable);
    this.detail = options.detail;
    this.defaultPrevented = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function range(id, { min = 0, max = 1, step = 0.01, value = min } = {}) {
  return {
    id,
    tagName: "INPUT",
    name: "",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    disabled: false,
    events: [],
    closest() { return null; },
    matches(selector) { return selector.includes("input[type='range']"); },
    getAttribute() { return null; },
    dispatchEvent(event) { this.events.push(event.type); return true; },
  };
}

function toggle(id) {
  let pressed = false;
  return {
    id,
    tagName: "BUTTON",
    dataset: {},
    clicks: 0,
    click() { this.clicks += 1; pressed = !pressed; },
    getAttribute(name) { return name === "aria-pressed" ? String(pressed) : null; },
    matches() { return false; },
  };
}

function testDocument() {
  const frequency = range("frequency", { min: 20, max: 2_000, step: 0.01, value: 220 });
  const tone = range("tone", { value: 0.25 });
  const intensity = range("intensity", { value: 0.2 });
  const tempo = range("tempo", { min: 20, max: 400, step: 0.01, value: 90 });
  const audio = toggle("audioButton");
  const play = toggle("playButton");
  const preset = {
    id: "synthPreset",
    tagName: "SELECT",
    name: "preset",
    disabled: false,
    value: "a",
    options: [{ value: "a" }, { value: "b" }, { value: "c" }],
    closest() { return null; },
    matches(selector) { return selector.includes("select"); },
    getAttribute() { return null; },
    events: [],
    dispatchEvent(event) { this.events.push(event.type); return true; },
  };
  const controls = [frequency, tone, intensity, tempo, preset];
  const bySelector = new Map([
    ["#frequency", frequency],
    ["#tempo", tempo],
    ["#audioButton", audio],
    ["#playButton", play],
  ]);
  const documentObject = {
    controls,
    frequency,
    tone,
    intensity,
    tempo,
    audio,
    play,
    preset,
    bySelector,
    querySelector(selector) {
      if (selector.startsWith("label[for=")) return null;
      if (selector.startsWith("select[id*='preset'")) return preset;
      return bySelector.get(selector) ?? null;
    },
    querySelectorAll(selector) {
      if (selector.includes("input[type='range']") && selector.includes("select")) return controls;
      if (selector === "input[type='range']:not([disabled])") return controls.slice(0, 4);
      return [];
    },
  };
  return documentObject;
}

function testRuntime() {
  const midiEvents = [];
  return {
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    midiEvents,
    dispatchEvent(event) {
      midiEvents.push(event);
      return !event.defaultPrevented;
    },
  };
}

test("one acyclic capability registry covers every playable catalog instrument", () => {
  assert.equal(INSTRUMENT_MIDI_CAPABILITIES.length, INSTRUMENTS.length);
  assert.deepEqual(
    new Set(INSTRUMENT_MIDI_CAPABILITIES.map(({ id }) => id)),
    new Set(INSTRUMENTS.map(({ id }) => id)),
  );
  assert.deepEqual(NATIVE_INSTRUMENT_MIDI_IDS, [
    "shape",
    "recursive-fm",
    "recursive-pm",
    "chaotic-fm",
    "chaotic-pm",
    "fm-drums",
    "sample-drums",
    "constellation",
  ]);
  assert.equal(instrumentMidiCapabilityForId("rubix").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("ouroborousel").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("ourorourobouroboros").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("ouroboros").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("ouroboros-borealis").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("hyper-rubix").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("constellation").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("enveloper").noteMode, "sequence");
  assert.equal(
    INSTRUMENT_MIDI_CAPABILITIES.filter(({ id }) => id === "enveloper").length,
    1,
  );
  assert.equal(instrumentMidiCapabilityForId("karplus-carpet").noteMode, "pitched");
  assert.equal(instrumentMidiCapabilityForId("pink-trombonazoid").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("throat-singing").noteMode, "pitched");
  assert.equal(instrumentMidiCapabilityForId("sliding-puzzle").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("hiccup-head").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("creaturazoid").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("digestazoid").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("graph-drums").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("graph-synth").noteMode, "pitched");
  assert.equal(instrumentMidiCapabilityForId("wave-pool").noteMode, "drums");
  assert.equal(instrumentMidiCapabilityForId("colony-syrinx").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("harmonica").noteMode, "pitched");
  assert.equal(instrumentMidiCapabilityForId("morphazoidical").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("object-forge").noteMode, "pitched");
  assert.deepEqual(PAGE_KEYBOARD_INSTRUMENT_IDS, [
    "image-to-instrument-3",
    "throatazoid",
    "throat-singing",
    "tongued-beasts",
    "blowhole",
    "jaw-harp",
    "jaw-jam",
    "harmonica",
    "hiccup-head",
    "creaturazoid",
    "digestazoid",
    "wave-pool",
    "colony-syrinx",
    "breath-atlas",
    "morphynx",
    "hyper-syrinx",
    "alien-larynx",
    "spelling-synthesizer",
    "lumber",
    "micmic",
    "karplus-strong",
    "karplus-carpet",
    "object-forge",
    "surround-field",
    "gesturama",
    "constellation",
  ]);
  assert.deepEqual(NO_GENERIC_NOTE_KEYBOARD_IDS, [
    "boidzoid",
    "vector-flight",
    "pink-trombonazoid",
    "vocalzoid",
    "webgpu-chiptune",
    "sliding-puzzle",
    "hyper-rubix",
    "webgpu-synths",
    "playhead-paint",
    "slippery-resynthesis",
    "micromorph",
    "moire-drone",
    "candy-coil-delay",
    "chladni-plate",
    "spring-choir",
    "gear-ratio-drums",
    "cellular-automata",
    "reaction-diffusion",
    "neural-pulse",
    "cantor-lock",
    "quantum-square-dance",
    "orbital-ferris",
    "enveloper",
    "penrose-tilings",
    "algorithmic-mazes",
    "paths",
  ]);
  assert.equal(instrumentMidiCapabilityForId("spelling-synthesizer").computerKeyboardMode, "page");
  assert.equal(instrumentMidiCapabilityForId("constellation").midiInputMode, "native");
  assert.equal(instrumentMidiCapabilityForId("constellation").computerKeyboardMode, "page");
  assert.equal(instrumentMidiCapabilityForId("constellation").midiOutput, true);
  assert.equal(instrumentMidiCapabilityForId("webgpu-chiptune").noteMode, "sequence");
  assert.equal(instrumentMidiCapabilityForId("webgpu-chiptune").computerKeyboardMode, "none");
  assert.equal(instrumentMidiCapabilityForId("shape-drums").computerKeyboardMode, "midi");
  assert.equal(instrumentMidiCapabilityForId("shader-synth-playground").computerKeyboardMode, "midi");
  assert.equal(instrumentMidiCapabilityForId("recursion").startsAudio, true);
  assert.equal(instrumentMidiCapabilityForId("lumber").startsAudio, false);
  assert.equal(instrumentMidiCapabilityForId("graph-delay").audioInput, true);
  assert.equal(instrumentMidiCapabilityForId("micromorph").audioInput, true);
  assert.equal(instrumentMidiCapabilityForId("micromorph").noteMode, "processor");
  assert.equal(instrumentMidiCapabilityForId("micromorph").computerKeyboardMode, "none");
  assert.equal(instrumentMidiCapabilityForId("micromorph").midiOutput, false);
  assert.equal(instrumentMidiCapabilityForId("micromorph").startsAudio, false);
  assert.equal(instrumentMidiCapabilityForId("slippery-resynthesis").audioInput, true);
  assert.equal(instrumentMidiCapabilityForId("slippery-resynthesis").noteMode, "processor");
  assert.equal(instrumentMidiCapabilityForId("slippery-resynthesis").computerKeyboardMode, "none");
  assert.equal(instrumentMidiCapabilityForId("moire-drone").audioInput, false);
  assert.equal(instrumentMidiCapabilityForId("moire-drone").noteMode, "processor");
  assert.equal(instrumentMidiCapabilityForId("moire-drone").startsAudio, true);
  assert.equal(instrumentMidiCapabilityForId("moire-drone").computerKeyboardMode, "none");
  assert.equal(instrumentMidiCapabilityForId("throatazoid").audioInput, true);
  assert.equal(instrumentMidiCapabilityForId("morphynx").audioInput, true);
  assert.equal(instrumentMidiCapabilityForId("alien-larynx").audioInput, true);
  assert.equal(instrumentMidiCapabilityForId("chaotic-fm").audioInput, false);
  assert.equal(instrumentMidiCapabilityForId("rubix").midiOutput, true);
  assert.equal(instrumentMidiCapabilityForId("pink-trombonazoid").midiOutput, false);
  assert.equal(instrumentMidiCapabilityForId("pink-trombonazoid").computerKeyboardMode, "none");
  assert.equal(instrumentMidiCapabilityForId("throat-singing").computerKeyboardMode, "page");
  assert.equal(instrumentMidiCapabilityForId("vocalzoid").midiOutput, false);
  assert.equal(instrumentMidiCapabilityForId("chaotic-fm").midiOutput, false);
  assert.equal(instrumentMidiCapabilityForId("wax"), null);
  assert.deepEqual(
    Object.fromEntries(["processor", "drums", "pitched", "sequence"].map((noteMode) => [
      noteMode,
      INSTRUMENT_MIDI_CAPABILITIES.filter((capability) => capability.noteMode === noteMode).length,
    ])),
    { processor: 9, drums: 23, pitched: 46, sequence: 51 },
    "all 129 routes have exactly one intentional note behavior",
  );
  assert.equal(
    INSTRUMENT_MIDI_CAPABILITIES.every(({
      audioInput,
      computerKeyboardMode,
      midiInput,
      midiInputMode,
      midiOutput,
    }) => (
      midiInput === true
      && ["native", "universal-control"].includes(midiInputMode)
      && ["page", "midi", "none"].includes(computerKeyboardMode)
      && typeof audioInput === "boolean"
      && typeof midiOutput === "boolean"
    )),
    true,
  );
});

test("every playable catalog page owns one shared MIDI toolbar", async () => {
  let mastheadPages = 0;
  let dedicatedHostPages = 0;
  for (const instrument of INSTRUMENTS) {
    const cleanHref = instrument.href.split(/[?#]/)[0];
    const htmlPath = cleanHref.endsWith("/")
      ? path.join(repositoryRoot, cleanHref, "index.html")
      : path.join(repositoryRoot, cleanHref);
    const html = await readFile(htmlPath, "utf8");
    assert.match(html, /<script[^>]+src="(?:\.\.\/)?nav\.js(?:\?[^"]+)?"/, `${instrument.id} loads nav.js`);
    assert.match(
      html,
      /class="[^"]*masthead|data-midi-toolbar-host/,
      `${instrument.id} exposes a shared MIDI toolbar host`,
    );
    const hasMasthead = /class=(?:"[^"]*\bmasthead\b[^"]*"|'[^']*\bmasthead\b[^']*')/i.test(html);
    const hasDedicatedHost = /\bdata-midi-toolbar-host\b/i.test(html);
    assert.equal(
      Number(hasMasthead) + Number(hasDedicatedHost),
      1,
      `${instrument.id} has one unambiguous toolbar placement strategy`,
    );
    mastheadPages += Number(hasMasthead);
    dedicatedHostPages += Number(hasDedicatedHost);
    if (instrument.id === "morphazoidical") {
      assert.match(html, /<body[^>]+data-instrument-info="off"/);
      assert.doesNotMatch(html, /class="instrument-page-info"/);
      assert.match(html, /<a class="brand" href="\.\.\/" aria-label="Morphazoid home">/);
    } else {
      assert.match(
        html,
        /<a class="wordmark" href="\.\/" aria-label="Morphazoid home">/,
        `${instrument.id} logo links to the home page`,
      );
    }
  }
  assert.equal(mastheadPages, 128);
  assert.equal(dedicatedHostPages, 1, "Morphazoidical supplies the one non-masthead host");

  const atlas = await readFile(path.join(repositoryRoot, "morphazoidical", "atlas.html"), "utf8");
  assert.doesNotMatch(atlas, /data-midi-toolbar-host/, "the non-playable Feature Atlas stays informational");
  const workbenchCss = await readFile(
    path.join(repositoryRoot, "morphazoidical", "style.css"),
    "utf8",
  );
  assert.match(
    workbenchCss,
    /@media \(max-width: 680px\)[\s\S]*?\.session-state\[data-midi-toolbar-host\]\s*\{[^}]*grid-column: 1 \/ -1;[^}]*width: 100%;/,
    "the workbench moves MIDI and Audio onto a full-width mobile row",
  );
  assert.match(
    workbenchCss,
    /\.session-state \.header-settings-trigger:focus-visible\s*\{[^}]*outline: 2px solid var\(--mint\)/,
    "the injected settings summary keeps the workbench focus ring",
  );
  assert.match(
    workbenchCss,
    /\.session-state \.header-output-meter-shell\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/s,
    "the workbench presents separate left and right output lanes",
  );
  assert.match(workbenchCss, /\.session-state \.header-output-meter-shell\s*\{[^}]*width: 22px;[^}]*gap: 0;/s);
  assert.match(
    workbenchCss,
    /\.audio-toggle > \*\s*\{[^}]*position: absolute !important;[^}]*clip-path: inset\(50%\) !important;[^}]*\}[\s\S]*?\.audio-toggle::before\s*\{[^}]*mask: url\("data:image\/svg\+xml/s,
    "the workbench visually renders only its speaker icon while retaining its authored accessible name",
  );
  assert.match(
    workbenchCss,
    /\.audio-toggle\[aria-pressed="true"\]\s*\{[^}]*background: var\(--mint\);[^}]*box-shadow:/s,
    "the workbench Audio-on state is filled and glowing",
  );
  assert.match(
    workbenchCss,
    /\.session-state \.header-settings-section > select\s*\{[^}]*background-image:\s*linear-gradient\(45deg, transparent 50%, currentColor 50%\),[^}]*appearance: none;/s,
    "workbench Settings selects keep the same dropdown chevron affordance",
  );
});

test("browser fallback registers once, chooses useful computer keys, and skips native and WAX pages", () => {
  const registrations = [];
  const manager = {
    registerClient(client) {
      registrations.push(client);
      return () => registrations.push("unregistered");
    },
  };
  const listeners = new Map();
  const runtime = {
    document: { querySelector() { return null; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const adapter = installBrowserMidiAdapter(runtime, runtime.document, {
    routeId: "rubix",
    manager,
  });
  assert.ok(adapter);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "browser-universal:rubix");
  assert.deepEqual(registrations[0].computerKeyboard, {
    layout: "pad-grid",
    baseNote: 36,
    velocity: 100,
  });
  assert.equal(installBrowserMidiAdapter(runtime, runtime.document, {
    routeId: "rubix",
    manager,
  }), adapter, "repeat initialization reuses the page client");
  adapter.dispose();
  assert.equal(registrations.at(-1), "unregistered");

  const nativeRuntime = { document: { querySelector() { return null; } } };
  assert.equal(installBrowserMidiAdapter(nativeRuntime, nativeRuntime.document, {
    routeId: "chaotic-fm",
    manager,
  }), null);
  assert.equal(registrations.filter((item) => item !== "unregistered").length, 1);

  const typingRuntime = { document: { querySelector() { return null; } } };
  const typingAdapter = installBrowserMidiAdapter(typingRuntime, typingRuntime.document, {
    routeId: "spelling-synthesizer",
    manager,
  });
  assert.ok(typingAdapter);
  assert.equal(registrations.at(-1).computerKeyboard, false);
  typingAdapter.dispose();

  const waxDocument = {
    querySelector(selector) {
      return selector.includes("data-morphazoid-wax-bootstrap") ? {} : null;
    },
  };
  assert.equal(isWaxWrappedDocument({}, waxDocument), true);
  assert.equal(installBrowserMidiAdapter({}, waxDocument, {
    routeId: "cascading-fm",
    manager,
  }), null, "generated WAX pages remain owned by the WAX universal adapter");
});

test("Recursion's built-in Noise and Impulse sources prepare audio despite its processor role", () => {
  const documentObject = testDocument();
  applyBrowserMidiMessage({
    documentObject,
    runtime: testRuntime(),
    routeId: "recursion",
    support: instrumentMidiCapabilityForId("recursion"),
    message: { type: "noteOn", note: 60, velocity: 100 },
  });
  assert.equal(documentObject.audio.clicks, 1);
});

test("clean release builds include untracked browser MIDI runtime modules", async () => {
  const buildScript = await readFile(path.join(repositoryRoot, "scripts", "build-site.sh"), "utf8");
  for (const runtimeModule of [
    "src/audio-output-manager.js",
    "src/browser-midi-adapter.js",
    "src/instrument-midi-capabilities.js",
  ]) {
    assert.equal(
      buildScript.split(runtimeModule).length - 1,
      2,
      `${runtimeModule} is present in both the pre-commit copy and required-file lists`,
    );
  }
});

test("every route either keeps its native client or receives the intended browser keyboard layout", () => {
  for (const support of INSTRUMENT_MIDI_CAPABILITIES) {
    const registrations = [];
    const listeners = new Map();
    const manager = {
      registerClient(client) {
        registrations.push(client);
        return () => registrations.push("unregistered");
      },
    };
    const documentObject = { querySelector() { return null; } };
    const runtime = {
      document: documentObject,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    const adapter = installBrowserMidiAdapter(runtime, documentObject, {
      routeId: support.id,
      manager,
    });

    if (support.midiInputMode === "native") {
      assert.equal(adapter, null, `${support.id} must retain its exact native MIDI implementation`);
      assert.equal(registrations.length, 0, `${support.id} must not register a second MIDI client`);
      continue;
    }

    assert.ok(adapter, `${support.id} installs the universal browser client`);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].id, `browser-universal:${support.id}`);
    const expectedKeyboard = support.computerKeyboardMode !== "midi"
      ? false
      : support.noteMode === "drums"
        ? { layout: "pad-grid", baseNote: 36, velocity: 100 }
        : { layout: "piano", baseNote: 48, velocity: 100 };
    assert.deepEqual(
      registrations[0].computerKeyboard,
      expectedKeyboard,
      `${support.id} avoids page-key collisions and chooses its expected playing layout`,
    );
    adapter.dispose();
    assert.equal(registrations.at(-1), "unregistered");
    assert.equal(listeners.has("pagehide"), false);
  }
});

test("every WAX ownership marker suppresses the browser client", () => {
  const variants = [
    {
      label: "runtime bridge",
      runtime: { MorphazoidWAX: {} },
      documentObject: { querySelector() { return null; } },
    },
    {
      label: "output-mode dataset",
      runtime: {},
      documentObject: {
        documentElement: { dataset: { morphazoidWaxOutputMode: "audio" } },
        querySelector() { return null; },
      },
    },
    {
      label: "bootstrap script",
      runtime: {},
      documentObject: {
        querySelector(selector) {
          return selector.includes("data-morphazoid-wax-bootstrap") ? {} : null;
        },
      },
    },
    {
      label: "universal-adapter script",
      runtime: {},
      documentObject: {
        querySelector(selector) {
          return selector.includes("data-morphazoid-wax-universal-adapter") ? {} : null;
        },
      },
    },
  ];

  for (const { label, runtime, documentObject } of variants) {
    let registrations = 0;
    const manager = {
      registerClient() {
        registrations += 1;
        return () => {};
      },
    };
    assert.equal(isWaxWrappedDocument(runtime, documentObject), true, label);
    assert.equal(installBrowserMidiAdapter(runtime, documentObject, {
      routeId: "cascading-fm",
      manager,
    }), null, label);
    assert.equal(registrations, 0, `${label} prevents competing browser registration`);
  }
});

test("generic control discovery excludes MIDI and navigation UI while retaining instrument controls", () => {
  function select(id, blockedClosest = "") {
    return {
      id,
      tagName: "SELECT",
      disabled: false,
      matches(selector) { return selector.includes("select"); },
      closest(selector) { return blockedClosest && selector.includes(blockedClosest) ? {} : null; },
    };
  }
  function slider(id, blockedClosest = "", disabled = false) {
    const control = range(id);
    control.disabled = disabled;
    control.closest = (selector) => (
      blockedClosest && selector.includes(blockedClosest) ? {} : null
    );
    return control;
  }

  const instrumentSlider = slider("filterCutoff");
  const instrumentSelect = select("waveform");
  const profile = select("midiProfileSelect");
  const mobileNavigation = select("mobileInstrumentSelect");
  const headerNavigation = select("instrumentJump", "header");
  const midiPanelSlider = slider("midiVelocity", ".midi-toolbar");
  const disabledSlider = slider("disabledPatchControl", "", true);
  const candidates = [
    instrumentSlider,
    instrumentSelect,
    profile,
    mobileNavigation,
    headerNavigation,
    midiPanelSlider,
    disabledSlider,
  ];
  const documentObject = { querySelectorAll() { return candidates; } };

  assert.deepEqual(browserMidiControls(documentObject), [instrumentSlider, instrumentSelect]);
  assert.equal(isBrowserMidiControl(profile), false);
  assert.equal(isBrowserMidiControl(mobileNavigation), false);
  assert.equal(isBrowserMidiControl(headerNavigation), false);
  assert.equal(isBrowserMidiControl(midiPanelSlider), false);
  assert.equal(isBrowserMidiControl(disabledSlider), false);
});

test("universal browser mapping handles notes, note-off events, CC, bend, presets, pressure, and transport", () => {
  const documentObject = testDocument();
  const runtime = testRuntime();
  const support = instrumentMidiCapabilityForId("cascading-fm");
  const common = { documentObject, runtime, routeId: "cascading-fm", support };

  assert.equal(applyBrowserMidiMessage({
    ...common,
    message: { type: "noteOn", note: 69, velocity: 100 },
  }), true);
  assert.ok(Math.abs(Number(documentObject.frequency.value) - 440) < 0.01);
  assert.equal(documentObject.audio.clicks, 1);
  assert.equal(
    documentObject.play.getAttribute("aria-pressed"),
    "true",
    "a pitched note starts an explicit page transport after retuning it",
  );
  assert.equal(runtime.midiEvents.at(-1).type, "morphazoid:midi-input");
  assert.equal(runtime.midiEvents.at(-1).detail.source, "browser");

  const bendBases = new WeakMap();
  applyBrowserMidiMessage({
    ...common,
    bendBases,
    message: { type: "noteOn", note: 69, velocity: 100 },
  });
  applyBrowserMidiMessage({
    ...common,
    bendBases,
    message: { type: "pitchBend", normalized: 1 },
  });
  assert.ok(Math.abs(Number(documentObject.frequency.value) - 493.883) < 0.02);
  applyBrowserMidiMessage({
    ...common,
    bendBases,
    message: { type: "pitchBend", normalized: 0 },
  });
  assert.ok(Math.abs(Number(documentObject.frequency.value) - 440) < 0.01);

  assert.equal(applyBrowserMidiMessage({
    ...common,
    message: { type: "noteOff", note: 69, velocity: 0 },
  }), false);
  assert.equal(documentObject.audio.clicks, 1, "note-off publishes an event without cutting a page's tails");

  applyBrowserMidiMessage({
    ...common,
    message: { type: "controlChange", controller: 74, value: 127, logical: { type: "cc" } },
  });
  assert.equal(Number(documentObject.tone.value), 1);
  applyBrowserMidiMessage({
    ...common,
    message: {
      type: "controlChange",
      controller: 15,
      value: 64,
      logical: { type: "macro", index: 1 },
    },
  });
  assert.ok(Math.abs(Number(documentObject.tone.value) - (64 / 127)) < 0.01);

  applyBrowserMidiMessage({
    ...common,
    message: { type: "channelPressure", pressure: 100 },
  });
  assert.ok(Math.abs(Number(documentObject.intensity.value) - (100 / 127)) < 0.01);
  applyBrowserMidiMessage({
    ...common,
    message: { type: "polyPressure", note: 69, pressure: 127 },
  });
  assert.equal(Number(documentObject.intensity.value), 1);
  const intensityBeforePanic = documentObject.intensity.value;
  assert.equal(applyBrowserMidiMessage({
    ...common,
    message: {
      type: "controlChange",
      controller: 123,
      value: 0,
      logical: { type: "standard", name: "allNotesOff" },
    },
  }), false, "panic CCs are published but never repurposed as patch controls");
  assert.equal(documentObject.intensity.value, intensityBeforePanic);
  applyBrowserMidiMessage({
    ...common,
    message: { type: "programChange", program: 2 },
  });
  assert.equal(documentObject.preset.value, "c");

  applyBrowserMidiMessage({ ...common, message: { type: "start" } });
  assert.equal(documentObject.play.getAttribute("aria-pressed"), "true");
  applyBrowserMidiMessage({ ...common, message: { type: "stop" } });
  assert.equal(documentObject.play.getAttribute("aria-pressed"), "false");

  const pulseMs = 60_000 / (120 * 24);
  const clockTracker = new MidiClockTempoTracker();
  const tempoDispatchState = {};
  let mapped = false;
  for (let pulse = 0; pulse < 32; pulse += 1) {
    mapped = applyBrowserMidiMessage({
      ...common,
      clockTracker,
      tempoDispatchState,
      message: { type: "timingClock", timestamp: pulse * pulseMs },
    }) || mapped;
  }
  assert.equal(mapped, true);
  assert.ok(Math.abs(Number(documentObject.tempo.value) - 120) < 0.01);
  assert.deepEqual(
    documentObject.tempo.events,
    ["input", "change"],
    "stable 24-PPQN clock does not emit redundant page updates",
  );
});

test("MIDI Start and Stop find a page transport through the shared primary marker", () => {
  const play = toggle("playgroundPlayButton");
  const audio = toggle("audioButton");
  const documentObject = {
    querySelector(selector) {
      if (selector === "[data-primary-transport]") return play;
      if (selector === "#audioButton") return audio;
      return null;
    },
    querySelectorAll() { return []; },
  };
  const common = {
    documentObject,
    runtime: testRuntime(),
    routeId: "shader-synth-playground",
    support: instrumentMidiCapabilityForId("shader-synth-playground"),
  };

  assert.equal(applyBrowserMidiMessage({ ...common, message: { type: "start" } }), true);
  assert.equal(audio.getAttribute("aria-pressed"), "true");
  assert.equal(play.getAttribute("aria-pressed"), "true");
  assert.equal(applyBrowserMidiMessage({ ...common, message: { type: "stop" } }), true);
  assert.equal(play.getAttribute("aria-pressed"), "false");
});

test("note fallbacks sound sequence steps and drum one-shots without mutating patches", () => {
  const sequenceDocument = testDocument();
  const sequenceRuntime = testRuntime();
  const step = toggle("stepButton");
  const randomize = toggle("randomizePatch");
  sequenceDocument.bySelector.set("#stepButton", step);
  sequenceDocument.bySelector.set("button[id*='randomize' i]", randomize);
  applyBrowserMidiMessage({
    documentObject: sequenceDocument,
    runtime: sequenceRuntime,
    routeId: "morphazoidical",
    support: instrumentMidiCapabilityForId("morphazoidical"),
    message: { type: "noteOn", note: 72, velocity: 100 },
  });
  assert.equal(step.clicks, 1, "a paused sequence advances its explicit step action");
  assert.equal(sequenceDocument.play.clicks, 0, "Step takes precedence over starting the transport");
  assert.equal(randomize.clicks, 0, "notes never use randomize as a generic trigger");

  const unsafeDocument = testDocument();
  const unsafePrimaryAction = toggle("primaryAction");
  unsafeDocument.bySelector.set("#primaryAction", unsafePrimaryAction);
  applyBrowserMidiMessage({
    documentObject: unsafeDocument,
    runtime: testRuntime(),
    routeId: "kinetic-hull",
    support: instrumentMidiCapabilityForId("kinetic-hull"),
    message: { type: "noteOn", note: 72, velocity: 100 },
  });
  assert.equal(unsafePrimaryAction.clicks, 0, "an unmarked primary action can be a reseed/reset and is never fired");
  assert.equal(unsafeDocument.play.clicks, 1, "safe transport play replaces an ambiguous primary action");

  const drumDocument = testDocument();
  const strike = toggle("kickStrike");
  const reseed = toggle("reseedKit");
  drumDocument.bySelector.set("button[id*='strike' i]", strike);
  drumDocument.bySelector.set("button[id*='reseed' i]", reseed);
  applyBrowserMidiMessage({
    documentObject: drumDocument,
    runtime: testRuntime(),
    routeId: "shape-drums",
    support: instrumentMidiCapabilityForId("shape-drums"),
    message: { type: "noteOn", note: 40, velocity: 110 },
  });
  assert.equal(strike.clicks, 1, "a drum note fires an explicit one-shot when no pad grid is found");
  assert.equal(reseed.clicks, 0, "drum notes never reseed the instrument");
  assert.equal(drumDocument.play.clicks, 0, "the one-shot takes precedence over transport play");
});

test("drum note fallback maps the full 16-note pad range without starting transport", () => {
  const documentObject = testDocument();
  const pads = Array.from({ length: 16 }, (_, index) => {
    const pad = toggle(`voice-${index}`);
    pad.dataset.voiceIndex = String(index);
    pad.closest = () => null;
    return pad;
  });
  const originalQuerySelectorAll = documentObject.querySelectorAll.bind(documentObject);
  documentObject.querySelectorAll = (selector) => (
    selector.includes("button[data-voice-index]") ? pads : originalQuerySelectorAll(selector)
  );
  const common = {
    documentObject,
    runtime: testRuntime(),
    routeId: "shape-drums",
    support: instrumentMidiCapabilityForId("shape-drums"),
  };

  assert.equal(applyBrowserMidiMessage({
    ...common,
    message: { type: "noteOn", note: 36, velocity: 100 },
  }), true);
  assert.equal(applyBrowserMidiMessage({
    ...common,
    message: { type: "noteOn", note: 51, velocity: 100 },
  }), true);
  assert.equal(pads[0].clicks, 1);
  assert.equal(pads[15].clicks, 1);
  assert.equal(pads.slice(1, 15).every(({ clicks }) => clicks === 0), true);
  assert.equal(documentObject.play.clicks, 0);
});

test("adapter survives a BFCache pagehide and disposes exactly once on a real unload", () => {
  const registrations = [];
  const listeners = new Map();
  const manager = {
    registerClient(client) {
      registrations.push(client);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        registrations.push("unregistered");
      };
    },
  };
  const documentObject = { querySelector() { return null; } };
  const runtime = {
    document: documentObject,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };

  const adapter = installBrowserMidiAdapter(runtime, documentObject, {
    routeId: "cascading-fm",
    manager,
  });
  assert.ok(adapter);
  assert.equal(registrations.length, 1);
  listeners.get("pagehide")({ persisted: true });
  assert.equal(registrations.length, 1, "BFCache navigation retains the registered page client");
  assert.equal(installBrowserMidiAdapter(runtime, documentObject, {
    routeId: "cascading-fm",
    manager,
  }), adapter, "a restored page reuses its existing client");

  listeners.get("pagehide")({ persisted: false });
  assert.equal(registrations.filter((entry) => entry === "unregistered").length, 1);
  assert.equal(listeners.has("pagehide"), false);
  adapter.dispose();
  assert.equal(
    registrations.filter((entry) => entry === "unregistered").length,
    1,
    "manual cleanup remains idempotent after pagehide",
  );

  const replacement = installBrowserMidiAdapter(runtime, documentObject, {
    routeId: "cascading-fm",
    manager,
  });
  assert.ok(replacement);
  assert.notEqual(replacement, adapter);
  assert.equal(registrations.filter((entry) => entry !== "unregistered").length, 2);
  replacement.dispose();
});

test("page-native consumers can cancel the public event before a generic fallback runs", () => {
  const documentObject = testDocument();
  const runtime = testRuntime();
  runtime.dispatchEvent = (event) => {
    runtime.midiEvents.push(event);
    event.preventDefault();
    return false;
  };
  const original = documentObject.frequency.value;
  assert.equal(applyBrowserMidiMessage({
    documentObject,
    runtime,
    routeId: "cascading-fm",
    support: instrumentMidiCapabilityForId("cascading-fm"),
    message: { type: "noteOn", note: 81, velocity: 100 },
  }), true);
  assert.equal(documentObject.frequency.value, original);
  assert.equal(documentObject.audio.clicks, 0);
});

test("note and bend helpers remain identical to the WAX mapping contract", () => {
  assert.equal(browserMidiNoteValue({ min: "24", max: "84", id: "rootNote" }, 60), 60);
  assert.equal(Math.round(browserMidiNoteValue({ min: "20", max: "2000", id: "frequency" }, 69)), 440);
  assert.equal(Math.round(browserMidiNoteValue({ min: "30", max: "880", id: "sourceTone" }, 69)), 440);
  assert.ok(
    Math.abs(browserPitchBendValue({ min: "30", max: "880", id: "sourceTone" }, 440, 1) - 493.883) < 0.01,
    "tone controls use the same two-semitone exponential bend as frequency controls",
  );
  assert.equal(browserPitchBendValue({ min: "24", max: "84", id: "rootNote" }, 60, 1), 62);
});

test("the compact graph seed note remains the MIDI pitch target", () => {
  const seedNote = range("seedNote", { min: 0, max: 127, step: 1, value: 57 });
  const documentObject = {
    querySelector(selector) {
      return selector === "#seedNote" ? seedNote : null;
    },
    querySelectorAll() { return [seedNote]; },
  };
  assert.equal(browserMidiPitchControl(documentObject), seedNote);
  assert.equal(browserPitchBendValue(seedNote, 57, 1), 59);
});

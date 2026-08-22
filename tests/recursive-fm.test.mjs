import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_RECURSIVE_FM_PRESET_ID,
  RECURSIVE_FM_LIMITS,
  RECURSIVE_FM_PARAMETER_IDS,
  RECURSIVE_FM_PERFORMANCE_DEFAULTS,
  RECURSIVE_FM_PRESETS,
  RecursiveFmMonophonicState,
  RecursiveFmWebMidi,
  deriveRecursiveFmSafePitchRatio,
  decodeRecursiveFmMidiMessage,
  deriveRecursiveFmStack,
  formatRecursiveFmFrequency,
  logarithmicSliderPosition,
  logarithmicSliderValue,
  quadraticSliderPosition,
  quadraticSliderValue,
  recursiveFmFactoryControlChange,
  recursiveFmPitchRatio,
  sanitizeRecursiveFmPerformance,
  sanitizeRecursiveFmSettings,
  summarizeRecursiveFmStack,
} from "../src/recursive-fm.js";

test("Recursive FM preserves the six legacy Morphisma parameter sets", () => {
  assert.equal(RECURSIVE_FM_PRESETS.length, 6);
  assert.equal(DEFAULT_RECURSIVE_FM_PRESET_ID, "deep-well");
  assert.deepEqual(
    RECURSIVE_FM_PRESETS.map(({ settings }) => settings),
    [
      { depth: 0, carrierHz: 1, offsetHz: 0, modulationHz: 500, divisor: 2 },
      { depth: 3, carrierHz: 3.32, offsetHz: 0, modulationHz: 7_307, divisor: 3.68 },
      { depth: 3, carrierHz: 5.25, offsetHz: 5_057, modulationHz: 6_508, divisor: 5.56 },
      { depth: 3, carrierHz: 0.06, offsetHz: 0, modulationHz: 1_650, divisor: 0.18 },
      { depth: 3, carrierHz: 0.18, offsetHz: 4_000, modulationHz: 4_236, divisor: 1.53 },
      { depth: 3, carrierHz: 7, offsetHz: 2_000, modulationHz: 2_340, divisor: 0.75 },
    ],
  );
  assert.ok(Object.isFrozen(RECURSIVE_FM_PRESETS));
  assert.ok(Object.isFrozen(RECURSIVE_FM_PRESETS[0].settings));
});

test("settings sanitizer accepts legacy names and contains unsafe values", () => {
  const settings = sanitizeRecursiveFmSettings({
    steps: 99,
    carrierFreq: Number.POSITIVE_INFINITY,
    offset: -50,
    modAmp: 99_999,
    modAmpDiv: 0,
  }, { sampleRate: 44_100 });

  assert.equal(settings.depth, RECURSIVE_FM_LIMITS.maxDepth);
  assert.equal(settings.carrierHz, 3.32);
  assert.equal(settings.offsetHz, 0);
  assert.equal(settings.modulationHz, 12_000);
  assert.equal(settings.divisor, RECURSIVE_FM_LIMITS.minDivisor);
  assert.equal(settings.maximumFrequencyHz, 19_845);
});

test("amount divisor retains the original Morphisma exploration range", () => {
  assert.equal(RECURSIVE_FM_LIMITS.minDivisor, 0.001);
});

test("Recursive FM expressive controls have stable IDs and bounded defaults", () => {
  assert.deepEqual(RECURSIVE_FM_PERFORMANCE_DEFAULTS, {
    playMode: "midi",
    rootMidiNote: 60,
    pitchBendRangeSemitones: 2,
    ampAttackMs: 8,
    ampDecayMs: 120,
    ampSustainLevel: 0.72,
    ampReleaseMs: 180,
    glideTimeMs: 0,
    glideMode: "off",
  });
  assert.equal(RECURSIVE_FM_PARAMETER_IDS.modulationHz, "synthesis.modulationHz");
  assert.equal(RECURSIVE_FM_PARAMETER_IDS.glideMode, "performance.glideMode");
  assert.equal(RECURSIVE_FM_PARAMETER_IDS.output, "output.level");
  assert.ok(Object.isFrozen(RECURSIVE_FM_PARAMETER_IDS));

  const safe = sanitizeRecursiveFmPerformance({
    playMode: "unknown",
    rootMidiNote: 999,
    pitchBendRangeSemitones: -2,
    ampAttackMs: 99_000,
    ampDecayMs: -1,
    ampSustainLevel: 3,
    ampReleaseMs: 0,
    glideTimeMs: 99_000,
    glideMode: "mystery",
  });
  assert.deepEqual(safe, {
    playMode: "midi",
    rootMidiNote: 127,
    pitchBendRangeSemitones: 0,
    ampAttackMs: 5_000,
    ampDecayMs: 0,
    ampSustainLevel: 1,
    ampReleaseMs: 2,
    glideTimeMs: 2_000,
    glideMode: "off",
  });
  assert.ok(Object.isFrozen(safe));
});

test("MIDI decoder and standardized CC map preserve the full performance contract", () => {
  assert.deepEqual(decodeRecursiveFmMidiMessage([0x92, 64, 99]), {
    type: "noteOn", note: 64, velocity: 99, channel: 2,
  });
  assert.deepEqual(decodeRecursiveFmMidiMessage([0x92, 64, 0]), {
    type: "noteOff", note: 64, velocity: 0, channel: 2,
  });
  assert.equal(decodeRecursiveFmMidiMessage([0xe0, 0, 0]).normalized, -1);
  assert.equal(decodeRecursiveFmMidiMessage([0xe0, 0, 64]).normalized, 0);
  assert.equal(decodeRecursiveFmMidiMessage([0xe0, 127, 127]).normalized, 1);
  assert.deepEqual(decodeRecursiveFmMidiMessage([0xb7, 64, 127]), {
    type: "controlChange", controller: 64, value: 127, channel: 7,
  });
  assert.equal(decodeRecursiveFmMidiMessage([0xf0, 1, 2]), null);

  assert.equal(recursiveFmFactoryControlChange(5, 0).value, 0);
  assert.equal(recursiveFmFactoryControlChange(5, 1).value, 10);
  assert.ok(Math.abs(recursiveFmFactoryControlChange(5, 127).value - 2_000) < 1e-9);
  assert.equal(recursiveFmFactoryControlChange(73, 0).value, 0);
  assert.equal(recursiveFmFactoryControlChange(73, 1).value, 0.5);
  assert.ok(Math.abs(recursiveFmFactoryControlChange(73, 127).value - 5_000) < 1e-9);
  assert.equal(recursiveFmFactoryControlChange(75, 1).value, 1);
  assert.equal(recursiveFmFactoryControlChange(72, 0).value, 2);
  assert.ok(Math.abs(recursiveFmFactoryControlChange(72, 127).value - 10_000) < 1e-9);
  assert.deepEqual(recursiveFmFactoryControlChange(11, 127), {
    type: "expression", value: 1,
  });
  assert.deepEqual(recursiveFmFactoryControlChange(64, 64), {
    type: "sustain", down: true,
  });
  assert.deepEqual(recursiveFmFactoryControlChange(65, 127), {
    type: "glideEnabled", enabled: true,
  });
  assert.deepEqual(recursiveFmFactoryControlChange(120, 0), {
    type: "allSoundOff",
  });
  assert.deepEqual(recursiveFmFactoryControlChange(121, 0), {
    type: "resetControllers",
  });
  assert.deepEqual(recursiveFmFactoryControlChange(123, 0), {
    type: "allNotesOff",
  });
  assert.equal(recursiveFmFactoryControlChange(12, 99), null);
});

test("Web MIDI is inert until enabled, declines SysEx, dispatches, and detaches", async () => {
  const listeners = new Map();
  const input = {
    state: "connected",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const accessListeners = new Map();
  const access = {
    inputs: new Map([["keyboard", input]]),
    addEventListener(type, listener) { accessListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (accessListeners.get(type) === listener) accessListeners.delete(type);
    },
  };
  const requests = [];
  const calls = [];
  const actions = [];
  const adapter = new RecursiveFmWebMidi({
    navigator: {
      async requestMIDIAccess(options) {
        requests.push(options);
        return access;
      },
    },
  }, {
    target: {
      noteOn: (...args) => calls.push(["noteOn", ...args]),
      controlChange: (...args) => calls.push(["controlChange", ...args]),
    },
    onAction: (action) => actions.push(action),
  });

  assert.equal(adapter.supported, true);
  assert.equal(requests.length, 0, "construction must not prompt for MIDI");
  await adapter.enable();
  assert.deepEqual(requests, [{ sysex: false }]);
  assert.equal(adapter.status().inputCount, 1);
  listeners.get("midimessage")({ data: new Uint8Array([0x90, 60, 100]) });
  listeners.get("midimessage")({ data: new Uint8Array([0xb0, 11, 64]) });
  assert.deepEqual(calls, [
    ["noteOn", 60, 100, 0],
    ["controlChange", 11, 64],
  ]);
  input.state = "disconnected";
  adapter.refreshInputs();
  assert.deepEqual(calls.at(-1), ["controlChange", 120, 0]);
  assert.deepEqual(actions.at(-1), {
    type: "controlChange",
    controller: 120,
    value: 0,
    channel: 0,
    synthetic: true,
    reason: "input-disconnected",
  });
  assert.equal(adapter.status().inputCount, 0);
  adapter.close();
  assert.equal(listeners.has("midimessage"), false);
  assert.equal(accessListeners.has("statechange"), false);
});

test("closing while Web MIDI permission is pending cannot re-enable the adapter", async () => {
  let resolveAccess;
  const permission = new Promise((resolve) => { resolveAccess = resolve; });
  const accessListeners = new Map();
  const access = {
    inputs: new Map(),
    addEventListener(type, listener) { accessListeners.set(type, listener); },
    removeEventListener(type) { accessListeners.delete(type); },
  };
  const adapter = new RecursiveFmWebMidi({
    navigator: {
      requestMIDIAccess() { return permission; },
    },
  });

  const enabling = adapter.enable();
  adapter.close();
  resolveAccess(access);
  assert.equal(await enabling, null);
  assert.deepEqual(adapter.status(), {
    supported: true,
    enabled: false,
    inputCount: 0,
  });
  assert.equal(accessListeners.has("statechange"), false);
});

test("monophonic state uses last-note priority and defers release under sustain", () => {
  const voice = new RecursiveFmMonophonicState();
  assert.deepEqual(voice.noteOn(60, 127), {
    type: "select",
    note: 60,
    velocity: 1,
    legatoEligible: false,
    retrigger: true,
  });
  assert.deepEqual(voice.noteOn(67, 64), {
    type: "select",
    note: 67,
    velocity: 64 / 127,
    legatoEligible: true,
    retrigger: false,
  });
  assert.equal(voice.selectedNote, 67);
  assert.equal(voice.setSustain(true), null);
  assert.deepEqual(voice.noteOff(67), {
    type: "select",
    note: 60,
    velocity: 1,
    legatoEligible: true,
    retrigger: false,
  });
  assert.equal(voice.noteOff(60), null, "pedal must defer the final release");
  assert.equal(voice.selectedNote, 60);
  assert.deepEqual(voice.setSustain(false), { type: "release", hard: false });
  assert.equal(voice.selectedNote, -1);
  assert.deepEqual(voice.noteOn(72, 0), null, "velocity zero is note-off");
  assert.deepEqual(voice.allNotesOff({ hard: true }), {
    type: "release", hard: true,
  });
});

test("monophonic state owns repeated same-pitch note-ons independently", () => {
  const voice = new RecursiveFmMonophonicState();
  voice.noteOn(60, 40, 2);
  voice.noteOn(60, 100, 2);
  assert.equal(voice.noteHeld[60], 2);
  assert.equal(
    voice.noteOff(60, 2),
    null,
    "the first matching note-off releases only the older event",
  );
  assert.equal(voice.noteHeld[60], 1);
  assert.equal(voice.selectedNote, 60);
  assert.deepEqual(voice.noteOff(60, 2), {
    type: "release",
    hard: false,
  });
  assert.equal(voice.noteHeld[60], 0);
  assert.equal(voice.selectedNote, -1);

  voice.noteOn(67, 80, 1);
  voice.noteOn(67, 90, 3);
  assert.equal(voice.noteOff(67, 4), null, "another channel owns neither event");
  assert.equal(voice.noteHeld[67], 2);
  assert.equal(voice.noteOff(67, 1), null, "channel 3's event remains sounding");
  assert.equal(voice.noteHeld[67], 1);
  assert.equal(voice.selectedNote, 67);
  assert.deepEqual(voice.noteOff(67, 3), {
    type: "release",
    hard: false,
  });

  voice.noteOn(60, 70, "web-midi:hardware\u00000");
  voice.noteOn(64, 90, "web-midi:hardware\u00000");
  voice.noteOn(60, 110, "computer-keyboard\u00000");
  assert.equal(voice.noteHeld[60], 2);
  assert.deepEqual(voice.noteOff(60, "computer-keyboard\u00000"), {
    type: "select",
    note: 64,
    velocity: 90 / 127,
    legatoEligible: true,
    retrigger: false,
  });
  assert.equal(voice.noteHeld[60], 1, "hardware still owns its C4");
  assert.deepEqual(voice.noteOff(64, "web-midi:hardware\u00000"), {
    type: "select",
    note: 60,
    velocity: 70 / 127,
    legatoEligible: true,
    retrigger: false,
  });
  assert.deepEqual(voice.noteOff(60, "web-midi:hardware\u00000"), {
    type: "release",
    hard: false,
  });
});

test("pitch ratio transposes the complete operator graph from a stable root", () => {
  assert.equal(recursiveFmPitchRatio(60, 60, 0, 2), 1);
  assert.equal(recursiveFmPitchRatio(72, 60, 0, 2), 2);
  assert.equal(recursiveFmPitchRatio(48, 60, 0, 2), 0.5);
  assert.ok(Math.abs(recursiveFmPitchRatio(60, 60, 1, 2) - (2 ** (2 / 12))) < 1e-12);
  assert.ok(Math.abs(recursiveFmPitchRatio(60, 60, -1, 2) - (2 ** (-2 / 12))) < 1e-12);
});

test("one full-excursion-safe pitch ratio preserves every operator's FM proportion", () => {
  const stack = deriveRecursiveFmStack({
    depth: 3,
    carrierHz: 5.25,
    offsetHz: 5_057,
    modulationHz: 6_508,
    divisor: 5.56,
  });
  const requestedRatio = 4;
  const safeRatio = deriveRecursiveFmSafePitchRatio(stack, requestedRatio);
  assert.ok(safeRatio > 1 && safeRatio < requestedRatio);
  for (const operator of stack.operators) {
    const scaledBias = operator.biasHz * safeRatio;
    const scaledModulation = operator.modulationHz * safeRatio;
    assert.ok(
      Math.abs(scaledBias) + Math.abs(scaledModulation)
        <= stack.settings.maximumFrequencyHz + 1e-9,
      `operator ${operator.index} must stay below the instantaneous ceiling`,
    );
    if (operator.biasHz > 0) {
      assert.ok(Math.abs(scaledBias / operator.biasHz - safeRatio) < 1e-12);
    }
    if (operator.modulationHz > 0) {
      assert.ok(
        Math.abs(scaledModulation / operator.modulationHz - safeRatio) < 1e-12,
      );
    }
  }
  const peakExcursion = Math.max(...stack.operators.map(
    (operator) => Math.abs(operator.biasHz) + Math.abs(operator.modulationHz),
  ));
  assert.ok(Math.abs(
    peakExcursion * safeRatio - stack.settings.maximumFrequencyHz
  ) < 1e-9);
});

test("operator derivation matches the original safe Recursive FM topology", () => {
  const stack = deriveRecursiveFmStack({
    depth: 3,
    carrierHz: 3.32,
    offsetHz: 0,
    modulationHz: 7_307,
    divisor: 3.68,
  });

  assert.equal(stack.operators.length, 5);
  assert.equal(stack.audibleIndex, 4);
  assert.deepEqual(
    stack.operators.map(({ sourceIndex }) => sourceIndex),
    [null, 0, 1, 2, 3],
  );
  assert.equal(stack.operators[0].biasHz, 3.32);
  assert.equal(stack.operators[1].biasHz, 3_653.5);
  assert.equal(stack.operators[1].modulationHz, 3_653.5);
  assert.equal(stack.operators[2].modulationHz, 3_653.5);
  assert.ok(Math.abs(stack.operators[3].modulationHz - (3_653.5 / 3.68)) < 1e-10);
  assert.ok(stack.normalizedGain >= 0.2 && stack.normalizedGain <= 0.38);
});

test("expanding recursion is capped at a sample-rate-safe ceiling", () => {
  const stack = deriveRecursiveFmStack({
    depth: 10,
    carrierHz: 0.06,
    offsetHz: 0,
    modulationHz: 12_000,
    divisor: 0.05,
  }, { sampleRate: 32_000 });

  assert.equal(stack.settings.maximumFrequencyHz, 14_400);
  for (const operator of stack.operators) {
    assert.ok(operator.modulationHz <= 14_400);
    assert.ok(Number.isFinite(operator.modulationHz));
  }
  assert.equal(stack.operators.length, 12);
  assert.equal(summarizeRecursiveFmStack(stack).label, "10 recursions · 12 operators");
});

test("frequency slider mappings are stable at their bounds and round trip", () => {
  for (const value of [0.01, 0.06, 3.32, 440, 4_800]) {
    const position = logarithmicSliderPosition(value);
    assert.ok(Math.abs(logarithmicSliderValue(position) - value) < 1e-8);
  }
  for (const value of [0, 500, 5_057, 7_307, 12_000]) {
    const position = quadraticSliderPosition(value);
    assert.ok(Math.abs(quadraticSliderValue(position) - value) < 1e-8);
  }
});

test("frequency readouts stay compact", () => {
  assert.equal(formatRecursiveFmFrequency(0.06), "0.06 Hz");
  assert.equal(formatRecursiveFmFrequency(3.32), "3.32 Hz");
  assert.equal(formatRecursiveFmFrequency(440), "440 Hz");
  assert.equal(formatRecursiveFmFrequency(5_057), "5.06 kHz");
  assert.equal(formatRecursiveFmFrequency(12_000), "12 kHz");
});

test("Recursive FM page is internal and uses a gesture-controlled audio button", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("../recursive-fm.html", import.meta.url), "utf8"),
    readFile(new URL("../recursive-fm-app.js", import.meta.url), "utf8"),
    readFile(new URL("../recursive-fm.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="audioButton"/);
  assert.match(html, /id="level"/);
  assert.match(html, /id="stage"/);
  assert.match(html, /aria-label="Recursive FM graphic pane"/);
  assert.doesNotMatch(html, /recursive-fm-heading|recursiveFmTitle/);
  assert.match(html, /id="midiEnvelopeControls" hidden/);
  assert.match(html, /href="chaotic-synth-ui\.css"/);
  assert.match(html, /class="recursive-fm-signal-graph"/);
  assert.match(html, /id="recursiveFmFlow"/);
  assert.doesNotMatch(html, /id="midiButton"|id="midiState"|id="midiError"/);
  assert.doesNotMatch(html, /id="playModeDrone"|id="playModeMidi"/);
  assert.match(html, /id="midiActivity"/);
  for (const id of [
    "ampAttackMs",
    "ampDecayMs",
    "ampSustainLevel",
    "ampReleaseMs",
    "glideTimeMs",
    "glideMode",
    "rootMidiNote",
    "pitchBendRangeSemitones",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Standard performance MIDI · CC5 glide · CC11 expression/);
  assert.match(html, /Controller Macros 1–8 · carrier · offset · modulation · divisor · attack · release · glide · output/);
  assert.match(html, /CC120\/121\/123 panic and reset/);
  assert.match(html, /carrier modulates the entry oscillator frequency/i);
  assert.doesNotMatch(html, /SPECTROGRAM · LOG FREQUENCY|signal → frequency → signal/);
  assert.doesNotMatch(html, /flowCarrierValue|flowEntryValue|flowRecursionValue|flowOutputValue/);
  assert.match(app, /function updateSignalFlow\(stack\)/);
  assert.match(
    app,
    /midiEnvelopeControls"\)\.hidden = state\.performance\.playMode !== "midi"/,
  );
  assert.match(app, /recursive-fm-modulator/);
  assert.match(app, /recursive-fm-bias/);
  assert.match(app, /recursive-fm-input-junction/);
  assert.match(app, /recursive-fm-tap-switch/);
  assert.match(app, /recursive-fm-flow-detailed/);
  assert.match(app, /recursive-fm-flow-compact/);
  assert.match(app, /SIGNED SINE × AMOUNT \+ BIAS/);
  assert.match(app, /operator\.modulationHz/);
  assert.match(app, /operators\[0\]\.biasHz < 20/);
  assert.match(app, /updateSignalFlow\(stack\)/);
  assert.match(html, /id="turnsReadout"/);
  assert.doesNotMatch(html, />Turn \d+</);
  assert.match(html, /src="recursive-fm-app\.js"/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(app, /class RecursiveFmAudioEngine/);
  assert.match(app, /new RecursiveFmWebMidi/);
  assert.match(app, /new RecursiveFmMonophonicState/);
  assert.match(app, /getSharedMidiManager\(globalThis\)/);
  assert.match(app, /sharedMidiManager\.registerClient/);
  assert.match(app, /id: "recursive-fm"/);
  assert.match(app, /onMessage: handleSharedMidiMessage/);
  assert.match(app, /onEnabledChange: handleSharedMidiEnabled/);
  assert.match(app, /onPrepareEnable: prepareSharedMidiEnable/);
  assert.match(app, /onProfileChange: handleSharedMidiProfileChange/);
  assert.match(app, /midiBridge\.handleMessage/);
  assert.doesNotMatch(app, /midiBridge\.enable\(/);
  assert.match(app, /applyLogicalMidiMacro\(message\.logical\)/);
  assert.match(app, /engine\.allSoundOff\(\);[\s\S]{0,180}playMode: "drone"/);
  assert.match(app, /playMode: "drone"/);
  assert.match(app, /operator\.biasHz \* pitchRatio/);
  assert.match(app, /operator\.modulationHz \* pitchRatio/);
  assert.match(app, /deriveRecursiveFmSafePitchRatio\([\s\S]+maximumStack/);
  assert.doesNotMatch(
    app,
    /Math\.min\([\s\S]{0,80}operator\.(?:biasHz|modulationHz) \* (?:pitchRatio|safeRatio)/,
  );
  assert.match(app, /normalizationGain\.connect\(envelopeGain\)/);
  assert.match(app, /envelopeGain\.connect\(expressionGain\)/);
  assert.match(app, /beginEnvelope\(\)/);
  assert.match(app, /releaseEnvelope\(/);
  assert.match(app, /drawChaoticLiveAnalysis/);
  assert.match(app, /createChaoticSpectrum/);
  assert.match(app, /this\.waveform = new Uint8Array\(512\)/);
  assert.match(app, /spectrumBarFill: "rgba\(181, 156, 255, 0\.28\)"/);
  assert.match(app, /spectrumBarCap: "rgba\(125, 180, 255, 0\.72\)"/);
  assert.match(app, /scopeStroke: "#fff3d6"/);
  assert.doesNotMatch(app, /drawChaoticAnalysis|createChaoticSpectrogram/);
  assert.match(html, /non-scrolling, logarithmic frequency spectrum bars/i);
  assert.doesNotMatch(html, /rolling spectrogram/i);
  assert.match(app, /class="recursive-fm-flow-compact"/);
  assert.match(app, /SIGNED SINE × AMOUNT \+ BIAS → NEXT OSCILLATOR FREQUENCY/);
  assert.match(app, /const performanceActive = engine\.running/);
  assert.match(
    app,
    /state\.midiSelectedNote = performanceActive \? engine\.selectedMidiNote : -1/,
  );
  assert.doesNotMatch(app, /midiHeldNotes/);
  assert.match(app, /clearMidiMonitorState\(/);
  assert.match(app, /MIDI disconnected · all sound off/);
  assert.match(app, /setValueCurveAtTime/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /\$\("audioButton"\)\.addEventListener\("click"/);
  assert.match(app, /pagehide/);
  assert.match(app, /unregisterMidiClient\?\.\(\)/);
  assert.match(app, /pageshow/);
  assert.match(app, /registerSharedMidiClient\(\)/);
  assert.doesNotMatch(app, /midi\.close\(\)/);
  assert.doesNotMatch(css, /\.recursive-fm-mode-switch|\.recursive-fm-midi-connect/);
  assert.match(css, /\.recursive-fm-midi-monitor/);
  assert.match(css, /\.recursive-fm-adsr-preview/);
  assert.match(css, /\.recursive-fm-flow-compact/);
  assert.match(css, /\.recursive-fm-flow-detailed/);
  assert.match(css, /grid-template-rows: clamp\(360px, 50dvh, 460px\)/);
  assert.match(css, /height: clamp\(0px, calc\(100% - 274px\), 132px\)/);
  assert.match(css, /\.recursive-fm-stage \.stage-meta \{[\s\S]+display: none/);
  assert.doesNotMatch(css, /spectrogram/i);
});

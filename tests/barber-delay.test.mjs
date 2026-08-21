import assert from "node:assert/strict";
import test from "node:test";

import {
  BARBER_DELAY_DEFAULTS,
  BARBER_DELAY_LIMITS,
  BARBER_DELAY_PRESETS,
  BARBER_DELAY_PROCESSOR_NAME,
  BarberDelayAudio,
  barberDelayCurve,
  barberDelayPitchEstimate,
  barberDelaySliderPosition,
  barberDelaySliderValue,
  barberDelayWindow,
  createBarberSoftCeilingCurve,
  createBarberTransparentCeilingCurve,
  createCandyTransparentCeilingCurve,
  sanitizeBarberDelayMode,
  sanitizeBarberDelayParams,
} from "../src/barber-delay.js";

test("barber controls retain Morphisma's low-range power curves", () => {
  assert.equal(barberDelaySliderValue(0, 0, 5, 2), 0);
  assert.equal(barberDelaySliderValue(1, 0, 5, 2), 5);
  assert.equal(barberDelaySliderValue(0.25, 0, 5, 2), 0.3125);
  assert.ok(
    Math.abs(barberDelaySliderValue(0.5, 0.1, 10, 3) - 1.3375) < 1e-12,
  );
  assert.equal(
    barberDelaySliderValue(0.5, 0.1, 10, 3, 0.001),
    1.338,
  );

  const candyRangePosition = barberDelaySliderPosition(1, 0.1, 10, 3);
  assert.ok(Math.abs(candyRangePosition - 0.449644313) < 1e-8);
  assert.equal(
    barberDelaySliderValue(candyRangePosition, 0.1, 10, 3, 0.001),
    1,
  );

  for (const [mode, bank] of Object.entries(BARBER_DELAY_PRESETS)) {
    for (const preset of bank) {
      const controls = [
        [preset.settings.speed, 0, 5, 2, 0.001],
        [preset.settings.fbDelay, mode === "sandy" ? 0.1 : 0.001, mode === "sandy" ? 15 : 8, 2, mode === "sandy" ? 0.01 : 0.001],
      ];
      if (mode === "sandy") {
        controls.push([preset.settings.grainSize, 0.005, 0.5, 2, 0.001]);
      } else {
        controls.push([preset.settings.range, 0.1, 10, 3, 0.001]);
      }
      for (const [value, minimum, maximum, curve, step] of controls) {
        const position = barberDelaySliderPosition(
          value,
          minimum,
          maximum,
          curve,
        );
        const roundTrip = barberDelaySliderValue(
          position,
          minimum,
          maximum,
          curve,
          step,
        );
        assert.ok(Math.abs(roundTrip - value) <= step / 2 + 1e-12);
      }
    }
  }
});

test("barber-delay parameters are finite, bounded, and share a feedback budget", () => {
  const safe = sanitizeBarberDelayParams({
    numVoices: 99,
    speed: -8,
    range: 50,
    directionUp: false,
    tilt: 3,
    feedback: 0.95,
    fbDelay: 0,
    globalFeedback: 0.5,
    dryWet: -1,
    inputGain: 8,
    outputLevel: Number.NaN,
  }, "candy");

  assert.equal(safe.numVoices, BARBER_DELAY_LIMITS.maximumVoices);
  assert.equal(safe.speed, 0);
  assert.equal(safe.range, BARBER_DELAY_LIMITS.maximumRange);
  assert.equal(safe.directionUp, false);
  assert.equal(safe.tilt, 1);
  assert.ok(Math.abs(
    safe.feedback + safe.globalFeedback
    - BARBER_DELAY_LIMITS.maximumFeedback
  ) < 1e-12);
  assert.equal(safe.fbDelay, BARBER_DELAY_LIMITS.minimumFeedbackDelay);
  assert.equal(safe.dryWet, 0);
  assert.equal(safe.inputGain, BARBER_DELAY_LIMITS.maximumInputGain);
  assert.equal(safe.outputLevel, BARBER_DELAY_DEFAULTS.candy.outputLevel);
  assert.ok(Object.isFrozen(safe));
  assert.equal(sanitizeBarberDelayMode("unknown"), "candy");
  assert.equal(sanitizeBarberDelayMode("sandy"), "sandy");
});

test("all 24 consolidated delay presets are retained and immutable", () => {
  assert.equal(BARBER_DELAY_PRESETS.candy.length, 12);
  assert.equal(BARBER_DELAY_PRESETS.sandy.length, 12);
  assert.deepEqual(Object.keys(BARBER_DELAY_PRESETS), ["candy", "sandy"]);
  assert.equal(
    new Set(BARBER_DELAY_PRESETS.candy.map(({ id }) => id)).size,
    12,
  );
  const candyDualGrind = BARBER_DELAY_PRESETS.candy.find(
    ({ id }) => id === "dual-grind",
  );
  const centeredFall = BARBER_DELAY_PRESETS.candy.find(
    ({ id }) => id === "centered-fall",
  );
  assert.equal(candyDualGrind.settings.speed, 1.3);
  assert.equal(candyDualGrind.settings.range, 0.1);
  assert.equal(candyDualGrind.settings.feedback, 0.95);
  assert.equal(centeredFall.settings.directionUp, false);
  assert.ok(Object.isFrozen(BARBER_DELAY_PRESETS));
  assert.ok(Object.isFrozen(candyDualGrind.settings));
});

test("Candy retains the centered-hump delay-head curve", () => {
  assert.equal(barberDelayCurve("candy", 0, true), 0);
  assert.equal(barberDelayCurve("candy", 0.5, true), 1);
  assert.ok(Math.abs(barberDelayCurve("candy", 0.25, true) - 0.5) < 1e-12);
  assert.ok(Math.abs(barberDelayCurve("candy", 0.25, false) - 0.5) < 1e-12);
  assert.equal(barberDelayCurve("candy", 0, false), 1);
});

test("skewed Hann windows remain bounded and move their peak with tilt", () => {
  assert.equal(barberDelayWindow(0, 0), 0);
  assert.equal(barberDelayWindow(0.5, 0), 1);
  assert.ok(Math.abs(barberDelayWindow(0.25, 0) - 0.5) < 1e-12);
  assert.ok(barberDelayWindow(0.8409, 1) > 0.999);
  assert.ok(barberDelayWindow(0.0625, -1) > 0.999999);
  for (let index = 0; index <= 1_000; index += 1) {
    const value = barberDelayWindow(index / 1_000, 0.73);
    assert.ok(value >= 0 && value <= 1);
  }
});

test("Candy pitch estimates preserve the centered sweep's symmetric range", () => {
  const rising = barberDelayPitchEstimate({
    speed: 0.5,
    range: 2,
    directionUp: true,
  }, "candy");
  const falling = barberDelayPitchEstimate({
    speed: 0.5,
    range: 2,
    directionUp: false,
  }, "candy");

  assert.equal(rising.symmetric, true);
  assert.ok(Math.abs(rising.product - Math.PI) < 1e-12);
  assert.ok(Math.abs(rising.lowRatio * rising.highRatio - 1) < 1e-12);
  assert.equal(falling.ratio, rising.ratio);
  assert.equal(falling.semitones, rising.semitones);
});

test("barber soft ceiling is symmetric, monotonic, and bounded", () => {
  const curve = createBarberSoftCeilingCurve(257);
  assert.equal(curve.length, 257);
  assert.ok(Math.abs(curve[0] + curve.at(-1)) < 1e-6);
  assert.ok(Math.abs(curve[128]) < 1e-7);
  assert.ok(Math.max(...curve.map(Math.abs)) <= 0.921);
  for (let index = 1; index < curve.length; index += 1) {
    assert.ok(curve[index] >= curve[index - 1]);
  }
});

test("barber ceiling is identity through normal range and shoulders safely", () => {
  const curve = createBarberTransparentCeilingCurve(2_001);
  assert.equal(curve.length, 2_001);
  assert.ok(Math.abs(curve[0] + 0.98) < 1e-6);
  assert.ok(Math.abs(curve[100] + 0.9) < 1e-6);
  assert.equal(curve[1_000], 0);
  assert.ok(Math.abs(curve[1_900] - 0.9) < 1e-6);
  assert.ok(Math.abs(curve.at(-1) - 0.98) < 1e-6);
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index / (curve.length - 1)) * 2 - 1;
    if (Math.abs(input) <= 0.9) {
      assert.ok(Math.abs(curve[index] - input) < 1e-6);
    }
    if (input >= 0) assert.ok(curve[index] <= input + 1e-7);
    if (index > 0) assert.ok(curve[index] >= curve[index - 1]);
  }
  assert.deepEqual(
    createCandyTransparentCeilingCurve(2_001),
    curve,
    "the earlier Candy export remains compatible",
  );
});

test("worklet uses one bounded stereo ring and stays finite at feedback limits", async () => {
  const previousProcessor = globalThis.AudioWorkletProcessor;
  const previousRegister = globalThis.registerProcessor;
  const previousSampleRate = globalThis.sampleRate;
  let Processor = null;
  let registeredName = null;

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  globalThis.AudioWorkletProcessor = MockAudioWorkletProcessor;
  globalThis.registerProcessor = (name, ProcessorConstructor) => {
    registeredName = name;
    Processor = ProcessorConstructor;
  };
  globalThis.sampleRate = 48_000;

  try {
    await import(`../src/barber-delay.js?worklet-test=${Date.now()}`);
    assert.equal(registeredName, BARBER_DELAY_PROCESSOR_NAME);
    assert.equal(typeof Processor, "function");

    const sourceInput = new Float32Array(128);
    for (let index = 0; index < sourceInput.length; index += 1) {
      sourceInput[index] = Math.sin((Math.PI * 2 * index) / 37) * 0.8;
    }
    for (const mode of ["candy", "sandy"]) {
      const linearProcessor = new Processor({
        processorOptions: {
          mode,
          parameters: {
            numVoices: 1,
            speed: 0,
            range: 0.1,
            feedback: 0,
            globalFeedback: 0,
            dryWet: 1,
            inputGain: 1,
            outputLevel: 0.25,
          },
        },
      });
      assert.equal(
        linearProcessor.process(
          [[sourceInput]],
          [[new Float32Array(128), new Float32Array(128)]],
        ),
        true,
      );
      assert.deepEqual(
        linearProcessor.buffers[0].subarray(0, sourceInput.length),
        sourceInput,
        `${mode} must not add saturation before its delay heads`,
      );
    }

    const guardedProcessor = new Processor({
      processorOptions: {
        mode: "candy",
        parameters: {
          numVoices: 1,
          speed: 0,
          range: 0.1,
          feedback: 0,
          globalFeedback: 0,
          dryWet: 1,
          inputGain: 1,
          outputLevel: 0.25,
        },
      },
    });
    assert.equal(
      guardedProcessor.process(
        [[Float32Array.of(100)]],
        [[new Float32Array(1), new Float32Array(1)]],
      ),
      true,
    );
    assert.ok(
      guardedProcessor.buffers[0][0] > 16
      && guardedProcessor.buffers[0][0] <= 64,
      "the extreme-only record guard must bound internal runaway",
    );

    for (const mode of ["candy"]) {
      const latencyProcessor = new Processor({
        processorOptions: {
          mode,
          parameters: {
            numVoices: 1,
            speed: 0,
            range: 0.1,
            feedback: 0.5,
            fbDelay: 0.001,
            globalFeedback: 0,
            dryWet: 1,
            inputGain: 1,
            outputLevel: 0.25,
          },
        },
      });
      const impulse = new Float32Array(128);
      impulse[0] = 1;
      assert.equal(
        latencyProcessor.process(
          [[impulse]],
          [[new Float32Array(128), new Float32Array(128)]],
        ),
        true,
      );
      assert.equal(latencyProcessor.buffers[0][48], 0);
      assert.equal(
        latencyProcessor.process(
          [[new Float32Array(128)]],
          [[new Float32Array(128), new Float32Array(128)]],
        ),
        true,
      );
      assert.ok(
        Math.abs(latencyProcessor.buffers[0][176] - 0.5) < 1e-6,
        `${mode} feedback must retain Morphisma's 128-sample tap latency`,
      );
    }

    const globalLatency = new Processor({
      processorOptions: {
        mode: "candy",
        parameters: {
          numVoices: 1,
          speed: 0,
          range: 0.1,
          directionUp: true,
          tilt: 0,
          feedback: 0,
          globalFeedback: 0.5,
          dryWet: 1,
          inputGain: 1,
          outputLevel: 1,
        },
      },
    });
    globalLatency.buffers[0].fill(1);
    globalLatency.buffers[1].fill(1);
    globalLatency.phase = 0.5;
    assert.equal(
      globalLatency.process(
        [[new Float32Array(128)]],
        [[new Float32Array(128), new Float32Array(128)]],
      ),
      true,
    );
    assert.equal(
      globalLatency.buffers[0][127],
      0,
      "global wet feedback must not recur within the first render quantum",
    );
    globalLatency.process(
      [[new Float32Array(1)]],
      [[new Float32Array(1), new Float32Array(1)]],
    );
    assert.ok(
      Math.abs(globalLatency.buffers[0][128] - 1) < 1e-6,
      "global wet feedback must recur after one 128-sample tap block",
    );

    for (const mode of ["candy"]) {
      const protectedProcessor = new Processor({
        processorOptions: {
          mode,
          parameters: {
            numVoices: 1,
            speed: 0,
            range: 0.1,
            directionUp: true,
            tilt: 0,
            feedback: 0,
            globalFeedback: 0,
            dryWet: 1,
            inputGain: 1,
            outputLevel: 1,
          },
        },
      });
      protectedProcessor.buffers[0].fill(0.75);
      protectedProcessor.buffers[1].fill(0.75);
      protectedProcessor.phase = 0.5;
      protectedProcessor.activeGain = 1;
      protectedProcessor.activeTarget = 1;
      const wet = new Float32Array(1);
      assert.equal(
        protectedProcessor.process(
          [[new Float32Array(1)]],
          [[wet, new Float32Array(1)]],
        ),
        true,
      );
      assert.ok(
        wet[0] > 1.49 && wet[0] < 1.51,
        `${mode} worklet clipped before the protected graph: ${wet[0]}`,
      );
    }

    const feedbackCandy = new Processor({
      processorOptions: {
        mode: "candy",
        parameters: {
          numVoices: 12,
          speed: 5,
          range: 0.1,
          directionUp: true,
          tilt: 1,
          feedback: 0.65,
          fbDelay: 0.001,
          globalFeedback: 0.3,
          dryWet: 1,
          inputGain: 2,
          outputLevel: 1,
        },
      },
    });
    feedbackCandy.port.onmessage({
      data: { type: "active", value: true },
    });
    let candyOscillatorPhase = 0;
    for (let block = 0; block < 240; block += 1) {
      const input = new Float32Array(128);
      for (let index = 0; index < input.length; index += 1) {
        candyOscillatorPhase += (Math.PI * 2 * 997) / 48_000;
        input[index] = Math.sin(candyOscillatorPhase) * 0.5;
      }
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(
        feedbackCandy.process([[input]], [[left, right]]),
        true,
      );
      assert.ok(left.every(Number.isFinite));
      assert.ok(right.every(Number.isFinite));
    }

    const processor = new Processor({
      processorOptions: {
        mode: "candy",
        parameters: {
          numVoices: 12,
          speed: 5,
          range: 0.1,
          feedback: 0.95,
          globalFeedback: 0.5,
          fbDelay: 0.001,
          dryWet: 0.8,
          inputGain: 2,
          outputLevel: 1,
        },
      },
    });
    assert.equal(processor.buffers.length, 2);
    assert.equal(processor.buffers[0].length, processor.buffers[1].length);
    assert.ok(processor.buffers[0].length < 481_000);
    processor.port.onmessage({ data: { type: "active", value: true } });

    let energy = 0;
    let peak = 0;
    let renderedSamples = 0;
    let oscillatorPhase = 0;
    for (let block = 0; block < 240; block += 1) {
      const input = new Float32Array(128);
      for (let index = 0; index < input.length; index += 1) {
        oscillatorPhase += (Math.PI * 2 * 220) / 48_000;
        input[index] = Math.sin(oscillatorPhase) * 0.36;
      }
      const left = new Float32Array(128);
      const right = new Float32Array(128);
      assert.equal(processor.process([[input]], [[left, right]]), true);
      for (let index = 0; index < left.length; index += 1) {
        assert.ok(Number.isFinite(left[index]));
        assert.ok(Number.isFinite(right[index]));
        energy += left[index] * left[index];
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        renderedSamples += 1;
      }
    }
    const rms = Math.sqrt(energy / renderedSamples);
    assert.ok(rms > 0.01, `unexpected delay RMS ${rms}`);
    assert.ok(peak <= 0.981, `unexpected delay peak ${peak}`);

    processor.port.onmessage({
      data: {
        type: "parameters",
        parameters: {
          numVoices: -40,
          speed: Infinity,
          range: Number.NaN,
          feedback: 20,
          globalFeedback: 20,
        },
      },
    });
    const tail = new Float32Array(128);
    assert.equal(processor.process([], [[tail, new Float32Array(128)]]), true);
    assert.ok(tail.every(Number.isFinite));
  } finally {
    if (previousProcessor === undefined) delete globalThis.AudioWorkletProcessor;
    else globalThis.AudioWorkletProcessor = previousProcessor;
    if (previousRegister === undefined) delete globalThis.registerProcessor;
    else globalThis.registerProcessor = previousRegister;
    if (previousSampleRate === undefined) delete globalThis.sampleRate;
    else globalThis.sampleRate = previousSampleRate;
  }
});

test("browser wrapper is gesture-inert and releases a file source completely", async () => {
  let contextCreations = 0;
  let filterCreations = 0;
  let fileNodeDisconnects = 0;
  let microphoneRequests = 0;
  let microphoneNodeDisconnects = 0;
  let microphoneTrackStops = 0;
  const portMessages = [];
  const makeParam = (value = 0) => ({
    value,
    cancelScheduledValues() {},
    setValueAtTime(next) {
      this.value = next;
    },
    linearRampToValueAtTime(next) {
      this.value = next;
    },
  });
  const makeNode = (extra = {}) => ({
    connectedTarget: null,
    connect(target) {
      this.connectedTarget = target;
      return target;
    },
    disconnect() {},
    ...extra,
  });

  class MockAudioWorkletNode {
    constructor() {
      this.connectedTarget = null;
      this.port = {
        postMessage(message) {
          portMessages.push(message);
        },
      };
    }

    connect(target) {
      this.connectedTarget = target;
      return target;
    }

    disconnect() {}
  }

  class MockAudioContext {
    constructor() {
      contextCreations += 1;
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = makeNode();
      this.audioWorklet = { addModule: async () => {} };
    }

    createBiquadFilter() {
      filterCreations += 1;
      return makeNode({ frequency: makeParam(), Q: makeParam(), type: "" });
    }

    createDynamicsCompressor() {
      filterCreations += 1;
      return makeNode({
        threshold: makeParam(),
        knee: makeParam(),
        ratio: makeParam(),
        attack: makeParam(),
        release: makeParam(),
      });
    }

    createWaveShaper() {
      return makeNode({ curve: null, oversample: "none" });
    }

    createGain() {
      return makeNode({ gain: makeParam() });
    }

    createAnalyser() {
      return makeNode({
        fftSize: 0,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(target) {
          target.fill(0.125);
        },
      });
    }

    createMediaElementSource() {
      return makeNode({
        disconnect() {
          fileNodeDisconnects += 1;
        },
      });
    }

    createMediaStreamSource() {
      return makeNode({
        disconnect() {
          microphoneNodeDisconnects += 1;
        },
      });
    }

    async resume() {
      this.state = "running";
    }

    async suspend() {
      this.state = "suspended";
    }

    async close() {
      this.state = "closed";
    }
  }

  const timers = new Map();
  let nextTimer = 1;
  const runtime = {
    AudioContext: MockAudioContext,
    AudioWorkletNode: MockAudioWorkletNode,
    setTimeout(callback) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          microphoneRequests += 1;
          return {
            getTracks() {
              return [{
                stop() {
                  microphoneTrackStops += 1;
                },
              }];
            },
          };
        },
      },
    },
  };
  let plays = 0;
  let pauses = 0;
  const element = {
    async play() {
      plays += 1;
    },
    pause() {
      pauses += 1;
    },
  };

  const audio = new BarberDelayAudio("candy", runtime);
  assert.equal(contextCreations, 0);
  assert.equal(audio.state.initialized, false);
  assert.equal(audio.getTimeDomainData(new Float32Array(8)), false);
  audio.setParameters({ speed: 2.5, feedback: 0.3 });
  assert.equal(contextCreations, 0);

  await audio.start({ kind: "file", element });
  assert.equal(contextCreations, 1);
  assert.equal(filterCreations, 0);
  assert.equal(plays, 1);
  assert.equal(audio.state.enabled, true);
  assert.equal(audio.state.sourceKind, "file");
  assert.equal(audio.node.connectedTarget, audio.ceiling);
  assert.notEqual(audio.node.connectedTarget, audio.highpass);
  assert.equal(audio.ceiling.connectedTarget, audio.master);
  assert.equal(audio.ceiling.oversample, "none");
  assert.deepEqual(
    portMessages.slice(-2).map(({ type }) => type),
    ["reset", "active"],
  );
  const waveform = new Float32Array(8);
  assert.equal(audio.getTimeDomainData(waveform), true);
  assert.ok(waveform.every((sample) => sample === 0.125));

  await audio.stop();
  assert.equal(audio.state.enabled, false);
  assert.equal(pauses, 1);
  assert.equal(fileNodeDisconnects, 1);

  // MediaElementSourceNode may only be created once per element/context.
  // Reuse must reconnect the cached node rather than constructing a new one.
  await audio.start({ kind: "file", element });
  assert.equal(contextCreations, 1);
  assert.equal(plays, 2);
  await audio.stop();
  assert.equal(pauses, 2);
  assert.equal(fileNodeDisconnects, 2);

  await audio.close();
  assert.equal(audio.state.contextState, "closed");
  assert.equal(timers.size, 0);

  const microphoneAudio = new BarberDelayAudio("sandy", runtime);
  microphoneAudio.setParameters({ speed: 0.08, outputLevel: 0.4 });
  assert.equal(
    microphoneRequests,
    0,
    "constructing and configuring the default Mic path must remain inert",
  );
  await microphoneAudio.start({ kind: "microphone" });
  assert.equal(microphoneRequests, 1);
  assert.equal(microphoneAudio.state.sourceKind, "microphone");
  assert.equal(microphoneAudio.node.connectedTarget, microphoneAudio.ceiling);
  assert.equal(microphoneAudio.ceiling.connectedTarget, microphoneAudio.master);
  assert.equal(microphoneAudio.ceiling.oversample, "none");
  assert.equal(filterCreations, 0);
  await microphoneAudio.stop();
  assert.equal(microphoneNodeDisconnects, 1);
  assert.equal(microphoneTrackStops, 1);
  await microphoneAudio.close();

  const centeredCandyAudio = new BarberDelayAudio("candy", runtime);
  await centeredCandyAudio.initialize();
  assert.equal(centeredCandyAudio.node.connectedTarget, centeredCandyAudio.ceiling);
  assert.equal(centeredCandyAudio.ceiling.connectedTarget, centeredCandyAudio.master);
  assert.equal(centeredCandyAudio.ceiling.oversample, "none");
  assert.equal(filterCreations, 0);
  await centeredCandyAudio.close();
});

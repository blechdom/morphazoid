const FAKE_MIDI_KEY = "__morphazoidFakeMidi";

function installVirtualWebMidi(options = {}) {
  const apiKey = "__morphazoidFakeMidi";
  if (globalThis[apiKey]) return;

  const asByte = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  const inputDefinitions = Array.isArray(options.inputs) && options.inputs.length
    ? options.inputs
    : [{
      id: "virtual-input-1",
      name: "Morphazoid E2E MIDI Input",
      manufacturer: "Morphazoid Tests",
    }];
  const outputDefinitions = Array.isArray(options.outputs) ? options.outputs : [];

  class VirtualMidiInput extends EventTarget {
    constructor(definition = {}) {
      super();
      this.id = String(definition.id || `virtual-input-${Math.random()}`);
      this.name = String(definition.name || "Virtual MIDI Input");
      this.manufacturer = String(definition.manufacturer || "Morphazoid Tests");
      this.type = "input";
      this.version = String(definition.version || "1.0");
      this.state = definition.state === "disconnected" ? "disconnected" : "connected";
      this.connection = "open";
      this._midiMessageListeners = new Set();
      this._onMidiMessage = null;
    }

    addEventListener(type, listener, optionsValue) {
      super.addEventListener(type, listener, optionsValue);
      if (type === "midimessage" && listener) this._midiMessageListeners.add(listener);
    }

    removeEventListener(type, listener, optionsValue) {
      super.removeEventListener(type, listener, optionsValue);
      if (type === "midimessage") this._midiMessageListeners.delete(listener);
    }

    get onmidimessage() {
      return this._onMidiMessage;
    }

    set onmidimessage(listener) {
      if (this._onMidiMessage) super.removeEventListener("midimessage", this._onMidiMessage);
      this._onMidiMessage = typeof listener === "function" ? listener : null;
      if (this._onMidiMessage) super.addEventListener("midimessage", this._onMidiMessage);
    }

    open() {
      this.connection = "open";
      return Promise.resolve(this);
    }

    close() {
      this.connection = "closed";
      return Promise.resolve(this);
    }

    emit(data, receivedTime = performance.now()) {
      const event = new Event("midimessage");
      Object.defineProperties(event, {
        data: {
          configurable: true,
          enumerable: true,
          value: Uint8Array.from(data, asByte),
        },
        receivedTime: {
          configurable: true,
          enumerable: true,
          value: Number.isFinite(Number(receivedTime))
            ? Number(receivedTime)
            : performance.now(),
        },
      });
      return this.dispatchEvent(event);
    }

    listenerCount() {
      return this._midiMessageListeners.size + (this._onMidiMessage ? 1 : 0);
    }
  }

  class VirtualMidiOutput extends EventTarget {
    constructor(definition = {}) {
      super();
      this.id = String(definition.id || `virtual-output-${Math.random()}`);
      this.name = String(definition.name || "Virtual MIDI Output");
      this.manufacturer = String(definition.manufacturer || "Morphazoid Tests");
      this.type = "output";
      this.version = String(definition.version || "1.0");
      this.state = definition.state === "disconnected" ? "disconnected" : "connected";
      this.connection = "open";
      this.sent = [];
      this.clearCount = 0;
    }

    open() {
      this.connection = "open";
      return Promise.resolve(this);
    }

    close() {
      this.connection = "closed";
      return Promise.resolve(this);
    }

    send(data, timestamp) {
      this.sent.push({
        data: Array.from(data || [], asByte),
        timestamp: timestamp == null ? null : Number(timestamp),
      });
    }

    clear() {
      this.clearCount += 1;
    }
  }

  const inputs = new Map(inputDefinitions.map((definition) => {
    const input = new VirtualMidiInput(definition);
    return [input.id, input];
  }));
  const outputs = new Map(outputDefinitions.map((definition) => {
    const output = new VirtualMidiOutput(definition);
    return [output.id, output];
  }));
  const access = new EventTarget();
  access.inputs = inputs;
  access.outputs = outputs;
  access.sysexEnabled = false;
  access.onstatechange = null;
  const accessDispatchEvent = access.dispatchEvent.bind(access);
  access.dispatchEvent = (event) => {
    const result = accessDispatchEvent(event);
    if (typeof access.onstatechange === "function") access.onstatechange.call(access, event);
    return result;
  };

  const requests = [];
  const dispatchStateChange = (port) => {
    const event = new Event("statechange");
    Object.defineProperty(event, "port", {
      configurable: true,
      enumerable: true,
      value: port,
    });
    access.dispatchEvent(event);
  };
  const inputFor = (id) => {
    const wanted = id == null ? inputs.keys().next().value : String(id);
    const input = inputs.get(wanted);
    if (!input) throw new Error(`Unknown virtual MIDI input: ${wanted || "(none)"}`);
    return input;
  };

  const api = {
    access,
    requests,
    send(data, { inputId = null, timestamp = performance.now() } = {}) {
      return inputFor(inputId).emit(data, timestamp);
    },
    connectInput(definition = {}) {
      const id = String(definition.id || `virtual-input-${inputs.size + 1}`);
      let input = inputs.get(id);
      if (!input) {
        input = new VirtualMidiInput({ ...definition, id });
        inputs.set(id, input);
      }
      input.state = "connected";
      input.connection = "open";
      dispatchStateChange(input);
      return id;
    },
    disconnectInput(id = null) {
      const input = inputFor(id);
      input.state = "disconnected";
      input.connection = "closed";
      dispatchStateChange(input);
      return input.id;
    },
    snapshot() {
      return {
        requests: requests.map((request) => ({ ...request })),
        inputs: [...inputs.values()].map((input) => ({
          id: input.id,
          name: input.name,
          manufacturer: input.manufacturer,
          state: input.state,
          connection: input.connection,
          listenerCount: input.listenerCount(),
        })),
        outputs: [...outputs.values()].map((output) => ({
          id: output.id,
          name: output.name,
          manufacturer: output.manufacturer,
          state: output.state,
          connection: output.connection,
          clearCount: output.clearCount,
          sent: output.sent.map((message) => ({
            data: [...message.data],
            timestamp: message.timestamp,
          })),
        })),
      };
    },
  };

  const requestMIDIAccess = (requestOptions = {}) => {
    const normalized = {
      sysex: Boolean(requestOptions?.sysex),
      software: Boolean(requestOptions?.software),
    };
    requests.push(normalized);
    access.sysexEnabled = normalized.sysex;
    return Promise.resolve(access);
  };
  try {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      enumerable: true,
      value: requestMIDIAccess,
    });
  } catch {
    Object.defineProperty(Object.getPrototypeOf(navigator), "requestMIDIAccess", {
      configurable: true,
      value: requestMIDIAccess,
    });
  }
  Object.defineProperty(globalThis, apiKey, {
    configurable: true,
    value: api,
  });
}

function statusByte(command, channel = 0) {
  return command | Math.max(0, Math.min(15, Math.round(Number(channel) || 0)));
}

function dataByte(value) {
  return Math.max(0, Math.min(127, Math.round(Number(value) || 0)));
}

export const MIDI_BYTES = Object.freeze({
  noteOn(note, velocity = 100, channel = 0) {
    return [statusByte(0x90, channel), dataByte(note), Math.max(1, dataByte(velocity))];
  },
  noteOff(note, velocity = 0, channel = 0) {
    return [statusByte(0x80, channel), dataByte(note), dataByte(velocity)];
  },
  controlChange(controller, value, channel = 0) {
    return [statusByte(0xb0, channel), dataByte(controller), dataByte(value)];
  },
  pitchBend(value = 8192, channel = 0) {
    const bounded = Math.max(0, Math.min(16383, Math.round(Number(value) || 0)));
    return [statusByte(0xe0, channel), bounded & 0x7f, (bounded >> 7) & 0x7f];
  },
  timingClock: Object.freeze([0xf8]),
  start: Object.freeze([0xfa]),
  continue: Object.freeze([0xfb]),
  stop: Object.freeze([0xfc]),
});

export function midiClockSequence({
  bpm = 120,
  pulses = 32,
  startAt = 1000,
} = {}) {
  const safeBpm = Math.max(1, Number(bpm) || 120);
  const pulseCount = Math.max(7, Math.round(Number(pulses) || 32));
  const pulseMilliseconds = 60_000 / (safeBpm * 24);
  return Array.from({ length: pulseCount }, (_, index) => ({
    data: MIDI_BYTES.timingClock,
    timestamp: Number(startAt) + index * pulseMilliseconds,
  }));
}

export async function installFakeMidi(page, options = {}) {
  await page.addInitScript(installVirtualWebMidi, options);
}

export async function fakeMidiSnapshot(page) {
  return page.evaluate((key) => globalThis[key]?.snapshot?.() ?? null, FAKE_MIDI_KEY);
}

export async function enableFakeMidi(page, {
  toggleSelector = "#sharedMidiToggle",
  timeout = 5000,
} = {}) {
  const toggle = page.locator(toggleSelector).first();
  await toggle.waitFor({ state: "visible", timeout });
  if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
  await page.waitForFunction((selector) => (
    document.querySelector(selector)?.getAttribute("aria-pressed") === "true"
  ), toggleSelector, { timeout });
  await page.waitForFunction((key) => {
    const snapshot = globalThis[key]?.snapshot?.();
    return Boolean(
      snapshot?.requests?.length
      && snapshot.inputs.some((input) => input.state === "connected" && input.listenerCount > 0),
    );
  }, FAKE_MIDI_KEY, { timeout });
  return fakeMidiSnapshot(page);
}

export async function sendMidi(page, data, {
  inputId = null,
  timestamp = null,
  settleFrames = 1,
} = {}) {
  return sendMidiSequence(page, [{ data, timestamp }], { inputId, settleFrames });
}

export async function sendMidiSequence(page, messages, {
  inputId = null,
  settleFrames = 1,
} = {}) {
  return page.evaluate(async ({ key, inputId: wantedInput, messages: sequence, settleFrames: frames }) => {
    const midi = globalThis[key];
    if (!midi) throw new Error("Virtual Web MIDI was not installed before navigation.");
    for (const message of sequence) {
      const options = { inputId: message.inputId ?? wantedInput };
      if (message.timestamp != null) options.timestamp = message.timestamp;
      midi.send(message.data, options);
    }
    for (let index = 0; index < Math.max(0, Number(frames) || 0); index += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return midi.snapshot();
  }, {
    key: FAKE_MIDI_KEY,
    inputId,
    messages,
    settleFrames,
  });
}

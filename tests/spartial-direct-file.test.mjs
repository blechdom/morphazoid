import assert from "node:assert/strict";
import test from "node:test";
import { mountChannelRecording } from "../src/instruments/spartial/spartial-recording.js";

class Element {
  events = new Map(); dataset = {}; disabled = false; hidden = false; checked = false; textContent = ""; open = false;
  addEventListener(type, handler) {
    if (!this.events.has(type)) this.events.set(type, new Set());
    this.events.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.events.get(type)?.delete(handler); }
  setAttribute(name, value) { this[name] = value; }
  async click() { for (const handler of this.events.get("click") ?? []) await handler(); }
  change() { for (const handler of this.events.get("change") ?? []) handler(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ picker = async () => ({ name: "chosen.wav", createWritable: async () => ({
  closed: false, aborted: false,
  async write() {},
  async close() { this.closed = true; },
  async abort() { this.aborted = true; },
}) }), rate = 48_000 } = {}) {
  const ids = ["Controls", "Record", "Time", "Hint", "Dialog", "Summary", "Message",
    "Folder", "Zip", "Wav", "Discard", "Close", "ChannelMap", "FileOption", "ToFile"];
  const elements = new Map(ids.map(id => [`multitrack${id}`, new Element()]));
  const doc = { getElementById: id => elements.get(id) };
  const runtime = new Element();
  runtime.AudioWorkletNode = class {};
  runtime.isSecureContext = true;
  if (picker) runtime.showSaveFilePicker = picker;
  const instances = [], locks = [];
  class Recorder {
    constructor({ onchange, channelCount }) {
      this.changed = onchange; this.channelCount = channelCount; instances.push(this);
    }
    async start({ filename, writable }) {
      this.filename = filename; this.writable = writable;
      this.mode = writable ? "file" : "memory";
      this.changed({ state: "starting", mode: this.mode, channelCount: this.channelCount, maxSeconds: 100 });
      this.changed({ state: "recording", mode: this.mode, channelCount: this.channelCount, maxSeconds: 100 });
    }
    async stop() {
      this.changed({ state: "stopping", mode: this.mode, channelCount: this.channelCount, maxSeconds: 100 });
      await this.writable?.close();
      this.changed({ state: "ready", mode: this.mode, channelCount: this.channelCount, maxSeconds: 100,
        filename: this.filename, sampleRate: rate, seconds: 1, frames: rate,
        blob: this.writable ? null : new Blob(["buffered"]), saved: Boolean(this.writable) });
    }
    discard() { this.changed({ state: "idle" }); }
    async destroy() { this.destroyed = true; }
  }
  const patch = { layoutId: "7-1", omitLfe: true, musical: { spin: 1 } };
  let enabled = true;
  const audio = { canRecord: () => enabled, recordingSampleRate: () => rate };
  const recording = mountChannelRecording({ audio, getPatch: () => patch,
    onLockChange: locked => locks.push(locked), doc, runtime, Recorder });
  return {
    recording, elements, runtime, instances, locks, patch,
    button: elements.get("multitrackRecord"), option: elements.get("multitrackToFile"),
    setAudio(value) { enabled = value; recording.update(); },
  };
}

test("SPARTIAL offers the real-rate direct WAV limit and saves only after a file writer closes", async () => {
  let suggestedName;
  const writer = { closed: false, aborted: false, async write() {}, async close() { this.closed = true; }, async abort() { this.aborted = true; } };
  const f = fixture({ picker: async options => {
    suggestedName = options.suggestedName;
    return { name: "my-seven-one.wav", createWritable: async () => writer };
  } });
  assert.equal(f.elements.get("multitrackFileOption").hidden, false);
  assert.match(f.elements.get("multitrackHint").textContent, /buffered.*01:56 at 48,000 Hz/);
  f.option.checked = true; f.option.change();
  assert.match(f.elements.get("multitrackHint").textContent, /direct to WAV file.*1:02:08 at 48,000 Hz/);
  await f.button.click();
  assert.match(suggestedName, /^spartial-.*-multichannel\.wav$/);
  assert.equal(f.instances[0].filename, "my-seven-one.wav");
  assert.equal(f.instances[0].writable, writer);
  assert.equal(f.recording.locked, true);
  assert.equal(f.option.disabled, true);
  f.patch.musical.spin = 5;
  assert.equal(f.recording.getStatus().metadata.musical.spin, 1);
  await f.button.click();
  assert.equal(writer.closed, true);
  assert.equal(f.recording.getStatus().hasTake, true);
  assert.equal(f.recording.getStatus().mode, "file");
  assert.equal(f.button.textContent, "Saved multitrack");
  assert.match(f.elements.get("multitrackMessage").textContent, /Saved my-seven-one\.wav to the selected file/);
  assert.equal(f.elements.get("multitrackWav").hidden, true);
  assert.equal(f.elements.get("multitrackZip").hidden, true);
  assert.equal(f.elements.get("multitrackFolder").hidden, true);
  assert.equal(f.elements.get("multitrackDiscard").textContent, "New take");
  await f.elements.get("multitrackDiscard").click();
  assert.equal(f.recording.getStatus().hasTake, false);
  assert.equal(f.option.disabled, false);
  assert.equal(writer.aborted, false, "new take does not delete the saved file");
  assert.equal(f.locks.at(-1), false);
  f.recording.destroy();
});

test("cancelled picker and failed file opening unlock SPARTIAL without starting a take; buffered fallback still works", async () => {
  const pending = deferred();
  const f = fixture({ rate: 44_100, picker: () => pending.promise });
  f.option.checked = true; f.option.change();
  assert.match(f.elements.get("multitrackHint").textContent, /1:07:37 at 44,100 Hz/);
  const click = f.button.click();
  assert.equal(f.recording.locked, true);
  assert.equal(f.button.disabled, true);
  assert.equal(f.button.textContent, "Choosing file…");
  pending.reject(new DOMException("cancelled", "AbortError"));
  await click;
  assert.equal(f.recording.locked, false);
  assert.equal(f.instances.length, 0);
  assert.doesNotMatch(f.elements.get("multitrackHint").textContent, /Could not open/);
  f.runtime.showSaveFilePicker = async () => ({ createWritable: async () => null });
  await f.button.click();
  assert.match(f.elements.get("multitrackHint").textContent, /does not provide a writable stream/);
  assert.equal(f.instances.length, 0, "a broken file handle cannot silently fall back to memory");
  f.runtime.showSaveFilePicker = async () => ({ createWritable: async () => {
    throw new DOMException("permission denied", "NotAllowedError");
  } });
  await f.button.click();
  assert.match(f.elements.get("multitrackHint").textContent, /Could not open recording file: permission denied/);
  assert.equal(f.instances.length, 0);
  f.option.checked = false; f.option.change();
  assert.match(f.elements.get("multitrackHint").textContent, /buffered.*02:06 at 44,100 Hz/);
  await f.button.click();
  assert.equal(f.instances[0].writable, undefined);
  await f.button.click();
  assert.equal(f.recording.getStatus().mode, "memory");
  assert.equal(f.elements.get("multitrackWav").hidden, false);
  await f.elements.get("multitrackDiscard").click();
  f.recording.destroy();
});

test("a late file writer is aborted if the page closes while opening it", async () => {
  const pending = deferred(), opening = deferred();
  const writer = { aborted: false, async write() {}, async close() {}, async abort() { this.aborted = true; } };
  const f = fixture({ picker: async () => ({ createWritable: () => { opening.resolve(); return pending.promise; } }) });
  f.option.checked = true; f.option.change();
  const click = f.button.click();
  await opening.promise;
  f.recording.destroy();
  pending.resolve(writer);
  await click;
  await Promise.resolve();
  assert.equal(writer.aborted, true);
  assert.equal(f.instances.length, 0);
  assert.equal(f.runtime.events.get("beforeunload").size, 0);
});

test("switching modes after an unsaved disk failure clears the stale error and unlocks a buffered retry", async () => {
  const f = fixture();
  f.option.checked = true; f.option.change();
  await f.button.click();
  f.instances[0].changed({ state: "error", error: "Disk write failed", channelCount: 8, mode: "file" });
  assert.match(f.elements.get("multitrackHint").textContent, /Disk write failed/);
  f.option.checked = false; f.option.change();
  assert.equal(f.recording.getStatus().state, "idle");
  assert.equal(f.recording.getStatus().metadata, null);
  assert.match(f.elements.get("multitrackHint").textContent, /buffered.*01:56/);
  await f.button.click();
  assert.equal(f.instances[1].writable, undefined);
  f.recording.destroy();
});

test("without a writable picker SPARTIAL hides direct capture and uses its bounded buffer", async () => {
  const f = fixture({ picker: null });
  assert.equal(f.elements.get("multitrackFileOption").hidden, true);
  f.option.checked = true; f.option.change();
  assert.match(f.elements.get("multitrackHint").textContent, /buffered.*01:56/);
  await f.button.click();
  assert.equal(f.instances[0].writable, undefined);
  await f.button.click();
  assert.equal(f.recording.getStatus().hasTake, true);
  f.recording.destroy();
});

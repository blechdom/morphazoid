import assert from "node:assert/strict";
import test from "node:test";
import { resumeAudioContext, withAudioTimeout } from "../src/audio-startup.js";
import { VoicePool } from "../src/audio.js";
import { initializeAudioSessionPolicy, needsAutomaticAudioSession } from "../src/site/audio-session-policy.js";
import { normalizeAudioButtonIcons } from "../nav.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeContext(resume = null) {
  return {
    state: "suspended", currentTime: 0, closed: 0,
    async resume() { if (resume) await resume(); this.state = "running"; },
    async close() { this.closed++; this.state = "closed"; },
  };
}

function fakePool(contexts, prepare = async () => {}) {
  const pool = new VoicePool(0, { startupTimeoutMs: 20 });
  pool.buildGraph = () => {
    pool.context = contexts.shift();
    pool.master = { gain: { setTargetAtTime() {} }, disconnect() {} };
  };
  pool.prepareContinuousSynth = prepare;
  pool.applyVoices = () => {};
  return pool;
}

test("resume is requested synchronously before subsequent work, and interrupted contexts are resumed", async () => {
  const calls = [];
  const context = fakeContext(() => { calls.push("resume"); });
  context.state = "interrupted";
  const start = resumeAudioContext(context);
  calls.push("load worklet");
  assert.deepEqual(calls, ["resume", "load worklet"]);
  assert.equal(await start, context);
});

test("a resolved resume is not success unless the context is actually running", async () => {
  await assert.rejects(resumeAudioContext({ state: "interrupted", resume() {} }), /interrupted/);
  await assert.rejects(resumeAudioContext({ state: "closed" }), /closed/);
});

test("startup deadline rejects stalled operations; late rejection remains handled", async () => {
  const late = deferred();
  await assert.rejects(withAudioTimeout(late.promise, { timeoutMs: 5 }), { name: "AudioStartupTimeoutError" });
  late.reject(new Error("late load error"));
  await Promise.resolve();
});

test("a pending resume is retired and a fresh Audio tap can retry", async () => {
  const pending = deferred(), first = fakeContext(() => pending.promise), second = fakeContext();
  const pool = fakePool([first, second]);
  await assert.rejects(pool.enable(), { name: "AudioStartupTimeoutError" });
  assert.equal(first.closed, 1);
  assert.equal(pool.startPromise, null);
  assert.equal(pool.context, null);
  await pool.enable();
  assert.equal(pool.context, second);
  assert.equal(pool.isEnabled, true);
  pending.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pool.context, second, "late completion cannot replace the new session");
  await pool.close();
});

test("a stalled worklet load cannot unmute after timeout and retry", async () => {
  const load = deferred(), first = fakeContext(), second = fakeContext();
  const pool = fakePool([first, second], async context => {
    if (context === first) await load.promise;
  });
  let submitted = 0;
  pool.applyVoices = () => { submitted++; };
  await assert.rejects(pool.enable(), { name: "AudioStartupTimeoutError" });
  await pool.enable();
  assert.equal(submitted, 1);
  load.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(submitted, 1);
  await pool.close();
});

test("Audio off cancels pending startup without late reactivation", async () => {
  const load = deferred(), context = fakeContext();
  const pool = fakePool([context], () => load.promise);
  const pending = pool.enable();
  const rejection = assert.rejects(pending, { name: "AbortError" });
  pool.disable();
  await rejection;
  load.resolve();
  await Promise.resolve();
  assert.equal(pool.isEnabled, false);
  assert.equal(pool.context, null);
  assert.equal(context.closed, 1);
});

test("a retired worklet load cannot enable the native fallback in a newer context", async () => {
  const Native = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class {};
  try {
    const moduleLoad = deferred();
    const pool = new VoicePool(0);
    const retired = { state: "running", audioWorklet: { addModule: () => moduleLoad.promise } };
    pool.context = retired;
    let fallbackBuilds = 0;
    pool.buildNativeVoices = () => { fallbackBuilds++; };
    const loading = pool.prepareContinuousSynth(retired);
    pool.context = { state: "running" };
    moduleLoad.reject(new Error("retired context closed"));
    await loading;
    assert.equal(pool.workletUnavailable, false);
    assert.equal(fallbackBuilds, 0);
  } finally {
    if (Native === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = Native;
  }
});

function policyHarness(options = {}, session = { type: "auto" }) {
  const handlers = [];
  const doc = { addEventListener(type, fn, capture) { handlers.push({ type, fn, capture }); } };
  const runtime = { navigator: { audioSession: session } };
  initializeAudioSessionPolicy(doc, runtime, options);
  initializeAudioSessionPolicy(doc, runtime, options);
  const click = (pressed = "false", state = "off", disabled = false) => {
    const button = { disabled, getAttribute: key => key === "aria-pressed" ? pressed : state };
    handlers[0].fn({ target: { closest: () => button } });
  };
  return { handlers, runtime, click, session };
}

test("playback policy is feature-detected, explicit, idempotent, and never arms Audio", () => {
  const h = policyHarness({ audioInput: false });
  assert.equal(h.session.type, "auto");
  assert.equal(h.handlers.length, 1);
  assert.equal(h.handlers[0].capture, true, "policy precedes the instrument's gesture handler");
  h.click("true", "on");
  assert.equal(h.session.type, "auto", "switching Audio off does not change policy");
  h.click();
  assert.equal(h.session.type, "playback");
  h.click();
  assert.equal(h.session.type, "playback");
});

test("microphone/unknown pages, WAX, disabled controls and existing capture sessions retain policy", () => {
  assert.equal(needsAutomaticAudioSession(null), true);
  assert.equal(needsAutomaticAudioSession({ id: "gesturama", audioInput: false }), true);
  assert.equal(needsAutomaticAudioSession({ id: "morphynx", audioInput: true }), true);
  assert.equal(needsAutomaticAudioSession({ id: "shapes", audioInput: false }), false);
  for (const options of [{}, { audioInput: true }]) {
    const h = policyHarness(options); h.click(); assert.equal(h.session.type, "auto");
  }
  const wax = policyHarness({ audioInput: false }); wax.runtime.MorphazoidWAX = {};
  wax.click(); assert.equal(wax.session.type, "auto");
  const disabled = policyHarness({ audioInput: false }); disabled.click("false", "off", true);
  assert.equal(disabled.session.type, "auto");
  const capture = policyHarness({ audioInput: false }, { type: "play-and-record" });
  capture.click(); assert.equal(capture.session.type, "play-and-record");
  const unsupported = policyHarness({ audioInput: false }, null);
  assert.doesNotThrow(() => unsupported.click());
  const throwing = policyHarness({ audioInput: false }, { get type() { throw new Error("unsupported"); } });
  assert.doesNotThrow(() => throwing.click());
});

function normalizeStatus({ state, text, pressed = "false", owner = false }) {
  const attrs = new Map([["data-audio-state", state], ["aria-pressed", pressed], ["data-audio-icon-ready", "true"]]);
  if (owner) attrs.set("data-audio-state-owner", "engine");
  const button = {
    children: [], classList: { contains: () => false },
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    querySelector: selector => selector === "#audioState" ? { textContent: text }
      : selector === ".audio-speaker-icon" ? {} : null,
  };
  const doc = { querySelectorAll: selector => selector === ".audio-button" ? [button] : [] };
  normalizeAudioButtonIcons(doc);
  normalizeAudioButtonIcons(doc);
  return Object.fromEntries(attrs);
}

test("header preserves explicit starting/error/interrupted states instead of claiming Audio on", () => {
  for (const state of ["starting", "error", "interrupted"]) {
    const actual = normalizeStatus({ state, text: "off", pressed: "true", owner: true });
    assert.equal(actual["data-audio-state"], state);
  }
  assert.equal(normalizeStatus({ state: "on", text: "starting", pressed: "true" })["data-audio-state"], "starting");
  assert.equal(normalizeStatus({ state: "on", text: "off" })["data-audio-state"], "off", "legacy stop still clears on");
});

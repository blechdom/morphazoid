import assert from "node:assert/strict";
import test from "node:test";
import { readWobbliniFileDuration } from "../src/instruments/wobblini/wobblini-audio.js";

function environment() {
  const listeners = new Map(), created = [], revoked = [];
  const audio = { duration: 80, loads: 0, src: "", preload: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    removeAttribute(name) { if (name === "src") this.src = ""; },
    load() { this.loads++; },
    play() { throw new Error("Metadata must never play audio"); },
  };
  return { audio, listeners, created, revoked,
    document: { createElement(tag) { assert.equal(tag, "audio"); return audio; } },
    url: { createObjectURL(file) { created.push(file); return "blob:metadata-test"; }, revokeObjectURL(value) { revoked.push(value); } },
  };
}
function released(env) {
  assert.equal(env.listeners.size, 0); assert.equal(env.audio.src, "");
  assert.deepEqual(env.revoked, ["blob:metadata-test"]); assert.equal(env.audio.loads, 2);
}

test("Wobblini metadata inspection reads duration without playback and releases its Blob URL", async () => {
  const env = environment(), file = { name: "clip.wav" }, controller = new AbortController();
  const pending = readWobbliniFileDuration(file, { ...env, signal: controller.signal });
  assert.equal(env.audio.preload, "metadata"); assert.deepEqual(env.created, [file]);
  env.listeners.get("loadedmetadata")(); assert.equal(await pending, 80); released(env);
  controller.abort(); assert.equal(env.revoked.length, 1, "settled reader no longer listens for abort");
});

test("Wobblini metadata abort, invalid duration, media errors and timeout clean up before rejecting", async () => {
  for (const mode of ["abort", "invalid", "error", "timeout"]) {
    const env = environment(), controller = new AbortController();
    const pending = readWobbliniFileDuration({}, { ...env, signal: controller.signal, timeoutMs: mode === "timeout" ? 5 : 1000 });
    const rejected = assert.rejects(pending, error => mode === "abort" ? error.name === "AbortError" : /shorter WAV, MP3 or M4A/.test(error.message));
    if (mode === "abort") controller.abort();
    if (mode === "invalid") { env.audio.duration = Infinity; env.listeners.get("loadedmetadata")(); }
    if (mode === "error") env.listeners.get("error")();
    await rejected; released(env);
  }
});

test("Wobblini metadata skips already cancelled work and reports unavailable readers", async () => {
  const env = environment(), controller = new AbortController(); controller.abort();
  await assert.rejects(readWobbliniFileDuration({}, { ...env, signal: controller.signal }), { name: "AbortError" });
  assert.equal(env.created.length, 0); assert.equal(env.audio.loads, 0);
  await assert.rejects(readWobbliniFileDuration({}, { document: undefined }), /shorter WAV, MP3 or M4A/);
});

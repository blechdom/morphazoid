import assert from "node:assert/strict";
import test from "node:test";
import { createProtoShell } from "../src/families/proto-graph/proto-shell.js";

test("proto-graph audio state changes preserve the shared speaker icon", async () => {
  const oldDocument = globalThis.document;
  const oldContext = globalThis.AudioContext;
  const clicks = new Map();
  const attributes = new Map();
  const speakerIcon = { className: "audio-speaker-icon" };
  const audio = {
    children: [speakerIcon],
    set textContent(_value) { throw new Error("Audio painting must not remove the shared icon"); },
    setAttribute(key, value) { attributes.set(key, value); },
    addEventListener(type, listener) { clicks.set(type, listener); },
  };
  globalThis.document = {
    getElementById(id) { return id === "audioButton" ? audio : null; },
    addEventListener() {},
  };
  globalThis.AudioContext = class { constructor() { this.state = "running"; } };
  try {
    const shell = createProtoShell();
    assert.equal(attributes.get("aria-pressed"), "false");
    clicks.get("click")();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(shell.armed, true);
    assert.equal(attributes.get("aria-pressed"), "true");
    assert.equal(audio.children[0], speakerIcon);
    clicks.get("click")();
    assert.equal(shell.armed, false);
    assert.equal(attributes.get("aria-pressed"), "false");
    assert.equal(audio.children[0], speakerIcon);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = oldContext;
  }
});

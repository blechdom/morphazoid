import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { createProtoShell } from "../src/families/proto-graph/proto-shell.js";

test("fresh-main proto shell preserves the shared Audio icon across startup, transport, arm and disarm", async () => {
  const icon = { className: "audio-speaker-icon" };
  const element = () => ({
    children: [], attributes: {}, listeners: {}, dataset: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    click() { this.listeners.click?.(); },
    set textContent(value) { this.children = []; this.text = value; },
  });
  const audio = element(), play = element(), status = element(), error = element();
  audio.children.push(icon);
  audio.setAttribute("aria-label", "Shared Audio name");
  audio.title = "Shared Audio title";
  const elements = { audioButton: audio, playButton: play, liveStatus: status, audioError: error };
  let contexts = 0, arms = 0, disarms = 0;
  const create = vm.runInNewContext(`(${createProtoShell.toString()})`, {
    document: { getElementById: id => elements[id], addEventListener() {} },
    AudioContext: class {
      constructor() { contexts++; this.state = "running"; }
    },
  });
  const shell = create({ onArm: () => { arms++; }, onDisarm: () => { disarms++; } });
  const assertIcon = pressed => {
    assert.deepEqual(audio.children, [icon]);
    assert.equal(audio.attributes["aria-pressed"], String(pressed));
    assert.equal(audio.attributes["aria-label"], "Shared Audio name");
    assert.equal(audio.title, "Shared Audio title");
  };
  assertIcon(false);
  play.click();
  assert.equal(shell.running, true);
  assert.equal(contexts, 0, "Play does not create or arm audio");
  assertIcon(false);
  audio.click();
  await new Promise(resolve => setImmediate(resolve));
  assertIcon(true);
  assert.equal(arms, 1);
  assert.equal(contexts, 1);
  audio.click();
  assertIcon(false);
  assert.equal(disarms, 1);
  assert.equal(shell.running, true, "Audio Off retains transport");
});

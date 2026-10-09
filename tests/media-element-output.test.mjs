import assert from "node:assert/strict";
import test from "node:test";
import { createMediaElementOutput } from "../src/media-element-output.js";
import { getSharedAudioOutputManager } from "../src/audio-output-manager.js";

function harness() {
  const contexts = [];
  const node = () => ({
    connections: new Set(),
    connect(target) { this.connections.add(target); return target; },
    disconnect(target) {
      if (target) this.connections.delete(target);
      else this.connections.clear();
    },
  });
  class AudioContext {
    constructor() {
      contexts.push(this);
      this.state = "suspended";
      this.destination = node();
      this.sources = [];
      this.gains = [];
      this.resumeCalls = 0;
      this.closeCalls = 0;
    }
    createGain() { const gain = node(); this.gains.push(gain); return gain; }
    createMediaElementSource(element) {
      assert.ok(!this.sources.some(source => source.mediaElement === element), "one source per element");
      const source = Object.assign(node(), { mediaElement: element });
      this.sources.push(source);
      return source;
    }
    async resume() { this.resumeCalls++; this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.closeCalls++; this.state = "closed"; }
  }
  const runtime = { AudioContext };
  return { runtime, contexts, manager: getSharedAudioOutputManager(runtime) };
}

test("media output stays lazy and routes every local player into one shared final mix", async () => {
  const { runtime, contexts, manager } = harness();
  const input = { volume: 0.35, muted: false, loop: true, playbackRate: 1.25 };
  const model = { volume: 0.8, muted: true, loop: false, playbackRate: 1 };
  const original = structuredClone([input, model]);
  const output = createMediaElementOutput([input, model, input], { runtime });
  assert.equal(output.context, null);
  assert.equal(contexts.length, 0);
  assert.equal(manager.connectionCount(), 0);

  const starting = output.resume();
  assert.equal(contexts[0].resumeCalls, 1, "resume runs inside the activating gesture");
  const context = await starting;
  assert.equal(output.context, context);
  assert.equal(context.sources.length, 2);
  assert.equal(context.gains.length, 1);
  const mix = context.gains[0];
  for (const source of context.sources) assert.deepEqual([...source.connections], [mix]);
  assert.deepEqual([...mix.connections], [context.destination]);
  assert.equal(manager.connectionCount(), 1);
  assert.deepEqual([input, model], original, "native volume/mute/rate/loop controls stay intact");

  await output.resume();
  await output.suspend();
  assert.equal(context.state, "suspended");
  await output.resume();
  assert.equal(context.sources.length, 2, "rearming cannot duplicate a media source");
  assert.equal(contexts.length, 1);
  assert.equal(manager.connectionCount(), 1);

  await output.close();
  await output.close();
  assert.equal(context.closeCalls, 1);
  assert.equal(manager.connectionCount(), 0);
  assert.equal(mix.connections.size, 0);
  for (const source of context.sources) assert.equal(source.connections.size, 0);
  await assert.rejects(output.resume(), /closed/);
});

test("unavailable Web Audio rejects explicitly without changing media controls", async () => {
  const media = { volume: 0.6, muted: false };
  const output = createMediaElementOutput([media], { runtime: {} });
  await assert.rejects(output.resume(), /Web Audio is unavailable/);
  assert.deepEqual(media, { volume: 0.6, muted: false });
  await output.close();
});

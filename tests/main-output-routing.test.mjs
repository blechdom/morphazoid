import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { connectAudioOutput, getSharedAudioOutputManager } from "../src/audio-output-manager.js";
import { mainOutputRoutingAmendments, restoreMainOutputRouting } from "./helpers/main-output-routing-reference.mjs";

test("output routing amendments reverse to independently hashed pre-change runtime bytes", async () => {
  assert.equal(mainOutputRoutingAmendments.changes.length, 10);
  for (const change of mainOutputRoutingAmendments.changes) {
    const current = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    const restored = restoreMainOutputRouting(current, change.file);
    assert.equal(createHash("sha256").update(restored).digest("hex"), change.sha256, change.file);
    const first = change.replacements[0];
    assert.throws(() => restoreMainOutputRouting(current.replace(first.after, ""), change.file), /exact main output routing amendment/);
    assert.throws(() => restoreMainOutputRouting(current + first.after, change.file), /exact main output routing amendment/);
  }
});

function audioContext() {
  const created = [];
  const node = (kind) => {
    const result = { kind, connections: new Set(),
      connect(target) { this.connections.add(target); return target; },
      disconnect(target) { if (target) this.connections.delete(target); else this.connections.clear(); },
    };
    for (const key of ["gain", "threshold", "knee", "ratio", "attack", "release"]) {
      result[key] = { value: 0, setTargetAtTime(value) { this.value = value; } };
    }
    created.push(result);
    return result;
  };
  const context = {
    state: "running", sampleRate: 48_000, currentTime: 0, created,
    destination: node("destination"),
    createGain: () => node("gain"),
    createDynamicsCompressor: () => node("compressor"),
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    async close() { this.state = "closed"; },
  };
  return context;
}

for (const id of ["splice-ring", "onset-atlas", "synaptic-resonance"]) {
  test(`${id} keeps one post-compressor output across rearming and releases it on exit`, async () => {
    const source = await readFile(new URL(`../src/instruments/${id}/${id}-app.js`, import.meta.url), "utf8");
    // Execute the actual app-owned arm/teardown callbacks without constructing
    // an unrelated Canvas scene. Final graph edges and lease counts are observed.
    const arm = source.match(/  onArm: async \(context\) => \{[\s\S]*?\n  \},(?=\n  onDisarm)/)?.[0];
    const teardown = source.match(/globalThis\.addEventListener\("pagehide", \(event\) => \{[\s\S]*?\n\}\);/)?.[0];
    assert.ok(arm && teardown);
    const context = audioContext();
    const runtime = {};
    const manager = getSharedAudioOutputManager(runtime);
    let pagehide;
    const config = runInNewContext(`
      let master = null, releaseAudioOutput = null, buffer = null;
      let readerT0, readerDur, readerSeg, walkT0, walkDur, linearIndex, nextPulseAt;
      const waveform = new Float32Array(8);
      const shell = { context };
      ${teardown}
      ({ ${arm} })
    `, {
      context,
      connectAudioOutput: (ctx, node) => connectAudioOutput(ctx, node, { runtime }),
      addEventListener: (type, listener) => { assert.equal(type, "pagehide"); pagehide = listener; },
      renderDemoPhrase: () => context.createBuffer(1, 8),
      refresh: () => {}, analyse: () => {},
    });
    await config.onArm(context);
    await config.onArm(context);
    assert.equal(manager.connectionCount(), 1);
    const compressors = context.created.filter(node => node.kind === "compressor");
    assert.equal(compressors.length, 1, "rearm reuses the final dynamics/output graph");
    assert.deepEqual([...compressors[0].connections], [context.destination]);
    const gains = context.created.filter(node => node.kind === "gain");
    assert.equal(gains.length, 1);
    assert.deepEqual([...gains[0].connections], [compressors[0]]);
    pagehide({ persisted: true });
    assert.equal(manager.connectionCount(), 1, "back/forward cache keeps the reusable graph");
    pagehide({ persisted: false });
    assert.equal(manager.connectionCount(), 0);
    assert.equal(context.state, "closed");
    assert.equal(compressors[0].connections.size, 0);
  });
}

test("Gesturama registers its post-compressor output and releases it before closing", async () => {
  const priorAudioContext = globalThis.AudioContext;
  const context = audioContext();
  globalThis.AudioContext = class { constructor() { return context; } };
  try {
    const { DrumEngine } = await import("../src/instruments/gesturama/gesturama-audio.js?output-routing-test");
    const manager = getSharedAudioOutputManager();
    const engine = new DrumEngine();
    await engine.ensureStarted();
    await engine.ensureStarted();
    assert.equal(manager.connectionCount(), 1);
    const compressor = context.created.find(node => node.kind === "compressor");
    assert.deepEqual([...engine.master.connections], [compressor]);
    assert.deepEqual([...compressor.connections], [context.destination]);
    engine.setVolume(0.4);
    assert.equal(engine.master.gain.value, 0.4);
    await engine.close();
    await engine.close();
    assert.equal(manager.connectionCount(), 0);
    assert.equal(context.state, "closed");
  } finally {
    if (priorAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = priorAudioContext;
  }
});

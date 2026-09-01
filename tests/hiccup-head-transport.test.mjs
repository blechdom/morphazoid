import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("step headings are passive and the transport always loops the full sequence", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.doesNotMatch(app, /stepRangeDrag|setLoopRange|queueSequenceStep|releaseSubloop/);
  assert.match(app, /sequenceStep = \(sequenceStep \+ 1\) % sequenceLength/);
  assert.match(app, /const heading = document\.createElement\("span"\)/);
});

test("the grid shows programmed rows with replace and add sound menus", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.match(app, /function activeSequenceSounds\(\)[\s\S]*?pattern\[id\]\.some/);
  assert.match(app, /addSoundSelect\.setAttribute\("aria-label", "Add sound row"\)/);
  assert.match(app, /trigger = document\.createElement\("select"\)/);
  assert.match(app, /changeSequenceRowSound\(sound\.id, trigger\.value\)/);
  assert.match(app, /pattern\[nextId\]\[step\] = Math\.max\(pattern\[nextId\]\[step\], pattern\[previousId\]\[step\]\)/);
  assert.match(app, /sequenceSoundOrder\[rowIndex\] = nextId/);
  assert.match(app, /sequenceSoundOrder\.push\(soundId\)/);
  assert.match(app, /new Set\(visibleSounds\.map\(\(\{ id \}\) => id\)\)/);
});

test("the audio clock prebuffers mobile work and skips late-event bursts", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  assert.match(app, /scheduleSequenceAhead\(usesCompactCanvas\(\) \? 0\.32 : 0\.22\)/);
  assert.match(app, /while \(nextStepTime < audioContext\.currentTime - 0\.025\)/);
  assert.match(app, /schedulerTimer = setInterval\(scheduleSequence, 18\)/);
  assert.match(app, /const earlyResume = context\.resume\(\)/);
  assert.ok(
    app.indexOf("const earlyResume = context.resume()")
      < app.indexOf("context.audioWorklet.addModule"),
    "mobile audio must resume while the original user activation is still live",
  );
  assert.match(app, /if \(audioStartupPromise\) return audioStartupPromise/);
  assert.match(app, /await graph\.awaitRenderReady\(\)/);
  assert.match(app, /const outputSettleMilliseconds = clamp\(deviceLatency \* 1_250 \+ 45, 65, 420\)/);
  assert.match(app, /gain\.gain\.value = 0\.00002/);
  assert.match(app, /if \(leftPeriod === 0 && rightPeriod === 0\) return 1/);
  assert.match(app, /const hitCount = Number\(leftHit\) \+ Number\(rightHit\)/);
  assert.match(app, /\? \(1 \+ emphasis \* 0\.32\) \*\* hitCount/);
  assert.match(app, /: 10 \*\* \(-12 \* emphasis \/ 20\)/);
  assert.match(app, /nextStepTime = audioContext\.currentTime \+ 0\.072/);
  assert.match(processor, /message\.type === "warmup"[\s\S]*?this\.warmupFramesRemaining = Math\.max/);
  assert.match(processor, /type: "render-ready"[\s\S]*?renderedFrames: this\.renderedFrames/);
  assert.match(processor, /message\.type === "drop-scheduled"[\s\S]*?this\.queue\.length = 0/);
});

test("the two eyebrows execute the five-position on/off-beat accent map", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const browSource = app.slice(
    app.indexOf("function normalizedBrowValue("),
    app.indexOf("function scheduleSequence()"),
  );
  assert.ok(browSource.startsWith("function normalizedBrowValue("));
  const clamp = (value, minimum = 0, maximum = 1) => (
    Math.min(maximum, Math.max(minimum, value))
  );
  const { normalizedBrowValue, browAccentPeriod, browSequenceGain } = Function(
    "clamp",
    "eyebrowEmphasis",
    `${browSource}\nreturn { normalizedBrowValue, browAccentPeriod, browSequenceGain };`,
  )(clamp, 0.7);

  assert.deepEqual(
    [-1, 0.12, 0.25, 0.49, 0.51, 0.76, 1.4].map(normalizedBrowValue),
    [0, 0, 0.25, 0.5, 0.5, 0.75, 1],
  );
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1].map(browAccentPeriod), [0, 8, 6, 4, 2]);

  const expected = [
    { value: 0.25, left: [7, 15, 23, 31], right: [3, 11, 19, 27] },
    { value: 0.5, left: [5, 11, 17, 23, 29], right: [2, 8, 14, 20, 26] },
    { value: 0.75, left: [3, 7, 11, 15, 19, 23, 27, 31], right: [1, 5, 9, 13, 17, 21, 25, 29] },
    { value: 1, left: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31], right: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30] },
  ];
  const emphasis = 0.7;
  const accentGain = 1 + emphasis * 0.32;
  const duckedGain = 10 ** (-12 * emphasis / 20);
  for (const entry of expected) {
    const leftGains = Array.from(
      { length: 32 },
      (_, step) => browSequenceGain(step, entry.value, 0, emphasis),
    );
    const rightGains = Array.from(
      { length: 32 },
      (_, step) => browSequenceGain(step, 0, entry.value, emphasis),
    );
    assert.deepEqual(
      leftGains.flatMap((gain, step) => gain > 1 ? [step] : []),
      entry.left,
    );
    assert.deepEqual(
      rightGains.flatMap((gain, step) => gain > 1 ? [step] : []),
      entry.right,
    );
    for (const [step, gain] of leftGains.entries()) {
      assert.ok(Math.abs(gain - (entry.left.includes(step) ? accentGain : duckedGain)) < 1e-12);
    }
    for (const [step, gain] of rightGains.entries()) {
      assert.ok(Math.abs(gain - (entry.right.includes(step) ? accentGain : duckedGain)) < 1e-12);
    }
  }

  for (let step = 0; step < 64; step += 1) {
    assert.equal(browSequenceGain(step, 0, 0, 0.9), 1, "both brows down is a bypass");
    assert.equal(browSequenceGain(step, 1, 1, 0), 1, "zero emphasis is a bypass");
  }
  assert.ok(accentGain >= 1.2);
  assert.ok(duckedGain <= 0.4);
  assert.ok(accentGain / duckedGain >= 3);
  const maximumAccent = browSequenceGain(1, 1, 0, 0.9);
  const maximumDuck = browSequenceGain(0, 1, 0, 0.9);
  assert.ok(maximumAccent <= 1.3);
  assert.ok(maximumDuck >= 0.28);
  assert.ok(maximumAccent / maximumDuck > 4);

  const combinedHits = Array.from(
    { length: 16 },
    (_, step) => browSequenceGain(step, 0.75, 0.75, emphasis),
  );
  assert.deepEqual(
    combinedHits.flatMap((gain, step) => gain > 1 ? [step] : []),
    [1, 3, 5, 7, 9, 11, 13, 15],
  );
  assert.ok(combinedHits.every((gain) => gain <= accentGain));
  const overlappingRightAccent = browSequenceGain(3, 1, 0.25, emphasis);
  assert.ok(Math.abs(overlappingRightAccent - accentGain ** 2) < 1e-12);
  assert.ok(overlappingRightAccent > browSequenceGain(3, 1, 0, emphasis));
});

test("the worklet acknowledges startup only after real render quanta", async () => {
  const keys = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"];
  const originals = new Map(keys.map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  let Processor = null;
  Object.defineProperty(globalThis, "sampleRate", {
    configurable: true,
    writable: true,
    value: 48_000,
  });
  Object.defineProperty(globalThis, "AudioWorkletProcessor", {
    configurable: true,
    writable: true,
    value: class {
      constructor() {
        this.messages = [];
        this.port = {
          onmessage: null,
          postMessage: (message) => this.messages.push(message),
        };
      }
    },
  });
  Object.defineProperty(globalThis, "registerProcessor", {
    configurable: true,
    writable: true,
    value: (name, Constructor) => {
      if (name === "hiccup-head-physical-model") Processor = Constructor;
    },
  });

  try {
    await import(`../src/hiccup-head-processor.js?startup-ready=${Date.now()}-${Math.random()}`);
    const processor = new Processor({ processorOptions: { configuration: {} } });
    processor._handleMessage({ type: "warmup", token: "cold-start" });
    for (let block = 0; block < 14; block += 1) {
      processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    }
    assert.equal(
      processor.messages.some(({ type }) => type === "render-ready"),
      false,
      "wall time alone must not claim the renderer is ready",
    );
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
    assert.deepEqual(
      processor.messages.find(({ type }) => type === "render-ready"),
      { type: "render-ready", token: "cold-start", renderedFrames: 1_920 },
    );
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

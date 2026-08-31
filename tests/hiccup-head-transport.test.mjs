import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("step clicks cue playback while only drags create subloops", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  assert.match(app, /stepRangeDrag = \{ start: step, end: step, moved: false \}/);
  assert.doesNotMatch(
    app,
    /stepRangeDrag = \{ start: step, end: step[^}]*\};\s*setLoopRange\(step, step/,
  );
  assert.match(app, /if \(!moved\) queueSequenceStep\(start\);\s*else setLoopRange\(start, end\)/);
  assert.match(app, /function queueSequenceStep\(step\)[\s\S]*?clamp\(step, 0, sequenceLength - 1\)/);
  assert.match(app, /startSequence\(\{ restart: true, startStep: target \}\)/);
});

test("subloops have a visible release control and transport-safe reset", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("hiccup-head.css", root), "utf8"),
  ]);
  assert.match(app, /releaseSubloopButton\.textContent = "×"/);
  assert.match(app, /function releaseSubloop\(\)[\s\S]*?loopStartStep = 0;[\s\S]*?loopEndStep = sequenceLength - 1/);
  assert.match(app, /if \(sequencePlaying\) rescheduleTransportFrom\(continuationStep\)/);
  assert.match(css, /\.hiccup-head-release-subloop/);
});

test("the audio clock prebuffers mobile work and skips late-event bursts", async () => {
  const [app, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  assert.match(app, /scheduleSequenceAhead\(usesCompactCanvas\(\) \? 0\.32 : 0\.22\)/);
  assert.match(app, /while \(nextStepTime < audioContext\.currentTime - 0\.025\)/);
  assert.match(app, /schedulerTimer = setInterval\(scheduleSequence, 18\)/);
  assert.match(app, /postMessage\(\{ type: "drop-scheduled" \}\)/);
  assert.match(processor, /message\.type === "drop-scheduled"[\s\S]*?this\.queue\.length = 0/);
});

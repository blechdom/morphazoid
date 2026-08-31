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
  assert.match(processor, /message\.type === "drop-scheduled"[\s\S]*?this\.queue\.length = 0/);
});

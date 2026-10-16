import assert from "node:assert/strict";
import test from "node:test";
import { BrowserRecordingStore, recordingParts, RECORDING_PART_BYTES } from "../src/output-recording-storage.js";
import { wavHeader } from "../src/output-recorder.js";

test("parts cap exported WAV size, keep continuous frame ranges and number beyond 999", () => {
  const partFrames = Math.floor((RECORDING_PART_BYTES - 44) / 6);
  const parts = recordingParts({ filename: "speech.wav", frames: partFrames * 1000 + 17, partFrames, sampleRate: 48_000, channelCount: 2 });
  assert.equal(parts.length, 1001);
  assert.equal(parts[0].bytes, RECORDING_PART_BYTES);
  assert.equal(parts[1000].filename, "speech-part-1001.wav");
  assert.equal(parts[1000].frames, 17);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    assert.ok(part.bytes <= RECORDING_PART_BYTES);
    if (i) assert.equal(parts[i - 1].start + parts[i - 1].frames, part.start);
    const header = wavHeader({ sampleRate: 48_000, frames: part.frames });
    assert.equal(new DataView(header.buffer).getUint32(4, true) + 8, part.bytes);
  }
});

test("browser storage cannot request unbounded export parts and fails clearly when unavailable", async () => {
  const store = new BrowserRecordingStore({ runtime: {}, partBytes: Number.MAX_SAFE_INTEGER });
  assert.equal(store.partBytes, RECORDING_PART_BYTES);
  await assert.rejects(store.list(), /Browser storage is unavailable/);
  assert.equal(store.opening, null, "a denied open can be retried");
});

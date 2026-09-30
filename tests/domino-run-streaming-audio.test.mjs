import test from 'node:test';
import assert from 'node:assert/strict';
import { DominoMixer } from '../src/instruments/domino-run/domino-run-processor.js';

test('bounded streaming batches keep every impact through 650 ms producer stalls', () => {
  const sampleRate = 8000;
  const blockSize = 128;
  const mixer = new DominoMixer(sampleRate);
  mixer.addBuffer({ id: 1, sampleRate,
    data: Float32Array.from({ length: 32 }, (_, i) => Math.sin(i * 0.5) * 0.1) });
  // Adversarial upper-density cohorts: 512 pieces, three impacts per fall,
  // then 0.5 seconds from landing until the next occurrence can start.
  const events = [];
  for (let occurrence = 0; occurrence < 18; occurrence += 1) {
    for (let id = 0; id < 512; id += 1) {
      for (const phase of [0, 0.012, 0.03]) {
        events.push({ id: events.length, time: 0.08 + occurrence * 0.53 + phase,
          bufferId: 1, rate: 1, gain: 0.02, pan: id / 511 * 2 - 1 });
      }
    }
  }
  events.sort((a, b) => a.time - b.time || a.id - b.id);
  const delivered = new WeakSet();
  const ids = new Set();
  const stalls = [[1.405, 2.055], [4.805, 5.455], [8.105, 8.755]];
  const hitsDuringStalls = new Uint32Array(stalls.length);
  const left = new Float32Array(blockSize); const right = new Float32Array(blockSize);
  let future = [];
  let refillAt = 0;
  let maximumQueued = 0;
  let deferredForCapacity = 0;
  let expiredUnscheduled = 0;
  const duration = events.at(-1).time + 0.2;
  for (let frame = 0; frame / sampleRate < duration; frame += blockSize) {
    const now = frame / sampleRate;
    const stall = stalls.findIndex(([start, end]) => now >= start && now < end);
    if (now >= refillAt && stall < 0) {
      // A short grace retains quantum-boundary events until the processor has
      // certainly consumed them, avoiding accidental queue over-allocation.
      future = future.filter((event) => event.time >= now - 0.04);
      const capacity = 3500 - future.length;
      const batch = [];
      for (const event of events) {
        if (delivered.has(event)) continue;
        if (event.time > now + 4) break;
        if (event.time < now) { expiredUnscheduled += 1; continue; }
        if (batch.length >= capacity) { deferredForCapacity += 1; break; }
        assert.equal(ids.has(event.id), false, 'an impact is never delivered twice');
        ids.add(event.id); delivered.add(event); batch.push(event);
      }
      future.push(...batch);
      mixer.enqueue(batch);
      maximumQueued = Math.max(maximumQueued, mixer.status.queued);
      refillAt = now + 0.08;
    }
    const before = mixer.status.played;
    mixer.process(left, right, now);
    if (stall >= 0) hitsDuringStalls[stall] += mixer.status.played - before;
    assert.ok(left.every(Number.isFinite)); assert.ok(right.every(Number.isFinite));
  }
  assert.ok(deferredForCapacity > 0, 'the scenario exercises actual backpressure');
  assert.ok(maximumQueued <= 3500);
  assert.equal(expiredUnscheduled, 0);
  assert.ok(hitsDuringStalls.every((count) => count > 0), 'impacts continue on the audio thread during every producer stall');
  assert.equal(ids.size, events.length);
  assert.equal(mixer.status.played, events.length);
  assert.equal(mixer.status.dropped, 0);
  assert.equal(mixer.status.queued, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { inputEnvelopeReader, inputHistoryFrame, tapActivityFrame, branchWavePoints, activityEnergy } from './model.js';

test('input history keeps its audio timestamps and interpolates adjacent samples', () => {
  const read = inputEnvelopeReader({ interval: .1, endTime: 2, values: [0, .4, 0] });
  assert.equal(read(1.7), 0);
  assert.ok(Math.abs(read(1.85) - .2) < 1e-12);
  assert.equal(read(2), 0);
  assert.equal(inputEnvelopeReader({ interval: 0, endTime: 2, values: [1] }), null);
  const release = inputEnvelopeReader({ interval: .01, endTime: 4, values: [.3] });
  assert.ok(Math.abs(release(4.16) - .3 / Math.E) < 1e-12);
});

test('constant input vibrates descendants over audio time while endpoints stay joined', () => {
  const node = { generation: 8, voiceIndex: 4000, index: 7, rate: 1.5, startDelay: .2, delay: .6, voiceLevel: .3 };
  const start = { x: 0, y: 0 }, end = { x: 100, y: 0 };
  const first = branchWavePoints(node, start, end, () => .3, 14, false, 4);
  const later = branchWavePoints(node, start, end, () => .3, 14, false, 4.08);
  assert.equal(first[0].x, start.x); assert.equal(first[0].y, start.y);
  assert.equal(first.at(-1).x, end.x); assert.equal(first.at(-1).y, end.y);
  assert.ok(first.slice(1, -1).some((p, i) => Math.abs(p.y - later[i + 1].y) > .01));
});

test('an input packet advances through a descendant instead of lighting its whole length', () => {
  const node = { generation: 2, voiceIndex: 5, rate: 1, startDelay: .2, delay: 1.2, voiceLevel: .7 };
  const pulse = time => Math.abs(time - 2) <= .08 ? .5 : 0;
  const curve = now => branchWavePoints(node, { x: 0, y: 0 }, { x: 210, y: 0 }, pulse, 14, false, now);
  const attack = curve(2.45), later = curve(2.95);
  const activeX = points => points.filter(p => p.energy > .015).map(p => p.x);
  assert.ok(activeX(attack).length > 0 && activeX(later).length > 0);
  assert.ok(Math.max(...activeX(attack)) < Math.min(...activeX(later)));
  assert.ok(attack.some(p => p.energy === 0));
  assert.ok(later.some(p => p.energy === 0));
  assert.ok(curve(4).every(p => p.energy === 0 && Math.abs(p.y) < 1e-12));
});

test('unmetered admitted voices use the same input-history response and reduced motion preserves energy', () => {
  const node = { generation: 13, voiceIndex: 12000, rate: .5, startDelay: .5, delay: .8, voiceLevel: .08 };
  const moving = branchWavePoints(node, { x: 0, y: 0 }, { x: 8, y: 0 }, () => .3, 4, false, 20);
  const still = branchWavePoints(node, { x: 0, y: 0 }, { x: 8, y: 0 }, () => .3, 4, true, 20);
  assert.ok(moving.slice(1, -1).some(p => Math.abs(p.y) > .01));
  assert.ok(still.every(p => p.y === 0 && p.energy > 0));
});

test('topology revision lag cannot discard microphone history used by descendant waves', () => {
  const parameters = { lSystemType: 'plant', generations: 8 };
  const reply = { audio: true, topologyRevision: 42, parameters,
    status: { sampleRate: 48_000, elapsedSeconds: 12, topologyRevision: 41,
      tapActivity: [], tapVoiceIndices: [],
      inputEnvelope: { interval: .1, endTime: 12, values: [0, .5, 0] } } };
  assert.equal(tapActivityFrame(reply, parameters), null);
  const history = inputHistoryFrame(reply, {}, 1000);
  assert.ok(Math.abs(history.reader(11.9) - .5) < 1e-12);
  const node = { generation: 8, voiceIndex: 300, rate: 1.2, startDelay: .2, delay: .8, voiceLevel: .35 };
  const points = branchWavePoints(node, { x: 0, y: 0 }, { x: 140, y: 0 }, history.reader, 14, false, 12.3);
  assert.ok(points.slice(1, -1).some(p => p.energy > .015 && Math.abs(p.y) > .01));
  assert.ok(points.some(p => p.energy === 0));
});

test('a missing coherent history snapshot advances the clock while retaining the prior recording', () => {
  const previous = inputHistoryFrame({ audio: true, status: { sampleRate: 48_000, elapsedSeconds: 8,
    inputEnvelope: { interval: .1, endTime: 8, values: [.2, .4] } } }, {}, 1000);
  const missing = inputHistoryFrame({ audio: true, status: { sampleRate: 48_000, elapsedSeconds: 8.2,
    inputEnvelope: { interval: .1, endTime: 0, values: [] } } }, previous, 1200);
  assert.equal(missing.reader, previous.reader);
  assert.equal(missing.receivedAt, 1000);
  assert.equal(missing.endTime, 8);
  assert.equal(missing.clock, 8.2);
  assert.equal(missing.clockReceivedAt, 1200);
  assert.ok(Math.abs(missing.reader(8.16) - .4 / Math.E) < 1e-12);
});

test('late status packets cannot rewind input history or its extrapolated sample clock', () => {
  const frame = (elapsedSeconds, endTime, values) => ({ audio: true,
    status: { sampleRate: 48_000, elapsedSeconds, inputEnvelope: { interval: .1, endTime, values } } });
  const current = inputHistoryFrame(frame(20, 20, [.2, .5]), {}, 2000);
  const late = inputHistoryFrame(frame(19.9, 19.9, [1, 1]), current, 2200);
  assert.equal(late.reader, current.reader);
  assert.equal(late.receivedAt, 2000);
  assert.equal(late.clock, 20);
  assert.equal(late.clockReceivedAt, 2000);
  const newer = inputHistoryFrame(frame(20.2, 20.2, [.4, .1]), late, 2400);
  assert.equal(newer.clock, 20.2);
  assert.equal(newer.endTime, 20.2);
  assert.equal(newer.reader(20.2), .1);
});

test('audio stop and a fresh sample-clock session clear the previous microphone recording', () => {
  const running = inputHistoryFrame({ audio: true, status: { sampleRate: 48_000, elapsedSeconds: 30,
    inputEnvelope: { interval: .1, endTime: 30, values: [.8] } } }, {}, 3000);
  const stopped = inputHistoryFrame({ audio: false, status: { sampleRate: 0, elapsedSeconds: 0 } }, running, 3100);
  assert.equal(stopped.reader, null);
  assert.equal(stopped.receivedAt, -Infinity);
  assert.equal(stopped.clock, 0);
  const restarted = inputHistoryFrame({ audio: true, status: { sampleRate: 48_000, elapsedSeconds: .1,
    inputEnvelope: { interval: .1, endTime: .1, values: [.2] } } }, stopped, 3200);
  assert.equal(restarted.reader(.1), .2);
  assert.equal(restarted.reader(29.9) > .01, false);
  const unseenRestart = inputHistoryFrame({ audio: true, status: { sampleRate: 48_000, elapsedSeconds: .1,
    inputEnvelope: { interval: .1, endTime: .1, values: [.2] } } }, running, 3300);
  assert.equal(unseenRestart.clock, .1);
  assert.equal(unseenRestart.reader(.1), .2);
});

test('short Coral transits remain silent when the actual tap is silent despite input history', () => {
  const node = { generation: 7, voiceIndex: 300, rate: 3, startDelay: .4, delay: .43,
    voiceLevel: .08, measuredEnergy: 0, parentEnergy: .7 };
  const points = branchWavePoints(node, { x: 0, y: 0 }, { x: 33, y: 0 }, () => .3, 14, false, 4);
  assert.ok(points.every(point => point.energy === 0 && point.y === 0),
    'a filled capture ring cannot invent activity before the granular tap actually sounds');
});

test('normal quiet tap RMS produces visible CSS-pixel movement on short Coral segments', () => {
  // A faint output contribution, not an artificial full-volume input history.
  const node = { generation: 7, voiceIndex: 300, rate: 3, startDelay: .4, delay: .43,
    voiceLevel: .08, measuredEnergy: activityEnergy(.0005) };
  let maximum = 0;
  for (let time = 4; time < 4.6; time += .025) {
    const points = branchWavePoints(node, { x: 0, y: 0 }, { x: 33, y: 0 }, () => 0, 14, false, time);
    maximum = Math.max(maximum, ...points.map(point => Math.abs(point.y)));
    assert.equal(points.at(-1).energy, node.measuredEnergy,
      'the output endpoint follows measured response without another generation-count attenuation');
  }
  assert.ok(maximum >= 1, `normal short-segment response must move at least one CSS pixel; received ${maximum}`);
});

test('long-delay packets travel through the interior while the endpoint follows actual tap RMS', () => {
  const node = { generation: 2, voiceIndex: 5, rate: 1, startDelay: .2, delay: 1.2,
    voiceLevel: .7, measuredEnergy: 0, parentEnergy: 0 };
  const pulse = time => Math.abs(time - 2) <= .08 ? .5 : 0;
  const curve = now => branchWavePoints(node, { x: 0, y: 0 }, { x: 210, y: 0 }, pulse, 14, false, now);
  const earlier = curve(2.45), later = curve(2.95), arrival = curve(3.2);
  const active = points => points.filter(point => point.energy > .015).map(point => point.x);
  assert.ok(active(earlier).length && active(later).length, 'in-flight packets retain spatial position');
  assert.ok(Math.max(...active(earlier)) < Math.min(...active(later)), 'the packet advances along the branch');
  assert.equal(arrival.at(-1).energy, 0, 'a delayed input prediction does not override the silent rendered endpoint');
  const sounding = branchWavePoints({ ...node, measuredEnergy: .2 }, { x: 0, y: 0 }, { x: 210, y: 0 },
    () => 0, 14, false, 4);
  assert.equal(sounding.at(-1).energy, .2, 'the rendered endpoint can sound after the capture envelope has moved on');
});

test('reduced motion retains measured tap brightness without deflecting short segments', () => {
  const node = { generation: 7, voiceIndex: 300, rate: 3, startDelay: .4, delay: .43,
    measuredEnergy: .2, voiceLevel: .08 };
  const points = branchWavePoints(node, { x: 0, y: 0 }, { x: 33, y: 0 }, () => 0, 14, true, 4);
  assert.ok(points.every(point => point.y === 0 && point.energy === .2));
});


test('accepted microphone history retains the same raw snapshot for GPU and Canvas readers', () => {
  const envelope = { interval: .1, endTime: 4, values: [.1, .2, .3] };
  const first = inputHistoryFrame({ audio: true, status: { sampleRate: 48000, elapsedSeconds: 4, inputEnvelope: envelope } }, {}, 100);
  assert.equal(first.envelope, envelope);
  assert.equal(first.reader(4), envelope.values.at(-1));
  const stale = inputHistoryFrame({ audio: true, status: { sampleRate: 48000, elapsedSeconds: 3.9,
    inputEnvelope: { interval: .1, endTime: 3.9, values: [.9] } } }, first, 200);
  assert.equal(stale.envelope, envelope);
  const stopped = inputHistoryFrame({ audio: false, status: { sampleRate: 0, elapsedSeconds: 0 } }, stale, 300);
  assert.equal(stopped.envelope, null);
  assert.equal(stopped.reader, null);
});

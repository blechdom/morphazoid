import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { RubixoidsClock } from '../src/instruments/rubixoids/clock.js';

const source = await readFile(new URL('../src/instruments/rubixoids/hyper-rubix/hyper-rubix-app.js', import.meta.url), 'utf8');
function region(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const finish = source.indexOf(end, offset);
  assert.ok(finish > offset, end);
  return source.slice(offset, finish);
}
const helpers = [
  region('function clockGridOptions()', 'function normalizedLoopPosition('),
  region('function straightStepBoundary(', 'function alignWebGpu303Phase('),
  region('function alignWebGpu303Phase(', 'function realignRunningWebGpu303Phase('),
  region('function nextPositionAfterAudiblePulse()', 'function resumeTransportClock('),
].join('\n');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≈ ${b}`);
function fixture({ voice = 'pulse', division = 2, position = 0, swing = .2 } = {}) {
  let wall = 10;
  const clock = new RubixoidsClock({ now: () => wall, tempo: 120, swing });
  clock.play({ leadSeconds: 0 });
  const sandbox = {
    rubixoidsClock: clock, state: { voice, subdivisionsPerBeat: division, swing, tempo: 120 },
    transportPosition: position, nextClockGrid: null, scheduledClockPulses: [],
    lastElapsedClockPulse: null, lastClockAlignment: null, webGpu303SequencePhase: 0,
    activePlaybackNoteCount: () => 27, isWebGpu303Preset: () => sandbox.state.voice === 'webgpu-303',
    clamp: (value, lo, hi) => Math.min(hi, Math.max(lo, value)),
  };
  vm.createContext(sandbox);
  vm.runInContext(helpers, sandbox);
  return { clock, sandbox, advance(seconds) { wall += seconds; } };
}

test('Hyper WebGPU rejoins a matching common swing half with at most one extra pulse', () => {
  for (const division of [1, 2, 4, 8, 16]) for (const swing of [0, .2, .42]) for (const position of [0, 1, 26, 27]) {
    const { clock, sandbox, advance } = fixture({ voice: 'webgpu-303', division, position, swing });
    advance(.173);
    const minTime = clock.now() + .012;
    const first = clock.next({ division, minTime });
    const selected = sandbox.selectNextClockGrid(minTime);
    assert.equal(selected.ordinal % 2, position % 2);
    assert.ok(selected.ordinal === first.ordinal || selected.ordinal === first.ordinal + 1);
    assert.equal(sandbox.lastClockAlignment.waitPulses, selected.ordinal - first.ordinal);
    assert.equal(sandbox.transportPosition, position, 'waiting must not consume a parked score note');
    close(selected.time, clock.grid(selected.ordinal, { division }).time);
  }
});

test('ordinary Hyper voices join the next grid pulse without a WebGPU parity wait', () => {
  for (const position of [0, 1, 27]) {
    const { clock, sandbox } = fixture({ position });
    const minTime = clock.now() + .012;
    assert.equal(sandbox.selectNextClockGrid(minTime).ordinal, clock.next({ division: 2, minTime }).ordinal);
    assert.equal(sandbox.lastClockAlignment.waitPulses, 0);
  }
});

test('Hyper parked score recovery follows scheduled audio time even when visuals and wall time lag', () => {
  const { clock, sandbox, advance } = fixture();
  const audioContext = { state: 'running', currentTime: 0 };
  clock.attach('4d', audioContext);
  sandbox.scheduledClockPulses = [
    { time: 10.05, position: 6 }, { time: 10.2, position: 7 }, { time: 10.3, position: 8 },
  ];
  sandbox.transportPosition = 9;
  sandbox.transportVisualPosition = 1000;
  advance(12);
  audioContext.currentTime = .1;
  assert.equal(sandbox.nextPositionAfterAudiblePulse(), 7);
  audioContext.currentTime = .21;
  assert.equal(sandbox.nextPositionAfterAudiblePulse(), 8);
  sandbox.retainElapsedClockPulse();
  assert.equal(sandbox.scheduledClockPulses.length, 1);
  assert.equal(sandbox.scheduledClockPulses[0].position, 7);
  assert.equal(sandbox.nextPositionAfterAudiblePulse(), 8);
});

test('Hyper WebGPU phase comes from clock-stamped pulses and retains odd-length swing parity', () => {
  const { clock, sandbox, advance } = fixture({ voice: 'webgpu-303', position: 27 });
  const pulse = clock.grid(5, { division: 2 });
  sandbox.scheduledClockPulses = [{ ...pulse, position: 27 }];
  advance(pulse.time - clock.now() + .05);
  sandbox.transportVisualPosition = 0;
  sandbox.transportVisualStartedAtMs = -999999;
  close(sandbox.webGpu303StraightPhaseAtDelay(), 27.4);
  close(sandbox.alignWebGpu303Phase({ straightPhase: 27.2, playbackTime: 0 }), 27.2);
  close(sandbox.alignWebGpu303Phase({ straightPhase: 81.2, playbackTime: 0 }), 27.2);
});

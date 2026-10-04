import test from 'node:test';
import assert from 'node:assert/strict';
import { PROCESSING_SCHEMA } from '../src/instruments/synthesis/processing-schema.js';
import { PROCESSING_DATA } from '../src/instruments/synthesis/processing-catalog.js';
import { PROCESSOR_METHODS, getMethod, parameterValue } from '../src/instruments/synthesis/catalog.js';
import { SYNTHESIS_DATES } from '../src/instruments/synthesis/chronology.js';

test('spectral processor appends stable IDs and declares actual DSP latency and mode-specific controls', () => {
  const method = getMethod('fx-spectral');
  const schema = PROCESSING_SCHEMA.methods.find(item => item.id === 'spectral');
  assert.equal(method.id, 'fx-spectral');
  assert.equal(method.processorId, 16);
  assert.equal(PROCESSOR_METHODS.length, 17);
  assert.equal(method.latencyFrames, 1024);
  assert.equal(schema.fftSize, 1024);
  assert.equal(schema.hopFrames, 256);
  assert.deepEqual(schema.params[0].choices, ['Resynthesis', 'Spectral gate', 'Freeze', 'Spectral tilt']);
  assert.deepEqual(schema.params.slice(1).map(item => item.modes), [[1], [1], [1, 3], [3]]);
  assert.equal(SYNTHESIS_DATES[method.id].dateLabel, '1976');
  assert.match(SYNTHESIS_DATES[method.id].dateNote, /not the invention date/);
});

test('eight specific spectral presets span all four modes with legal normalized values', () => {
  const method = getMethod('fx-spectral');
  const data = PROCESSING_DATA.find(item => item.id === 'spectral');
  assert.equal(data.presets.length, 8);
  assert.equal(new Set(data.presets.map(item => item.id)).size, 8);
  assert.deepEqual([...new Set(data.presets.map(item => Math.round(item.params[0] * 3)))].sort(), [0, 1, 2, 3]);
  for (const preset of data.presets) {
    assert.equal(preset.params.length, 16);
    assert.ok(preset.params.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(preset.source > 0 && preset.source < PROCESSING_SCHEMA.sources.length);
    assert.ok(preset.cue.length > 40);
    for (const control of method.controls) {
      const physical = parameterValue(control, preset.params[control.index]);
      assert.ok(physical >= control.min && physical <= control.max);
    }
  }
});

test('new noise fixtures append source IDs without renumbering existing material', () => {
  assert.deepEqual(PROCESSING_SCHEMA.sources.slice(0, 8), ['External input', 'Sine', 'Two-tone', 'Noise', 'Impulse train', 'Pulse / saw', 'Drum pattern', 'Voiced phrase']);
  assert.deepEqual(PROCESSING_SCHEMA.sources.slice(8), ['Pink noise', 'Brown noise', 'Gaussian white noise']);
  const spectral = PROCESSING_DATA.find(item => item.id === 'spectral');
  assert.ok(spectral.limitations.some(text => /bounded approximations/.test(text)));
  assert.ok(spectral.limitations.some(text => /procedural/.test(text)));
});

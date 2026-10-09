import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiphoriaRenderer, MAX_MIDIPHORIA_TRAILS } from '../src/instruments/midiphoria/midiphoria-renderer.js';
import { DEFAULT_VISUALS } from '../src/instruments/midiphoria/midiphoria-model.js';

function surface() {
  const commands = [], strokes = [];
  const context = { createRadialGradient: () => ({ addColorStop() {} }) };
  for (const name of ['setTransform', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'fill',
    'fillText', 'bezierCurveTo', 'clearRect', 'save', 'restore', 'transform', 'translate', 'drawImage', 'rect', 'clip']) {
    context[name] = (...args) => commands.push([name, ...args]);
  }
  context.stroke = () => strokes.push({ color: context.strokeStyle, width: context.lineWidth });
  const canvas = { width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ width: 960, height: 540 }),
    ownerDocument: { createElement: () => surface().canvas } };
  return { canvas, context, commands, strokes };
}
const event = (id, type = 'noteOn', time = 0, channel = 0) => ({ id, type, time, channel,
  sourceId: 'file', note: 60, velocity: 100 });
const idle = { activeNotes: [], level: 0, rgb: [0, 0, 0] };

test('every brief attack survives between snapshots and equal-pitch retriggers have independent trails', () => {
  const renderer = new MidiphoriaRenderer(surface().canvas);
  for (let id = 0; id < 200; id++) {
    renderer.captureEvent(event(id, 'noteOn', id / 10000));
    renderer.captureEvent(event(id, 'noteOff', id / 10000 + .00001));
  }
  renderer.capture(idle, .05);
  assert.equal(renderer.capturedNotes, 200);
  assert.equal(renderer.trails.length, 200);
  assert.equal(new Set(renderer.trails.map(note => note.id)).size, 200);
  assert.equal(renderer.held.size, 0);
  assert.equal(renderer.droppedTrails, 0);
});

test('512 simultaneous attacks remain distinct; visual solo preserves all captured voices', () => {
  const renderer = new MidiphoriaRenderer(surface().canvas);
  for (let id = 0; id < 512; id++) renderer.captureEvent({ ...event(id, 'noteOn', 0, id % 16), note: id % 128 });
  assert.equal(renderer.held.size, 512); assert.equal(renderer.trails.length, 512);
  assert.equal(renderer.getVoices().length, 16);
  const id = renderer.getVoices()[0].id;
  renderer.focusVoice(id); renderer.configure({ voiceLayout: 'panels' });
  renderer.draw(idle, .2, DEFAULT_VISUALS);
  assert.equal(renderer.voiceFocus, id); assert.equal(renderer.trails.length, 512);
  renderer.focusVoice(null); assert.equal(renderer.voiceFocus, null);
  for (let id = 0; id < 512; id++) renderer.captureEvent(event(id, 'noteOff', 1, id % 16));
  assert.equal(renderer.held.size, 0);
  assert.ok(renderer.getVoices().every(voice => !voice.active));
});

test('dense history stays bounded, keeps current notes, and expires released history', () => {
  const renderer = new MidiphoriaRenderer(surface().canvas);
  renderer.captureEvent(event(-1));
  for (let id = 0; id < MAX_MIDIPHORIA_TRAILS + 100; id++) {
    renderer.captureEvent(event(id)); renderer.captureEvent(event(id, 'noteOff'));
  }
  assert.equal(renderer.trails.length, MAX_MIDIPHORIA_TRAILS);
  assert.equal(renderer.droppedTrails, 101);
  assert.equal(renderer.held.size, 1); assert.ok(renderer.trails.some(note => note.id === -1));
  renderer.capture(idle, 20);
  assert.equal(renderer.trails.length, 1);
  renderer.clear(); assert.equal(renderer.trails.length, 0); assert.equal(renderer.getVoices().length, 0);
});

test('voice colors stay stable across pitch, palette and moving hue; panels clip each voice separately', () => {
  const { canvas, commands, strokes } = surface(), renderer = new MidiphoriaRenderer(canvas);
  renderer.configure({ colorSource: 'voice', voiceLayout: 'overlay', glow: 0 });
  renderer.captureEvent(event(1)); renderer.captureEvent(event(2, 'noteOn', 0, 1));
  renderer.draw({ ...idle, hueOffset: .1 }, .5, DEFAULT_VISUALS);
  const firstColors = strokes.filter(stroke => stroke.width !== 1).map(stroke => stroke.color);
  assert.equal(new Set(firstColors).size, 2);
  strokes.length = 0;
  renderer.configure({ palette: 'candy', hueOffset: 190 });
  renderer.draw({ ...idle, hueOffset: .7 }, .5, DEFAULT_VISUALS);
  assert.deepEqual(strokes.filter(stroke => stroke.width !== 1).map(stroke => stroke.color), firstColors);
  renderer.configure({ voiceLayout: 'panels' }); commands.length = 0;
  renderer.draw(idle, .6, DEFAULT_VISUALS);
  assert.equal(commands.filter(command => command[0] === 'clip').length, 2);
  assert.equal(commands.filter(command => command[0] === 'fillText' && command[1].startsWith('Ch ')).length, 2);
});


test('the full 8192-note history renders every note with bounded dense orbit geometry', () => {
  const { canvas, commands, strokes } = surface(), renderer = new MidiphoriaRenderer(canvas);
  renderer.configure({ view: 'orbit', voiceLayout: 'overlay', symmetry: 8, flow: 'inward', glow: 1 });
  for (let id = 0; id < MAX_MIDIPHORIA_TRAILS; id++) {
    renderer.captureEvent(event(id)); renderer.captureEvent(event(id, 'noteOff', .001));
  }
  renderer.draw(idle, .2, DEFAULT_VISUALS);
  assert.equal(renderer.trails.length, MAX_MIDIPHORIA_TRAILS);
  assert.equal(strokes.length, MAX_MIDIPHORIA_TRAILS + 4, 'one stroke per note plus the four grid strokes');
  assert.ok(commands.length < MAX_MIDIPHORIA_TRAILS * 20 + 100);
  assert.ok(commands.flat().filter(value => typeof value === 'number').every(Number.isFinite));
});


test('song replacement clears stale file focus and all file ports while preserving live inputs', () => {
  const renderer = new MidiphoriaRenderer(surface().canvas);
  renderer.captureEvent({ ...event(1), sourceId: 'midiphoria:file', channel: 3 });
  renderer.captureEvent({ ...event(2), sourceId: 'midiphoria:file:port:2', channel: 3 });
  renderer.captureEvent({ ...event(3), sourceId: 'live', channel: 0 });
  renderer.focusVoice(renderer.getVoices()[1].id);
  renderer.clearSource('midiphoria:file', true);
  assert.equal(renderer.voiceFocus, null);
  assert.deepEqual(renderer.trails.map(note => note.sourceId), ['live']);
  assert.equal(renderer.held.size, 1);
  renderer.captureEvent({ ...event(4), sourceId: 'midiphoria:file', channel: 1 });
  assert.deepEqual(renderer.getVoices().map(voice => voice.channel), [0, 1]);
});

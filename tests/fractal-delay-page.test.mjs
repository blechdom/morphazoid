import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { INSTRUMENTS } from '../src/site/instrument-catalog.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('Fractal Delay is one canonical instrument with all five playable mappings', async () => {
  const html = await read('src/pages/fractal-delay.html');
  assert.equal(CANONICAL_PAGE_ROUTES.filter(route => route === 'fractal-delay.html').length, 1);
  const mode = html.match(/<select\b[^>]*id=["']mode["'][^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(mode, 'one labelled mathematical mapping select is required');
  const values = [...mode.matchAll(/<option\b[^>]*value=["']([^"']+)["']/g)].map(match => match[1]);
  assert.deepEqual(values.sort(), ['inverse', 'contours', 'orbits', 'rays', 'membrane'].sort());
  for (const id of ['audioButton', 'sourceMode', 'sampleSelect', 'fileInput', 'mode', 'cReal', 'cImag',
    'detail', 'timeMs', 'pitchOffset', 'decay', 'coupling', 'pickup', 'inputDriveDb', 'dry', 'delayGainDb',
    'propagation', 'geometryPitch', 'tapCoverage', 'turnTone', 'sendPulse', 'stage', 'presetSelect']) {
    assert.equal([...html.matchAll(new RegExp(`id=["']${id}["']`, 'g'))].length, 1, `#${id} needs one authoritative control`);
  }
  const stage = html.match(/<canvas\b[^>]*id=["']stage["'][^>]*>/)?.[0];
  assert.match(stage, /tabindex=["']0["']/);
  assert.match(stage, /aria-label=["'][^"']+["']/);
  assert.match(html, /src=["'](?:\.\/)?src\/instruments\/fractal-delay\/app\.js(?:\?[^"']*)?["']/);
  assert.doesNotMatch(html, /localhost:\d+|127\.0\.0\.1|requires?\s+(?:a\s+)?(?:native|local)\s+(?:audio|server)/i);
});

test('Fractal Delay reuses the existing input lifecycle and shared input controls', async () => {
  const [app, engine] = await Promise.all([
    read('src/instruments/fractal-delay/app.js'), read('src/instruments/fractal-delay/browser-engine.js'),
  ]);
  assert.match(app, /mountAudioInputControl/);
  assert.match(engine, /(?:from|import)[^\n]*micmic\/native\/input-source\.js/);
  assert.match(app + engine, /SAMPLE_INPUT_OPTIONS/);
  assert.doesNotMatch(engine, /createScriptProcessor\s*\(/);
  assert.doesNotMatch(engine, /(?:fetch|WebSocket)\([^\n]*(?:localhost|127\.0\.0\.1)/);
});

test('Fractal Delay navigation and catalogue refer to the same real browser page', async () => {
  const tools = TOOL_GROUPS.flatMap(group => group.tools).filter(tool => tool.id === 'fractal-delay');
  assert.equal(tools.length, 1); assert.equal(tools[0].href, 'fractal-delay.html');
  const records = INSTRUMENTS.filter(record => record.id === 'fractal-delay');
  assert.equal(records.length, 1); assert.equal(records[0].href, 'fractal-delay.html');
  assert.ok(records[0].imageHref.endsWith('.webp'));
  await access(new URL(records[0].imageHref, root));
});

test('Fractal Delay runtime assets are explicitly included in the release manifest', async () => {
  const manifest = await read('scripts/site/runtime-files.tsv');
  for (const path of ['fractal-delay.html', 'src/instruments/fractal-delay/app.js',
    'src/instruments/fractal-delay/browser-engine.js']) {
    assert.ok(manifest.split('\n').some(line => line.split('\t').includes(path)), `${path} must be published`);
  }
});

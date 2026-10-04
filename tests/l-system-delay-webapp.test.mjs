import '../src/instruments/micmic/native/branch-travel.test.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { nativeDelaySiteChanges, restoreNativeDelaySite } from './helpers/native-delay-site-reference.mjs';
import { restoreSynthesaurusFavesOrder } from './helpers/synthesaurus-faves-order-reference.mjs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INSTRUMENTS } from '../src/site/instrument-catalog.js';
import { FAVE_TOOL_IDS, TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { instrumentIdForRouteName } from '../src/site/instrument-identities.js';
import { instrumentMidiCapabilityForId } from '../src/site/instrument-midi-capabilities.js';
import { waxSupportForId } from '../src/instruments/wax/wax-instrument-roles.js';
import { readRuntimeManifest } from '../scripts/site/runtime-manifest.mjs';
import { CANONICAL_PAGE_ROUTES } from '../src/pages/manifest.js';
import { installBrowserMidiAdapter } from '../src/browser-midi-adapter.js';

import '../src/instruments/micmic/native/model.test.mjs';

test('Rust delay is a separate Morphazoid route beside the preserved original', async () => {
  assert.ok(CANONICAL_PAGE_ROUTES.includes('l-mic-rust.html'));
  const tools = TOOL_GROUPS.find(group => group.id === 'audio-effect').tools;
  const original = tools.findIndex(tool => tool.id === 'micmic');
  assert.equal(tools[original].href, 'l-mic.html');
  assert.equal(tools[original + 1].id, 'micmic-rust');
  assert.equal(tools[original + 1].href, 'l-mic-rust.html');
  assert.ok(FAVE_TOOL_IDS.includes('micmic-rust'));
  const record = INSTRUMENTS.find(instrument => instrument.id === 'micmic-rust');
  assert.match(record.description, /Rust CPAL/);
  assert.equal(record.imageHref, 'assets/instruments/micmic.webp');
  assert.equal(instrumentIdForRouteName('l-mic-rust'), 'micmic-rust');
  assert.equal(waxSupportForId('micmic-rust').available, false);
  assert.deepEqual(waxSupportForId('micmic-rust').roles, []);
  assert.match(waxSupportForId('micmic-rust').caveat, /does not connect to WAX audio buses/);
});

test('canonical native page uses public assets and owns its device lifecycle', async () => {
  const html = await readFile(new URL('../src/pages/l-mic-rust.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/instruments/micmic/native/app.js', import.meta.url), 'utf8');
  const nav = await readFile(new URL('../nav.js', import.meta.url), 'utf8');
  assert.match(html, /data-audio-backend="native-cpal"/);
  assert.match(html, /href="\.\/"/);
  assert.match(html, /href="l-mic-rust.html"/);
  assert.match(html, /src="src\/instruments\/micmic\/native\/app.js"/);
  assert.doesNotMatch(html + app, /localhost:343[567]|nativeNavigationData|\/original-style\.css/);
  assert.match(app, /api\/l-system-delay\//);
  assert.match(app, /new URL\('\.\/presets\.json', import.meta.url\)/);
  assert.match(app, /new URL\(tool.href, SITE_ROOT\)/);
  assert.match(nav, /audioBackend !== "native-cpal"/);
  const inventory = await readRuntimeManifest();
  for (const file of ['app.js', 'model.js', 'style.css', 'presets.json']) {
    assert.ok(inventory.worktreeFiles.includes(`src/instruments/micmic/native/${file}`), file);
    assert.ok(inventory.requiredFiles.includes(`src/instruments/micmic/native/${file}`), file);
  }
});

test('native hardware MIDI controls do not arm CPAL or take over page keys', () => {
  const support = instrumentMidiCapabilityForId('micmic-rust');
  assert.equal(support.noteMode, 'processor');
  assert.equal(support.startsAudio, false);
  assert.equal(support.computerKeyboardMode, 'page');
  assert.equal(support.midiOutput, false);
  const clients = [];
  const runtime = { addEventListener() {}, removeEventListener() {} };
  const doc = { querySelector(selector) {
    if (selector.startsWith('script[')) return null;
    throw new Error('MIDI preparation must not look for an Audio button');
  } };
  const adapter = installBrowserMidiAdapter(runtime, doc, {
    routeId: 'micmic-rust', manager: { registerClient(client) { clients.push(client); return () => {}; } },
  });
  assert.equal(clients.length, 1);
  assert.equal(clients[0].computerKeyboard, false);
  clients[0].onPrepareEnable();
  adapter.dispose();
});

test('native proxy routing and origin rejection pass without native devices', () => {
  execFileSync('python3', [fileURLToPath(new URL('./l-system-delay-proxy.test.py', import.meta.url))], { stdio: 'pipe' });
});

test('native site additions reverse exactly without rewriting earlier layout evidence', async () => {
  for (const change of nativeDelaySiteChanges.changes) {
    const source = await readFile(new URL('../' + change.file, import.meta.url), 'utf8');
    const restored = restoreSynthesaurusFavesOrder(restoreNativeDelaySite(source, change.file), change.file);
    assert.equal(createHash('sha256').update(restored).digest('hex'), change.sha256, change.file);
    for (const file of change.regressionTests) await readFile(new URL('../' + file, import.meta.url));
    for (const replacement of change.replacements) {
      assert.throws(() => restoreNativeDelaySite(source.replace(replacement.after, ''), change.file), /exact native delay site amendment/);
      assert.throws(() => restoreNativeDelaySite(source + replacement.after, change.file), /exact native delay site amendment/);
    }
  }
});

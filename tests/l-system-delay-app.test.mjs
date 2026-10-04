import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { createSiteBuilderHarness, fileHashes } from './helpers/site-builder-harness.mjs';

test('Rust device code stays private while native browser controls publish', async () => {
  const fixture = await createSiteBuilderHarness();
  const native = ['index.html', 'private-controller.js', 'private-style.css'].map(name =>
    `src/instruments/micmic/rust/app/ui/${name}`);
  const browser = 'src/instruments/micmic/native/browser-fixture.js';
  try {
    for (const file of [...native, browser]) await fixture.write(file, `fixture:${file}\n`);
    await promisify(execFile)('git', ['add', '--', ...native, browser], { cwd: fixture.directory });
    const result = await fixture.build('current');
    assert.equal(result.code, 0, result.stderr);
    const published = await fileHashes(result.output);
    for (const file of native) assert.equal(published[file], undefined, file);
    assert.equal(await readFile(path.join(result.output, browser), 'utf8'), `fixture:${browser}\n`);
  } finally {
    await fixture.cleanup();
  }
});

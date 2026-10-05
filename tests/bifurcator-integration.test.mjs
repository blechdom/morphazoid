import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { FAVE_TOOL_IDS, TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { bifurcatorSiteChanges, restoreBifurcatorSite } from './helpers/bifurcator-site-reference.mjs';

test('Bifurcator metadata preserves genuine remote-main source and rejects unrelated amendments', async () => {
  assert.equal(bifurcatorSiteChanges.baseCommit, '1c8cd0d98e4144450308c04511f57bb75d9a2313');
  assert.deepEqual(bifurcatorSiteChanges.changes.map(change => change.file), [
    'src/site/instrument-registry.js', 'src/site/instrument-catalog.js',
    'src/site/catalogue-taxonomy.js', 'src/site/instrument-midi-capabilities.js',
  ]);
  for (const change of bifurcatorSiteChanges.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), 'utf8');
    assert.notEqual(restoreBifurcatorSite(source, change.file), source);
    const preserved = value => assert.equal(createHash('sha256').update(restoreBifurcatorSite(value, change.file)).digest('hex'), change.sha256, 'pre-Bifurcator source preserved');
    preserved(source);
    for (const replacement of change.replacements) {
      assert.match(replacement.after, /bifurcator/);
      assert.throws(() => restoreBifurcatorSite(source.replace(replacement.after, ''), change.file), /exact Bifurcator amendment/);
      assert.throws(() => restoreBifurcatorSite(source + replacement.after, change.file), /exact Bifurcator amendment/);
    }
    assert.throws(() => preserved(source + '\n// unrelated drift\n'), /pre-Bifurcator source preserved/);
    for (const file of change.regressionTests) await readFile(new URL(`../${file}`, import.meta.url));
  }
  assert.equal(restoreBifurcatorSite('untouched', 'unrelated.js'), 'untouched');
});

test('Bifurcator is an ordinary Synthesizer beside Chaotic PM and stays outside Faves', () => {
  const groups = TOOL_GROUPS.filter(group => group.tools.some(tool => tool.id === 'bifurcator'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'synthesizer');
  const ids = groups[0].tools.map(tool => tool.id);
  assert.equal(ids.indexOf('bifurcator'), ids.indexOf('chaotic-pm') + 1);
  assert.equal(FAVE_TOOL_IDS.includes('bifurcator'), false);
});

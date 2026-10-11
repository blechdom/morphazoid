import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseSoundFont } from '../src/site/sound-fonts/soundfont.js';

const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('assets/sound-fonts/catalog.json',root),'utf8'));
const provenance=JSON.parse(await readFile(new URL('assets/sound-fonts/provenance.json',root),'utf8'));

test('shipped banks retain exact upstream bytes, playable zones and distribution notices',async()=>{
  assert.equal(new Set(catalog.map(bank=>bank.id)).size,catalog.length);
  for(const bank of catalog) {
    const data=await readFile(new URL(bank.file,root));
    assert.equal(data.byteLength,bank.bytes,bank.name);
    assert.equal(createHash('sha256').update(data).digest('hex'),bank.sha256,bank.name);
    const font=parseSoundFont(data);
    assert.equal(font.presets.length,bank.presetCount,bank.name);
    assert.ok(font.presets.every(preset=>preset.zones.length>0),`${bank.name} presets playable`);
    assert.ok(font.presets.some(preset=>preset.zones.some(zone=>zone.lowKey<=60&&zone.highKey>=60)),`${bank.name} middle C`);
    assert.ok((await readFile(new URL(bank.creditFile,root),'utf8')).length>100);
    const license=await readFile(new URL(bank.licenseFile,root),'utf8');
    assert.match(license,bank.license==='CC0-1.0'?/CC0 1.0 Universal/:/GNU GENERAL PUBLIC LICENSE/);
    assert.match(bank.sourceUrl,/^https:\/\//);
    assert.ok(bank.attribution.length>20);
    if(bank.license==='CC0-1.0') {
      const source=provenance.banks.find(value=>value.id===bank.id);
      assert.equal(source.sha256,bank.sha256);
      assert.match(source.downloadUrl,/^https:\/\//);
      assert.equal(source.archiveSha256.length,64);
    }
  }
});

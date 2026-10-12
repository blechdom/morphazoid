import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseSoundFont } from '../src/site/sound-fonts/soundfont.js';

const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('assets/sound-fonts/catalog.json',root),'utf8')).filter(bank=>!['generaluser-gs','fluidr3mono-gm','fluidr3-gm'].includes(bank.id));
const provenance=JSON.parse(await readFile(new URL('assets/sound-fonts/provenance.json',root),'utf8'));

test('the five starter banks retain exact upstream bytes, playable zones and distribution notices',async()=>{
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

test('all 140 Explore presets identify exact bank programs and cover their complete keyboard',async()=>{
  const explorerIds=new Set();
  let presetCount=0;
  const address=preset=>`${preset.bank}:${preset.program}`;
  const readableLabel=(value,label)=>{
    assert.equal(typeof value,'string',label);
    assert.equal(value,value.trim(),`${label}: no surrounding whitespace`);
    assert.ok(value.length>=2&&value.length<=100,`${label}: useful readable length`);
    assert.doesNotMatch(value,/[\u0000-\u001f\u007f]/,`${label}: no control characters`);
  };
  for(const bank of catalog) {
    assert.ok(Array.isArray(bank.presets),`${bank.id}: Explore presets are declared`);
    const font=parseSoundFont(await readFile(new URL(bank.file,root)));
    const actualByAddress=new Map(font.presets.map(preset=>[address(preset),preset]));
    assert.equal(actualByAddress.size,font.presets.length,`${bank.id}: source bank/program identifiers are unique`);
    assert.equal(bank.presets.length,font.presets.length,`${bank.id}: every parsed preset is exposed`);
    assert.equal(bank.presets.length,bank.presetCount,`${bank.id}: advertised preset count`);
    const catalogAddresses=new Set();
    for(const preset of bank.presets) {
      const id=`${bank.id}:${address(preset)}`;
      assert.ok(Number.isInteger(preset.bank)&&preset.bank>=0&&preset.bank<=16383,`${id}: valid bank`);
      assert.ok(Number.isInteger(preset.program)&&preset.program>=0&&preset.program<=127,`${id}: valid program`);
      assert.ok(!explorerIds.has(id),`${id}: unique Explore identifier`);
      explorerIds.add(id);
      catalogAddresses.add(address(preset));
      const actual=actualByAddress.get(address(preset));
      assert.ok(actual,`${id}: bank/program exists in the downloaded SF2`);
      assert.equal(preset.name,actual.name,`${id}: preserve the SF2's native preset name`);
      readableLabel(preset.displayName,`${id}: display name`);
      readableLabel(preset.family,`${id}: instrument family`);
      assert.ok(Number.isInteger(preset.keyboardBase)&&preset.keyboardBase>=0&&preset.keyboardBase<=99,`${id}: both chromatic rows stay inside MIDI 0–127`);
      assert.ok(Number.isInteger(preset.previewNote)&&preset.previewNote>=0&&preset.previewNote<=127,`${id}: valid preview note`);
      const playable=note=>actual.zones.some(zone=>
        note>=zone.lowKey&&note<=zone.highKey&&95>=zone.lowVelocity&&95<=zone.highVelocity
        &&font.samples[zone.sampleIndex]?.data.length>0,
      );
      assert.ok(playable(preset.previewNote),`${id}: preview note ${preset.previewNote} has a sampled zone at velocity 95`);
      // Each physical row spans 17 semitones; the upper row starts one octave
      // higher, so their overlap leaves 29 distinct notes that must all sound.
      for(let offset=0;offset<=28;offset+=1) {
        const note=preset.keyboardBase+offset;
        assert.ok(playable(note),`${id}: keyboard note ${note} has a sampled zone at velocity 95`);
      }
      presetCount+=1;
    }
    assert.deepEqual([...catalogAddresses].sort(),[...actualByAddress.keys()].sort(),`${bank.id}: exact preset coverage`);
  }
  assert.equal(presetCount,140,'the starter Explore library exposes all 140 downloaded presets');
  assert.equal(explorerIds.size,presetCount,'bank IDs disambiguate identical bank/program numbers across fonts');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultScene,validateScene} from '../src/instruments/voicesaurus/native-model.js';
import {textPresetsForEngine,singingSceneFromTextPreset,ENGLISH_TEXT_PRESETS,JAPANESE_TEXT_PRESETS} from '../src/instruments/voicesaurus/text-presets.js';
import {parseSpellingPronunciations} from '../src/instruments/spelling-synthesizer/spelling-pronunciation.js';
const words=ENGLISH_TEXT_PRESETS.flatMap(preset=>preset.text.split(/\s+/));
const pronunciations=parseSpellingPronunciations(await readFile(new URL('../vendor/cmudict/cmudict-en-us.dict',import.meta.url),'utf8'),words);

test('text menu contains the requested exact phrases and native Japanese alternatives',()=>{
 for(const text of ['daisy daisy give me your answer please','do you really want to go to the moon','pbpbpbpbpb shshshththththt s s s pl pl pl pl zzz gggg ghesghzhzhgh','i love you'])assert.ok(ENGLISH_TEXT_PRESETS.some(preset=>preset.text===text));
 assert.equal(textPresetsForEngine('sinsy'),JAPANESE_TEXT_PRESETS);
 assert.deepEqual(textPresetsForEngine('mea8000',{textCapable:false}),[]);
});
test('reselecting a text preset preserves its pitch register and complete phrase',async()=>{
 for(const engine of ['singer','sinsy'])for(const preset of textPresetsForEngine(engine)){
  const first=await singingSceneFromTextPreset(defaultScene(engine),preset,{pronunciations});
  const again=await singingSceneFromTextPreset(first.scene,preset,{pronunciations});
  assert.deepEqual(again.scene,first.scene,`${engine}/${preset.id}`);
 }
});
for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim','sample-bank','sinsy'])test(`${engine}: text presets prepare complete native phrases with authored pitch and rhythm`,async()=>{
 for(const preset of textPresetsForEngine(engine)){
  const scene=defaultScene(engine),before=structuredClone(scene),result=await singingSceneFromTextPreset(scene,preset,{pronunciations});
  assert.deepEqual(scene,before);assert.deepEqual(result.scene.values,scene.values);assert.deepEqual(validateScene(result.scene),result.scene);
  assert.equal(result.scene.input.singingText,preset.text);
  const notes=result.scene.input.phrase?.notes??result.scene.input.notes;
  assert.ok(notes.length>=3&&notes.length<=62,preset.id);
  const pitches=notes.filter(note=>!note.rest).map(note=>engine==='sinsy'?note.midi:note.values.pitch);
  assert.ok(new Set(pitches).size>=3,preset.id);
  const seconds=notes.reduce((sum,note)=>sum+(engine==='sinsy'?note.beats*60/preset.tempo:note.values.duration),0);
  const expected=preset.contour.reduce((sum,note)=>sum+note.beats*60/preset.tempo,0);
  assert.ok(Math.abs(seconds-expected)<1e-8,`${preset.id}: rhythmic contour retained`);
 }
});

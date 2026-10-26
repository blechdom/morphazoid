import test from 'node:test';
import assert from 'node:assert/strict';
import { WITCH_DEFAULTS, WITCH_PRESETS, WITCH_SETTING_PRESETS, normalizeWitchPreset, witchPresetSettings, randomizeWitchPreset, WITCH_PALETTES } from '../src/instruments/witch/witch-presets.js';
import { validateFullPresetBank } from '../src/site/header-presets.js';
import { WITCH_VOICES, witchVoiceAtHeight, WITCH_SHELF, WITCH_TREE_OBJECTS, WITCH_CUPBOARD_TOP, WITCH_WEB_OBJECTS, WITCH_INGREDIENTS, WITCH_HAND_MOTIONS, WITCH_HAND_SOUNDS, WITCH_CAT_GAITS, witchHandConfig } from '../src/instruments/witch/witch-model.js';
import { TOOL_GROUPS } from '../src/site/instrument-registry.js';
import { existsSync } from 'node:fs';
import { instrumentById } from '../src/site/instrument-catalog.js';

test('every complete Witch scene survives recall without bringing transport or output state',()=>{
  validateFullPresetBank(WITCH_PRESETS);
  for(const {snapshot} of WITCH_PRESETS) {
    assert.deepEqual(normalizeWitchPreset(snapshot),snapshot);
    assert.equal('volume' in snapshot,false);assert.equal('gate' in snapshot,false);assert.equal('playing' in snapshot,false);
    assert.equal('ghostPhase' in snapshot,false);assert.equal('performanceTime' in snapshot,false);
    assert.equal('fabricPull' in snapshot,false);assert.equal('fabricVelocity' in snapshot,false);
    assert.ok(snapshot.ghostTempo>=36&&snapshot.ghostTempo<=180);
    const recalled=normalizeWitchPreset(snapshot);recalled.fingers[0]=.123;
    assert.notEqual(recalled.fingers[0],snapshot.fingers[0]);
  }
});

test('header snapshots recall complete settings independently of legacy stirring and flight modes',()=>{
  validateFullPresetBank(WITCH_SETTING_PRESETS);
  for(const [index,{snapshot}] of WITCH_SETTING_PRESETS.entries()) {
    assert.equal('scene' in snapshot,false);
    assert.deepEqual(snapshot,witchPresetSettings(WITCH_PRESETS[index].snapshot));
    for(const scene of ['brew','fingers','flight']) {
      const recalled=normalizeWitchPreset({...snapshot,scene});
      assert.equal(recalled.scene,scene);
      assert.deepEqual(witchPresetSettings(recalled),snapshot);
    }
    assert.notEqual(snapshot.fingers,WITCH_PRESETS[index].snapshot.fingers);
  }
});

test('a small minority of presets leave stirring or fingers to the player; old saves keep automation',()=>{
  for(const key of ['stirAuto','handAuto']) {
    for(const value of [undefined,null,0,'false'])assert.equal(normalizeWitchPreset({[key]:value})[key],true);
    assert.equal(normalizeWitchPreset({[key]:false})[key],false);
    const manual=WITCH_PRESETS.filter(({snapshot})=>!snapshot[key]);
    assert.ok(manual.length>=2&&manual.length<WITCH_PRESETS.length*.2);
    if(key==='stirAuto')assert.ok(manual.every(({snapshot})=>!snapshot.spoonAuto));
  }
  assert.ok(WITCH_PRESETS.filter(({snapshot})=>snapshot.stirAuto&&snapshot.handAuto).length>WITCH_PRESETS.length*.75);
  assert.equal('stirring' in witchPresetSettings({stirring:true}),false,'a live gesture is never saved');
});

test('randomization preserves the chosen mode and reaches every character, direction and continuous setting within bounds',()=>{
  let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const modes=['brew','fingers','flight'];
  const scenes=Array.from({length:150},(_,i)=>randomizeWitchPreset({...WITCH_DEFAULTS,scene:modes[i%3]},random));
  scenes.forEach((snapshot,i)=>assert.equal(snapshot.scene,modes[i%3]));
  assert.deepEqual([...new Set(scenes.map(s=>s.voice))].sort(),[...WITCH_VOICES].sort());
  assert.equal(new Set(scenes.map(s=>s.direction)).size,2);
  assert.equal(new Set(scenes.map(s=>s.spoonAuto)).size,2);
  for(const key of ['stirAuto','handAuto']) {
    assert.equal(new Set(scenes.map(s=>s[key])).size,2);
    assert.ok(scenes.filter(s=>s[key]).length>scenes.length*.75);
  }
  assert.ok(scenes.every(s=>s.stirAuto||!s.spoonAuto));
  assert.equal(new Set(scenes.map(s=>s.palette)).size,8);
  assert.equal(new Set(scenes.map(s=>s.trip)).size,4);
  assert.equal(new Set(scenes.map(s=>s.visualMode)).size,8);
  assert.ok(scenes.filter(s=>s.visualMode===0).length>scenes.length*.5,'dice favor a steady picture');
  assert.ok(scenes.filter(s=>s.visualMode>=4).length<scenes.length*.25,'glitch scenes remain occasional');
  assert.equal(new Set(scenes.map(s=>s.treeShape)).size,6);
  for(const key of ['speed','flightSpeed','radius','glass','hair','altitude','flightX','tone','nose','hat','spoonHeight','handDepth','fabricX','fabricY','trailPull','trailTwist','trailFeedback','trailSpace','treeSpread','treeCurl','spellBalance']) {
    assert.ok(new Set(scenes.map(s=>s[key])).size>100,key);
    assert.ok(scenes.every(s=>s[key]>=0&&s[key]<=1),key);
  }
  for(const scene of scenes) if(!scene.spoonAuto)assert.equal(witchVoiceAtHeight(scene.spoonHeight),scene.voice);
  for(let i=0;i<5;i++) assert.ok(new Set(scenes.map(s=>s.fingers[i])).size>100,`finger ${i}`);
  assert.ok(new Set(scenes.map(s=>s.ghostTempo)).size>40,'the ghost beat participates in full-state randomization');
  assert.ok(scenes.every(s=>s.ghostTempo>=36&&s.ghostTempo<=180));
  assert.equal(new Set(scenes.map(s=>s.handMotion)).size,WITCH_HAND_MOTIONS.length);
  assert.equal(new Set(scenes.map(s=>s.handSound)).size,WITCH_HAND_SOUNDS.length);
  assert.equal(new Set(scenes.map(s=>s.catGait)).size,WITCH_CAT_GAITS.length);
  for(const [key,low,high] of [['handRate',.25,6],['catSpeed',.5,2]]) {
    assert.ok(new Set(scenes.map(s=>s[key])).size>100,key);
    assert.ok(scenes.every(s=>s[key]>=low&&s[key]<=high));
  }
});

test('every shelf miniature is an actual catalogue icon and selects its own complete playable spell',()=>{
  assert.ok(WITCH_SHELF.some(item=>item.id==='puggler'&&item.instrumentId==='puggler'));
  assert.ok(WITCH_SHELF.some(item=>item.instrumentId==='hyper-rubix'));
  assert.equal(WITCH_SHELF.filter(item=>['hybrinx','tongued-beasts'].includes(item.instrumentId)).length,1);
  assert.equal(new Set(WITCH_SHELF.map(item=>item.instrumentId)).size,WITCH_SHELF.length);
  const sounds=new Set();
  assert.equal(WITCH_SHELF.length,18);assert.equal(WITCH_TREE_OBJECTS.length,3);
  assert.equal(WITCH_CUPBOARD_TOP.length,3);assert.equal(WITCH_WEB_OBJECTS.length,1);
  assert.equal(WITCH_INGREDIENTS.filter(item=>item.instrumentId==='hybrinx').length,1);
  assert.deepEqual(WITCH_TREE_OBJECTS.map(item=>item.instrumentId),['blech-midi','syrinx','creaturazoid']);
  assert.equal(WITCH_INGREDIENTS.filter(item=>item.instrumentId==='throatazoid').length,1);
  assert.ok(WITCH_INGREDIENTS.every(item=>item.instrumentId!=='breath-atlas'));
  const registered=TOOL_GROUPS.flatMap(group=>group.items||group.tools||[]);
  for(const item of WITCH_INGREDIENTS) {
    const tool=registered.find(tool=>tool.id===item.instrumentId);
    const instrument=instrumentById(item.instrumentId) || (tool && {...tool,imageHref:tool.imageHref??`assets/instruments/${tool.id}.webp`});
    assert.ok(instrument,item.instrumentId);
    assert.equal(item.name,instrument.label);
    assert.equal(item.imageHref,instrument.imageHref);
    assert.ok(existsSync(new URL(`../${item.imageHref}`,import.meta.url)));
    assert.equal(item.phraseDuration,item.location==='tree'?3.2:0);
    const preset=WITCH_PRESETS.find(preset=>preset.id===item.presetId);
    assert.ok(preset,item.id);
    sounds.add(JSON.stringify(witchHandConfig(preset.snapshot)));
    assert.equal('volume' in preset.snapshot,false);
    assert.equal('performanceTime' in preset.snapshot,false);
  }
  assert.equal(sounds.size,WITCH_INGREDIENTS.length,'each shelf spell changes the authored hand sound or articulation');
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot:s})=>`${s.catGait}:${s.catSpeed}`)).size,WITCH_PRESETS.length);
  assert.ok(WITCH_PRESETS.some(({snapshot:s})=>s.handRate>=5&&s.handDepth>=.8));
  assert.ok(WITCH_PRESETS.some(({snapshot:s})=>s.handRate<.6));
  for(const bank of WITCH_HAND_SOUNDS)assert.ok(bank.sources.every(source=>!['vowel','choir'].includes(source)),'finger banks keep instrumental identity');
});

test('ghost beat tempo recalls old presets safely and clamps malformed or extreme input',()=>{
  assert.equal(WITCH_DEFAULTS.ghostTempo,72);
  for(const value of [undefined,NaN,Infinity,'broken']) assert.equal(normalizeWitchPreset({ghostTempo:value}).ghostTempo,72);
  assert.equal(normalizeWitchPreset({ghostTempo:-100}).ghostTempo,36);
  assert.equal(normalizeWitchPreset({ghostTempo:1000}).ghostTempo,180);
  assert.equal(normalizeWitchPreset({ghostTempo:108}).ghostTempo,108);
});

test('the scene bank offers distinct complete spells across colors, distortion and performance focus',()=>{
  assert.ok(WITCH_PRESETS.length>=32);
  assert.equal(WITCH_PALETTES.length,8);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>JSON.stringify(snapshot))).size,WITCH_PRESETS.length);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>snapshot.palette)).size,8);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>snapshot.trip)).size,4);
  assert.equal(new Set(WITCH_PRESETS.map(({snapshot})=>snapshot.visualMode)).size,8);
  for(const bank of [WITCH_PRESETS,WITCH_PRESETS.filter(preset=>WITCH_INGREDIENTS.some(item=>item.presetId===preset.id))]) {
    assert.ok(bank.filter(({snapshot})=>snapshot.visualMode===0).length>bank.length*.5,'factory and ingredient spells mostly keep the picture steady');
    assert.ok(bank.filter(({snapshot})=>snapshot.visualMode>=4).length<bank.length*.2,'wild factory and ingredient spells are occasional');
  }
  for(const scene of ['brew','fingers','flight']) assert.ok(WITCH_PRESETS.filter(({snapshot})=>snapshot.scene===scene).length>=6);
  assert.equal(normalizeWitchPreset({}).palette,0);
  assert.ok(WITCH_PRESETS.some(({snapshot})=>snapshot.flightSpeed<.1));
  assert.ok(WITCH_PRESETS.some(({snapshot})=>snapshot.flightSpeed>.9));
  assert.equal(normalizeWitchPreset({speed:.7}).flightSpeed,.7);
  assert.equal(normalizeWitchPreset({speed:.7,flightSpeed:.1}).flightSpeed,.1);
  assert.equal(normalizeWitchPreset({trip:100,palette:-10}).trip,3);
  assert.equal(normalizeWitchPreset({trip:100,palette:-10}).palette,0);
  assert.equal(normalizeWitchPreset({trip:-1,palette:100}).palette,7);
  assert.deepEqual(normalizeWitchPreset(null),normalizeWitchPreset());
});

test('presets feature either singer or fingers and give both new vocal patterns contrasting ensembles',()=>{
  for(const scene of ['brew','fingers','flight']) {
    const bank=WITCH_PRESETS.filter(({snapshot})=>snapshot.scene===scene);
    assert.ok(bank.some(({snapshot})=>snapshot.spellBalance>=(scene==='fingers'?.5:.8)),`${scene} includes a finger-led spell`);
    if(scene!=='fingers')assert.ok(bank.some(({snapshot})=>snapshot.spellBalance<=.3),`${scene} includes a singer-led spell`);
  }
  for(const voice of ['wail','chatter']) {
    const bank=WITCH_PRESETS.filter(({snapshot})=>snapshot.voice===voice&&!snapshot.spoonAuto);
    assert.ok(bank.length>=3);
    assert.ok(bank.some(({snapshot})=>snapshot.spellBalance<=.35));
    assert.ok(bank.some(({snapshot})=>snapshot.scene==='fingers'||snapshot.spellBalance>=.8));
    assert.ok(new Set(bank.map(({snapshot})=>snapshot.handSound)).size>=2);
    for(const {snapshot} of bank)assert.equal(witchVoiceAtHeight(snapshot.spoonHeight),voice);
  }
});

test('older scenes retain their singing character and restore the original balance',()=>{
  for(const [i,voice] of ['mutter','whisper','creak','cackle','sing'].entries()) {
    const scene=normalizeWitchPreset({voice,spoonAuto:false,spoonHeight:(i+.5)/5});
    assert.equal(scene.voice,voice);
    assert.equal(witchVoiceAtHeight(scene.spoonHeight),voice);
    assert.equal(scene.spellBalance,.5);
  }
  for(const value of [undefined,NaN,Infinity,'broken'])assert.equal(normalizeWitchPreset({spellBalance:value}).spellBalance,.5);
  assert.equal(normalizeWitchPreset({spellBalance:-3}).spellBalance,0);
  assert.equal(normalizeWitchPreset({spellBalance:4}).spellBalance,1);
  const held=(WITCH_VOICES.indexOf('wail')+.2)/WITCH_VOICES.length;
  assert.equal(normalizeWitchPreset({voice:'wail',spoonAuto:false,spoonHeight:held}).spoonHeight,held);
});

test('saved scenes from before mushroom vision preserve their line distortion',()=>{
  for(const trip of [0,1,2,3])assert.equal(normalizeWitchPreset({trip}).visualMode,trip);
  assert.equal(normalizeWitchPreset({trip:3,visualMode:6}).visualMode,6);
});

test('branch deformation is recalled, bounded and neutral in legacy scenes',()=>{
  for(const key of ['treeSpread','treeCurl']) {
    assert.equal(normalizeWitchPreset({})[key],.5);
    assert.equal(normalizeWitchPreset({[key]:NaN})[key],.5);
    assert.equal(normalizeWitchPreset({[key]:-3})[key],0);
    assert.equal(normalizeWitchPreset({[key]:3})[key],1);
    assert.equal(witchPresetSettings({[key]:.27})[key],.27);
    assert.ok(new Set(WITCH_PRESETS.map(p=>p.snapshot[key])).size>3);
  }
});

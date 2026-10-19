import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { graphInstrumentDefaultState } from '../src/families/graph/graph-instrument-app.js';
import { GRAPH_DRUM_FULL_PRESETS, validateGraphDrumPreset, graphDrumSceneGraph } from '../src/families/graph-presets/drum-full-presets.js';
import { graphSynthFullPresets, validateGraphSynthPreset } from '../src/families/graph-presets/full-presets.js';
import { scheduleGraphPulse } from '../src/families/graph/graph-instruments.js';
import { presetStateKey } from '../src/site/header-presets.js';
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const defaults = graphInstrumentDefaultState('synth');
const banks = { drums: GRAPH_DRUM_FULL_PRESETS, synth: graphSynthFullPresets(defaults) };
for (const [mode, bank] of Object.entries(banks)) {
  const originalCount = mode === "drums" ? 14 : 12;
  test(`${mode}: retain the existing bank and append twenty distinct complete studies`, () => {
    assert.equal(bank.length, originalCount + 20);
    assert.equal(new Set(bank.map(p => p.id)).size, originalCount + 20);
    assert.equal(new Set(bank.map(p => presetStateKey(p.snapshot))).size, originalCount + 20);
    for (const {snapshot} of bank) {
      (mode === 'drums' ? validateGraphDrumPreset : s => validateGraphSynthPreset(s, defaults))(snapshot);
      assert.equal('audio' in snapshot.parameters, false);
      assert.equal('playing' in snapshot.parameters, false);
    }
  });
  test(`${mode}: studies cover authored pulse spacing, slow/fast edges and finite returns`, () => {
    const scenes = bank.slice(originalCount).map(p => p.snapshot);
    assert.deepEqual([...new Set(scenes.map(s => s.parameters.pulseDivision))].sort(), [.5,1,2,4]);
    assert.ok(Math.min(...scenes.map(s=>s.parameters.tempo)) <= 44);
    assert.ok(Math.max(...scenes.map(s=>s.parameters.tempo)) >= 210);
    assert.ok(Math.min(...scenes.map(s=>s.parameters.baseDelay)) <= 28);
    assert.ok(Math.max(...scenes.map(s=>s.parameters.baseDelay)) >= 420);
    assert.ok(new Set(scenes.map(s=>s.parameters.topology)).size >= 5);
    for (const snapshot of scenes) {
      const p=snapshot.parameters, graph=mode==='drums'?graphDrumSceneGraph(snapshot).graph:snapshot.graph;
      const events=scheduleGraphPulse(graph,{...p,minAmplitude:.001,horizonSeconds:1024,maxEvents:8192,maxFeedbackPasses:24});
      if (mode === 'synth') assert.equal(p.baseFrequency,440 * 2 ** ((p.seedNote - 69) / 12), 'Seed label must describe the real reference frequency');
      assert.equal(p.triggerScope,'all', 'New studies must not hide an entry behind a long silent route');
      assert.ok(events.length>=p.nodeCount);
      assert.ok(events.length<768, 'No individual study may truncate its graph event list');
      assert.ok(events.every(e=>Number.isFinite(e.time)&&Number.isFinite(e.amplitude)&&e.amplitude<=1));
      assert.ok(events.at(-1).time<40, 'Returns must decay, not form a stuck score');
      if (mode==='drums' && /^karplus|physical/.test(p.percussionStyle.replace('rattlesnake-',''))) {
        const cadence=60/p.tempo*p.pulseDivision;
        assert.ok(events.length/cadence<12,'Physical scenes keep attack-rate headroom');
      }
    }
  });
}
test('drum additions sculpt complete kits and cover all eight percussion engines/styles', () => {
  const scenes=banks.drums.slice(14).map(p=>p.snapshot);
  assert.equal(new Set(scenes.map(s=>s.parameters.percussionStyle)).size,8);
  assert.ok(new Set(scenes.map(s=>sha(s.voices))).size>=6);
  assert.ok(scenes.every(s=>s.voices.length===16 && s.voices.every(v=>v.level>=.6)));
  assert.ok(scenes.every(s=>!('output' in s.parameters)));
});
test('synth additions span seven voices, continuous tuning, both articulations and short/long envelopes', () => {
  const p=banks.synth.slice(12).map(s=>s.snapshot.parameters);
  assert.equal(new Set(p.map(s=>s.soundMode)).size,7);
  assert.equal(new Set(p.map(s=>s.articulation)).size,2);
  assert.ok(p.every(s=>s.tuningMode==='pure'));
  assert.ok(Math.min(...p.map(s=>s.baseFrequency))<=50 && Math.max(...p.map(s=>s.baseFrequency))>=440);
  assert.ok(Math.min(...p.map(s=>s.noteDuration))<60 && Math.max(...p.map(s=>s.noteDuration))>2000);
  assert.ok(Math.min(...p.map(s=>s.modulationIndex))<1.5 && Math.max(...p.map(s=>s.modulationIndex))>=7);
});

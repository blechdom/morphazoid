import { test, expect } from '@playwright/test';

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Falling score fixture</title></head>
<body style="margin:0;background:#111"><div id="stage" style="width:100%;height:60vh;min-height:180px"></div>
<script type="module">
import {createBlackMidiVisualizer} from '/src/instruments/midiphoria/midiphoria-black-renderer.js';
import {parseBlackMidi} from '/src/instruments/midiphoria/midiphoria-black-loader.js';
window.parseBlackMidi=parseBlackMidi; window.position=0; window.statistics=[]; window.statuses=[];
window.midi = (count=128) => {
 const data=new Uint8Array(14+8+count*8+4), view=new DataView(data.buffer);
 data.set([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107]); view.setUint32(18,count*8+4);
 for(let index=0;index<count;index++) data.set([index?0:120,144,index%128,100],22+index*4);
 for(let index=0;index<count;index++) data.set([index?0:120,128,index%128,0],22+count*4+index*4);
 data.set([0,255,47,0],data.length-4); return data.buffer;
};
window.makeVisualizer=(forceCanvas=false)=>createBlackMidiVisualizer({mount:document.querySelector('#stage'),getTransport:()=>({position:window.position}),onStats:stats=>window.statistics.push(stats),onStatus:state=>window.statuses.push(state),forceCanvas});
window.visualizer=window.makeVisualizer(); window.ready=true;
</script></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.route('**/__black-view-test.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('/__black-view-test.html'); await page.waitForFunction(() => window.ready);
});

test('real module worker retains all attacks without detaching the audio buffer', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = midi(100_000), original = source.byteLength; let pulses = 0;
    const interval = setInterval(() => pulses++, 1);
    const score = await visualizer.load(source); clearInterval(interval);
    const stats = visualizer.render(.2);
    return { original, bytes: source.byteLength, count: score.total, peak: score.peakPolyphony, stats, pulses, statuses };
  });
  expect(result.bytes).toBe(result.original); expect(result.count).toBe(100_000); expect(result.peak).toBe(100_000);
  expect(result.stats.held).toBe(100_000); expect(result.pulses).toBeGreaterThan(0);
  expect(result.statuses.at(-1).state).toBe('ready');
  expect(result.stats.renderer).toBe('WebGL2'); expect(result.stats.visible).toBe(100_000); expect(result.stats.omitted).toBe(0);
});

test('future notes descend to keyboard, seek accurately and end without stale keys', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await visualizer.load(midi()); visualizer.setOptions({ lookAhead: .5, alignment: 'equal' });
    const before = visualizer.render(0), active = visualizer.render(.125), ended = visualizer.render(.25), seek = visualizer.render(0);
    return { before, active, ended, seek, canvases: document.querySelectorAll('canvas').length };
  });
  expect(result.before.visible).toBe(128); expect(result.before.passed).toBe(0);
  expect(result.active.held).toBe(128); expect(result.ended.visible).toBe(0); expect(result.ended.held).toBe(0);
  expect(result.seek.passed).toBe(0); expect(result.seek.visible).toBe(128); expect(result.canvases).toBe(2);
  await page.screenshot({ path: 'test-results/black-midi-falling-desktop.png' });
});

test('Canvas fallback reports thinning while full-score statistics stay exact', async ({ page }) => {
  const result = await page.evaluate(async () => {
    visualizer.dispose(); window.visualizer = makeVisualizer(true); await visualizer.load(midi(30_000));
    visualizer.setOptions({ trackColors: { 0: '#ff40c0' }, alignment: 'equal' });
    const active = visualizer.render(.2); visualizer.setOptions({ hiddenTracks: [0] }); const hidden = visualizer.render(.2);
    return { active, hidden };
  });
  expect(result.active.renderer).toBe('Canvas2D'); expect(result.active.total).toBe(30_000);
  expect(result.active.visible).toBe(25_000); expect(result.active.omitted).toBe(5000);
  expect(result.hidden.total).toBe(30_000); expect(result.hidden.held).toBe(30_000); expect(result.hidden.visible).toBe(0); expect(result.hidden.omitted).toBe(0);
});

test('replacing pending worker parsing and disposal suppress stale results and animation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const old = visualizer.load(midi(1_000_000)).then(() => 'unexpected', error => error.name);
    const newest = await visualizer.load(midi(7));
    const cancelled = await old; visualizer.render(0); const count = visualizer.score.total;
    visualizer.dispose(); const events = statistics.length; await new Promise(resolve => setTimeout(resolve, 150));
    return { cancelled, newest: newest.total, count, canvases: document.querySelectorAll('canvas').length, events, finalEvents: statistics.length };
  });
  expect(result.cancelled).toBe('AbortError'); expect(result.newest).toBe(7); expect(result.count).toBe(7);
  expect(result.canvases).toBe(0); expect(result.finalEvents).toBe(result.events);
});

test('loss of GPU context recovers with a truthful Canvas backend', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await visualizer.load(midi());
    const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
    gl.getExtension('WEBGL_lose_context').loseContext();
    await new Promise(resolve => setTimeout(resolve, 50));
    return visualizer.render(.2);
  });
  expect(result.renderer).toBe('Canvas2D'); expect(result.visible).toBe(128); expect(result.held).toBe(128);
});

for (const [name, width, height] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
  test(`full keyboard resizes within phone ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => { await visualizer.load(midi()); visualizer.setOptions({ lookAhead: 1 }); window.position = .16; });
    await expect.poll(() => page.evaluate(() => visualizer.stats?.held)).toBe(128);
    const bounds = await page.locator('canvas').first().boundingBox(); expect(bounds.width).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `test-results/black-midi-falling-${name}.png` });
  });
}

import { test, expect } from '@playwright/test';

async function open(page) {
  await page.route('**/blech-generator-test.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/instruments/midi-mixer/midi-mixer.css"><link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi-generators.css"><style>body{padding:12px;margin:0}main{max-width:960px;margin:auto;display:grid;gap:24px}input,select,button{box-sizing:border-box}button{color:inherit}*{box-sizing:border-box}#blechMathDrop,#blechFramesDrop{display:none}.blech-drop-overlay{position:absolute;inset:0;pointer-events:none}.blech-drop-overlay canvas{position:absolute;inset:0}.blech-drop-floating,.blech-drop-handle{display:none}</style></head><body><main><section id="drop"></section><div id="viewport" style="position:relative;height:120px;overflow:hidden"></div><div id="math"></div><div id="frames"></div><div id="text"></div></main></body></html>` }));
  await page.addInitScript(() => { globalThis.__contexts = []; const Native = AudioContext; globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __contexts.push(this); } }; });
  await page.goto('/blech-generator-test.html');
  await page.evaluate(async () => {
    const { mountBlechMath } = await import('/src/instruments/blech-midi/blech-midi-math-controls.js');
    const { mountBlechFrames } = await import('/src/instruments/blech-midi/blech-midi-frames-controls.js');
    const { mountBlechText } = await import('/src/instruments/blech-midi/blech-midi-text-controls.js');
    const { mountBlechDropStage } = await import('/src/instruments/blech-midi/blech-midi-drop-stage.js');
    const { encodeArtwork } = await import('/src/instruments/blech-midi/blech-midi-art.js');
    globalThis.__drops = []; globalThis.__prepared = []; globalThis.__tempo = 150;
    globalThis.__framePrepared = []; globalThis.__textPrepared = []; globalThis.__textApplied = []; globalThis.__textProgram = '0';
    globalThis.__drawing = encodeArtwork([{ note: 0, beat: 0, duration: 1, velocity: 96 }, { note: 127, beat: 3, duration: 1, velocity: 80 }], { durationBeats: 4 });
    const onDrop = (score, options) => { const snapshot = { notes: structuredClone(score.analysis.notes), noteCount: score.analysis.noteCount, beats: score.analysis.durationBeats, tempo: score.analysis.initialTempo, options }; __drops.push(snapshot); return snapshot; };
    globalThis.__activeSource = 'math';
    globalThis.__stage = mountBlechDropStage(document.querySelector('#drop'), document.querySelector('#viewport'), { getTempo: () => __tempo, onDrop });
    const prepare = (source, target, prepared) => { target.push(prepared); if (source === __activeSource) __stage.prepare(prepared.score, { ...prepared.settings, source, error: prepared.error }); };
    globalThis.__chooseGenerator = source => { __activeSource = source; const prepared = (source === 'math' ? __prepared : source === 'frames' ? __framePrepared : __textPrepared).at(-1); __stage.prepare(prepared.score, { ...prepared.settings, source, error: prepared.error }); };
    globalThis.__math = mountBlechMath(document.querySelector('#math'), { getTempo: () => __tempo, onDrop, onPrepare: prepared => prepare('math', __prepared, prepared) });
    globalThis.__frames = mountBlechFrames(document.querySelector('#frames'), { getDrawingScore: () => __drawing, getTempo: () => __tempo, onDrop, onPrepare: prepared => prepare('frames', __framePrepared, prepared) });
    globalThis.__text = mountBlechText(document.querySelector('#text'), { getTempo: () => __tempo, getProgram: () => __textProgram, onDrop,
      onPrepare: prepared => prepare('text', __textPrepared, prepared), getLayer: id => id === 'text-layer' ? { name: 'Text layer', loop: true } : null,
      onApply: (id, score, options) => { __textApplied.push({ id, score: structuredClone(score), options }); return { pendingReplacement: true }; },
    });
  });
}

test('math stays prepared until Drop, has usable presets, rejects bad equations and never arms audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  expect(await page.evaluate(() => __drops.length)).toBe(0);
  await page.locator('#blechDropSend').click();
  expect(await page.evaluate(() => __drops[0])).toMatchObject({ noteCount: 256, beats: 8, tempo: 150, options: { loop: true, program: '0' } });
  await page.locator('#blechMathPreset').selectOption('heart', { force: true });
  await expect(page.locator('#blechMathEquationX')).toBeVisible(); await expect(page.locator('#blechMathEquation')).toBeHidden();
  await page.locator('#blechDropOnce').click(); await page.locator('#blechDropSend').click();
  expect(await page.evaluate(() => __drops[1].notes)).not.toEqual(await page.evaluate(() => __drops[0].notes));
  expect(await page.evaluate(() => __drops[1].options.loop)).toBe(false);
  await page.locator('#blechMathEquationX').fill('globalThis.alert(1)');
  await expect(page.locator('#blechDropSend')).toBeDisabled(); await expect(page.locator('#blechMathStatus')).not.toBeEmpty();
  await page.locator('#blechMathPreset').selectOption('lissajous', { force: true }); await expect(page.locator('#blechDropSend')).toBeEnabled();
  expect(await page.evaluate(() => __contexts.length)).toBe(0); expect(errors).toEqual([]);
});

test('Frames notifies silent staging on sequence and loop edits, and invalidates the empty sequence', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => __framePrepared[0])).toMatchObject({ score: null, settings: { name: 'Frames 0', loop: true, program: 'original' } });
  await page.locator('#blechFramesCapture').click();
  await expect.poll(() => page.evaluate(() => __framePrepared.at(-1).score?.analysis.noteCount)).toBe(2);
  await page.locator('#blechFramesLoop').uncheck();
  expect(await page.evaluate(() => __framePrepared.at(-1).settings.loop)).toBe(false);
  const getters = await page.evaluate(() => {
    const before = __framePrepared.length, settings = __frames.getSettings(), score = __frames.getScore();
    score.analysis.notes[0].note = 99;
    return { before, after: __framePrepared.length, settings, note: __frames.getScore().analysis.notes[0].note };
  });
  expect(getters).toMatchObject({ after: getters.before, settings: { name: 'Frames 1', loop: false, program: 'original' }, note: 0 });
  await page.locator('#blechFramesDelete').click();
  expect(await page.evaluate(() => ({ score: __framePrepared.at(-1).score, error: Boolean(__framePrepared.at(-1).error), drops: __drops.length, contexts: __contexts.length }))).toEqual({ score: null, error: true, drops: 0, contexts: 0 });
});

test('Text staging preserves layout metadata, getters stay silent and Apply keeps next-loop semantics', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => __textPrepared.length)).toBe(1);
  const getters = await page.evaluate(() => {
    const before = __textPrepared.length, settings = __text.getSettings(), score = __text.getScore();
    const metadata = structuredClone(score.textSettings); score.textSettings.message = 'MUTATED'; score.analysis.notes[0].note = -1;
    return { before, after: __textPrepared.length, settings, metadata, restored: __text.getScore().textSettings, minimum: Math.min(...__text.getScore().analysis.notes.map(n => n.note)), layout: score.layout };
  });
  expect(getters.after).toBe(getters.before);
  expect(getters.settings).toEqual({ name: 'Text · BLECH', program: '0', loop: false });
  expect(getters.restored).toEqual(getters.metadata); expect(getters.metadata.message).toBe('BLECH');
  expect(getters.minimum).toBeGreaterThanOrEqual(0); expect(getters.layout.capacity).toBeGreaterThan(0);
  await page.locator('#blechTextLoop').check();
  await expect.poll(() => page.evaluate(() => __textPrepared.at(-1).settings.loop)).toBe(true);
  await page.evaluate(() => { __textProgram = '24'; __text.edit({ sampleId: 'text-layer', settings: __text.getScore().textSettings }); });
  await page.locator('#blechTextMessage').fill('NEXT');
  await expect.poll(() => page.evaluate(() => __textPrepared.at(-1).score?.textSettings.message)).toBe('NEXT');
  expect(await page.evaluate(() => __textPrepared.at(-1).settings.program)).toBe('24');
  await page.locator('#blechTextApply').click();
  expect(await page.evaluate(() => __textApplied[0])).toMatchObject({ id: 'text-layer', options: { when: 'next-loop', name: 'Text · NEXT' }, score: { textSettings: { message: 'NEXT' } } });
  await page.locator('#blechTextClear').click();
  expect(await page.evaluate(() => ({ score: __textPrepared.at(-1).score, error: Boolean(__textPrepared.at(-1).error), retained: __textApplied[0].score.textSettings.message, drops: __drops.length, contexts: __contexts.length }))).toEqual({ score: null, error: true, retained: 'NEXT', drops: 0, contexts: 0 });
});

test('math prepares all 54 patterns silently, exposes detached staging data and clears invalid previews', async ({ page }) => {
  await open(page);
  await expect(page.locator('#blechMathPreset option:not([hidden])')).toHaveCount(54);
  expect(await page.evaluate(() => __prepared.length)).toBe(1);
  await page.locator('#blechMathPreset').selectOption('opening-fan', { force: true });
  await expect.poll(() => page.evaluate(() => __prepared.at(-1).settings.name)).toBe('Opening fan');
  const prepared = await page.evaluate(() => {
    const count = __prepared.length, settings = __math.getSettings(), artwork = __math.getArtwork(), score = __math.getScore();
    const note = artwork.notes[0].note; artwork.notes[0].note = -200;
    return { count, after: __prepared.length, settings, note, detachedNote: __math.getArtwork().notes[0].note, scoreNotes: score.analysis.noteCount, previewNotes: __prepared.at(-1).artwork.notes.length };
  });
  expect(prepared.count).toBe(prepared.after);
  expect(prepared.note).toBe(prepared.detachedNote);
  expect(prepared.settings).toMatchObject({ name: 'Opening fan', equation: 't*sin(6*x)', loop: true });
  expect(prepared.scoreNotes).toBe(prepared.previewNotes);
  await page.locator('#blechMathLoop').uncheck();
  await expect.poll(() => page.evaluate(() => __prepared.at(-1).settings.loop)).toBe(false);
  await page.locator('#blechMathEquation').fill('phase.constructor');
  await expect.poll(() => page.evaluate(() => __prepared.at(-1).score)).toBe(null);
  expect(await page.evaluate(() => __prepared.at(-1).error)).toBeTruthy();
  await page.locator('#blechMathPreset').selectOption('accelerator', { force: true });
  await expect.poll(() => page.evaluate(() => __prepared.at(-1).score?.analysis.noteCount)).toBeGreaterThan(100);
  expect(await page.evaluate(() => ({ drops: __drops.length, contexts: __contexts.length }))).toEqual({ drops: 0, contexts: 0 });
});

test('frame capture, ordering, rest and looped drop retain independent snapshots', async ({ page }) => {
  await open(page); await page.evaluate(() => __chooseGenerator('frames')); await expect(page.locator('#blechDropSend')).toBeDisabled();
  await page.locator('#blechFramesCapture').click();
  await page.evaluate(() => { __drawing.analysis.notes[0].note = 60; });
  await page.locator('#blechFramesCapture').click();
  await expect(page.locator('.blech-frame-choice')).toHaveCount(2);
  await page.locator('#blechFramesBack').click(); await page.locator('#blechFramesBlank').click();
  await page.locator('#blechFramesBeats').evaluate(node => { node.value = '2'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#blechFramesStatistics')).toContainText('3/8 frames');
  expect(await page.evaluate(() => __drops.length)).toBe(0);
  await page.locator('#blechDropSend').click();
  const dropped = await page.evaluate(() => __drops[0]);
  expect(dropped).toMatchObject({ noteCount: 4, beats: 6, tempo: 150, options: { loop: true } });
  expect(dropped.notes.map(n => [n.note, n.beat])).toEqual([[60, 0], [127, 1.5], [0, 2], [127, 3.5]]);
  await page.locator('#blechFramesDelete').click();
  expect(await page.evaluate(() => __drops[0])).toEqual(dropped);
  await page.locator('#blechFramesAnimate').click(); await expect(page.locator('#blechFramesAnimate')).toHaveAttribute('aria-pressed', 'true');
  const initial = await page.locator('#blechFramesPreview').getAttribute('data-frame');
  await expect.poll(() => page.locator('#blechFramesPreview').getAttribute('data-frame')).not.toBe(initial);
  await page.locator('#blechFramesAnimate').click(); await expect(page.locator('#blechFramesAnimate')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => __contexts.length)).toBe(0);
  await page.evaluate(() => { __stage.dispose(); __frames.dispose(); __math.dispose(); __text.dispose(); });
  await expect(page.locator('#frames')).toBeEmpty(); await expect(page.locator('#math')).toBeEmpty();
});

test('frame capacity stays recoverable and creator controls fit a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.locator('#blechFramesCapture').click();
  for (let i = 1; i < 8; i++) await page.locator('#blechFramesDuplicate').click();
  await expect(page.locator('#blechFramesCapture')).toBeDisabled(); await expect(page.locator('#blechFramesDuplicate')).toBeDisabled();
  await expect(page.locator('.blech-frame-choice')).toHaveCount(8); await page.locator('#blechFramesDelete').click();
  await expect(page.locator('#blechFramesCapture')).toBeEnabled(); await expect(page.locator('#blechFramesDuplicate')).toBeEnabled();
  await page.locator('#blechMathPreset').selectOption('lissajous', { force: true }); await page.locator('.blech-generator-settings > summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

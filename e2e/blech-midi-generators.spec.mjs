import { test, expect } from '@playwright/test';

async function open(page) {
  await page.route('**/blech-generator-test.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/instruments/midi-mixer/midi-mixer.css"><link rel="stylesheet" href="/src/instruments/blech-midi/blech-midi-generators.css"><style>body{padding:12px;margin:0}main{max-width:960px;margin:auto;display:grid;gap:24px}input,select,button{box-sizing:border-box}button{color:inherit}*{box-sizing:border-box}</style></head><body><main><div id="math"></div><div id="frames"></div></main></body></html>` }));
  await page.addInitScript(() => { globalThis.__contexts = []; const Native = AudioContext; globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __contexts.push(this); } }; });
  await page.goto('/blech-generator-test.html');
  await page.evaluate(async () => {
    const { mountBlechMath } = await import('/src/instruments/blech-midi/blech-midi-math-controls.js');
    const { mountBlechFrames } = await import('/src/instruments/blech-midi/blech-midi-frames-controls.js');
    const { encodeArtwork } = await import('/src/instruments/blech-midi/blech-midi-art.js');
    globalThis.__drops = []; globalThis.__tempo = 150;
    globalThis.__drawing = encodeArtwork([{ note: 0, beat: 0, duration: 1, velocity: 96 }, { note: 127, beat: 3, duration: 1, velocity: 80 }], { durationBeats: 4 });
    const onDrop = (score, options) => { __drops.push({ notes: structuredClone(score.analysis.notes), noteCount: score.analysis.noteCount, beats: score.analysis.durationBeats, tempo: score.analysis.initialTempo, options }); };
    globalThis.__math = mountBlechMath(document.querySelector('#math'), { getTempo: () => __tempo, onDrop });
    globalThis.__frames = mountBlechFrames(document.querySelector('#frames'), { getDrawingScore: () => __drawing, getTempo: () => __tempo, onDrop });
  });
}

test('math stays prepared until Drop, has usable presets, rejects bad equations and never arms audio', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page);
  await expect(page.locator('#blechMathDrop')).toBeEnabled();
  expect(await page.evaluate(() => __drops.length)).toBe(0);
  await page.locator('#blechMathDrop').click();
  expect(await page.evaluate(() => __drops[0])).toMatchObject({ noteCount: 256, beats: 8, tempo: 150, options: { loop: true, program: 'original' } });
  await page.locator('#blechMathPreset').selectOption('heart');
  await expect(page.locator('#blechMathEquationX')).toBeVisible(); await expect(page.locator('#blechMathEquation')).toBeHidden();
  await page.locator('#blechMathLoop').uncheck(); await page.locator('#blechMathDrop').click();
  expect(await page.evaluate(() => __drops[1].notes)).not.toEqual(await page.evaluate(() => __drops[0].notes));
  expect(await page.evaluate(() => __drops[1].options.loop)).toBe(false);
  await page.locator('#blechMathEquationX').fill('globalThis.alert(1)');
  await expect(page.locator('#blechMathDrop')).toBeDisabled(); await expect(page.locator('#blechMathStatus')).not.toBeEmpty();
  await page.locator('#blechMathPreset').selectOption('lissajous'); await expect(page.locator('#blechMathDrop')).toBeEnabled();
  expect(await page.evaluate(() => __contexts.length)).toBe(0); expect(errors).toEqual([]);
});

test('frame capture, ordering, rest and looped drop retain independent snapshots', async ({ page }) => {
  await open(page); await expect(page.locator('#blechFramesDrop')).toBeDisabled();
  await page.locator('#blechFramesCapture').click();
  await page.evaluate(() => { __drawing.analysis.notes[0].note = 60; });
  await page.locator('#blechFramesCapture').click();
  await expect(page.locator('.blech-frame-choice')).toHaveCount(2);
  await page.locator('#blechFramesBack').click(); await page.locator('#blechFramesBlank').click();
  await page.locator('#blechFramesBeats').evaluate(node => { node.value = '2'; node.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#blechFramesStatistics')).toContainText('3/8 frames');
  expect(await page.evaluate(() => __drops.length)).toBe(0);
  await page.locator('#blechFramesDrop').click();
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
  await page.evaluate(() => { __frames.dispose(); __math.dispose(); });
  await expect(page.locator('#frames')).toBeEmpty(); await expect(page.locator('#math')).toBeEmpty();
});

test('frame capacity stays recoverable and creator controls fit a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.locator('#blechFramesCapture').click();
  for (let i = 1; i < 8; i++) await page.locator('#blechFramesDuplicate').click();
  await expect(page.locator('#blechFramesCapture')).toBeDisabled(); await expect(page.locator('#blechFramesDuplicate')).toBeDisabled();
  await expect(page.locator('.blech-frame-choice')).toHaveCount(8); await page.locator('#blechFramesDelete').click();
  await expect(page.locator('#blechFramesCapture')).toBeEnabled(); await expect(page.locator('#blechFramesDuplicate')).toBeEnabled();
  await page.locator('#blechMathPreset').selectOption('lissajous'); await page.locator('.blech-generator-settings > summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

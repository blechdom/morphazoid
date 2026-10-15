import { test, expect } from '@playwright/test';

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Playable falling keyboard</title></head>
<body style="margin:0;background:#111"><div id="stage" style="height:60vh"></div><button id="away">Other control</button>
<script type="module">
import { createBlackMidiVisualizer, blackMidiKeyLayout } from '/src/instruments/blech-midi/blech-midi-black-renderer.js';
window.keyboardEvents=[]; window.blackMidiKeyLayout=blackMidiKeyLayout;
window.visualizer=createBlackMidiVisualizer({mount:document.querySelector('#stage'),
 onNoteOn:event=>keyboardEvents.push({type:'on',...event}),onNoteOff:event=>keyboardEvents.push({type:'off',...event})});
visualizer.render(); window.ready=true;
</script></body></html>`;

test.use({ hasTouch: true });
test.beforeEach(async ({ page }) => {
  await page.route('**/__blech-keyboard-test.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('/__blech-keyboard-test.html'); await page.waitForFunction(() => window.ready);
});

const point = (page, pitch, y = .8, alignment = 'piano') => page.evaluate(({ pitch, y, alignment }) => {
  const rect = document.querySelector('.blech-playable-keyboard').getBoundingClientRect(), key = blackMidiKeyLayout(alignment)[pitch];
  return { x: rect.left + (key.x + key.width / 2) * rect.width, y: rect.top + rect.height * y };
}, { pitch, y, alignment });

test('mouse hover holds keys, crosses white/black notes and releases on leaving the band', async ({ page }) => {
  const first = await point(page, 60), sharp = await point(page, 61, .2);
  await page.mouse.move(first.x, first.y);
  await expect.poll(() => page.evaluate(() => keyboardEvents.map(({ type, note }) => [type, note]))).toEqual([['on', 60]]);
  await page.mouse.move(first.x + .5, first.y);
  expect(await page.evaluate(() => keyboardEvents.length)).toBe(1);
  await page.mouse.move(sharp.x, sharp.y);
  await expect.poll(() => page.evaluate(() => keyboardEvents.map(({ type, note }) => [type, note]))).toEqual([['on', 60], ['off', 60], ['on', 61]]);
  await expect(page.locator('.midiphoria-black-stage')).toHaveAttribute('data-keyboard-held', '61');
  await page.mouse.move(sharp.x, sharp.y - 80);
  await expect.poll(() => page.evaluate(() => keyboardEvents.at(-1))).toMatchObject({ type: 'off', note: 61 });
  await expect(page.locator('.midiphoria-black-stage')).toHaveAttribute('data-keyboard-held', '');
});

test('keyboard arrows select all pitches and Enter releases without starting a transport', async ({ page }) => {
  const keyboard = page.getByRole('slider', { name: /Play MIDI keyboard/ });
  await keyboard.focus(); await page.keyboard.press('Home');
  await expect(keyboard).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.down('Enter'); await page.keyboard.press('End'); await page.keyboard.up('Enter');
  expect(await page.evaluate(() => keyboardEvents.map(({ type, note }) => [type, note]))).toEqual([['on', 0], ['off', 0], ['on', 127], ['off', 127]]);
  await page.keyboard.down('Enter'); await page.locator('#away').focus();
  expect(await page.evaluate(() => keyboardEvents.at(-1))).toMatchObject({ type: 'off', note: 127 });
});

test('touch drag stays silent before press, changes pitch and releases on touch end', async ({ page }) => {
  const client = await page.context().newCDPSession(page), first = await point(page, 60), second = await point(page, 64);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 0 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...second, id: 0 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => keyboardEvents.map(({ type, note }) => [type, note]))).toEqual([['on', 60], ['off', 60], ['on', 64], ['off', 64]]);
});

test('explicit release, window blur, GPU loss and disposal release held notes once', async ({ page }) => {
  const first = await point(page, 60);
  await page.mouse.move(first.x, first.y);
  await page.evaluate(() => visualizer.releaseKeyboard());
  await page.mouse.move(first.x + .5, first.y);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.move(first.x + 1, first.y);
  await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect.poll(() => page.evaluate(() => visualizer.renderer)).toBe('Canvas2D');
  await page.mouse.move(first.x + 1.5, first.y);
  await page.evaluate(() => { visualizer.dispose(); visualizer.dispose(); });
  expect(await page.evaluate(() => keyboardEvents.map(event => event.type))).toEqual(['on', 'off', 'on', 'off', 'on', 'off', 'on', 'off']);
  await expect(page.locator('.blech-playable-keyboard')).toHaveCount(0);
});

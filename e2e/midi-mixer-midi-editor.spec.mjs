import { expect, test } from '@playwright/test';

// Exercise the production editor with its production normalizer, without
// creating audio or transport ownership in this UI component.
async function open(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/qa-midi-parameter-editor', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/src/instruments/midi-mixer/midi-mixer-midi-editor.css">
    <style>body{margin:0;padding:16px;background:#080d10;color:#d5e1df;font-family:sans-serif}main{max-width:600px;margin:auto}*{box-sizing:border-box}</style></head>
    <body><main><div id="voice"></div><div id="effects"></div></main><script type="module">
    import {mountMidiParameterEditor,mountMidiSynthEffectEditor} from '/src/instruments/midi-mixer/midi-mixer-midi-editor.js';
    import {sanitizeMidiParameters,sanitizeMidiSynthEffects} from '/src/instruments/midi-mixer/midi-mixer-parameters.js';
    window.voiceState={};window.effectState={};window.actions=[];
    window.editor=mountMidiParameterEditor(document.querySelector('#voice'),{label:'Voice A',getValue:()=>voiceState,
      onChange:value=>voiceState=sanitizeMidiParameters(value,voiceState),onAction:value=>actions.push(value)});
    window.effectEditor=mountMidiSynthEffectEditor(document.querySelector('#effects'),{getValue:()=>effectState,
      onChange:value=>effectState=sanitizeMidiSynthEffects(value,effectState)});
    </script></body></html>` }));
  await page.goto('/qa-midi-parameter-editor'); await page.waitForFunction(() => window.editor);
  return errors;
}
const group = (page, title, host = '#voice') => page.locator(`${host} .midi-edit-group`).filter({ has: page.locator('summary', { hasText: new RegExp(`^${title}$`) }) });
async function expand(page, title, host) { const section = group(page, title, host); await section.locator('summary').click(); return section; }

test('MIDI sound editors preserve sparse overrides, ordered actions, focus and honest original values', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#voice input')).toHaveCount(0);
  const mix = await expand(page, 'Mix');
  await expect(mix.locator('output').first()).toHaveText('Follow file');
  const gain = page.getByRole('slider', { name: 'Voice A: Voice gain', exact: true });
  await gain.fill('1.35'); expect(await page.evaluate(() => voiceState.gain)).toBe(1.35);
  await gain.focus(); await page.evaluate(() => { for (let index = 0; index < 100; index++) editor.refresh(); });
  await expect(gain).toBeFocused();
  await page.getByRole('button', { name: 'Voice A: Voice gain, follow file', exact: true }).click();
  expect(await page.evaluate(() => voiceState)).toEqual({});
  const controllers = await expand(page, 'All MIDI controllers');
  await controllers.getByRole('searchbox').fill('74');
  await controllers.locator('.midi-edit-result').filter({ hasText: 'CC 74 · Brightness' }).click();
  await controllers.getByRole('slider', { name: 'Voice A: CC 74 · Brightness', exact: true }).fill('92');
  expect(await page.evaluate(() => voiceState.controllers)).toEqual({ 74: 92 });
  await controllers.getByRole('searchbox').fill('Data entry MSB');
  await controllers.locator('.midi-edit-result').filter({ hasText: /^CC 6 ·/ }).click();
  await controllers.getByRole('slider', { name: 'Voice A: CC 6 · Data entry MSB', exact: true }).fill('42');
  expect(await page.evaluate(() => voiceState.controllers)).toEqual({ 74: 92 });
  await controllers.getByRole('button', { name: 'Voice A: CC 6 · Data entry MSB, send MIDI controller', exact: true }).click();
  expect(await page.evaluate(() => actions.at(-1))).toEqual({ kind: 'cc', controller: 6, value: 42 });
  const synthesis = await expand(page, 'SoundFont synthesis');
  await synthesis.getByRole('searchbox').fill('attack volume');
  await synthesis.locator('.midi-edit-result:visible').click();
  await synthesis.getByRole('slider', { name: 'Voice A: Attack · volume envelope', exact: true }).fill('-2400');
  expect(await page.evaluate(() => voiceState.generators)).toEqual({ 34: -2400 });
  await expect(synthesis.locator('.midi-edit-selected output')).toHaveText('-2400 timecents · 250 ms');
  await expand(page, 'RPN / NRPN & recovery');
  await page.getByRole('spinbutton', { name: 'Voice A: parameter value', exact: true }).fill('256');
  await page.getByRole('button', { name: 'Send parameter', exact: true }).click();
  expect(await page.evaluate(() => actions.at(-1))).toEqual({ kind: 'parameter', registered: true, parameter: 0, value: 256 });
  await page.getByRole('button', { name: 'All sound off', exact: true }).click();
  expect(await page.evaluate(() => actions.at(-1))).toEqual({ kind: 'cc', controller: 120, value: 0 });
  await expand(page, 'SoundFont reverb', '#effects');
  await page.getByRole('slider', { name: 'SoundFont effects: Reverb level', exact: true }).fill('89');
  expect(await page.evaluate(() => effectState)).toEqual({ 'reverb.level': 89 });
  await page.getByRole('button', { name: 'Reset Voice A', exact: true }).click();
  expect(await page.evaluate(() => voiceState)).toEqual({});
  expect(await page.evaluate(() => effectState)).toEqual({ 'reverb.level': 89 });
  await page.evaluate(() => { editor.destroy(); effectEditor.destroy(); });
  await expect(page.locator('.midi-parameter-editor')).toHaveCount(0); expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`MIDI editor controls remain reachable at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const coarse = viewport.width !== 1440, page = await browser.newPage({ viewport, hasTouch: coarse, isMobile: coarse });
    try {
      const errors = await open(page);
      for (const title of ['Mix', 'Instrument', 'Expression & pedals', 'All MIDI controllers', 'SoundFont synthesis', 'RPN / NRPN & recovery']) await expand(page, title);
      await expand(page, 'SoundFont reverb', '#effects');
      const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
        controls: [...document.querySelectorAll('button,summary,select,input[type=number],input[type=search],input[type=range],input[type=checkbox]')]
          .filter(node => node.getClientRects().length && getComputedStyle(node).display !== 'none')
          .map(node => ({ label: node.getAttribute('aria-label') || node.textContent, height: node.getBoundingClientRect().height })) }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
      if (coarse) expect(sizes.controls.filter(control => control.height < 47.9)).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

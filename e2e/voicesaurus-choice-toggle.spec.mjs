import { test, expect } from '@playwright/test';

const html = `<!doctype html><html><head><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/src/instruments/voicesaurus/voicesaurus.css"><link rel="stylesheet" href="/toggle.css"></head><body class="voicesaurus-page"><div style="padding:18px;max-width:390px"><div id="nativeParameters"></div></div><script type="module">
import {mountParameters} from '/src/instruments/voicesaurus/native-parameters.js';
window.calls=[];window.audioCalls=0;
globalThis.AudioContext=class{constructor(){window.audioCalls++;throw Error('Unexpected Audio');}};
window.values={customShape:false,numeric:8.25,wave:'pulse',third:'b',numeric3:2,free:'type freely'};
window.rules={
customShape:{label:'Edit original tract parameters',choices:[false,true],description:'Use exact native tract values.'},
numeric:{label:'Native numeric pair',choices:[-3.5,8.25]},
wave:{label:'Glottal waveform',choices:['pulse','sine']},
third:{label:'Three-choice menu',choices:['a','b','c']},
numeric3:{label:'Three numeric values',choices:[0,2,7]},
free:{label:'Native free text',choices:['a','b'],freeText:true}
};
window.mount=()=>window.cleanup=mountParameters(document.querySelector('#nativeParameters'),window.rules,window.values,(key,value)=>{window.calls.push([key,value,typeof value]);window.values[key]=value;});
window.mount();window.ready=true;
</script></body></html>`;

test('two-option voice parameters use native typed switches with keyboard and flag reflection', async ({ page }) => {
  await page.route('**/voicesaurus-parameters-fixture', route => route.fulfill({ contentType:'text/html', body:html.replace('<link rel="stylesheet" href="/toggle.css">','') }));
  await page.goto('/voicesaurus-parameters-fixture');
  await page.waitForFunction(() => window.ready);
  const group = label => page.getByRole('group', { name:label, exact:true });
  await expect(page.locator('.native-param.is-toggle')).toHaveCount(3);
  await expect(page.locator('#param-customShape')).toHaveAttribute('type','hidden');
  const off=group('Edit original tract parameters').getByRole('button',{name:'Off',exact:true});
  const on=group('Edit original tract parameters').getByRole('button',{name:'On',exact:true});
  await expect(off).toHaveAttribute('aria-pressed','true');
  await on.click();
  expect(await page.evaluate(()=>window.calls.at(-1))).toEqual(['customShape',true,'boolean']);
  await group('Native numeric pair').getByRole('button',{name:'-3.5',exact:true}).click();
  expect(await page.evaluate(()=>window.calls.at(-1))).toEqual(['numeric',-3.5,'number']);
  await group('Glottal waveform').getByRole('button',{name:'sine',exact:true}).click();
  expect(await page.evaluate(()=>window.calls.at(-1))).toEqual(['wave','sine','string']);
  await off.focus();await off.press('Space');
  expect(await page.evaluate(()=>window.calls.at(-1))).toEqual(['customShape',false,'boolean']);
  await on.focus();await on.press('Enter');
  expect(await page.evaluate(()=>window.calls.at(-1))).toEqual(['customShape',true,'boolean']);
  await expect(off).toHaveAttribute('aria-pressed','false');
  await expect(on).toHaveAttribute('aria-pressed','true');

  const beforeReflect=await page.evaluate(()=>window.calls.length);
  await page.evaluate(()=>{const field=document.querySelector('#param-customShape');field.value='false';field.dispatchEvent(new Event('native-parameter-reflect'));});
  await expect(off).toHaveAttribute('aria-pressed','true');
  await expect(on).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>window.calls.length)).toBe(beforeReflect);
  expect(await page.locator('#param-third').evaluate(el=>el.tagName)).toBe('SELECT');
  await expect(page.locator('#param-numeric3')).toHaveAttribute('type','range');
  await expect(page.locator('#param-free')).toHaveAttribute('type','text');
  await expect(page.locator('#param-free')).toHaveValue('type freely');

  const beforeDestroy=await page.evaluate(()=>window.calls.length);
  await page.evaluate(()=>{const button=document.querySelector('.native-param.is-toggle button'),field=document.querySelector('#param-customShape');window.cleanup();button.click();field.value='true';field.dispatchEvent(new Event('change'));});
  expect(await page.evaluate(()=>window.calls.length)).toBe(beforeDestroy);
  await expect(page.locator('#nativeParameters > *')).toHaveCount(0);
  await page.evaluate(()=>{window.values.customShape=true;window.mount();});
  await expect(group('Edit original tract parameters').getByRole('button',{name:'On',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>window.audioCalls)).toBe(0);

  await page.setViewportSize({width:390,height:844});
  const geometry=await page.locator('.native-param.is-toggle button').evaluateAll(buttons=>buttons.map(button=>{const rect=button.getBoundingClientRect();return{width:rect.width,height:rect.height,right:rect.right,scroll:button.scrollWidth,client:button.clientWidth};}));
  for(const button of geometry){expect(button.width).toBeGreaterThanOrEqual(24);expect(button.height).toBeGreaterThanOrEqual(28);expect(button.right).toBeLessThanOrEqual(390);expect(button.scroll).toBeLessThanOrEqual(button.client);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { encodeSoundFont, parseSoundFont, generateSample } from '../src/site/sound-fonts/soundfont.js';
import { createHash } from 'node:crypto';

const freeBanks=JSON.parse(await readFile(new URL('../assets/sound-fonts/catalog.json',import.meta.url),'utf8'));

async function open(page) {
  await page.goto('/sound-fonts.html');
  await expect(page.locator('#fontCount')).toHaveText('3');
  await expect(page.locator('#selectedName')).toHaveText('Glass Signals');
}
function bank() {
  return Buffer.from(encodeSoundFont({name:'Imported test bell',author:'Test maker',license:'Test fixture',samples:[{name:'Bell',data:generateSample({kind:'glass'}),sampleRate:22050,rootKey:60,lowKey:0,highKey:127}]}));
}
function wav() {
  const data=generateSample({kind:'warm',duration:.5,sampleRate:22050}), result=Buffer.alloc(44+data.length*2);
  result.write('RIFF'); result.writeUInt32LE(result.length-8,4); result.write('WAVEfmt ',8); result.writeUInt32LE(16,16);
  result.writeUInt16LE(1,20); result.writeUInt16LE(1,22); result.writeUInt32LE(22050,24); result.writeUInt32LE(44100,28);
  result.writeUInt16LE(2,32); result.writeUInt16LE(16,34); result.write('data',36); result.writeUInt32LE(data.length*2,40);
  data.forEach((x,i)=>result.writeInt16LE(Math.round(x*32767),44+i*2)); return result;
}

test('create, export, favorite and reload a real SoundFont',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Make a font'}).click();
  await page.getByLabel('Font name',{exact:true}).fill('Moss Bells');
  await page.getByRole('button',{name:'Create sound font'}).click();
  await expect(page.locator('#selectedName')).toHaveText('Moss Bells');
  await expect(page.locator('#fontCount')).toHaveText('4');
  await page.getByRole('button',{name:'Add to favorites',exact:true}).click();
  await expect(page.locator('#favoriteButton')).toHaveAttribute('aria-pressed','true');
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download SF2'}).click();
  const download=await downloading;
  expect(download.suggestedFilename()).toBe('Moss-Bells.sf2');
  const parsed=parseSoundFont(await readFile(await download.path()));
  expect(parsed.name).toBe('Moss Bells'); expect(parsed.samples[0].data.length).toBe(44100);
  await page.reload();
  await expect(page.locator('#fontCount')).toHaveText('4');
  await expect(page.locator('#selectedName')).toHaveText('Moss Bells');
  await expect(page.locator('#favoriteButton')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-view=collection]').click();
  await page.getByRole('searchbox').fill('missing sound');
  await expect(page.locator('#emptyState')).toBeVisible();
  await page.getByRole('searchbox').fill('Moss');
  await expect(page.locator('.sf-font-row')).toHaveCount(1);
});

test('imports SF2, rejects invalid files, and keeps source links distinct',async({page})=>{
  await open(page);
  await page.locator('#fontFiles').setInputFiles({name:'bank.sf2',mimeType:'application/octet-stream',buffer:bank()});
  await expect(page.locator('#selectedName')).toHaveText('Imported test bell');
  await expect(page.locator('#fontCount')).toHaveText('4');
  await page.locator('#fontFiles').setInputFiles({name:'broken.sf2',mimeType:'application/octet-stream',buffer:Buffer.from('Not a font')});
  await expect(page.locator('#error')).toContainText('broken.sf2');
  await expect(page.locator('#fontCount')).toHaveText('4');
  await page.getByRole('button',{name:'Save a link'}).click();
  await page.locator('#linkName').fill('A future instrument');
  await page.locator('#linkUrl').fill('https://example.org/sounds');
  await page.getByRole('button',{name:'Add to collection'}).click();
  await expect(page.locator('#selectedName')).toHaveText('A future instrument');
  await expect(page.locator('#linkOnlyNotice')).toBeVisible();
  await expect(page.locator('#downloadButton')).toBeHidden();
  await expect(page.locator('#sourceLink')).toHaveAttribute('href','https://example.org/sounds');
  await page.reload();
  await expect(page.locator('#fontCount')).toHaveText('5');
  await expect(page.locator('#selectedName')).toHaveText('A future instrument');
});

test('creates a font from uploaded audio and canceling removal preserves it',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Workshop',exact:true}).click();
  await page.getByRole('radio',{name:/Your sample/}).check();
  await page.locator('#sampleFile').setInputFiles({name:'recording.wav',mimeType:'audio/wav',buffer:wav()});
  await expect(page.locator('#sampleInfo')).toContainText('recording.wav');
  await page.locator('#fontName').fill('My recording');
  await page.getByRole('button',{name:'Create sound font'}).click();
  await expect(page.locator('#selectedName')).toHaveText('My recording');
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download SF2'}).click();
  const font=parseSoundFont(await readFile(await (await downloading).path()));
  expect(font.samples[0].data.length).toBe(11025);
  expect(Math.max(...font.samples[0].data.map(Math.abs))).toBeGreaterThan(.05);
  await page.getByRole('button',{name:'Remove from collection'}).click();
  await page.getByRole('button',{name:'Keep it'}).click();
  await expect(page.locator('#fontCount')).toHaveText('4');
  await page.getByRole('button',{name:'Remove from collection'}).click();
  await page.getByRole('button',{name:'Remove',exact:true}).click();
  await expect(page.locator('#fontCount')).toHaveText('3');
  await page.getByRole('button',{name:'Remove from collection'}).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#fontCount')).toHaveText('3');
});

test('audio requires explicit arming, produces finite output, and stops',async({page})=>{
  await page.addInitScript(()=>{
    window.audioContexts=[]; window.audioAnalysers=[];
    const Original=window.AudioContext;
    window.AudioContext=class extends Original {
      constructor(...args){super(...args);window.audioContexts.push(this);}
      createAnalyser(){const analyser=super.createAnalyser();window.audioAnalysers.push(analyser);return analyser;}
    };
  });
  await open(page);
  await expect(page.locator('.masthead')).toHaveClass(/has-performance-header/);
  await expect(page.locator('.header-io-controls #audioButton')).toHaveCount(1);
  await page.getByRole('button',{name:'Preview sound'}).click();
  expect(await page.evaluate(()=>window.audioContexts.length)).toBe(0);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  // Focus remains on the Audio button: physical pitched keys must still work.
  await page.keyboard.down('q');
  await expect(page.locator('.sf-key.is-playing')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>{
    let peak=0;
    for(const analyser of window.audioAnalysers) {const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);for(const x of data){if(!Number.isFinite(x))return -1;peak=Math.max(peak,Math.abs(x));}}
    return peak;
  })).toBeGreaterThan(.04);
  await page.keyboard.up('q');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>{
    const analyser=window.audioAnalysers[0],data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));
  })).toBeLessThan(.00001);
  await page.locator('#auditionButton').click();
  await expect.poll(()=>page.evaluate(()=>{
    const analyser=window.audioAnalysers[0],data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));
  })).toBeGreaterThan(.04);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  await expect.poll(()=>page.evaluate(()=>{
    const analyser=window.audioAnalysers[0],data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);return Math.max(...data.map(Math.abs));
  })).toBeLessThan(.00001);
});

test('previously silent presets preview on selection and with the Preview button',async({page})=>{
  await page.addInitScript(()=>{
    window.previewAnalysers=[];
    const Original=window.AudioContext;
    window.AudioContext=class extends Original {
      createAnalyser(){const analyser=super.createAnalyser();window.previewAnalysers.push(analyser);return analyser;}
    };
  });
  await open(page);
  await page.locator('#enableAudio').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
  const peak=()=>page.evaluate(()=>{
    const analyser=window.previewAnalysers[0],data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);
    return data.every(Number.isFinite)?Math.max(...data.map(Math.abs)):-1;
  });
  for(const program of [78,125,126]) {
    await page.locator(`[data-preset="timgm6mb:0:${program}"]`).click();
    await expect.poll(peak,{intervals:[50]}).toBeGreaterThan(.01);
    await page.locator('#stopButton').click();
    await expect.poll(peak,{intervals:[50]}).toBeLessThan(.00001);
    await page.locator('#auditionButton').click();
    await expect.poll(peak,{intervals:[50]}).toBeGreaterThan(.01);
    await page.locator('#stopButton').click();
    await expect.poll(peak,{intervals:[50]}).toBeLessThan(.00001);
  }
});

test('explore exposes every preset before downloads and selects by bank/program',async({page})=>{
  const downloads=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('.sf2'))downloads.push(request.url());});
  await open(page);
  await expect(page.locator('.sf-preset-card')).toHaveCount(143);
  expect(downloads).toHaveLength(0);
  await page.locator('#familySelect').selectOption('Pianos');
  await expect(page.locator('.sf-preset-card')).toHaveCount(8);
  await page.getByRole('button',{name:'Acoustic Grand Piano Pianos · TimGM6mb',exact:true}).click();
  await expect(page.locator('#selectedName')).toHaveText('TimGM6mb');
  await expect(page.locator('#presetSelect option:checked')).toHaveText('Piano 1 · 0:0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#exploreBrowser')).toBeVisible();
  await page.locator('#nextPreset').click();
  await expect(page.locator('#presetSelect option:checked')).toHaveText('Piano 2 · 0:1');
  await page.locator('#familySelect').selectOption('');
  await page.locator('#presetSearch').fill('ocarina');
  await expect(page.locator('.sf-preset-card')).toHaveCount(2);
  await page.locator('[data-preset="freepats-ocarina:0:0"]').click();
  await expect(page.locator('#selectedName')).toHaveText('Ocarina');
  await expect(page.getByRole('button',{name:'Play C4, key Z',exact:true})).toBeEnabled();
  expect(downloads).toHaveLength(2);
});

test('the latest preset wins during a shared bank download and leaving explore cancels selection',async({page})=>{
  await open(page);
  let pending, requests=0;
  const bank=freeBanks[0];
  await page.route(`**/${bank.file}`,route=>{requests++;pending=route;});
  await page.locator('[data-preset="timgm6mb:0:0"]').click();
  await expect.poll(()=>Boolean(pending)).toBe(true);
  await page.locator('[data-preset="timgm6mb:0:1"]').click();
  await pending.continue();
  await expect(page.locator('#presetSelect option:checked')).toHaveText('Piano 2 · 0:1');
  expect(requests).toBe(1);
  const second=freeBanks[1]; pending=null;
  await page.route(`**/${second.file}`,route=>{pending=route;});
  await page.locator(`[data-preset="${second.id}:${second.presets[0].bank}:${second.presets[0].program}"]`).click();
  await expect.poll(()=>Boolean(pending)).toBe(true);
  await page.locator('[data-view=workshop]').click();
  await pending.continue();
  await expect(page.locator('#fontCount')).toHaveText('5');
  await expect(page.locator('#workshopView')).toBeVisible();
  await expect(page.locator('#presetSelect option:checked')).toHaveText('Piano 2 · 0:1');
});

test('free banks load on demand, retain credits, export unchanged and survive reload',async({page})=>{
  const downloads=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('.sf2'))downloads.push(request.url());});
  await open(page);
  await page.getByRole('button',{name:'Find sounds',exact:true}).click();
  await expect(page.locator('.sf-bank')).toHaveCount(freeBanks.length);
  expect(downloads).toHaveLength(0);
  for(const [index,bank] of freeBanks.entries()) {
    await page.getByRole('button',{name:'Find sounds',exact:true}).click();
    await page.getByRole('button',{name:`Add ${bank.name} to collection`,exact:true}).click();
    await expect(page.locator('#selectedName')).toHaveText(bank.name);
    await expect(page.locator('#selectedAuthor')).toHaveText(bank.author);
    await expect(page.locator('#selectedLicense')).toHaveText(bank.license);
    await expect(page.locator('#presetSelect option')).toHaveCount(bank.presetCount);
    await expect(page.locator('#fontCount')).toHaveText(String(index+4));
    const pending=page.waitForEvent('download');
    await page.locator('#downloadButton').click();
    const bytes=await readFile(await (await pending).path());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(bank.sha256);
    await page.getByRole('button',{name:'Find sounds',exact:true}).click();
    await page.getByRole('button',{name:`Open ${bank.name}`,exact:true}).click();
    await expect(page.locator('#fontCount')).toHaveText(String(index+4));
  }
  expect(downloads).toHaveLength(freeBanks.length);
  await page.reload();
  await expect(page.locator('#fontCount')).toHaveText(String(freeBanks.length+3));
  await page.getByRole('button',{name:'Find sounds',exact:true}).click();
  await expect(page.locator('.sf-bank button')).toHaveText(freeBanks.map(()=>'Open in collection'));
});

test('a delayed bank save preserves a newer workshop selection',async({page})=>{
  await open(page);
  const bank=freeBanks[1]; let pending;
  await page.route(`**/${bank.file}`,route=>{pending=route;});
  await page.getByRole('button',{name:'Find sounds',exact:true}).click();
  await page.getByRole('button',{name:`Add ${bank.name} to collection`,exact:true}).click();
  await expect.poll(()=>Boolean(pending)).toBe(true);
  await page.getByRole('button',{name:'Workshop',exact:true}).click();
  await pending.continue();
  await expect(page.locator('#fontCount')).toHaveText('4');
  await expect(page.locator('#workshopView')).toBeVisible();
  await expect(page.locator('#selectedName')).toHaveText('Glass Signals');
});

test('failed bank requests leave the library unchanged and can be retried',async({page})=>{
  await open(page);
  const bank=freeBanks[1];
  await page.route(`**/${bank.file}`,route=>route.fulfill({status:503,body:'Unavailable'}));
  await page.getByRole('button',{name:'Find sounds',exact:true}).click();
  const add=page.getByRole('button',{name:`Add ${bank.name} to collection`,exact:true});
  await add.click();
  await expect(page.locator('#error')).toContainText(`Could not load ${bank.name}`);
  await expect(add).toBeEnabled();
  await expect(page.locator('#fontCount')).toHaveText('3');
  await page.unroute(`**/${bank.file}`);
  await add.click();
  await expect(page.locator('#selectedName')).toHaveText(bank.name);
  await expect(page.locator('#fontCount')).toHaveText('4');
});

test('storage failure stays usable and rejects unsafe source links visibly',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined}));
  await open(page);
  await expect(page.locator('#storageStatus')).toContainText('Temporary session');
  await expect(page.locator('#error')).toContainText('before closing this tab');
  await page.locator('[data-view=collection]').click();
  await page.getByRole('button',{name:'Save a link'}).click();
  await page.locator('#linkName').fill('Unsafe link');
  await page.locator('#linkUrl').fill('javascript:alert(1)');
  await page.getByRole('button',{name:'Add to collection'}).click();
  await expect(page.locator('#linkError')).toContainText('http or https');
  await expect(page.locator('#fontCount')).toHaveText('3');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download SF2'}).click();
  expect(parseSoundFont(await readFile(await (await downloading).path())).name).toBe('Glass Signals');
});

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
  test(`responsive collection and workshop ${viewport.width}x${viewport.height}`,async({page})=>{
    await page.setViewportSize(viewport);
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await open(page);
    for(const section of ['Explore','Collection','Workshop','Find sounds']) {
      await page.locator('.sf-nav button').filter({hasText:section}).click();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      expect(overflow).toBe(false);
      await page.locator('#audioButton').scrollIntoViewIfNeeded();
      await expect(page.locator('#audioButton')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}

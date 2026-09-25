import { choosePugglerPattern as choosePattern } from './helpers/puggler-pattern.mjs';
import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { COLLAGE_ATLASES } from '../src/instruments/puggler/puggler-collage.js';
import { PATTERNS } from '../src/instruments/puggler/puggler.js';
import { SKINS } from '../src/instruments/puggler/puggler-skins.js';
import { LIGHTING_SCENES } from '../src/instruments/puggler/puggler-lighting.js';
import { VOCAL_CHARACTERS } from '../src/instruments/puggler/puggler-vocals.js';

const atlasCount = Object.keys(COLLAGE_ATLASES).length;

const state = page => page.evaluate(() => window.__puggler.snapshot());
const range = (page, id, value) => page.locator(`#${id}`).evaluate((element, next) => {
  element.value = String(next);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

async function cast(page, name) {
  const wanted=name==='trio'?[0,1,2]:name.split('-').map(n=>['puggler','roxy','moss'].indexOf(n));
  // Add before removing so there is always at least one rider.
  for(const owner of wanted)if(!(await state(page)).activeIds.includes(owner))await page.locator(`#rider-${owner}`).click();
  for(const owner of (await state(page)).activeIds)if(!wanted.includes(owner))await page.locator(`#rider-${owner}`).click();
}
async function phrase(page, value){await choosePattern(page,value==='loop'?(await state(page)).pattern:`phrase:${value}`);}

async function openShow(page) {
  await page.goto('puggler.html');
  await expect.poll(() => page.evaluate(() => Boolean(window.__puggler))).toBe(true);
  await expect.poll(async () => (await state(page)).collage.ready).toBe(true);
}

async function releaseAndSettle(page, keys) {
  for (const key of keys) await page.keyboard.up(key);
  await page.waitForTimeout(650);
}

test('Puggler starts a silent six-object trio verse with automatic passing', async ({ page }) => {
  await openShow(page);
  expect(await state(page)).toMatchObject({
    count: 6, pattern: 'many-6', cast: 'trio', autoRide: true, phrase: 'verse',
    tempo: 360, loft: 1.8, chaos: 40, riders: 3, running: true, audioOn: false,
  });
  await expect(page.locator('#pattern')).toBeEnabled();
  await expect(page.locator('#pattern')).toHaveValue('phrase:verse');
  await expect(page.locator('#passMode')).toBeEnabled();
  await expect(page.locator('#keyboardControls .rider-toggle')).toHaveCount(3);
  await expect(page.locator('#objectControls .object-row')).toHaveCount(6);
  await expect(page.locator('#mode, #stageBadge, #stageEvent, #voiceMeters, .puggler-score, .phrase-strip, #playerPicker')).toHaveCount(0);
  await expect(page.getByText('Audio is off — turn it on to hear playback')).not.toBeVisible();
  await expect.poll(async () => (await state(page)).passes).toBeGreaterThan(1);
  await expect.poll(async () => (await state(page)).catches).toBeGreaterThan(1);
  const silent = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 });
  expect(silent.summary.maxPeak).toBeLessThan(.001);
  expect((await state(page)).audioOn).toBe(false);
});

test('Puggler exposes every compatible pattern from automatic rhythm forms and selects it immediately', async ({ page }) => {
  test.setTimeout(60000);
  await openShow(page);
  for (const count of Array.from({ length: 10 }, (_, i) => i + 1)) {
    await range(page,'count',String(count));
    const patterns = PATTERNS.filter(pattern => pattern.count === count);
    expect(patterns.length).toBeGreaterThan(1);
    for (const form of ['verse', 'evolve']) {
      await phrase(page,form);
      const menu = page.locator('#pattern');
      await expect(menu).toBeEnabled();
      await expect(menu).toHaveValue(`phrase:${form}`);
      expect(await menu.locator('option:enabled').evaluateAll(options => options.map(option => option.value)))
        .toEqual(['phrase:verse','phrase:evolve',...patterns.map(pattern => pattern.id)]);
      // Even the previously stored pattern must be selectable from phrases.
      const before = await state(page);
      await choosePattern(page,before.pattern);
      expect((await state(page)).phrase).toBe('loop');
      expect(await state(page)).toMatchObject({ count, pattern: before.pattern, phrase: 'loop', running: true, audioOn: false });
    }
    for (const pattern of patterns) {
      await choosePattern(page,pattern.id);
      expect(await state(page)).toMatchObject({ count, pattern: pattern.id, phrase: 'loop', running: true, audioOn: false });
    }
  }
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await page.locator('#playButton').click();
  await phrase(page,'evolve');
  await choosePattern(page,'shower-10');
  expect(await state(page)).toMatchObject({ pattern: 'shower-10', phrase: 'loop', running: false, audioOn: true });
});

test('Puggler separates explicit Audio, output level, mute, pause, and teardown', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openShow(page);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  const sound = await sampleAudioEnvelope(page, { durationMs: 1400, intervalMs: 50 });
  expect(sound.summary.finite).toBe(true);
  expect(sound.summary.maxPeak).toBeGreaterThan(.003);
  expect(sound.summary.clippedSamples).toBe(0);
  const beforePosters = await state(page);
  await page.locator('#postersButton').click();
  const afterPosters = await state(page);
  expect(afterPosters.posterSeed).not.toBe(beforePosters.posterSeed);
  expect(afterPosters.time).toBeGreaterThanOrEqual(beforePosters.time);
  expect(afterPosters).toMatchObject({ running: true, audioOn: true });
  await range(page, 'level', 0);
  const quiet = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 50 });
  expect(quiet.samples.at(-1).peak).toBeLessThan(.001);
  await range(page, 'level', .35);
  await page.locator('#playButton').click();
  const paused = await state(page);const pausedTime=paused.time;
  await page.waitForTimeout(300);
  expect((await state(page)).time).toBeGreaterThan(pausedTime);expect((await state(page)).beat).toBe(paused.beat);
  expect((await state(page)).audioOn).toBe(true);
  // Audio remains armed for audience reactions during a juggling pause.
  const crowd=await sampleAudioEnvelope(page,{durationMs:7000,intervalMs:80});
  expect(crowd.summary.maxPeak).toBeGreaterThan(.003);expect(crowd.summary.clippedSamples).toBe(0);
  await page.locator('#playButton').click();
  await page.locator('#audioButton').click();
  expect(await state(page)).toMatchObject({ running: true, audioOn: false });
  const mutedTime = (await state(page)).time;
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(mutedTime);
  const muted = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 50 });
  expect(muted.samples.at(-1).peak).toBeLessThan(.001);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  expect(await state(page)).toMatchObject({ disposed: true, attacks: 0, crowd: { disposed: true }, pyro: { disposed: true, active: false } });
  const disposedTime = (await state(page)).time;
  await page.waitForTimeout(200);
  expect((await state(page)).time).toBe(disposedTime);
  expect(errors).toEqual([]);
});

test('Puggler gives every solo character its own recorded vocal treatment', async ({ page }) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openShow(page);await range(page,'count','1');
  await choosePattern(page,'single');await page.locator('#autoRide').uncheck();
  await range(page,'chaos',0);await range(page,'assist',120);await range(page,'tempo',180);
  await page.locator('#riffs0').selectOption('oi');await range(page,'impacts',0);await range(page,'boo',0);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  for(const character of VOCAL_CHARACTERS){
    await page.locator('#skin').selectOption(character.skin);
    await cast(page,['puggler','roxy','moss'][character.owner]);
    await expect.poll(async()=>(await state(page)).vocals.some(v=>v.character===character.id&&v.speaker===character.owner)).toBe(true);
    const sound=await sampleAudioEnvelope(page,{durationMs:400,intervalMs:40});
    expect(sound.summary.finite).toBe(true);expect(sound.summary.clippedSamples).toBe(0);
    expect(await state(page)).toMatchObject({skin:character.skin,running:true,audioOn:true});
  }
  await page.locator('#riffs0').selectOption('woo');
  await expect.poll(async()=>(await state(page)).vocals.some(v=>v.character==='future-quor'&&v.role==='woo')).toBe(true);
  const sound=await sampleAudioEnvelope(page,{durationMs:1500,intervalMs:50});
  expect(sound.summary.maxPeak).toBeGreaterThan(.003);expect(sound.summary.clippedSamples).toBe(0);
  await page.locator('#audioButton').click();
  expect((await state(page)).vocals).toEqual([]);expect(errors).toEqual([]);
});

test('Puggler passes keep the thrower voice for the whole flight then give the receiver the next phrase', async ({ page }) => {
  await openShow(page);await range(page,'count','1');
  await choosePattern(page,'single');await cast(page,'roxy-moss');
  await page.locator('#autoRide').uncheck();await range(page,'tempo',100);await range(page,'chaos',0);await range(page,'assist',120);
  await page.locator('#riffs0').selectOption('oi');await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  // Sample the 350-ms launch window rather than aliasing it with the default
  // one-second polling backoff (Audio startup may join anywhere in the cycle).
  await expect.poll(async()=>{const s=await state(page);return s.objects[0].phase==='air'&&s.time-s.objects[0].start<.35&&s.objects[0].voiceOwner===1&&s.vocals[0]?.character==='punk-roxy';},{timeout:8000,intervals:[25]}).toBe(true);
  const first=await state(page),flight=first.objects[0].start;
  const snapshots=await page.evaluate(async()=>{
    const samples=[];const start=performance.now();
    while(performance.now()-start<2300){samples.push(window.__puggler.snapshot());await new Promise(resolve=>setTimeout(resolve,25));}
    return samples;
  });
  const sameFlight=snapshots.filter(s=>s.objects[0].start===flight&&s.objects[0].phase==='air'&&s.vocals.length);
  expect(sameFlight.length).toBeGreaterThan(1);
  expect(sameFlight.every(s=>s.vocals[0].character==='punk-roxy'&&s.vocals[0].speaker===1)).toBe(true);
  expect(new Set(sameFlight.map(s=>s.vocals[0].startedAt)).size).toBe(1);
  await expect.poll(async()=>(await state(page)).vocals.some(v=>v.character==='punk-moss'&&v.speaker===2)).toBe(true);
  expect(await state(page)).toMatchObject({running:true,audioOn:true});
});

test('shared arrow keys steer all active riders, never silently arm Audio, and release on blur',async({page})=>{
    await openShow(page);await page.locator('#playButton').click();await range(page,'rideSpeed',0);await page.locator('#stage').focus();
    const before=await state(page);await page.keyboard.down('ArrowRight');
    await expect.poll(async()=>(await state(page)).players.every((p,i)=>p.x>before.players[i].x+25)).toBe(true);
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('ArrowRight');
    expect(await state(page)).toMatchObject({audioOn:false,running:false,beat:before.beat,steeringTargets:[null,null,null]});
  });

  test('name controls cover every solo and noncontiguous duo without changing identities',async({page})=>{
    await openShow(page);await page.locator('#playButton').click();
    for(const [name,ids] of Object.entries({'puggler':[0],'roxy':[1],'moss':[2],'puggler-roxy':[0,1],'puggler-moss':[0,2],'roxy-moss':[1,2],'trio':[0,1,2]})){
      await cast(page,name);expect((await state(page)).activeIds).toEqual(ids);
      expect((await state(page)).objects.every(o=>ids.includes(o.owner))).toBe(true);
      if(ids.length===1)await expect(page.locator('#passingField')).toBeHidden();else await expect(page.locator('#passingField')).toBeVisible();
    }
    await expect(page.locator('.key-grid, #cast, #phrase')).toHaveCount(0);
  });

test('Puggler names below the stage toggle the cast by click or number key', async ({ page }) => {
  await openShow(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#keyboardControls .rider-toggle')).toHaveCount(3);
  await page.locator('#rider-1').click();
  expect((await state(page)).activeIds).toEqual([0, 2]);
  expect((await state(page)).cast).toBe('puggler-moss');
  await expect(page.locator('#rider-1')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#stage').focus();
  await page.keyboard.press('Digit1');
  expect((await state(page)).activeIds).toEqual([2]);
  await expect(page.locator('#rider-2')).toBeDisabled();
  await page.keyboard.press('Digit3');
  expect((await state(page)).activeIds).toEqual([2]);
  await page.keyboard.press('Digit2');
  expect((await state(page)).activeIds).toEqual([1, 2]);
  await page.locator('#rider-0').focus();
  await page.keyboard.press('Space');
  expect(await state(page)).toMatchObject({ cast: 'trio', running: false, audioOn: false });
  for (const id of [0, 1, 2]) await expect(page.locator(`#rider-${id}`)).toHaveAttribute('aria-pressed', 'true');
  await cast(page,'roxy');
  await expect(page.locator('#rider-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rider-0')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).objects.every(object => object.owner === 1)).toBe(true);
});

test('ride speed and juggling tempo are separate shared knobs, and pattern arrow cycles both forms and loops',async({page})=>{
    await openShow(page);await range(page,'rideSpeed',0);await range(page,'chaos',0);await range(page,'tempo',200);
    const before=await state(page);await range(page,'rideSpeed',2.5);
    await expect.poll(async()=>(await state(page)).players.every((p,i)=>p.ridePhase>before.players[i].ridePhase+.3)).toBe(true);
    expect((await state(page)).tempo).toBe(200);
    const ride=(await state(page)).rideSpeed;await range(page,'tempo',900);expect((await state(page)).rideSpeed).toBe(ride);
    await choosePattern(page,'phrase:verse');await page.locator('#nextPattern').click();
    expect((await state(page)).phrase).toBe('evolve');await page.locator('#nextPattern').click();
    expect((await state(page)).phrase).toBe('loop');expect((await state(page)).audioOn).toBe(false);
    const ids=await page.locator('#pattern option').evaluateAll(nodes=>nodes.map(n=>n.value));
    await choosePattern(page,ids.at(-1));await page.locator('#nextPattern').click();
    await expect(page.locator('#pattern')).toHaveValue('phrase:verse');
  });

test('throwing to the audience returns a different sound object on a rising arc', async ({ page }) => {
  await openShow(page);
  await cast(page,'puggler');
  await range(page,'count','1');
  await phrase(page,'loop');
  await choosePattern(page,'single');
  await range(page, 'chaos', 0);
  await range(page, 'assist', 120);
  await page.locator('#stage').focus();
  const before = await state(page);
  await page.keyboard.press('g');
  await expect.poll(async () => (await state(page)).objects.some(object => object.phase === 'audience')).toBe(true);
  const outward = (await state(page)).objects[0];
  expect((await state(page)).players[0].lastCrowdThrow).toBeGreaterThanOrEqual(before.time);
  await expect.poll(async () => (await state(page)).crowdCatches).toBeGreaterThan(before.crowdCatches);
  await expect.poll(async () => {
    const object = (await state(page)).objects[0];
    return object.phase === 'replacement' && object.vy > 0 && object.prop !== outward.prop;
  }).toBe(true);
  const replacement = (await state(page)).objects[0];
  expect(replacement).toMatchObject({ id: outward.id, drum: outward.drum, riff: outward.riff, owner: 0 });
  await expect(page.locator('#object0')).toHaveValue(replacement.prop);
  const catchesBeforeReturn = (await state(page)).catches;
  await expect.poll(async () => (await state(page)).catches).toBeGreaterThan(catchesBeforeReturn);
  const beforeButton = (await state(page)).crowdCatches;
  await page.locator('#crowdButton').click();
  await expect.poll(async () => (await state(page)).crowdCatches).toBeGreaterThan(beforeButton);
  expect(await state(page)).toMatchObject({ count: 1, running: true, audioOn: false });
});

test('ten live objects keep their drum and riff edits across phrase and speed changes', async ({ page }) => {
  await openShow(page);
  await range(page, 'chaos', 0);
  await range(page,'count','10');
  await expect(page.locator('#objectControls .object-row')).toHaveCount(10);
  const before = (await state(page)).time;
  await page.locator('#object9').selectOption('plushrat');
  await page.locator('#drums9').selectOption('snare');
  await page.locator('#riffs9').selectOption('woo');
  await page.locator('#object0').selectOption('mic');
  await page.locator('#drums0').selectOption('crash');
  await page.locator('#riffs0').selectOption('oi');
  const edited = await state(page);
  expect(edited.objects[9]).toMatchObject({ prop: 'plushrat', drum: 'snare', riff: 'woo' });
  expect(edited.objects[0]).toMatchObject({ prop: 'mic', drum: 'crash', riff: 'oi' });
  expect(edited.time).toBeGreaterThan(before);
  expect(edited).toMatchObject({ running: true, audioOn: false });
  const available = await page.locator('#object9 option').evaluateAll(options => options.map(option => option.value));
  for (const id of ['guitar', 'cassette', 'skateboard', 'vinyl', 'mic', 'cone', 'glowstick', 'plushrat', 'icecream', 'axe', 'deadcat', 'hydrant', 'pickle', 'violin', 'skull', 'banana', 'snake', 'plant', 'plunger', 'cd', 'vhs']) expect(available).toContain(id);
  expect(available).not.toContain('mushroom');
  const newProps = ['icecream', 'hydrant', 'snake', 'deadcat', 'vhs'];
  const selectedProps = await page.evaluate(ids => {
    for (const [slot, id] of ids.entries()) {
      const select = document.getElementById(`object${slot}`);
      select.value = id; select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return window.__puggler.snapshot().objects.slice(0, ids.length).map(object => object.prop);
  }, newProps);
  expect(selectedProps).toEqual(newProps);
  await phrase(page,'loop');
  await expect(page.locator('#pattern')).toBeEnabled();
  await choosePattern(page,'shower-10');
  expect(await state(page)).toMatchObject({ phrase: 'loop', pattern: 'shower-10' });
  await range(page, 'tempo', 1200);
  await range(page, 'loft', 3);
  expect(await state(page)).toMatchObject({ tempo: 1200, loft: 3, running: true });
  await expect.poll(async () => Math.max(...(await state(page)).objects.map(object => object.y))).toBeGreaterThan(1500);
  const fast = await state(page);
  for (const object of fast.objects) for (const key of ['x', 'y', 'vx', 'vy']) expect(Number.isFinite(object[key])).toBe(true);
  await phrase(page,'evolve');
  await expect(page.locator('#pattern')).toBeEnabled();
  await expect(page.locator('#pattern')).toHaveValue('phrase:evolve');
  await range(page,'count','5');
  await expect(page.locator('#objectControls .object-row')).toHaveCount(5);
  expect(await state(page)).toMatchObject({ count: 5, phrase: 'evolve', running: true, audioOn: false });
  await page.locator('#stage').focus();
  await page.keyboard.press('Space');
  expect((await state(page)).running).toBe(false);
  await page.keyboard.press('Space');
  expect((await state(page)).running).toBe(true);
  await page.locator('#resetButton').click();
  expect(await state(page)).toMatchObject({ count: 6, pattern: 'many-6', cast: 'trio', autoRide: true, phrase: 'verse', tempo: 360, loft: 1.8, chaos: 40, audioOn: false });
  expect((await state(page)).objects[0]).toMatchObject({ drum: 'object', riff: 'object' });
  await expect(page.locator('#pattern')).toBeEnabled();
  await expect(page.locator('#pattern')).toHaveValue('phrase:verse');
});

for (const path of ['puggler.html', 'dist-wax/puggler.html']) {
  test(`Puggler loads local photographic atlases without arming Audio: ${path}`, async ({ page }) => {
    const errors = [], atlases = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (/puggler\/.*-collage\.webp$/.test(response.url())) atlases.push(response.url()); });
    await page.goto(path);
    await expect.poll(() => page.evaluate(() => window.__puggler?.snapshot().collage.ready)).toBe(true);
    expect((await state(page)).collage).toMatchObject({ failed: 0, loaded: atlasCount, total: atlasCount });
    expect(atlases).toHaveLength(atlasCount);
    for (const url of atlases) expect(new URL(url).pathname).toMatch(path.startsWith('dist-wax/') ? /^\/dist-wax\/assets\/puggler\// : /^\/assets\/puggler\//);
    await expect.poll(async () => (await state(page)).catches).toBeGreaterThan(0);
    expect((await state(page)).audioOn).toBe(false);
    expect(errors).toEqual([]);
  });
}

test('Puggler keeps juggling with vector artwork when collage images are unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/puggler/*-collage.webp', route => route.abort());
  await page.goto('puggler.html');
  await expect.poll(() => page.evaluate(() => window.__puggler?.snapshot().collage.failed)).toBe(atlasCount);
  expect((await state(page)).collage).toMatchObject({ ready: false, loaded: 0, total: atlasCount });
  for(const skin of SKINS){
    const before=(await state(page)).catches;
    await page.locator('#skin').selectOption(skin.id);
    await expect.poll(async () => (await state(page)).catches).toBeGreaterThan(before);
  }
  expect(await state(page)).toMatchObject({ running: true, audioOn: false, disposed: false });
  expect(errors).toEqual([]);
});

for(const skin of SKINS)test(`Puggler ${skin.id} juggling hits animate a varied rear-view audience including two women and a baby`, async ({ page }) => {
  await openShow(page);
  await page.locator('#skin').selectOption(skin.id);
  await expect.poll(async () => (await state(page)).crowd.events).toBeGreaterThan(0);
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push((await state(page)).crowd.members);
    await page.waitForTimeout(80);
  }
  expect(new Set(samples[0].map(member => member.head))).toEqual(new Set(['dread','kid','hat','curls','punk','braids','ponytail','baby']));
  expect(new Set(samples[0].map(member => member.hand))).toEqual(new Set(['lighter','phone','palm','peace','horns',null]));
  expect(samples.every(members => members.find(member=>member.head==='baby').jump<=3)).toBe(true);
  expect(samples.some(members => Math.max(...members.map(m => m.energy)) > 0)).toBe(true);
  // A shared bounce would leave the same vertical displacement for everyone.
  expect(samples.some(members => Math.max(...members.map(m => m.jump)) - Math.min(...members.map(m => m.jump)) > 2)).toBe(true);
  expect((await state(page)).audioOn).toBe(false);
});

test('Puggler stage skins update cast and object artwork without disturbing an airborne act, Audio, or lights', async ({ page }, testInfo) => {
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await openShow(page);
  await range(page,'chaos',0);
  await expect(page.locator('#skin option')).toHaveCount(SKINS.length);
  await expect(page.locator('#lighting option')).toHaveCount(LIGHTING_SCENES.length);
  await expect.poll(async()=>(await state(page)).objects.filter(object=>object.phase==='air').length).toBeGreaterThan(0);
  for(const skin of SKINS){
    const transition=await page.evaluate(id=>{
      const before=window.__puggler.snapshot();
      const field=document.getElementById('skin');field.value=id;field.dispatchEvent(new Event('change',{bubbles:true}));
      const after=window.__puggler.snapshot();
      const labels=after.objects.map(object=>document.querySelector(`#object${object.id} option:checked`).textContent);
      return {before,after,labels};
    },skin.id);
    expect(transition.after.time).toBe(transition.before.time);
    expect(transition.after.beat).toBe(transition.before.beat);
    expect(transition.after.players).toEqual(transition.before.players);
    const physical=objects=>objects.map(({name,...object})=>object);
    expect(physical(transition.after.objects)).toEqual(physical(transition.before.objects));
    expect(transition.after).toMatchObject({skin:skin.id,riderNames:skin.riders,running:true,audioOn:false});
    for(let owner=0;owner<3;owner++)await expect(page.locator(`#rider-${owner}`)).toContainText(skin.riders[owner]);
    await expect(page.locator('#keyboardControls .rider-toggle span')).toHaveText(skin.riders);
    // The crowd may replace a dropped prop during later awaited UI assertions.
    expect(transition.labels).toEqual(transition.after.objects.map(object=>object.name));
    for(const scene of LIGHTING_SCENES){
      await page.locator('#lighting').selectOption(scene.id);
      expect(await state(page)).toMatchObject({lighting:scene.id,skin:skin.id,running:true,audioOn:false});
    }
    await page.locator('#stage').screenshot({path:testInfo.outputPath(`puggler-skin-${skin.id}.png`)});
  }
  await page.locator('#preset').selectOption('curbside-requiem');
  expect(await state(page)).toMatchObject({skin:'future',lighting:LIGHTING_SCENES.at(-1).id,running:true,audioOn:false});
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  await page.locator('#playButton').click();
  await page.locator('#skin').selectOption('history');
  expect(await state(page)).toMatchObject({skin:'history',running:false,audioOn:true});
  await page.locator('#resetButton').click();
  expect(await state(page)).toMatchObject({skin:'punk',lighting:'house',running:false,audioOn:true});
  expect(errors).toEqual([]);
});

for (const viewport of [{ width:390, height:844 }, { width:844, height:390 }]) {
  test(`Puggler phone ${viewport.width} allows native scrolling to the skin controls`, async ({ browser, baseURL }) => {
    const context=await browser.newContext({baseURL,viewport,hasTouch:true,isMobile:true});
    try {
      const page=await context.newPage();await openShow(page);
      // Scroll the controls below the stage, outside the canvas steering area.
      // Portrait uses the page; landscape has an independent left scroller.
      // Programmatic scrollIntoView can bypass overflow:hidden and miss this bug.
      const controls=await page.locator('.puggler-performance-controls').boundingBox();
      await page.mouse.move(controls.x+controls.width-5,Math.min(viewport.height-20,controls.y+80));
      await page.mouse.wheel(0,viewport.height*.6);
      await expect.poll(()=>page.evaluate(()=>{
        const controls=document.querySelector('.puggler-performance-controls');
        return getComputedStyle(controls).overflowY==='auto'?controls.scrollTop:scrollY;
      })).toBeGreaterThan(50);
      await page.locator('#skin').selectOption('future');
      await page.locator('#lighting').selectOption('sweep');
      expect(await state(page)).toMatchObject({skin:'future',lighting:'sweep',running:true,audioOn:false});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(2);
    } finally { await context.close(); }
  });
}

test('Puggler offers the new historical objects and fluorescent octopus through Things',async({page})=>{
  await openShow(page);
  await page.locator('#playButton').click();
  // Pause lets existing flights and crowd replacements finish. Changing form
  // re-racks the objects into hands so those events cannot replace a menu choice.
  await phrase(page,'loop');
  expect((await state(page)).objects.every(object=>object.phase==='held')).toBe(true);
  await page.locator('#skin').selectOption('history');
  await expect(page.locator('#rider-0')).toContainText('Cavewoman');
  for(const [id,name] of [['mic','Bones'],['banana','Ham hock'],['plushrat','Swaddled baby'],['skateboard','Harpsichord'],['bowling','Boulder'],['club','Wooden club']]){
    await page.locator('#object0').selectOption(id);
    expect((await state(page)).objects[0].name).toBe(name);
    await expect(page.locator('#object0 option:checked')).toHaveText(name);
  }
  await page.locator('#skin').selectOption('future');
  await page.locator('#object0').selectOption('fish');
  await expect(page.locator('#object0 option:checked')).toHaveText('Fluorescent octopus');
  expect((await state(page)).objects[0].name).toBe('Fluorescent octopus');
  expect(await state(page)).toMatchObject({running:false,audioOn:false});
  await page.locator('#playButton').click();
  await expect.poll(async()=>(await state(page)).objects.filter(object=>object.phase==='air').length).toBeGreaterThan(0);
});

test('Puggler accents juggling contacts with occasional pyrotechnics and releases their tails on pause', async ({ page }, testInfo) => {
  await openShow(page);
  expect((await state(page)).pyro.bursts).toBe(0);
  await page.waitForFunction(() => window.__puggler.snapshot().pyro.jets.some(jet => jet.energy > .45), null, { timeout: 15000 });
  const accent = await state(page);
  expect(accent.pyro.bursts).toBeGreaterThan(0);
  expect(accent.catches).toBeGreaterThan(0);
  expect(accent.pyro.particleCount).toBeLessThanOrEqual(48);
  expect(accent.pyro.nextBurstAt - accent.time).toBeGreaterThan(4);
  expect(accent.audioOn).toBe(false);
  await page.locator('#stage').screenshot({ path: testInfo.outputPath('puggler-pyrotechnics.png') });
  await page.locator('#playButton').click();
  const paused = await state(page);
  await expect.poll(async () => (await state(page)).pyro.active).toBe(false);
  expect((await state(page)).pyro.bursts).toBe(paused.pyro.bursts);
  expect(await state(page)).toMatchObject({ running: false, audioOn: false });
});

test('Puggler presets change riding and flyers, while paused riders keep balancing', async ({ page }) => {
  await openShow(page);
  const start = await state(page);
  const flyers = () => page.evaluate(async () => {
    const { posterLayout } = await import('./src/instruments/puggler/puggler-renderer.js');
    return posterLayout(window.__puggler.snapshot().posterSeed, 1030, 612);
  });
  const firstFlyers = await flyers();
  await page.locator('#preset').selectOption('moss');
  const slow = await state(page), nextFlyers = await flyers();
  expect(slow.rideSpeed).toBeLessThan(start.rideSpeed);
  expect(slow.ridePattern).not.toBe(start.ridePattern);
  expect(nextFlyers.map(flyer => flyer.bill)).not.toEqual(firstFlyers.map(flyer => flyer.bill));
  expect(nextFlyers.map(flyer => flyer.symbol)).not.toEqual(firstFlyers.map(flyer => flyer.symbol));
  expect(nextFlyers.map(flyer => [flyer.x, flyer.y])).not.toEqual(firstFlyers.map(flyer => [flyer.x, flyer.y]));
  await page.locator('#preset').selectOption('ballet');
  expect(await flyers()).toEqual(firstFlyers);
  await page.locator('#autoRide').uncheck();
  await page.locator('#playButton').click();
  await page.waitForTimeout(700);
  const paused = await state(page);
  const samples = await page.evaluate(async () => {
    const frames = [];
    for (let i = 0; i < 38; i++) {
      frames.push(window.__puggler.snapshot().players);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return frames;
  });
  for (const id of [0, 1, 2]) {
    const values = samples.map(frame => frame[id]);
    expect(Math.max(...values.map(p => p.x)) - Math.min(...values.map(p => p.x))).toBeGreaterThan(15);
    expect(values.some(p => p.vx > 5) && values.some(p => p.vx < -5)).toBe(true);
    expect(Math.abs(values.at(-1).wheel - values[0].wheel - (values.at(-1).x - values[0].x) / 49)).toBeLessThan(.001);
  }
  expect(await state(page)).toMatchObject({ running: false, audioOn: false, beat: paused.beat });
  await expect(page.locator('#guides')).toHaveCount(0);
  await page.locator('#trails').uncheck();
  expect((await state(page)).trails).toBe(false);
  await page.locator('#trails').check();
  expect((await state(page)).trails).toBe(true);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Puggler fits ${viewport.width} × ${viewport.height} and keeps controls reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openShow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.locator('.puggler-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
    await expect(page.locator('#pageTitle')).toBeVisible();
    expect(await page.locator('.puggler-performance-controls').evaluate(bar => bar.scrollWidth <= bar.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`puggler-default-${viewport.width}.png`), fullPage: false });
    await page.locator('.puggler-stage-wrap').screenshot({ path: testInfo.outputPath(`puggler-stage-${viewport.width}.png`) });
    await page.locator('#preset').selectOption('float');
    await expect(page.locator('#keyboardControls .rider-toggle')).toHaveCount(3);
    await page.locator('#riffs1').selectOption('bass');
    const height=page.locator('#loft');await height.scrollIntoViewIfNeeded();await height.focus();
    const loftBefore=(await state(page)).loft;await height.press('ArrowUp');
    expect((await state(page)).loft).toBeGreaterThan(loftBefore);
    await page.locator('.puggler-performance-controls').screenshot({ path: testInfo.outputPath(`puggler-controls-${viewport.width}.png`) });
    await page.locator('#randomButton').click();
    await page.locator('#resetButton').click();
    await cast(page,'puggler');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const box = await page.locator('#stage').boundingBox();
    // Phones now deliberately use a compact stage; retain the desktop floor.
    expect(box.height).toBeGreaterThanOrEqual(viewport.width > 960 ? 400 : viewport.width>viewport.height ? 170 : 200);
    if (viewport.width <= 960) expect(box.height).toBeLessThanOrEqual(viewport.height * .65);
    const start = (await state(page)).x;
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .8, box.y + box.height * .5);
    await expect.poll(async () => (await state(page)).x).toBeGreaterThan(start + 60);
    await page.mouse.up();
    expect((await state(page)).audioOn).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`puggler-${viewport.width}.png`), fullPage: false });
  });
}

test('touch dragging and cancellation release solo steering without arming Audio', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await openShow(page);
    await cast(page,'puggler');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page), box = await page.locator('#stage').boundingBox();
    const before = (await state(page)).x;
    const point = { x: box.x + box.width * .78, y: box.y + box.height * .6, id: 1 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await expect.poll(async () => (await state(page)).x).toBeGreaterThan(before + 90);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.locator('#autoRide').uncheck();
    await page.waitForTimeout(1200);
    const released = await state(page);
    expect(released.steeringTargets).toEqual([null, null, null]);
    expect(released.players[0].rideMotion).toBe('balance');
    await page.waitForTimeout(300);
    expect(Math.abs((await state(page)).x - released.players[0].rideAnchor)).toBeLessThan(24);
    expect((await state(page)).audioOn).toBe(false);
    for (const id of ['audioButton', 'playButton']) {
      const size = await page.locator(`#${id}`).boundingBox();
      expect(size.width).toBeGreaterThanOrEqual(48);
      expect(size.height).toBeGreaterThanOrEqual(48);
    }
  } finally {
    await context.close();
  }
});

test('one captured touch steers the whole cast; extra touches cannot split it and cancellation releases everyone',async({browser,baseURL})=>{
    const context=await browser.newContext({baseURL,viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    try{
      const page=await context.newPage();await openShow(page);await range(page,'rideSpeed',0);await range(page,'chaos',0);
      // Re-rack after the startup ride so each rider begins at its lane center.
      await range(page,'count',5);await range(page,'count',6);
      const session=await context.newCDPSession(page),box=await page.locator('#stage').boundingBox();
      const before=await state(page),point={x:box.x+box.width*.85,y:box.y+box.height*.65,id:11};
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await expect.poll(async()=>(await state(page)).players.every((p,i)=>p.x>before.players[i].x+25)).toBe(true);
      const targets=(await state(page)).steeringTargets;
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point,{...point,x:box.x+box.width*.1,id:12}]});
      expect((await state(page)).steeringTargets).toEqual(targets);
      await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await expect.poll(async()=>(await state(page)).steeringTargets).toEqual([null,null,null]);
      expect(await state(page)).toMatchObject({cast:'trio',running:true,audioOn:false});
    }finally{await context.close();}
  });

test('Puggler sonic skins change instruments, vocal colors and impact voices during a live act', async ({ page }) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openShow(page);await range(page,'count','4');
  await choosePattern(page,'fountain');await range(page,'chaos',0);
  await range(page,'assist',120);await page.locator('#autoRide').uncheck();
  await page.locator('#skin').selectOption('history');
  expect((await state(page)).audioOn).toBe(false);
  // Explicit legacy assignments retain their original skin-dependent sound roles.
  await page.locator('#riffs0').selectOption('guitar');await page.locator('#drums0').selectOption('kick');
  await expect(page.locator('#riffs0 option:checked')).toHaveText('Harpsichord');
  await expect(page.locator('#drums0 option:checked')).toHaveText('Timpani');
  const historyObjects=await page.locator('#object0 option').allTextContents();
  for(const name of ['Candelabra','Harpsichord','Violin','Talking drum'])expect(historyObjects).toContain(name);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  for(const [skin,lead,drum,grit] of [
    ['history','Harpsichord','Timpani','Rosin + quill'],
    ['future','SIMD goo','Volt pulse','Filter goo'],
    ['punk','Guitar','Kick','Amp filth'],
  ]){
    const before=await state(page);
    await page.locator('#skin').selectOption(skin);
    await expect(page.locator('#riffs0 option:checked')).toHaveText(lead);
    await expect(page.locator('#drums0 option:checked')).toHaveText(drum);
    await expect(page.locator('label:has(#grit) .mz-field__label')).toHaveText(grit);
    await expect.poll(async()=>{
      const s=await state(page);
      return s.sonics.some(v=>v.role==='guitar'&&v.skin===skin&&(skin==='punk'?v.key==='guitar':v.key.startsWith(`${skin}:`)))
        &&s.hitSounds.some(key=>skin==='punk'?key==='kick':key===`${skin}:kick`);
    },{timeout:8000}).toBe(true);
    const sound=await sampleAudioEnvelope(page,{durationMs:1200,intervalMs:40});
    expect(sound.summary.finite).toBe(true);expect(sound.summary.maxPeak).toBeGreaterThan(.003);
    expect(sound.summary.clippedSamples).toBe(0);
    const after=await state(page);
    expect(after).toMatchObject({skin,running:true,audioOn:true,count:4,pattern:'fountain'});
    expect(after.time).toBeGreaterThan(before.time);expect(after.catches).toBeGreaterThan(before.catches);
  }
  await range(page,'count','10');await range(page,'tempo',1200);
  await range(page,'level',1);await range(page,'impacts',2);await range(page,'flight',1);await range(page,'grit',1);
  for(const skin of ['history','future']){
    await page.locator('#skin').selectOption(skin);
    const extreme=await sampleAudioEnvelope(page,{durationMs:1800,intervalMs:30});
    expect(extreme.summary.finite).toBe(true);expect(extreme.summary.maxPeak).toBeGreaterThan(.003);
    expect(extreme.summary.clippedSamples).toBe(0);expect(extreme.summary.maxPeak).toBeLessThan(.92);
    expect((await state(page)).sonics.length).toBeLessThanOrEqual(10);
  }
  await page.locator('#playButton').click();await page.locator('#skin').selectOption('history');
  expect(await state(page)).toMatchObject({running:false,audioOn:true,sonics:[]});
  await page.locator('#audioButton').click();
  const muted=await sampleAudioEnvelope(page,{durationMs:500,intervalMs:50});
  expect(muted.samples.at(-1).peak).toBeLessThan(.001);expect(errors).toEqual([]);
});

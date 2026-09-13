import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { COLLAGE_ATLASES } from '../src/puggler-collage.js';
import { PATTERNS } from '../src/puggler.js';
import { SKINS } from '../src/puggler-skins.js';
import { LIGHTING_SCENES } from '../src/puggler-lighting.js';
import { VOCAL_CHARACTERS } from '../src/puggler-vocals.js';

const atlasCount = Object.keys(COLLAGE_ATLASES).length;

const state = page => page.evaluate(() => window.__puggler.snapshot());
const range = (page, id, value) => page.locator(`#${id}`).evaluate((element, next) => {
  element.value = String(next);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}, value);

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
  await expect(page.locator('#pattern')).toHaveValue('');
  await expect(page.locator('#passMode')).toBeEnabled();
  await expect(page.locator('#keyboardControls [data-key]')).toHaveCount(24);
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
  await openShow(page);
  for (const count of Array.from({ length: 10 }, (_, i) => i + 1)) {
    await page.locator('#count').selectOption(String(count));
    const patterns = PATTERNS.filter(pattern => pattern.count === count);
    expect(patterns.length).toBeGreaterThan(1);
    for (const phrase of ['verse', 'evolve']) {
      await page.locator('#phrase').selectOption(phrase);
      const menu = page.locator('#pattern');
      await expect(menu).toBeEnabled();
      await expect(menu).toHaveValue('');
      expect(await menu.locator('option:enabled').evaluateAll(options => options.map(option => option.value)))
        .toEqual(patterns.map(pattern => pattern.id));
      // Even the previously stored pattern must be selectable from phrases.
      const before = await state(page);
      await menu.selectOption(before.pattern);
      await expect(page.locator('#phrase')).toHaveValue('loop');
      expect(await state(page)).toMatchObject({ count, pattern: before.pattern, phrase: 'loop', running: true, audioOn: false });
    }
    for (const pattern of patterns) {
      await page.locator('#pattern').selectOption(pattern.id);
      expect(await state(page)).toMatchObject({ count, pattern: pattern.id, phrase: 'loop', running: true, audioOn: false });
    }
  }
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await page.locator('#playButton').click();
  await page.locator('#phrase').selectOption('evolve');
  await page.locator('#pattern').selectOption('shower-10');
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
  await openShow(page);await page.locator('#count').selectOption('1');
  await page.locator('#pattern').selectOption('single');await page.locator('#autoRide').uncheck();
  await range(page,'chaos',0);await range(page,'assist',120);await range(page,'tempo',180);
  await page.locator('#riffs0').selectOption('oi');await range(page,'impacts',0);await range(page,'boo',0);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  for(const character of VOCAL_CHARACTERS){
    await page.locator('#skin').selectOption(character.skin);
    await page.locator('#cast').selectOption(['puggler','roxy','moss'][character.owner]);
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
  await openShow(page);await page.locator('#count').selectOption('1');
  await page.locator('#pattern').selectOption('single');await page.locator('#cast').selectOption('roxy-moss');
  await page.locator('#autoRide').uncheck();await range(page,'tempo',100);await range(page,'chaos',0);await range(page,'assist',120);
  await page.locator('#riffs0').selectOption('oi');await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  await expect.poll(async()=>{const s=await state(page);return s.objects[0].phase==='air'&&s.time-s.objects[0].start<.35&&s.objects[0].voiceOwner===1&&s.vocals[0]?.character==='punk-roxy';},{timeout:8000}).toBe(true);
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

test('fixed keys highlight their buttons and pointer taps and holds perform the same actions', async ({ page }) => {
  await openShow(page);await page.locator('#cast').selectOption('puggler');await page.locator('#playButton').click();
  await page.locator('#stage').focus();const before=await state(page);
  await page.keyboard.down('d');await expect(page.locator('[data-key="KeyD"]')).toHaveClass(/held/);
  await expect.poll(async()=>(await state(page)).players[0].x).toBeGreaterThan(before.x+25);
  await releaseAndSettle(page,['d']);await expect(page.locator('[data-key="KeyD"]')).not.toHaveClass(/held/);
  const slow=(await state(page)).players[0].x;
  await page.locator('[data-key="KeyE"]').click();
  await expect.poll(async()=>(await state(page)).players[0].x).toBeGreaterThan(slow+12);
  const loft=(await state(page)).players[0].loft;
  await page.locator('[data-key="KeyW"]').focus();await page.keyboard.down('Enter');
  await expect.poll(async()=>(await state(page)).players[0].loft).toBeGreaterThan(loft+.1);
  await page.keyboard.up('Enter');
  expect(await state(page)).toMatchObject({running:false,audioOn:false});
  expect((await state(page)).beat).toBe(before.beat);
});

test('Who offers all seven casts; solo and noncontiguous duo controls preserve identities', async ({ page }) => {
  await openShow(page);await page.locator('#playButton').click();
  const casts={'puggler':[0],'roxy':[1],'moss':[2],'puggler-roxy':[0,1],'puggler-moss':[0,2],'roxy-moss':[1,2],'trio':[0,1,2]};
  await expect(page.locator('#cast option')).toHaveCount(7);
  for(const [cast,ids] of Object.entries(casts)){
    await page.locator('#cast').selectOption(cast);expect((await state(page)).activeIds).toEqual(ids);
    expect((await state(page)).objects.every(o=>ids.includes(o.owner))).toBe(true);
    if(ids.length===1)await expect(page.locator('#passingField')).toBeHidden();else await expect(page.locator('#passingField')).toBeVisible();
    const key=['KeyD','KeyL','Numpad6'][ids[0]],before=(await state(page)).players[ids[0]].x;
    await page.locator(`[data-key="${key}"]`).click();
    await expect.poll(async()=>(await state(page)).players[ids[0]].x).toBeGreaterThan(before+5);
  }
  await page.locator('#cast').selectOption('moss');await page.locator('#stage').focus();const before=(await state(page)).players[2].x;
  await page.keyboard.down('Numpad4');await expect.poll(async()=>(await state(page)).players[2].x).toBeLessThan(before-20);await page.keyboard.up('Numpad4');
  await expect(page.locator('[data-key="KeyD"]')).toBeDisabled();
});

test('Puggler names below the stage toggle the cast by click or number key', async ({ page }) => {
  await openShow(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#keyboardControls .rider-toggle')).toHaveCount(3);
  await page.locator('#rider-1').click();
  expect((await state(page)).activeIds).toEqual([0, 2]);
  await expect(page.locator('#cast')).toHaveValue('puggler-moss');
  await expect(page.locator('#rider-1')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-key="KeyL"]')).toBeDisabled();
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
  await page.locator('#cast').selectOption('roxy');
  await expect(page.locator('#rider-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rider-0')).toHaveAttribute('aria-pressed', 'false');
  expect((await state(page)).objects.every(object => object.owner === 1)).toBe(true);
});

test('Roxy and Moss physical keyboard clusters steer and shape their own throws', async ({ page }) => {
  await openShow(page);
  await page.locator('#cast').selectOption('trio');await page.locator('#autoRide').uncheck();
  await range(page, 'chaos', 0);
  await page.locator('#stage').focus();
  const initial = (await state(page)).players;
  for (const key of ['d', 'l', 'Numpad4']) await page.keyboard.down(key);
  await expect.poll(async () => {
    const p = (await state(page)).players;
    return p[0].x > initial[0].x + 25 && p[1].x > initial[1].x + 25 && p[2].x < initial[2].x - 25;
  }).toBe(true);
  await releaseAndSettle(page, ['d', 'l', 'Numpad4']);
  const settled = (await state(page)).players;
  for (const key of ['u', 'Numpad9']) await page.keyboard.down(key);
  await page.waitForTimeout(250);
  const fast = (await state(page)).players;
  // A captured browser frame can arrive after a fast rider reaches the edge;
  // reaching that boundary is a valid result of holding the fast key.
  expect(fast[1].x).toBeLessThan(settled[1].x - 40);
  expect(fast[2].x).toBeGreaterThan(settled[2].x + 40);
  expect(fast[1].vx < -200 || (fast[1].x === 385 && fast[1].vx === 0)).toBe(true);
  expect(fast[2].vx > 200 || (fast[2].x === 890 && fast[2].vx === 0)).toBe(true);
  expect(fast[0].rideMotion).toBe('balance');
  expect(Math.abs(fast[0].x - fast[0].rideAnchor)).toBeLessThan(24);
  expect(Math.abs(fast[0].vx)).toBeLessThan(100);
  await releaseAndSettle(page, ['u', 'Numpad9']);
  const loft = (await state(page)).players.map(player => player.loft);
  await page.keyboard.down('i');
  await page.keyboard.down('Numpad8');
  await expect.poll(async () => {
    const p = (await state(page)).players;
    return p[1].loft > loft[1] + .1 && p[2].loft > loft[2] + .1;
  }).toBe(true);
  await page.keyboard.up('i');
  await page.keyboard.up('Numpad8');
  expect((await state(page)).players[0].loft).toBe(loft[0]);
  for (const key of ['f', 'h', 'Numpad5']) await page.keyboard.press(key);
  const kicked = await state(page);
  for (const player of kicked.players) expect(player.lastKick).toBeGreaterThan(0);
  expect(kicked.audioOn).toBe(false);
});

test('throwing to the audience returns a different sound object on a rising arc', async ({ page }) => {
  await openShow(page);
  await page.locator('#cast').selectOption('puggler');
  await page.locator('#count').selectOption('1');
  await page.locator('#phrase').selectOption('loop');
  await page.locator('#pattern').selectOption('single');
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
  await page.locator('[data-key="KeyG"]').click();
  await expect.poll(async () => (await state(page)).crowdCatches).toBeGreaterThan(beforeButton);
  expect(await state(page)).toMatchObject({ count: 1, running: true, audioOn: false });
});

test('ten live objects keep their drum and riff edits across phrase and speed changes', async ({ page }) => {
  await openShow(page);
  await range(page, 'chaos', 0);
  await page.locator('#count').selectOption('10');
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
  await page.locator('#phrase').selectOption('loop');
  await expect(page.locator('#pattern')).toBeEnabled();
  await page.locator('#pattern').selectOption('shower-10');
  expect(await state(page)).toMatchObject({ phrase: 'loop', pattern: 'shower-10' });
  await range(page, 'tempo', 1200);
  await range(page, 'loft', 3);
  expect(await state(page)).toMatchObject({ tempo: 1200, loft: 3, running: true });
  await expect.poll(async () => Math.max(...(await state(page)).objects.map(object => object.y))).toBeGreaterThan(1500);
  const fast = await state(page);
  for (const object of fast.objects) for (const key of ['x', 'y', 'vx', 'vy']) expect(Number.isFinite(object[key])).toBe(true);
  await page.locator('#phrase').selectOption('evolve');
  await expect(page.locator('#pattern')).toBeEnabled();
  await expect(page.locator('#pattern')).toHaveValue('');
  await page.locator('#count').selectOption('5');
  await expect(page.locator('#objectControls .object-row')).toHaveCount(5);
  expect(await state(page)).toMatchObject({ count: 5, phrase: 'evolve', running: true, audioOn: false });
  await page.locator('#stage').focus();
  await page.keyboard.press('Space');
  expect((await state(page)).running).toBe(false);
  await page.keyboard.press('Space');
  expect((await state(page)).running).toBe(true);
  await page.locator('#resetButton').click();
  expect(await state(page)).toMatchObject({ count: 6, pattern: 'many-6', cast: 'trio', autoRide: true, phrase: 'verse', tempo: 360, loft: 1.8, chaos: 40, audioOn: false });
  expect((await state(page)).objects[0]).toMatchObject({ drum: 'kick', riff: 'guitar' });
  await expect(page.locator('#pattern')).toBeEnabled();
  await expect(page.locator('#pattern')).toHaveValue('');
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
    await expect(page.locator('#cast option:checked')).toHaveText(skin.riders.join(' + '));
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
      // Scroll in the outer gutter, outside the canvas's deliberate steering area.
      // Programmatic scrollIntoView can bypass overflow:hidden and miss this bug.
      await page.mouse.move(viewport.width-5,viewport.height*.8);
      await page.mouse.wheel(0,viewport.height*.6);
      await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(50);
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
  await page.locator('#phrase').selectOption('loop');
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
    const { posterLayout } = await import('./src/puggler-renderer.js');
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
    expect(await page.locator('.puggler-keyboards').evaluate(bar => bar.scrollWidth <= bar.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`puggler-default-${viewport.width}.png`), fullPage: false });
    await page.locator('.puggler-stage-wrap').screenshot({ path: testInfo.outputPath(`puggler-stage-${viewport.width}.png`) });
    await page.locator('#preset').selectOption('float');
    await expect(page.locator('#keyboardControls [data-key]')).toHaveCount(24);
    await page.locator('#riffs1').selectOption('bass');
    await page.locator('[data-key="KeyI"]').focus();
    const loftBefore = (await state(page)).players[1].loft;
    await page.keyboard.down('Enter');
    await expect.poll(async () => (await state(page)).players[1].loft).toBeGreaterThan(loftBefore + .1);
    await page.keyboard.up('Enter');
    await page.locator('.puggler-keyboards').screenshot({ path: testInfo.outputPath(`puggler-controls-${viewport.width}.png`) });
    await page.locator('#randomButton').click();
    await page.locator('#resetButton').click();
    await page.locator('#cast').selectOption('puggler');
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const box = await page.locator('#stage').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(400);
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
    await page.locator('#cast').selectOption('puggler');
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

test('three touches steer every manual rider independently and cancellation releases all', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await openShow(page);
    await page.locator('#cast').selectOption('trio');await page.locator('#autoRide').uncheck();
    await range(page, 'chaos', 0);
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page), box = await page.locator('#stage').boundingBox();
    const initial = (await state(page)).players;
    const touches = [.15, .44, .87].map((x, i) => ({ x: box.x + box.width * x, y: box.y + box.height * .65, id: i + 11 }));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
    await expect.poll(async () => {
      const p = (await state(page)).players;
      return p[0].x < initial[0].x - 25 && p[1].x < initial[1].x - 25 && p[2].x > initial[2].x + 25;
    }).toBe(true);
    const spread = (await state(page)).players;
    [.27, .56, .73].forEach((x, i) => { touches[i].x = box.x + box.width * x; });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches });
    await expect.poll(async () => {
      const p = (await state(page)).players;
      return p[0].x > spread[0].x + 35 && p[1].x > spread[1].x + 35 && p[2].x < spread[2].x - 35;
    }).toBe(true);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForTimeout(1200);
    const released = await state(page);
    expect(released.steeringTargets).toEqual([null, null, null]);
    await page.waitForTimeout(300);
    const after = await state(page);
    for (let i = 0; i < 3; i++) {
      expect(after.players[i].rideMotion).toBe('balance');
      expect(Math.abs(after.players[i].x - released.players[i].rideAnchor)).toBeLessThan(24);
    }
    expect(after).toMatchObject({ riders: 3, cast: 'trio', autoRide: false, running: true, audioOn: false });
  } finally {
    await context.close();
  }
});

test('automatic Roxy and Moss yield to direct touch while Audio stays off', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await openShow(page);
    await range(page, 'chaos', 0);
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const session = await context.newCDPSession(page), box = await page.locator('#stage').boundingBox();
    const initial = (await state(page)).players;
    const touches = [.59, .7].map((x, i) => ({ x: box.x + box.width * x, y: box.y + box.height * .6, id: i + 21 }));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
    await expect.poll(async () => {
      const p = (await state(page)).players;
      return p[1].x > initial[1].x + 35 && p[2].x < initial[2].x - 35;
    }).toBe(true);
    expect((await state(page)).players[0].rideMotion).toBe('pattern');
    expect((await state(page)).players[0].manualUntil).toBe(initial[0].manualUntil);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await state(page)).toMatchObject({ cast: 'trio', autoRide: true, running: true, audioOn: false });
  } finally {
    await context.close();
  }
});

test('Puggler sonic skins change instruments, vocal colors and impact kits during a live act', async ({ page }) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await openShow(page);await page.locator('#count').selectOption('4');
  await page.locator('#pattern').selectOption('fountain');await range(page,'chaos',0);
  await range(page,'assist',120);await page.locator('#autoRide').uncheck();
  await page.locator('#skin').selectOption('history');
  expect((await state(page)).audioOn).toBe(false);
  await expect(page.locator('#riffs0 option:checked')).toHaveText('Twang / keys');
  await expect(page.locator('#drums0 option:checked')).toHaveText('Frame drum');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:15000});
  for(const [skin,lead,drum,grit] of [
    ['history','Twang / keys','Frame drum','String bite'],
    ['future','Liquid lead','Sub kick','Cyber grit'],
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
  await page.locator('#count').selectOption('10');await range(page,'tempo',1200);
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

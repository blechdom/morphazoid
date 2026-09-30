import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const open = async page => { await page.goto('domino-run.html'); await page.waitForFunction(() => Boolean(window.dominoRun)); };
const range = async (page, id, value) => {
  await page.locator(`#${id}`).evaluate((el, v) => { el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true})); }, value);
  await expect.poll(()=>page.evaluate(key=>(["speed","brightness","ring"].includes(key)?window.dominoRun.snapshot:window.dominoRun.run).params[key],id)).toBe(value);
};
const renew = async page => {
  await page.locator('#autoStand').check();
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.timeline.falls.some(f=>Number.isFinite(f.standEnd)))).toBe(true);
};

test('an audible circle falls again after individual recovery and keeps its clock on pause and sound edits', async ({page},testInfo) => {
  await open(page);
  await range(page,'count',16);await range(page,'sizeVariation',0);await range(page,'speed',2.4);
  await renew(page);await range(page,'standDelay',.1);
  await expect(page.locator('#loop')).toBeDisabled();
  expect(await page.evaluate(()=>window.dominoRun.audio.armed)).toBe(false);
  await page.locator('#audioButton').click();await page.locator('#playButton').click();
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.timeline.falls.some(f=>f.id===0&&f.start>0&&f.start<=window.dominoRun.time)),{timeout:8000}).toBe(true);
  const envelope=await sampleAudioEnvelope(page,{durationMs:800,intervalMs:60});
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);expect(envelope.summary.finite).toBe(true);expect(envelope.summary.clippedSamples).toBe(0);
  const played=await page.evaluate(()=>window.dominoRun.audio.played);
  await page.evaluate(()=>{const until=performance.now()+650;while(performance.now()<until){/* UI stall */}});
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.audio.played)).toBeGreaterThan(played);
  const before=await page.evaluate(()=>window.dominoRun.time);
  await range(page,'brightness',.8);
  expect(await page.evaluate(()=>window.dominoRun.time)).toBeGreaterThanOrEqual(before);
  const beforeRecovery=await page.evaluate(()=>window.dominoRun.time);
  await range(page,'standDelay',.2);
  expect(await page.evaluate(()=>window.dominoRun.time)).toBeGreaterThanOrEqual(beforeRecovery);
  await page.locator('#playButton').click();const paused=await page.evaluate(()=>window.dominoRun.time);
  await page.waitForTimeout(150);expect(await page.evaluate(()=>window.dominoRun.time)).toBeCloseTo(paused,3);
  await page.locator('#playButton').click();await expect.poll(()=>page.evaluate(()=>window.dominoRun.time)).toBeGreaterThan(paused+.2);
  expect(await page.evaluate(()=>window.dominoRun.audio.dropped)).toBe(0);
  await testInfo.attach('circulating-audio.json',{body:JSON.stringify(envelope.summary),contentType:'application/json'});
});

test('a slow recovery lets the returning wave die without silently restarting the whole ring', async ({page}) => {
  await open(page);await range(page,'count',16);await range(page,'sizeVariation',0);await range(page,'speed',2.4);
  await renew(page);await range(page,'standDelay',2);
  await page.locator('#playButton').click();
  await expect.poll(()=>page.evaluate(()=>window.dominoRun.playing),{timeout:8000}).toBe(false);
  const evidence=await page.evaluate(()=>({falls:window.dominoRun.timeline.falls,pending:window.dominoRun.pending,time:window.dominoRun.time,duration:window.dominoRun.timeline.duration,armed:window.dominoRun.audio.armed}));
  expect(new Set(evidence.falls.map(f=>f.id)).size).toBe(16);
  expect(evidence.falls.filter(f=>f.id===0).length).toBe(1);
  expect(evidence.pending).toBe(false);expect(evidence.time).toBeCloseTo(evidence.duration,3);expect(evidence.armed).toBe(false);
  expect(evidence.falls.every(f=>f.standEnd<=evidence.time+.001)).toBe(true);
  await page.locator('#autoStand').uncheck();await expect(page.locator('#loop')).toBeEnabled();
});

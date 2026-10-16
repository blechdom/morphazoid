import { expect, test } from '@playwright/test';

async function open(page) {
  await page.goto('esi-32.html');
  await page.waitForFunction(() => Boolean(window.__esi32?.sampleRecorder));
  await page.evaluate(() => {
    window.__inputTest = { calls: 0 };
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__inputTest.calls++;
      window.__inputTest.constraints = constraints;
      const context = window.__esi32.audio.context;
      const oscillator = context.createOscillator();
      const level = context.createGain();
      level.gain.value = .2;
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440;
      oscillator.connect(level).connect(destination);
      oscillator.start();
      window.__inputTest.stream = destination.stream;
      return destination.stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [{kind:'audioinput',deviceId:'interface',label:'Test audio interface'}];
  });
}

async function connect(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.mz-input-toggle').click();
  await page.waitForFunction(() => window.__esi32.getState().inputActive);
}

async function beginCapture(page) {
  await page.locator('#recordSample').click();
  await page.waitForFunction(() => window.__esi32.sampleRecorder.state === 'recording');
  await page.waitForFunction(() => window.__esi32.sampleRecorder.elapsed >= .3);
}

test('input stays opt-in and never implicitly enables Audio', async ({page}) => {
  await open(page);
  await expect(page.locator('#recordSample')).toBeDisabled();
  await page.locator('.mz-input-toggle').click();
  await expect(page.getByText('Enable Audio before connecting your input.', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => window.__inputTest.calls)).toBe(0);
  expect(await page.evaluate(() => window.__esi32.audio.context)).toBeNull();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('records real input PCM into a slot, keeps live input silent, and plays the captured sample', async ({page}) => {
  await open(page); await connect(page);
  await beginCapture(page);
  const monitorPeak = await page.evaluate(() => {
    const values = new Float32Array(window.__esi32.audio.analyser.fftSize);
    window.__esi32.audio.analyser.getFloatTimeDomainData(values);
    return Math.max(...values.map(Math.abs));
  });
  expect(monitorPeak).toBeLessThan(.00001);
  await page.locator('#recordSample').click();
  await expect(page.locator('#lcdSample')).toHaveText('Input take 01');
  const result = await page.evaluate(() => {
    const buffer = window.__esi32.audio.samples.get(0);
    const values = buffer.getChannelData(0);
    let peak = 0;
    for (const value of values) { if (!Number.isFinite(value)) return {finite:false}; peak = Math.max(peak, Math.abs(value)); }
    return {finite:true,peak,duration:buffer.duration};
  });
  expect(result.finite).toBe(true);
  expect(result.peak).toBeGreaterThan(.1);
  expect(result.peak).toBeLessThan(.3);
  expect(result.duration).toBeGreaterThan(.25);
  expect(result.duration).toBeLessThan(5);
  await page.locator('#audition').click();
  await page.waitForFunction(() => window.__esi32.audio.voiceCount > 0);
  await page.waitForFunction(() => {
    const a=window.__esi32.audio.analyser, data=new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(data); return data.some(value=>Math.abs(value)>.001);
  });
  const download = page.waitForEvent('download');
  await page.locator('#exportSample').click();
  expect((await download).suggestedFilename()).toMatch(/Input-take-01-cut\.wav$/);
});

test('capture targets the slot selected at start and Audio off preserves the captured part', async ({page}) => {
  await open(page); await connect(page); await beginCapture(page);
  await page.locator('#sampleSlots button[data-slot="1"]').click();
  await page.locator('#audioButton').click();
  await page.waitForFunction(() => window.__esi32.getState().names[0] === 'Input take 01');
  await page.waitForFunction(() => window.__esi32.audio.context.state === 'suspended');
  const state=await page.evaluate(()=>({state:window.__esi32.getState(),tracks:window.__inputTest.stream.getTracks().map(track=>track.readyState)}));
  expect(state.state.selectedSlot).toBe(1);
  expect(state.state.names[1]).not.toMatch(/^Input take/);
  expect(state.state.inputActive).toBe(false);
  expect(state.tracks.every(value=>value==='ended')).toBe(true);
  await expect(page.locator('#recordSample')).toBeDisabled();
});

test('denied microphone permission preserves the existing sample', async ({page}) => {
  await open(page);
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');}; });
  await page.locator('#audioButton').click();
  const before=await page.locator('#lcdSample').textContent();
  await page.locator('.mz-input-toggle').click();
  await expect(page.getByText('Permission denied',{exact:true})).toBeVisible();
  await expect(page.locator('#lcdSample')).toHaveText(before);
  await expect(page.locator('#recordSample')).toBeDisabled();
  expect(await page.evaluate(()=>window.__esi32.getState().inputActive)).toBe(false);
});

test('late microphone permission after Audio off stops every incoming track', async ({page}) => {
  await open(page);
  await page.evaluate(()=>{
    const getStream=navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia=async constraints=>{
      const stream=await getStream(constraints);
      await new Promise(resolve=>{window.__inputTest.resolve=resolve;});
      return stream;
    };
  });
  await page.locator('#audioButton').click();
  await page.locator('.mz-input-toggle').click();
  await page.waitForFunction(()=>Boolean(window.__inputTest.resolve));
  await page.locator('#audioButton').click();
  await page.evaluate(()=>window.__inputTest.resolve());
  await page.waitForFunction(()=>window.__inputTest.stream.getTracks().every(track=>track.readyState==='ended'));
  expect(await page.evaluate(()=>window.__esi32.getState().inputActive)).toBe(false);
});

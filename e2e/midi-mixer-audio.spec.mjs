import { expect, test } from '@playwright/test';

// This suite uses the browser's native AudioContext and output device. The
// additional worklet observes the final signal without changing its routing.
async function prepare(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const Native = window.AudioContext; window.__mixerAudioContexts = [];
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__mixerAudioContexts.push(this); } };
  });
  await page.goto('/midiphoria.html');
  await page.evaluate(async () => {
    const { MidiMixerEngine } = await import('/src/instruments/midi-mixer/midi-mixer-engine.js');
    // Two long, distinct organ notes deliberately cross the Audio-arm position.
    const midi = note => {
      const track = [0, 0xc0, 16, 0, 0x90, note, 90, 0xb0, 0, 0x80, note, 0, 0, 255, 47, 0];
      const bytes = new Uint8Array(22 + track.length), view = new DataView(bytes.buffer);
      bytes.set([77, 84, 104, 100]); view.setUint32(4, 6); view.setUint16(10, 1); view.setUint16(12, 96);
      bytes.set([77, 84, 114, 107], 14); view.setUint32(18, track.length); bytes.set(track, 22); return bytes.buffer;
    };
    window.__qaMixer = new MidiMixerEngine();
    await __qaMixer.loadDeck(0, midi(60), 'Held organ A'); await __qaMixer.loadDeck(1, midi(67), 'Held organ B');
    const button = document.createElement('button'); button.id = 'qaMixerAudio'; button.textContent = 'QA Audio';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
    button.addEventListener('click', () => { window.__qaMixerArm = __qaMixer.enableAudio(); }); document.body.append(button);
    window.__qaMixerRms = () => {
      const data = new Float32Array(2048); window.__qaMixerMeter.getFloatTimeDomainData(data);
      return { rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length), peak: Math.max(...data.map(Math.abs)), finite: data.every(Number.isFinite) };
    };
  });
  return errors;
}
async function arm(page) {
  await page.locator('#qaMixerAudio').click();
  expect(await page.evaluate(() => __qaMixerArm)).toBe(true);
  await page.evaluate(() => {
    if (!window.__qaMixerMeter) { window.__qaMixerMeter = __qaMixer.context.createAnalyser(); __qaMixer._ceiling.connect(__qaMixerMeter); }
  });
  await expect.poll(() => page.evaluate(() => __qaMixer.state.decks.every(deck => deck.loaded))).toBe(true);
}
async function measure(page) { return page.evaluate(() => __qaMixerRms()); }

test('native SoundFont Audio joins held notes, stays independent from Play and recovers mute at the same phase', async ({ page }) => {
  const errors = await prepare(page);
  await page.evaluate(() => __qaMixer.play()); await page.waitForTimeout(350);
  expect(await page.evaluate(() => __mixerAudioContexts.length)).toBe(0);
  expect(await page.evaluate(() => __qaMixer.state.beat)).toBeGreaterThan(0.5);
  await arm(page);
  await expect.poll(async () => (await measure(page)).rms).toBeGreaterThan(0.002);
  const sound = await measure(page); expect(sound.finite).toBe(true); expect(sound.peak).toBeLessThanOrEqual(0.981);
  const before = await page.evaluate(() => { __qaMixer.setAudioEnabled(false); return __qaMixer.state.beat; });
  await expect.poll(async () => (await measure(page)).rms).toBeLessThan(0.0001);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => __qaMixer.state.beat)).toBeGreaterThan(before + 0.2);
  await arm(page); await expect.poll(async () => (await measure(page)).rms).toBeGreaterThan(0.002);
  expect(await page.evaluate(() => __mixerAudioContexts.length)).toBe(1);
  expect(await page.evaluate(() => __qaMixer.state.playing)).toBe(true);
  await page.evaluate(async () => { const context = __qaMixer.context; await __qaMixer.dispose(); window.__qaClosed = context.state; });
  expect(await page.evaluate(() => __qaClosed)).toBe('closed'); expect(errors).toEqual([]);
});

test('shared worklet keeps sounding through a UI stall, live ratios, loops, filter/delay and SoundFont replacement', async ({ page }) => {
  test.setTimeout(45000); const errors = await prepare(page);
  await page.evaluate(() => __qaMixer.play()); await arm(page);
  await expect.poll(async () => (await measure(page)).rms).toBeGreaterThan(0.002);
  await page.evaluate(async () => {
    const source = `class Probe extends AudioWorkletProcessor {
      constructor() { super(); this.reset(); this.port.onmessage = ({data}) => { if(data==='reset') this.reset(); this.port.postMessage(this.stats()); }; }
      reset() { this.frames=0;this.energy=0;this.peak=0;this.nonfinite=0;this.zeros=0;this.longest=0; }
      stats() { return {frames:this.frames,rms:Math.sqrt(this.energy/Math.max(1,this.frames)),peak:this.peak,nonfinite:this.nonfinite,longestZeroFrames:this.longest}; }
      process(inputs,outputs) { const input=inputs[0]?.[0], output=outputs[0]?.[0]; if(!input)return true;
        for(let i=0;i<input.length;i++){const x=input[i];if(!Number.isFinite(x))this.nonfinite++;this.energy+=x*x;this.peak=Math.max(this.peak,Math.abs(x));this.zeros=Math.abs(x)<1e-7?this.zeros+1:0;this.longest=Math.max(this.longest,this.zeros);if(output)output[i]=0;}this.frames+=input.length;return true; }
    } registerProcessor('midi-mixer-audio-qa',Probe);`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    await __qaMixer.context.audioWorklet.addModule(url); URL.revokeObjectURL(url);
    const probe = window.__qaProbe = new AudioWorkletNode(__qaMixer.context, 'midi-mixer-audio-qa');
    __qaMixer._ceiling.connect(probe); probe.connect(__qaMixer.context.destination);
    window.__qaProbeRequest = command => new Promise(resolve => { probe.port.onmessage = ({ data }) => resolve(data); probe.port.postMessage(command); });
  });
  const duringStall = await page.evaluate(async () => {
    await __qaProbeRequest('reset'); const before = __qaMixer.context.currentTime;
    const until = performance.now() + 700; while (performance.now() < until) { /* Deliberately block UI/rendering. */ }
    const stats = await __qaProbeRequest('stats'); return { ...stats, clockAdvance: __qaMixer.context.currentTime - before };
  });
  expect(duringStall.frames).toBeGreaterThan(16000); expect(duringStall.clockAdvance).toBeGreaterThan(0.4);
  expect(duringStall.nonfinite).toBe(0); expect(duringStall.rms).toBeGreaterThan(0.002);
  expect(duringStall.longestZeroFrames).toBeLessThan(2048); expect(duringStall.peak).toBeLessThanOrEqual(0.981);
  const beforeFilter = (await measure(page)).rms;
  await page.evaluate(() => __qaMixer.configureEffects({ filterHz: 60 })); await page.waitForTimeout(250);
  expect((await measure(page)).rms).toBeLessThan(beforeFilter / 3);
  await page.evaluate(() => { __qaMixer.configureEffects({ filterHz: 20000, delayMix: 0.4, delayBeats: 2, feedback: 0.5 }); __qaMixer.setTempo(60); });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => __qaMixer._delay.delayTime.value)).toBeCloseTo(2, 2);
  const phase = await page.evaluate(() => {
    const before = __qaMixer.state.decks[0].positionBeats, beforeTime = __qaMixer.context.currentTime;
    __qaMixer.configureDeck(0, { rate: 8 }); __qaMixer.configureDeck(1, { rate: 0.5 });
    const after = __qaMixer.state.decks[0].positionBeats, elapsed = __qaMixer.context.currentTime - beforeTime;
    __qaMixer.configureDeck(0, { loopStartBeats: 8, loopEndBeats: 12 }); __qaMixer.seekDeck(0, 10);
    return { before, after, elapsed, source: __qaMixer.state.decks[0].positionBeats };
  });
  // Native audio advances during these synchronous UI calls; the pure-clock
  // tests prove exact phase algebra, while this bound includes elapsed audio.
  expect(phase.after - phase.before).toBeGreaterThanOrEqual(-0.01);
  expect(phase.after - phase.before).toBeLessThan(phase.elapsed * 8 + 0.02);
  expect(Math.abs(phase.source - 10)).toBeLessThan(0.03);
  await expect.poll(async () => (await measure(page)).rms).toBeGreaterThan(0.002);
  const fontResult = await page.evaluate(async () => {
    const before = __qaMixer.state.beat;
    const font = await (await fetch('/assets/midiphoria/soundfont/TimGM6mb.sf2')).arrayBuffer();
    await __qaMixer.loadSoundFont(font, 'Test bank');
    const malformed = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 115, 102, 98, 107]); let error = '';
    try { await __qaMixer.loadSoundFont(malformed.buffer, 'Invalid'); } catch (caught) { error = caught.message; }
    return { before, after: __qaMixer.state.beat, error, name: __qaMixer.state.soundfontName, armed: __qaMixer.state.audioEnabled, playing: __qaMixer.state.playing };
  });
  expect(fontResult.after).toBeGreaterThanOrEqual(fontResult.before); expect(fontResult.error).not.toBe('');
  expect(fontResult.name).toBe('Test bank'); expect(fontResult.armed).toBe(true); expect(fontResult.playing).toBe(true);
  await expect.poll(async () => (await measure(page)).rms).toBeGreaterThan(0.002);
  const final = await measure(page); expect(final.finite).toBe(true); expect(final.peak).toBeLessThanOrEqual(0.981);
  await page.evaluate(async () => { __qaProbe.disconnect(); __qaProbe.port.close(); await __qaMixer.dispose(); }); expect(errors).toEqual([]);
});

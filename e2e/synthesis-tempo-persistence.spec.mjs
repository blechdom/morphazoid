import { test, expect } from '@playwright/test';
import { choose, exact } from './helpers/synthesis-controls.mjs';

const STUDY_ID = 'rotating-euclidean-chords';

test('edited sequence tempo round-trips through public state without restarting transport', async ({ page }) => {
  await page.addInitScript(() => {
    window.sequenceMessages = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, ...rest) {
      if (typeof message?.type === 'string' && message.type.startsWith('sequence-')) {
        window.sequenceMessages.push(structuredClone(message));
      }
      return post.call(this, message, ...rest);
    };
  });
  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'sequenceSelect', STUDY_ID);
  await exact(page, '#tempo-value', 173);

  const captured = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
  expect(captured).toMatchObject({ id: STUDY_ID, tempo: 173 });
  expect(new URL(page.url()).searchParams.get('sequenceTempo')).toBe('173');

  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.running)).toBe(true);
  await exact(page, '#tempo-value', 211);
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().tempo)).toBe(211);

  const recall = await page.evaluate(snapshot => {
    window.sequenceMessages.length = 0;
    const beforeBeat = window.MorphazoidSynthesis.getStatus().sequence.transportBeat;
    window.MorphazoidSynthesis.applySequenceState(snapshot);
    return {
      beforeBeat,
      after: window.MorphazoidSynthesis.getSequenceState(),
      status: window.MorphazoidSynthesis.getStatus(),
      messages: window.sequenceMessages,
    };
  }, captured);

  expect(recall.after).toMatchObject({ id: STUDY_ID, tempo: 173 });
  expect(recall.status).toMatchObject({ playing: true, tempo: 173, sequence: { running: true } });
  expect(recall.messages.filter(message => message.type === 'sequence-load')).toHaveLength(0);
  expect(recall.messages.filter(message => message.type === 'sequence-stop')).toHaveLength(0);
  expect(recall.messages.filter(message => message.type === 'sequence-start')).toHaveLength(0);
  const swaps = recall.messages.filter(message => message.type === 'sequence-swap');
  expect(swaps).toHaveLength(1);
  expect(swaps[0]).toMatchObject({
    tempo: 173,
    playing: true,
    preservePhase: true,
    preserveVoices: true,
    triggerCurrent: false,
  });
  expect(swaps[0].phase).toBeGreaterThan(recall.beforeBeat);
  await expect(page.locator('#tempo')).toHaveValue('173');
  expect(new URL(page.url()).searchParams.get('sequenceTempo')).toBe('173');
});

test('randomized sequence tempo survives a URL reload', async ({ page }) => {
  await page.goto(`/synthesis.html?method=additive&sequence=${STUDY_ID}`);
  await page.evaluate(() => { Math.random = () => .999999; });
  await page.locator('#randomSequencePreset').click();

  await expect(page.locator('#tempo')).toHaveValue('220');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().tempo)).toBe(220);
  expect(new URL(page.url()).searchParams.get('sequenceTempo')).toBe('220');

  await page.reload();
  await expect(page.locator('#sequenceSelect')).toHaveValue(STUDY_ID);
  await expect(page.locator('#tempo')).toHaveValue('220');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState())).toMatchObject({
    id: STUDY_ID,
    tempo: 220,
  });
});

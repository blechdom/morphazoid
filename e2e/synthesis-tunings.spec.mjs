import { test, expect } from '@playwright/test';
import { choose, exact } from './helpers/synthesis-controls.mjs';
import { SYNTHESIS_METHODS } from '../src/instruments/synthesis/catalog.js';
import { SEQUENCE_STUDIES } from '../src/instruments/synthesis/sequence-catalog.js';
import {
  TUNINGS,
  arpeggioDegrees,
  frequencyForMidiNote,
  frequencyForTuningDegree,
  tuningRatioForDegree,
} from '../src/instruments/synthesis/tunings.js';

const tuningGroups = new Set(TUNINGS.map(tuning => tuning.group));
const SEQUENCE_OPTION_COUNT = 1 + 3 + SEQUENCE_STUDIES.length;

test('complete synth, arpeggiator and tuning catalogs remain independent performer choices', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');

  expect(SYNTHESIS_METHODS).toHaveLength(53);
  expect(SEQUENCE_STUDIES).toHaveLength(62);
  expect(TUNINGS).toHaveLength(32);
  await expect(page.locator('#methodSelect option')).toHaveCount(SYNTHESIS_METHODS.length);
  await expect(page.locator('#sequenceSelect option')).toHaveCount(SEQUENCE_OPTION_COUNT);
  await expect(page.locator('#tuningSelect option')).toHaveCount(TUNINGS.length);
  await expect(page.locator('#tuningSelect optgroup')).toHaveCount(tuningGroups.size);
  const sequenceOptions = await page.locator('#sequenceSelect option').evaluateAll(options => options.map(option => ({
    value: option.value,
    text: option.textContent,
  })));
  expect(sequenceOptions[0]).toEqual({ value: 'none', text: 'Direct note · current Play behavior' });
  expect(sequenceOptions[1]).toEqual({
    value: SEQUENCE_STUDIES[0].id,
    text: `${SEQUENCE_STUDIES[0].label} · ${SEQUENCE_STUDIES[0].dateLabel}`,
  });
  expect(sequenceOptions.slice(-3).map(option => option.value)).toEqual(['basic-up', 'basic-down', 'basic-up-down']);
  await expect(page.locator('#sequenceCount')).toHaveText('62 editable studies · search or scroll · 3 quick patterns');
  await expect(page.locator('[data-select-id="sequenceSelect"] .instrument-picker-link')).toHaveCount(SEQUENCE_OPTION_COUNT);
  await expect(page.locator('.synthesis-selectors > :nth-child(1)')).toHaveClass(/synthesis-method-choice/);
  await expect(page.locator('.synthesis-selectors > :nth-child(2)')).toHaveClass(/synthesis-sequence-choice/);
  await expect(page.locator('.synthesis-selectors > :nth-child(3)')).toHaveClass(/synthesis-tuning-choice/);

  await choose(page, 'tuningSelect', 'edo-6-whole-tone');
  await choose(page, 'sequenceSelect', 'rotating-euclidean-chords');
  await expect(page.locator('#sequenceParameterControls')).toContainText('Pulses');
  await expect(page.locator('#sequence-param-pulses')).toBeVisible();
  await expect(page.locator('#sequence-param-euclideanSteps')).toBeVisible();
  await expect(page.locator('#sequence-param-rotation')).toBeVisible();
  await exact(page, '#sequence-param-pulses-value', 8);

  const additiveLabels = await page.locator('#methodControls label').allTextContents();
  await choose(page, 'methodSelect', 'fm');
  const fmLabels = await page.locator('#methodControls label').allTextContents();
  expect(fmLabels).not.toEqual(additiveLabels);
  await expect(page.locator('#methodSelect')).toHaveValue('fm');
  await expect(page.locator('#sequenceSelect')).toHaveValue('rotating-euclidean-chords');
  await expect(page.locator('#tuningSelect')).toHaveValue('edo-6-whole-tone');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().parameters.pulses)).toBe(8);

  await page.locator('#nextPreset').click();
  await expect(page.locator('#sequenceSelect')).toHaveValue('rotating-euclidean-chords');
  await expect(page.locator('#tuningSelect')).toHaveValue('edo-6-whole-tone');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().parameters.pulses)).toBe(8);

  await choose(page, 'sequenceSelect', 'bounded-random-walk');
  await expect(page.locator('#sequence-param-maxLeap')).toBeVisible();
  await expect(page.locator('#sequence-param-transitionFocus')).toBeVisible();
  await expect(page.locator('#sequence-param-pulses')).toHaveCount(0);
  await choose(page, 'sequenceSelect', 'rotating-euclidean-chords');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().parameters.pulses)).toBe(8);
  await choose(page, 'sequenceSelect', 'bounded-random-walk');
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({
    armed: false,
    tuningId: 'edo-6-whole-tone',
    playbackMode: 'sequence',
    sequence: { id: 'bounded-random-walk', selected: true },
  });
  const sequencePicker = page.locator('[data-select-id="sequenceSelect"]');
  await sequencePicker.locator('summary').click();
  await expect(sequencePicker.locator('.instrument-picker-panel')).toBeVisible();
  const selectedStudyIsVisible = await sequencePicker.evaluate(node => {
    const list = node.querySelector('.instrument-picker-list');
    const selected = node.querySelector('.instrument-picker-link[aria-pressed="true"]');
    const listBounds = list.getBoundingClientRect();
    const selectedBounds = selected.getBoundingClientRect();
    return selectedBounds.top >= listBounds.top && selectedBounds.bottom <= listBounds.bottom;
  });
  expect(selectedStudyIsVisible).toBe(true);
});

test('Euclidean and tuning edits keep a running sequence on its monotonic phase', async ({ page }) => {
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
  await choose(page, 'sequenceSelect', 'rotating-euclidean-chords');
  await choose(page, 'tuningSelect', 'edo-6-whole-tone');
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.running)).toBe(true);

  const beforePulseBeat = await page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.transportBeat);
  await page.waitForTimeout(80);
  await exact(page, '#sequence-param-pulses-value', 8);
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().parameters.pulses)).toBe(8);
  const pulseEdit = await page.evaluate(() => window.sequenceMessages.filter(message => message.type === 'sequence-load').at(-1));
  expect(pulseEdit.playing).toBe(true);
  expect(pulseEdit.preservePhase).toBe(true);
  expect(pulseEdit.phase).toBeGreaterThan(beforePulseBeat);
  expect(pulseEdit.sequence.parameters.pulses).toBe(8);

  const ratiosBeforeTuning = pulseEdit.sequence.steps.flatMap(step => step.notes.map(note => note.ratio));
  await page.waitForTimeout(80);
  await choose(page, 'tuningSelect', 'just-5-limit-major');
  const tuningEdit = await page.evaluate(() => window.sequenceMessages.filter(message => message.type === 'sequence-load').at(-1));
  const ratiosAfterTuning = tuningEdit.sequence.steps.flatMap(step => step.notes.map(note => note.ratio));
  expect(tuningEdit.playing).toBe(true);
  expect(tuningEdit.preservePhase).toBe(true);
  expect(tuningEdit.phase).toBeGreaterThan(pulseEdit.phase);
  expect(tuningEdit.sequence.tuningId).toBe('just-5-limit-major');
  expect(ratiosAfterTuning).not.toEqual(ratiosBeforeTuning);

  const status = await page.evaluate(() => window.MorphazoidSynthesis.getStatus());
  expect(status).toMatchObject({
    armed: true,
    playing: true,
    tuningId: 'just-5-limit-major',
    playbackMode: 'sequence',
    sequence: { id: 'rotating-euclidean-chords', selected: true, running: true },
  });
  expect(status.sequence.transportBeat).toBeGreaterThan(tuningEdit.phase);
  expect(await page.evaluate(() => window.sequenceMessages.filter(message => message.type === 'sequence-stop').length)).toBe(0);
});

test('sound preset recall retunes a running basic arpeggiator without reloading or dropping its gate', async ({ page }) => {
  await page.addInitScript(() => {
    window.synthesisSequenceMessages = [];
    window.synthesisSequenceStatuses = [];
    window.synthesisAnalysers = [];

    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, ...rest) {
      if (typeof message?.type === 'string' && message.type.startsWith('sequence-')) {
        window.synthesisSequenceMessages.push({ at: performance.now(), message: structuredClone(message) });
      }
      return post.call(this, message, ...rest);
    };

    const NativeAudioWorkletNode = window.AudioWorkletNode;
    window.AudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
      construct(Target, args) {
        const node = Reflect.construct(Target, args);
        node.port.addEventListener('message', event => {
          const status = event.data;
          if (status?.type !== 'sequence-status') return;
          const entry = { ...structuredClone(status), receivedAt: performance.now() };
          window.synthesisSequenceStatuses.push(entry);
          const recall = window.synthesisPresetRecall;
          if (!recall?.armed || !Number.isInteger(status.cursor) || status.cursor === recall.cursor) return;

          recall.armed = false;
          recall.at = performance.now();
          recall.onset = entry;
          recall.beforeState = window.MorphazoidSynthesis.getState();
          recall.beforeStatus = window.MorphazoidSynthesis.getStatus();
          document.querySelector('#nextPreset').click();
          recall.afterState = window.MorphazoidSynthesis.getState();

          const buffers = window.synthesisAnalysers.map(analyser => new Float32Array(analyser.fftSize));
          recall.sampleTimer = setInterval(() => {
            let rms = 0;
            window.synthesisAnalysers.forEach((analyser, index) => {
              analyser.getFloatTimeDomainData(buffers[index]);
              let squareSum = 0;
              for (const sample of buffers[index]) squareSum += sample * sample;
              rms = Math.max(rms, Math.sqrt(squareSum / buffers[index].length));
            });
            recall.rms.push({ at: performance.now(), rms });
          }, 10);
        });
        return node;
      },
    });

    const Context = window.AudioContext || window.webkitAudioContext;
    const createAnalyser = Context.prototype.createAnalyser;
    Context.prototype.createAnalyser = function(...args) {
      const analyser = createAnalyser.apply(this, args);
      window.synthesisAnalysers.push(analyser);
      return analyser;
    };
  });

  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'sequenceSelect', 'basic-up');
  await exact(page, '#tempo-value', 60);
  await exact(page, '#noteGate-value', 95);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.audio?.cursor)).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => {
    const status = window.synthesisSequenceStatuses.at(-1);
    window.synthesisSequenceMessages.length = 0;
    window.synthesisPresetRecall = { armed: true, cursor: status.cursor, rms: [] };
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.synthesisPresetRecall?.at)), { timeout: 2_500 }).toBe(true);
  await page.waitForTimeout(750);

  const evidence = await page.evaluate(() => {
    const recall = window.synthesisPresetRecall;
    clearInterval(recall.sampleTimer);
    const statuses = window.synthesisSequenceStatuses.filter(status => status.receivedAt >= recall.at);
    const samples = recall.rms.map(sample => ({ elapsed: sample.at - recall.at, rms: sample.rms }));
    const meanRms = (from, to) => {
      const values = samples.filter(sample => sample.elapsed >= from && sample.elapsed < to).map(sample => sample.rms);
      return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    };
    return {
      beforeState: recall.beforeState,
      afterState: recall.afterState,
      beforeStatus: recall.beforeStatus,
      afterStatus: window.MorphazoidSynthesis.getStatus(),
      messages: window.synthesisSequenceMessages.filter(entry => entry.at >= recall.at).map(entry => entry.message),
      revisions: statuses.map(status => status.revision),
      beats: statuses.map(status => status.beat),
      earlyRms: meanRms(40, 180),
      remainingGateRms: meanRms(450, 700),
    };
  });

  expect(evidence.afterState.frequencyHz).not.toBe(evidence.beforeState.frequencyHz);
  expect(evidence.messages.filter(message => message.type === 'sequence-load')).toHaveLength(0);
  expect(evidence.messages.filter(message => message.type === 'sequence-stop')).toHaveLength(0);
  expect(evidence.messages.filter(message => message.type === 'sequence-start')).toHaveLength(0);
  const rootMessages = evidence.messages.filter(message => message.type === 'sequence-root');
  expect(rootMessages).toHaveLength(1);
  expect(rootMessages[0].rootFrequency).toBe(evidence.afterState.frequencyHz);
  expect(new Set(evidence.revisions)).toEqual(new Set([evidence.beforeStatus.sequence.audio.revision]));
  expect(evidence.beats.length).toBeGreaterThan(2);
  expect(evidence.beats.every((beat, index) => index === 0 || beat >= evidence.beats[index - 1])).toBe(true);
  expect(evidence.afterStatus).toMatchObject({
    armed: true,
    playing: true,
    playbackMode: 'sequence',
    sequence: { id: 'basic-up', selected: true, running: true },
  });
  expect(evidence.afterStatus.sequence.transportBeat).toBeGreaterThan(evidence.beforeStatus.sequence.transportBeat + 0.5);
  expect(evidence.earlyRms).toBeGreaterThan(0.005);
  expect(evidence.remainingGateRms).toBeGreaterThan(evidence.earlyRms * 0.25);
});

test('basic arpeggiators compile exact ratios from the selected tuning', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'tuningSelect', 'edo-6-whole-tone');
  await choose(page, 'sequenceSelect', 'basic-up-down');

  const wholeToneCycle = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().cycle);
  const degrees = arpeggioDegrees('edo-6-whole-tone', 'up-down');
  expect(wholeToneCycle.steps.map(step => step.notes[0].degree)).toEqual(degrees);
  wholeToneCycle.steps.forEach((step, index) => {
    expect(step.notes[0].ratio).toBeCloseTo(tuningRatioForDegree(degrees[index], 'edo-6-whole-tone'), 10);
  });

  await choose(page, 'tuningSelect', 'just-5-limit-major');
  const justCycle = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().cycle);
  const justDegrees = arpeggioDegrees('just-5-limit-major', 'up-down');
  expect(justCycle.steps.map(step => step.notes[0].degree)).toEqual(justDegrees);
  justCycle.steps.forEach((step, index) => {
    expect(step.notes[0].ratio).toBeCloseTo(tuningRatioForDegree(justDegrees[index], 'just-5-limit-major'), 10);
  });
  expect(justCycle.steps.map(step => step.notes[0].ratio)).not.toEqual(wholeToneCycle.steps.map(step => step.notes[0].ratio));
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({
    playing: false,
    tuningId: 'just-5-limit-major',
    playbackMode: 'sequence',
    sequence: { id: 'basic-up-down', selected: true },
  });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`all three catalogs and their final choices remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/synthesis.html?method=additive');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    for (const id of ['methodSelect', 'sequenceSelect', 'tuningSelect']) {
      const summary = page.locator(`[data-select-id="${id}"] summary`);
      await summary.scrollIntoViewIfNeeded();
      await expect(summary).toBeInViewport();
    }

    const sequence = page.locator('[data-select-id="sequenceSelect"]');
    await sequence.locator('summary').click();
    const finalSequence = sequence.locator(`[data-option-index="${SEQUENCE_STUDIES.length}"]`);
    await finalSequence.scrollIntoViewIfNeeded();
    await expect(finalSequence).toBeInViewport();
    await finalSequence.click();
    await expect(page.locator('#sequenceSelect')).toHaveValue(SEQUENCE_STUDIES.at(-1).id);

    const tuning = page.locator('[data-select-id="tuningSelect"]');
    await tuning.locator('summary').scrollIntoViewIfNeeded();
    await tuning.locator('summary').click();
    const finalTuning = tuning.locator(`[data-option-index="${TUNINGS.length - 1}"]`);
    await finalTuning.scrollIntoViewIfNeeded();
    await expect(finalTuning).toBeInViewport();
    await finalTuning.click();
    await expect(page.locator('#tuningSelect')).toHaveValue(TUNINGS.at(-1).id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('keyboard availability is recalculated after frequency and tuning changes', async ({ page }) => {
  await page.goto('/synthesis.html?method=additive');
  await exact(page, '#frequencyHz', 8000);
  await expect(page.locator('#keyboard button:disabled')).toHaveCount(23);
  await choose(page, 'tuningSelect', 'edo-6-whole-tone');
  await expect(page.locator('#keyboard button:disabled')).toHaveCount(23);
  await exact(page, '#frequencyHz', 100);
  await expect(page.locator('#keyboard button:disabled')).toHaveCount(0);
});

test('keyboard and MIDI notes send exact frequencies from the selected tuning', async ({ page }) => {
  await page.addInitScript(() => {
    window.tunedNotes = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, ...rest) {
      if (message?.type === 'note') window.tunedNotes.push(structuredClone(message));
      return post.call(this, message, ...rest);
    };
  });
  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'tuningSelect', 'edo-6-whole-tone');
  const baseHz = await page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('h1').click();
  await page.keyboard.down('x');
  await expect.poll(() => page.evaluate(() => window.tunedNotes.length)).toBe(1);
  await page.keyboard.up('x');

  await page.evaluate(() => {
    dispatchEvent(new CustomEvent('morphazoid:midi-input', { cancelable: true, detail: {
      routeId: 'synthesis', message: { type: 'noteOn', channel: 0, note: 71, velocity: 96 },
    } }));
  });
  await expect.poll(() => page.evaluate(() => window.tunedNotes.length)).toBe(2);
  await page.evaluate(() => {
    dispatchEvent(new CustomEvent('morphazoid:midi-input', { cancelable: true, detail: {
      routeId: 'synthesis', message: { type: 'noteOff', channel: 0, note: 71, velocity: 0 },
    } }));
  });

  const notes = await page.evaluate(() => window.tunedNotes);
  expect(notes[0].frequency).toBeCloseTo(frequencyForTuningDegree(baseHz, 2, 'edo-6-whole-tone', { minHz: 20, maxHz: 12000 }), 8);
  expect(notes[1].frequency).toBeCloseTo(frequencyForMidiNote(71, 'edo-6-whole-tone', { anchorNote: 69, anchorHz: 440, minHz: 20, maxHz: 12000 }), 8);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getState().frequencyHz)).toBe(baseHz);
});

test('WAX audio notes auto-arm the exact tuning while MIDI-only stays host-owned', async ({ page }) => {
  await page.addInitScript(() => {
    window.waxHeldNotes = [];
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, ...rest) {
      if (message?.type === 'held-notes') window.waxHeldNotes.push(structuredClone(message));
      return post.call(this, message, ...rest);
    };
  });
  await page.goto('/synthesis.html?method=additive');
  await choose(page, 'tuningSelect', 'edo-6-whole-tone');
  const handled = await page.evaluate(() => {
    document.documentElement.dataset.morphazoidWaxOutputMode = 'audio';
    const event = new CustomEvent('morphazoid:midi-input', { cancelable: true, detail: {
      source: 'wax', message: { type: 'noteOn', channel: 0, note: 71, velocity: 96 },
    } });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(handled).toBe(true);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.waxHeldNotes.length)).toBeGreaterThan(0);
  const waxFrequency = await page.evaluate(() => window.waxHeldNotes.at(-1).notes.at(-1).frequency);
  expect(waxFrequency).toBeCloseTo(frequencyForMidiNote(71, 'edo-6-whole-tone'), 8);

  await page.evaluate(() => dispatchEvent(new CustomEvent('morphazoid:midi-input', { cancelable: true, detail: {
    source: 'wax', message: { type: 'noteOff', channel: 0, note: 71, velocity: 0 },
  } })));
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  const midiOnlyHandled = await page.evaluate(() => {
    document.documentElement.dataset.morphazoidWaxOutputMode = 'midi';
    const event = new CustomEvent('morphazoid:midi-input', { cancelable: true, detail: {
      source: 'wax', message: { type: 'noteOn', channel: 0, note: 72, velocity: 96 },
    } });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(midiOnlyHandled).toBe(false);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
});

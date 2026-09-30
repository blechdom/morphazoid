import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SYNTHESIS_METHODS } from '../src/instruments/synthesis/catalog.js';
import { prepareSynthesisLevelProbe, installSynthesisLevelProbe, captureSynthesisPreset } from './helpers/synthesis-level-probe.mjs';

const calibration = JSON.parse(readFileSync(new URL('../docs/synthesis-level-calibration.json', import.meta.url)));
const referenceRows = new Map(calibration.rows.map(row => [row.key, row]));
const db = value => value > 0 ? 20 * Math.log10(value) : -180;

async function useShortAttackFixture(page) {
  // Freeze the original 2 ms pluck: factory revoicing must not weaken this
  // regression for attacks that an additional 8 ms fade would erase.
  const fixture = {"params":[0.2,0.16957319106368793,0.84,0.85,0.65,0.25,0.25,0.9,0.45,0,0,0,0,0,0,0],"frequencyHz":947,"envelope":{"attack":0.002,"decay":2.9,"sustain":0,"release":2.4},"levelTrimDb":24.807};
  await page.route('**/src/instruments/synthesis/catalog.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const LEGACY_METHODS = freeze([';
    if (!source.includes(marker)) throw new Error('Short-attack fixture cannot locate catalog construction.');
    const injection = `
      const authoredMethod = method;
      method = (...args) => {
        const result = authoredMethod(...args);
        if (result.id === 'karplus-strong') {
          Object.assign(result.presets.find(preset => preset.id === 'high-harmonic-pin'), ${JSON.stringify(fixture)});
        }
        return result;
      };
    `;
    await route.fulfill({ response, body: source.replace(marker, injection + marker) });
  });
}

async function enableAudio(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  return installSynthesisLevelProbe(page);
}

test('a short Karplus attack keeps its energy after another preset is still decaying', async ({ page }, testInfo) => {
  await useShortAttackFixture(page);
  await prepareSynthesisLevelProbe(page);
  await page.goto('/synthesis.html?method=karplus-strong');
  await enableAudio(page);
  const fresh = await captureSynthesisPreset(page, 'karplus-strong', 'high-harmonic-pin', 2);
  await captureSynthesisPreset(page, 'karplus-strong', 'natural-string-pluck', 2);
  const following = await captureSynthesisPreset(page, 'karplus-strong', 'high-harmonic-pin', 2);
  const silentTail = await captureSynthesisPreset(page, 'additive', 'single-sine', 1.2);
  const afterSilentTail = await captureSynthesisPreset(page, 'karplus-strong', 'high-harmonic-pin', 2);
  await testInfo.attach('karplus-preset-attack-levels.json', {
    body: JSON.stringify({ fresh, following, silentTail, afterSilentTail }, null, 2), contentType: 'application/json',
  });
  expect(fresh.nonfinite + following.nonfinite + afterSilentTail.nonfinite).toBe(0);
  expect(fresh.peakDb, 'the frozen short pluck has an audible attack').toBeGreaterThan(-8);
  expect(fresh.max10msRmsDb, 'the attack contains measurable energy').toBeGreaterThan(-26);
  expect(fresh.clipped + following.clipped + afterSilentTail.clipped).toBe(0);
  expect(silentTail.tail10msRmsDb, 'the previous note has fallen below audible level').toBeLessThan(-60);
  for (const metric of ['peakDb', 'max10msRmsDb', 'max100msRmsDb']) {
    expect(Math.abs(following[metric] - fresh[metric]), metric + ' changes after a prior note').toBeLessThan(1.5);
    expect(Math.abs(afterSilentTail[metric] - fresh[metric]), metric + ' changes after a silent release tail').toBeLessThan(1.5);
  }
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
});

test('every synthesis method reaches its calibrated browser level across a full preset envelope', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepareSynthesisLevelProbe(page);
  await page.goto('/synthesis.html?method=sampling');
  const device = await enableAudio(page);
  const rows = [];
  for (const method of SYNTHESIS_METHODS) {
    const preset = method.presets[0], envelope = preset.envelope;
    // The capture includes the exact production audition gate, the complete
    // release, and a small scheduling margin, including the slow scanned swell.
    const seconds = Math.min(24.2, envelope.attack + envelope.decay + .18) + envelope.release + .2;
    const measured = await captureSynthesisPreset(page, method.id, preset.id, seconds);
    const reference = referenceRows.get(method.id + '/' + preset.id);
    const expected100ms = reference.after.max100msRmsDb + db(measured.state.outputLevel);
    rows.push({ methodId: method.id, presetId: preset.id, expected100msRmsDb: expected100ms, ...measured });
    expect(measured.state.methodId).toBe(method.id);
    expect(measured.state.presetId).toBe(preset.id);
    expect(measured.nonfinite + measured.raw.nonfinite, method.id + ' must stay finite').toBe(0);
    expect(measured.max100msRmsDb - measured.raw.max100msRmsDb, method.id + ' applies master once').toBeCloseTo(db(measured.state.outputLevel), 2);
    expect(measured.clipped, method.id + ' must not clip the browser destination').toBe(0);
    expect(measured.peak, method.id + ' must respect the output ceiling').toBeLessThanOrEqual(.951 * measured.state.outputLevel + .00001);
    expect(measured.max100msRmsDb, method.id + ' has no usable attack energy').toBeGreaterThan(-36);
    // The calibration itself handles timbre/dynamics. This assertion detects
    // dropped trims, muted attacks, or accidental browser-path attenuation.
    expect(measured.max100msRmsDb, method.id + ' is quieter than its calibrated render').toBeGreaterThanOrEqual(expected100ms - 2);
  }
  await testInfo.attach('all-synthesis-method-browser-levels.json', {
    body: JSON.stringify({ device, calibration: calibration.metadata, rows }, null, 2), contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus())).toMatchObject({ armed: true, playing: false });
});

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Offline factory calibration, never an audio-rate gain controller.
// Example: node scripts/calibrate-synthesis-levels.mjs --baseline /tmp/synthesis-level-baseline.json
// Paths can all be overridden to compare snapshots without modifying the checkout.
const options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--help') {
    console.log('Options: --root DIR --wasm FILE --catalog FILE --output FILE --report FILE --markdown FILE --baseline FILE --target-core-db -12 --master .7 --peak .78 --measure-only');
    process.exit(0);
  }
  if (!key.startsWith('--')) throw new Error(`Expected option, received ${key}`);
  if (key === '--measure-only') options.measureOnly = true;
  else {
    if (process.argv[i + 1] === undefined) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = process.argv[++i];
  }
}
const root = path.resolve(options.root || fileURLToPath(new URL('../', import.meta.url)));
const wasmPath = path.resolve(options.wasm || path.join(root, 'assets/wasm/synthesis.wasm'));
const catalogPath = path.resolve(options.catalog || path.join(root, 'src/instruments/synthesis/catalog.js'));
const outputPath = path.resolve(options.output || path.join(root, 'src/instruments/synthesis/level-calibration.js'));
const reportPath = path.resolve(options.report || path.join(root, 'docs/synthesis-level-calibration.json'));
const markdownPath = path.resolve(options.markdown || path.join(root, 'docs/synthesis-level-calibration.md'));
const SAMPLE_RATE = 48_000;
const MASTER = Number(options.master ?? .7);
const TARGET_DB = Number(options['target-core-db'] ?? -12);
const PEAK_CAP = Number(options.peak ?? .78);
const VELOCITY = .8;
const EXTRA_PEAK_RATES = [44_100, 96_000];
const EXTRA_PEAK_METHODS = new Set([43, 44, 45]);
const SHAKER_IDLE_SECONDS = [0, .011, .023, .053, .097, .173, .277, .419, .677, 1.003, 1.337, 1.777, 2.111, 2.557, 3.113, 4.001];
if (!(MASTER > 0 && MASTER <= 1 && Number.isFinite(TARGET_DB) && PEAK_CAP > 0 && PEAK_CAP < .8)) throw new Error('Invalid level targets. Peak cap must remain below the .8 emergency knee.');
const wasmBytes = fs.readFileSync(wasmPath);
const api = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {}).exports;
const setTrim = api.synth_set_level_trim_db;
if (!setTrim && !options.measureOnly) throw new Error('WASM lacks synth_set_level_trim_db; rebuild the engine before calibration. --measure-only supports legacy baseline WASM.');
const METHODS = catalogPath.endsWith('.json') ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : (await import(pathToFileURL(catalogPath).href)).SYNTHESIS_METHODS;
const fingerprint = METHODS.map(m => ({ engineId: m.engineId, id: m.id, presets: m.presets.map(p => ({ id: p.id, params: p.params, frequencyHz: p.frequencyHz, envelope: p.envelope })) }));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const buildManifestPath = path.join(path.dirname(wasmPath), 'synthesis-build.json');
const buildManifest = fs.existsSync(buildManifestPath) ? JSON.parse(fs.readFileSync(buildManifestPath, 'utf8')) : null;
const sourceHashes = buildManifest?.wasmSha256 === sha256(wasmBytes)
  ? Object.fromEntries(Object.entries(buildManifest.sourceHashes || {}).filter(([file]) => file.includes('/core/src/')))
  : {};

const db = value => value > 0 ? 20 * Math.log10(value) : -180;
const round = value => Math.round(value * 1000) / 1000;
const median = items => { const a = [...items].sort((a, b) => a - b), middle = Math.floor(a.length / 2); return a.length % 2 ? a[middle] : (a[middle - 1] + a[middle]) / 2; };
const score = m => Math.max(m.max400msKWeightedRmsDb, m.max100msKWeightedRmsDb - 3);
const baseline = options.baseline ? JSON.parse(fs.readFileSync(options.baseline, 'utf8')) : null;
const baselineRows = new Map((baseline?.rows || []).map(r => [`${r.method}/${r.presetId}`, r]));

function render(method, preset, trimDb = 0, sampleRate = SAMPLE_RATE, peakOnly = false, probeOptions = {}) {
  const { attack, decay, sustain, release } = preset.envelope;
  const gateFrame = Math.round(sampleRate * Math.min(24.2, Math.max(.02, probeOptions.holdSeconds ?? attack + decay + .18)));
  const frames = gateFrame + Math.round(sampleRate * (release + .1));
  const engine = api.synth_new(sampleRate);
  try {
    api.synth_set_method(engine, method.engineId);
    new Float32Array(api.memory.buffer, api.synth_params_ptr(engine), 16).set(preset.params);
    api.synth_apply_params(engine);
    api.synth_set_frequency(engine, preset.frequencyHz);
    api.synth_set_envelope(engine, attack, decay, sustain, release);
    api.synth_reset(engine);
    if (setTrim) setTrim(engine, trimDb);
    const idleFrames = Math.round((probeOptions.idleSeconds || 0) * sampleRate);
    for (let idle = 0; idle < idleFrames;) { const count = Math.min(128, idleFrames - idle); api.synth_process(engine, count); idle += count; }
    api.synth_note_on(engine, preset.frequencyHz, VELOCITY);
    const samples = peakOnly ? null : new Float32Array(frames);
    let peak = 0, nonfinite = 0, kneeSamples = 0;
    const energyWindow = peakOnly ? new Float64Array(Math.round(sampleRate * .01)) : null;
    let energySum = 0, energyAt = 0, maximum10msEnergy = 0;
    for (let offset = 0; offset < frames;) {
      if (offset === gateFrame) api.synth_note_off(engine);
      const count = Math.min(128, frames - offset, offset < gateFrame ? gateFrame - offset : frames - offset);
      if (api.synth_process(engine, count) !== count) throw new Error('WASM did not render the requested frame count.');
      const block = new Float32Array(api.memory.buffer, api.synth_output_ptr(engine), count);
      if (peakOnly) {
        for (const value of block) {
          if (!Number.isFinite(value)) nonfinite++;
          else {
            peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) >= .8) kneeSamples++;
            energySum += value * value - energyWindow[energyAt]; energyWindow[energyAt] = value * value;
            energyAt = (energyAt + 1) % energyWindow.length; maximum10msEnergy = Math.max(maximum10msEnergy, energySum);
          }
        }
      } else samples.set(block, offset);
      offset += count;
    }
    return peakOnly ? { peak, peakDb: db(peak), max10msRmsDb: db(Math.sqrt(maximum10msEnergy / energyWindow.length)), nonfinite, kneeSamples } : measure(samples, gateFrame);
  } finally { api.synth_free(engine); }
}

function measure(samples, gateFrame) {
  const n = samples.length, rawEnergy = new Float64Array(n + 1), kEnergy = new Float64Array(n + 1);
  let peak = 0, peakFrame = 0, nonfinite = 0, kneeSamples = 0, ceilingSamples = 0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
  // BS.1770 two-stage K weighting, exact 48 kHz coefficients. The result is
  // one-channel weighted RMS, not integrated LUFS or a perceptual guarantee.
  for (let i = 0; i < n; i++) {
    let x = samples[i];
    if (!Number.isFinite(x)) { nonfinite++; x = 0; }
    if (Math.abs(x) > peak) { peak = Math.abs(x); peakFrame = i; }
    if (Math.abs(x) >= .8) kneeSamples++;
    if (Math.abs(x) >= .949) ceilingSamples++;
    const y = 1.53512485958697 * x - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - .73248077421585 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const v = y - 2 * u1 + u2 + 1.99004745483398 * v1 - .99007225036621 * v2;
    u2 = u1; u1 = y; v2 = v1; v1 = v;
    rawEnergy[i + 1] = rawEnergy[i] + x * x;
    kEnergy[i + 1] = kEnergy[i] + v * v;
  }
  function maxRms(energy, ms) {
    const width = Math.round(SAMPLE_RATE * ms / 1000);
    let best = 0, endFrame = 0;
    for (let end = 1; end <= n; end++) {
      const value = energy[end] - energy[Math.max(0, end - width)];
      if (value > best) { best = value; endFrame = end; }
    }
    return { db: db(Math.sqrt(best / width)), startSeconds: (endFrame - width) / SAMPLE_RATE };
  }
  const windows = {};
  for (const ms of [10, 50, 100, 400]) windows[`max${ms}msRmsDb`] = maxRms(rawEnergy, ms).db;
  const k100 = maxRms(kEnergy, 100), k400 = maxRms(kEnergy, 400);
  let first60 = null, first48 = null, first36 = null, activeEnergy = 0, activeFrames = 0, last60 = null;
  for (let begin = 0; begin < n; begin += 480) {
    const end = Math.min(n, begin + 480), rms = Math.sqrt((rawEnergy[end] - rawEnergy[begin]) / (end - begin)) * MASTER;
    if (rms >= .001) {
      if (first60 === null) first60 = begin / SAMPLE_RATE;
      last60 = end / SAMPLE_RATE;
      activeEnergy += rawEnergy[end] - rawEnergy[begin]; activeFrames += end - begin;
    }
    if (rms >= 10 ** (-48 / 20) && first48 === null) first48 = begin / SAMPLE_RATE;
    if (rms >= 10 ** (-36 / 20) && first36 === null) first36 = begin / SAMPLE_RATE;
  }
  return {
    peak, peakDb: db(peak), peakAtSeconds: peakFrame / SAMPLE_RATE,
    ...windows, max100msKWeightedRmsDb: k100.db, max400msKWeightedRmsDb: k400.db,
    max400msKWeightedStartSeconds: k400.startSeconds,
    auditionRmsDb: db(Math.sqrt(rawEnergy[n] / n)), gateRmsDb: db(Math.sqrt(rawEnergy[gateFrame] / gateFrame)),
    active10msRmsDb: activeFrames ? db(Math.sqrt(activeEnergy / activeFrames)) : null,
    active10msDurationSeconds: activeFrames / SAMPLE_RATE,
    first10msAboveMinus60Seconds: first60, first10msAboveMinus48Seconds: first48,
    first10msAboveMinus36Seconds: first36, last10msAboveMinus60Seconds: last60,
    gateSeconds: gateFrame / SAMPLE_RATE, renderSeconds: n / SAMPLE_RATE,
    kneeSamples, ceilingSamples, nonfinite,
  };
}

const rows = [], presetTrims = {}, methodTrims = {};
const started = Date.now();
for (const method of METHODS) {
  const gains = [];
  for (const preset of method.presets) {
    const key = `${method.id}/${preset.id}`;
    const before = render(method, preset);
    if (before.nonfinite) throw new Error(`${key}: nonfinite output before calibration`);
    let reference = before, referenceTrimDb = 0;
    // A quiet analysis render recovers peak headroom if the untrimmed engine
    // reaches its emergency knee. It does not change the final envelope.
    if (!options.measureOnly && before.peak >= .78) {
      referenceTrimDb = -36;
      reference = render(method, preset, referenceTrimDb);
    }
    const referenceScoreDb = score(reference) - referenceTrimDb;
    const referencePeakDb = reference.peakDb - referenceTrimDb;
    const desiredTrimDb = TARGET_DB - referenceScoreDb;
    const referencePeakDbBySampleRate = { [SAMPLE_RATE]: referencePeakDb };
    const extraRates = !options.measureOnly && EXTRA_PEAK_METHODS.has(method.engineId) ? EXTRA_PEAK_RATES : [];
    const probeRates = method.engineId === 43 && !options.measureOnly ? [44_100, SAMPLE_RATE, 96_000] : extraRates;
    const peakReferenceTrials = [], worstPeakContextByRate = {};
    for (const rate of probeRates) {
      const offsets = method.engineId === 43 ? SHAKER_IDLE_SECONDS : [0];
      const holdSeconds = method.engineId === 43 && preset.envelope.sustain > 0 ? 8 : undefined;
      let worst = null;
      for (const idleSeconds of offsets) {
        const probe = render(method, preset, -36, rate, true, { idleSeconds, holdSeconds });
        if (probe.nonfinite) throw new Error(`${key}: nonfinite reference at ${rate} Hz`);
        const trial = { sampleRate: rate, idleSeconds, holdSeconds: holdSeconds ?? null, referencePeakDb: probe.peakDb + 36, referenceMax10msRmsDb: probe.max10msRmsDb + 36 };
        peakReferenceTrials.push(trial);
        if (!worst || trial.referencePeakDb > worst.referencePeakDb) worst = trial;
      }
      worstPeakContextByRate[rate] = worst;
      referencePeakDbBySampleRate[rate] = Math.max(referencePeakDbBySampleRate[rate] ?? -180, worst.referencePeakDb);
    }
    const peakAllowedTrimDb = db(PEAK_CAP) - Math.max(...Object.values(referencePeakDbBySampleRate));
    let trimDb = options.measureOnly ? 0 : Math.max(-36, Math.min(48, desiredTrimDb, peakAllowedTrimDb));
    // Round down: generated millidecibel trims must never round above peak cap.
    trimDb = Math.floor(trimDb * 1000) / 1000;
    let after = options.measureOnly || trimDb === 0 ? before : render(method, preset, trimDb);
    const verifyExtraRates = () => Object.fromEntries(probeRates.map(rate => [rate, render(method, preset, trimDb, rate, true, worstPeakContextByRate[rate])]));
    let extraRateVerification = verifyExtraRates();
    const verifiedPeaks = () => [after, ...Object.values(extraRateVerification)];
    let passes = 1;
    while (!options.measureOnly && Math.max(...verifiedPeaks().map(m => m.peak)) > PEAK_CAP * 1.0001 && passes < 4) {
      const maxPeak = Math.max(...verifiedPeaks().map(m => m.peak));
      trimDb = Math.max(-36, Math.floor((trimDb + db(PEAK_CAP / maxPeak) - .002) * 1000) / 1000);
      after = render(method, preset, trimDb);
      extraRateVerification = verifyExtraRates(); passes++;
    }
    if (verifiedPeaks().some(m => m.nonfinite || !options.measureOnly && (m.peak > PEAK_CAP * 1.001 || m.kneeSamples > 0))) throw new Error(`${key}: calibrated output violates peak/finite contract`);
    const old = baselineRows.get(key);
    const oldBrowser = old?.browserAfter || old;
    const browserOffsetDb = db(MASTER);
    const baselineComparison = old ? {
      baselineBrowserPeakDb: oldBrowser.browserPeakDb ?? oldBrowser.peakDb,
      baselineBrowserK400Db: oldBrowser.max400msKWeightedRmsDb,
      browserK400LiftDb: after.max400msKWeightedRmsDb + browserOffsetDb - oldBrowser.max400msKWeightedRmsDb,
      baselineMaster: baseline.metadata.master,
      baselineWasmSha256: baseline.metadata.wasmSha256,
    } : null;
    const row = {
      key, engineId: method.engineId, method: method.id, methodLabel: method.label,
      presetId: preset.id, preset: preset.name, frequencyHz: preset.frequencyHz, envelope: preset.envelope,
      trimDb, desiredTrimDb, peakAllowedTrimDb, peakLimited: peakAllowedTrimDb < desiredTrimDb,
      referenceTrimDb, referenceScoreDb, referencePeakDb, referencePeakDbBySampleRate, peakReferenceTrials, worstPeakContextByRate, extraRateVerification, verificationPasses: passes,
      before, after, afterScoreDb: score(after),
      sampledBrowserMax10msFloorDb: peakReferenceTrials.length ? Math.min(...peakReferenceTrials.map(t => t.referenceMax10msRmsDb + trimDb + browserOffsetDb)) : null,
      browserAfter: { peakDb: after.peakDb + browserOffsetDb, max50msRmsDb: after.max50msRmsDb + browserOffsetDb, max100msRmsDb: after.max100msRmsDb + browserOffsetDb, max400msRmsDb: after.max400msRmsDb + browserOffsetDb, max400msKWeightedRmsDb: after.max400msKWeightedRmsDb + browserOffsetDb, scoreDb: score(after) + browserOffsetDb },
      baselineComparison,
    };
    rows.push(row); presetTrims[key] = trimDb; gains.push(trimDb);
  }
  methodTrims[method.id] = round(median(gains));
  console.log(`${method.engineId} ${method.id}: ${rows.length} presets (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

const metadata = {
  version: 1, sampleRate: SAMPLE_RATE, master: MASTER, velocity: VELOCITY,
  targetCoreScoreDb: TARGET_DB, peakCap: PEAK_CAP, knee: .8, ceiling: .95,
  score: 'max(max400msKWeightedRmsDb, max100msKWeightedRmsDb - 3)',
  methodTrim: 'median of the eight calibrated preset trims',
  minimumTrimDb: -36, maximumTrimDb: 48, measureOnly: !!options.measureOnly,
  methods: METHODS.length, presets: rows.length,
  shakerStateSampling: { idleSeconds: SHAKER_IDLE_SECONDS, sampleRates: [44_100, SAMPLE_RATE, 96_000], sustainedHoldSeconds: 8, note: 'Silent rendering advances the deterministic RNG. These are sampled state bounds, not a guarantee over every random sequence. The worst-peak state at each rate is rerendered with the actual final trim.' },
  extraPeakVerification: { engineIds: [...EXTRA_PEAK_METHODS], sampleRates: EXTRA_PEAK_RATES, referenceTrimDb: -36, rationale: 'Collision and struck-resonator peaks vary with sample rate. Extra-rate references and final verification use raw sample peaks; K-weighted scoring remains at 48 kHz.' },
  wasmSha256: sha256(wasmBytes), signalFixtureSha256: sha256(JSON.stringify(fingerprint)),
  sourceHashes, sourceProvenance: Object.keys(sourceHashes).length ? 'synthesis-build.json with matching WASM hash' : 'No matching build manifest supplied',
  analysis: '48 kHz fresh engine, default source, exact attack + decay + .18 gate capped at 24.2 s, release + .1 s tail, velocity .8. All core metrics precede the settled master. Active/onset block threshold uses browser master.',
  weighting: 'BS.1770 K-weighted one-channel RMS; not integrated LUFS. Dual-mono momentary equivalence is K RMS + 2.319 dB. Max windows are sample aligned and zero padded before time zero.',
  limits: 'Static trims preserve within-note ADSR and source dynamics. Peak headroom takes priority over equal loudness. Short or sparse events may remain lower in 400 ms energy. Numerical RMS is not a human listening test.',
};
const quiet = [...rows].sort((a, b) => a.browserAfter.scoreDb - b.browserAfter.scoreDb);
const quantiles = values => {
  const a = [...values].sort((a, b) => a - b);
  return Object.fromEntries([0, .1, .25, .5, .75, .9, 1].map(q => [q, a[Math.round((a.length - 1) * q)]]));
};
const summary = {
  peakLimited: rows.filter(r => r.peakLimited).length,
  reachesKnee: rows.filter(r => r.after.kneeSamples > 0).length,
  reachesCeiling: rows.filter(r => r.after.ceilingSamples > 0).length,
  nonfinite: rows.reduce((s, r) => s + r.after.nonfinite, 0),
  extraRateVerifiedPresets: rows.filter(r => Object.keys(r.extraRateVerification).length).length,
  extraRateMaximumPeak: Math.max(0, ...rows.flatMap(r => Object.values(r.extraRateVerification).map(m => m.peak))),
  extraRateKneePresets: rows.filter(r => Object.values(r.extraRateVerification).some(m => m.kneeSamples > 0)).length,
  neverAboveMinus48Browser10ms: rows.filter(r => r.after.first10msAboveMinus48Seconds === null).map(r => r.key),
  neverAboveMinus36Browser10ms: rows.filter(r => r.after.first10msAboveMinus36Seconds === null).map(r => r.key),
  trimDbQuantiles: quantiles(rows.map(r => r.trimDb)),
  browserScoreDbQuantiles: quantiles(rows.map(r => r.browserAfter.scoreDb)),
  browserK400DbQuantiles: quantiles(rows.map(r => r.browserAfter.max400msKWeightedRmsDb)),
  browserPeakDbQuantiles: quantiles(rows.map(r => r.browserAfter.peakDb)),
  baselineComparison: baseline ? (() => {
    const paired = rows.filter(r => r.baselineComparison);
    const previous = quantiles(paired.map(r => r.baselineComparison.baselineBrowserK400Db));
    const current = quantiles(paired.map(r => r.browserAfter.max400msKWeightedRmsDb));
    return { baselineMaster: baseline.metadata.master, currentMaster: MASTER, baselineMedianBrowserK400Db: previous[.5], currentMedianBrowserK400Db: current[.5], baselineCentral80PercentSpanDb: previous[.9] - previous[.1], currentCentral80PercentSpanDb: current[.9] - current[.1], medianPairedLiftDb: median(paired.map(r => r.baselineComparison.browserK400LiftDb)), baselineNeverAboveMinus48Browser10ms: baseline.rows.filter(r => (r.after || r).first10msAboveMinus48Seconds === null).length };
  })() : null,
};
const report = { metadata, summary, methodTrims, rows };
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
write(reportPath, JSON.stringify(report, null, 2) + '\n');
if (!options.measureOnly) {
  write(outputPath, '// Generated by scripts/calibrate-synthesis-levels.mjs. Do not edit gains by hand.\n'
    + '// Fixed factory trims; the engine performs no automatic gain control.\n'
    + `export const LEVEL_CALIBRATION_METADATA = Object.freeze(${JSON.stringify(metadata, null, 2)});\n\n`
    + `export const PRESET_LEVEL_TRIMS_DB = Object.freeze(${JSON.stringify(presetTrims, null, 2)});\n\n`
    + `export const METHOD_LEVEL_TRIMS_DB = Object.freeze(${JSON.stringify(methodTrims, null, 2)});\n`);
}
const f = n => n.toFixed(1);
const lines = [
  '# Synthesaurus factory level calibration', '',
  `${rows.length} presets were rendered through the production Rust/WASM engine at 48 kHz, velocity 0.8, using their complete audition gate and release. Browser levels below include the settled master of ${MASTER}.`, '',
  `Fixed per-preset trims target ${TARGET_DB} dBFS core on max(K-weighted 400 ms RMS, K-weighted 100 ms RMS − 3 dB). The 100 ms term avoids over-boosting brief attacks. Core sample peaks are capped at ${PEAK_CAP} (${f(db(PEAK_CAP))} dBFS), below the emergency knee of 0.8. The method fallback is the median preset trim.`, '',
  `${summary.extraRateVerifiedPresets} particle-shaker, FDTD-membrane and FDN-resonator presets also use low-trim raw-peak references and actual final-trim verification at 44.1 and 96 kHz. Their trim is bounded by the largest peak across the three rates. The extra-rate maximum is ${summary.extraRateMaximumPeak.toFixed(6)}, with ${summary.extraRateKneePresets} presets touching the knee. K-weighted scoring remains at 48 kHz.`, '',
  'For the particle shaker, each of the three rates also uses 16 deterministic silent-idle offsets to vary the collision RNG state. Sustained shake is held for 8 seconds. The largest reference peak bounds the fixed trim, and the worst-peak state at each rate is rerendered at that trim. These are sampled bounds, not guarantees over every possible random sequence.', '',
  'The gain is constant for each preset. It does not follow the envelope, lift a decaying tail, or remove velocity differences. Peak headroom takes priority over matching the loudness target.', '',
  `Verification: ${summary.nonfinite} nonfinite samples; ${summary.reachesKnee} presets touching the emergency knee; ${summary.reachesCeiling} touching its ceiling. ${summary.peakLimited} presets are limited by peak headroom. ${summary.neverAboveMinus48Browser10ms.length} never cross −48 dBFS over a 10 ms browser-output block.`, '',
  'K-weighted RMS is an energy measurement, not integrated LUFS or proof of perceptual audibility. The worklet duplicates one channel; ungated dual-mono momentary loudness would be 2.319 dB above the reported K-weighted RMS.', '',
  '| Percentile | Browser score, dBFS | Browser K400, dBFS | Browser peak, dBFS |',
  '|---|---:|---:|---:|',
  ...Object.keys(summary.browserScoreDbQuantiles).sort((a, b) => Number(a) - Number(b)).map(q => `| ${Number(q) * 100}% | ${f(summary.browserScoreDbQuantiles[q])} | ${f(summary.browserK400DbQuantiles[q])} | ${f(summary.browserPeakDbQuantiles[q])} |`), '',
  ...(summary.baselineComparison ? [
    '## Comparison with the preserved baseline', '',
    `Median browser K400 changed from ${f(summary.baselineComparison.baselineMedianBrowserK400Db)} to ${f(summary.baselineComparison.currentMedianBrowserK400Db)} dBFS. The median paired lift is ${f(summary.baselineComparison.medianPairedLiftDb)} dB. The central 80% spread changed from ${f(summary.baselineComparison.baselineCentral80PercentSpanDb)} to ${f(summary.baselineComparison.currentCentral80PercentSpanDb)} dB.`, '',
    `This includes source corrections and fixed trims. ${summary.baselineComparison.baselineMaster === MASTER ? `The browser master remains ${MASTER}.` : `The browser master changed from ${summary.baselineComparison.baselineMaster} to ${MASTER}.`} Presets never reaching −48 dBFS over a 10 ms browser block changed from ${summary.baselineComparison.baselineNeverAboveMinus48Browser10ms} to ${summary.neverAboveMinus48Browser10ms.length}.`, '',
  ] : []),
  '## Quietest measured auditions', '',
  '| Method / preset | Trim, dB | Browser K400, dBFS | Browser 100 ms RMS, dBFS | Browser peak, dBFS | Peak constrained |',
  '|---|---:|---:|---:|---:|---|',
  ...quiet.slice(0,24).map(r => `| ${r.method} / ${r.preset} | ${f(r.trimDb)} | ${f(r.browserAfter.max400msKWeightedRmsDb)} | ${f(r.browserAfter.max100msRmsDb)} | ${f(r.browserAfter.peakDb)} | ${r.peakLimited ? 'yes' : 'no'} |`), '',
  '## Provenance', '',
  `- WASM SHA-256: \`${metadata.wasmSha256}\``,
  `- Signal fixture SHA-256: \`${metadata.signalFixtureSha256}\``,
  '- Fixture hashing includes method/preset IDs, normalized parameters, frequency and envelope. It excludes calibration trims, descriptive copy and output master, avoiding a circular calibration dependency.',
  '- Full source hashes, all before/after metrics, explicit onset thresholds and baseline comparisons are in the adjacent JSON report.',
  '- Reproduce with `node scripts/calibrate-synthesis-levels.mjs`; rebuild the WASM after engine changes, then regenerate calibration. Use `--baseline FILE` to attach a preserved earlier audit.', '',
];
write(markdownPath, lines.join('\n'));
console.log(JSON.stringify({ reportPath, outputPath: options.measureOnly ? null : outputPath, markdownPath, summary }, null, 2));

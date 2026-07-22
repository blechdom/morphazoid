import { generateJuliaBoundary, generateJuliaField } from "../src/julia.js";
import {
  buildInverseArcFamily,
  comparePitchSignals,
  complexPointFromGrid,
  criticalOrbitStatus,
  evaluateSimilarityPlans,
  sampleBoundaryArc,
  temporalPitchFidelity,
  rateLimitedTemporalPitchFidelity,
  pitchSignalForArc,
  resampleOpenArc,
} from "../src/julia-similarity.js";

const presets = [
  { name: "Spiral", cReal: -0.7, cImag: 0.27015 },
  { name: "Rabbit", cReal: -0.123, cImag: 0.745 },
  { name: "Siegel-like", cReal: -0.391, cImag: -0.587 },
  { name: "Basilica", cReal: -1, cImag: 0 },
];
const phases = Array.from({ length: 10 }, (_value, index) => (index + 0.5) / 10);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length * 0.5);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function percentile(values, amount) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.round((sorted.length - 1) * amount)];
}

function auroc(positives, negatives) {
  let wins = 0;
  let comparisons = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
      comparisons += 1;
    }
  }
  return comparisons ? wins / comparisons : 0;
}

function maskAgreement(a, b) {
  let intersection = 0;
  let union = 0;
  for (let row = 0; row < a.height; row += 1) {
    for (let column = 0; column < a.width; column += 1) {
      const otherRow = Math.round(row / (a.height - 1) * (b.height - 1));
      const otherColumn = Math.round(column / (a.width - 1) * (b.width - 1));
      const insideA = a.values[row][column] === a.maxIterations;
      const insideB = b.values[otherRow][otherColumn] === b.maxIterations;
      if (insideA || insideB) union += 1;
      if (insideA && insideB) intersection += 1;
    }
  }
  return union ? intersection / union : 1;
}

function alignedPointRmse(reference, candidate) {
  const a = resampleOpenArc(reference, 128);
  const b = resampleOpenArc(candidate, 128);
  if (a.length !== b.length || !a.length) return Infinity;
  let squared = 0;
  for (let index = 0; index < a.length; index += 1) {
    squared += (a[index].x - b[index].x) ** 2 + (a[index].y - b[index].y) ** 2;
  }
  return Math.sqrt(squared / a.length);
}

function cyclicArc(points, start, end, direction) {
  const result = [];
  let index = start;
  for (let guard = 0; guard <= points.length; guard += 1) {
    result.push(points[index]);
    if (index === end) return result;
    index = (index + direction + points.length) % points.length;
  }
  return [];
}

function nearestIndex(points, target) {
  let selected = 0;
  let selectedDistance = Infinity;
  points.forEach((point, index) => {
    const pointDistance = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (pointDistance < selectedDistance) {
      selected = index;
      selectedDistance = pointDistance;
    }
  });
  return selected;
}

function rasterSubarcNearestReference(generated, reference) {
  let best = null;
  for (const contour of generated.contours) {
    if (contour.points.length < 4) continue;
    const points = contour.points.map((point) => complexPointFromGrid(point, generated.field));
    const first = nearestIndex(points, reference[0]);
    const last = nearestIndex(points, reference.at(-1));
    if (first === last) continue;
    let candidates;
    if (contour.closed) {
      candidates = [cyclicArc(points, first, last, 1), cyclicArc(points, first, last, -1)];
    } else if (first < last) {
      candidates = [points.slice(first, last + 1)];
    } else {
      candidates = [points.slice(last, first + 1).reverse()];
    }
    for (const candidate of candidates) {
      if (candidate.length < 4) continue;
      const error = alignedPointRmse(reference, candidate);
      if (!best || error < best.error) best = { points: candidate, error };
    }
  }
  return best;
}

const rows = [];
const planScores = { chorus: [], canon: [], wavelet: [], orbit: [], harmony: [] };
const fixtures = [];
const rasterChecks = [];
for (const preset of presets) {
  const generated = generateJuliaBoundary({
    ...preset,
    resolution: 256,
    maxIterations: 160,
    simplifyTolerance: 0.35,
  });
  const families = phases.map((centerPhase) => buildInverseArcFamily(
    sampleBoundaryArc(generated.boundary, generated.field, {
      centerPhase,
      fraction: 0.025,
      samples: 512,
    }),
    { ...preset, depth: 3, samples: 512 },
  ));
  families.forEach((family, motif) => fixtures.push({ preset: preset.name, motif, family }));
  for (const family of families) {
    const level = family.levels[3];
    const width = level.bounds.maxX - level.bounds.minX;
    const height = level.bounds.maxY - level.bounds.minY;
    const span = Math.max(width, height, 1e-6) * 2.4;
    const centerX = (level.bounds.minX + level.bounds.maxX) * 0.5;
    const centerY = (level.bounds.minY + level.bounds.maxY) * 0.5;
    for (const resolution of [160, 320]) {
      const zoomed = generateJuliaBoundary({
        ...preset,
        resolution,
        maxIterations: 163,
        simplifyTolerance: 0,
        bounds: {
          minX: centerX - span * 0.5,
          maxX: centerX + span * 0.5,
          minY: centerY - span * 0.5,
          maxY: centerY + span * 0.5,
        },
      });
      const rasterArc = rasterSubarcNearestReference(zoomed, level.points);
      if (rasterArc) {
        rasterChecks.push({
          preset: preset.name,
          resolution,
          normalizedGeometryError: rasterArc.error / span,
          pitch: comparePitchSignals(
            pitchSignalForArc(family.levels[0].points, { smoothing: 4 }),
            pitchSignalForArc(rasterArc.points, { smoothing: 4 }),
          ),
        });
      }
    }
  }
  const depthScores = [1, 2, 3].map((depth) => median(
    families.map((family) => family.levels[depth].comparison.pitchCorrelation),
  ));
  const passRate = [1, 2, 3].map((depth) => (
    families.filter((family) => family.levels[depth].comparison.pitchCorrelation >= 0.8).length
      / families.length
  ));
  const critical = criticalOrbitStatus(preset.cReal, preset.cImag, 65_536);
  const iteration96 = generateJuliaField({ ...preset, resolution: 192, maxIterations: 96 });
  const iteration160 = generateJuliaField({ ...preset, resolution: 192, maxIterations: 160 });
  const lowResolution = generateJuliaField({ ...preset, resolution: 128, maxIterations: 160 });
  rows.push({
    preset: preset.name,
    depthScores,
    passRate,
    critical,
    iterationAgreement: maskAgreement(iteration96, iteration160),
    resolutionAgreement: maskAgreement(lowResolution, generated.field),
  });
  for (const family of families) {
    const plans = evaluateSimilarityPlans(family);
    for (const key of Object.keys(planScores)) planScores[key].push(plans[key].score);
  }
}

process.stdout.write("Analytic inverse-arc tangent-pitch fidelity (10 motifs/preset, 256², 160 iterations)\n\n");
process.stdout.write("| Preset | Depth 1 | Depth 2 | Depth 3 | ≥80% at d3 | Iteration IoU | Grid IoU | Critical orbit |\n");
process.stdout.write("|---|---:|---:|---:|---:|---:|---:|---|\n");
for (const row of rows) {
  const critical = row.critical.escaped ? `escapes at ${row.critical.escapeIteration}` : "survives 65,536";
  process.stdout.write(`| ${row.preset} | ${percent(row.depthScores[0])} | ${percent(row.depthScores[1])} | ${percent(row.depthScores[2])} | ${percent(row.passRate[2])} | ${percent(row.iterationAgreement)} | ${percent(row.resolutionAgreement)} | ${critical} |\n`);
}
process.stdout.write("\nIteration IoU compares caps 96/160 at 192²; Grid IoU compares 128²/256² at cap 160. These diagnose numerical convergence, not recurrence location.\n");

const retrievalRows = [];
for (const depth of [1, 2, 3]) {
  const positives = [];
  const negatives = [];
  let topOne = 0;
  for (let query = 0; query < fixtures.length; query += 1) {
    const child = fixtures[query].family.levels[depth].signal;
    const scores = fixtures.map((fixture) => comparePitchSignals(
      fixture.family.levels[0].signal,
      child,
    ).score);
    positives.push(scores[query]);
    scores.forEach((score, candidate) => {
      if (candidate !== query) negatives.push(score);
    });
    const best = scores.reduce((winner, score, index) => score > scores[winner] ? index : winner, 0);
    if (best === query) topOne += 1;
  }
  retrievalRows.push({
    depth,
    topOne: topOne / fixtures.length,
    positiveMedian: median(positives),
    mismatch95: percentile(negatives, 0.95),
    auroc: auroc(positives, negatives),
  });
}

process.stdout.write("\n40-way motif retrieval after normalizing time (chance top-1 = 2.5%)\n\n");
process.stdout.write("| Depth | Correct source top-1 | AUROC | Match median | Mismatch 95th %ile |\n");
process.stdout.write("|---:|---:|---:|---:|---:|\n");
for (const row of retrievalRows) {
  process.stdout.write(`| ${row.depth} | ${percent(row.topOne)} | ${row.auroc.toFixed(3)} | ${row.positiveMedian.toFixed(3)} | ${row.mismatch95.toFixed(3)} |\n`);
}

process.stdout.write("\nDepth-3 retrieval within each preset (chance = 10%)\n\n");
for (const preset of presets) {
  const group = fixtures.filter((fixture) => fixture.preset === preset.name);
  let correct = 0;
  group.forEach((query, queryIndex) => {
    const child = query.family.levels[3].signal;
    const scores = group.map((candidate) => comparePitchSignals(candidate.family.levels[0].signal, child).score);
    const best = scores.reduce((winner, score, index) => score > scores[winner] ? index : winner, 0);
    if (best === queryIndex) correct += 1;
  });
  process.stdout.write(`${preset.name}: ${percent(correct / group.length)}\n`);
}

process.stdout.write("\nOracle-assisted depth-3 zoom-field validation (marching squares, cap 160+3, common normalized-arclength smoothing)\n\n");
for (const resolution of [160, 320]) {
  const checks = rasterChecks.filter((check) => check.resolution === resolution);
  process.stdout.write(`${resolution}²: oracle-matched candidate found ${checks.length}/${fixtures.length} · median parent/raster pitch r=${median(checks.map((check) => check.pitch.pitchCorrelation)).toFixed(3)} · ≥.80 ${percent(checks.filter((check) => check.pitch.pitchCorrelation >= 0.8).length / Math.max(1, checks.length))} · median geometric RMSE ${percent(median(checks.map((check) => check.normalizedGeometryError)))} of window span\n`);
}

process.stdout.write("\nPlan-specific local proxies (not five independent listening-recognition scores)\n\n");
process.stdout.write("| Plan | Proxy | What was actually tested |\n");
process.stdout.write("|---|---:|---|\n");
const meanings = {
  chorus: "median parent/child tangent-pitch correlation",
  canon: "median local pitch/interval/coherence composite",
  wavelet: "median same-index dyadic Laplacian-band correlation",
};
for (const key of ["chorus", "canon", "wavelet"]) {
  process.stdout.write(`| ${key} | ${percent(median(planScores[key]))} | ${meanings[key]} |\n`);
}
process.stdout.write(`| orbit | sanity check only | exact inverse→forward whole-arc round trip; raw point orbits are not outline-bearing |\n`);
process.stdout.write(`| harmony | AUROC ${median(retrievalRows.map((row) => row.auroc)).toFixed(3)} | detector separation from the 40-way retrieval; it reports resemblance but does not carry an outline |\n`);

const rabbit = generateJuliaBoundary({
  cReal: -0.123,
  cImag: 0.745,
  resolution: 256,
  maxIterations: 160,
  simplifyTolerance: 0.35,
});
const reference = buildInverseArcFamily(
  sampleBoundaryArc(rabbit.boundary, rabbit.field, { centerPhase: 0.5, fraction: 0.025, samples: 512 }),
  { cReal: -0.123, cImag: 0.745, depth: 1 },
).levels[0].signal;
process.stdout.write("\nRabbit phase-0.5 motif: 50 Hz command sampling and 7.5 oct/s slew-limit proxies (not rendered audio or human recognition)\n");
for (const duration of [0.5, 1, 2, 4, 8]) {
  const sampled = temporalPitchFidelity(reference, duration);
  const limited = rateLimitedTemporalPitchFidelity(reference, duration);
  process.stdout.write(`${duration.toFixed(1)} s: sampled ${percent(sampled.pitchCorrelation)} · slew-limited ${percent(limited.pitchCorrelation)} · limiter active ${percent(limited.limitedFraction)}\n`);
}

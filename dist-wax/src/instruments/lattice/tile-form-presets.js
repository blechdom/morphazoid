import { constrainPrototileEdit, prototileIsNonOverlapping, tilingInfo, TILING_TYPES } from "./lattice.js";

export const quantize = (value, step, min, max) => {
  const number = Number.isFinite(Number(value)) ? Number(value) : min;
  return Math.round(Math.min(max, Math.max(min, number)) / step) * step;
};
export const q = (value, step, min, max) => Number(quantize(value, step, min, max).toFixed(6));
const parameterOnGrid = (value, type, index) => {
  const center = tilingInfo(type).defaultParameters[index];
  const half = type === 1 ? .25 : .35;
  const number = Number.isFinite(Number(value)) ? Number(value) : center;
  const offset = Math.round((number - center) / .005) * .005;
  return center + Math.min(half, Math.max(-half, offset));
};
const isRigid = (info, index) => info.edgeShapeNames[index] === "I";
export const choice = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export function canonicalTileForm(type, parameters, edgeCurves) {
  const info = tilingInfo(type);
  const fit = (values, count, fallback) => Array.from({ length: count }, (_, index) => values?.[index] ?? fallback(index));
  const rounded = {
    parameters: fit(parameters, info.defaultParameters.length, index => info.defaultParameters[index]).map((value, index) => parameterOnGrid(value, info.type, index)),
    edgeCurves: fit(edgeCurves, info.edgeShapes.length, () => 0).map((value, index) => (isRigid(info, index) ? 0 : q(value, .01, -1, 1))),
  };
  const options = { type: info.type, ...rounded };
  if (prototileIsNonOverlapping(options)) return rounded;
  const guarded = constrainPrototileEdit({
    type: info.type, currentParameters: [...info.defaultParameters], parameters: rounded.parameters,
    currentEdgeCurves: info.edgeShapes.map(() => 0), edgeCurves: rounded.edgeCurves,
  });
  const retry = {
    parameters: guarded.parameters.map((value, index) => parameterOnGrid(value, info.type, index)),
    edgeCurves: guarded.edgeCurves.map((value, index) => (isRigid(info, index) ? 0 : q(value, .01, -1, 1))),
  };
  if (prototileIsNonOverlapping({ type: info.type, ...retry })) return retry;
  return { parameters: [...info.defaultParameters], edgeCurves: info.edgeShapes.map(() => 0) };
}


export function randomTileForm(rng) {
  const info = rng.pick(TILING_TYPES);
  const parameters = info.defaultParameters.map(center => center + rng.between(-.8, .8) * (info.type === 1 ? .25 : .35));
  const edgeCurves = info.edgeShapes.map((_, index) => (isRigid(info, index) ? 0 : rng.between(-.85, .85)));
  return { tilingType: info.type, parameters, edgeCurves };
}

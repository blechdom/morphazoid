import {
  TILING_TYPES, constrainPrototileEdit, edgeShapeName, prototileIsNonOverlapping, tilingInfo, tilingParameterRange,
} from "../lattice/lattice.js";

export const roundPreset = value => Number(value.toFixed(6));

export function steppedValue(spec, value) {
  const [min, max, step] = spec;
  const stepped = Math.round((Math.min(max, Math.max(min, value)) - min) / step) * step + min;
  return roundPreset(Math.min(max, Math.max(min, stepped)));
}

/** Parameters and bends are offsets/curves from the tile's straight default, constrained to a simple prototile. */
export function guardedTile(type, parameterOffsets = [], curves = []) {
  const info = tilingInfo(type);
  const parameters = info.defaultParameters.map((center, index) => {
    const { min, max } = tilingParameterRange(info.type, index);
    return Math.min(max, Math.max(min, center + (parameterOffsets[index] ?? 0)));
  });
  const edgeCurves = info.edgeShapes.map((shape, index) => (edgeShapeName(shape) === "I" ? 0 : curves[index] ?? 0));
  const guarded = constrainPrototileEdit({
    type: info.type, currentParameters: info.defaultParameters, parameters,
    currentEdgeCurves: info.edgeShapes.map(() => 0), edgeCurves,
  });
  const rounded = { parameters: guarded.parameters.map(roundPreset), edgeCurves: guarded.edgeCurves.map(roundPreset) };
  if (tileIsValid({ tilingType: info.type, ...rounded })) return rounded;
  return { parameters: [...info.defaultParameters], edgeCurves: info.edgeShapes.map(() => 0) };
}

export function randomGuardedTile(rng) {
  const info = rng.pick(TILING_TYPES);
  return {
    tilingType: info.type,
    ...guardedTile(
      info.type,
      info.defaultParameters.map((center, index) => {
        const { min, max } = tilingParameterRange(info.type, index);
        return rng.between(min, max) - center;
      }),
      info.edgeShapes.map(() => rng.between(-0.85, 0.85)),
    ),
  };
}

export function tileIsValid({ tilingType, parameters, edgeCurves }) {
  const info = TILING_TYPES.find(candidate => candidate.type === tilingType);
  if (!info || !Array.isArray(parameters) || parameters.length !== info.defaultParameters.length
    || !Array.isArray(edgeCurves) || edgeCurves.length !== info.edgeShapes.length) return false;
  const parametersOk = parameters.every((value, index) => {
    const { min, max } = tilingParameterRange(info.type, index);
    return typeof value === "number" && value >= min - 1e-9 && value <= max + 1e-9;
  });
  const curvesOk = edgeCurves.every((value, index) => (
    typeof value === "number" && value >= -1 && value <= 1
    && (edgeShapeName(info.edgeShapes[index]) !== "I" || value === 0)
  ));
  return parametersOk && curvesOk
    && prototileIsNonOverlapping({ type: info.type, parameters, edgeCurves });
}

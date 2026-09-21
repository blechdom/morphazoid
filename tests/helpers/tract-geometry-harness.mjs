import { createContext, runInContext } from "node:vm";

import * as model from "../../src/families/tract/throatazoid.js";
import {
  buildTractDiameterProfile,
  buildTractGeometry,
  interpolatePoint,
  tractPoint,
} from "../../src/families/tract/geometry.js";

export function createTractGeometryHarness(record, functions = record.functions) {
  const context = createContext({
    ...model,
    Float32Array,
    buildTractDiameterProfile,
    buildTractGeometry,
    interpolatePoint,
    tractPoint,
    cssWidth: 900,
    cssHeight: 600,
    selectedThroat: 0,
    state: null,
  });
  runInContext([
    record.articulationConstants,
    record.functions.currentArticulationIndex,
    record.functions.perceptualNoseOpening,
    ...["interpolatePoint", "tractPoint", "tractDiameterProfile", "tractGeometry"]
      .map((name) => functions[name]).filter(Boolean),
  ].join("\n\n"), context);
  const api = runInContext("({ interpolatePoint, tractPoint, tractDiameterProfile, tractGeometry })", context);
  return {
    context,
    setScene(state, { width = 900, height = 600, selectedThroat = 0 } = {}) {
      Object.assign(context, { state, cssWidth: width, cssHeight: height, selectedThroat });
    },
    call(name, ...args) {
      return structuredClone(api[name](...args));
    },
  };
}

export function pageGeometryFunctions(source) {
  return Object.fromEntries(
    ["interpolatePoint", "tractPoint", "tractDiameterProfile", "tractGeometry"]
      .map((name) => [
        name,
        source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`, "m"))?.[0],
      ])
      .filter(([, value]) => value),
  );
}

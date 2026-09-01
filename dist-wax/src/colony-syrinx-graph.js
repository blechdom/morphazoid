import {
  COLONY_SYRINX_LUNG_COUNT,
  COLONY_SYRINX_MOUTH_COUNT,
  COLONY_SYRINX_PHONATOR_COUNT,
  COLONY_SYRINX_TOPOLOGY,
} from "./colony-syrinx.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const clamp = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const hash32 = (value) => {
  let result = Number(value) >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x7feb352d);
  result = Math.imul(result ^ (result >>> 15), 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
};

const normalizedSeed = (value, fallback = 0x436f6c6f) => {
  if (typeof value === "string" && value.trim()) {
    let result = 0x811c9dc5;
    for (const character of value.trim()) {
      result ^= character.codePointAt(0);
      result = Math.imul(result, 0x01000193);
    }
    return result >>> 0;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) >>> 0 : fallback >>> 0;
};

const seededUnit = (seed, kindSalt, index, attempt, channel) => hash32(
  seed
    ^ kindSalt
    ^ Math.imul(index + 1, 0x9e3779b9)
    ^ Math.imul(attempt + 1, 0x85ebca6b)
    ^ Math.imul(channel + 1, 0xc2b2ae35),
) / 0x1_0000_0000;

export const COLONY_SYRINX_GRAPH_VIEWBOX = deepFreeze({
  x: 0,
  y: 0,
  width: 1_200,
  height: 620,
});

export const COLONY_SYRINX_GRAPH_REGIONS = deepFreeze({
  lung: {
    minX: 48,
    maxX: 380,
    minY: 58,
    maxY: 562,
    gap: 7,
  },
  source: {
    minX: 340,
    maxX: 690,
    minY: 70,
    maxY: 550,
    gap: 14,
  },
  mouth: {
    minX: 720,
    maxX: 904,
    minY: 88,
    maxY: 532,
    gap: 18,
  },
});

const KIND_DEFINITIONS = deepFreeze({
  lung: {
    prefix: "lung",
    count: COLONY_SYRINX_LUNG_COUNT,
    salt: 0x1a2b3c4d,
    minimumScale: 0.52,
    maximumScale: 0.72,
    minimumRotation: -11,
    maximumRotation: 11,
    radiusBase: 21,
    radiusScale: 13,
    variantCount: 4,
  },
  source: {
    prefix: "source",
    count: COLONY_SYRINX_PHONATOR_COUNT,
    salt: 0x5e6f7081,
    minimumScale: 0.88,
    maximumScale: 1.08,
    minimumRotation: -4,
    maximumRotation: 4,
    radiusBase: 35,
    radiusScale: 5,
    variantCount: 4,
  },
  mouth: {
    prefix: "mouth",
    count: COLONY_SYRINX_MOUTH_COUNT,
    salt: 0x92a3b4c5,
    minimumScale: 0.86,
    maximumScale: 1.02,
    minimumRotation: -3,
    maximumRotation: 3,
    radiusBase: 54,
    radiusScale: 8,
    variantCount: 3,
  },
});

const NODE_DESCRIPTORS = Object.entries(KIND_DEFINITIONS).flatMap(([kind, definition]) => (
  Array.from({ length: definition.count }, (_, index) => ({
    id: `${definition.prefix}-${index + 1}`,
    kind,
    index,
  }))
));

export const COLONY_SYRINX_GRAPH_NODE_IDS = Object.freeze(
  NODE_DESCRIPTORS.map(({ id }) => id),
);

const descriptorById = new Map(NODE_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]));

const nodeCollisionRadius = (kind, scale) => {
  const definition = KIND_DEFINITIONS[kind];
  return definition.radiusBase + definition.radiusScale * scale;
};

export function colonySyrinxGraphNodeCollisionRadius(node) {
  return node && KIND_DEFINITIONS[node.kind]
    ? nodeCollisionRadius(node.kind, clamp(
      node.scale,
      KIND_DEFINITIONS[node.kind].minimumScale,
      KIND_DEFINITIONS[node.kind].maximumScale,
      1,
    ))
    : 0;
}

const collisionClearance = (candidate, placed, gap) => placed.reduce((minimum, node) => (
  Math.min(
    minimum,
    Math.hypot(candidate.x - node.x, candidate.y - node.y)
      - colonySyrinxGraphNodeCollisionRadius(candidate)
      - colonySyrinxGraphNodeCollisionRadius(node)
      - gap,
  )
), Infinity);

const candidatePosition = (seed, descriptor, attempt, bounds = null) => {
  const definition = KIND_DEFINITIONS[descriptor.kind];
  const region = COLONY_SYRINX_GRAPH_REGIONS[descriptor.kind];
  const minX = clamp(bounds?.minX, region.minX, region.maxX, region.minX);
  const maxX = clamp(bounds?.maxX, minX, region.maxX, region.maxX);
  return {
    x: minX + seededUnit(seed, definition.salt, descriptor.index, attempt, 0)
      * (maxX - minX),
    y: region.minY + seededUnit(seed, definition.salt, descriptor.index, attempt, 1)
      * (region.maxY - region.minY),
  };
};

const appearanceForNode = (seed, descriptor) => {
  const definition = KIND_DEFINITIONS[descriptor.kind];
  const scale = definition.minimumScale
    + seededUnit(seed, definition.salt, descriptor.index, 0, 2)
      * (definition.maximumScale - definition.minimumScale);
  const rotation = definition.minimumRotation
    + seededUnit(seed, definition.salt, descriptor.index, 0, 3)
      * (definition.maximumRotation - definition.minimumRotation);
  return {
    scale,
    rotation,
    variant: Math.floor(
      seededUnit(seed, definition.salt, descriptor.index, 0, 4) * definition.variantCount,
    ),
  };
};

const placeGeneratedNode = (seed, descriptor, placed, bounds = null) => {
  const appearance = appearanceForNode(seed, descriptor);
  const region = COLONY_SYRINX_GRAPH_REGIONS[descriptor.kind];
  if (!placed.length) {
    return { ...candidatePosition(seed, descriptor, 0, bounds), ...appearance };
  }
  let best = null;
  let bestClearance = -Infinity;
  for (let attempt = 0; attempt < 1_024; attempt += 1) {
    const position = candidatePosition(seed, descriptor, attempt, bounds);
    const candidate = { ...position, ...appearance };
    const clearance = collisionClearance(candidate, placed, region.gap);
    if (clearance > bestClearance) {
      best = candidate;
      bestClearance = clearance;
    }
  }
  return best;
};

const fallbackNodeForDescriptor = (seed, descriptor) => ({
  ...descriptor,
  ...candidatePosition(seed, descriptor, 0),
  ...appearanceForNode(seed, descriptor),
});

const freezeLayout = ({ seed, nodes }) => deepFreeze({
  seed: normalizedSeed(seed),
  nodes,
});

export function createColonySyrinxGraphLayout(options = {}) {
  const seed = options && typeof options === "object" ? options.seed : options;
  const normalized = normalizedSeed(seed);
  const nodes = {};
  for (const kind of Object.keys(KIND_DEFINITIONS)) {
    const placed = [];
    for (const descriptor of NODE_DESCRIPTORS.filter((node) => node.kind === kind)) {
      const fixedFeedLungs = descriptor.kind === "source"
        ? Array.from(
          { length: COLONY_SYRINX_TOPOLOGY.lungsPerBank },
          (_, offset) => nodes[
            `lung-${descriptor.index * COLONY_SYRINX_TOPOLOGY.lungsPerBank + offset + 1}`
          ],
        )
        : [];
      const bounds = fixedFeedLungs.length
        ? { minX: Math.max(...fixedFeedLungs.map(({ x }) => x)) + 86 }
        : null;
      const generated = placeGeneratedNode(normalized, descriptor, placed, bounds);
      const node = {
        ...descriptor,
        x: generated.x,
        y: generated.y,
        scale: generated.scale,
        rotation: generated.rotation,
        variant: generated.variant,
      };
      nodes[node.id] = node;
      placed.push(node);
    }
  }
  return freezeLayout({ seed: normalized, nodes });
}

const maskForKind = (enabled, kind) => {
  if (!enabled || typeof enabled !== "object") return null;
  if (kind === "lung") return enabled.lungEnabled ?? enabled.lungs ?? null;
  if (kind === "source") {
    return enabled.phonatorEnabled ?? enabled.sourceEnabled ?? enabled.sources ?? null;
  }
  return enabled.mouthEnabled ?? enabled.mouths ?? null;
};

const maskValue = (enabled, kind, index) => {
  const mask = maskForKind(enabled, kind);
  if (!Array.isArray(mask) && !ArrayBuffer.isView(mask)) return true;
  return Boolean(mask[index]);
};

const clampNode = (raw, fallback, descriptor) => {
  const definition = KIND_DEFINITIONS[descriptor.kind];
  const region = COLONY_SYRINX_GRAPH_REGIONS[descriptor.kind];
  const scale = clamp(
    raw?.scale,
    definition.minimumScale,
    definition.maximumScale,
    fallback.scale,
  );
  return {
    ...descriptor,
    x: clamp(raw?.x, region.minX, region.maxX, fallback.x),
    y: clamp(raw?.y, region.minY, region.maxY, fallback.y),
    scale,
    rotation: clamp(
      raw?.rotation,
      definition.minimumRotation,
      definition.maximumRotation,
      fallback.rotation,
    ),
    variant: Math.round(clamp(
      raw?.variant,
      0,
      definition.variantCount - 1,
      fallback.variant,
    )),
  };
};

const resolveNearestPosition = (node, placed, region, orientation = 0) => {
  if (collisionClearance(node, placed, region.gap) >= 0) return node;
  let best = node;
  let bestClearance = collisionClearance(node, placed, region.gap);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let attempt = 1; attempt <= 1_024; attempt += 1) {
    const radius = 9 * Math.sqrt(attempt);
    const angle = orientation + attempt * goldenAngle;
    const candidate = {
      ...node,
      x: clamp(node.x + Math.cos(angle) * radius, region.minX, region.maxX, node.x),
      y: clamp(node.y + Math.sin(angle) * radius, region.minY, region.maxY, node.y),
    };
    const clearance = collisionClearance(candidate, placed, region.gap);
    if (clearance >= 0) return candidate;
    if (clearance > bestClearance) {
      best = candidate;
      bestClearance = clearance;
    }
  }
  return best;
};

export function sanitizeColonySyrinxGraphLayout(input, fallback = null) {
  const source = input && typeof input === "object" ? input : {};
  const seed = normalizedSeed(source.seed, normalizedSeed(fallback?.seed));
  const fallbackSeed = normalizedSeed(fallback?.seed, seed);
  const suppliedNodes = source.nodes && typeof source.nodes === "object" ? source.nodes : {};
  const nodes = {};
  const placedByKind = { lung: [], source: [], mouth: [] };
  for (const descriptor of NODE_DESCRIPTORS) {
    const fallbackNode = clampNode(
      fallback?.nodes?.[descriptor.id],
      fallbackNodeForDescriptor(fallbackSeed, descriptor),
      descriptor,
    );
    let node = clampNode(suppliedNodes[descriptor.id], fallbackNode, descriptor);
    node = resolveNearestPosition(
      node,
      placedByKind[descriptor.kind],
      COLONY_SYRINX_GRAPH_REGIONS[descriptor.kind],
      seededUnit(seed, KIND_DEFINITIONS[descriptor.kind].salt, descriptor.index, 0, 5)
        * Math.PI * 2,
    );
    placedByKind[descriptor.kind].push(node);
    nodes[node.id] = node;
  }
  return freezeLayout({ seed, nodes });
}

export function isColonySyrinxGraphNodeEnabled(nodeReference, enabled = null) {
  const id = typeof nodeReference === "string" ? nodeReference : nodeReference?.id;
  const descriptor = descriptorById.get(id);
  return descriptor ? maskValue(enabled, descriptor.kind, descriptor.index) : false;
}

export function moveColonySyrinxGraphNode(
  layout,
  nodeReference,
  position,
) {
  const clean = sanitizeColonySyrinxGraphLayout(layout);
  const id = typeof nodeReference === "string" ? nodeReference : nodeReference?.id;
  const descriptor = descriptorById.get(id);
  if (!descriptor) return clean;
  const current = clean.nodes[id];
  const region = COLONY_SYRINX_GRAPH_REGIONS[descriptor.kind];
  let moved = {
    ...current,
    x: clamp(position?.x, region.minX, region.maxX, current.x),
    y: clamp(position?.y, region.minY, region.maxY, current.y),
  };
  const peers = Object.values(clean.nodes).filter((node) => (
    node.kind === descriptor.kind && node.id !== id
  ));
  moved = resolveNearestPosition(
    moved,
    peers,
    region,
    seededUnit(clean.seed, KIND_DEFINITIONS[descriptor.kind].salt, descriptor.index, 0, 6)
      * Math.PI * 2,
  );
  return freezeLayout({
    seed: clean.seed,
    nodes: { ...clean.nodes, [id]: moved },
  });
}

const routeReferenceToTopology = (reference) => {
  if (Number.isInteger(reference)) return COLONY_SYRINX_TOPOLOGY.routes[reference] ?? null;
  if (typeof reference === "string") {
    return COLONY_SYRINX_TOPOLOGY.routes.find(({ id }) => id === reference) ?? null;
  }
  if (!reference || typeof reference !== "object") return null;
  if (Number.isInteger(reference.index)) {
    return COLONY_SYRINX_TOPOLOGY.routes[reference.index] ?? null;
  }
  return COLONY_SYRINX_TOPOLOGY.routes.find(({ phonatorIndex, mouthIndex }) => (
    phonatorIndex === Number(reference.phonatorIndex ?? reference.sourceIndex)
    && mouthIndex === Number(reference.mouthIndex)
  )) ?? null;
};

const lungReferenceToIndex = (reference) => {
  if (Number.isInteger(reference)) return reference;
  if (typeof reference === "string") {
    const match = /^lung-(\d+)$/.exec(reference);
    return match ? Number(match[1]) - 1 : -1;
  }
  return Number.isInteger(reference?.lungIndex)
    ? reference.lungIndex
    : Number.isInteger(reference?.index) ? reference.index : -1;
};

const transformLocalPoint = (node, localX, localY) => {
  const radians = node.rotation * Math.PI / 180;
  const scaledX = localX * node.scale;
  const scaledY = localY * node.scale;
  return {
    x: node.x + scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
    y: node.y + scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
  };
};

const createAnchor = (node, side, localX, localY) => ({
  nodeId: node.id,
  kind: node.kind,
  index: node.index,
  side,
  local: { x: localX, y: localY },
  ...transformLocalPoint(node, localX, localY),
});

const formatCoordinate = (value) => {
  const rounded = Math.round(value * 1_000) / 1_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const cubicPath = (start, firstControl, secondControl, end) => (
  `M ${formatCoordinate(start.x)} ${formatCoordinate(start.y)} `
  + `C ${formatCoordinate(firstControl.x)} ${formatCoordinate(firstControl.y)} `
  + `${formatCoordinate(secondControl.x)} ${formatCoordinate(secondControl.y)} `
  + `${formatCoordinate(end.x)} ${formatCoordinate(end.y)}`
);

const stateFromOptions = (options) => options?.state ?? options?.enabled ?? options ?? null;

export function colonySyrinxEndpointEligible(state, sourceIndex, mouthIndex) {
  return Number.isInteger(sourceIndex)
    && sourceIndex >= 0
    && sourceIndex < COLONY_SYRINX_PHONATOR_COUNT
    && Number.isInteger(mouthIndex)
    && mouthIndex >= 0
    && mouthIndex < COLONY_SYRINX_MOUTH_COUNT
    && maskValue(state, "source", sourceIndex)
    && maskValue(state, "mouth", mouthIndex);
}

export function colonySyrinxLungFeedEligible(state, lungIndex, sourceIndex) {
  const fixedSourceIndex = Number.isInteger(lungIndex)
    ? Math.floor(lungIndex / COLONY_SYRINX_TOPOLOGY.lungsPerBank)
    : -1;
  return Number.isInteger(lungIndex)
    && lungIndex >= 0
    && lungIndex < COLONY_SYRINX_LUNG_COUNT
    && sourceIndex === fixedSourceIndex
    && maskValue(state, "lung", lungIndex)
    && maskValue(state, "source", sourceIndex);
}

const routeGeometryFromLayout = (layout, route, enabled) => {
  const sourceNode = layout.nodes[`source-${route.phonatorIndex + 1}`];
  const mouthNode = layout.nodes[`mouth-${route.mouthIndex + 1}`];
  const centerDistance = Math.abs(mouthNode.x - sourceNode.x);
  const centerDirection = mouthNode.x >= sourceNode.x ? 1 : -1;
  const sourceAnchor = createAnchor(
    sourceNode,
    "out",
    centerDirection * Math.min(42, centerDistance * 0.28 / sourceNode.scale),
    (route.mouthIndex - (COLONY_SYRINX_MOUTH_COUNT - 1) / 2) * 9,
  );
  const mouthAnchor = createAnchor(
    mouthNode,
    "in",
    -centerDirection * Math.min(10, centerDistance * 0.12 / mouthNode.scale),
    (route.phonatorIndex - (COLONY_SYRINX_PHONATOR_COUNT - 1) / 2) * 5,
  );
  const horizontalSpan = mouthAnchor.x - sourceAnchor.x;
  const horizontalDirection = horizontalSpan === 0 ? centerDirection : Math.sign(horizontalSpan);
  const handle = clamp(Math.abs(horizontalSpan) * 0.36, 2, 230, 140);
  const verticalSpan = mouthAnchor.y - sourceAnchor.y;
  const bow = ((route.phonatorIndex * COLONY_SYRINX_MOUTH_COUNT + route.mouthIndex) % 5 - 2) * 7;
  const sourceControl = {
    x: sourceAnchor.x + horizontalDirection * handle,
    y: sourceAnchor.y + verticalSpan * 0.16 + bow,
  };
  const mouthControl = {
    x: mouthAnchor.x - horizontalDirection * handle,
    y: mouthAnchor.y - verticalSpan * 0.16 + bow,
  };
  return deepFreeze({
    id: route.id,
    kind: "route",
    index: route.index,
    phonatorIndex: route.phonatorIndex,
    sourceIndex: route.phonatorIndex,
    mouthIndex: route.mouthIndex,
    eligible: colonySyrinxEndpointEligible(enabled, route.phonatorIndex, route.mouthIndex),
    anchors: {
      source: sourceAnchor,
      mouth: mouthAnchor,
    },
    controls: {
      source: sourceControl,
      mouth: mouthControl,
    },
    d: cubicPath(sourceAnchor, sourceControl, mouthControl, mouthAnchor),
  });
};

export function colonySyrinxRouteGeometry(
  layout,
  sourceIndex,
  mouthIndex,
  options = null,
) {
  const route = routeReferenceToTopology({ sourceIndex, mouthIndex });
  if (!route) throw new RangeError("Unknown Colony Syrinx route");
  return routeGeometryFromLayout(
    sanitizeColonySyrinxGraphLayout(layout),
    route,
    stateFromOptions(options),
  );
}

export function colonySyrinxRouteGeometries(layout, options = null) {
  const clean = sanitizeColonySyrinxGraphLayout(layout);
  return Object.freeze(COLONY_SYRINX_TOPOLOGY.routes.map((route) => (
    routeGeometryFromLayout(clean, route, stateFromOptions(options))
  )));
}

const feedGeometryFromLayout = (layout, lungIndex, enabled) => {
  const sourceIndex = Math.floor(lungIndex / COLONY_SYRINX_TOPOLOGY.lungsPerBank);
  const bankOffset = lungIndex % COLONY_SYRINX_TOPOLOGY.lungsPerBank;
  const lungNode = layout.nodes[`lung-${lungIndex + 1}`];
  const sourceNode = layout.nodes[`source-${sourceIndex + 1}`];
  const centerDistance = Math.abs(sourceNode.x - lungNode.x);
  const centerDirection = sourceNode.x >= lungNode.x ? 1 : -1;
  const lungLocalExtent = centerDirection > 0
    ? Math.min(40, centerDistance * 0.24 / lungNode.scale)
    : 40;
  const sourceLocalExtent = centerDirection > 0
    ? Math.min(42, centerDistance * 0.24 / sourceNode.scale)
    : 42;
  const lungAnchor = createAnchor(
    lungNode,
    "out",
    centerDirection * lungLocalExtent,
    0,
  );
  const sourceAnchor = createAnchor(
    sourceNode,
    "in",
    -centerDirection * sourceLocalExtent,
    (bankOffset - (COLONY_SYRINX_TOPOLOGY.lungsPerBank - 1) / 2) * 8,
  );
  const horizontalSpan = sourceAnchor.x - lungAnchor.x;
  const horizontalDirection = horizontalSpan === 0 ? centerDirection : Math.sign(horizontalSpan);
  const handle = clamp(Math.abs(horizontalSpan) * 0.38, 2, 82, 48);
  const verticalSpan = sourceAnchor.y - lungAnchor.y;
  const bow = (bankOffset - 1.5) * 4;
  const lungControl = {
    x: lungAnchor.x + horizontalDirection * handle,
    y: lungAnchor.y + verticalSpan * 0.2 + bow,
  };
  const sourceControl = {
    x: sourceAnchor.x - horizontalDirection * handle,
    y: sourceAnchor.y - verticalSpan * 0.2 + bow,
  };
  return deepFreeze({
    id: `feed-${lungIndex + 1}-${sourceIndex + 1}`,
    kind: "feed",
    lungIndex,
    phonatorIndex: sourceIndex,
    sourceIndex,
    eligible: colonySyrinxLungFeedEligible(enabled, lungIndex, sourceIndex),
    anchors: {
      lung: lungAnchor,
      source: sourceAnchor,
    },
    controls: {
      lung: lungControl,
      source: sourceControl,
    },
    d: cubicPath(lungAnchor, lungControl, sourceControl, sourceAnchor),
  });
};

export function colonySyrinxLungFeedGeometry(
  layout,
  lungReference,
  sourceIndex = null,
  options = null,
) {
  const lungIndex = lungReferenceToIndex(lungReference);
  if (lungIndex < 0 || lungIndex >= COLONY_SYRINX_LUNG_COUNT) {
    throw new RangeError("Unknown Colony Syrinx lung feed");
  }
  const fixedSourceIndex = Math.floor(lungIndex / COLONY_SYRINX_TOPOLOGY.lungsPerBank);
  const requestedSourceIndex = sourceIndex == null ? fixedSourceIndex : sourceIndex;
  if (requestedSourceIndex !== fixedSourceIndex) {
    throw new RangeError("A Colony Syrinx lung can only feed its fixed source");
  }
  return feedGeometryFromLayout(
    sanitizeColonySyrinxGraphLayout(layout),
    lungIndex,
    stateFromOptions(options),
  );
}

export function colonySyrinxLungFeedGeometries(layout, options = null) {
  const clean = sanitizeColonySyrinxGraphLayout(layout);
  return Object.freeze(Array.from({ length: COLONY_SYRINX_LUNG_COUNT }, (_, lungIndex) => (
    feedGeometryFromLayout(clean, lungIndex, stateFromOptions(options))
  )));
}

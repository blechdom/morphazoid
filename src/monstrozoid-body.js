const VIEWBOX = Object.freeze({ width: 1_200, height: 620 });

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum))
);

const finitePoint = (point) => (
  point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
);

const rounded = (value) => {
  const result = Math.round(Number(value) * 100) / 100;
  return String(Object.is(result, -0) ? 0 : result);
};

const pointText = (point) => `${rounded(point.x)} ${rounded(point.y)}`;

const hash32 = (value) => {
  let result = Number(value) >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x7feb352d);
  result = Math.imul(result ^ (result >>> 15), 0x846ca68b);
  return (result ^ (result >>> 16)) >>> 0;
};

const seededSigned = (seed, index, salt = 0) => (
  hash32((Number(seed) ^ Math.imul(index + 1, 0x9e3779b9) ^ salt) >>> 0)
    / 0x8000_0000 - 1
);

const maskForNode = (state, node) => {
  if (node.kind === "lung") return state?.lungEnabled;
  if (node.kind === "source") return state?.phonatorEnabled;
  if (node.kind === "mouth") return state?.mouthEnabled;
  return null;
};

const activeNodes = (layout, state) => Object.values(layout?.nodes ?? {})
  .filter(finitePoint)
  .filter((node) => {
    const mask = maskForNode(state, node);
    return !Array.isArray(mask) || Boolean(mask[node.index]);
  })
  .map((node) => ({
    ...node,
    // A mouth's node is its jaw hinge. Pull the body toward that hinge without
    // wrapping the body membrane around the whole head.
    bodyX: node.kind === "mouth" ? Number(node.x) - 38 : Number(node.x),
    bodyY: Number(node.y),
  }));

const midpoint = (left, right) => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2,
});

const closedSoftPath = (points) => {
  if (points.length < 3) return "";
  const start = midpoint(points.at(-1), points[0]);
  let path = `M ${pointText(start)}`;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    path += ` Q ${pointText(point)} ${pointText(midpoint(point, next))}`;
  });
  return `${path} Z`;
};

const openSoftPath = (points) => {
  if (!points.length) return "";
  if (points.length === 1) return `M ${pointText(points[0])}`;
  let path = `M ${pointText(points[0])}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    path += ` Q ${pointText(points[index])} ${pointText(midpoint(points[index], points[index + 1]))}`;
  }
  return `${path} T ${pointText(points.at(-1))}`;
};

const fallbackNodes = Object.freeze([
  { id: "fallback-a", kind: "lung", index: 0, x: 170, y: 190, bodyX: 170, bodyY: 190 },
  { id: "fallback-b", kind: "source", index: 0, x: 500, y: 310, bodyX: 500, bodyY: 310 },
  { id: "fallback-c", kind: "mouth", index: 0, x: 850, y: 310, bodyX: 812, bodyY: 310 },
]);

function membranePoints(nodes, seed) {
  const anchors = nodes.length ? nodes : fallbackNodes;
  const minX = Math.min(...anchors.map(({ bodyX }) => bodyX));
  const maxX = Math.max(...anchors.map(({ bodyX }) => bodyX));
  const minY = Math.min(...anchors.map(({ bodyY }) => bodyY));
  const maxY = Math.max(...anchors.map(({ bodyY }) => bodyY));
  const meanX = anchors.reduce((sum, node) => sum + node.bodyX, 0) / anchors.length;
  const meanY = anchors.reduce((sum, node) => sum + node.bodyY, 0) / anchors.length;
  const center = {
    x: clamp((minX + maxX) * 0.39 + meanX * 0.22, 250, 680),
    y: clamp((minY + maxY) * 0.39 + meanY * 0.22, 210, 410),
  };
  const radiusX = clamp(
    (maxX - minX) * 0.5 + 104,
    245,
    Math.min(435, center.x - 24, VIEWBOX.width - 250 - center.x - 24),
  );
  const radiusY = clamp(
    (maxY - minY) * 0.5 + 82,
    172,
    Math.min(255, center.y - 24, VIEWBOX.height - center.y - 24),
  );
  const count = 28;
  const organicPhase = seededSigned(seed, 0, 0x12f4a83d) * Math.PI;
  const points = Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const ellipseRadius = radiusX * radiusY / Math.max(
      1,
      Math.hypot(radiusY * direction.x, radiusX * direction.y),
    );
    const support = anchors.reduce((maximum, node) => {
      const padding = node.kind === "source" ? 62 : node.kind === "mouth" ? 52 : 48;
      return Math.max(
        maximum,
        (node.bodyX - center.x) * direction.x
          + (node.bodyY - center.y) * direction.y
          + padding,
      );
    }, 0);
    const localPull = anchors.reduce((sum, node) => {
      const nodeX = node.bodyX - center.x;
      const nodeY = node.bodyY - center.y;
      const nodeAngle = Math.atan2(nodeY, nodeX);
      const difference = Math.atan2(Math.sin(angle - nodeAngle), Math.cos(angle - nodeAngle));
      const weight = Math.exp(-(difference * difference) / 0.19);
      const padding = node.kind === "source" ? 58 : node.kind === "mouth" ? 48 : 44;
      return sum + (Math.hypot(nodeX, nodeY) + padding - ellipseRadius) * weight;
    }, 0);
    const supportCorrection = clamp(support - ellipseRadius, -40, 140) * 0.16;
    const lobes = Math.sin(angle * 3 + organicPhase) * 17
      + Math.sin(angle * 7 - organicPhase * 0.61) * 9;
    const serration = seededSigned(seed, index, 0x6d0f27bd) * (index % 2 ? 7 : 12);
    const radial = Math.max(
      ellipseRadius * 0.74,
      ellipseRadius + supportCorrection + localPull * 0.2 + lobes + serration,
    );
    return {
      x: clamp(center.x + direction.x * radial, 18, VIEWBOX.width - 250),
      y: clamp(center.y + direction.y * radial, 16, VIEWBOX.height - 16),
      angle,
    };
  });
  return { anchors, center, points };
}

function deformationWeb(nodes, center, seed) {
  const ordered = nodes.slice().sort((left, right) => (
    Math.atan2(left.bodyY - center.y, left.bodyX - center.x)
      - Math.atan2(right.bodyY - center.y, right.bodyX - center.x)
  ));
  const ringPoints = ordered.map((node) => ({ x: node.bodyX, y: node.bodyY }));
  const ring = ringPoints.length >= 3 ? closedSoftPath(ringPoints) : openSoftPath(ringPoints);
  const spokes = ordered.map((node, index) => {
    const bend = seededSigned(seed, index, 0x8421b35f) * 34;
    const dx = node.bodyX - center.x;
    const dy = node.bodyY - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const control = {
      x: center.x + dx * 0.54 - dy / length * bend,
      y: center.y + dy * 0.54 + dx / length * bend,
    };
    return `M ${pointText(center)} Q ${pointText(control)} ${rounded(node.bodyX)} ${rounded(node.bodyY)}`;
  });
  return [ring, ...spokes].filter(Boolean).join(" ");
}

function alienLimbs(points, center, seed) {
  const directions = [-2.92, -2.05, -1.12, 1.08, 2.02, 2.92];
  return directions.map((direction, index) => {
    const edge = points.reduce((nearest, point) => {
      const difference = Math.abs(Math.atan2(
        Math.sin(point.angle - direction),
        Math.cos(point.angle - direction),
      ));
      return !nearest || difference < nearest.difference ? { point, difference } : nearest;
    }, null)?.point ?? center;
    const unit = { x: Math.cos(direction), y: Math.sin(direction) };
    const perpendicular = { x: -unit.y, y: unit.x };
    const length = 68 + (seededSigned(seed, index, 0x33b5c7e1) + 1) * 48;
    const curl = seededSigned(seed, index, 0xa18c02d7) * 58;
    const first = {
      x: edge.x + unit.x * length * 0.32 + perpendicular.x * curl * 0.2,
      y: edge.y + unit.y * length * 0.32 + perpendicular.y * curl * 0.2,
    };
    const second = {
      x: edge.x + unit.x * length * 0.74 + perpendicular.x * curl,
      y: edge.y + unit.y * length * 0.74 + perpendicular.y * curl,
    };
    const end = {
      x: clamp(edge.x + unit.x * length + perpendicular.x * curl * 0.34, 8, VIEWBOX.width - 8),
      y: clamp(edge.y + unit.y * length + perpendicular.y * curl * 0.34, 8, VIEWBOX.height - 8),
    };
    const hook = {
      x: clamp(end.x - unit.x * 24 + perpendicular.x * (index % 2 ? -23 : 23), 8, VIEWBOX.width - 8),
      y: clamp(end.y - unit.y * 24 + perpendicular.y * (index % 2 ? -23 : 23), 8, VIEWBOX.height - 8),
    };
    return `M ${pointText(edge)} C ${pointText(first)} ${pointText(second)} ${pointText(end)} Q ${pointText(hook)} ${pointText(end)}`;
  });
}

/**
 * Derive the creature's outer membrane and connective tissue from its current
 * organ constellation. The geometry is deterministic, but every organ move
 * changes at least the connective web and often the outer silhouette and limbs.
 */
export function createMonstrozoidBodyGeometry(layout, state = null) {
  const nodes = activeNodes(layout, state);
  const seed = Number(layout?.seed ?? state?.seed ?? 0x4d5a4f49) >>> 0;
  const { anchors, center, points } = membranePoints(nodes, seed);
  return Object.freeze({
    center: Object.freeze({ ...center }),
    shell: closedSoftPath(points),
    web: deformationWeb(anchors, center, seed),
    limbs: Object.freeze(alienLimbs(points, center, seed)),
  });
}

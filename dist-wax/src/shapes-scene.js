import {
  buildShape,
  horizontalIntersections,
  pointAtPath,
  rayIntersections,
  verticalIntersections,
} from "./geometry.js";
import {
  buildSolid,
  deformSolid,
  planeBasis,
  planeIntersections,
  planeNormal,
  planeOffsetForPhase,
  projectPoint3,
  rotatePoint3,
} from "./solid.js";
import {
  hyperplaneIntersections,
  hyperplaneOffsetForShapePhase,
  projectPoint4,
  transformedHyperShape,
} from "./hyper.js";
import {
  displayShapesPhase,
  shapes2dHeadCount,
  shapes2dHeadPhase,
  shapes2dHeadTravel,
  shapesDivisionCount,
} from "./shapes-state.js";

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const MAX_VISIBLE_DIVISION_MARKERS = 1600;
const twoDimensionalPathCache = new Map();

function twoDimensionalPath(state) {
  const local = state.dimension["2d"];
  const key = [
    state.profile.sides,
    state.profile.kind,
    Number(state.profile.starDepth).toFixed(4),
    Number(local.curvature).toFixed(4),
    Number(local.aspect).toFixed(4),
    Number(local.skew).toFixed(4),
    Number(local.rotation).toFixed(4),
  ].join(":");
  const cached = twoDimensionalPathCache.get(key);
  if (cached) {
    // Two entries keep the current and 75 ms forecast rotations hot.
    twoDimensionalPathCache.delete(key);
    twoDimensionalPathCache.set(key, cached);
    return cached;
  }
  const path = buildShape({
    sides: state.profile.sides,
    shapeType: state.profile.kind === "star" ? "star" : state.profile.kind,
    starDepth: state.profile.starDepth,
    curvature: local.curvature,
    aspect: local.aspect,
    skew: local.skew,
    rotationDeg: local.rotation,
  });
  twoDimensionalPathCache.set(key, path);
  if (twoDimensionalPathCache.size > 2) {
    twoDimensionalPathCache.delete(twoDimensionalPathCache.keys().next().value);
  }
  return path;
}

function projectedBounds(points) {
  if (!points.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1, span: 2 };
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    span: Math.max(0.2, maxX - minX, maxY - minY),
  };
}

function contactVoice(contact, key, pitch, pan, drive) {
  return {
    ...contact,
    voiceKey: key,
    pitch01: clamp01(pitch),
    pan: Math.min(1, Math.max(-1, Number(pan) || 0)),
    drive01: clamp01(drive),
    strength: clamp01(0.28 + (contact.cornerStrength ?? 0.35) * 0.62),
  };
}

function contactRegionOnPath(contact, path, divisions) {
  const count = Math.max(1, Math.round(Number(divisions) || 1));
  if (path.shapeType === "circle" || path.vertexDistances.length < 2) {
    const phase = ((Number(contact.u) % 1) + 1) % 1;
    return `contour:${Math.min(count - 1, Math.floor(phase * count))}`;
  }
  const sideCount = path.closed
    ? path.vertexDistances.length
    : Math.max(1, path.vertexDistances.length - 1);
  const distance = Math.min(path.totalLength, Math.max(0, Number(contact.distance) || 0));
  let sideIndex = sideCount - 1;
  for (let index = 0; index < sideCount; index += 1) {
    const end = index + 1 < path.vertexDistances.length
      ? path.vertexDistances[index + 1]
      : path.totalLength;
    if (distance < end) {
      sideIndex = index;
      break;
    }
  }
  const start = path.vertexDistances[sideIndex] ?? 0;
  const end = sideIndex + 1 < path.vertexDistances.length
    ? path.vertexDistances[sideIndex + 1]
    : path.totalLength;
  const local = Math.min(1, Math.max(0, (distance - start) / Math.max(1e-9, end - start)));
  const segment = Math.min(count - 1, Math.floor(local * count));
  return `side:${sideIndex}:segment:${segment}`;
}

function projectedAlong(point, start, end, fallback = 0) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return clamp01(fallback);
  return clamp01(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared);
}

function edgeContactRegion(dimension, contact, start, end, divisions) {
  const count = Math.max(1, Math.round(Number(divisions) || 1));
  const along = projectedAlong(contact.view, start, end, contact.t);
  const segment = Math.min(count - 1, Math.floor(along * count));
  return `${dimension}:edge:${Math.max(0, Math.trunc(contact.edgeIndex ?? 0))}:segment:${segment}`;
}

function twoDimensionalTopologyEdgeCount(path) {
  if (path.shapeType === "circle") return 1;
  return path.closed
    ? Math.max(1, path.vertexDistances.length)
    : Math.max(1, path.vertexDistances.length - 1);
}

function buildTwoDimensionalScene(state, phase) {
  const local = state.dimension["2d"];
  const path = twoDimensionalPath(state);
  const reader = local.reader;
  const height = Math.max(path.bounds.height, 0.001);
  const width = Math.max(path.bounds.width, 0.001);
  const divisions = shapesDivisionCount(state);
  const readers = [];
  const voiced = [];

  for (let headIndex = 0; headIndex < shapes2dHeadCount(state); headIndex += 1) {
    const headTravel = shapes2dHeadTravel(state, headIndex, reader);
    const headPhase = shapes2dHeadPhase(state, headIndex, reader);
    let rawContacts;
    let readerGeometry;

    if (reader === "line") {
      const axis = local.scanLineAxes?.[headIndex] === "horizontal"
        ? "horizontal"
        : "vertical";
      const minimum = axis === "horizontal" ? path.bounds.minY : path.bounds.minX;
      const span = axis === "horizontal" ? path.bounds.height : path.bounds.width;
      const coordinate = minimum + span * headPhase;
      rawContacts = axis === "horizontal"
        ? horizontalIntersections(path, coordinate)
        : verticalIntersections(path, coordinate);
      readerGeometry = {
        type: "line",
        headIndex,
        headTravel,
        phase: headPhase,
        axis,
        coordinate,
        ...(axis === "horizontal" ? { y: coordinate } : { x: coordinate }),
      };
    } else if (reader === "radar") {
      const angle = headPhase * Math.PI * 2 - Math.PI / 2;
      rawContacts = rayIntersections(path, angle);
      readerGeometry = {
        type: "radar",
        headIndex,
        headTravel,
        phase: headPhase,
        angle,
      };
    } else {
      rawContacts = [pointAtPath(path, headPhase, { pingPong: false })];
      readerGeometry = {
        type: "points",
        headIndex,
        headTravel,
        phase: headPhase,
      };
    }

    const headContacts = rawContacts.map((contact, contactIndex) => ({
      ...contactVoice(
        {
          ...contact,
          headIndex,
          headTravel,
          headPhase,
          scanAxis: reader === "line" ? readerGeometry.axis : reader === "radar" ? "radial" : "path",
          view: { x: contact.x, y: contact.y, z: 0 },
        },
        `2d:${reader}:head:${headIndex}:contact:${contactIndex}`,
        1 - (contact.y - path.bounds.minY) / height,
        ((contact.x - path.bounds.minX) / width) * 2 - 1,
        contact.cornerStrength ?? contact.segmentT ?? 0.5,
      ),
      eventKey: `2d:${contactRegionOnPath(contact, path, divisions)}:head:${headIndex}`,
    }));
    readerGeometry.contacts = headContacts;
    if (reader === "points") readerGeometry.contact = headContacts[0];
    readers.push(readerGeometry);
    voiced.push(...headContacts);
  }

  const edges = [];
  const segmentCount = path.closed ? path.points.length : Math.max(0, path.points.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    edges.push({
      a: path.points[index],
      b: path.points[(index + 1) % path.points.length],
      axis: "xy",
      depth: 0,
    });
  }
  return {
    dimension: "2d",
    phase,
    vertices: path.points,
    edges,
    contacts: voiced,
    // `reader` keeps existing hosts working while `readers` exposes every
    // independent 2D playhead to multihead-aware renderers.
    reader: readers[0],
    readers,
    bounds: projectedBounds(path.points),
    closed: path.closed,
    vertexIndices: path.vertexIndices,
    topologyEdgeCount: twoDimensionalTopologyEdgeCount(path),
    geometry: path,
  };
}

function buildThreeDimensionalScene(state, phase) {
  const local = state.dimension["3d"];
  const source = buildSolid(local.representation, { profile: state.profile });
  const deformed = deformSolid(source, {
    scaleX: local.scale.x,
    scaleY: local.scale.y,
    scaleZ: local.scale.z,
    skewX: local.skew.x,
    skewZ: local.skew.z,
  });
  const solid = {
    ...deformed,
    vertices: deformed.vertices.map((point) => rotatePoint3(point, local.rotation)),
  };
  const normal = planeNormal(local.readerYaw, local.readerPitch);
  const radius = Math.max(
    0.05,
    ...solid.vertices.map((point) => Math.abs(
      normal.x * point.x + normal.y * point.y + normal.z * point.z
    )),
  ) + 0.04;
  const plane = { normal, offset: planeOffsetForPhase(phase, radius) };
  const contacts = planeIntersections(solid, plane.normal, plane.offset);
  const vertices = solid.vertices.map((point) => ({ ...projectPoint3(point), source: point }));
  const divisions = shapesDivisionCount(state);
  const voiced = contacts.map((contact, index) => {
    const view = projectPoint3(contact);
    const edge = solid.edges[contact.edgeIndex];
    const start = edge ? projectPoint3(solid.vertices[edge.a]) : view;
    const end = edge ? projectPoint3(solid.vertices[edge.b]) : view;
    return contactVoice(
      {
        ...contact,
        view,
        eventKey: edgeContactRegion("3d", { ...contact, view }, start, end, divisions),
      },
      `3d:${contact.edgeIndex ?? index}`,
      (contact.y + 1.1) / 2.2,
      view.x,
      (contact.z + 1.1) / 2.2,
    );
  });
  const edges = solid.edges.map((edge) => ({
    ...edge,
    a: vertices[edge.a],
    b: vertices[edge.b],
    depth: (solid.vertices[edge.a].z + solid.vertices[edge.b].z) * 0.5,
  }));
  const { u, v } = planeBasis(plane.normal);
  const center = {
    x: plane.normal.x * plane.offset,
    y: plane.normal.y * plane.offset,
    z: plane.normal.z * plane.offset,
  };
  const planeCorners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => projectPoint3({
    x: center.x + (u.x * a + v.x * b) * radius,
    y: center.y + (u.y * a + v.y * b) * radius,
    z: center.z + (u.z * a + v.z * b) * radius,
  }));
  return {
    dimension: "3d",
    phase,
    vertices,
    edges,
    contacts: voiced,
    reader: { type: "plane", corners: planeCorners },
    bounds: projectedBounds(vertices),
    topologyEdgeCount: edges.length,
    geometry: solid,
    plane,
  };
}

function hyperViewPoint(point) {
  const fourProjected = projectPoint4(point);
  const viewed = rotatePoint3(fourProjected, { x: -16, y: 27, z: 0 });
  return { ...projectPoint3(viewed, 3.8), w: point.w };
}

function buildFourDimensionalScene(state, phase) {
  const local = state.dimension["4d"];
  const hyper = transformedHyperShape(local.representation, local.rotation, {
    ...local.scale,
    profile: state.profile,
  });
  const offset = hyperplaneOffsetForShapePhase(hyper, phase);
  const contacts = hyperplaneIntersections(hyper, offset);
  const vertices = hyper.vertices.map((point) => ({ ...hyperViewPoint(point), source: point }));
  const divisions = shapesDivisionCount(state);
  const voiced = contacts.map((contact, index) => {
    const view = hyperViewPoint(contact);
    const edge = hyper.edges[contact.edgeIndex];
    const start = edge ? vertices[edge.a] : view;
    const end = edge ? vertices[edge.b] : view;
    return contactVoice(
      {
        ...contact,
        view,
        eventKey: edgeContactRegion("4d", { ...contact, view }, start, end, divisions),
      },
      `4d:${contact.edgeIndex ?? index}`,
      (view.y + 1.2) / 2.4,
      view.x,
      (contact.w + 1.25) / 2.5,
    );
  });
  const edges = hyper.edges.map((edge) => ({
    ...edge,
    a: vertices[edge.a],
    b: vertices[edge.b],
    depth: (vertices[edge.a].z + vertices[edge.b].z) * 0.5,
  }));
  return {
    dimension: "4d",
    phase,
    vertices,
    edges,
    contacts: voiced,
    reader: { type: "hyperplane", offset },
    bounds: projectedBounds(vertices),
    topologyEdgeCount: edges.length,
    geometry: hyper,
    offset,
  };
}

function divisionCount(value) {
  const numeric = Number(value);
  return Math.min(24, Math.max(1, Number.isFinite(numeric) ? Math.round(numeric) : 1));
}

function twoDimensionalDivisionMarkers(scene, count) {
  const path = scene.geometry;
  if (!path?.totalLength) return [];
  const markers = [];
  const addMarker = (distance) => {
    const contact = pointAtPath(path, distance / path.totalLength, { pingPong: false });
    markers.push({
      view: { x: contact.x, y: contact.y, z: 0 },
      tangent: contact.tangent ?? { x: 1, y: 0 },
      depth: 0,
      axis: "xy",
    });
  };

  if (path.shapeType === "circle" || path.vertexDistances.length < 2) {
    for (let division = 1; division < count; division += 1) {
      addMarker(path.totalLength * division / count);
    }
    return markers;
  }

  const edgeCount = twoDimensionalTopologyEdgeCount(path);
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const start = path.vertexDistances[edgeIndex];
    const end = edgeIndex + 1 < path.vertexDistances.length
      ? path.vertexDistances[edgeIndex + 1]
      : path.totalLength;
    for (let division = 1; division < count; division += 1) {
      addMarker(start + (end - start) * division / count);
    }
  }
  return markers;
}

export function buildShapesDivisionMarkers(scene, divisions = 1) {
  const count = divisionCount(divisions);
  if (count <= 1 || !scene) return [];
  if (scene.dimension === "2d") return twoDimensionalDivisionMarkers(scene, count);

  const markers = [];
  const edges = scene.edges ?? [];
  const markersPerEdge = count - 1;
  const edgeStride = Math.max(
    1,
    Math.ceil(edges.length * markersPerEdge / MAX_VISIBLE_DIVISION_MARKERS),
  );
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += edgeStride) {
    const edge = edges[edgeIndex];
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    for (let division = 1; division < count; division += 1) {
      const along = division / count;
      markers.push({
        view: {
          x: edge.a.x + dx * along,
          y: edge.a.y + dy * along,
          z: (edge.a.z ?? 0) + ((edge.b.z ?? 0) - (edge.a.z ?? 0)) * along,
        },
        tangent: { x: dx, y: dy },
        depth: edge.depth ?? 0,
        axis: edge.axis,
      });
    }
  }
  return markers;
}

export function buildShapesScene(state) {
  const phase = displayShapesPhase(state);
  if (state.selection.dimension === "3d") return buildThreeDimensionalScene(state, phase);
  if (state.selection.dimension === "4d") return buildFourDimensionalScene(state, phase);
  return buildTwoDimensionalScene(state, phase);
}

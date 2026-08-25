import {
  buildShape,
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
import { displayShapesPhase } from "./shapes-state.js";

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));

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

function buildTwoDimensionalScene(state, phase) {
  const local = state.dimension["2d"];
  const path = buildShape({
    sides: state.profile.sides,
    shapeType: state.profile.kind === "star" ? "star" : state.profile.kind,
    starDepth: state.profile.starDepth,
    curvature: local.curvature,
    aspect: local.aspect,
    skew: local.skew,
    rotationDeg: local.rotation,
  });
  const reader = local.reader;
  let contacts;
  let readerGeometry;
  if (reader === "line") {
    const x = path.bounds.minX + path.bounds.width * phase;
    contacts = verticalIntersections(path, x);
    readerGeometry = { type: "line", x };
  } else if (reader === "radar") {
    const angle = phase * Math.PI * 2 - Math.PI / 2;
    contacts = rayIntersections(path, angle);
    readerGeometry = { type: "radar", angle };
  } else {
    contacts = [pointAtPath(path, phase, { pingPong: false })];
    readerGeometry = { type: "points" };
  }

  const height = Math.max(path.bounds.height, 0.001);
  const width = Math.max(path.bounds.width, 0.001);
  const voiced = contacts.map((contact, index) => contactVoice(
    { ...contact, view: { x: contact.x, y: contact.y, z: 0 } },
    `2d:${reader}:${index}`,
    1 - (contact.y - path.bounds.minY) / height,
    ((contact.x - path.bounds.minX) / width) * 2 - 1,
    contact.cornerStrength ?? contact.segmentT ?? 0.5,
  ));
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
    reader: readerGeometry,
    bounds: projectedBounds(path.points),
    closed: path.closed,
    vertexIndices: path.vertexIndices,
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
  const voiced = contacts.map((contact, index) => {
    const view = projectPoint3(contact);
    return contactVoice(
      { ...contact, view },
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
  const voiced = contacts.map((contact, index) => {
    const view = hyperViewPoint(contact);
    return contactVoice(
      { ...contact, view },
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
    geometry: hyper,
    offset,
  };
}

export function buildShapesScene(state) {
  const phase = displayShapesPhase(state);
  if (state.selection.dimension === "3d") return buildThreeDimensionalScene(state, phase);
  if (state.selection.dimension === "4d") return buildFourDimensionalScene(state, phase);
  return buildTwoDimensionalScene(state, phase);
}

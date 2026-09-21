import { SHAPE_PHYSICS_SCENES } from "./physics-scenes-shape.js";
import { ADVANCED_PHYSICS_SCENES } from "./physics-scenes-advanced.js";

function normalizeEntry(entry) {
  if (typeof entry === "function") {
    const sample = entry();
    return Object.freeze({
      id: sample.id,
      title: sample.title,
      create: entry,
    });
  }
  if (entry && typeof entry.create === "function") {
    return Object.freeze({ id: entry.id, title: entry.title, create: entry.create });
  }
  throw new TypeError("Physics scene registry entries must be factories or {id, title, create} records.");
}

export const PHYSICS_SCENES = Object.freeze([
  ...SHAPE_PHYSICS_SCENES,
  ...ADVANCED_PHYSICS_SCENES,
].map(normalizeEntry));

export const PHYSICS_SCENE_INDEX = new Map(
  PHYSICS_SCENES.map((descriptor) => [descriptor.id, descriptor]),
);

export function createPhysicsScene(id) {
  const descriptor = PHYSICS_SCENE_INDEX.get(id);
  if (!descriptor) throw new RangeError(`Unknown physics scene: ${id}`);
  const scene = descriptor.create();
  for (const method of [
    "reset",
    "setParam",
    "step",
    "draw",
    "voices",
    "consumeEvents",
    "metrics",
  ]) {
    if (typeof scene?.[method] !== "function") {
      throw new TypeError(`${id} scene is missing ${method}().`);
    }
  }
  return scene;
}

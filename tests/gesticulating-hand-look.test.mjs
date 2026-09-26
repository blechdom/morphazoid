import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three/three.module.min.js";
import { createHandLook } from "../src/instruments/gesticulating-hand/hand-look.js";

function fixture(t) {
  const geometry = new THREE.BufferGeometry(), materials = [], textures = [], disposals = [];
  const ambient = new THREE.HemisphereLight(0xe0e6fc, 0x2b2337, 1.83);
  const keyLight = new THREE.DirectionalLight(0xf3d9bc, 3.21);
  const fill = new THREE.DirectionalLight(0xb7d0ef, 1.72);
  const rim = new THREE.DirectionalLight(0xfae9ff, 1.43);
  const lights = [ambient, keyLight, fill, rim];
  lights.forEach((light, i) => light.position.set(i - 2.5, i + .75, 5 - i * 2));
  const look = createHandLook({ meshes: [], ambient, keyLight, fill, rim });
  function material(name, color, roughness) {
    const maps = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
    textures.push(...maps);
    const result = new THREE.MeshStandardMaterial({ color, roughness, metalness: .03,
      map: maps[0], normalMap: maps[1], roughnessMap: maps[2] });
    result.name = name; materials.push(result);
    for (const resource of [result, ...maps]) resource.addEventListener("dispose", () => disposals.push(resource));
    return result;
  }
  geometry.addEventListener("dispose", () => disposals.push(geometry));
  t.after(() => {
    look.dispose();
    for (const resource of [geometry, ...materials, ...textures]) resource.dispose();
  });
  return { look, lights, material, mesh: material => new THREE.Mesh(geometry, material), disposals };
}
const lightState = lights => lights.map(light => ({
  color: light.color.toArray(), groundColor: light.groundColor?.toArray(),
  intensity: light.intensity, position: light.position.toArray(),
}));
const remember = materials => materials.map(material => ({
  material, color: material.color.clone(), roughness: material.roughness, metalness: material.metalness,
  map: material.map, normalMap: material.normalMap, roughnessMap: material.roughnessMap,
}));
function assertSurfaceDetails(originals) {
  for (const original of originals) for (const key of ["map", "normalMap", "roughnessMap", "roughness", "metalness"]) {
    assert.equal(original.material[key], original[key], `${original.material.name}: ${key} stays intact`);
  }
}
function assertColors(originals, tint) {
  for (const { material, color } of originals) {
    const expected = tint === undefined ? color : new THREE.Color(tint).multiply(color);
    assert.deepEqual(material.color.toArray(), expected.toArray(), `${material.name}: original color with selected tint`);
  }
}

test("late model registration applies the current appearance and retains each original surface", t => {
  const { look, lights, material, mesh } = fixture(t);
  const hand = material("hand skin", 0xd7ad91, .67), handMesh = mesh(hand);
  const handOriginal = remember([hand]), studio = lightState(lights);
  look.addMeshes([handMesh]);
  assert.equal(look.apply({ skin: "jade", lighting: "cool" }), true);
  assertColors(handOriginal, 0x83ecd3);
  const cool = lightState(lights); assert.notDeepEqual(cool, studio);

  // The second model finishes loading after the performer has changed appearance.
  const foot = material("foot skin", 0x986b53, .89), nails = material("foot nails", 0xf0cebc, .36);
  const originals = [...handOriginal, ...remember([foot, nails])];
  const footMeshes = [mesh([foot, nails, hand]), mesh(foot)];
  look.addMeshes(footMeshes);
  assertColors(originals, 0x83ecd3); assertSurfaceDetails(originals);
  assert.deepEqual(lightState(lights), cool, "loading another model preserves the active light rig");

  // Cached model switches and shared materials must not capture an already tinted base.
  for (let i = 0; i < 3; i++) look.addMeshes([handMesh, ...footMeshes]);
  assertColors(originals, 0x83ecd3);
  assert.equal(look.apply({ skin: "copper", lighting: "noir" }), true);
  assertColors(originals, 0xffba88); assertSurfaceDetails(originals);
  assert.equal(look.apply({ skin: "natural", lighting: "studio" }), true);
  assertColors(originals); assertSurfaceDetails(originals);
  assert.deepEqual(lightState(lights), studio, "Studio restores original colors, strengths and positions");
  assert.equal(look.apply({ skin: "natural", lighting: "studio" }), false);
});

test("disposal restores dynamically registered models and lights without disposing viewer resources", t => {
  const { look, lights, material, mesh, disposals } = fixture(t);
  const hand = material("hand skin", 0xd0a28b, .72), foot = material("foot skin", 0x9b755c, .84);
  const originals = remember([hand, foot]), studio = lightState(lights);
  look.apply({ skin: "violet", lighting: "warm" });
  look.addMeshes([mesh(hand)]); look.addMeshes([mesh([foot, hand])]);
  assertColors(originals, 0xb8adff); assert.notDeepEqual(lightState(lights), studio);
  look.dispose();
  assertColors(originals); assertSurfaceDetails(originals);
  assert.deepEqual(lightState(lights), studio);
  assert.deepEqual(disposals, [], "the viewer retains ownership of textures, materials and geometry");

  const late = material("load completed after teardown", 0xb39076, .91), lateOriginal = remember([late]);
  look.addMeshes([mesh(late), mesh(hand)]);
  assert.equal(look.apply({ skin: "cyan", lighting: "neon" }), false);
  look.dispose();
  assertColors([...originals, ...lateOriginal]); assertSurfaceDetails([...originals, ...lateOriginal]);
  assert.deepEqual(lightState(lights), studio); assert.deepEqual(disposals, []);
});

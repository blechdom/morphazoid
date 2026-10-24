import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as THREE from "../vendor/three/three.module.min.js";
import { partitionArtistCassette } from "../src/instruments/tapezoid/artist-cassette.js";

test("the unchanged downloaded GLB has two separable, three-piece textured reels", async () => {
  const bytes = await readFile(new URL("../assets/tapezoid/cassette-tape.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const dataStart = 28 + jsonLength;
  const primitive = json.meshes[0].primitives[0];
  const positions = json.accessors[primitive.attributes.POSITION];
  const indices = json.accessors[primitive.indices];
  assert.equal(positions.componentType, 5126);
  assert.equal(indices.componentType, 5125);
  const positionStart = dataStart + (json.bufferViews[positions.bufferView].byteOffset ?? 0) + (positions.byteOffset ?? 0);
  const indexStart = dataStart + (json.bufferViews[indices.bufferView].byteOffset ?? 0) + (indices.byteOffset ?? 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(
    Array.from({ length: positions.count * 3 }, (_, offset) => bytes.readFloatLE(positionStart + offset * 4)), 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute(
    Array.from({ length: indices.count }, (_, offset) => bytes.readUInt32LE(indexStart + offset * 4)), 1));

  const pieces = partitionArtistCassette(geometry);
  assert.ok(pieces);
  assert.equal(positions.count, 3837);
  assert.deepEqual(pieces.reels.map(reel => reel.indices.length / 3), [418, 418]);
  assert.ok(pieces.reels[0].pivot.x < 0 && pieces.reels[1].pivot.x > 0);
  assert.ok(Math.abs(pieces.reels[0].pivot.y - .057) < .001);
  assert.ok(Math.abs(pieces.reels[1].pivot.y - .057) < .001);
  assert.equal(pieces.body.length / 3, 4924);
  assert.equal(pieces.body.length + pieces.reels.reduce((sum, reel) => sum + reel.indices.length, 0),
    indices.count);
  const triangles = list => Array.from({ length: list.length / 3 }, (_, offset) =>
    list.slice(offset * 3, offset * 3 + 3).join(",")).sort();
  const originals = Array.from({ length: indices.count }, (_, offset) => geometry.index.getX(offset));
  assert.deepEqual(triangles([...pieces.body, ...pieces.reels.flatMap(reel => reel.indices)]),
    triangles(originals)); // No shell triangles are lost or duplicated.
  geometry.dispose();
});

test("an unrelated local mesh is not mistaken for the bundled cassette", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2]);
  assert.equal(partitionArtistCassette(geometry), null);
  geometry.dispose();
});

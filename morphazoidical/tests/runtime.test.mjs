import assert from "node:assert/strict";
import test from "node:test";

import { buildShape } from "../../src/geometry.js";
import {
  DEFAULT_STATE,
  contactsForReader,
  readerGeometry,
  unionVoiceTrajectories,
} from "../app.js";
import { getFeatureDescriptor } from "../feature-registry.js";

test("every default audio route names a registered feature", () => {
  for (const key of ["pitchSource", "gainSource", "panSource", "timbreSource"]) {
    assert.ok(getFeatureDescriptor(DEFAULT_STATE[key]), `${key} must resolve through the registry`);
  }
});

test("reader geometry is deterministic in every supported mode", () => {
  const path = buildShape({ sides: 5, curvature: 0.2, samplesPerEdge: 24 });
  const vertical = readerGeometry(path, "vertical", 0.25);
  assert.equal(vertical.type, "vertical");
  assert.equal(vertical.x, path.bounds.minX + path.bounds.width * 0.25);

  const horizontal = readerGeometry(path, "horizontal", 0.75);
  assert.equal(horizontal.type, "horizontal");
  assert.equal(horizontal.y, path.bounds.minY + path.bounds.height * 0.75);

  const ray = readerGeometry(path, "ray", 0.5);
  assert.equal(ray.type, "ray");
  assert.equal(ray.angle, Math.PI / 2);

  const trace = readerGeometry(path, "path", 1.25);
  assert.equal(trace.type, "path");
  assert.equal(trace.phase, 0.25);
});

test("all readers return the same sampled contacts consumed by analysis and sound", () => {
  const path = buildShape({ sides: 1, samplesPerEdge: 96 });
  assert.equal(contactsForReader(path, readerGeometry(path, "vertical", 0.5)).length, 2);
  assert.equal(contactsForReader(path, readerGeometry(path, "horizontal", 0.5)).length, 2);
  assert.equal(contactsForReader(path, readerGeometry(path, "ray", 0.25)).length, 1);
  assert.equal(contactsForReader(path, readerGeometry(path, "path", 0.25)).length, 1);
});

test("voice trajectories retain births and deaths through lookahead", () => {
  const current = [
    { key: "a", frequency: 110, gain: 0.3 },
    { key: "ending", frequency: 220, gain: 0.2 },
  ];
  const future = [
    { key: "a", frequency: 130, gain: 0.4 },
    { key: "born", frequency: 330, gain: 0.25 },
  ];
  const trajectory = unionVoiceTrajectories(current, future);
  assert.deepEqual(trajectory.current.map(({ key }) => key), ["a", "ending", "born"]);
  assert.deepEqual(trajectory.future.map(({ key }) => key), ["a", "ending", "born"]);
  assert.equal(trajectory.current.find(({ key }) => key === "born").gain, 0);
  assert.equal(trajectory.future.find(({ key }) => key === "ending").gain, 0);
});

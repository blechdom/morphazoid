import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NONORIENTABLE_SURFACES,
  SURFACE_LIMITS,
  buildSurfaceMesh,
  canonicalSurfaceCoordinates,
  mapSliceComponents,
  planeOffsetForMeshPhase,
  sliceSurface,
  surfacePoint,
  trackSliceComponents,
} from "../src/nonorientable-surface.js";

const root = new URL("../", import.meta.url);

function assertFinitePoint(point, label) {
  for (const axis of ["x", "y", "z"]) {
    assert.equal(Number.isFinite(point[axis]), true, `${label}.${axis} must be finite`);
  }
}

function assertPointClose(actual, expected, message) {
  for (const axis of ["x", "y", "z"]) {
    assert.ok(
      Math.abs(actual[axis] - expected[axis]) < 1e-8,
      `${message}: ${axis} differs`,
    );
  }
}

test("nonorientable surface meshes stay finite and inside their hard limits", () => {
  for (const kind of NONORIENTABLE_SURFACES) {
    const mesh = buildSurfaceMesh(kind, {
      uSegments: Number.POSITIVE_INFINITY,
      vSegments: 10_000,
      radius: Number.NaN,
      width: -999,
      fold: 999,
      halfTwists: 6,
    });
    assert.equal(mesh.kind, kind);
    assert.equal(mesh.uSegments, SURFACE_LIMITS.minimumUSegments);
    assert.equal(mesh.vSegments, SURFACE_LIMITS.maximumVSegments);
    assert.equal(mesh.triangles.length, mesh.uSegments * mesh.vSegments * 2);
    assert.ok(mesh.triangles.length <= SURFACE_LIMITS.maximumTriangles);
    assert.equal(
      mesh.vertices.length,
      mesh.uSegments * (kind === "klein" ? mesh.vSegments : mesh.vSegments + 1),
    );
    mesh.vertices.forEach((point, index) => assertFinitePoint(point, `${kind}[${index}]`));
    for (const triangle of mesh.triangles) {
      for (const index of [triangle.a, triangle.b, triangle.c]) {
        assert.ok(index >= 0 && index < mesh.vertices.length);
      }
    }
    for (const value of Object.values(mesh.bounds)) assert.equal(Number.isFinite(value), true);
  }
});

test("one lap reverses the transverse chart and two laps return it", () => {
  for (const kind of NONORIENTABLE_SURFACES) {
    const transverse = 0.37;
    const atStart = surfacePoint(kind, 0, transverse);
    const afterOneLap = surfacePoint(kind, 1, transverse);
    const mirroredStart = surfacePoint(kind, 0, -transverse);
    const afterTwoLaps = surfacePoint(kind, 2, transverse);
    assertPointClose(afterOneLap, mirroredStart, `${kind} one-lap identification`);
    assertPointClose(afterTwoLaps, atStart, `${kind} two-lap closure`);

    const chart = canonicalSurfaceCoordinates(kind, -1, transverse);
    assert.equal(chart.orientation, -1);
    assert.ok(Math.abs(chart.chartV + transverse) < 1e-12);
  }

  const tripleStart = surfacePoint("moebius", 0, 0.41, { halfTwists: 3 });
  const tripleOneLap = surfacePoint("moebius", 1, 0.41, { halfTwists: 3 });
  const tripleMirror = surfacePoint("moebius", 0, -0.41, { halfTwists: 3 });
  assertPointClose(tripleOneLap, tripleMirror, "triple-twist seam");
  assertFinitePoint(tripleStart, "triple-twist start");
  assertPointClose(surfacePoint("klein", 0.37, -1), surfacePoint("klein", 0.37, 1), "Klein transverse closure");

});

test("longitudinal seam triangles sew to reflected transverse indices", () => {
  for (const kind of NONORIENTABLE_SURFACES) {
    const mesh = buildSurfaceMesh(kind, { uSegments: 16, vSegments: 8 });
    const seamTriangles = mesh.triangles.filter(({ seam }) => seam);
    assert.equal(seamTriangles.length, mesh.vSegments * 2);
    const reflected = (index) => kind === "klein"
      ? (mesh.vSegments - index) % mesh.vSegments
      : mesh.vSegments - index;
    const at = (u, v) => u * mesh.vCount + v;

    for (let v = 0; v < mesh.vSegments; v += 1) {
      const nextV = kind === "klein" ? (v + 1) % mesh.vSegments : v + 1;
      const [first, second] = seamTriangles.slice(v * 2, v * 2 + 2);
      assert.deepEqual(first, {
        a: at(mesh.uSegments - 1, v),
        b: at(0, reflected(v)),
        c: at(0, reflected(nextV)),
        seam: true,
      });
      assert.deepEqual(second, {
        a: at(mesh.uSegments - 1, v),
        b: at(0, reflected(nextV)),
        c: at(mesh.uSegments - 1, nextV),
        seam: true,
      });
    }
  }
});

test("plane slices are finite, bounded, and connected by mesh topology keys", () => {
  const normals = [
    { x: 1, y: 0.25, z: -0.35 },
    { x: -0.2, y: 1, z: 0.4 },
    { x: 0.3, y: -0.45, z: 1 },
  ];
  for (const kind of NONORIENTABLE_SURFACES) {
    const mesh = buildSurfaceMesh(kind);
    let soundingSlices = 0;
    for (const normal of normals) {
      for (const phase of [0.1, 0.35, 0.6, 0.85]) {
        const offset = planeOffsetForMeshPhase(mesh, normal, phase);
        const slice = sliceSurface(mesh, normal, offset);
        assert.equal(Number.isFinite(offset), true);
        assert.ok(slice.segments.length <= SURFACE_LIMITS.maximumSliceSegments);
        assert.equal(slice.truncated, false);
        if (slice.segments.length) soundingSlices += 1;
        for (const segment of slice.segments) {
          assertFinitePoint(segment.a, `${kind} segment a`);
          assertFinitePoint(segment.b, `${kind} segment b`);
          assert.ok(segment.aKey.startsWith("e:") || segment.aKey.startsWith("v:"));
          assert.ok(segment.bKey.startsWith("e:") || segment.bKey.startsWith("v:"));
          assert.ok(segment.length > 0);
        }
        for (const component of slice.components) {
          assert.ok(component.segmentIndices.length > 0);
          assert.ok(component.length > 0);
          assertFinitePoint(component.centroid, `${kind} component`);
        }
      }
    }
    assert.ok(soundingSlices >= 8, `${kind} should intersect at most tested positions`);
  }
});

test("slice-to-sound mapping caps voices and exposes finite causal controls", () => {
  for (const kind of NONORIENTABLE_SURFACES) {
    const mesh = buildSurfaceMesh(kind);
    const normal = { x: 0.7, y: 0.55, z: -0.2 };
    const slice = sliceSurface(
      mesh,
      normal,
      planeOffsetForMeshPhase(mesh, normal, 0.48),
    );
    const voices = mapSliceComponents(mesh, slice, {
      pitchRange: 99,
      timbre: Number.NaN,
      stereoWidth: 99,
      seamVoice: 99,
      maximumComponents: 99,
    });
    assert.ok(voices.length <= SURFACE_LIMITS.maximumVoiceComponents);
    for (const voice of voices) {
      for (const key of [
        "pitch01",
        "pitchOctaves",
        "pan",
        "gain",
        "drive",
        "haloSemitones",
        "haloGain",
        "seamAmount",
        "transverseAmount",
        "length",
      ]) {
        assert.equal(Number.isFinite(voice[key]), true, `${kind} ${key} must be finite`);
      }
      assert.ok(voice.pan >= -1 && voice.pan <= 1);
      assert.ok(voice.gain >= 0 && voice.gain <= 1);
      assert.ok(voice.drive >= 0 && voice.drive <= 1);
    }
  }
});


test("axis-aligned Klein slices deduplicate coplanar mesh edges", () => {
  const mesh = buildSurfaceMesh("klein");
  const normal = { x: 0, y: 0, z: 1 };
  const slice = sliceSurface(
    mesh,
    normal,
    planeOffsetForMeshPhase(mesh, normal, 0.5),
  );
  assert.equal(slice.segments.length, 40);
  assert.equal(slice.components.length, 2);
  assert.deepEqual(
    slice.components.map(({ segmentIndices }) => segmentIndices.length),
    [20, 20],
  );
  assert.equal(slice.components.every(({ closed }) => closed), true);
});

test("malformed plane normals degrade to a finite empty slice", () => {
  const mesh = buildSurfaceMesh("klein");
  const normal = { x: Number.POSITIVE_INFINITY, y: Number.NaN, z: Number.NEGATIVE_INFINITY };
  const offset = planeOffsetForMeshPhase(mesh, normal, 0.4);
  const slice = sliceSurface(mesh, normal, offset);
  assert.equal(offset, 0);
  assert.deepEqual(slice.normal, { x: 0, y: 0, z: 0 });
  assert.equal(slice.segments.length, 0);
  assert.equal(slice.components.length, 0);
  assert.equal(slice.truncated, false);
});

test("plane phase and slicing are invariant to normal-vector scale", () => {
  for (const kind of NONORIENTABLE_SURFACES) {
    const mesh = buildSurfaceMesh(kind);
    const normal = { x: 0.71, y: -0.22, z: 0.43 };
    const scaled = Object.fromEntries(
      Object.entries(normal).map(([axis, value]) => [axis, value * 7]),
    );
    for (const phase of [0, 0.13, 0.5, 0.79, 1]) {
      const first = sliceSurface(
        mesh,
        normal,
        planeOffsetForMeshPhase(mesh, normal, phase),
      );
      const second = sliceSurface(
        mesh,
        scaled,
        planeOffsetForMeshPhase(mesh, scaled, phase),
      );
      const keys = (slice) => slice.segments.map((segment) => (
        [segment.aKey, segment.bKey].sort().join("|")
      )).sort();
      assert.deepEqual(keys(second), keys(first), `${kind} phase ${phase}`);
      assert.equal(second.components.length, first.components.length);
    }
  }
});


test("playhead phase one wraps exactly to phase zero", () => {
  for (const kind of NONORIENTABLE_SURFACES) {
    const mesh = buildSurfaceMesh(kind);
    const normal = { x: 0.4, y: 0.2, z: -0.7 };
    const offsetAtZero = planeOffsetForMeshPhase(mesh, normal, 0);
    const offsetAtOne = planeOffsetForMeshPhase(mesh, normal, 1);
    const keys = (slice) => slice.segments.map((segment) => (
      [segment.aKey, segment.bKey].sort().join("|")
    )).sort();
    assert.equal(offsetAtOne, offsetAtZero);
    assert.deepEqual(
      keys(sliceSurface(mesh, normal, offsetAtOne)),
      keys(sliceSurface(mesh, normal, offsetAtZero)),
    );
  }
});
test("component tracking preserves branch identity when display order crosses", () => {
  const mesh = buildSurfaceMesh("moebius");
  const yaw = 38 * Math.PI / 180;
  const pitch = -18 * Math.PI / 180;
  const normal = {
    x: Math.cos(pitch) * Math.cos(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.sin(yaw),
  };
  const mappedAt = (phase) => {
    const slice = sliceSurface(
      mesh,
      normal,
      planeOffsetForMeshPhase(mesh, normal, phase),
    );
    return mapSliceComponents(mesh, slice);
  };
  const before = mappedAt(0.1065);
  const after = mappedAt(0.1075);
  assert.equal(before.length, 2);
  assert.equal(after.length, 2);

  const first = trackSliceComponents(mesh, [], before, 0);
  const second = trackSliceComponents(mesh, first.tracks, after, first.nextId);
  for (const component of first.components) {
    const nearest = second.components
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(
          candidate.centroid.x - component.centroid.x,
          candidate.centroid.y - component.centroid.y,
          candidate.centroid.z - component.centroid.z,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    assert.ok(nearest.distance < 0.02);
    assert.equal(nearest.candidate.componentId, component.componentId);
  }
  assert.deepEqual(
    new Set(second.components.map(({ componentId }) => componentId)).size,
    second.components.length,
  );
});
test("Möbius and Klein pages expose the shared playable and lifecycle contracts", async () => {
  const [moebius, klein, app, css] = await Promise.all([
    readFile(new URL("moebius.html", root), "utf8"),
    readFile(new URL("klein-bottle.html", root), "utf8"),
    readFile(new URL("nonorientable-app.js", root), "utf8"),
    readFile(new URL("nonorientable.css", root), "utf8"),
  ]);

  for (const [kind, html] of [["moebius", moebius], ["klein", klein]]) {
    assert.match(html, new RegExp(`data-surface-kind="${kind}"`));
    assert.match(html, /id="audioButton"[^>]+aria-pressed="false"/);
    assert.match(html, /id="playButton"[^>]+data-primary-transport[^>]+aria-pressed="false"/);
    assert.match(html, /<canvas[\s\S]+?tabindex="0"[\s\S]+?role="application"/);
    assert.match(html, /aria-describedby="surfaceInstructions liveStatus"/);
    assert.match(html, /id="selectForm"[^>]+aria-pressed="false"/);
    assert.match(html, /id="selectPlayhead"[^>]+aria-pressed="true"/);
    assert.match(html, /id="resetAll"[^>]+data-reset-in-place/);
    assert.doesNotMatch(html, /\bautoplay\b/i);
    const mobileNavigation = html.match(
      /<select class="mobile-instrument-select"[\s\S]*?<\/select>/,
    )?.[0] ?? "";
    let previousOption = -1;
    for (const href of [
      "shape.html", "lattice.html", "spiral.html", "solid.html", "moebius.html",
      "klein-bottle.html", "hyper.html", "l-system.html", "recursion.html",
      "julia.html", "lumber.html", "l-mic.html", "graph-delay.html",
      "throatazoid.html", "morphazoidical/",
    ]) {
      const option = mobileNavigation.indexOf(`value="${href}"`);
      assert.ok(option > previousOption, `${href} must stay inside the ordered mobile fallback`);
      previousOption = option;
    }
    for (const id of [
      "position",
      "speed",
      "planeYaw",
      "planePitch",
      "rotationX",
      "rotationY",
      "soundMode",
      "baseFrequency",
      "pitchRange",
      "timbre",
      "stereoWidth",
      "seamVoice",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
  }

  assert.match(klein, /3D immersion:/);
  assert.match(klein, /self-crossing is not a junction/);
  assert.match(moebius, /longitudinal seam joins each transverse coordinate to its opposite/);
  assert.match(app, /new VoicePool\(12, \{ continuousPeakCeiling: 0\.72 \}\)/);
  assert.match(app, /pool\.setVoiceTrajectory\(voices, futureVoices, 0\.075\)/);
  assert.match(app, /canvas\.addEventListener\("pointercancel", cancelDrag\)/);
  assert.match(app, /canvas\.addEventListener\("lostpointercapture", cancelDrag\)/);
  assert.match(app, /trackSliceComponents/);
  assert.match(app, /audioRequestGeneration/);
  assert.match(app, /document\.hidden/);
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /window\.addEventListener\("pageshow"/);
  assert.match(app, /void pool\.close\(\)/);
  assert.doesNotMatch(app, /wakeManualSound\(180\)/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
});

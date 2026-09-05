import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_MAZE_SETTINGS,
  MAZE_ALGORITHMS,
  MAZE_TOPOLOGIES,
  createMazeWalk,
  createWallWalk,
  generateMaze,
  sanitizeMazeSettings,
  shortestMazePath,
} from "../src/algorithmic-mazes.js";

const root = new URL("../", import.meta.url);

function reachable(adjacency, start = 0) {
  const seen = new Set([start]);
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of adjacency[queue[cursor]]) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return seen;
}

test("maze settings clamp to supported vector fields", () => {
  assert.deepEqual(sanitizeMazeSettings({
    algorithm: "unknown",
    topology: "unknown",
    size: 200,
    seed: 0,
    braid: 9,
  }), {
    algorithm: DEFAULT_MAZE_SETTINGS.algorithm,
    topology: DEFAULT_MAZE_SETTINGS.topology,
    size: 28,
    seed: DEFAULT_MAZE_SETTINGS.seed,
    braid: 0.82,
  });
});

test("each field is polygonal and yields coupled wall and passage graphs", () => {
  for (const topology of MAZE_TOPOLOGIES) {
    const maze = generateMaze({ topology: topology.id, size: 12, seed: 47, braid: 0 });
    assert.ok(maze.cells.length > 30, topology.id);
    assert.ok(maze.cells.every(({ polygon }) => polygon.length >= 4), topology.id);
    assert.equal(reachable(maze.adjacency).size, maze.cells.length, topology.id);
    assert.equal(maze.allWalls.length - maze.walls.length, maze.passages.length, topology.id);
    assert.equal(maze.wallGraph.edges.length, maze.walls.length, topology.id);
    assert.ok(maze.wallGraph.vertices.length > 0, topology.id);
    assert.ok(maze.wallGraph.tour.length > 1, topology.id);
  }
});

test("all algorithms carve a connected spanning tree before loop openings", () => {
  for (const algorithm of MAZE_ALGORITHMS) {
    const maze = generateMaze({
      algorithm: algorithm.id,
      topology: "hexagonal",
      size: 14,
      seed: 341,
      braid: 0,
    });
    assert.equal(maze.passages.length, maze.cells.length - 1, algorithm.id);
    assert.equal(maze.metrics.cycleRank, 0, algorithm.id);
    assert.equal(reachable(maze.adjacency).size, maze.cells.length, algorithm.id);
    assert.equal(maze.solution[0], maze.start, algorithm.id);
    assert.equal(maze.solution.at(-1), maze.goal, algorithm.id);
    assert.equal(maze.buildSteps.length, maze.passages.length, algorithm.id);
  }
});

test("carving algorithms retain their distinct construction process", () => {
  const mazes = Object.fromEntries(MAZE_ALGORITHMS.map(({ id }) => [
    id,
    generateMaze({ algorithm: id, topology: "orthogonal", size: 12, seed: 341, braid: 0 }),
  ]));

  assert.ok(mazes.backtracker.buildSteps.every(({ process }) => process === "depth"));
  assert.ok(mazes.backtracker.buildSteps.some(({ stackDepth }) => stackDepth > 3));
  assert.ok(mazes.prim.buildSteps.every(({ process }) => process === "frontier"));
  assert.ok(mazes.prim.buildSteps.every(({ frontierSize }) => frontierSize >= 0));
  assert.ok(mazes.kruskal.buildSteps.every(({ process }) => process === "merge"));
  assert.equal(mazes.kruskal.buildSteps.at(-1).mergeSize, mazes.kruskal.cells.length);
  assert.ok(mazes.wilson.buildSteps.every(({ process }) => process === "loop-erased-walk"));
  assert.ok(mazes.wilson.buildSteps.every(({ walkLength, walkIndex }) => walkIndex < walkLength));
});

test("braiding removes more outlines while adding measured passage cycles", () => {
  const tree = generateMaze({ topology: "orthogonal", size: 17, seed: 817, braid: 0 });
  const braided = generateMaze({ topology: "orthogonal", size: 17, seed: 817, braid: 0.72 });
  assert.equal(reachable(braided.adjacency).size, braided.cells.length);
  assert.ok(braided.passages.length > tree.passages.length);
  assert.ok(braided.walls.length < tree.walls.length);
  assert.ok(braided.metrics.cycleRank > 0);
  assert.ok(braided.metrics.deadEndCount <= tree.metrics.deadEndCount);
});

test("seeded passage and wall walks are deterministic and remain on their graphs", () => {
  const maze = generateMaze({ topology: "radial", size: 16, seed: 99, braid: 0.24 });
  const passage = createMazeWalk(maze, { seed: 123, start: 0, length: 120 });
  const passageAgain = createMazeWalk(maze, { seed: 123, start: 0, length: 120 });
  const wall = createWallWalk(maze, { seed: 456, length: 120 });
  const wallAgain = createWallWalk(maze, { seed: 456, length: 120 });
  assert.deepEqual(passage, passageAgain);
  assert.deepEqual(wall, wallAgain);
  for (let index = 0; index < passage.length - 1; index += 1) {
    assert.ok(maze.adjacency[passage[index]].includes(passage[index + 1]));
  }
  for (let index = 0; index < wall.length - 1; index += 1) {
    assert.ok(maze.wallGraph.adjacency[wall[index]].includes(wall[index + 1]));
  }
});

test("wall walks honor a requested disconnected outline component", () => {
  const maze = {
    settings: { seed: 17 },
    wallGraph: {
      adjacency: [[1], [0], [3], [2]],
      components: [[0, 1], [2, 3]],
    },
  };
  const route = createWallWalk(maze, { seed: 33, start: 2, length: 12 });
  assert.equal(route[0], 2);
  assert.equal(route.length, 12);
  assert.ok(route.every((node) => node === 2 || node === 3));
});

test("solver targets can move without changing the generated maze", () => {
  const maze = generateMaze({ topology: "orthogonal", size: 11, seed: 18, braid: 0.3 });
  const route = shortestMazePath(maze, 3, maze.cells.length - 4);
  assert.equal(route[0], 3);
  assert.equal(route.at(-1), maze.cells.length - 4);
  route.slice(1).forEach((node, index) => {
    assert.ok(maze.adjacency[route[index]].includes(node));
  });
});

test("page exposes both audible graph layers and vector export", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("algorithmic-mazes.html", root), "utf8"),
    readFile(new URL("algorithmic-mazes.css", root), "utf8"),
    readFile(new URL("algorithmic-mazes-app.js", root), "utf8"),
  ]);
  assert.match(html, /Passage centers/);
  assert.match(html, /Wall outlines/);
  assert.match(html, /id="audioButton"/);
  assert.match(html, /id="exportSvgButton"/);
  assert.match(html, /data-maze-mode="carve" aria-pressed="true">Build/);
  assert.doesNotMatch(html, /data-maze-mode="solve"/);
  assert.match(html, /id="solveButton"[^>]+aria-pressed="false">Solve/);
  assert.match(html, /class="maze-polyphony"/);
  assert.match(html, /id="passageHeads"[^>]+value="1"/);
  assert.match(html, /id="wallHeads"[^>]+value="1"/);
  assert.match(html, /data-maze-topology="orthogonal" aria-pressed="true"/);
  assert.doesNotMatch(html, /id="(?:bend|twist|fieldMotion)"|>Shape</);
  assert.match(html, /data-instrument-info="off"/);
  assert.match(html, /data-midi-output-monitor="collapsed"/);
  assert.doesNotMatch(html, /id="(?:transport|field|vector|heads|sound|ledger)Summary"/);
  assert.ok(html.indexOf('id="resetAllButton"') < html.indexOf('id="fieldTitle"'));
  assert.ok(html.indexOf('id="ledgerTitle"') > html.indexOf('id="soundTitle"'));
  assert.match(app, /new VoicePool/);
  assert.match(app, /createMazeWalk/);
  assert.match(app, /createWallWalk/);
  assert.match(app, /mode: "carve"/);
  assert.match(app, /topology: "orthogonal"/);
  assert.match(app, /cycleBehavior: "hold"/);
  assert.doesNotMatch(app, /warpPoint|state\.(?:bend|twist|fieldMotion)/);
  assert.match(css, /\.maze-stage-wrap\s*\{[\s\S]*?aspect-ratio: 1;/);
  assert.match(app, /const CARVE_PROFILES/);
  assert.match(app, /data-layer="wall-outlines"/);
  assert.match(app, /data-layer="passage-centers"/);
  assert.match(app, /data-layer="solution-route"/);
  assert.match(app, /context\.lineTo\(screen\.b\.x, screen\.b\.y\)/);
  assert.doesNotMatch(app, /quadraticCurveTo| Q /);
  assert.match(app, /partialCurve\(curve, 1 - build\.amount\)/);
});

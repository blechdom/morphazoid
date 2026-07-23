import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const instrumentScripts = [
  "app.js",
  "lattice-app.js",
  "spiral-app.js",
  "solid-app.js",
  "hyper-app.js",
  "l-system-app.js",
  "recursion-app.js",
  "julia-app.js",
  "lumber-app.js",
  "fractaphone-app.js",
  "morphazoidical/app.js",
];

test("top-menu Audio status is always the binary on/off state", async () => {
  for (const file of instrumentScripts) {
    const source = await readFile(new URL(file, root), "utf8").catch((error) => {
      if (file === "recursion-app.js" && error?.code === "ENOENT") return null;
      throw error;
    });
    if (source === null) continue;
    const statusLines = source
      .split("\n")
      .filter((line) => line.includes("audioState"));

    assert.ok(statusLines.length, `${file} must update the top Audio status`);
    assert.doesNotMatch(
      statusLines.join("\n"),
      /["'](?:listening|input paused|starting(?:…|\.\.\.)?|unavailable|sine fallback|live|stopping…|allow mic…)["']/i,
      `${file} must keep detailed lifecycle text out of the top Audio button`,
    );
    assert.match(
      source,
      /audioState[^;\n]*(?:"on"|"off")|(?:textContent|setText)[^;\n]*audioState/,
      `${file} must expose a binary on/off Audio status`,
    );
  }
});

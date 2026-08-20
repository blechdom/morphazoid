import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";

const root = new URL("../", import.meta.url);

test("Hyper-Syrinx exposes a complete multiply-in-place vocal flow", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("hyper-syrinx.html", root), "utf8"),
    readFile(new URL("hyper-syrinx.css", root), "utf8"),
    readFile(new URL("hyper-syrinx-app.js", root), "utf8"),
  ]);

  assert.match(html, /<body[^>]*class="[^"]*hyper-syrinx-page[^"]*"/);
  assert.match(html, /<main[^>]*id="hyperSyrinx"/);
  assert.match(html, /ELEPHANT BREATH \+ BIRD LABIA → 1 SHARED LIP/);
  assert.match(html, /id="moduleField"/);
  assert.match(html, /id="connectionCanvas"/);
  assert.match(html, /id="moduleTemplate"/);
  assert.match(html, /class="module-duplicate"/);
  assert.match(html, /data-route="braid"/);
  assert.match(html, /data-route="chain"/);
  assert.match(html, /data-route="all"/);
  assert.match(html, /src="hyper-syrinx-app\.js"/);
  assert.match(html, /src="nav\.js"/);

  for (const term of [
    "Breath",
    "Openings",
    "Tissues",
    "Apparati",
    "Tracheas",
    "Tracts",
    "Mouths + lips",
  ]) {
    assert.match(app, new RegExp(`title: \\"${term.replace("+", "\\+")}\\"`));
  }
  assert.match(app, /function countLivingPaths\(/);
  assert.match(app, /function mutate\(/);
  assert.match(app, /createBiquadFilter\(\)/);
  assert.match(app, /createWaveShaper\(\)/);
  assert.match(app, /createStereoPanner/);
  assert.match(app, /connectAudioOutput/);
  assert.doesNotMatch(app, /getUserMedia|createMediaStreamSource/);

  assert.match(css, /\.organ-column/);
  assert.match(css, /\.organ-module/);
  assert.match(css, /\.hyper-sum-strip/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Hyper-Syrinx is discoverable and enters clean release builds", async () => {
  const tool = TOOL_GROUPS
    .find(({ id }) => id === "signal-voice")
    ?.tools.find(({ id }) => id === "hyper-syrinx");
  assert.deepEqual(tool, {
    id: "hyper-syrinx",
    label: "Hyper-Syrinx",
    href: "hyper-syrinx.html",
    catalogue: false,
  });

  const build = await readFile(new URL("scripts/build-site.sh", root), "utf8");
  for (const file of ["hyper-syrinx.html", "hyper-syrinx.css", "hyper-syrinx-app.js"]) {
    assert.match(build, new RegExp(file.replaceAll(".", "\\.")));
  }
});

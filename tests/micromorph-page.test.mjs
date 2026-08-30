import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Micromorph exposes one honest, local-first live diffusion instrument", async () => {
  const [html, app, css, contract] = await Promise.all([
    read("../micromorph.html"),
    read("../micromorph-app.js"),
    read("../micromorph.css"),
    read("../contracts/micromorph-stream-v1.md"),
  ]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML ids remain unique");
  for (const id of [
    "audioButton",
    "stage",
    "engineUrl",
    "connectModel",
    "derivation",
    "material",
    "structureLock",
    "memory",
    "mutation",
    "continuation",
    "anchorA",
    "anchorB",
    "truthNote",
    "inputDrops",
  ]) assert.ok(ids.includes(id), `missing #${id}`);

  assert.match(html, /ws:\/\/127\.0\.0\.1:3939\/v1\/stream/);
  assert.match(html, /No neural model is active/i);
  assert.match(html, /deterministic spectral rehearsal/i);
  assert.match(html, /Use headphones/i);
  assert.match(html, /src="micromorph-app\.js"/);
  assert.match(app, /new MicromorphModelClient/);
  assert.match(app, /subscribePcmOutput/);
  assert.match(app, /sendPcmInput/);
  assert.match(app, /document\.hidden/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /if \(disposed \|\| animationFrame\) return/);
  assert.doesNotMatch(app, /requestAnimationFrame\(\(time\) => draw\(time\)\)/);
  assert.match(app, /state\.modelBusy/);
  assert.match(app, /redactMicromorphEndpoint/);
  assert.doesNotMatch(app, /audio\.start\(\);\s*\n?}\s*\n?initialize\(\)/);
  assert.match(css, /micromorph-stage/);
  assert.match(contract, /mga-stream\/1/);
  assert.match(contract, /interleaved little-endian\s+Float32 PCM/i);
  assert.match(contract, /MGA1/);
  assert.match(contract, /config-accepted/);
  assert.match(contract, /model-ready/);
  assert.match(contract, /startFrame/);
});

test("Micromorph has no remote model, script, font, or stylesheet dependency", async () => {
  const html = await read("../micromorph.html");
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//i);
  assert.doesNotMatch(html, /models\.example|huggingface|replicate|openai/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the vanilla entry point and every referenced control are present", async () => {
  const [html, app, packageJson] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("app.js", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(html, /<script\s+type="module"\s+src="app\.js"><\/script>/);
  assert.match(html, /<canvas[\s\S]+?id="stage"/);
  assert.doesNotMatch(html, /Shape Player/i);

  const groupOrder = ["playTitle", "formTitle", "soundTitle"]
    .map((id) => html.indexOf(`id="${id}"`));
  assert.ok(groupOrder.every((position) => position >= 0));
  assert.deepEqual(groupOrder, [...groupOrder].sort((a, b) => a - b));

  const openingTag = (id) => {
    const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
    assert.ok(match, `missing opening tag for #${id}`);
    return match[0];
  };

  // Points are the initial instrument; line-only controls stay out of view until
  // Line is selected.
  assert.match(openingTag("scanMode"), /aria-pressed="false"/);
  assert.match(openingTag("traceMode"), /aria-pressed="true"/);
  assert.doesNotMatch(openingTag("headsControl"), /\bhidden\b/);
  assert.match(openingTag("lineCountControl"), /\bhidden\b/);
  assert.match(openingTag("lineLayoutControl"), /\bhidden\b/);
  assert.match(openingTag("scanMotionControl"), /\bhidden\b/);

  // Loop is retained as the line-reader default when the conditional controls
  // are revealed.
  assert.match(openingTag("pingPongScan"), /aria-pressed="false"/);
  assert.match(openingTag("loopScan"), /aria-pressed="true"/);
  assert.ok(html.indexOf('id="audioButton"') < html.indexOf('id="playTitle"'));
  assert.ok(html.indexOf('id="level"') < html.indexOf("<main"));
  assert.doesNotMatch(html, /<small>01<\/small>/);
  assert.doesNotMatch(html, /class="panel-heading"/);
  assert.doesNotMatch(html, /id="stageName"/);
  assert.doesNotMatch(html, /id="methodHelp"|id="headsHelp"|id="curvatureHelp"/);
  assert.doesNotMatch(html, /id="restartButton"/);
  assert.doesNotMatch(html, /id="displayTitle"|id="guidesToggle"|id="verticesToggle"|id="trailsToggle"/);
  assert.ok(html.includes('id="traversalReverse"'));
  assert.ok(html.includes('id="traversalForward"'));
  assert.ok(html.includes('id="rotationPlayButton"'));
  assert.ok(html.includes('id="rotationReverse"'));
  assert.ok(html.includes('id="rotationForward"'));
  assert.match(html, /id="rotationSpeed"[^>]*max="2"/);
  assert.match(html, /id="curvature"[^>]*min="0"[^>]*max="1"/);
  assert.ok(html.includes('id="curvatureDirection"'));

  const soundSelect = html.match(/<select\s+id="soundMode"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(soundSelect, "missing sound mode select");
  assert.match(soundSelect[1], /<option\s+value="sine"\s+selected>Sine\b/);
  assert.match(soundSelect[1], /<option\s+value="percussion">Percussion\b/);

  assert.doesNotMatch(openingTag("sineArticulation"), /\bhidden\b/);
  assert.match(openingTag("percussionArticulation"), /\bhidden\b/);
  assert.match(openingTag("sineAccent"), /min="0"[^>]*max="1"[^>]*value="0\.75"/);
  assert.match(openingTag("sineDecay"), /min="0"[^>]*max="1"[^>]*value="0\.65"/);
  assert.match(openingTag("cornerAccent"), /min="0"[^>]*max="1"[^>]*value="0\.9"/);
  assert.match(openingTag("cornerAttack"), /min="0\.5"[^>]*max="30"[^>]*value="3"/);
  assert.match(openingTag("cornerDecay"), /min="20"[^>]*max="800"[^>]*value="90"/);
  assert.doesNotMatch(html, /id="sustain"|Edge sustain|id="waveform"|Shepard layers/);
  assert.match(app, /const SPEED_MAX = 1\.2;/);

  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML ids must be unique");

  const referencedIds = new Set(
    [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
  );
  for (const match of app.matchAll(/bindRange\("([^"]+)"/g)) {
    referencedIds.add(match[1]);
    referencedIds.add(`${match[1]}Out`);
  }

  const idSet = new Set(htmlIds);
  const missing = [...referencedIds].filter((id) => !idSet.has(id));
  assert.deepEqual(missing, [], `app.js references missing ids: ${missing.join(", ")}`);

  const manifest = JSON.parse(packageJson);
  assert.equal(manifest.name, "morphazoid");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.doesNotMatch(packageJson, /next|react|typescript/i);
});

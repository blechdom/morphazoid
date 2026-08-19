import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rewriteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.resolve(rewriteRoot, "..");

async function source(relativePath) {
  return readFile(path.join(rewriteRoot, relativePath), "utf8");
}

function idsIn(html) {
  return [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
}

function localReferences(html) {
  return [...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((reference) => (
      !reference.startsWith("#")
      && !reference.startsWith("http:")
      && !reference.startsWith("https:")
      && !reference.startsWith("mailto:")
      && !reference.startsWith("data:")
    ));
}

test("the isolated workbench exposes every runtime control and inspection surface", async () => {
  const html = await source("index.html");
  const ids = new Set(idsIn(html));
  for (const required of [
    "geometryStage",
    "stageShell",
    "liveDashboardTitle",
    "liveTopologyState",
    "liveFrameState",
    "routeMonitorTitle",
    "eventStream",
    "eventActivity",
    "eventHistoryCount",
    "eventAnnouncement",
    "contactMetrics",
    "readerMetrics",
    "formMetrics",
    "topologyMetrics",
    "audioMetrics",
    "contactList",
    "audioToggle",
    "playToggle",
    "rotationToggle",
    "readerPhase",
    "readerSpeed",
    "readerMode",
    "rotation",
    "rotationSpeed",
    "shapeType",
    "sides",
    "starDepth",
    "curvature",
    "aspect",
    "skew",
    "qualityMode",
    "soundMode",
    "baseFrequency",
    "pitchRange",
    "masterLevel",
    "headerMasterLevel",
    "headerMasterLevelOut",
    "pitchSource",
    "panSource",
    "levelSource",
    "timbreSource",
    "liveStatus",
  ]) assert.ok(ids.has(required), `index.html is missing #${required}`);

  assert.match(html, /<canvas[^>]+tabindex=["']0["']/);
  assert.match(html, /<a class="brand" href="\.\.\/" aria-label="Morphazoid home">/);
  assert.match(
    html,
    /class="header-actions"[\s\S]*?id="headerMasterLevel"[\s\S]*?id="audioToggle"/,
    "the compact master level precedes Audio in the custom header",
  );
  assert.match(html, /id="playToggle"[^>]*data-primary-transport/);
  assert.match(html, /<script type=["']module["'] src=["']app\.js["']/);
  assert.match(html, /\+Y down · positive angles clockwise/);
  assert.equal([...html.matchAll(/\bdata-live-feature=/g)].length, 6);
  assert.equal([...html.matchAll(/\bdata-route-monitor=/g)].length, 4);
  assert.equal([...html.matchAll(/\bdata-event-feature=/g)].length, 6);
});

test("the custom header master level stays synchronized with the audio engine", async () => {
  const app = await source("app.js");
  const css = await source("style.css");
  assert.match(app, /headerMasterLevel\?\.addEventListener\("input"/);
  assert.match(app, /pool\.setLevel\(state\.masterLevel\)/);
  assert.match(
    css,
    /@media \(max-width: 680px\)[\s\S]*?\.session-state \.header-io-controls > \.header-actions[\s\S]*?grid-template-columns:/,
  );
  assert.doesNotMatch(app, /event\.key\.toLowerCase\(\) === "m"[\s\S]{0,100}audio\?\.click/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?#playToggle[\s\S]*?min-height: 48px/);
});

test("the live monitor and signal explorer expose stable, non-spamming semantics", async () => {
  const html = await source("index.html");
  const eventList = html.match(/<ol\b[^>]*\bid=["']eventStream["'][^>]*>/)?.[0] ?? "";
  assert.ok(eventList, "eventStream must remain an ordered list");
  assert.doesNotMatch(eventList, /\baria-live=/, "the visual event log must not announce every redraw");
  assert.match(html, /id=["']eventAnnouncement["'][^>]*aria-live=["']polite["']/);

  const tabs = [...html.matchAll(/<button\b[^>]*\brole=["']tab["'][^>]*>/g)].map((match) => match[0]);
  assert.equal(tabs.length, 5);
  assert.equal(tabs.filter((tab) => /\btabindex=["']0["']/.test(tab)).length, 1);
  assert.equal(tabs.filter((tab) => /\btabindex=["']-1["']/.test(tab)).length, 4);
  assert.equal(tabs.filter((tab) => /\baria-selected=["']true["']/.test(tab)).length, 1);

  const ids = new Set(idsIn(html));
  for (const tab of tabs) {
    const panel = tab.match(/\baria-controls=["']([^"']+)["']/)?.[1];
    assert.ok(panel && ids.has(panel), `tab points to missing panel ${panel}`);
  }
});

test("page IDs and label targets are unique and valid", async () => {
  for (const page of ["index.html", "atlas.html"]) {
    const html = await source(page);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${page} contains a duplicate ID`);
    const idSet = new Set(ids);
    for (const match of html.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["']/g)) {
      assert.ok(idSet.has(match[1]), `${page} label points to missing #${match[1]}`);
    }
  }
});

test("all local page assets and navigation targets resolve", async () => {
  for (const page of ["index.html", "atlas.html"]) {
    const html = await source(page);
    for (const reference of localReferences(html)) {
      const clean = reference.split(/[?#]/, 1)[0];
      if (!clean) continue;
      await assert.doesNotReject(
        access(path.resolve(rewriteRoot, clean)),
        `${page} references missing ${reference}`,
      );
    }
  }
});

test("the Atlas reads the shared registry and supports URL-addressable filters", async () => {
  const [html, script] = await Promise.all([source("atlas.html"), source("atlas.js")]);
  assert.match(html, /<a class="brand" href="\.\.\/" aria-label="Morphazoid home">/);
  assert.match(script, /import \{ FEATURE_REGISTRY \} from ["']\.\/feature-registry\.js["']/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /aria-pressed/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("planning and analysis references remain alongside the isolated rewrite", async () => {
  const [readme, plan, analysis] = await Promise.all([
    source("README.md"),
    source("PLAN.md"),
    readFile(path.join(packageRoot, "GEOMETRY_ANALYSIS.md"), "utf8"),
  ]);
  assert.match(readme, /Isolation rule/);
  assert.match(plan, /Feature Atlas/);
  assert.match(plan, /Swept bifurcation/);
  assert.match(plan, /Accessibility/);
  assert.match(analysis, /Intersections and bifurcation/);
  assert.match(analysis, /Output and Mapping design/);
});

test("the rewrite is dependency-free and does not fetch presentation assets", async () => {
  const [css, app, atlas] = await Promise.all([
    source("style.css"),
    source("app.js"),
    source("atlas.js"),
  ]);
  assert.doesNotMatch(css, /@import\s+url\(/);
  assert.doesNotMatch(`${app}\n${atlas}`, /fetch\s*\(/);
  assert.doesNotMatch(`${app}\n${atlas}`, /https?:\/\//);
});

test("the compact workbench header keeps the home logo and hides its title", async () => {
  const css = await source("style.css");
  assert.match(
    css,
    /@media \(max-width: 680px\)[\s\S]*?\.brand \{[^}]*width: 34px;[^}]*overflow: hidden;[^}]*flex: 0 0 34px;/,
  );
  assert.match(
    css,
    /@media \(max-width: 680px\)[\s\S]*?\.brand > span:last-child \{\s*display: none;/,
  );
});

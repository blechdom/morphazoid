import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const PAGES = [
  { file: "shape.html", transportLabel: "Playhead direction and movement", directionLabel: "Playhead direction: clockwise" },
  { file: "shape-drums.html", transportLabel: "Playhead direction and movement", directionLabel: "Playhead direction: clockwise" },
  { file: "lattice.html", transportLabel: "Pattern direction and movement", directionLabel: "Pattern direction: reverse" },
  { file: "lattice-drums.html", transportLabel: "Pattern direction and movement", directionLabel: "Pattern direction: reverse" },
  { file: "spiral.html", transportLabel: "Time direction and movement", directionLabel: "Time direction: out to in" },
  { file: "spiral-drums.html", transportLabel: "Time direction and movement", directionLabel: "Time direction: out to in" },
  { file: "solid-drums.html", transportLabel: "Surface direction and movement", directionLabel: "Surface direction: forward" },
  { file: "hyper-drums.html", transportLabel: "Hyperplane direction and movement", directionLabel: "Hyperplane direction: forward" },
  { file: "l-system-drums.html", transportLabel: "Traversal direction and movement", directionLabel: "Traversal direction: forward" },
];
const MIGRATED_PAGES = PAGES.slice(2);
const LEGACY_PRIMARY_IDS = [
  "scanMotion",
  "loopScan",
  "pingPongScan",
  "directionChoice",
  "timeDirection",
  "directionButton",
  "traversalMode",
  "traversalLoop",
  "traversalPingPong",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attribute(tag, name) {
  const escapedName = escapeRegExp(name);
  const match = tag.match(new RegExp(`\\s${escapedName}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|/?>)`, "i"));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

function openingTagsWithId(markup, id) {
  const escapedId = escapeRegExp(id);
  return [...markup.matchAll(new RegExp(`<[^>]+\\bid=(?:"${escapedId}"|'${escapedId}'|${escapedId})(?=\\s|/?>)[^>]*>`, "gi"))]
    .map((match) => match[0]);
}

function playheadMotion(markup, file) {
  const matches = [...markup.matchAll(/<div\b([^>]*\bid="playheadMotion"[^>]*)>([\s\S]*?)<\/div>/gi)];
  assert.equal(matches.length, 1, `${file} must have exactly one primary #playheadMotion group`);

  const [, attributes, contents] = matches[0];
  const buttons = [...contents.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)].map((match) => match[0]);
  const nonButtonContents = contents.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, "").trim();
  assert.equal(nonButtonContents, "", `${file} #playheadMotion may only contain its three transport buttons`);

  return { openingTag: `<div${attributes}>`, buttons };
}

function openingTag(element) {
  return element.match(/^<[^>]+>/)?.[0] ?? "";
}

test("shape instruments and their drum machines share the Shape primary transport markup", async () => {
  const sources = new Map(await Promise.all(PAGES.map(async ({ file }) => [
    file,
    await readFile(new URL(file, ROOT), "utf8"),
  ])));

  for (const { file, transportLabel, directionLabel } of PAGES) {
    const { openingTag: groupTag, buttons } = playheadMotion(sources.get(file), file);

    assert.equal(attribute(groupTag, "class"), "transport-button-array", `${file} uses the Shape transport array styling`);
    assert.equal(attribute(groupTag, "role"), "group", `${file} exposes the transport as one control group`);
    assert.equal(attribute(groupTag, "aria-label"), transportLabel, `${file} names the transport group in context`);
    assert.equal(buttons.length, 3, `${file} has direction, loop, and ping-pong controls only`);

    const buttonTags = buttons.map(openingTag);
    assert.deepEqual(
      buttonTags.map((tag) => attribute(tag, "id")),
      ["traversalDirection", "loopMotion", "pingPongMotion"],
      `${file} keeps the original Shape transport button order`,
    );
    assert.deepEqual(buttonTags.map((tag) => attribute(tag, "type")), ["button", "button", "button"]);

    const [directionTag, loopTag, pingPongTag] = buttonTags;
    assert.equal(attribute(directionTag, "class"), "direction-toggle", `${file} uses the Shape direction-toggle styling`);
    assert.equal(attribute(directionTag, "aria-label"), directionLabel, `${file} describes its initial travel direction`);
    assert.equal(attribute(directionTag, "aria-pressed"), null, `${file} direction is an action, not a selected mode`);
    assert.match(buttons[0], /<span\s+id="traversalDirectionGlyph">[^<]+<\/span>/i);
    assert.match(buttons[0], /<small\s+id="traversalDirectionText">[^<]+<\/small>/i);

    assert.equal(attribute(loopTag, "class"), null);
    assert.equal(attribute(loopTag, "data-value"), "loop");
    assert.equal(attribute(loopTag, "aria-pressed"), "true", `${file} starts in looping mode`);
    assert.equal(attribute(loopTag, "aria-label"), "Loop movement");
    assert.equal(attribute(loopTag, "title"), "Loop");
    assert.match(buttons[1], /<span\s+aria-hidden="true">⟳<\/span><small>Loop<\/small>/i);

    assert.equal(attribute(pingPongTag, "class"), null);
    assert.equal(attribute(pingPongTag, "data-value"), "pingpong");
    assert.equal(attribute(pingPongTag, "aria-pressed"), "false", `${file} starts with ping-pong off`);
    assert.equal(attribute(pingPongTag, "aria-label"), "Back-and-forth movement");
    assert.equal(attribute(pingPongTag, "title"), "Back and forth");
    assert.match(buttons[2], /<span\s+aria-hidden="true">↔<\/span><small>Ping-pong<\/small>/i);
  }

  for (const { file } of MIGRATED_PAGES) {
    const markup = sources.get(file);
    for (const id of LEGACY_PRIMARY_IDS) {
      assert.equal(openingTagsWithId(markup, id).length, 0, `${file} must not retain legacy primary #${id}`);
    }
  }

  assert.equal(openingTagsWithId(sources.get("lattice.html"), "patternDirection").length, 1, "the Lattice spatial direction control remains distinct");
  for (const file of ["spiral.html", "spiral-drums.html"]) {
    assert.equal(openingTagsWithId(sources.get(file), "loopDirection").length, 1, `${file} keeps its separate zoom direction control`);
  }
});

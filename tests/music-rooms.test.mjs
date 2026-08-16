import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS, resolveActiveTool } from "../nav.js";
import { INSTRUMENTS } from "../src/instrument-catalog.js";

const root = new URL("../", import.meta.url);
const siteRoot = "https://example.test/blechdom/morphazoid/";
const roomTools = [
  {
    id: "room-lobby",
    label: "Music Rooms",
    href: "music-rooms.html",
    catalogue: false,
  },
  {
    id: "vocal-effects-room",
    label: "Vocal Effects Room",
    href: "vocal-effects-room.html",
    catalogue: false,
  },
  {
    id: "instrument-share-room",
    label: "Instrument Share Room",
    href: "instrument-share-room.html",
    catalogue: false,
  },
  {
    id: "morphazoid-roulette",
    label: "Morphazoid Roulette",
    href: "morphazoid-roulette.html",
    catalogue: false,
  },
];
const roomPreviews = [
  { heading: "Vocal Effects", href: "vocal-effects-room.html" },
  { heading: "Instrument Share", href: "instrument-share-room.html" },
  { heading: "Morphazoid Roulette", href: "morphazoid-roulette.html" },
];

test("Music Rooms routes live in works in progress without entering the instrument catalogue", () => {
  const group = TOOL_GROUPS.find(({ id }) => id === "experiments");

  assert.ok(group);
  assert.equal(TOOL_GROUPS.some(({ id }) => id === "music-rooms"), false);
  assert.equal(group.label, "Experiments");
  assert.deepEqual(group.tools.slice(0, 4), roomTools);
  for (const room of roomTools) {
    assert.equal(resolveActiveTool(`${siteRoot}${room.href}`, siteRoot)?.id, room.id);
    assert.equal(INSTRUMENTS.some(({ id }) => id === room.id), false);
  }
});

test("Room Lobby presents exactly three distinct room previews", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("music-rooms.html", root), "utf8"),
    readFile(new URL("music-rooms.css", root), "utf8"),
  ]);

  assert.match(html, /<title>Music Rooms \| Morphazoid<\/title>/);
  assert.match(html, /<h1>Music Rooms<\/h1>/);
  assert.match(html, /Three browser-room experiments for playing Morphazoid together/);
  assert.match(html, /aria-labelledby="roomLobbyTitle"/);
  assert.equal((html.match(/class="music-room-card"/g) ?? []).length, 3);
  for (const { heading, href } of roomPreviews) {
    assert.match(html, new RegExp(`<h3>${heading}<\\/h3>`));
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.doesNotMatch(html, /href="#"/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /min-height: 44px/);
});

test("each room route is an explicit, non-connecting preview with a lobby return", async () => {
  const rooms = [
    ["vocal-effects-room.html", "Vocal Effects Room", "Vocal Effects"],
    ["instrument-share-room.html", "Instrument Share Room", "Instrument Share"],
    ["morphazoid-roulette.html", "Morphazoid Roulette", "Morphazoid Roulette"],
  ];

  for (const [file, title, heading] of rooms) {
    const html = await readFile(new URL(file, root), "utf8");
    assert.match(html, new RegExp(`<title>${title} \\| Morphazoid<\\/title>`));
    assert.match(html, new RegExp(`<h1>${heading}<\\/h1>`));
    assert.match(html, /Preview · Not connected/);
    assert.match(html, /<button class="music-room-join" type="button" disabled>/);
    assert.match(html, /href="music-rooms\.html">Back to Music Rooms<\/a>/);
    assert.match(html, /href="music-rooms\.css"/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  }

  const roulette = await readFile(new URL("morphazoid-roulette.html", root), "utf8");
  for (const safetyControl of ["Next player", "Block", "Report", "Leave"]) {
    assert.match(roulette, new RegExp(safetyControl));
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { refreshRolloutStatus } from "../scripts/presets/rollout-status.mjs";
import { FAVE_TOOL_IDS } from "../src/site/instrument-registry.js";

const entry = (id, extra = {}) => ({ id, label: id, href: `${id}.html`, ...extra });
const items = [
  entry("ordinary"), entry("fave-b"), entry("fave-a"), entry("unfinished"),
  entry("wip"), entry("implemented-wip"), entry("lab", { entryType: "lab" }),
];
const groups = [
  { id: "geometric", tools: items.slice(0, 4) },
  { id: "wip", tools: items.slice(4, 6) },
  { id: "bioacoustic", tools: items.slice(6) },
];
const faves = ["fave-a", "fave-b"];
const options = { items, groups, faves };
const previous = {
  verification: { browser: "pending", humanListening: "pending" },
  entries: [
    { ...entry("ordinary"), status: "implemented-verification-pending", presets: 12, evidence: "keep me" },
    { ...entry("implemented-wip"), status: "implemented-verification-pending", presets: 14 },
    { ...entry("wip"), scope: "regular", status: "unmigrated", presets: null },
  ],
};

test("rollout order follows Faves then non-WIP registry order, with WIP and labs deferred", () => {
  const result = refreshRolloutStatus(previous, options);
  assert.deepEqual(result.queues, {
    faves, nonWipUnmigrated: ["unfinished"], deferred: ["wip", "implemented-wip", "lab"],
  });
  assert.deepEqual(result.entries.map(item => item.scope),
    ["regular", "fave", "fave", "regular", "deferred-wip", "deferred-wip", "deferred-lab"]);
  assert.deepEqual(result.counts, {
    implemented: 2, fullPresets: 26, favesImplemented: 0, activeRemaining: 3, regularRemaining: 4,
  });
  assert.equal(result.entries.find(item => item.id === "wip").status, "deferred");
});

test("refresh preserves existing banks and evidence, without granting QA or mutating input", () => {
  const before = structuredClone(previous);
  const result = refreshRolloutStatus(previous, options);
  assert.deepEqual(previous, before);
  assert.deepEqual(result.verification, before.verification);
  assert.equal(result.entries[0].evidence, "keep me");
  assert.equal(result.entries.find(item => item.id === "implemented-wip").presets, 14);
  assert.equal(result.entries.find(item => item.id === "implemented-wip").status, "implemented-verification-pending");
  assert.deepEqual(refreshRolloutStatus(result, options), result);
});

test("non-catalogue utility routes remain recorded without becoming instruments or labs", () => {
  const utility = entry("room", { catalogue: false });
  const result = refreshRolloutStatus(previous, {
    ...options, items: [...items, utility],
    groups: [...groups, { id: "rooms", tools: [utility] }],
  });
  assert.equal(result.entries.at(-1).scope, "deferred-utility");
  assert.equal(result.entries.at(-1).status, "deferred");
  assert.equal(result.counts.regularRemaining, 4);
  assert.ok(result.queues.deferred.includes("room"));
});

test("refresh requires review before losing entries or accepting broken implementation metadata", () => {
  assert.throws(() => refreshRolloutStatus({ entries: [entry("removed")] }, options), /Review removed/);
  assert.throws(() => refreshRolloutStatus({ entries: [entry("wip"), entry("wip")] }, options), /Duplicate rollout/);
  assert.throws(() => refreshRolloutStatus(previous, { ...options, faves: ["missing"] }), /Fave missing/);
  assert.throws(() => refreshRolloutStatus({ entries: [{ ...entry("ordinary"), status: "implemented-verification-pending", presets: null }] }, options), /reviewed full-preset count/);
});

test("checked-in rollout membership/counts match current source and keep all Faves in acceptance order", async () => {
  const status = JSON.parse(await readFile(new URL("../docs/preset-rollout-status.json", import.meta.url), "utf8"));
  assert.deepEqual(refreshRolloutStatus(status), status);
  assert.deepEqual(status.queues.faves, FAVE_TOOL_IDS);
});

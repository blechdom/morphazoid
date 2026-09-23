#!/usr/bin/env node
// Refresh queue membership, never infer preset implementation or QA approval.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FAVE_TOOL_IDS, TOOL_GROUPS } from "../../src/site/instrument-registry.js";

const statusFile = new URL("../../docs/preset-rollout-status.json", import.meta.url);

export function refreshRolloutStatus(previous, {
  groups = TOOL_GROUPS, items = groups.flatMap(group => group.tools), faves = FAVE_TOOL_IDS,
} = {}) {
  const prior = new Map();
  for (const entry of previous.entries) {
    if (prior.has(entry.id)) throw new Error(`Duplicate rollout ID: ${entry.id}`);
    prior.set(entry.id, entry);
  }
  const categories = new Map(groups.flatMap(group => group.tools.map(tool => [tool.id, group.id])));
  const currentIds = new Set(items.map(item => item.id));
  if (currentIds.size !== items.length) throw new Error("Duplicate catalogue ID");
  for (const id of prior.keys()) {
    if (!currentIds.has(id)) throw new Error(`Review removed rollout entry before dropping it: ${id}`);
  }
  for (const id of faves) {
    if (!currentIds.has(id)) throw new Error(`Fave missing from catalogue: ${id}`);
  }
  const implemented = entry => entry.status.startsWith("implemented-");
  const entries = items.map(item => {
    const category = categories.get(item.id);
    if (!category) throw new Error(`Missing registry category: ${item.id}`);
    const scope = item.entryType === "lab" ? "deferred-lab"
      : item.catalogue === false ? "deferred-utility"
      : category === "wip" ? "deferred-wip" : faves.includes(item.id) ? "fave" : "regular";
    const old = prior.get(item.id);
    const deferred = scope.startsWith("deferred-");
    // A change in priority must not erase an existing adapter or its evidence.
    const status = old && implemented(old) ? old.status : deferred ? "deferred"
      : old?.status === "deferred" ? "unmigrated" : old?.status ?? "unmigrated";
    if (status.startsWith("implemented-") && (!Number.isInteger(old.presets) || old.presets < 12)) {
      throw new Error(`Implemented entry needs its reviewed full-preset count: ${item.id}`);
    }
    return {
      ...old, id: item.id, label: item.label, href: item.href, category, scope,
      presets: old?.presets ?? null, status,
    };
  });
  const active = entry => entry.scope === "fave" || entry.scope === "regular";
  return {
    ...previous,
    counts: {
      implemented: entries.filter(implemented).length,
      fullPresets: entries.filter(implemented).reduce((sum, entry) => sum + entry.presets, 0),
      favesImplemented: entries.filter(entry => entry.scope === "fave" && implemented(entry)).length,
      activeRemaining: entries.filter(entry => active(entry) && !implemented(entry)).length,
      regularRemaining: entries.filter(entry => !["deferred-lab", "deferred-utility"].includes(entry.scope) && !implemented(entry)).length,
    },
    // Faves includes implemented instruments: their outstanding acceptance work
    // still precedes authoring banks for the next non-WIP category.
    queues: {
      faves: [...faves],
      nonWipUnmigrated: entries.filter(entry => entry.scope === "regular" && !implemented(entry)).map(entry => entry.id),
      deferred: entries.filter(entry => !active(entry)).map(entry => entry.id),
    },
    entries,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--write")) {
    throw new Error("Usage: node scripts/presets/rollout-status.mjs [--write]");
  }
  const previous = JSON.parse(await readFile(statusFile, "utf8"));
  const next = refreshRolloutStatus(previous);
  const text = JSON.stringify(next, null, 2) + "\n";
  if (args[0] === "--write") {
    await writeFile(statusFile, text);
    console.log(`Updated ${fileURLToPath(statusFile)}; no implementation or verification claims changed.`);
  } else if (text !== JSON.stringify(previous, null, 2) + "\n") {
    console.error("Preset rollout queue is stale. Review and run node scripts/presets/rollout-status.mjs --write.");
    process.exitCode = 1;
  } else {
    console.log("Preset rollout membership and counts match the current registry; QA evidence is not inferred.");
  }
}

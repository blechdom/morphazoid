#!/usr/bin/env node
// Read-only source discovery: candidates are not proof of whole-instrument recall.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CATALOGUE_ITEMS } from "../../src/site/instrument-catalog.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const presetWord = /preset|patch|bank|pattern|material|starting.?point/i;
const sharedBootstrap = /(?:^|\/)(?:nav|wax-page|shader-synth-playground-bootstrap)\.js$/;

export function localDependency(reference, filename) {
  if (!reference || !/^(?:\.{1,2}\/|\/)/.test(reference)) return null;
  try {
    const url = new URL(reference, new URL(filename, "https://inventory.invalid/"));
    if (url.origin !== "https://inventory.invalid" || /%(?:2f|5c)/i.test(url.pathname)) return null;
    const target = decodeURIComponent(url.pathname).slice(1);
    if (target.includes("\\") || target.includes("\0")) return null;
    return target;
  } catch { return null; }
}

function attributes(markup) {
  return Object.fromEntries([...markup.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
    .map(match => [match[1].toLowerCase(), match[3]]));
}

export function presetMarkupCandidates(html) {
  const source = html.replace(/<!--[\s\S]*?-->/g, "");
  const candidates = [];
  for (const match of source.matchAll(/<(select|button|div|fieldset)\b([^>]*)>/gi)) {
    const attrs = attributes(match[2]);
    if (!presetWord.test([attrs.id, attrs.name, attrs["aria-label"]].filter(Boolean).join(" "))) continue;
    if (!attrs.id) continue;
    candidates.push({
      tag: match[1].toLowerCase(),
      id: attrs.id,
      label: attrs["aria-label"] ?? null,
    });
  }
  return candidates;
}

function moduleReferences(source) {
  return [...source.matchAll(/\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)]
    .map(match => match[1] ?? match[2]);
}

export async function collectPresetInventory({ root = repositoryRoot, items = CATALOGUE_ITEMS } = {}) {
  const cache = new Map();
  const read = async filename => {
    if (!cache.has(filename)) {
      cache.set(filename, readFile(path.join(root, filename), "utf8").catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      }));
    }
    return cache.get(filename);
  };
  const rows = [];
  for (const item of items) {
    const page = item.href.endsWith("/") ? `${item.href}index.html` : item.href;
    const html = await read(page);
    if (html === null) throw new Error(`Missing catalogue entry page: ${page}`);
    const entries = [...html.matchAll(/<script\b([^>]*)>/gi)]
      .map(match => attributes(match[1]).src)
      .filter(Boolean)
      .map(reference => localDependency(reference.startsWith(".") || reference.startsWith("/") ? reference : `./${reference}`, page))
      .filter(filename => filename && !sharedBootstrap.test(filename));
    const queue = [...new Set(entries)].map(filename => ({ filename, depth: 0 }));
    const seen = new Set();
    const sourceCandidates = [];
    const missingSources = [];
    while (queue.length) {
      const { filename, depth } = queue.shift();
      if (seen.has(filename)) continue;
      seen.add(filename);
      const text = await read(filename);
      if (text === null) { missingSources.push(filename); continue; }
      const names = [...new Set(text.match(/\b[A-Za-z_$][\w$]*(?:PRESETS|PRESET|Presets|Preset|presets|preset|PATCHES|BANKS|PATTERNS)[\w$]*\b/g) ?? [])]
        .sort();
      if (names.length) sourceCandidates.push({ file: filename, identifiers: names });
      // Bounded source survey, not execution or a complete dependency graph.
      if (depth >= 2) continue;
      for (const reference of moduleReferences(text)) {
        const target = localDependency(reference, filename);
        if (target && /\.m?js$/.test(target) && !sharedBootstrap.test(target)) {
          queue.push({ filename: target, depth: depth + 1 });
        }
      }
    }
    rows.push({
      id: item.id, name: item.label, href: item.href,
      entryType: item.entryType ?? "instrument",
      entries: [...new Set(entries)],
      markupCandidates: presetMarkupCandidates(html),
      sourceCandidates,
      missingSources,
      status: "needs-instrument-review",
      fullPresetCount: null,
      headerMigrated: false,
    });
  }
  return {
    schemaVersion: 1,
    scope: "All current catalogue entries, including separately identified labs.",
    limitation: "Static hints only. Names do not prove preset existence, count, completeness, recall safety, or audible variety; no presets are applied.",
    rows,
  };
}

export function inventoryMarkdown(inventory) {
  const cell = text => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    "# Full-instrument preset rollout: source inventory",
    "",
    inventory.limitation,
    "",
    "Every row still needs an instrument-owned full-state/pattern/voice-bank review.",
    "Zero candidate controls does **not** establish that an instrument has no presets.",
    "A null full-preset count means not verified, not zero.",
    "",
    "| Instrument | ID | Entry type | Candidate control IDs | Source files with preset hints | Status |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...inventory.rows.map(row => `| ${cell(row.name)} | \`${row.id}\` | ${row.entryType} | ${row.markupCandidates.map(candidate => `\`${cell(candidate.id)}\``).join(", ") || "None found in static HTML"} | ${row.sourceCandidates.length} | Not migrated |`),
    "",
  ].join("\n");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const output = path.resolve(repositoryRoot, process.argv[2] ?? "test-results/preset-rollout");
  const inventory = await collectPresetInventory();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
  await writeFile(path.join(output, "inventory.md"), inventoryMarkdown(inventory));
  console.log(`Inventoried ${inventory.rows.length} catalogue entries. No preset completeness or listening approval inferred.`);
  console.log(`Reports: ${output}`);
}

#!/usr/bin/env node
// Read-only discovery, not a build or a readiness gate. Uses only Node built-ins
// and the repository's browser-safe registry exports; never imports a page app.
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TOOL_GROUPS } from "../nav.js";
import { INSTRUMENTS, instrumentById } from "../src/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/instrument-midi-capabilities.js";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const rootURL = pathToFileURL(repositoryRoot);
const sorted = values => [...new Set(values)].sort();
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const absolute = relative => path.join(repositoryRoot, relative);
async function exists(relative) { return stat(absolute(relative)).then(s => s.isFile(), () => false); }
function git(...args) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trimEnd();
}
export function localPath(reference, from) {
  if (!reference || reference.startsWith("#") || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(reference)) return null;
  try {
    const url = new URL(reference.startsWith("/") ? `.${reference}` : reference,
      reference.startsWith("/") ? rootURL : pathToFileURL(absolute(from)));
    // Encoded separators are not file URL paths. Reject both slash forms on
    // every platform, then check containment using the decoded filesystem path.
    if (/%(?:2f|5c)/i.test(url.pathname)) return null;
    const relative = path.relative(repositoryRoot, fileURLToPath(url));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    const normalized = relative.split(path.sep).join("/");
    return normalized + (normalized && url.pathname.endsWith("/") ? "/" : "");
  } catch {
    // Invalid percent escapes, file URLs, or encoded Unicode are not inventory
    // dependencies; never turn malformed authored references into file reads.
    return null;
  }
}

// Deliberately limited to authored static references. Template candidates are
// listed separately; arbitrary JavaScript expressions are never evaluated.
export function referencesIn(source, filename) {
  const refs = [];
  const add = (reference, kind, base = filename) => refs.push({ reference, kind, base });
  const js = text => {
    for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) {
      const reference = match[1] ?? match[2];
      add(reference, "module");
    }
    for (const match of text.matchAll(/new\s+URL\(\s*(["'`])([^"'`]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      add(match[2], match[2].includes("${") ? "template-candidate" : "module-url");
    }
    for (const match of text.matchAll(/["']((?:\.{1,2}\/|\/)[^"'\n]+\.(?:wasm|wav|mp3|ogg|webp|glb))["']/g)) {
      add(match[1], "literal-asset-candidate");
    }
  };
  if (/\.html$/.test(filename)) {
    const clean = source.replace(/<!--[\s\S]*?-->/g, "");
    for (const match of clean.matchAll(/<(script|link|img|audio|video|source)\b([^>]+)>/gi)) {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]));
      const tag = match[1].toLowerCase();
      if (tag === "link" && !/\b(?:stylesheet|icon|preload|modulepreload)\b/.test(attrs.rel ?? "")) continue;
      if (attrs.src ?? attrs.href) add(attrs.src ?? attrs.href, tag === "script" ? "entry-script" : "page-asset");
      if (attrs.poster) add(attrs.poster, "page-asset");
    }
    for (const match of clean.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) js(match[1]);
  } else if (/\.(?:m?js)$/.test(filename)) js(source);
  if (/\.(?:css|html)$/.test(filename)) {
    for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/g)) add(match[1] ?? match[2], "css-asset");
  }
  return refs;
}

async function templateCandidates(reference, from) {
  const firstExpression = reference.indexOf("${");
  const slash = reference.lastIndexOf("/", firstExpression);
  if (slash < 0 || reference.slice(0, slash).includes("${")) return [];
  const directory = localPath(reference.slice(0, slash + 1), from);
  if (directory === null) return [];
  const pattern = reference.slice(slash + 1).split(/\$\{[^}]+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+");
  const matcher = new RegExp(`^${pattern}$`);
  return (await readdir(absolute(directory), { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isFile() && matcher.test(entry.name)).map(entry => `${directory}${entry.name}`).sort();
}

async function walk(directory) {
  const entries = await readdir(absolute(directory), { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? walk(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]));
  return files.flat().sort();
}

export async function inspectInstrument(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? "")) throw new Error("Use a catalogue ID, for example: puggler");
  const instrument = instrumentById(id);
  if (!instrument) throw new Error(`Unknown instrument ID: ${id}. Available IDs: ${INSTRUMENTS.map(i => i.id).sort().join(", ")}`);
  const route = localPath(instrument.href, "index.html");
  if (route === null) throw new Error(`Instrument ${id} has an external route: ${instrument.href}`);
  const page = route.endsWith("/") || !path.extname(route) ? `${route}${route.endsWith("/") ? "" : "/"}index.html` : route;
  const icon = localPath(instrument.imageHref, "index.html");
  const tracked = new Set(git("ls-files", "-z").split("\0"));
  const relatedAssets = await walk(`assets/${id}`);
  const pending = [page, ...(icon ? [icon] : []), ...relatedAssets];
  const seen = new Set(), edges = [], files = [], external = [], unresolvedTemplates = [];
  while (pending.length) {
    const filename = pending.shift();
    if (seen.has(filename)) continue;
    seen.add(filename);
    const present = await exists(filename);
    const waxPath = `dist-wax/${filename}`;
    const waxPresent = await exists(waxPath);
    let wax = waxPresent ? "source-missing" : "missing";
    if (present && waxPresent) {
      const [source, packaged] = await Promise.all([readFile(absolute(filename)), readFile(absolute(waxPath))]);
      // Build transforms some HTML/JS (WAX injection and cache fingerprints).
      // A difference is an observation, not a claim that output is stale.
      wax = source.equals(packaged) ? "identical" : "different: inspect build transforms or run check:wax-dist";
    }
    files.push({ path: filename, present, tracked: tracked.has(filename), wax });
    if (!present || !/\.(?:html|css|m?js)$/.test(filename)) continue;
    const source = await readFile(absolute(filename), "utf8");
    for (const ref of referencesIn(source, filename)) {
      if (ref.kind === "template-candidate") {
        const candidates = await templateCandidates(ref.reference, ref.base);
        if (!candidates.length) unresolvedTemplates.push({ from: filename, reference: ref.reference });
        for (const target of candidates) { edges.push({ from: filename, to: target, kind: ref.kind, reference: ref.reference }); pending.push(target); }
      } else {
        if (ref.kind === "module" && !/^(?:\.{1,2}\/|\/)/.test(ref.reference)) {
          external.push({ from: filename, reference: ref.reference }); continue;
        }
        const target = localPath(ref.reference, ref.base);
        if (target === null) { if (!/^(?:#|data:|blob:)/.test(ref.reference)) external.push({ from: filename, reference: ref.reference }); continue; }
        if (!path.extname(target)) continue;
        edges.push({ from: filename, to: target, kind: ref.kind }); pending.push(target);
      }
    }
  }
  for (const file of files) file.discoveredBy = sorted([
    ...edges.filter(edge => edge.to === file.path).map(edge => edge.kind),
    ...(file.path === page || file.path === icon ? ["registry"] : []),
    ...(relatedAssets.includes(file.path) ? ["related-asset-directory"] : []),
  ]);
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  edges.sort((a, b) => `${a.from}:${a.to}:${a.kind}`.localeCompare(`${b.from}:${b.to}:${b.kind}`, "en"));
  const entries = edges.filter(e => e.from === page && ["entry-script", "module"].includes(e.kind)).map(e => e.to);
  const stems = sorted([id, ...files.map(f => f.path).filter(p => !p.includes("/") && p.endsWith("-app.js")).map(p => p.replace(/-app\.js$/, ""))]);
  const domainFiles = files.map(f => f.path).filter(p => stems.some(stem => path.basename(p).startsWith(`${stem}.`) || path.basename(p).startsWith(`${stem}-`)) || (page.includes("/") && p.startsWith(`${path.dirname(page)}/`)));
  const testFiles = (await Promise.all([walk("tests"), walk("e2e"), walk("morphazoidical/tests")])).flat().filter(p => /\.(?:test|spec)\.mjs$/.test(p));
  const focusedTests = [];
  for (const filename of testFiles) {
    const source = await readFile(absolute(filename), "utf8");
    if (domainFiles.some(p => source.includes(p)) || stems.some(stem => path.basename(filename).startsWith(`${stem}.`) || path.basename(filename).startsWith(`${stem}-`)) || (page.startsWith("morphazoidical/") && filename.startsWith("morphazoidical/tests/"))) focusedTests.push(filename);
  }
  const packageJson = JSON.parse(await readFile(absolute("package.json"), "utf8"));
  const nodeTests = focusedTests.filter(p => p.includes(".test."));
  const browserTests = focusedTests.filter(p => p.includes(".spec."));
  const packageCommands = Object.fromEntries(["dev", "verify", "build:wax", "check:wax-dist", "build:site", "test:browser:smoke", "test:browser:audio", "test:browser:midi", "test:browser:audit"].filter(name => packageJson.scripts[name]).map(name => [`npm run ${name}`, packageJson.scripts[name]]));
  return {
    id, context: { repositoryRoot, invocationDirectory: process.cwd(), node: process.version, executable: process.execPath, branch: git("branch", "--show-current"), commit: git("rev-parse", "--short", "HEAD"), dirty: Boolean(git("status", "--porcelain")), dependenciesInstalled: await stat(absolute("node_modules")).then(s => s.isDirectory(), () => false) },
    registration: { page, navigation: TOOL_GROUPS.filter(g => g.tools.some(t => t.id === id)).map(g => ({ id: g.id, label: g.label })), catalog: instrument, capability: instrumentMidiCapabilityForId(id) },
    entries: sorted(entries), files, edges, external, unresolvedTemplates,
    relatedAssets,
    tests: { candidates: focusedTests, shared: ["tests/instrument-catalog.test.mjs", "tests/nav.test.mjs", "tests/browser-midi-adapter.test.mjs"] },
    commands: { workingDirectory: repositoryRoot, focusedNode: nodeTests.length ? `${shellQuote(process.execPath)} --test ${nodeTests.map(shellQuote).join(" ")}` : null, focusedBrowser: browserTests.length ? `npm run test:browser -- ${browserTests.map(shellQuote).join(" ")}` : null, package: packageCommands },
    limits: ["Static HTML, CSS, ES imports, and new URL(..., import.meta.url) only; computed fetch/worklet/worker paths and runtime-selected modules require source/browser inspection.", "Templates list matching on-disk candidates; quoted binary assets are module-relative candidates. Neither proves loading or runtime URL resolution. External references are not fetched. Test candidates are discovery hints, not coverage proof.", "WAX comparison is byte-level and read-only; transformed differences can be expected. Only check:wax-dist verifies a fresh full build. Tracked status alone does not prove build-site.sh includes an asset type.", "Run commands from commands.workingDirectory with this Node executable's directory on PATH. No build, test, server, install, or Git mutation was performed."],
  };
}

function render(report) {
  const { context, registration } = report;
  const lines = [
    `${registration.catalog.label} (${report.id})`,
    `Repository: ${context.repositoryRoot} | ${context.branch || "detached"} @ ${context.commit}${context.dirty ? " (dirty)" : ""}`,
    `Node: ${context.node} at ${context.executable}; node_modules: ${context.dependenciesInstalled ? "present" : "absent"}`,
    `Page: ${registration.page}; entries: ${report.entries.join(", ") || "inline/none"}`,
    `Groups: ${registration.navigation.map(g => g.id).join(", ")}; status label: ${registration.catalog.status ?? "none"}`,
    `Capabilities (declared): ${JSON.stringify(registration.capability)}`,
    "", "Discovered files: source | tracked | WAX | path [discovery method]",
    ...report.files.map(f => `${f.present ? "present" : "MISSING"} | ${f.tracked ? "yes" : "no"} | ${f.wax} | ${f.path} [${f.discoveredBy.join(", ")}]`),
    "", `Related asset directory (includes credits): ${report.relatedAssets.join(", ") || "none"}`,
    ...report.external.map(ref => `External: ${ref.from} -> ${ref.reference}`),
    ...report.unresolvedTemplates.map(ref => `Unresolved template: ${ref.from} -> ${ref.reference}`),
    "", "Commands to select after reviewing the change (not executed):", `cd ${shellQuote(context.repositoryRoot)}`,
    ...(report.commands.focusedNode ? [report.commands.focusedNode] : []),
    ...(report.commands.focusedBrowser ? [report.commands.focusedBrowser] : []),
    ...Object.entries(report.commands.package).map(([name, command]) => `${name}  # ${command}`),
    "", ...report.limits,
    "Use --json for dependency edges and test candidates.",
  ];
  return lines.join("\n");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.length === 0) {
    console.log("Usage: node scripts/inspect-instrument.mjs <catalogue-id> [--json]\nRead-only page inventory; resolves the checkout from this script, independent of cwd.");
    process.exitCode = args.length === 0 ? 2 : 0;
  } else {
    try {
      if (args.length > 2 || args.slice(1).some(arg => arg !== "--json")) throw new Error("Usage: inspect-instrument.mjs <catalogue-id> [--json]");
      const report = await inspectInstrument(args[0]);
      console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : render(report));
    } catch (error) { console.error(error.message); process.exitCode = 2; }
  }
}

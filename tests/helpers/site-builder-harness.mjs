import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { bashPath } from "../../scripts/build-wax-site.mjs";

const exec = promisify(execFile);
const root = new URL("../../", import.meta.url);

export async function legacyBuilderInventory() {
  const source = await readFile(new URL("../fixtures/site-builder-v1.sh", import.meta.url), "utf8");
  const copyBlock = source.match(/for worktree_runtime_file in \\\n([\s\S]*?)\ndo/u)?.[1];
  const requiredBlock = source.match(/required_files=\(\n([\s\S]*?)\n\)/u)?.[1];
  assert.ok(copyBlock && requiredBlock, "frozen legacy inventory is intact");
  return {
    source,
    copy: ["assets/authors/kristin-galvin.png", ...copyBlock.replaceAll("\\\n", "\n").trim().split(/\s+/u)],
    required: requiredBlock.trim().split(/\s+/u),
  };
}

// This historical inventory belongs to the test fixture, not the current
// product catalogue. Future approved file moves do not rewrite the old fixture.
export function historicalManifest({ copy, required }) {
  const allowed = new Set(copy);
  const mandatory = new Set(required);
  return [
    ...required.map(file => `${allowed.has(file) ? "copy+require" : "require"}\t${file}`),
    ...copy.filter(file => !mandatory.has(file)).map(file => `copy\t${file}`),
  ].join("\n") + "\n";
}

export async function fileHashes(directory, prefix = "") {
  const hashes = {};
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(hashes, await fileHashes(directory, relative));
    else if (entry.isFile()) {
      hashes[relative] = createHash("sha256").update(await readFile(path.join(directory, relative))).digest("hex");
    }
  }
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}

export async function createSiteBuilderHarness({ absent = [], untrackedRequired = [] } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "morphazoid build fixture "));
  const legacy = await legacyBuilderInventory();
  const absentSet = new Set(absent);
  const allowed = new Set(legacy.copy);
  const tracked = legacy.required.filter(file => !allowed.has(file) && !untrackedRequired.includes(file) && !absentSet.has(file));
  const extras = [
    "assets/authors/kristin-galvin.png", "src/spider-synth-audio.js",
    "untracked-not-allowlisted.js", "src/nested/new-controller.js",
    "assets/instruments/untracked-review.webp",
    "assets/spider-synth/skins/untracked/model.glb",
    "assets/spider-synth/skins/untracked/unsupported.bin",
    "assets/audio/spider-synth/untracked.wav",
    "src/xyflow/private.js", "scripts/private.js", "tests/private.js",
    ".github/private.js", "README.md", "package.json",
  ];
  const write = async (file, contents) => {
    const target = path.join(directory, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  };
  try {
    for (const file of new Set([...legacy.required, ...extras])) {
      if (!absentSet.has(file)) await write(file, Buffer.from(`fixture:${file}\n\0binary-preserved\n`));
    }
    await write("package.json", '{"private":true,"type":"module"}\n');
    // Git only supplies the tracked-file inventory. No fixture commit is made.
    await exec("git", ["init", "-q"], { cwd: directory });
    await exec("git", ["add", "--force", "--", ...tracked,
      "src/nested/new-controller.js", "src/xyflow/private.js",
      "scripts/private.js", "tests/private.js", ".github/private.js",
      "README.md", "package.json",
    ], { cwd: directory });
    await write("scripts/site/runtime-manifest.mjs", await readFile(new URL("scripts/site/runtime-manifest.mjs", root)));
    await write("scripts/site/runtime-files.tsv", historicalManifest(legacy));
    // This fixture compares file-selection/copy semantics, not the later social
    // metadata transform. Its real implementation has dedicated production
    // tests; still exercise the hook invocation without rewriting fake HTML.
    await write("scripts/social-preview.mjs", 'console.log("fixture social metadata hook");\n');
    const current = await readFile(new URL("scripts/build-site.sh", root));
    return {
      directory, legacy, write,
      async build(version, outputName = version) {
        await write("scripts/build-site.sh", version === "legacy" ? legacy.source : current);
        const output = path.join(directory, outputName);
        try {
          const result = await exec("bash", [
            "scripts/build-site.sh", bashPath(output), bashPath(directory),
          ], { cwd: directory });
          return { ...result, output, code: 0 };
        } catch (error) {
          return { output, code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
        }
      },
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const liveDirectory = path.join(projectRoot, "assets", "instruments");
const variantsRoot = path.join(projectRoot, "artwork", "instrument-icon-variants");
const manifestPath = path.join(variantsRoot, "CATALOGUE-MIX.json");
const correctedSeries = new Map([
  ["graph-delay", /^round-6-/],
  ["lumber", /^round-6-/],
  ["micmic", /^round-6-/],
  ["throatazoid", /^round-(4|5|6)-/],
]);
const pinnedVariants = new Map([
  ["candy-coil-delay", "round-2-v1.webp"],
  ["shepard-risset", "round-2-v1.webp"],
  ["striped-sludge-delay", "round-2-v1.webp"],
]);

function parseArguments(argv) {
  let dryRun = false;
  let seed;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--seed") {
      const value = argv[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error("--seed requires a non-negative integer");
      }
      seed = Number(value) >>> 0;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return {
    dryRun,
    seed: seed ?? crypto.randomBytes(4).readUInt32LE(0),
  };
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function categoryFor(filename) {
  if (filename.includes("fuzzy")) return "fuzzy";
  if (filename.includes("digital") || filename.includes("matrix") || filename.includes("tesla")) {
    return "digital";
  }
  if (filename.includes("anatom") || filename.includes("vocal") || filename.includes("signal")) {
    return "anatomical";
  }
  if (filename.includes("psychedelic") || filename.includes("acid-test")) return "psychedelic";
  if (filename.includes("op-art")) return "op-art";
  return "special";
}

function variantFilesFor(slug) {
  const directory = path.join(variantsRoot, slug);
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter((filename) => filename.endsWith(".webp") && filename !== "catalogue-current.webp")
    .filter((filename) => correctedSeries.get(slug)?.test(filename) ?? true)
    .sort();
}

function chooseVariants(slugs, random) {
  const categoryCounts = new Map();
  const choices = new Map();

  for (const slug of shuffle(slugs, random)) {
    const filenames = variantFilesFor(slug);
    if (filenames.length === 0) continue;

    const byCategory = new Map();
    for (const filename of filenames) {
      const category = categoryFor(filename);
      const categoryFiles = byCategory.get(category) ?? [];
      categoryFiles.push(filename);
      byCategory.set(category, categoryFiles);
    }

    const categories = [...byCategory.keys()];
    const smallestCount = Math.min(...categories.map((category) => categoryCounts.get(category) ?? 0));
    const leastUsed = categories.filter(
      (category) => (categoryCounts.get(category) ?? 0) === smallestCount,
    );
    const category = leastUsed[Math.floor(random() * leastUsed.length)];
    const candidates = byCategory.get(category);
    const filename = candidates[Math.floor(random() * candidates.length)];

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    choices.set(slug, { category, filename, pinned: false });
  }

  for (const [slug, filename] of pinnedVariants) {
    if (!slugs.includes(slug)) continue;
    if (!variantFilesFor(slug).includes(filename)) {
      throw new Error(`Pinned variant is unavailable: ${slug}/${filename}`);
    }
    choices.set(slug, { category: categoryFor(filename), filename, pinned: true });
  }

  categoryCounts.clear();
  for (const { category } of choices.values()) {
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  return { categoryCounts, choices };
}

function main() {
  const { dryRun, seed } = parseArguments(process.argv.slice(2));
  const random = createRandom(seed);
  const slugs = fs
    .readdirSync(liveDirectory)
    .filter((filename) => filename.endsWith(".webp"))
    .map((filename) => path.basename(filename, ".webp"))
    .sort();
  const { categoryCounts, choices } = chooseVariants(slugs, random);

  const selections = slugs.map((slug) => {
    const choice = choices.get(slug);
    if (!choice) {
      return {
        instrument: slug,
        status: "unchanged-no-alternative",
        source: `assets/instruments/${slug}.webp`,
      };
    }

    const relativeSource = path.posix.join(
      "artwork/instrument-icon-variants",
      slug,
      choice.filename,
    );
    if (!dryRun) {
      fs.copyFileSync(path.join(projectRoot, relativeSource), path.join(liveDirectory, `${slug}.webp`));
    }

    return {
      instrument: slug,
      status: "selected",
      category: choice.category,
      pinned: choice.pinned,
      source: relativeSource,
      destination: `assets/instruments/${slug}.webp`,
    };
  });

  const categorySummary = Object.fromEntries([...categoryCounts.entries()].sort());
  const manifest = {
    seed,
    selectionMethod:
      "random among each instrument's least-represented available style categories, with explicit family pins",
    categoryCounts: categorySummary,
    selected: choices.size,
    unchanged: slugs.length - choices.size,
    selections,
  };

  if (!dryRun) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(`${dryRun ? "Preview" : "Applied"} catalogue mix with seed ${seed}.`);
  console.log(`Selected ${choices.size}; unchanged ${slugs.length - choices.size}.`);
  console.log(`Styles: ${JSON.stringify(categorySummary)}`);
  for (const selection of selections) {
    if (selection.status === "selected") {
      const pin = selection.pinned ? " [pinned]" : "";
      console.log(`${selection.instrument}: ${selection.category}${pin} <- ${path.basename(selection.source)}`);
    }
  }
}

main();

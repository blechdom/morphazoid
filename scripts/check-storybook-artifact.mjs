import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.resolve(repositoryRoot, process.argv[2] ?? "dist/storybook");
const requiredFiles = ["index.html", "iframe.html", "index.json"];
const requiredStories = [
  "patterns-audio-controls--header-audio",
  "patterns-audio-controls--lifecycle",
  "primitives-button--mini-action",
  "primitives-button--play-trigger",
  "primitives-range-field--minimum",
];

for (const file of requiredFiles) {
  const details = await stat(path.join(artifactDirectory, file));
  if (!details.isFile()) throw new Error(`Storybook artifact is missing ${file}`);
}

const index = JSON.parse(await readFile(path.join(artifactDirectory, "index.json"), "utf8"));
const entries = Object.values(index.entries ?? {});
if (!entries.length) throw new Error("Storybook index.json contains no catalog entries");

for (const id of requiredStories) {
  if (!entries.some((entry) => entry.id === id)) {
    throw new Error(`Storybook artifact is missing required story ${id}`);
  }
}

console.log(
  `Verified Storybook artifact: ${entries.length} entries in ${artifactDirectory}`,
);

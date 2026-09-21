import {
  decodeUtauText,
  normalizeUtauPath,
  parseUtauCharacter,
  parseUtauFrq,
  parseUtauOto,
} from "./vocalzoid.js";
import {
  VOCALZOID_MAX_BANK_BYTES,
  VOCALZOID_MAX_BANK_FILES,
} from "./vocalzoid-audio.js";

const AUDIO_FILE_PATTERN = /\.(?:wav|wave|aif|aiff|flac|ogg)$/i;
const TEXT_FILE_PATTERN = /(?:^|\/)(?:oto\.ini|character\.txt)$/i;
const FRQ_FILE_PATTERN = /_wav\.frq$/i;

function sourcePath(file) {
  return String(file?.webkitRelativePath || file?.name || "").replaceAll("\\", "/");
}

function safePath(file) {
  const path = sourcePath(file);
  if (!path || path.split("/").some((part) => part === "..")) return "";
  return normalizeUtauPath(path);
}

function dirname(path) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

async function readBytes(file) {
  if (typeof file?.arrayBuffer !== "function") {
    throw new TypeError(`Cannot read ${file?.name || "voicebank file"}.`);
  }
  return file.arrayBuffer();
}

function median(values, fallback = 60) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return fallback;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function matchingFile(files, requestedPath) {
  const normalized = normalizeUtauPath(requestedPath);
  if (files.has(normalized)) return true;
  const suffix = `/${normalized}`;
  return [...files.keys()].some((path) => path.endsWith(suffix));
}

export async function loadUtauBankFiles(input) {
  const selected = [...(input ?? [])].filter((file) => safePath(file));
  if (!selected.length) throw new Error("Choose an extracted UTAU bank folder.");
  if (selected.length > VOCALZOID_MAX_BANK_FILES) {
    throw new Error(`That folder has more than ${VOCALZOID_MAX_BANK_FILES.toLocaleString()} files.`);
  }
  const totalBytes = selected.reduce((sum, file) => sum + Math.max(0, Number(file.size) || 0), 0);
  if (totalBytes > VOCALZOID_MAX_BANK_BYTES) {
    throw new Error("That folder is larger than Vocalzoid’s 512 MB browser safety limit.");
  }

  const paths = new Map(selected.map((file) => [safePath(file), file]));
  const audioFiles = new Map([...paths].filter(([path]) => AUDIO_FILE_PATTERN.test(path)));
  const otoFiles = [...paths].filter(([path]) => /(?:^|\/)oto\.ini$/i.test(path));
  if (!otoFiles.length) throw new Error("No oto.ini was found in that folder.");
  if (!audioFiles.size) throw new Error("No WAV or compatible audio samples were found.");

  const entryGroups = await Promise.all(otoFiles.map(async ([path, file]) => {
    const text = decodeUtauText(await readBytes(file));
    return parseUtauOto(text, { directory: dirname(path) });
  }));
  const entries = entryGroups.flat();
  if (!entries.length) throw new Error("The oto.ini files contain no readable sample entries.");

  const characterFile = [...paths].find(([path]) => /(?:^|\/)character\.txt$/i.test(path));
  const character = characterFile
    ? parseUtauCharacter(decodeUtauText(await readBytes(characterFile[1])))
    : Object.freeze({});

  const frqFiles = [...paths].filter(([path]) => FRQ_FILE_PATTERN.test(path));
  const sourceMidiByPath = new Map();
  await Promise.all(frqFiles.map(async ([path, file]) => {
    try {
      const frq = parseUtauFrq(await readBytes(file));
      if (!frq) return;
      sourceMidiByPath.set(path.replace(FRQ_FILE_PATTERN, ".wav"), frq.midi);
    } catch {}
  }));

  const matchedEntries = entries.filter((entry) => matchingFile(audioFiles, entry.path));
  if (!matchedEntries.length) {
    throw new Error("The oto.ini entries do not point to any selected audio samples.");
  }
  const rootFolder = safePath(selected[0]).split("/")[0] || "Local UTAU bank";
  const name = character.name || rootFolder || "Local UTAU bank";
  return Object.freeze({
    name,
    author: character.author || character.voice || "Unknown voice author",
    web: character.web || "",
    entries: Object.freeze(matchedEntries),
    files: audioFiles,
    sourceMidiByPath,
    rootMidi: median([...sourceMidiByPath.values()], 60),
    stats: Object.freeze({
      selectedFiles: selected.length,
      audioFiles: audioFiles.size,
      otoFiles: otoFiles.length,
      entries: matchedEntries.length,
      missingEntries: entries.length - matchedEntries.length,
      frqFiles: sourceMidiByPath.size,
      bytes: totalBytes,
    }),
  });
}

export function utauBankAliases(bank) {
  return [...new Set((bank?.entries ?? []).map((entry) => entry.alias))]
    .sort((left, right) => left.localeCompare(right));
}

export function vocalzoidAcceptedBankFiles(input) {
  return [...(input ?? [])].filter((file) => {
    const path = safePath(file);
    return AUDIO_FILE_PATTERN.test(path)
      || TEXT_FILE_PATTERN.test(path)
      || FRQ_FILE_PATTERN.test(path);
  });
}

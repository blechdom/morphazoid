export const PLUGIN_CATALOG_SCHEMA_VERSION = 1;

const freezeArtifact = (artifact) => Object.freeze({
  ...artifact,
  platforms: Object.freeze([...artifact.platforms]),
  testedOn: Object.freeze([...artifact.testedOn]),
});

const freezeRelease = (release) => Object.freeze({
  ...release,
  changes: Object.freeze([...release.changes]),
  artifacts: Object.freeze(release.artifacts.map(freezeArtifact)),
});

const freezePlugin = (plugin) => Object.freeze({
  ...plugin,
  capabilities: Object.freeze([...plugin.capabilities]),
  plannedFormats: Object.freeze([...plugin.plannedFormats]),
  releases: Object.freeze(plugin.releases.map(freezeRelease)),
});

/**
 * Public plug-in release catalog.
 *
 * Instrument IDs and download URLs are permanent. New builds append a release;
 * they never replace a file at an existing versioned URL. The website version,
 * DSP contract version, and each plug-in format version remain independent.
 */
export const PLUGIN_CATALOG = Object.freeze([
  freezePlugin({
    id: "chaotic-fm",
    name: "Chaotic FM",
    family: "Chaotic Synths",
    demoHref: "chaotic-fm.html",
    status: "available",
    stage: "Beta",
    voiceMode: "Monophonic",
    summary:
      "A bounded nonlinear FM cascade in which each oscillator drives the next oscillator’s signed frequency.",
    capabilities: [
      "MIDI notes and pitch bend",
      "ADSR and portamento",
      "Five factory presets",
      "Twenty-seven automatable parameters",
      "Live spectrum and oscilloscope",
      "REAPER clock sync and rhythmic latch",
    ],
    plannedFormats: ["VST3 with custom editor", "CLAP"],
    releases: [
      {
        version: "0.3.0",
        releasedAt: "2026-08-04",
        channel: "beta",
        recommended: true,
        changes: [
          "Adds host-tempo Carrier divisions from eight bars through 1/64 note with straight, dotted, and triplet feel.",
          "Adds deterministic Song, Transport, Note, and Free phase sources plus a one-cycle phase offset.",
          "Adds independent Hold and Slew rhythmic latching without resetting the recursive oscillator stack.",
          "Appends eight automatable timing parameters while preserving the original nineteen parameter IDs.",
        ],
        artifacts: [
          {
            id: "reaper-jsfx",
            format: "REAPER JSFX",
            version: "0.3.0",
            href: "downloads/plugins/chaotic-fm/0.3.0/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
            downloadName: "Morphazoid_Chaotic_FM-v0.3.0.jsfx",
            bytes: 47819,
            sha256: "e5550cc4fafd95ba7b5d56fd9e43db717e83c554acb216ea3cb3946fa35fbeee",
            architecture: "REAPER-native script",
            minimumHost: "REAPER 7",
            platforms: ["Linux", "macOS", "Windows"],
            testedOn: ["Linux x86-64", "REAPER 7.62"],
          },
        ],
      },
      {
        version: "0.2.3",
        releasedAt: "2026-08-04",
        channel: "archive",
        recommended: false,
        changes: [
          "Makes the branded analyzer and custom controls the primary REAPER interface.",
          "Hides all nineteen built-in slider rows while keeping them active and automatable.",
          "Preserves every parameter index and v0.2.2 control-synchronization correction.",
        ],
        artifacts: [
          {
            id: "reaper-jsfx",
            format: "REAPER JSFX",
            version: "0.2.3",
            href: "downloads/plugins/chaotic-fm/0.2.3/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
            downloadName: "Morphazoid_Chaotic_FM-v0.2.3.jsfx",
            bytes: 38525,
            sha256: "6a6bbc9d7e2f75d1f8788d1cf7188c9c7be01aa41c9ee1e490c9ee92778cfe5a",
            architecture: "REAPER-native script",
            minimumHost: "REAPER 7",
            platforms: ["Linux", "macOS", "Windows"],
            testedOn: ["Linux x86-64", "REAPER 7.62"],
          },
        ],
      },
      {
        version: "0.2.2",
        releasedAt: "2026-08-04",
        channel: "archive",
        recommended: false,
        changes: [
          "Synchronizes every custom interface control with the audio engine at block boundaries.",
          "Reapplies a factory preset when its visible preset button is selected again.",
          "Preserves all nineteen parameter indices for existing REAPER projects and automation.",
        ],
        artifacts: [
          {
            id: "reaper-jsfx",
            format: "REAPER JSFX",
            version: "0.2.2",
            href: "downloads/plugins/chaotic-fm/0.2.2/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
            downloadName: "Morphazoid_Chaotic_FM-v0.2.2.jsfx",
            bytes: 38506,
            sha256: "098935a1d6374ba1543b67b964cdf7f1a1a9a09eea2bfe5e56c3359f4cff5242",
            architecture: "REAPER-native script",
            minimumHost: "REAPER 7",
            platforms: ["Linux", "macOS", "Windows"],
            testedOn: ["Linux x86-64", "REAPER 7.62"],
          },
        ],
      },
      {
        version: "0.2.1",
        releasedAt: "2026-08-03",
        channel: "archive",
        recommended: false,
        changes: [
          "Initial REAPER JSFX proof with MIDI, ADSR, glide, presets, and layered live analysis.",
          "Archived for project archaeology; use v0.3.0 because custom FM controls may not synchronize reliably here.",
        ],
        artifacts: [
          {
            id: "reaper-jsfx",
            format: "REAPER JSFX",
            version: "0.2.1",
            href: "downloads/plugins/chaotic-fm/0.2.1/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
            downloadName: "Morphazoid_Chaotic_FM-v0.2.1.jsfx",
            bytes: 37868,
            sha256: "19b2c91603dd6ece7b2c31b92929dea62b37ae1cd84f974384ebbb5b528c5792",
            architecture: "REAPER-native script",
            minimumHost: "REAPER 7",
            platforms: ["Linux", "macOS", "Windows"],
            testedOn: ["Linux x86-64", "REAPER 7.62"],
          },
        ],
      },
    ],
  }),
  freezePlugin({
    id: "chaotic-pm",
    name: "Chaotic PM",
    family: "Chaotic Synths",
    demoHref: "chaotic-pm.html",
    status: "development",
    stage: "Browser MIDI contract",
    voiceMode: "Monophonic",
    summary:
      "A nonlinear phase cascade with independent frequency and phase-index division at every turn.",
    capabilities: [
      "Browser MIDI notes and pitch bend",
      "ADSR and portamento",
      "Shared factory performance CCs",
      "Live spectrum and oscilloscope",
    ],
    plannedFormats: ["REAPER JSFX", "VST3", "CLAP"],
    releases: [],
  }),
  freezePlugin({
    id: "recursive-fm",
    name: "Recursive FM",
    family: "Chaotic Synths",
    demoHref: "recursive-fm.html",
    status: "development",
    stage: "Browser MIDI contract",
    voiceMode: "Monophonic",
    summary:
      "A nested FM operator stack in which every level drives the frequency of the level below it.",
    capabilities: [
      "Browser MIDI notes and pitch bend",
      "ADSR and portamento",
      "Shared factory performance CCs",
      "Live spectrum and oscilloscope",
    ],
    plannedFormats: ["REAPER JSFX", "VST3", "CLAP"],
    releases: [],
  }),
  freezePlugin({
    id: "recursive-pm",
    name: "Recursive PM",
    family: "Chaotic Synths",
    demoHref: "recursive-pm.html",
    status: "development",
    stage: "Browser MIDI contract",
    voiceMode: "Monophonic",
    summary:
      "A carrier folded through recursively reduced phase operators with crossfaded depth changes.",
    capabilities: [
      "Browser MIDI notes and pitch bend",
      "ADSR and portamento",
      "Shared factory performance CCs",
      "Live spectrum and oscilloscope",
    ],
    plannedFormats: ["REAPER JSFX", "VST3", "CLAP"],
    releases: [],
  }),
]);

export function latestPluginRelease(plugin) {
  return plugin?.releases?.find((release) => release.recommended)
    ?? plugin?.releases?.[0]
    ?? null;
}

export function latestPluginArtifact(plugin, artifactId = "reaper-jsfx") {
  return latestPluginRelease(plugin)?.artifacts.find(
    (artifact) => artifact.id === artifactId,
  ) ?? null;
}

export function formatPluginBytes(bytes) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  if (safeBytes < 1024) return `${safeBytes} B`;
  return `${(safeBytes / 1024).toFixed(1)} KB`;
}

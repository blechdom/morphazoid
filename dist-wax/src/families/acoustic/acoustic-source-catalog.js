const BUILT_IN_KINDS = new Set(["procedural", "recording"]);

function freezeRecord(record) {
  return Object.freeze({ ...record });
}

function builtInSource(specification) {
  if (!specification?.id || !BUILT_IN_KINDS.has(specification.kind)) {
    throw new TypeError("Every acoustic source needs a unique id and a supported kind");
  }
  if (!specification.profileId || !specification.label || !specification.catalogGroup) {
    throw new TypeError(`Acoustic source "${specification.id}" is missing catalog metadata`);
  }
  if (specification.kind === "recording") {
    for (const field of ["assetPath", "attribution", "license", "sourceUrl", "sha256"]) {
      if (!specification[field]) {
        throw new TypeError(`Recording "${specification.id}" is missing ${field}`);
      }
    }
    if (!/^\.\/assets\/bioacoustics\/[a-z0-9-]+\.(?:ogg|wav)$/.test(specification.assetPath)) {
      throw new TypeError(`Recording "${specification.id}" must use a local Ogg or WAV asset`);
    }
    if (!/^[a-f0-9]{64}$/.test(specification.sha256)) {
      throw new TypeError(`Recording "${specification.id}" has an invalid SHA-256 digest`);
    }
  }
  return freezeRecord({
    access: specification.kind === "recording" ? "bundled" : "generated-locally",
    ...specification,
    technical: specification.technical ? freezeRecord(specification.technical) : undefined,
  });
}

const builtInSpecifications = [
  {
    id: "thrush-nightingale-synthetic",
    kind: "procedural",
    profileId: "songbird",
    catalogGroup: "Procedural studies",
    label: "Synthetic · thrush-nightingale sequence",
    description: "Locally generated 18-strophe acoustic sketch",
    generator: "nightingale-sequence",
    attribution: "Generated locally by Morphazoid",
    license: "Project-generated",
  },
  {
    id: "field-cricket-synthetic",
    kind: "procedural",
    profileId: "insect",
    catalogGroup: "Procedural studies",
    label: "Synthetic · field-cricket chirps",
    description: "Locally generated six-chirp stridulation sketch",
    generator: "field-cricket",
    attribution: "Generated locally by Morphazoid",
    license: "Project-generated",
  },
  {
    id: "thrush-nightingale",
    kind: "recording",
    profileId: "songbird",
    catalogGroup: "Songbirds",
    label: "Recording · thrush nightingale",
    commonName: "Thrush nightingale",
    scientificName: "Luscinia luscinia",
    assetPath: "./assets/bioacoustics/thrush-nightingale.ogg",
    attribution: "Oona Räisänen (Mysid), Southern Finland",
    license: "Public domain dedication",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Luscinia_luscinia.ogg",
    sha256: "f2d649e708e2d7ef48000b95d15f7318e37dc9c500683f06600f38cd88f16ba3",
    note: "Great Tit and Common Magpie are audible in the background.",
  },
  {
    id: "common-blackbird",
    kind: "recording",
    profileId: "songbird",
    catalogGroup: "Songbirds",
    label: "Recording · common blackbird",
    commonName: "Common blackbird",
    scientificName: "Turdus merula",
    assetPath: "./assets/bioacoustics/common-blackbird.ogg",
    attribution: "Oona Räisänen (Mysid), Southern Finland",
    license: "Public domain dedication",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Turdus_merula_2.ogg",
    sha256: "2e713300a07d50b9cad26bb0f7b5d5bdce148ab062b56922ee3dd95fab54ec9f",
    note: "Car noise was reduced by the recordist.",
  },
  {
    id: "chaffinch",
    kind: "recording",
    profileId: "songbird",
    catalogGroup: "Songbirds",
    label: "Recording · chaffinch",
    commonName: "Chaffinch",
    scientificName: "Fringilla coelebs",
    assetPath: "./assets/bioacoustics/chaffinch.ogg",
    attribution: "Oona Räisänen (Mysid), Southern Finland",
    license: "Public domain dedication",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Fringilla_coelebs_short.ogg",
    sha256: "8fa1fcfabb37d1e19b4868fdd24642433b89e7f984f43ab2a48613d320944d6b",
    note: "Filtered by the recordist.",
  },
  {
    id: "house-cricket",
    kind: "recording",
    profileId: "insect",
    catalogGroup: "Insects",
    label: "Recording · house cricket",
    commonName: "House cricket",
    scientificName: "Acheta domesticus",
    assetPath: "./assets/bioacoustics/house-cricket.ogg",
    attribution: "Wikimedia Commons user Morray",
    license: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Acheta-domesticus-Stridulation.ogg",
    sha256: "dd444923577c13278e940fce9d70f40d098801d25730ce8698001a073c7c4576",
  },
  {
    id: "field-cricket",
    kind: "recording",
    profileId: "insect",
    catalogGroup: "Insects",
    label: "Recording · field cricket",
    commonName: "Field cricket",
    scientificName: "Gryllus pennsylvanicus",
    assetPath: "./assets/bioacoustics/field-cricket.ogg",
    attribution: "Wikimedia Commons user Thatcher",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Field_cricket_unedited.ogg",
    sha256: "aad6ef2a0d99ca0c2ed247147ff8ec4ac9372a37d1156d176634d13b31f5004e",
    note: "The source notes slight room reverberation.",
  },
  {
    id: "european-field-cricket",
    kind: "recording",
    profileId: "insect",
    catalogGroup: "Insects",
    label: "Recording · European field cricket",
    commonName: "European field cricket",
    scientificName: "Gryllus campestris",
    assetPath: "./assets/bioacoustics/european-field-cricket.ogg",
    attribution: "Baudewijn Odé",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Gryllus_campestris_-_sound.ogg",
    sha256: "7774774bdc468b07e3d19fabcb4064e9453aaaa3c64998a50f7788688e788b8c",
    note: "Originally issued with Kleukers & Krekels, Grasshoppers and Crickets of the Netherlands.",
  },
  {
    id: "coyote-chorus",
    kind: "recording",
    profileId: "coyote-group-yip-howl",
    catalogGroup: "Terrestrial mammals",
    label: "Recording · coyote group yip-howls",
    commonName: "Coyote group",
    scientificName: "Canis latrans",
    assetPath: "./assets/bioacoustics/coyote-chorus.ogg",
    attribution: "Rybkovich, Ventura County, California",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Pack_of_coyotes_howling.ogg",
    sha256: "3fb5173136261c18a4c2026cef56c2563ee7088ebd47b3f42288c1e1d88dd8c0",
    recordedAt: "2021-06-09",
    location: "Ventura County, California, United States",
    technical: { sampleRate: 96_000, channels: 2, container: "Ogg Vorbis" },
    note: "A 44-second nighttime field recording of multiple animals; group size is not inferred.",
  },
  {
    id: "frog-soundscape",
    kind: "recording",
    profileId: "frog",
    catalogGroup: "Amphibians",
    label: "Recording · frog night chorus",
    commonName: "Pobblebonk and motorbike frogs",
    scientificName: "Limnodynastes spp.",
    assetPath: "./assets/bioacoustics/frog-soundscape.ogg",
    attribution: "Hughesdarren, Lake Seppings, Western Australia",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Frog_sounds.ogg",
    sha256: "fa4751ebba9b3cf87f13aac1640a653bdbacacdcbf4ce91c16152f83c861ee44",
    recordedAt: "2016-12-12",
    location: "Lake Seppings, Western Australia",
    technical: { sampleRate: 44_100, channels: 1, container: "Ogg Vorbis" },
    note: "A mixed chorus soundscape, not a verified single-species exemplar.",
  },
  {
    id: "dolphin-vocalizations",
    kind: "recording",
    profileId: "dolphin-whistle",
    catalogGroup: "Marine mammals",
    label: "Recording · dolphin vocalizations",
    commonName: "Dolphins (unidentified delphinids)",
    scientificName: "Delphinidae spp.",
    assetPath: "./assets/bioacoustics/dolphin-vocalizations.wav",
    attribution: "Félix Blume, Caribbean coast of Quintana Roo, Mexico",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:161691_felixblume_dolphin-screaming-underwater-in-caribbean-sea-mexico.wav",
    sha256: "bb98f461869b359b30d51146b8bf164bd77bf216e8c4d1e76e24ea896bb8e62b",
    recordedAt: "2012-07",
    location: "Near Punta Allen, Quintana Roo, Mexico",
    technical: { sampleRate: 48_000, bitDepth: 24, channels: 1, sensor: "Aquarian H2a-XLR hydrophone" },
    note: "The archive does not identify a dolphin species. At 48 kHz this source cannot contain the selected profile above 24 kHz.",
  },
  {
    id: "humpback-whale-song",
    kind: "recording",
    profileId: "humpback-social",
    catalogGroup: "Marine mammals",
    label: "Recording · humpback whale song",
    commonName: "Humpback whale",
    scientificName: "Megaptera novaeangliae",
    assetPath: "./assets/bioacoustics/humpback-whale-song.ogg",
    attribution: "Wikimedia Commons user Spyrogumas",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Humpbackwhale2.ogg",
    sha256: "cf05e8aa82b3e0296a6fa83a464ee179a8c0e462270493d35af4019c545d5f04",
    technical: { sampleRate: 48_000, channels: 1, container: "Ogg Vorbis" },
    note: "A song excerpt. The suggested event profile does not recover humpback unit → phrase → theme hierarchy.",
  },
  {
    id: "killer-whale-call",
    kind: "recording",
    profileId: "killer-whale-call",
    catalogGroup: "Marine mammals",
    label: "Recording · killer-whale calls",
    commonName: "Killer whale",
    scientificName: "Orcinus orca",
    assetPath: "./assets/bioacoustics/killer-whale-call.ogg",
    attribution: "National Park Service, Glacier Bay, Alaska",
    license: "Public domain · U.S. National Park Service",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Killer_whale_simple.ogg",
    sha256: "aa5ced7ff51d77057df43a60f376078cd481a846c8cb7422fb319437efddefbb",
    location: "Glacier Bay, Alaska, United States",
    technical: { sampleRate: 44_100, channels: 1, sensor: "anchored hydrophone", container: "Ogg Vorbis" },
    note: "The location permits more than one ecotype; the recording does not establish caller identity or call meaning.",
  },
  {
    id: "blue-whale-south-pacific",
    kind: "recording",
    profileId: "blue-whale-tonal",
    catalogGroup: "Marine mammals",
    label: "Recording · South Pacific blue whale",
    commonName: "Blue whale",
    scientificName: "Balaenoptera musculus",
    assetPath: "./assets/bioacoustics/blue-whale-south-pacific.ogg",
    attribution: "NOAA Pacific Marine Environmental Laboratory",
    license: "Public domain · U.S. NOAA",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Blue_Whale_South_Pacific.ogg",
    sha256: "c2998bfd0bb5f00d4a3da98b2e9e5e9facd59640cf7b1de93830b2aa153fe31b",
    location: "South Pacific Ocean",
    technical: { sampleRate: 8_000, channels: 1, container: "Ogg Vorbis" },
    note: "Low-frequency archive excerpt; the map preserves source-time coordinates even when synthesis is shifted into hearing range.",
  },
];

const ids = new Set();
export const ACOUSTIC_BUILT_IN_SOURCES = Object.freeze(builtInSpecifications.map((entry) => {
  if (ids.has(entry.id)) throw new TypeError(`Duplicate acoustic source id "${entry.id}"`);
  ids.add(entry.id);
  return builtInSource(entry);
}));

const SOURCES_BY_ID = new Map(ACOUSTIC_BUILT_IN_SOURCES.map((entry) => [entry.id, entry]));

export function getAcousticBuiltInSource(sourceId) {
  const resolved = SOURCES_BY_ID.get(sourceId);
  if (!resolved) throw new RangeError(`Unknown built-in acoustic source "${sourceId}"`);
  return resolved;
}

export const ACOUSTIC_BUILT_IN_SOURCE_GROUPS = Object.freeze(
  [...new Set(ACOUSTIC_BUILT_IN_SOURCES.map((entry) => entry.catalogGroup))]
    .map((label) => freezeRecord({
      label,
      sourceIds: Object.freeze(
        ACOUSTIC_BUILT_IN_SOURCES
          .filter((entry) => entry.catalogGroup === label)
          .map((entry) => entry.id),
      ),
    })),
);

function archiveCollection(specification) {
  for (const field of ["id", "catalogGroup", "label", "scope", "access", "reuse", "sourceUrl", "importGuidance"]) {
    if (!specification[field]) throw new TypeError(`Archive collection is missing ${field}`);
  }
  return freezeRecord({
    transformationPolicy: "Check item-level rights before analysis or resynthesis.",
    ...specification,
  });
}

/**
 * Search destinations, not runtime media. Their pages remain authoritative for
 * record-level access, attribution, and reuse conditions.
 */
const archiveCollections = [
  archiveCollection({
    id: "watkins-marine-mammal",
    catalogGroup: "Wildlife recording archives",
    label: "Watkins Marine Mammal Sound Database",
    scope: "10,000+ clips from more than 60 marine-mammal species, including dolphins, porpoises, whales, seals, and walrus.",
    access: "WHOI collection documentation is online; the legacy search endpoint currently redirects to maintenance",
    reuse: "Personal and academic use; commercial use prohibited; credit WHOI's Watkins database.",
    sourceUrl: "https://www.whoi.edu/press-room/news-release/historic-marine-mammal-sound-archive-now-available-online/",
    importGuidance: "Use the collection as a profile lead while its search service is unavailable; if access returns, import only under WHOI's stated terms.",
    profileHints: "dolphin whistles, odontocete clicks, whale tonal calls, pinnipeds",
  }),
  archiveCollection({
    id: "noaa-sounds-ocean",
    catalogGroup: "Wildlife recording archives",
    label: "NOAA Sounds in the Ocean",
    scope: "Curated examples of marine mammals, fish, invertebrates, natural noise, and human-made ocean sound.",
    access: "Listen on NOAA Fisheries",
    reuse: "Verify the citation and rights attached to each exemplar before redistribution.",
    sourceUrl: "https://www.fisheries.noaa.gov/national/science-data/sounds-ocean",
    importGuidance: "Use a downloadable, rights-cleared source file locally; do not scrape the player.",
    profileHints: "marine phrases, fish calls, whale song, dolphin and porpoise signals",
  }),
  archiveCollection({
    id: "macaulay-library",
    catalogGroup: "Wildlife recording archives",
    label: "Macaulay Library",
    scope: "Cornell Lab's global scientific archive of animal audio and other natural-history media.",
    access: "Search and listen; download and research access depend on the record and use.",
    reuse: "Archive terms and contributor permissions apply; public playback does not imply redistribution rights.",
    sourceUrl: "https://www.macaulaylibrary.org/",
    rightsUrl: "https://support.ebird.org/en/support/solutions/articles/48001064551-using-and-requesting-media",
    importGuidance: "Obtain the file through Macaulay's allowed workflow, then upload it locally.",
    profileHints: "birds, mammals, amphibians, insects, fish, and soundscapes",
  }),
  archiveCollection({
    id: "xeno-canto",
    catalogGroup: "Wildlife recording archives",
    label: "xeno-canto",
    scope: "Community-contributed wildlife sounds with especially broad bird coverage and growing mammal, amphibian, and insect collections.",
    access: "Search, listen, and download where the record allows",
    reuse: "The Creative Commons license is attached per recording; attribution and share-alike conditions vary.",
    sourceUrl: "https://xeno-canto.org/",
    rightsUrl: "https://xeno-canto.org/about/terms",
    importGuidance: "Choose a record with compatible terms, preserve its XC id and credit, then upload locally.",
    profileHints: "bird strophes and syllables, frogs, grasshoppers, bats, coyotes, and terrestrial mammals",
  }),
  archiveCollection({
    id: "borror-laboratory",
    catalogGroup: "Wildlife recording archives",
    label: "Borror Laboratory of Bioacoustics",
    scope: "Ohio State research archive of animal sounds with extensive bird and other zoological holdings.",
    access: "Catalog and research access through the laboratory",
    reuse: "Request and citation conditions are controlled by the laboratory and individual recordings.",
    sourceUrl: "https://mbd.osu.edu/collections/borror-laboratory-bioacoustics",
    importGuidance: "Request a research copy and permission for the intended transformation before local import.",
    profileHints: "birds, mammals, amphibians, insects, and environmental recordings",
  }),
  archiveCollection({
    id: "inaturalist-sounds",
    catalogGroup: "Wildlife recording archives",
    label: "iNaturalist Sounds",
    scope: "A global observation archive spanning wildlife taxa, with more than one million observations containing sound and thousands of coyote sound observations.",
    access: "Search in the site, REST API, exports, or GBIF",
    reuse: "License belongs to each sound object; filter and preserve media-level creator, attribution, and license rather than assuming the observation license applies.",
    sourceUrl: "https://www.inaturalist.org/observations?taxon_id=42051&sounds=true",
    rightsUrl: "https://help.inaturalist.org/en/support/solutions/articles/151000169918-can-i-use-the-photos-and-sounds-that-are-posted-on-inaturalist-",
    importGuidance: "Use CC0, CC BY, or compatible CC BY-SA sounds individually; avoid all-rights-reserved and incompatible NC/ND media.",
    profileHints: "coyotes and other canids, dolphins and marine mammals, birds, frogs, insects, fish, and soundscapes",
  }),
  archiveCollection({
    id: "tierstimmenarchiv-berlin",
    catalogGroup: "Wildlife recording archives",
    label: "Animal Sound Archive · Berlin",
    scope: "About 120,000 recordings across roughly 1,800 bird and 580 mammal species, plus fish, amphibians, reptiles, and insects.",
    access: "Search more than 40,000 online files; record pages offer metadata and several audio formats",
    reuse: "Rights vary per record, including CC BY, CC BY-SA, CC BY-NC-SA, and unknown; filter at record level.",
    sourceUrl: "https://suche.tierstimmenarchiv.de/?language=english",
    rightsUrl: "https://www.museumfuernaturkunde.berlin/en/research/collection/animal-sound-archive/",
    importGuidance: "Prefer a clearly compatible Creative Commons record and retain the archive identifier, recordist, and original technical metadata.",
    profileHints: "foxes and other mammals, birds, fish, amphibians, reptiles, and insects",
  }),
  archiveCollection({
    id: "nps-yellowstone-sounds",
    catalogGroup: "Wildlife recording archives",
    label: "National Park Service · coyote and Yellowstone sounds",
    scope: "Coyote, wolf, fox, elk, bear, bird, frog, weather, geyser, and ecosystem recordings from U.S. National Park Service collections.",
    access: "Listen and download original files from NPS media pages",
    reuse: "NPS-only U.S. government works without a copyright notice are public domain; verify credits because partner and third-party items can differ.",
    sourceUrl: "https://home.nps.gov/yell/learn/photosmultimedia/soundlibrary.htm",
    rightsUrl: "https://www.nps.gov/aboutus/disclaimer.htm",
    importGuidance: "Check the credit line on the exact media item before bundling; retain park, recording title, and source page.",
    profileHints: "coyote howls and group yip-howls, wolves, foxes, elk, bears, frogs, birds, and soundscapes",
  }),
  archiveCollection({
    id: "fishsounds",
    catalogGroup: "Wildlife recording archives",
    label: "FishSounds",
    scope: "A reference system connecting soniferous fish species, call examples, behavior, terminology, and the research literature.",
    access: "Search species, recordings, and references online",
    reuse: "The site is CC BY-NC, while linked recordings can have separate repository terms; inspect each recording's origin.",
    sourceUrl: "https://fishsounds.net/",
    importGuidance: "Use it to choose a fish profile and follow the original recording link; obtain compatible item-level rights before importing.",
    profileHints: "fish knocks, pulses, grunts, hums, trains, and choruses",
  }),
  archiveCollection({
    id: "dasa-bat-archive",
    catalogGroup: "Wildlife recording archives",
    label: "DASA · Digital Acoustic Survey of Animals",
    scope: "A bat-focused archive with nearly two million detections and structured annotations, plus a documented programmatic interface.",
    access: "Search and API access when the service is available; the host was temporarily unavailable during the September 2026 audit",
    reuse: "Rights are set per detection: no reuse, restricted research, CC0, CC BY, or CC BY-NC.",
    sourceUrl: "https://dasa.naturalsciences.be/",
    rightsUrl: "https://dasa.naturalsciences.be/content/dasa_datapolicy.pdf",
    importGuidance: "Treat this as a profile and partnership lead unless an individual detection exposes both audio and compatible rights.",
    profileHints: "bat search-phase, approach, terminal-buzz, and social calls",
  }),
  archiveCollection({
    id: "elephant-listening-project",
    catalogGroup: "Wildlife recording archives",
    label: "Elephant Listening Project · Congo soundscapes",
    scope: "Public forest soundscapes centered on elephant acoustic ecology and detector development in the Congo Basin.",
    access: "Browse the Registry of Open Data on AWS and its public object store",
    reuse: "Free for scientific study and detector development; media use requires permission.",
    sourceUrl: "https://registry.opendata.aws/elp-nouabale-landscape/",
    importGuidance: "Link or request permission for artistic resynthesis; also screen long soundscapes for human voices and sensitive location data.",
    profileHints: "elephant rumbles, trumpets, roars, and tropical forest soundscapes",
  }),
  archiveCollection({
    id: "elephantvoices-ethogram",
    catalogGroup: "Wildlife recording archives",
    label: "ElephantVoices · Elephant Ethogram",
    scope: "A richly contextualized behavioral reference with hundreds of call examples and thousands of linked observations and videos.",
    access: "Browse calls by acoustic form, context, and behavior",
    reuse: "Sounds are copyrighted; public listening does not grant dataset or derivative-use rights.",
    sourceUrl: "https://www.elephantvoices.org/the-elephant-ethogram",
    importGuidance: "Use as an analysis-profile reference and request permission before copying, segmentation, training, or resynthesis.",
    profileHints: "elephant rumbles, trumpets, roars, cries, chirps, and call combinations",
  }),
  archiveCollection({
    id: "dolphinfree",
    catalogGroup: "Downloadable research datasets",
    label: "DOLPHINFREE",
    scope: "More than 400 minutes of wild short-beaked common dolphins with behavioral context, including 275 one-minute mono files at 512 kHz and four-channel files at 256 or 512 kHz.",
    access: "Direct files and metadata from Zenodo",
    reuse: "CC BY 4.0; preserve the dataset citation, attribution, and notices for modifications.",
    sourceUrl: "https://zenodo.org/records/14637675",
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/",
    importGuidance: "Download a manageable clip, retain its filename and context row, then upload locally with a 512 kHz-capable profile if clicks matter.",
    profileHints: "common-dolphin whistles, echolocation clicks, burst pulses, and behavior-linked sequences",
  }),
  archiveCollection({
    id: "adriatic-bottlenose-dolphins",
    catalogGroup: "Downloadable research datasets",
    label: "Adriatic bottlenose dolphin emissions",
    scope: "Raw 192 kHz PCM audio, 303 separated whistle files, call labels, and spectrograms from bottlenose dolphins interacting with bottom trawl nets.",
    access: "Direct files and metadata from Figshare",
    reuse: "Collection components are CC BY 4.0; cite the dataset and mark transformations.",
    sourceUrl: "https://figshare.com/collections/Bottlenose_dolphin_s_Tursiops_truncatus_Montagu_1821_acoustic_emissions_recorded_during_interaction_with_bottom_trawl_nets_in_the_central-northern_Adriatic_Sea/6313308",
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/",
    importGuidance: "Start with the separated whistle files for mapping, or crop a raw file locally when temporal context matters.",
    profileHints: "bottlenose-dolphin whistles, whistle contours, click trains, and interaction sequences",
  }),
  archiveCollection({
    id: "insectset459",
    catalogGroup: "Downloadable research datasets",
    label: "InsectSet459",
    scope: "26,298 files and 226.6 hours from 459 Orthoptera and Cicadidae species, retaining source sample rates from 8 to 500 kHz.",
    access: "Direct dataset archives and metadata from Zenodo",
    reuse: "Source material was selected from CC0 or CC BY recordings; preserve both dataset and original contributor metadata.",
    sourceUrl: "https://zenodo.org/records/18554693",
    importGuidance: "Use the metadata table to choose species and source rate before downloading; the complete dataset is roughly 84 GB.",
    profileHints: "cricket chirps, grasshopper songs, katydid ultrasound, cicada phrases, and pulse trains",
  }),
  archiveCollection({
    id: "anuraset",
    catalogGroup: "Downloadable research datasets",
    label: "AnuraSet",
    scope: "Neotropical frog material covering 42 species, with raw one-minute recordings and more than 93,000 labeled three-second WAV samples.",
    access: "Direct dataset archives and metadata from Zenodo",
    reuse: "Current repository metadata reports CC BY 1.0; attribute conservatively despite a CC0 statement in the associated paper.",
    sourceUrl: "https://zenodo.org/records/8342596",
    rightsUrl: "https://creativecommons.org/licenses/by/1.0/",
    importGuidance: "Choose raw audio for bout structure or labeled excerpts for call-shape studies; retain species and annotation provenance.",
    profileHints: "frog advertisement calls, pulse trains, notes, bouts, and multispecies choruses",
  }),
  archiveCollection({
    id: "australian-bat-acoustic-data",
    catalogGroup: "Downloadable research datasets",
    label: "Australian Bat Acoustic Data Collection",
    scope: "A continent-scale, ongoing collection of identified and unidentified bat calls in WAV and Anabat zero-crossing formats with contextual metadata.",
    access: "TERN Ecoacoustics portal downloads and RO-Crate metadata",
    reuse: "CC BY 4.0; credit the dataset and the named contributor attached to each recording.",
    sourceUrl: "https://portal.tern.org.au/metadata/9c47fe65-86c0-4cbd-bb28-73d30c3fd6c1",
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/",
    importGuidance: "Select PCM WAV for this browser tool; Anabat .zc stores zero crossings and is not ordinary waveform audio.",
    profileHints: "bat echolocation phases, terminal buzzes, social calls, and high-rate ultrasonic capture",
  }),
  archiveCollection({
    id: "marmaudio",
    catalogGroup: "Downloadable research datasets",
    label: "MarmAudio",
    scope: "871,044 segmented common-marmoset vocalizations across 253 hours and 40 months, with a large typed-call subset and small example package.",
    access: "Direct FLAC datasets, WAV examples, and metadata from Zenodo",
    reuse: "CC BY 4.0; cite the dataset and retain subject, session, and annotation metadata.",
    sourceUrl: "https://zenodo.org/records/17191682",
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/",
    importGuidance: "Begin with the example package, then use the 96 kHz FLAC collection for repertoire-scale work outside the browser's bundled shelf.",
    profileHints: "marmoset phee, trill, twitter, chirp, tsik, ek, and call sequences",
  }),
  archiveCollection({
    id: "gombe-chimpanzee-archive",
    catalogGroup: "Downloadable research datasets",
    label: "Gombe chimpanzee vocal archive",
    scope: "More than ten hours of wild chimpanzee material, including contextualized specimens in 96 kHz / 24-bit WAV packages.",
    access: "Direct files and metadata from Dryad",
    reuse: "Dryad metadata is CC0; retain the dataset citation and contextual labels.",
    sourceUrl: "https://datadryad.org/dataset/doi%3A10.5061/dryad.sd15m",
    importGuidance: "Segment carefully: specimens may begin with a human recordist announcing a cut number, which must not be treated as an animal call.",
    profileHints: "chimpanzee pant-hoots, screams, grunts, barks, and contextual sequences",
  }),
  archiveCollection({
    id: "australian-acoustic-observatory",
    catalogGroup: "Downloadable research datasets",
    label: "Australian Acoustic Observatory",
    scope: "Long-duration soundscapes from hundreds of sensors across more than 100 sites and seven ecoregions, spanning animals, weather, and complete habitats.",
    access: "Public browse and portal-assisted batch downloads",
    reuse: "Representative collections are CC BY 4.0, but verify the selected site's record and screen incidental human speech.",
    sourceUrl: "https://acousticobservatory.org/data/find-data/",
    importGuidance: "Crop a short local interval before browser analysis; retain site, sensor, time, and any location-sensitivity or Indigenous-area conditions.",
    profileHints: "birds, frogs, insects, mammals, weather, diel cycles, and full soundscape texture",
  }),
  archiveCollection({
    id: "noaa-ncei-passive-acoustics",
    catalogGroup: "Downloadable research datasets",
    label: "NOAA NCEI Passive Acoustic Archive",
    scope: "Global raw recordings and derived products for whales, dolphins, fish, natural processes, and human-made ocean sound.",
    access: "Interactive map, public cloud objects, SanctSound, and dataset requests",
    reuse: "NOAA-origin U.S. government work is generally public domain, but contributed holdings were not all relicensed; inspect each landing record.",
    sourceUrl: "https://www.ncei.noaa.gov/products/passive-acoustic-data/",
    importGuidance: "Choose a specific dataset and verify origin, rights, sample rate, channels, and deployment metadata before downloading a local subset.",
    profileHints: "whales, dolphins, porpoises, fish, ships, weather, ice, and marine soundscapes",
  }),
  archiveCollection({
    id: "wabad-bird-audio",
    catalogGroup: "Downloadable research datasets",
    label: "WABAD · Wild Audio Bird Annotations Dataset",
    scope: "5,047 annotated minutes and more than 91,000 vocalizations from 1,192 bird species across 13 biomes.",
    access: "Direct dataset archive and annotations from Zenodo",
    reuse: "Current DataCite repository metadata reports CC BY 4.0; preserve attribution and identify modifications.",
    sourceUrl: "https://zenodo.org/records/17293588",
    rightsUrl: "https://creativecommons.org/licenses/by/4.0/",
    importGuidance: "Download a manageable subset and retain the vocalization, species, source-recording, and annotation provenance.",
    profileHints: "songbird syllables, strophes, calls, multispecies scenes, and cross-biome comparisons",
  }),
  archiveCollection({
    id: "loc-ancestral-voices",
    catalogGroup: "Community-governed human archives",
    label: "Ancestral Voices · Passamaquoddy recordings",
    scope: "Library of Congress historical recordings presented with Passamaquoddy participation and Traditional Knowledge Labels.",
    access: "Online for noncommercial education and research under collection conditions",
    reuse: "Further use requires an independent rights assessment and, where applicable, community permission.",
    sourceUrl: "https://www.loc.gov/collections/ancestral-voices/",
    rightsUrl: "https://www.loc.gov/collections/ancestral-voices/about-this-collection/rights-and-access/",
    importGuidance: "Use the archive interface for listening. Do not import or transform without permission covering that use.",
    transformationPolicy: "No default resynthesis, training, rearrangement, or style extrapolation; consult the named cultural authority and honor TK Labels.",
  }),
  archiveCollection({
    id: "smithsonian-folkways-american-indian",
    catalogGroup: "Community-governed human archives",
    label: "Smithsonian Folkways · American Indian recordings",
    scope: "A large commercial and archival catalog of historical and contemporary recordings from many distinct peoples and artists.",
    access: "Stream or purchase according to each release",
    reuse: "Listening or purchase does not grant redistribution, dataset, or transformation rights.",
    sourceUrl: "https://folkways.si.edu/genre/american-indian",
    rightsUrl: "https://folkways.si.edu/license-request",
    importGuidance: "Treat each release and community separately; obtain both rights-holder and community authorization for transformation.",
    transformationPolicy: "Never bulk-ingest. Resynthesis needs express permission that covers derivative and generative use.",
  }),
  archiveCollection({
    id: "nmai-archive-center",
    catalogGroup: "Community-governed human archives",
    label: "National Museum of the American Indian Archive Center",
    scope: "Thousands of sound and audiovisual recordings across many Native and Indigenous communities of the Western Hemisphere.",
    access: "Record-specific online or appointment access",
    reuse: "Collection restrictions and publication permissions vary; access is not a blanket reuse license.",
    sourceUrl: "https://americanindian.si.edu/explore/collections/archive",
    importGuidance: "Ask the Archive Center and the culturally affiliated community before copying or computational use.",
    transformationPolicy: "No default resynthesis or training; community sovereignty and culturally sensitive access conditions take precedence.",
  }),
  archiveCollection({
    id: "paradisec",
    catalogGroup: "Community-governed human archives",
    label: "PARADISEC",
    scope: "About 20,500 hours of language, performance, narrative, singing, and oral tradition material across roughly 1,460 languages.",
    access: "Search catalog and OLAC metadata; item access conditions vary",
    reuse: "The general access agreement prohibits third-party redistribution, and depositors or communities can impose additional conditions.",
    sourceUrl: "https://www.paradisec.org.au/",
    rightsUrl: "https://www.paradisec.org.au/deposit/access-conditions/",
    importGuidance: "Profile and link only unless performer, community, depositor, archive, and rights-holder permissions cover the proposed use.",
    transformationPolicy: "No default extraction, rearrangement, training, voice cloning, or resynthesis; interpret deposit restrictions with the source community.",
  }),
  archiveCollection({
    id: "aiatsis-collection",
    catalogGroup: "Community-governed human archives",
    label: "AIATSIS Collection",
    scope: "More than one million items in a major collection dedicated to Aboriginal and Torres Strait Islander cultures, including extensive sound holdings.",
    access: "Catalog discovery and request-based access according to item conditions",
    reuse: "Publication, broadcast, and transformation can require copyright, performer, community, and Indigenous Cultural and Intellectual Property permissions.",
    sourceUrl: "https://aiatsis.gov.au/collection",
    rightsUrl: "https://aiatsis.gov.au/collection/using-collection/accessing-items-collection",
    importGuidance: "Use metadata for discovery and begin a permission conversation; do not bulk-download or infer permission from catalog visibility.",
    transformationPolicy: "Community authority and ICIP responsibilities govern computational use; no default resynthesis, training, or style extrapolation.",
  }),
];

const archiveIds = new Set();
export const ACOUSTIC_ARCHIVE_COLLECTIONS = Object.freeze(archiveCollections.map((entry) => {
  if (archiveIds.has(entry.id)) throw new TypeError(`Duplicate acoustic archive id "${entry.id}"`);
  archiveIds.add(entry.id);
  return entry;
}));

export const ACOUSTIC_ARCHIVE_GROUPS = Object.freeze(
  [...new Set(ACOUSTIC_ARCHIVE_COLLECTIONS.map((entry) => entry.catalogGroup))]
    .map((label) => freezeRecord({
      label,
      collectionIds: Object.freeze(
        ACOUSTIC_ARCHIVE_COLLECTIONS
          .filter((entry) => entry.catalogGroup === label)
          .map((entry) => entry.id),
      ),
    })),
);

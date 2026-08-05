import {
  PLUGIN_CATALOG,
  formatPluginBytes,
  latestPluginRelease,
} from "./src/plugin-catalog.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(className, text, href) {
  const anchor = element("a", className, text);
  anchor.href = href;
  return anchor;
}

function humanDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function renderTagList(values, className = "plugin-tags") {
  const list = element("ul", className);
  for (const value of values) list.append(element("li", "", value));
  return list;
}

function renderArtifact(artifact, { archived = false } = {}) {
  const article = element("article", "plugin-artifact");
  const heading = element("div", "plugin-artifact-heading");
  const title = element("h4", "", artifact.format);
  const platform = element(
    "span",
    "plugin-artifact-platform",
    artifact.testedOn.join(" · "),
  );
  heading.append(title, platform);

  const metadata = element("dl", "plugin-artifact-meta");
  const rows = [
    ["Version", artifact.version],
    ["Host", `${artifact.minimumHost}+`],
    ["Platforms", artifact.platforms.join(" · ")],
    ["Size", formatPluginBytes(artifact.bytes)],
  ];
  for (const [label, value] of rows) {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    metadata.append(row);
  }

  const actions = element("div", "plugin-artifact-actions");
  const download = link(
    archived ? "plugin-download plugin-download-secondary" : "plugin-download",
    archived ? `Download v${artifact.version}` : `Download ${artifact.format}`,
    artifact.href,
  );
  download.download = artifact.downloadName;
  download.setAttribute("data-plugin-download", artifact.id);
  actions.append(download);

  const checksum = element("details", "plugin-checksum");
  checksum.append(
    element("summary", "", "Verify SHA-256"),
    element("code", "", artifact.sha256),
  );

  article.append(heading, metadata, actions, checksum);
  return article;
}

function renderCurrentRelease(plugin, release) {
  const section = element("section", "plugin-release");
  section.setAttribute("aria-label", `${plugin.name} current release`);

  const heading = element("div", "plugin-release-heading");
  const titleGroup = element("div");
  titleGroup.append(
    element("p", "plugin-release-label", "Latest release"),
    element("h3", "", `Version ${release.version}`),
  );
  const date = element("time", "plugin-release-date", humanDate(release.releasedAt));
  date.dateTime = release.releasedAt;
  heading.append(titleGroup, date);

  const changes = renderTagList(release.changes, "plugin-change-list");
  const artifacts = element("div", "plugin-artifact-list");
  for (const artifact of release.artifacts) artifacts.append(renderArtifact(artifact));
  section.append(heading, changes, artifacts);
  return section;
}

function renderReleaseHistory(plugin) {
  const archived = plugin.releases.filter((release) => !release.recommended);
  if (archived.length === 0) return null;

  const details = element("details", "plugin-history");
  details.append(element("summary", "", `Previous releases · ${archived.length}`));
  const body = element("div", "plugin-history-body");
  for (const release of archived) {
    const releaseBlock = element("section", "plugin-history-release");
    const title = element("div", "plugin-history-heading");
    const date = element("time", "", humanDate(release.releasedAt));
    date.dateTime = release.releasedAt;
    title.append(element("h3", "", `Version ${release.version}`), date);
    releaseBlock.append(title, renderTagList(release.changes, "plugin-change-list"));
    for (const artifact of release.artifacts) {
      releaseBlock.append(renderArtifact(artifact, { archived: true }));
    }
    body.append(releaseBlock);
  }
  details.append(body);
  return details;
}

function renderPluginCard(plugin) {
  const card = element(
    "article",
    `plugin-card plugin-card-${plugin.status}`,
  );
  card.id = plugin.id;
  card.dataset.pluginStatus = plugin.status;
  card.dataset.search = [
    plugin.name,
    plugin.family,
    plugin.summary,
    plugin.stage,
    plugin.voiceMode,
    ...plugin.plannedFormats,
    ...plugin.capabilities,
  ].join(" ").toLowerCase();

  const header = element("header", "plugin-card-header");
  const identity = element("div");
  identity.append(
    element("p", "plugin-family", plugin.family),
    element("h2", "", plugin.name),
  );
  const status = element(
    "span",
    `plugin-status plugin-status-${plugin.status}`,
    plugin.status === "available" ? `${plugin.stage} · Available` : "In development",
  );
  header.append(identity, status);

  const summary = element("p", "plugin-summary", plugin.summary);
  const facts = element("dl", "plugin-facts");
  for (const [label, value] of [
    ["Instrument", "Separate plug-in"],
    ["Voice model", plugin.voiceMode],
    ["Formats", plugin.status === "available" ? "JSFX now" : plugin.plannedFormats.join(" · ")],
  ]) {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    facts.append(row);
  }

  const cardActions = element("div", "plugin-card-actions");
  cardActions.append(link("plugin-demo-link", "Open browser instrument", plugin.demoHref));

  card.append(header, summary, facts);
  if (plugin.capabilities.length > 0) {
    card.append(renderTagList(plugin.capabilities));
  }
  card.append(cardActions);

  const latest = latestPluginRelease(plugin);
  if (latest) {
    card.append(renderCurrentRelease(plugin, latest));
    const history = renderReleaseHistory(plugin);
    if (history) card.append(history);
  } else {
    const roadmap = element("section", "plugin-roadmap");
    roadmap.append(
      element("p", "plugin-release-label", "Planned formats"),
      renderTagList(plugin.plannedFormats, "plugin-tags plugin-roadmap-tags"),
      element(
        "p",
        "plugin-roadmap-note",
        "The browser DSP and parameter contract will be stabilized before a downloadable build is published.",
      ),
    );
    card.append(roadmap);
  }

  return card;
}

const catalog = document.getElementById("pluginCatalog");
const search = document.getElementById("pluginSearch");
const statusFilter = document.getElementById("pluginStatusFilter");
const resultCount = document.getElementById("pluginResultCount");
const emptyState = document.getElementById("pluginEmptyState");

const cards = PLUGIN_CATALOG.map(renderPluginCard);
catalog?.replaceChildren(...cards);

function applyFilters() {
  const query = search?.value.trim().toLowerCase() ?? "";
  const requestedStatus = statusFilter?.value ?? "all";
  let visible = 0;

  for (const card of cards) {
    const matchesSearch = !query || card.dataset.search.includes(query);
    const matchesStatus = requestedStatus === "all"
      || card.dataset.pluginStatus === requestedStatus;
    card.hidden = !(matchesSearch && matchesStatus);
    if (!card.hidden) visible += 1;
  }

  if (resultCount) {
    resultCount.textContent = `${visible} of ${cards.length} instruments shown`;
  }
  if (emptyState) emptyState.hidden = visible !== 0;
}

search?.addEventListener("input", applyFilters);
statusFilter?.addEventListener("change", applyFilters);
applyFilters();

if (location.hash) {
  const hashId = decodeURIComponent(location.hash.slice(1));
  requestAnimationFrame(() => document.getElementById(hashId)?.scrollIntoView());
}

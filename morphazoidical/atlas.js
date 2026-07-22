import { FEATURE_REGISTRY } from "./feature-registry.js";

const elements = {
  form: document.querySelector("#atlasFilters"),
  search: document.querySelector("#featureSearch"),
  group: document.querySelector("#groupFilter"),
  clear: document.querySelector("#clearFilters"),
  count: document.querySelector("#atlasResultCount"),
  total: document.querySelector("#registryCount"),
  summary: document.querySelector("#activeFilterSummary"),
  groups: document.querySelector("#featureGroups"),
  empty: document.querySelector("#atlasEmpty"),
  scopeButtons: [...document.querySelectorAll("[data-scope]")],
};

const state = { query: "", scope: "", group: "" };
const validScopes = new Set(FEATURE_REGISTRY.map((feature) => feature.scope));
const validGroups = new Set(FEATURE_REGISTRY.map((feature) => feature.group));

const GROUP_DESCRIPTIONS = Object.freeze({
  Form: "Measurements of the contour as a whole.",
  Center: "Measurements relative to the selected geometric center.",
  "Inside / outside": "Containment, facing, hull, and boundary classifications.",
  Topology: "Crossings, touches, overlaps, and structural relationships.",
  Contact: "Position and progress at one reader–contour contact.",
  Direction: "Tangent, normal, incoming, and outgoing orientation.",
  "Edge / corner": "Local bend and proximity to logical corners.",
  Motion: "Change measured across analysis frames.",
  Reader: "Statistics across the current reader and its ordered contacts.",
  Events: "Discrete changes suitable for triggers and envelopes.",
});

function defaultDescription(feature) {
  const subject = feature.scope === "geometry"
    ? "the current form"
    : feature.scope === "event"
      ? "the current analysis step"
      : `the active ${feature.scope}`;
  return `${feature.label} reported for ${subject}.`;
}

function cadenceFor(feature) {
  if (feature.cadence) return feature.cadence;
  if (feature.type === "event" || feature.scope === "event") return "event edge";
  if (feature.scope === "geometry") return "form cache + transform";
  return "analysis frame";
}

function normalizationFor(feature) {
  if (feature.type === "boolean") return "binary → 0 / 1";
  if (feature.type === "category") return `${feature.categories?.length ?? 0} ordered categories`;

  const rule = feature.normalization;
  if (!rule) return "raw value";
  if (rule.kind === "cyclic") return `wrap ${formatNumber(rule.minimum)} + ${formatNumber(rule.period)} period → 0–1`;
  if (rule.kind === "positive") return `positive soft scale ${formatNumber(rule.scale)} → 0–1`;
  if (rule.kind === "signed-positive") return `signed soft scale ${formatNumber(rule.scale)} → 0–1`;
  if (rule.kind === "linear") {
    const suffix = rule.clamp ? ", clamped" : "";
    return `${formatNumber(rule.minimum)}…${formatNumber(rule.maximum)} → 0–1${suffix}`;
  }
  return rule.kind;
}

function formatNumber(value) {
  if (value === Math.PI) return "π";
  if (value === -Math.PI) return "−π";
  if (value === Math.PI * 2) return "2π";
  if (value === Math.PI / 2) return "π/2";
  if (value === -Math.PI / 2) return "−π/2";
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function searchableText(feature) {
  return [
    feature.id,
    feature.label,
    feature.group,
    feature.scope,
    feature.type,
    feature.unit,
    feature.availability,
    feature.description,
    feature.status,
    cadenceFor(feature),
    normalizationFor(feature),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function featureMatches(feature) {
  if (state.scope && feature.scope !== state.scope) return false;
  if (state.group && feature.group !== state.group) return false;
  if (!state.query) return true;
  const terms = state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const haystack = searchableText(feature);
  return terms.every((term) => haystack.includes(term));
}

function appendText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function createFeatureCard(feature) {
  const card = document.createElement("article");
  card.className = "feature-card";
  card.id = `feature-${feature.id.replaceAll(".", "-")}`;
  card.dataset.featureId = feature.id;
  card.dataset.scope = feature.scope;
  card.dataset.group = feature.group;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  appendText(meta, "code", feature.id);
  const badges = document.createElement("span");
  badges.className = "card-badges";
  appendText(badges, "span", feature.status === "planned" ? "Planned" : "Live · sampled", `status-badge ${feature.status === "planned" ? "planned" : "live"}`);
  appendText(badges, "span", feature.type, "type-badge");
  meta.append(badges);
  card.append(meta);

  appendText(card, "h3", feature.label);
  appendText(card, "p", feature.description ?? defaultDescription(feature));

  const footer = document.createElement("footer");
  const identity = document.createElement("span");
  identity.append(`${feature.scope} · ${feature.unit ?? "unitless"}`);
  identity.append(document.createElement("br"));
  identity.append(`cadence · ${cadenceFor(feature)}`);

  const rules = document.createElement("span");
  rules.append(`available · ${feature.availability ?? "always"}`);
  rules.append(document.createElement("br"));
  rules.append(`normalize · ${normalizationFor(feature)}`);
  if (feature.availability) rules.className = "availability-badge";
  footer.append(identity, rules);
  card.append(footer);
  return card;
}

function render() {
  const matches = FEATURE_REGISTRY.filter(featureMatches);
  const grouped = new Map();
  for (const feature of matches) {
    const group = grouped.get(feature.group) ?? [];
    group.push(feature);
    grouped.set(feature.group, group);
  }

  const fragment = document.createDocumentFragment();
  for (const [groupName, features] of grouped) {
    const section = document.createElement("section");
    section.className = "feature-group";
    section.dataset.group = groupName;
    section.setAttribute("aria-labelledby", `group-${slug(groupName)}`);

    const header = document.createElement("header");
    const headingWrap = document.createElement("div");
    const heading = appendText(headingWrap, "h2", groupName);
    heading.id = `group-${slug(groupName)}`;
    appendText(headingWrap, "p", GROUP_DESCRIPTIONS[groupName] ?? "Related real-time geometry signals.");
    appendText(header, "span", `${features.length} ${features.length === 1 ? "feature" : "features"}`);
    header.prepend(headingWrap);

    const grid = document.createElement("div");
    grid.className = "feature-grid";
    for (const feature of features) grid.append(createFeatureCard(feature));
    section.append(header, grid);
    fragment.append(section);
  }

  elements.groups.replaceChildren(fragment);
  elements.groups.setAttribute("aria-busy", "false");
  elements.empty.hidden = matches.length !== 0;
  elements.count.value = `${matches.length} of ${FEATURE_REGISTRY.length} features`;
  elements.count.textContent = elements.count.value;
  elements.total.textContent = FEATURE_REGISTRY.length;
  elements.summary.textContent = [
    state.scope ? scopeLabel(state.scope) : "All scopes",
    state.group || "all groups",
  ].join(" · ");

  for (const button of elements.scopeButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.scope === state.scope));
  }
  syncUrl();
}

function slug(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function scopeLabel(scope) {
  return scope === "geometry" ? "Form" : `${scope[0].toUpperCase()}${scope.slice(1)}`;
}

function syncUrl() {
  const url = new URL(window.location.href);
  for (const key of ["q", "scope", "group"]) url.searchParams.delete(key);
  if (state.query) url.searchParams.set("q", state.query);
  if (state.scope) url.searchParams.set("scope", state.scope);
  if (state.group) url.searchParams.set("group", state.group);
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedScope = params.get("scope") ?? "";
  const requestedGroup = params.get("group") ?? "";
  state.query = params.get("q")?.trim() ?? "";
  state.scope = validScopes.has(requestedScope) ? requestedScope : "";
  state.group = validGroups.has(requestedGroup) ? requestedGroup : "";
  elements.search.value = state.query;
  elements.group.value = state.group;
}

function populateGroups() {
  for (const group of validGroups) {
    const option = document.createElement("option");
    option.value = group;
    option.textContent = group;
    elements.group.append(option);
  }
}

elements.form.addEventListener("submit", (event) => event.preventDefault());
elements.search.addEventListener("input", () => {
  state.query = elements.search.value.trim();
  render();
});
elements.group.addEventListener("change", () => {
  state.group = elements.group.value;
  render();
});
for (const button of elements.scopeButtons) {
  button.addEventListener("click", () => {
    state.scope = button.dataset.scope;
    render();
  });
}
elements.clear.addEventListener("click", () => {
  state.query = "";
  state.scope = "";
  state.group = "";
  elements.search.value = "";
  elements.group.value = "";
  render();
  elements.search.focus();
});
window.addEventListener("popstate", () => {
  readUrl();
  render();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  elements.search.focus();
});

populateGroups();
readUrl();
render();

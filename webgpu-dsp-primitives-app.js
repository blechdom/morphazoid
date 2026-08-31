import {
  WEBGPU_DSP_CATEGORIES,
  WEBGPU_DSP_PRIMITIVES,
  WEBGPU_DSP_STATUSES,
  webGpuDspPrimitiveById,
} from "./src/webgpu-dsp-primitives.js?v=20260831-coverage145-final";
import {
  shaderSynthPrimitiveCoverageById,
  shaderSynthPrimitivePlaygroundHref,
} from "./src/shader-synth-playground-primitive-coverage.js?v=20260831-coverage145-final";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const categoryById = new Map(WEBGPU_DSP_CATEGORIES.map((category) => [category.id, category]));
const validCategories = new Set(["all", ...WEBGPU_DSP_CATEGORIES.map(({ id }) => id)]);
const validStatuses = new Set(["all", ...Object.keys(WEBGPU_DSP_STATUSES)]);

const tableBody = $("#primitiveTableBody");
const resultCount = $("#resultCount");
const emptyState = $("#atlasEmptyState");
const search = $("#primitiveSearch");
const clearSearch = $("#clearSearch");

const urlState = new URL(window.location.href);
const state = {
  query: urlState.searchParams.get("q") ?? "",
  category: validCategories.has(urlState.searchParams.get("stage"))
    ? urlState.searchParams.get("stage")
    : "all",
  status: validStatuses.has(urlState.searchParams.get("scope"))
    ? urlState.searchParams.get("scope")
    : "all",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function primitiveSearchText(primitive) {
  const category = categoryById.get(primitive.category);
  const coverage = shaderSynthPrimitiveCoverageById(primitive.id);
  return normalized([
    primitive.name,
    primitive.symbol,
    primitive.syntax,
    primitive.audio,
    primitive.note,
    primitive.compose,
    primitive.execution,
    primitive.source?.label,
    primitive.source?.url,
    category?.label,
    WEBGPU_DSP_STATUSES[primitive.status]?.label,
    coverage?.kind,
    coverage?.moduleId,
    coverage?.featureId,
    coverage?.label,
    coverage?.mode,
    ...primitive.tags,
  ].join(" "));
}

function filteredPrimitives() {
  const query = normalized(state.query);
  const terms = query.split(/\s+/).filter(Boolean);
  return WEBGPU_DSP_PRIMITIVES.filter((primitive) => {
    if (state.category !== "all" && primitive.category !== state.category) return false;
    if (state.status !== "all" && primitive.status !== state.status) return false;
    if (!terms.length) return true;
    const haystack = primitiveSearchText(primitive);
    return terms.every((term) => haystack.includes(term));
  });
}

function primitiveRow(primitive, category) {
  const status = WEBGPU_DSP_STATUSES[primitive.status];
  const coverage = shaderSynthPrimitiveCoverageById(primitive.id);
  const symbol = primitive.symbol
    ? `<code class="primitive-symbol">${escapeHtml(primitive.symbol)}()</code>`
    : "";
  const source = primitive.source?.url
    ? `<a class="primitive-source" href="${escapeHtml(primitive.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(primitive.source.label ?? "Primary source")}</a>`
    : "";
  const coverageMode = coverage?.mode
    ? `<small>${escapeHtml(coverage.mode)}</small>`
    : "";
  const coverageHref = shaderSynthPrimitivePlaygroundHref(primitive.id);
  const coverageMarkup = coverage?.kind === "playable" && coverageHref
    ? `<a class="primitive-coverage" data-coverage-kind="playable" href="${escapeHtml(coverageHref)}"><b>Playable as ${escapeHtml(coverage.label)}</b>${coverageMode}</a>`
    : coverage
      ? `<span class="primitive-coverage" data-coverage-kind="${escapeHtml(coverage.kind)}"><b>${coverage.kind === "infrastructure" ? "Runtime infrastructure" : "Workflow"}</b><small>${escapeHtml(coverage.label)}</small></span>`
      : "";
  return `
    <tr class="primitive-row" id="primitive-${escapeHtml(primitive.id)}" data-primitive-id="${escapeHtml(primitive.id)}" style="--category-color: ${category.color}">
      <td class="primitive-name-cell" data-label="Primitive">
        <b class="primitive-name">${escapeHtml(primitive.name)}</b>
        ${symbol}
        <span class="primitive-meta">
          <span class="primitive-status" data-status="${primitive.status}" title="${escapeHtml(status.description)}">${escapeHtml(status.short)}</span>
          <span class="primitive-category">${escapeHtml(category.short)}</span>
        </span>
        ${coverageMarkup}
      </td>
      <td class="primitive-syntax-cell" data-label="Shader syntax">
        <button class="syntax-copy" type="button" data-copy-syntax="${escapeHtml(primitive.id)}" aria-label="Copy shader syntax for ${escapeHtml(primitive.name)}">
          <code>${escapeHtml(primitive.syntax)}</code><small>Copy</small>
        </button>
      </td>
      <td data-label="In audio">${escapeHtml(primitive.audio)}</td>
      <td data-label="GPU shape + limits">
        <b class="primitive-execution">${escapeHtml(primitive.execution)}</b>
        <span class="primitive-note">${escapeHtml(primitive.note)}</span>
        ${source}
      </td>
      <td data-label="Build from it"><span class="primitive-compose">${escapeHtml(primitive.compose)}</span></td>
    </tr>`;
}

function renderTable() {
  const visible = filteredPrimitives();
  const chunks = [];
  for (const category of WEBGPU_DSP_CATEGORIES) {
    const entries = visible.filter((primitive) => primitive.category === category.id);
    if (!entries.length) continue;
    chunks.push(`
      <tr class="primitive-category-row" style="--category-color: ${category.color}">
        <th colspan="5" scope="rowgroup">${escapeHtml(category.label)}<span>${entries.length} ${entries.length === 1 ? "primitive" : "primitives"}</span></th>
      </tr>`);
    chunks.push(...entries.map((primitive) => primitiveRow(primitive, category)));
  }
  tableBody.innerHTML = chunks.join("");
  resultCount.textContent = `${visible.length} ${visible.length === 1 ? "primitive" : "primitives"}`;
  emptyState.hidden = visible.length !== 0;
  tableBody.closest("table").hidden = visible.length === 0;
}

function syncFilterButtons() {
  $$('[data-category-filter]').forEach((button) => {
    const active = button.dataset.categoryFilter === state.category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-status-filter]').forEach((button) => {
    const active = button.dataset.statusFilter === state.status;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function updateUrl() {
  const url = new URL(window.location.href);
  if (state.query.trim()) url.searchParams.set("q", state.query.trim());
  else url.searchParams.delete("q");
  if (state.category !== "all") url.searchParams.set("stage", state.category);
  else url.searchParams.delete("stage");
  if (state.status !== "all") url.searchParams.set("scope", state.status);
  else url.searchParams.delete("scope");
  window.history.replaceState({}, "", url);
}

function refreshReference({ syncUrl = true } = {}) {
  search.value = state.query;
  clearSearch.hidden = !state.query;
  syncFilterButtons();
  renderTable();
  if (syncUrl) updateUrl();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

search.addEventListener("input", () => {
  state.query = search.value;
  refreshReference();
});

clearSearch.addEventListener("click", () => {
  state.query = "";
  refreshReference();
  search.focus();
});

$$('[data-category-filter]').forEach((button) => {
  button.addEventListener("click", () => {
    state.category = button.dataset.categoryFilter;
    refreshReference();
  });
});

$$('[data-status-filter]').forEach((button) => {
  button.addEventListener("click", () => {
    state.status = button.dataset.statusFilter;
    refreshReference();
  });
});

$("#resetFilters").addEventListener("click", () => {
  state.query = "";
  state.category = "all";
  state.status = "all";
  refreshReference();
  search.focus();
});

tableBody.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-syntax]");
  if (!copyButton) return;
  const primitive = webGpuDspPrimitiveById(copyButton.dataset.copySyntax);
  if (!primitive) return;
  const copied = await copyText(primitive.syntax);
  const label = copyButton.querySelector("small");
  label.textContent = copied ? "Copied" : "Select";
  window.setTimeout(() => { label.textContent = "Copy"; }, 1600);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  event.preventDefault();
  search.focus();
});

window.addEventListener("popstate", () => {
  const url = new URL(window.location.href);
  state.query = url.searchParams.get("q") ?? "";
  state.category = validCategories.has(url.searchParams.get("stage")) ? url.searchParams.get("stage") : "all";
  state.status = validStatuses.has(url.searchParams.get("scope")) ? url.searchParams.get("scope") : "all";
  refreshReference({ syncUrl: false });
});

refreshReference({ syncUrl: false });

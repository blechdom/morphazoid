import { INSTRUMENTS } from "./src/instrument-catalog.js";
import {
  WAX_INSTRUMENT_SUPPORT,
  WAX_ROLE_DEFINITIONS,
  waxSupportForId,
} from "./src/wax-instrument-roles.js";

const instrumentById = new Map(INSTRUMENTS.map((instrument) => [instrument.id, instrument]));

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalizedSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function filterWaxSupport({ query = "", role = "all" } = {}) {
  const terms = normalizedSearch(query).split(/\s+/).filter(Boolean);
  return WAX_INSTRUMENT_SUPPORT.filter((support) => {
    if (role !== "all" && !support.roles.includes(role)) return false;
    const instrument = instrumentById.get(support.id);
    const roleText = support.roles
      .map((roleId) => WAX_ROLE_DEFINITIONS[roleId]?.label ?? roleId)
      .join(" ");
    const haystack = normalizedSearch([
      instrument?.label,
      instrument?.kind,
      instrument?.description,
      support.summary,
      support.caveat,
      support.noteMode,
      roleText,
    ].filter(Boolean).join(" "));
    return terms.every((term) => haystack.includes(term));
  });
}

function roleBadge(doc, roleId, recommended) {
  const role = WAX_ROLE_DEFINITIONS[roleId];
  const badge = element(
    doc,
    `span`,
    `wax-role-badge wax-role-${roleId}${recommended ? " wax-role-recommended" : ""}`,
    role?.label.replace("WAX ", "") ?? roleId,
  );
  if (recommended) badge.title = "Recommended wrapper";
  return badge;
}

function capabilityList(doc, support) {
  const list = element(doc, "ul", "wax-capability-list");
  list.setAttribute("aria-label", "WAX capabilities");
  if (support.midiInput) {
    list.append(element(
      doc,
      "li",
      "",
      support.midiInputMode === "native" ? "Native MIDI performance" : "MIDI control fallback",
    ));
  }
  if (support.midiOutput) list.append(element(doc, "li", "", "MIDI out"));
  if (support.hostSync) list.append(element(doc, "li", "", "Host sync"));
  return list;
}

function createSupportRow(doc, support) {
  const instrument = instrumentById.get(support.id);
  const row = element(doc, "tr", "wax-catalog-row");
  row.dataset.instrumentId = support.id;
  row.dataset.roles = support.roles.join(" ");

  const nameCell = element(doc, "th", "wax-catalog-name");
  nameCell.scope = "row";
  const link = element(doc, "a", "", instrument.label);
  link.href = instrument.href;
  nameCell.append(link, element(doc, "span", "", instrument.kind));

  const recommendedCell = element(doc, "td", "wax-catalog-role");
  recommendedCell.append(roleBadge(doc, support.recommended, true));

  const alsoCell = element(doc, "td", "wax-catalog-role");
  const alsoWorks = support.roles.filter((roleId) => roleId !== support.recommended);
  if (alsoWorks.length) {
    for (const roleId of alsoWorks) alsoCell.append(roleBadge(doc, roleId, false));
  } else {
    alsoCell.append(element(doc, "span", "wax-role-none", "—"));
  }

  const notesCell = element(doc, "td", "wax-catalog-notes");
  notesCell.append(
    element(doc, "p", "", support.summary),
    capabilityList(doc, support),
  );
  if (support.caveat) notesCell.append(element(doc, "p", "wax-catalog-caveat", support.caveat));

  row.append(nameCell, recommendedCell, alsoCell, notesCell);
  return row;
}

export function renderWaxRoleCatalog(root, controls = {}) {
  if (!root?.ownerDocument) return null;
  const doc = root.ownerDocument;
  const searchInput = controls.searchInput ?? doc.querySelector("[data-wax-role-search]");
  const roleSelect = controls.roleSelect ?? doc.querySelector("[data-wax-role-filter]");
  const results = controls.results ?? doc.querySelector("[data-wax-role-results]");
  const table = element(doc, "table", "wax-catalog-table");
  const caption = element(
    doc,
    "caption",
    "sr-only",
    "Recommended and compatible WAX wrapper roles for every Morphazoid instrument",
  );
  const head = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  for (const label of ["Instrument", "Recommended", "Also works", "Routing and status"]) {
    const cell = element(doc, "th", "", label);
    cell.scope = "col";
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement("tbody");
  table.append(caption, head, body);
  root.replaceChildren(table);

  const update = () => {
    const matches = filterWaxSupport({
      query: searchInput?.value,
      role: roleSelect?.value ?? "all",
    });
    body.replaceChildren(...matches.map((support) => createSupportRow(doc, support)));
    if (!matches.length) {
      const row = element(doc, "tr", "wax-catalog-empty");
      const cell = element(doc, "td", "", "No instruments match those filters.");
      cell.colSpan = 4;
      row.append(cell);
      body.append(row);
    }
    if (results) {
      results.textContent = `${matches.length} ${matches.length === 1 ? "instrument" : "instruments"}`;
    }
    return matches;
  };

  searchInput?.addEventListener("input", update);
  roleSelect?.addEventListener("change", update);
  update();

  return Object.freeze({ root, table, body, update, waxSupportForId });
}

if (typeof document !== "undefined") {
  for (const root of document.querySelectorAll("[data-wax-role-catalog]")) {
    renderWaxRoleCatalog(root);
  }
}

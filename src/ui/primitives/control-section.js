import {
  appendContent,
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
} from "../internal.js";

/** Create a themed control group backed by details/summary when collapsible. */
export function createControlSection(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const collapsible = options.collapsible !== false;
  const root = doc.createElement(collapsible ? "details" : "section");
  root.className = classNames(
    "mz-control-section",
    "control-section",
    "group",
    !collapsible && "mz-control-section--static",
    options.className,
  );
  applyCommonOptions(root, options);
  if (options.section) root.setAttribute("data-section", String(options.section));
  if (collapsible) root.open = options.open !== false;

  const summaryElement = doc.createElement(collapsible ? "summary" : "div");
  summaryElement.className = classNames(
    "mz-control-section__summary",
    "group-summary",
    !collapsible && "static-group-summary",
    options.summaryClassName,
  );

  const titleElement = doc.createElement(options.headingLevel ?? "h2");
  titleElement.className = classNames("mz-control-section__title", "group-title", options.titleClassName);
  titleElement.textContent = String(options.title ?? "Controls");
  summaryElement.append(titleElement);

  const stateElement = doc.createElement("span");
  stateElement.className = classNames("mz-control-section__state", "section-state", options.stateClassName);
  if (options.stateLive) {
    stateElement.setAttribute("aria-live", options.stateLive === true ? "polite" : String(options.stateLive));
  }
  const initialState = options.state ?? options.summary;
  stateElement.textContent = initialState === undefined || initialState === null ? "" : String(initialState);
  if (stateElement.textContent || options.showEmptyState) summaryElement.append(stateElement);

  const body = doc.createElement("div");
  body.className = classNames("mz-control-section__body", "group-body", options.bodyClassName);
  appendContent(body, options.children ?? options.content, doc);
  root.append(summaryElement, body);

  const setOpen = (open) => {
    if (collapsible) root.open = Boolean(open);
    return collapsible ? root.open : true;
  };
  const setState = (state) => {
    stateElement.textContent = state === undefined || state === null ? "" : String(state);
    if (stateElement.textContent || options.showEmptyState) {
      if (stateElement.parentNode !== summaryElement) summaryElement.append(stateElement);
    } else {
      stateElement.remove?.();
    }
    return stateElement.textContent;
  };
  const appendToBody = (...children) => {
    appendContent(body, children, doc);
    return root;
  };
  const handleToggle = (event) => options.onToggle?.(root.open, event, root);
  if (collapsible) root.addEventListener("toggle", handleToggle);

  defineApi(root, {
    summaryElement,
    titleElement,
    stateElement,
    body,
    collapsible,
    setOpen,
    setState,
    appendToBody,
    destroy() {
      if (collapsible) root.removeEventListener("toggle", handleToggle);
    },
  });
  defineGetter(root, "isOpen", () => collapsible ? Boolean(root.open) : true);
  return root;
}

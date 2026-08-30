const CONTROL_SELECTOR = [
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='slider']",
  "[role='switch']",
  "[role='tab']",
].join(",");

export async function collectControlInventory(page) {
  return page.evaluate((selector) => {
    const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const labelledByText = (element) => text(
      (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    );
    const associatedLabel = (element) => {
      if (element.labels?.length) return text([...element.labels].map((label) => label.textContent).join(" "));
      if (element.id) {
        const label = [...document.querySelectorAll("label")]
          .find((candidate) => candidate.htmlFor === element.id);
        if (label) return text(label.textContent);
      }
      return text(element.closest("label")?.textContent);
    };
    const accessibleName = (element) => (
      text(element.getAttribute("aria-label"))
      || labelledByText(element)
      || associatedLabel(element)
      || text(element.getAttribute("title"))
      || (/^(BUTTON|SUMMARY)$/.test(element.tagName) ? text(element.textContent) : "")
    );
    const sectionName = (element) => {
      const section = element.closest("fieldset, details, section, article, aside");
      if (!section) return "page";
      return text(
        section.querySelector(":scope > legend, :scope > summary, :scope > h1, :scope > h2, :scope > h3")
          ?.textContent,
      ) || section.id || section.className || section.tagName.toLowerCase();
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const stableSelector = (element, index) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const testId = element.getAttribute("data-testid");
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      return `${element.tagName.toLowerCase()}:nth-control(${index + 1})`;
    };

    const duplicateIds = [...document.querySelectorAll("[id]")]
      .map((element) => element.id)
      .filter((id, index, ids) => id && ids.indexOf(id) !== index)
      .filter((id, index, ids) => ids.indexOf(id) === index);

    const controls = [...document.querySelectorAll(selector)].map((element, index) => {
      const rect = element.getBoundingClientRect();
      const type = element.getAttribute("type") || element.getAttribute("role") || element.tagName.toLowerCase();
      const nativeRange = element instanceof HTMLInputElement && element.type === "range";
      const ariaSlider = element.getAttribute("role") === "slider";
      const numeric = nativeRange || ariaSlider;
      const min = nativeRange
        ? (element.getAttribute("min") ?? "0")
        : element.getAttribute("aria-valuemin");
      const max = nativeRange
        ? (element.getAttribute("max") ?? "100")
        : element.getAttribute("aria-valuemax");
      const step = nativeRange ? (element.getAttribute("step") ?? "1") : null;
      const value = nativeRange ? element.value : element.getAttribute("aria-valuenow");
      const numericValues = numeric
        ? {
          min: Number(min),
          max: Number(max),
          step: step === null ? null : step === "any" ? "any" : Number(step),
          value: Number(value),
        }
        : null;
      const numericValid = !numeric || (
        Number.isFinite(numericValues.min)
        && Number.isFinite(numericValues.max)
        && numericValues.min <= numericValues.max
        && Number.isFinite(numericValues.value)
        && numericValues.value >= numericValues.min
        && numericValues.value <= numericValues.max
        && (
          ariaSlider
          || numericValues.step === "any"
          || (Number.isFinite(numericValues.step) && numericValues.step > 0)
        )
      );

      return {
        selector: stableSelector(element, index),
        tag: element.tagName.toLowerCase(),
        type,
        id: element.id || null,
        name: accessibleName(element),
        section: sectionName(element),
        visible: isVisible(element),
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        numeric: numericValues,
        numericValid,
        options: element instanceof HTMLSelectElement
          ? [...element.options].map((option) => ({
            value: option.value,
            label: text(option.textContent),
            disabled: option.disabled,
          }))
          : null,
      };
    });

    return {
      url: location.href,
      title: document.title,
      duplicateIds,
      controls,
      summary: {
        total: controls.length,
        visible: controls.filter((control) => control.visible).length,
        unlabeledVisible: controls.filter((control) => control.visible && !control.name).length,
        invalidNumeric: controls.filter((control) => !control.numericValid).length,
        emptySelects: controls.filter((control) => control.options && control.options.length === 0).length,
      },
    };
  }, CONTROL_SELECTOR);
}

export async function exerciseRangeMathematics(page) {
  return page.evaluate(() => {
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const results = [];
    for (const input of document.querySelectorAll("input[type='range']")) {
      if (input.disabled) {
        results.push({
          id: input.id || null,
          label: input.getAttribute("aria-label") || input.closest("label")?.textContent?.trim() || null,
          skipped: "disabled",
        });
        continue;
      }
      const min = Number(input.min);
      const max = Number(input.max);
      const step = input.step === "any" ? null : Number(input.step || 1);
      const original = input.value;
      const originalNumber = input.valueAsNumber;
      const output = input.id
        ? [...document.querySelectorAll("output")].find((candidate) => (
          (candidate.htmlFor?.contains?.(input.id))
          || candidate.getAttribute("for")?.split(/\s+/).includes(input.id)
        ))
        : null;
      const initialOutput = output?.textContent ?? null;
      const requested = [min, (min + max) / 2, max];
      const observations = [];
      for (const value of requested) {
        const stepped = step && Number.isFinite(step)
          ? min + Math.round((value - min) / step) * step
          : value;
        const expected = clamp(stepped, min, max);
        input.value = String(expected);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        observations.push({
          requested: value,
          expected,
          actual: input.valueAsNumber,
          output: output?.textContent ?? null,
        });
      }
      input.value = original;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      results.push({
        id: input.id || null,
        label: input.getAttribute("aria-label") || input.closest("label")?.textContent?.trim() || null,
        min,
        max,
        step,
        original: originalNumber,
        initialOutput,
        observations,
        restored: Number.isFinite(input.valueAsNumber)
          && Math.abs(input.valueAsNumber - originalNumber) <= Math.max(1e-9, (step || 0) / 2),
        finite: observations.every(({ actual }) => Number.isFinite(actual)),
        matchesRequested: observations.every(({ actual, expected }) => (
          Math.abs(actual - expected) <= Math.max(1e-9, (step || 0) / 2)
        )),
        bounded: observations.every(({ actual }) => {
          const tolerance = Math.max(1e-9, (step || 0) / 2);
          return actual >= min - tolerance && actual <= max + tolerance;
        }),
      });
    }
    return results;
  });
}

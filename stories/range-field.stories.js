import { createRangeField } from "../src/ui/index.js";
import "./catalog.css";

const FORMATTERS = {
  plain: (value) => String(value),
  frequency: (value) => `${Math.round(Number(value))} Hz`,
  percent: (value) => `${Math.round(Number(value) * 100)}%`,
  octaves: (value) => `${Number(value).toFixed(2)} oct`,
  detailed: (value) => `${Number(value).toFixed(3)} semitones mapped`,
};

function renderRange({ format, ...args }) {
  const panel = document.createElement("div");
  panel.className = "mz-story-panel";
  panel.append(createRangeField({
    ...args,
    formatValue: FORMATTERS[format] ?? FORMATTERS.plain,
  }));
  return panel;
}

export default {
  title: "Primitives/Range Field",
  component: createRangeField,
  tags: ["autodocs"],
  render: renderRange,
  args: {
    label: "Base frequency",
    name: "base-frequency",
    min: 20,
    max: 440,
    step: 1,
    value: 110,
    format: "frequency",
    disabled: false,
  },
  argTypes: {
    format: {
      control: "select",
      options: Object.keys(FORMATTERS),
    },
    min: { control: "number" },
    max: { control: "number" },
    step: { control: "number" },
    value: { control: "number" },
  },
  parameters: {
    docs: {
      description: {
        component: "A labeled native range input with a live formatted output and optional supporting description.",
      },
    },
  },
};

export const BaseFrequency = {};

export const WithDescription = {
  args: {
    description: "Sets the fundamental before pitch mapping is applied.",
  },
};

export const Minimum = {
  args: {
    value: 20,
  },
};

export const Maximum = {
  args: {
    value: 440,
  },
};

export const AccessibleValueText = {
  args: {
    value: 440,
    inputAttributes: {
      "aria-valuetext": "A4, 440 hertz",
    },
  },
};

export const Percentage = {
  args: {
    label: "Contact level",
    name: "contact-level",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.38,
    format: "percent",
    description: "Scales each contact before the master output stage.",
  },
};

export const FineResolution = {
  args: {
    label: "Pitch range",
    name: "pitch-range",
    min: 0,
    max: 6,
    step: 0.05,
    value: 3.5,
    format: "octaves",
    description: "Fine-grained values remain readable without widening the control.",
  },
};

export const LongFormattedValue = {
  args: {
    label: "Pitch displacement",
    name: "pitch-displacement",
    min: -12,
    max: 12,
    step: 0.001,
    value: 7.125,
    format: "detailed",
  },
};

export const Disabled = {
  args: {
    label: "Stereo width",
    name: "stereo-width",
    min: 0,
    max: 1,
    step: 0.01,
    value: 0.8,
    format: "percent",
    description: "Unavailable until a stereo output is selected.",
    disabled: true,
  },
};

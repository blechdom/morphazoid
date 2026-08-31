import { createRangeField } from "../src/ui/index.js";
import "./catalog.css";

const FORMATTERS = {
  plain: (value) => String(value),
  frequency: (value) => `${Math.round(Number(value))} Hz`,
  percent: (value) => `${Math.round(Number(value) * 100)}%`,
  octaves: (value) => `${Number(value).toFixed(2)} oct`,
};

function renderRange({ format, ...args }) {
  return createRangeField({
    ...args,
    formatValue: FORMATTERS[format] ?? FORMATTERS.plain,
  });
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
    description: "Sets the fundamental before pitch mapping is applied.",
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

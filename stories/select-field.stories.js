import { createSelectField } from "../src/ui/index.js";
import "./catalog.css";

const SYNTH_OPTIONS = [
  { value: "sine", label: "Sine oscillators · corner envelope" },
  { value: "percussion", label: "Percussion · corner strikes" },
  { value: "shepard", label: "Shepard glissandi · cyclic pitch illusion" },
  { value: "fm", label: "FM synthesis · mapped modulation index" },
  { value: "pm", label: "PM synthesis · mapped phase depth" },
];

export default {
  title: "Primitives/Select Field",
  component: createSelectField,
  tags: ["autodocs"],
  render: (args) => createSelectField(args),
  args: {
    label: "Synth",
    name: "synth-mode",
    value: "sine",
    options: SYNTH_OPTIONS,
    description: "Choose a voice model; synthesis remains outside the UI component.",
    disabled: false,
  },
  argTypes: {
    options: { control: "object" },
    value: {
      control: "select",
      options: SYNTH_OPTIONS.map(({ value }) => value),
    },
  },
  parameters: {
    docs: {
      description: {
        component: "A labeled native select with consistent field chrome, long-option handling, and disabled options.",
      },
    },
  },
};

export const SynthMode = {};

export const LongOptions = {
  args: {
    label: "Pitch source",
    name: "pitch-source",
    value: "angle-shape",
    options: [
      { value: "angle-shape", label: "Angular position combined with tile and edge shape" },
      { value: "orientation", label: "Edge orientation in fixed stage coordinates" },
      { value: "reader", label: "Reader position along the complete path" },
      { value: "radius", label: "Logarithmic distance from the pattern origin" },
    ],
    description: "Long labels truncate visually while the native control retains their full text.",
  },
  argTypes: {
    value: {
      control: "select",
      options: ["angle-shape", "orientation", "reader", "radius"],
    },
  },
};

export const OptionUnavailable = {
  args: {
    label: "Output device",
    name: "output-device",
    value: "default",
    options: [
      { value: "default", label: "System default" },
      { value: "interface", label: "External audio interface", disabled: true },
    ],
    description: "Individual options can explain capabilities detected elsewhere.",
  },
  argTypes: {
    value: {
      control: "select",
      options: ["default", "interface"],
    },
  },
};

export const Disabled = {
  args: {
    label: "MIDI input",
    name: "midi-input",
    value: "none",
    options: [{ value: "none", label: "No devices available" }],
    description: "The catalog does not request MIDI access.",
    disabled: true,
  },
  argTypes: {
    value: {
      control: "select",
      options: ["none"],
    },
  },
};

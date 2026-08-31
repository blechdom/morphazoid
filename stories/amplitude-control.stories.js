import { createAmplitudeControl } from "../src/ui/patterns/index.js";
import "./catalog.css";

const PRESETS = ["pluck", "note", "sustain", "pad"];

function renderAmplitude({ label, timing, preset, level, enabled, swell }) {
  const frame = document.createElement("section");
  frame.className = "mz-envelope-story";
  frame.dataset.section = "sound";

  const host = document.createElement("div");
  const controller = createAmplitudeControl(host, { label, timing });

  if (preset !== "sustain") {
    host.querySelector(`[data-preset="${preset}"]`)?.click();
  }
  controller.applyState({ enabled, swell, level });

  frame.append(host);
  return frame;
}

export default {
  title: "Patterns/Amplitude Control",
  component: createAmplitudeControl,
  tags: ["autodocs"],
  render: renderAmplitude,
  args: {
    label: "Contact amplitude ADSR",
    timing: "phase",
    preset: "sustain",
    level: 1,
    enabled: true,
    swell: false,
  },
  argTypes: {
    timing: {
      control: "inline-radio",
      options: ["phase", "milliseconds"],
    },
    preset: {
      control: "select",
      options: PRESETS,
    },
    level: {
      control: { type: "range", min: 0, max: 1, step: 0.01 },
    },
    enabled: { control: "boolean" },
    swell: {
      control: "boolean",
      if: { arg: "timing", eq: "phase" },
    },
  },
  parameters: {
    docs: {
      description: {
        component: "The existing reusable amplitude-envelope editor shown without an audio engine. Drag nodes or choose a preset to inspect its UI behavior.",
      },
    },
  },
};

export const PhaseEnvelope = {};

export const Pluck = {
  args: {
    preset: "pluck",
    level: 0.82,
  },
};

export const Swell = {
  args: {
    preset: "pad",
    swell: true,
  },
};

export const Milliseconds = {
  args: {
    label: "Percussion amplitude ADSR",
    timing: "milliseconds",
    preset: "note",
    level: 0.9,
  },
};

export const Disabled = {
  args: {
    enabled: false,
  },
};

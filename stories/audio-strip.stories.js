import { createAudioStrip } from "../src/ui/index.js";
import "./catalog.css";

function renderAudioStrip(args) {
  const shell = document.createElement("div");
  shell.className = "mz-story-audio-strip";
  shell.append(createAudioStrip(args));
  return shell;
}

function renderLifecycle() {
  const root = document.createElement("div");
  root.className = "mz-state-list";

  const states = [
    ["Off", { audioState: "off" }],
    ["Starting", { audioState: "starting", audioDisabled: true }],
    ["On", { audioState: "on" }],
    ["Unavailable", { audioState: "error" }],
    ["Needs attention", { audioState: "off", attention: true }],
  ];

  for (const [title, options] of states) {
    const surface = document.createElement("div");
    surface.className = "mz-state-list__item";
    const heading = document.createElement("span");
    heading.className = "mz-state-list__label";
    heading.textContent = title;
    const content = document.createElement("div");
    content.className = "mz-state-list__content";
    content.append(createAudioStrip({
      level: 0.56,
      ...options,
    }));
    surface.append(heading, content);
    root.append(surface);
  }
  return root;
}

function renderAccent() {
  const shell = document.createElement("div");
  shell.className = "mz-story-audio-strip mz-story-audio-strip--violet";
  shell.append(createAudioStrip({
    audioState: "on",
    level: 0.72,
    levelLabel: "Output",
  }));
  return shell;
}

export default {
  title: "Patterns/Audio Controls",
  component: createAudioStrip,
  tags: ["autodocs"],
  render: renderAudioStrip,
  args: {
    audioState: "off",
    levelLabel: "Master level",
    level: 0.56,
    min: 0,
    max: 1,
    step: 0.01,
    attention: false,
    audioDisabled: false,
    levelDisabled: false,
  },
  argTypes: {
    audioState: {
      control: "select",
      options: ["off", "starting", "on", "error"],
    },
    level: {
      control: { type: "range", min: 0, max: 1, step: 0.01 },
    },
  },
  parameters: {
    docs: {
      description: {
        component: "The compact speaker switch and master-level pair used across Morphazoid mastheads. It owns DOM state only; applications supply audio lifecycle behavior.",
      },
    },
  },
};

export const HeaderAudio = {};

export const AudioOn = {
  args: {
    audioState: "on",
    level: 0.65,
    levelLabel: "Volume",
  },
};

export const Starting = {
  args: {
    audioState: "starting",
    audioDisabled: true,
  },
};

export const PageAccent = {
  render: renderAccent,
  parameters: {
    controls: { disable: true },
  },
};

export const Lifecycle = {
  render: renderLifecycle,
  parameters: {
    controls: { disable: true },
  },
};

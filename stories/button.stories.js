import { createButton } from "../src/ui/index.js";
import "./catalog.css";

function renderPanelButton(args) {
  const panel = document.createElement("div");
  panel.className = "mz-story-panel";
  panel.append(createButton(args));
  return panel;
}

function makeStateMatrix() {
  const root = document.createElement("div");
  root.className = "mz-state-list";

  const groups = [
    {
      title: "Compact actions",
      buttons: [
        { label: "Reset 90°", variant: "mini" },
        { label: "Apply mapping", variant: "primary", size: "compact" },
        { label: "Quiet", variant: "quiet" },
        { label: "Delete bank", variant: "danger", size: "compact" },
        { label: "Disabled", variant: "mini", disabled: true },
      ],
    },
    {
      title: "Transport",
      buttons: [
        { label: "Play", variant: "play", size: "square", toggle: true, pressed: false },
        { label: "Pause", variant: "play", size: "square", toggle: true, pressed: true },
        { label: "Pluck selected string", variant: "play", size: "square", toggle: false },
      ],
    },
    {
      title: "Audio lifecycle",
      buttons: [
        { label: "Audio off", variant: "audio", size: "square", audioState: "off" },
        { label: "Audio starting", variant: "audio", size: "square", audioState: "starting" },
        { label: "Audio on", variant: "audio", size: "square", audioState: "on" },
        { label: "Audio error", variant: "audio", size: "square", audioState: "error" },
        { label: "Audio needs attention", variant: "audio", size: "square", audioState: "off", attention: true },
      ],
    },
    {
      title: "Panel reset",
      buttons: [
        { label: "Reset all parameters", variant: "reset" },
      ],
    },
  ];

  groups.forEach(({ title, buttons }) => {
    const surface = document.createElement("div");
    surface.className = "mz-state-list__item";
    const heading = document.createElement("span");
    heading.className = "mz-state-list__label";
    heading.textContent = title;
    const row = document.createElement("div");
    row.className = "mz-state-list__content";
    row.append(...buttons.map((options) => createButton(options)));
    surface.append(heading, row);
    root.append(surface);
  });

  return root;
}

export default {
  title: "Primitives/Button",
  component: createButton,
  tags: ["autodocs"],
  render: (args) => createButton(args),
  args: {
    label: "Reset vertices",
    variant: "mini",
    size: "default",
    disabled: false,
    audioState: "off",
    attention: false,
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "mini", "reset", "primary", "quiet", "danger", "play", "audio"],
    },
    size: {
      control: "select",
      options: ["default", "compact", "square"],
    },
    audioState: {
      control: "select",
      options: ["off", "starting", "on", "error"],
      if: { arg: "variant", eq: "audio" },
    },
    attention: {
      control: "boolean",
      if: { arg: "variant", eq: "audio" },
    },
  },
  parameters: {
    docs: {
      description: {
        component: "A native button with Morphazoid action, transport, and audio-state variants. Runtime audio and transport behavior stays outside the component.",
      },
    },
  },
};

export const Playground = {};

export const Generic = {
  args: {
    label: "Generic action",
    variant: "default",
  },
};

export const MiniAction = {
  args: {
    label: "Reset 90°",
    variant: "mini",
  },
};

export const PanelReset = {
  render: renderPanelButton,
  args: {
    label: "Reset all parameters",
    variant: "reset",
  },
};

export const Primary = {
  args: {
    label: "Apply mapping",
    variant: "primary",
  },
};

export const AudioOff = {
  args: {
    label: "Audio",
    variant: "audio",
    size: "square",
    audioState: "off",
  },
};

export const AudioOn = {
  args: {
    label: "Audio",
    variant: "audio",
    size: "square",
    audioState: "on",
  },
};

export const PlayRunning = {
  args: {
    label: "Pause playhead",
    variant: "play",
    size: "square",
    toggle: true,
    pressed: true,
  },
};

export const PlayTrigger = {
  args: {
    label: "Pluck selected string",
    variant: "play",
    size: "square",
    toggle: false,
  },
};

export const AudioStarting = {
  args: {
    label: "Audio starting",
    variant: "audio",
    size: "square",
    audioState: "starting",
  },
};

export const AudioUnavailable = {
  args: {
    label: "Audio",
    variant: "audio",
    size: "square",
    audioState: "error",
  },
};

export const Disabled = {
  args: {
    label: "Unavailable",
    variant: "mini",
    disabled: true,
  },
};

export const StateMatrix = {
  render: makeStateMatrix,
  parameters: {
    controls: { disable: true },
  },
};

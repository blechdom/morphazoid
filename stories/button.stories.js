import { createButton } from "../src/ui/index.js";
import "./catalog.css";

function makeStateMatrix() {
  const root = document.createElement("section");
  root.className = "mz-story mz-story--narrow";
  root.innerHTML = `
    <h1>Button states</h1>
    <p class="mz-story__intro">Visual states are data only. These specimens never create an AudioContext or start a transport.</p>
  `;

  const groups = [
    {
      title: "Actions",
      buttons: [
        { label: "Default", variant: "default" },
        { label: "Primary", variant: "primary" },
        { label: "Quiet", variant: "quiet" },
        { label: "Delete", variant: "danger" },
        { label: "Disabled", variant: "default", disabled: true },
      ],
    },
    {
      title: "Transport",
      buttons: [
        { label: "Play", variant: "play", size: "square", pressed: false },
        { label: "Pause", variant: "play", size: "square", pressed: true },
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
  ];

  groups.forEach(({ title, buttons }) => {
    const surface = document.createElement("div");
    surface.className = "mz-story__surface";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const row = document.createElement("div");
    row.className = "mz-story__row";
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
    label: "Reset form",
    variant: "default",
    size: "default",
    pressed: false,
    disabled: false,
    audioState: "off",
    attention: false,
  },
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "primary", "quiet", "danger", "play", "audio"],
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

export const Primary = {
  args: {
    label: "Apply mapping",
    variant: "primary",
  },
};

export const PlayRunning = {
  args: {
    label: "Pause playhead",
    variant: "play",
    size: "square",
    pressed: true,
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

export const Disabled = {
  args: {
    label: "Unavailable",
    disabled: true,
  },
};

export const StateMatrix = {
  render: makeStateMatrix,
  parameters: {
    controls: { disable: true },
  },
};

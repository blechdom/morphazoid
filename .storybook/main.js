const config = {
  stories: ["../stories/**/*.stories.@(js|mjs)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
};

export default config;

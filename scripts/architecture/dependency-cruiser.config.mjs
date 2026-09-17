// Initial characterization only: violations remain visible warnings.
// Do not baseline/ignore them or turn this into a release gate without review.
export default {
  forbidden: [
    {
      name: "circular-runtime-imports",
      severity: "warn",
      from: {},
      to: { circular: true },
    },
    {
      name: "unresolved-runtime-imports",
      severity: "warn",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "shared-ui-must-not-own-instrument-runtime",
      severity: "warn",
      from: { path: "^src/ui/" },
      to: {
        path: "^(?:(?:[^/]+-app|app|nav)\\.js$|src/(?:instruments|families|audio)/|src/(?:audio|midi-manager|browser-midi-adapter)\\.js$)",
      },
    },
  ],
  options: {
    doNotFollow: { path: "(^|/)(node_modules|vendor)/" },
    // AssemblyScript is not browser TypeScript. Its kernel source remains on
    // the existing compiler/check:simd-wasm path, not this JS import graph.
    exclude: {
      path: "(^|/)(tests|e2e|dist|dist-wax|test-results|storybook-static)/|\\.ts$",
    },
  },
};

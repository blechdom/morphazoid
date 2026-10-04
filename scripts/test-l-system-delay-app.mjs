#!/usr/bin/env node
// Compatibility entry for the public browser instrument. Native CPAL remains
// covered by the Rust workspace Cargo, proxy, and CLI suites.
if (process.argv.includes('--native')) {
  throw new Error('--native is not a browser acceptance mode. Use the Rust workspace Cargo tests and CPAL CLI for native-device checks. The published instrument uses WebAssembly.');
}
await import('./test-l-system-delay-wasm.mjs');

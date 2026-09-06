# Contributing to Morphazoid

Morphazoid is a static collection of playable browser instruments, plus native
JUCE/VST3 and REAPER targets. Keep each change focused, preserve existing
instruments and routes, and verify the surface you changed.

## Start here

Install the locked development dependencies from the repository root:

```sh
npm ci
```

Use Node.js 24 for local parity with the canonical AWS workflow. The retained
GitHub Pages mirror also verifies on Node.js 22, so runtime-sensitive build
changes must remain compatible with both active workflows. Python 3 and Bash
are also required by the development server and release scripts. Do not add a
runtime dependency to the public site: production remains plain HTML, CSS, ES
modules, Canvas, and Web Audio.

Before editing, inspect the repository root, branch, worktree, status, diff,
and relevant nearby implementation. This repository is often used by several
worktrees at once, so preserve unrelated tracked and untracked work.

## Repository map

| Path | Purpose |
| --- | --- |
| Root `*.html`, `*.css`, and `*-app.js` files | Authored browser pages and page controllers |
| `src/` | Shared and instrument-owned ES modules, DSP, AudioWorklets, and UI primitives |
| `assets/`, `artwork/`, and `vendor/` | Runtime assets, source artwork, and attributed third-party code/data |
| `contracts/` | Versioned browser, MIDI, transport, and host behavior contracts |
| `tests/` | Node tests |
| `e2e/` | Playwright browser, accessibility, responsive, MIDI, and audio tests |
| `stories/` and `.storybook/` | Static component-catalog stories and configuration |
| `dist-wax/` | Committed generated WAX output; never edit it directly |
| `plugins/` | Native JUCE/VST3 and REAPER targets and their specific instructions |
| `infra/` and `.github/workflows/` | AWS infrastructure and GitHub deployment automation |
| `.agents/skills/` | Focused, repository-scoped agent workflows |
| `docs/` | Focused architecture and maintenance guides |

The root [AGENTS.md](AGENTS.md) contains durable rules shared by coding agents.
The [agent-tooling guide](docs/agent-tooling.md) explains when guidance belongs
in `AGENTS.md`, a skill, an MCP server, human documentation, or executable
tests. Do not duplicate those rules in provider-specific instruction files.

## Develop and build

Start the browser preview with:

```sh
npm run dev
```

Open the exact URL printed by the server. It starts at port `3435` and selects
the next available port when needed. Playwright always targets
`http://127.0.0.1:3435`; confirm that endpoint serves this worktree before
reusing an existing server.

The package manifest is the source of truth for commands:

| Command | Purpose |
| --- | --- |
| `npm run check` | Parse the authored JavaScript and build tooling. |
| `npm test` | Run Node tests in `tests/` and `morphazoidical/tests/`. |
| `npm run verify` | Run `check`, Node tests, and committed WAX parity. |
| `npm run build:wax` | Regenerate the committed `dist-wax/` tree. |
| `npm run build:site` | Assemble the public site and hosted WAX site in ignored `dist/`. |
| `npm run storybook` | Run the component catalog locally. |
| `npm run build:storybook` | Generate the static component catalog in its default `storybook-static/` directory. |
| `npm run build:deploy` | Build the public site, hosted WAX site, and Storybook under `dist/`. |
| `npm run check:storybook-dist` | Validate an existing Storybook artifact at `dist/storybook`. |
| `npm run analyze:julia-similarity` | Run the optional Julia-family similarity report. |

`dist/` and `storybook-static/` are disposable build outputs. `dist-wax/` is a
committed compatibility artifact: change authored sources, run
`npm run build:wax`, review the generated diff, and finish with
`npm run check:wax-dist` or `npm run verify`.

## Coding and interface conventions

- Preserve the framework-free architecture and use browser-native APIs.
- Follow the style of the surrounding file. Avoid broad reformatting in a
  behavioral change.
- Schedule musical events from `AudioContext.currentTime`, keep rendering and
  voice counts bounded, smooth live parameter changes, and release every node,
  listener, timer, device, and animation frame during teardown.
- Keep Audio arming separate from transport. Follow the versioned contracts in
  `contracts/` rather than reproducing their rules in page code.
- Prefer native labelled controls and outputs. Give every Canvas an accessible
  name or alternative, and give an interactive Canvas keyboard operation and
  visible focus.
- Reuse `src/ui/` and the patterns in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).
  Extract a shared component only for two real consumers or a project-wide
  contract; keep synthesis, simulation, and domain-specific Canvas behavior in
  the instrument.
- Keep catalogue registration synchronized across `nav.js`,
  `src/instrument-catalog.js`, and
  `src/instrument-midi-capabilities.js`. Tests should compare IDs and records
  across those inventories rather than pinning the current total. Keep an
  explicit count only when cardinality itself is a reviewed product contract.
- Preserve factual provenance and third-party licenses in source documentation
  and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Choose verification by change

Start with the narrowest relevant test, then run the required repository gate.

| Change | Minimum verification |
| --- | --- |
| Browser JavaScript, HTML, CSS, shared UI, or Web Audio | Focused Node tests, `npm run verify`, and the applicable Playwright suite from [QA_AUTOMATION.md](QA_AUTOMATION.md) |
| WAX-visible browser runtime | Browser verification plus `npm run build:wax` and `npm run check:wax-dist` |
| Responsive layout or accessibility | `npm run test:browser:audit` and a manual keyboard/touch pass where applicable |
| MIDI or transport | `npm run test:browser:midi` plus the relevant contract tests and a real-device pass when claiming hardware behavior |
| Audible identity, presets, transitions, or control leverage | Mechanical tests plus a documented listening pass; automation alone cannot approve timbre |
| Storybook or shared component catalog | `npm run build:storybook -- --output-dir dist/storybook`, then `npm run check:storybook-dist`, after the normal browser checks |
| Release assembly | `npm run build:deploy`; inspect the exact generated root before publication |
| Native or REAPER code | Follow [plugins/README.md](plugins/README.md) and the nearest subtree README |
| Documentation only | Check commands, links, paths, and source-derived facts; run affected generators or tests when the prose describes executable behavior |

`npm run verify` does not run Playwright or build Storybook. See
[QA_AUTOMATION.md](QA_AUTOMATION.md) for the browser commands, strict audit
modes, artifacts, and manual release boundary.

## Documentation maintenance

- Keep `README.md` concise and public-facing; link to focused details.
- Keep human setup, build, coding, and review guidance here.
- Keep always-on agent invariants in `AGENTS.md`; keep task-specific reusable
  workflows in `.agents/skills/`.
- Put protocol contracts in `contracts/`, operational details next to their
  implementation, and substantial cross-cutting explanations in `docs/`.
- Derive inventories from source modules or tests. Do not describe a changing
  route, instrument, preset, or capability count as permanently current.
- Update the relevant documentation in the same change as a command, public
  behavior, schema, deployment process, or compatibility contract.

## Pull requests

Use the repository pull-request template. Summarize the user-visible outcome,
list exact verification commands and results, distinguish automated evidence
from manual listening/device checks, and call out generated files. Keep
unrelated work, local configuration, credentials, reports, and screenshots out
of the change.

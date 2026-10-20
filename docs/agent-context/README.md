# Start here: agents working on Morphazoid

`AGENTS.md` is the shared policy. `CLAUDE.md` and `GEMINI.md` only point to it;
do not maintain parallel copies of rules. Never search neighboring repositories
or agent-wide caches for project context: see the
[personal-work boundary](memory-workflow.md#scope-and-safety).

| Task | First stop | Deeper reference |
| --- | --- | --- |
| Find the active code for an instrument | `node scripts/inspect-instrument.mjs <catalogue-id> --json` | [Worktree/source map](../agent-tooling.md#worktree-and-source-paths) and actual page imports |
| Design a new graphic/sound gesture | [Creative direction](creative-direction.md) and `$morphazoid-idea-development` | `docs/DESIGN_SYSTEM.md`; two relevant sibling instruments |
| Build, rename, or integrate an instrument | `$morphazoid-instrument-development` | [Integration checklist](../../.agents/skills/morphazoid-instrument-development/references/integration-checklist.md) and `src/pages/manifest.js` |
| Check mechanical UI/audio behavior | `$morphazoid-responsive-audio-qa` | `docs/QA_AUTOMATION.md`; `contracts/audio-transport-v1.md` |
| Judge sound or control audibility | `$morphazoid-perceptual-qa` | Its listening-pass reference; do not infer sound quality from code tests |
| Learn safely from personal task history | `$morphazoid-history-synthesis` | [Creative direction](creative-direction.md) and [memory workflow](memory-workflow.md) |
| Save or synchronize a durable observation | `$morphazoid-agent-memory` | [Private opt-in memory workflow](memory-workflow.md); never commit notes here |
| Commit, reconcile, or publish | `$morphazoid-safe-publish` | `git status`; staged diff and privacy audit |

## Quick instrument path

1. From the **actual** checkout, identify the root/branch/status with Git.
   Never assume a directory name, preview URL, or historical report is current.
2. Inspect the catalogue ID with the read-only helper. It reports registration,
   page imports, owned modules, assets, WAX copies, and candidate tests; its
   output is a map, **not** a readiness verdict. If Node is unavailable, follow
   the page's imports and the [source map](../agent-tooling.md#worktree-and-source-paths)
   manually rather than guessing paths.
3. Compare two relevant siblings, declare the primary gesture → visible state
   → audible result, and build the smallest complete playable slice. Keep
   `docs/agent-context/creative-direction.md` and the transport contract in view.
4. Use the instrument skill's integration checklist, run focused checks before
   broad verification, and report what was actually exercised or heard.

Keep task-specific decisions in code/tests or focused instrument docs. Optional
private, reviewed notes are dated *evidence*: check current code and user intent
before treating one as a useful reference. Never commit them to public Morphazoid.

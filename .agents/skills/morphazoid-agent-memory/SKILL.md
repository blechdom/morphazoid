---
name: morphazoid-agent-memory
description: Capture and synchronize explicitly owner-reviewed observations from personal Morphazoid tasks into repo-local notes. Use when asked to preserve a durable lesson or set up the per-machine memory updater; not for ordinary tasks, raw chat ingestion, or automatic publication.
---

# Morphazoid agent memory

Read `AGENTS.md` and
[`docs/agent-context/memory-workflow.md`](../../../docs/agent-context/memory-workflow.md).
Never read employer/mixed agent stores, tool caches, or neighboring repositories
to create a note. If a history synthesis is explicitly requested, follow
`$morphazoid-history-synthesis` instead; the scheduled updater does not scrape
transcripts.

Only save a concrete, reusable, personal-project observation that the owner can
review. Paraphrase: no chat quotes, session IDs, machine paths, URLs, secrets,
or unverified source claims. Prefer improving existing `AGENTS.md`, a skill,
or a focused document when the finding is an actual standing rule, workflow
correction, or design decision rather than a dated observation.

Use `python3 scripts/agent-memory.py capture --root <dedicated-worktree> ...`
to create a private pending JSON note. Provide a tracked repository path as
evidence when applicable. Tell the owner where to review the pending note and
its ID; do not call `approve --reviewed` on the owner's behalf. A weekly
local cron job runs `sync` and commits only approved notes on a clean
`agent-memory/*` branch. Installation changes the machine's crontab and needs
authorization. Never push or deploy as part of capture or cron; leave that
decision to the owner and `$morphazoid-safe-publish`.

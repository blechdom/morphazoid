---
name: morphazoid-agent-memory
description: Route owner-reviewed personal Morphazoid observations to an optional separate private repo. Use when asked to preserve a durable lesson or set up a per-machine memory updater; not for ordinary tasks, raw chat ingestion, or automatic publication.
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
or unverified source claims. Prefer improving existing public `AGENTS.md`, a
skill, or a focused document when the finding is an actual standing rule,
workflow correction, or design decision rather than a dated observation.

Do not capture anything in public Morphazoid: its updater and notes directory
have been removed. If the owner opts in on this personal machine, use
`MORPHAZOID_PRIVATE_MEMORY_ROOT` from this agent's environment. If unset, check
**only** the explicit owner-only locator
`${XDG_CONFIG_HOME:-$HOME/.config}/morphazoid/memory-root`, not a directory
search. Refuse a missing, symlinked, group/world-readable, non-owner, or
non-absolute locator. Read exactly one absolute path **as data**, never
source or execute the file. Read the private checkout's `AGENTS.md` and
`README.md` and run its `scripts/agent-memory.py preflight` against that exact
root. Never infer a path from another machine or install it as a submodule.
If it is unavailable, explain opt-in; do not improvise a public fallback.

Use the private helper's `capture --project-root <verified-public-checkout>`
to draft a note backed by a tracked personal-project path or Git revision.
Tell the owner where to review the pending note and its ID; **never** run
`approve --reviewed` on the owner's behalf. Optional local cron commits only
approved notes in that private checkout, with no fetch, push, merge, or deploy.
Changing a crontab requires explicit permission. Cross-machine availability
requires separate, owner-reviewed publication to the private repository.

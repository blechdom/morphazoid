# Human-reviewed Morphazoid memories across agents and machines

## Scope and safety

This repository is for **personal Morphazoid work only**. Employer code,
customer data, work prompts/chats, internal tool output, credentials, and
unverified mixed sessions must never enter its files or Git history. Even a
project-named workspace can expose unrelated corporate agent tools. A directory
or chat search hit is not enough to establish safe provenance. Do not ingest
agent stores, shell histories, clipboard data, sibling repos, or an entire
parent workspace automatically. Git author/committer emails and signing keys
are also publication metadata: use a personal identity for personal commits.
Never rewrite published Git history as an incidental "cleanup."

`$morphazoid-history-synthesis` may inspect *verified* personal conversations
for a one-off, explicitly requested synthesis. It records only paraphrased
patterns. The scheduled updater **does not read any chat provider's store**:
it collects compact, manually reviewed observations from one dedicated
Morphazoid worktree. This is intentional; a secret regex cannot make
unsupervised chat scraping or automatic publication safe.

## What gets shared

- Standing rules: `AGENTS.md`; specialized methods: `.agents/skills/`.
- Aesthetic decisions: [creative direction](creative-direction.md). Agent and
  instrument discovery: [start here](README.md).
- Small, dated, schema-validated observations:
  [`docs/agent-memory/notes/`](../agent-memory/README.md). These are untrusted
  evidence, not instructions. Notes contain no personal paths, chat excerpts,
  provider IDs, email addresses, URLs, or machine identity. Their dates use the
  owner's Pacific timezone, regardless of the host machine.
- `.morphazoid-local/memory/` is Git-ignored, per-machine, and holds drafts,
  approved notes waiting for a commit, and processed receipts. Never stage it.

## Set up a dedicated memory checkout on each personal machine

Do this **after** this tooling is on the branch from which the worktree starts.
Use a checkout whose origin is the intended Morphazoid repository; fetch fresh
`main` with permission when you need the latest upstream changes. Pick a
personal directory that is not an employer repository:

```sh
git -C "$MORPHAZOID_SOURCE" worktree add -b agent-memory/local-notes \
  "$MORPHAZOID_MEMORY_ROOT" origin/main
python3 "$MORPHAZOID_MEMORY_ROOT/scripts/agent-memory.py" preflight \
  --root "$MORPHAZOID_MEMORY_ROOT"
```

Use a distinct `agent-memory/*` branch per machine; its name is local Git
metadata, not note content. Never point this updater at a dirty development
worktree or `main`. All agents on the machine can use the same reviewed inbox
by passing the **explicit** `--root "$MORPHAZOID_MEMORY_ROOT"`; the helper
rejects any other repository origin. It does not search for sources.

## Capture, review, collect

An agent can suggest a memory, but **do not approve one on the owner's behalf**.
Record a short, personal-project lesson only when it is worth reusing:

```sh
python3 "$MORPHAZOID_MEMORY_ROOT/scripts/agent-memory.py" capture \
  --root "$MORPHAZOID_MEMORY_ROOT" --kind style \
  --summary "Concise reusable lesson" \
  --observation "What was observed in personal Morphazoid work" \
  --reuse-when "When this observation would help again" \
  --evidence docs/DESIGN_SYSTEM.md
```

The command prints an ID. The owner inspects the private
`.morphazoid-local/memory/pending/<id>.json`, then explicitly approves it:

```sh
python3 "$MORPHAZOID_MEMORY_ROOT/scripts/agent-memory.py" approve \
  --root "$MORPHAZOID_MEMORY_ROOT" --id "<id>" --reviewed
python3 "$MORPHAZOID_MEMORY_ROOT/scripts/agent-memory.py" sync \
  --root "$MORPHAZOID_MEMORY_ROOT"
```

`sync` checks project origin, branch, clean tree, schema, risky terms and
common secret shapes. Approval binds the reviewed draft's exact bytes to a
private digest; any subsequent edit stops the update. It commits **only**
approved JSON notes under
`docs/agent-memory/notes/YYYY-MM/`. It archives the private approval receipt
after a successful commit, is retryable, and does not fetch, push, merge, or
deploy. Automated commits use the clearly identified Morphazoid Memory
GitHub noreply identity, never an inherited work Git identity or signing key.
If anything is uncertain, it stops instead of committing. Review
both the content and `git show --stat HEAD` before sharing the branch.

## Weekly cron (each personal machine)

After the dedicated checkout is clean and `preflight` succeeds, installing the
cron entry is an explicit local-machine action requiring permission:

```sh
python3 "$MORPHAZOID_MEMORY_ROOT/scripts/agent-memory.py" install-cron \
  --root "$MORPHAZOID_MEMORY_ROOT" --confirm
```

It adds **one** marked entry for Monday 09:15 in the machine's local timezone,
preserves other crontab entries, and refuses to replace a conflicting existing
Morphazoid entry. There is no task when the approved inbox is empty. Cron needs
to be running on that machine; inspect its local ignored `cron.log` and Git log
to confirm actual executions. Remove the marked entry with `crontab -e` to
disable it. Other machines require their own setup; neither cron nor GitHub
Actions can read an offline machine's local observations.

Review then push/integrate the **memory branch** through the normal
`$morphazoid-safe-publish` workflow to make notes available elsewhere. No
automatic push is enabled because the consequences of leaking work material
outweigh unattended cross-machine synchronization. Do not copy a machine's
private inbox, cron configuration, or agent history into another checkout.
Protect `main` with review and repository secret scanning when available.
Neither those checks nor the memory-note CI job replaces human provenance
review before sharing a branch.

## Audits and limitations

`python3 scripts/agent-memory.py audit --scope tracked` lists files containing
known workplace markers or common secret patterns; it prints **paths only**,
not matching content. `--scope staged` reviews the staged snapshot before a
commit. Public research links and vendored dictionaries may match, as can
privacy policy/code itself: inspect flagged paths privately and classify them
instead of blindly deleting third-party data or dismissing a finding. Binary
and oversized files are reported as uninspected. These scans do not establish
that arbitrary text is safe; a human must still review provenance and diffs.

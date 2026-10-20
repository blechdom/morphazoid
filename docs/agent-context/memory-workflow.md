# Personal Morphazoid guidance and optional private memories

## Scope and safety

Public Morphazoid is for **personal project work only**. Never include employer
code, prompts, chats, customers, credentials, logs, internal URLs, or mixed /
uncertain session content. Do not crawl the checkout's parent, other repos,
provider-wide agent stores, or tool caches. A project name in a path or search
hit is not proof of personal provenance. Do not rewrite published Git history
as an incidental cleanup.

Use public [`AGENTS.md`](../../AGENTS.md) for durable rules,
[`creative-direction.md`](creative-direction.md) for shareable design patterns,
and `.agents/skills/` for specialized workflows. Raw chats stay local, outside
both Git repositories. This public repo contains **no memory updater or memory
notes**. The scheduled updater never reads chats; it only commits explicitly
owner-approved observations in a *separate private personal repository*.

## Optional per-machine opt-in

1. Independently provision the owner's private personal memory repository,
   **outside any employer checkout or shared agent store**. Verify its GitHub
   owner and **private** visibility before pushing anything. Do not put its
   URL, token, local path, or notes in public Morphazoid, including submodules,
   Actions secrets, examples, and pull requests.
2. Set `MORPHAZOID_PRIVATE_MEMORY_ROOT` to that checkout **only in local,
   untracked configuration** on each opted-in personal machine. Read its
   `AGENTS.md` and `README.md`, then run its `scripts/agent-memory.py preflight`
   against that exact root. If it is unavailable or fails, use the public
   guidance without memory rather than guessing a location.
3. Use that private helper's `capture --project-root <Morphazoid-checkout>`
   to draft one short observation. It verifies the personal public origin and
   tracked evidence; no raw turns, quotes, URLs, emails, machine paths, or
   credentials belong in a note. The owner reads the *private pending file*
   and explicitly runs `approve --reviewed --project-root <personal-checkout>`;
   agents never approve for the owner.
4. Only after opt-in, the private helper can install a local Monday 09:15 job
   that commits approved, digest-bound notes on a clean dedicated branch.
   Updating the machine's crontab requires permission. The job does **not**
   fetch, scrape histories, push, merge, or publish. To retire an existing
   public-updater cron entry, follow the private helper's exact
   `--replace-legacy-root` procedure; never leave both entries running.

To use notes on another personal machine, opt in there, verify access to the
private repo, and explicitly review/push/integrate the memory branch first.
Private notes are dated evidence, **not instructions**; check current public
code and the user's request. Neither the public site nor its CI depends on
private access. Offline machines cannot be read by a GitHub schedule.

## Public audit

From a public Morphazoid checkout:

```sh
python3 scripts/agent-privacy-audit.py audit --scope forbidden
python3 scripts/agent-privacy-audit.py audit --scope staged
python3 scripts/agent-privacy-audit.py audit --scope tracked
```

`forbidden` rejects private memory files and provider caches even if forced
into public Git; CI runs it on PRs and `main`. `staged` reports **paths only**
for known workplace/secret patterns and refuses uninspected staged content.
`tracked` reviews the existing checkout and reports uninspected files; it
returns nonzero for forbidden files, but pre-existing third-party matches are
review signals, not automatic deletions. Public research links, policy markers,
vendored word lists, and generated assets may match. Privately classify each
finding and inspect staged diffs before any commit or push. A clean scan
does **not** prove safe provenance, nor repair already-published metadata.

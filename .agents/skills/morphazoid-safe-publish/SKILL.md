---
name: morphazoid-safe-publish
description: Integrate, commit, push, or publish Morphazoid changes from a shared or dirty checkout, especially when main has diverged or other Codex tasks are active. Use for requests to pull fresh main, commit, push, deploy, publish, or prepare a clean handoff. Do not use for ordinary implementation that will not touch Git history or deployment.
---

# Morphazoid safe publish

Perform the requested Git or publication operation without consuming or
overwriting another task's work. Treat each verb as a separate authorization:
fetch/pull, integrate, stage, commit, push, deploy, and public smoke testing do
not imply one another. Stop at the last operation the user requested.

## Audit before mutation

Inspect the current branch, upstream, status including untracked files, diffs, recent commits, remotes, and active work communicated by other tasks. Identify exactly which paths belong to the requested change. If ownership is unclear, pause writes and resolve it.

## Reconcile fresh main safely

Fetch the remote. If local `main`, remote `main`, and the working tree differ:

1. Create a recoverable snapshot including tracked and untracked work.
2. Record the snapshot identity and starting commit.
3. Integrate remote `main` without force or destructive reset.
4. Restore the snapshot to the intended checkout.
5. Inspect textual and semantic overlap; conflict-free restoration is not proof of compatibility.
6. Verify no files disappeared and no unrelated files became staged.

Use a temporary clean worktree when that isolates publishing more safely than disturbing a busy checkout. Resolve absolute targets before recursive cleanup.

## Verify and stage narrowly

Run checks appropriate to changed behavior and the production path. Stage explicit files, inspect `git diff --cached`, and compare staged paths with declared scope. Do not include unrelated edits, local configuration, secrets, screenshots, caches, or temporary build output.

## Perform only the authorized terminal actions

If a commit was requested, create a focused commit message. If a push was
requested, push normally and never force-push to bypass a non-fast-forward
rejection; then verify that the intended remote branch contains the commit. If
deployment was requested or is an explicitly documented consequence of the
authorized push, inspect the run for that exact commit and perform a small
production smoke check when practical. A clean handoff request authorizes a
report or prepared worktree, not an unrequested commit, push, or deployment.

Report the applicable branch, commit hash, scoped paths, verification,
deployment status, and preserved local work. Do not report an unrequested stage
as completed. "Push attempted" is not "published."

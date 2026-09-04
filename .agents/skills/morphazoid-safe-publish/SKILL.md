---
name: morphazoid-safe-publish
description: Integrate, commit, push, or publish Morphazoid changes from a shared or dirty checkout, especially when main has diverged or other Codex tasks are active. Use for requests to pull fresh main, commit, push, deploy, publish, or prepare a clean handoff. Do not use for ordinary implementation that will not touch Git history or deployment.
---

# Morphazoid safe publish

Publish the requested scope without consuming or overwriting another task's work.

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

## Commit, push, and prove publication

Create a focused commit message. Push normally; never force-push to bypass non-fast-forward rejection. Verify the intended remote branch contains the commit. If deployment is configured, inspect the run for that exact commit and perform a small production smoke check when practical.

Report branch, commit hash, pushed paths, verification, deployment status, and preserved local work. "Push attempted" is not "published."

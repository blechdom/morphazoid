# Review branch rebased onto main — September 23, 2026

The owner requested rebasing the current work and restarting the local test
server. GitHub was fetched and verified at `ef6e5939ef4de26471010b33dd7c1aaddf9a7f85`.
The local directory checkpoint `eb5b17e2a59225f7aef1eccb53176fffcbedfffc` was replayed as
`03619ffdeea937e62ed61b8242a1a5233a71cfd0` on `codex/presets-continue-20260922`.
The neighboring main worktree was not switched, reset, edited or fast-forwarded.
No push or deployment occurred.

## Recovery and restoration

Before rebasing, all 151 changed/untracked paths, their hashes, deletions and
patches were saved under `test-results/rebase-main-20260923/`. The original
commit is also retained by `codex/presets-pre-rebase-20260923`; the named recovery
stash remains available. The previous preview was stopped during the mutation.

All saved paths were restored, with no missing files or resurrected deletions.
Only these restored files differ from their snapshot before the documentation
updates recorded here:

- Syrinx source and generated WAX: incoming main startup fixes combined with
  the existing pointer extraction.
- Runtime manifest: both incoming startup helpers and the pending renamed
  Work in Progress/helper paths are retained.
- Module-hierarchy and pointer tests: exact main iPhone amendments compose with
  the existing extraction/path reversal checks.

The Work in Progress folder rename, controls, presets and existing drafts remain
in the working tree. Original reference hashes were not regenerated.
Main's controller amendment record remains authoritative; the four exact
navigation changes from main are recorded separately in
`iphone-navigation-runtime-changes.json`. `audio-startup.js` is explicitly
retained as a shared root utility. The temporary restore index is cleared;
remaining working changes are uncommitted.

## Verification

| Check | Result |
| --- | --- |
| Rebased committed-layer checks | Passed before restoring the working changes |
| Combined focused rebase/startup/layout/pointer checks | 45 passed |
| `npm run verify` | 4,111 passed, six existing skips; syntax, SIMD, XYFlow and clean-build WAX parity passed |
| WAX regeneration | 209 pages |
| iPhone startup, pointer, prototype/loop-network and site-bootstrap browser suites | 93 passed |
| Snapshot restoration audit | No missing paths or resurrected deletions; expected main/test overlaps only |

The browser tests exercise real pages with controlled startup/resume failures;
they are not a physical iPhone or Silent-mode acceptance test. The previously
recorded standalone Shape clipping-meter issue was not retuned or waived.

## Local preview

The requested preview is running from
`/home/blechdom/creative/morphazoid-presets` at `http://localhost:4401/`, started
with `npm run dev -- --port 4401 --strict-port`. Served navigation, audio startup,
audio-session policy, Shapes, Syrinx and Work in Progress controller bytes were
compared against this worktree. The preview now includes main's iPhone fixes.

Open a new tab or reload to use the rebased code. Existing page-local recordings
remain in their old tab and are lost on reload. Physical iPhone testing needs a
secure HTTPS endpoint; the computer's localhost is not the phone's localhost.

Logs are under `test-results/rebase-main-20260923/`: `focused.log`, `verify.log`,
`browser.log`, `preview.log` and `restore-comparison.json`.

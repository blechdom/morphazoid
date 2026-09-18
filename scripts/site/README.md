# Explicit release-file inventory

`runtime-files.tsv` replaces the two long filename lists previously embedded in
`scripts/build-site.sh`. Every path is declared once, with two independent
decisions: may an untracked working file be copied, and must the final artifact
contain that path?

Each non-comment line contains a policy, a **literal tab**, and a
repository-relative POSIX path:

```text
copy+require	src/instruments/example/controller.js
copy	assets/example/optional-notes.md
require	src/audio.js
```

| Policy | Explicitly copy the working file if present | Require the file in the artifact |
| --- | --- | --- |
| `copy+require` | Yes | Yes |
| `copy` | Yes | No |
| `require` | No additional copy permission | Yes |

`require` does not mean that the file can only come from Git. Existing tracked
file selection or asset-glob rules may supply it. Conversely, do not turn a
`require` entry into `copy+require` incidentally while renaming it: that changes
which untracked files can enter a release.

## Scope

This is the **explicit override/requirement inventory**, not an exhaustive asset
manifest or an automatic dependency graph. The builder still:

- selects eligible tracked files with its existing extension/path rules;
- copies the existing spider asset globs and catalogue icon glob;
- rejects the same private development paths in the artifact;
- checks required paths in manifest order.

The initial migration preserves every explicit copy permission and the exact
required-path order. Explicit copy order now follows the manifest; output
file lists and file bytes are compared against the unchanged builder. No
public files are renamed, relocated, added or removed by this extraction.

## Adding or moving a runtime file

1. Decide whether a new file must work in an uncommitted local preview and
   whether its absence should fail a build.
2. Add one record, or update the existing path while retaining its intended
   policy. Do not duplicate a path to represent both roles.
3. Update actual imports, `new URL(...)`, fetch/worklet URLs, page references and
   relevant assertions separately. The inventory does not rewrite them.
4. Run the focused manifest tests and normal release verification. Regenerate
   and check WAX when public source changes.

The names above are examples, not extra shipping entries. Do not put future
category names or speculative directories into the real manifest.

## Reader and checks

```sh
npm run test:release-manifest
```

`runtime-manifest.mjs` is build-time Node tooling only. It validates policies,
duplicate paths, tabs/control characters, and unsafe relative paths before
emitting any records. The shell checks the reader's exit status before replacing
an output directory. It does not `eval` the manifest or source shell code from it.

`tests/release-manifest.test.mjs` covers parsing, policy separation, malformed
input, literal filenames, untracked/nested files, optional files, mandatory-file
failures, asset globs, private exclusions and artifact preservation on reader
failure.

Its reference builder in `tests/fixtures/site-builder-v1.sh` is a frozen copy
from `ca58234773844f7e1fba8d65e55e1cf89b3f1184`. Isolated tests use that historical
inventory for both builders, so future **intentional** filename changes in the
live manifest do not require rewriting the old fixture.

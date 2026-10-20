#!/usr/bin/env python3
"""Filename-only privacy signals and a no-private-data guard for public Morphazoid."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys


ORIGINS = frozenset(
    {
        "git@github.com:blechdom/morphazoid.git",
        "https://github.com/blechdom/morphazoid.git",
        "https://github.com/blechdom/morphazoid",
        "ssh://git@github.com/blechdom/morphazoid.git",
    }
)
MAX_AUDIT_BYTES = 4 * 1024 * 1024
FORBIDDEN_PREFIXES = (
    "docs/agent-memory/",
    ".morphazoid-local/",
    ".claude/",
    ".codex/",
    ".copilot/",
    ".cursor/agent-transcripts/",
    ".cursor/mcps/",
    ".cursor/projects/",
    ".cursor/terminals/",
)

# A match calls for private human review; it cannot establish provenance.
MARKERS = {
    "workplace-name": re.compile(r"nvidia|nimcraft|(?<![a-z0-9])nim(?![a-z0-9])", re.I),
    "workplace-system": re.compile(r"nvcr\.io|globalprotect|pangpa", re.I),
    "private-key": re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----", re.I),
    "cloud-key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "access-token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "credential-assignment": re.compile(
        r"\b(?:api[_ -]?key|password|access[_ -]?token|client[_ -]?secret)"
        r"\s*[:=]\s*['\"]?[^\s'\"]{4,}",
        re.I,
    ),
    "email-address": re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b"),
    "machine-path": re.compile(r"(?:^|[\s(])(?:/(?:home|Users|tmp|etc|var)/|[A-Za-z]:\\)"),
}


class SafetyError(Exception):
    """Cannot audit the intended public personal repository safely."""


def git(root: Path, *args: str, binary: bool = False) -> str | bytes:
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=not binary, check=False
    )
    if result.returncode:
        raise SafetyError(f"Git {args[0]} failed; inspect this checkout locally")
    return result.stdout if binary else result.stdout.strip()


def repo_root(value: str) -> Path:
    source = Path(value).expanduser()
    if source.is_symlink():
        raise SafetyError("Repository root must not be a symlink")
    root = source.resolve(strict=True)
    if not root.is_dir() or git(root, "rev-parse", "--show-toplevel") != str(root):
        raise SafetyError("Supply the exact Morphazoid checkout root")
    if git(root, "remote", "get-url", "origin") not in ORIGINS:
        raise SafetyError("Origin is not the approved personal Morphazoid repository")
    if not (root / "AGENTS.md").is_file() or not (root / "package.json").is_file():
        raise SafetyError("Missing Morphazoid repository sentinels")
    return root


def forbidden(name: str) -> bool:
    return name.lower().startswith(FORBIDDEN_PREFIXES)


def scan(text: str) -> list[str]:
    return [label for label, regex in MARKERS.items() if regex.search(text)]


def audit(root: Path, scope: str) -> int:
    if scope == "staged":
        names = git(root, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT", binary=True)
    else:
        names = git(root, "ls-files", "-z", binary=True)
    paths = [name.decode("utf-8", "surrogateescape") for name in filter(None, names.split(b"\0"))]
    blocked = [name for name in paths if forbidden(name)]
    print(f"Public-only guard: {len(blocked)} forbidden path(s) in {scope}.")
    for name in blocked[:100]:
        print("  forbidden:", name)
    if scope == "forbidden":
        return 1 if blocked else 0

    flagged = []
    skipped = {"binary": 0, "oversized": 0, "symlink/missing": 0}
    for name in paths:
        path = root / name
        filename_findings = scan(name)
        if scope == "staged":
            mode = git(root, "ls-files", "-s", "--", name).split(" ", 1)[0]
            if mode not in ("100644", "100755"):
                skipped["symlink/missing"] += 1
                if filename_findings:
                    flagged.append((name, filename_findings))
                continue
            size = int(git(root, "cat-file", "-s", f":{name}"))
            if size > MAX_AUDIT_BYTES:
                skipped["oversized"] += 1
                if filename_findings:
                    flagged.append((name, filename_findings))
                continue
            data = git(root, "show", f":{name}", binary=True)
        elif path.is_symlink() or not path.is_file():
            skipped["symlink/missing"] += 1
            if filename_findings:
                flagged.append((name, filename_findings))
            continue
        elif path.stat().st_size > MAX_AUDIT_BYTES:
            skipped["oversized"] += 1
            if filename_findings:
                flagged.append((name, filename_findings))
            continue
        else:
            data = path.read_bytes()
        if b"\0" in data[:65536]:
            skipped["binary"] += 1
            if filename_findings:
                flagged.append((name, filename_findings))
            continue
        findings = scan(name + "\n" + data.decode("utf-8", "replace"))
        if findings:
            flagged.append((name, findings))
    print(f"{scope.capitalize()} audit: {len(flagged)} flagged path(s); uninspected: {skipped}.")
    for name, findings in flagged[:100]:
        print("  ", name, "(", ", ".join(findings), ")")
    if len(flagged) > 100:
        print(f"  ... plus {len(flagged) - 100} more paths")
    print("Review findings and uninspected files privately; these signals are not a safety proof.")
    return 1 if blocked or (scope == "staged" and (flagged or any(skipped.values()))) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    command = sub.add_parser("audit")
    command.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    command.add_argument("--scope", required=True, choices=("forbidden", "tracked", "staged"))
    args = parser.parse_args(argv)
    try:
        return audit(repo_root(args.root), args.scope)
    except (SafetyError, OSError) as error:
        print(f"Public privacy audit stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

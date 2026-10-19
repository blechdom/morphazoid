#!/usr/bin/env python3
"""Private-first, reviewed Morphazoid observations; never reads agent chats."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import uuid
from zoneinfo import ZoneInfo


PRIVATE = Path(".morphazoid-local/memory")
NOTES = Path("docs/agent-memory/notes")
KINDS = frozenset({"instrument", "qa", "style", "workflow"})
NOTE_FIELDS = frozenset(
    {"schema_version", "id", "recorded_on", "kind", "summary", "observation", "reuse_when", "evidence"}
)
ORIGINS = frozenset(
    {
        "git@github.com:blechdom/morphazoid.git",
        "https://github.com/blechdom/morphazoid.git",
        "https://github.com/blechdom/morphazoid",
        "ssh://git@github.com/blechdom/morphazoid.git",
    }
)
MAX_NOTE_BYTES = 4096
MAX_AUDIT_BYTES = 4 * 1024 * 1024
CRON_MARKER = "# morphazoid-agent-memory"
MEMORY_AUTHOR = "Morphazoid Memory"
MEMORY_EMAIL = "blechdom@users.noreply.github.com"

# A match is a reason to STOP and review, not proof of confidential content.
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
NOTE_ONLY = {
    "external-url": re.compile(r"(?:https?://|ssh://|git@)", re.I),
    "opaque-token": re.compile(r"\b[A-Za-z0-9_+/-]{64,}={0,2}\b"),
}


class SafetyError(Exception):
    """Unsafe or ambiguous state; leave the repository unchanged."""


def git(root: Path, *args: str, binary: bool = False) -> str | bytes:
    environment = os.environ.copy()
    for name in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"):
        environment.pop(name, None)
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        capture_output=True,
        check=False,
        text=not binary,
        env=environment,
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


def clean_memory_branch(root: Path) -> None:
    branch = git(root, "branch", "--show-current")
    if not branch.startswith("agent-memory/"):
        raise SafetyError("Use a dedicated agent-memory/* branch, never main or a development branch")
    if git(root, "status", "--porcelain=v1", "--untracked-files=all"):
        raise SafetyError("Memory worktree is dirty; do not stage or commit any files automatically")


def secure_directory(path: Path) -> None:
    if path.is_symlink():
        raise SafetyError("Private memory directories cannot be symlinks")
    path.mkdir(mode=0o700, exist_ok=True)
    if not path.is_dir() or (path.stat().st_mode & 0o077):
        raise SafetyError("Private memory directory must be owned and accessible only by this user")


def private_paths(root: Path) -> tuple[Path, Path, Path]:
    parent = root / PRIVATE.parent
    base = root / PRIVATE
    for directory in (
        parent, base, base / "pending", base / "approved", base / "approval-digests", base / "processed"
    ):
        secure_directory(directory)
    return base / "pending", base / "approved", base / "processed"


@contextmanager
def locked(root: Path):
    private_paths(root)
    lockfile = root / PRIVATE / "lock"
    if lockfile.is_symlink():
        raise SafetyError("Private memory lock cannot be a symlink")
    descriptor = os.open(lockfile, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, "w") as lock:
            if lockfile.stat().st_mode & 0o077:
                raise SafetyError("Private memory lock must not be accessible to other users")
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield
    finally:
        pass


def scan(text: str, *, note: bool = False) -> list[str]:
    rules = MARKERS | (NOTE_ONLY if note else {})
    return [label for label, regex in rules.items() if regex.search(text)]


def evidence_path(value: str) -> bool:
    path = PurePosixPath(value)
    return (
        value == str(path)
        and not path.is_absolute()
        and all(part not in ("", ".", "..") for part in path.parts)
        and bool(re.fullmatch(r"[A-Za-z0-9._/-]+", value))
        and not value.startswith("-")
        and not value.startswith(".morphazoid-local/")
    )


def validate_note(note: object, root: Path, *, verify_evidence: bool = False) -> dict:
    if not isinstance(note, dict) or set(note) != NOTE_FIELDS:
        raise SafetyError("Memory note has an unexpected schema")
    if type(note["schema_version"]) is not int or note["schema_version"] != 1:
        raise SafetyError("Unsupported memory note schema version")
    try:
        note_id = uuid.UUID(note["id"])
        if note_id.version != 4 or str(note_id) != note["id"]:
            raise ValueError()
        if date.fromisoformat(note["recorded_on"]).isoformat() != note["recorded_on"]:
            raise ValueError()
    except (TypeError, ValueError, AttributeError):
        raise SafetyError("Memory ID/date is invalid") from None
    if not isinstance(note["kind"], str) or note["kind"] not in KINDS:
        raise SafetyError("Unknown memory kind")
    for field, limit in (("summary", 120), ("observation", 600), ("reuse_when", 350)):
        value = note[field]
        if not isinstance(value, str) or not 10 <= len(value) <= limit:
            raise SafetyError(f"Memory {field} must be a short, nonempty sentence")
        if value.strip() != value or any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise SafetyError(f"Memory {field} has whitespace or control characters")
    evidence = note["evidence"]
    if not isinstance(evidence, list) or not 1 <= len(evidence) <= 4:
        raise SafetyError("Provide one to four tracked evidence paths or a Git revision")
    if len(set(map(str, evidence))) != len(evidence):
        raise SafetyError("Duplicate evidence paths")
    for value in evidence:
        if not isinstance(value, str):
            raise SafetyError("Evidence must be a repository-relative path or Git revision")
        if re.fullmatch(r"git:[0-9a-f]{40}", value):
            if verify_evidence:
                git(root, "cat-file", "-e", value[4:] + "^{commit}")
            continue
        if not evidence_path(value):
            raise SafetyError("Evidence path must stay inside the repository")
        if verify_evidence:
            source = root / value
            if source.is_symlink() or not source.is_file():
                raise SafetyError("Evidence must be a tracked regular file")
            git(root, "ls-files", "--error-unmatch", "--", value)
    content = "\n".join(
        [note["summary"], note["observation"], note["reuse_when"], *evidence]
    )
    findings = scan(content, note=True)
    if findings:
        raise SafetyError("Memory note needs private review: " + ", ".join(findings))
    return note


def serialize(note: dict) -> bytes:
    return (json.dumps(note, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def read_note(path: Path, root: Path, *, verify_evidence: bool = False) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_NOTE_BYTES:
        raise SafetyError(f"Invalid memory note file: {path.name}")
    try:
        raw = path.read_bytes()
        note = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise SafetyError(f"Malformed memory note: {path.name}") from None
    validate_note(note, root, verify_evidence=verify_evidence)
    if path.stem != note["id"]:
        raise SafetyError(f"Memory file name and ID differ: {path.name}")
    return note


def save_exclusive(path: Path, data: bytes) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)


def note_target(root: Path, note: dict) -> Path:
    return root / NOTES / note["recorded_on"][:7] / f"{note['id']}.json"


def capture(args, root: Path) -> None:
    with locked(root):
        clean_memory_branch(root)
        evidence = args.evidence or [f"git:{git(root, 'rev-parse', 'HEAD')}"]
        note = {
            "schema_version": 1,
            "id": str(uuid.uuid4()),
            "recorded_on": datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat(),
            "kind": args.kind,
            "summary": args.summary,
            "observation": args.observation,
            "reuse_when": args.reuse_when,
            "evidence": evidence,
        }
        validate_note(note, root, verify_evidence=True)
        pending, _, _ = private_paths(root)
        save_exclusive(pending / f"{note['id']}.json", serialize(note))
        print(f"Pending private observation: {note['id']}. Owner review required; nothing committed.")


def approve(args, root: Path) -> None:
    if not args.reviewed:
        raise SafetyError("Owner must read the private draft and explicitly pass --reviewed")
    try:
        note_id = str(uuid.UUID(args.id))
        if note_id != args.id:
            raise ValueError()
    except (ValueError, TypeError):
        raise SafetyError("Invalid memory ID") from None
    with locked(root):
        clean_memory_branch(root)
        pending, approved, _ = private_paths(root)
        note_file = pending / f"{note_id}.json"
        read_note(note_file, root, verify_evidence=True)
        destination = approved / note_file.name
        if destination.exists() or destination.is_symlink():
            raise SafetyError("Memory ID was already approved")
        digest_file = root / PRIVATE / "approval-digests" / f"{note_id}.sha256"
        if digest_file.exists() or digest_file.is_symlink():
            raise SafetyError("Memory ID already has an approval digest")
        digest = hashlib.sha256(note_file.read_bytes()).hexdigest()
        save_exclusive(digest_file, f"{digest}\n".encode("ascii"))
        os.replace(note_file, destination)
        print(f"Approved observation {note_id}; awaiting the local scheduler or manual sync.")


def approved_notes(root: Path) -> list[tuple[Path, Path, dict, Path, bytes]]:
    _, approved, _ = private_paths(root)
    result = []
    for candidate in sorted(approved.iterdir()):
        if candidate.suffix != ".json" or candidate.is_symlink():
            raise SafetyError(f"Unexpected approved-memory entry: {candidate.name}")
        digest_file = root / PRIVATE / "approval-digests" / f"{candidate.stem}.sha256"
        if digest_file.is_symlink() or not digest_file.is_file():
            raise SafetyError(f"Missing approval digest: {candidate.name}")
        expected = (hashlib.sha256(candidate.read_bytes()).hexdigest() + "\n").encode("ascii")
        if digest_file.read_bytes() != expected:
            raise SafetyError(f"Approved observation changed after owner review: {candidate.name}")
        note = read_note(candidate, root, verify_evidence=True)
        result.append((candidate, digest_file, note, note_target(root, note), serialize(note)))
    return result


def sync(root: Path) -> None:
    with locked(root):
        clean_memory_branch(root)
        entries = approved_notes(root)
        if not entries:
            print("No approved observations; nothing to commit.")
            return
        _, _, processed = private_paths(root)
        created = []
        for source, digest_file, _, target, data in entries:
            receipt = processed / source.name
            digest_receipt = processed / digest_file.name
            if (receipt.exists() or receipt.is_symlink()
                    or digest_receipt.exists() or digest_receipt.is_symlink()):
                raise SafetyError("Processed receipt already exists; review private inbox")
            if target.is_symlink():
                raise SafetyError("Tracked memory target cannot be a symlink")
            if target.exists():
                if not target.is_file() or target.read_bytes() != data:
                    raise SafetyError("Memory ID conflicts with an existing tracked note")
            else:
                created.append((target, data))
        # Validate every entry and collision before making *any* tracked change.
        for target, data in created:
            for directory in (
                root / "docs", target.parent.parent.parent, target.parent.parent, target.parent
            ):
                if directory.is_symlink():
                    raise SafetyError("Tracked memory directories cannot be symlinks")
                directory.mkdir(exist_ok=True)
            save_exclusive(target, data)
        if created:
            relative = [target.relative_to(root).as_posix() for target, _ in created]
            git(root, "add", "--", *relative)
            staged = set(
                path for path in git(root, "diff", "--cached", "--name-only", "-z", binary=True)
                .decode("utf-8", "surrogateescape")
                .split("\0")
                if path
            )
            if staged != set(relative):
                raise SafetyError("Unexpected staged paths; refusing automated memory commit")
            for path, data in zip(relative, (item[1] for item in created)):
                if git(root, "show", f":{path}", binary=True) != data:
                    raise SafetyError("Staged memory content differs from the reviewed note")
            git(root, "diff", "--cached", "--check")
            git(
                root,
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgsign=false",
                "-c",
                f"user.name={MEMORY_AUTHOR}",
                "-c",
                f"user.email={MEMORY_EMAIL}",
                "commit",
                "-m",
                f"docs(agent-memory): add {len(created)} reviewed observation(s)",
            )
            print(f"Committed {len(created)} reviewed observation(s): {git(root, 'rev-parse', '--short', 'HEAD')}")
        else:
            print("All approved observations are already committed.")
        for source, digest_file, _, _, _ in entries:
            os.replace(source, processed / source.name)
            os.replace(digest_file, processed / digest_file.name)


def cron_line(root: Path) -> str:
    python = shlex.quote(sys.executable)
    script = shlex.quote(str(root / "scripts/agent-memory.py"))
    checkout = shlex.quote(str(root))
    log = shlex.quote(str(root / PRIVATE / "cron.log"))
    # Cron treats unescaped percent signs as a newline, even inside shell quotes.
    command = f"15 9 * * 1 umask 077; {python} {script} sync --root {checkout} >> {log} 2>&1 {CRON_MARKER}"
    return command.replace("%", r"\%")


def install_cron(root: Path, *, confirm: bool) -> None:
    if not confirm:
        raise SafetyError("Local crontab changes require explicit --confirm")
    clean_memory_branch(root)
    if not (root / "scripts/agent-memory.py").is_file():
        raise SafetyError("Install only from a branch containing the memory helper")
    private_paths(root)  # The shell must be able to open the ignored log before Python starts.
    if shutil.which("crontab") is None:
        raise SafetyError("No local crontab command; cron not installed on this machine")
    line = cron_line(root)
    existing = subprocess.run(["crontab", "-l"], capture_output=True, text=True, check=False)
    if existing.returncode:
        if existing.returncode == 1 and "no crontab for" in existing.stderr.lower():
            original = ""
        else:
            raise SafetyError("Cannot safely inspect the existing user crontab")
    else:
        original = existing.stdout
    marked = [item for item in original.splitlines() if CRON_MARKER in item]
    if marked:
        if marked == [line]:
            print("Weekly memory cron entry already installed; no crontab change.")
            return
        raise SafetyError("Conflicting marked memory cron entry; inspect crontab manually")
    updated = original.rstrip("\n") + ("\n" if original else "") + line + "\n"
    write = subprocess.run(["crontab", "-"], input=updated, capture_output=True, text=True, check=False)
    if write.returncode:
        raise SafetyError("Could not install the memory cron entry; existing crontab may be unchanged")
    print("Installed one weekly Monday 09:15 local-time memory job (commits locally; never pushes).")


def audit(root: Path, scope: str) -> int:
    if scope == "notes":
        paths = [name for name in git(root, "ls-files", "-z", "--", str(NOTES), binary=True).decode(
            "utf-8", "surrogateescape"
        ).split("\0") if name]
        errors = []
        for name in paths:
            path = root / name
            if path.suffix != ".json" or not path.is_relative_to(root / NOTES):
                errors.append(name)
                continue
            try:
                note = read_note(path, root)
                if note_target(root, note) != path:
                    raise SafetyError("Memory note directory does not match its recorded date")
            except SafetyError:
                errors.append(name)
        print(f"Reviewed-note schema check: {len(paths)} tracked note(s), {len(errors)} unsafe/invalid.")
        for name in errors[:100]:
            print("  invalid:", name)
        return 1 if errors else 0

    if scope == "tracked":
        names = git(root, "ls-files", "-z", binary=True)
    else:
        names = git(root, "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT", binary=True)
    flagged = []
    skipped = {"binary": 0, "oversized": 0, "symlink/missing": 0}
    for encoded in filter(None, names.split(b"\0")):
        name = encoded.decode("utf-8", "surrogateescape")
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
        if len(data) > MAX_AUDIT_BYTES:
            skipped["oversized"] += 1
            if filename_findings:
                flagged.append((name, filename_findings))
            continue
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
    print("Review flagged paths and binary/oversized provenance privately; this is not a safety proof.")
    return 1 if scope == "staged" and (flagged or any(skipped.values())) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("preflight", "capture", "approve", "sync", "audit", "install-cron"):
        command = sub.add_parser(action)
        command.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
        if action == "capture":
            command.add_argument("--kind", required=True, choices=sorted(KINDS))
            command.add_argument("--summary", required=True)
            command.add_argument("--observation", required=True)
            command.add_argument("--reuse-when", required=True)
            command.add_argument("--evidence", action="append", default=[])
        elif action == "approve":
            command.add_argument("--id", required=True)
            command.add_argument("--reviewed", action="store_true")
        elif action == "audit":
            command.add_argument("--scope", required=True, choices=("tracked", "staged", "notes"))
        elif action == "install-cron":
            command.add_argument("--confirm", action="store_true")
    args = parser.parse_args(argv)
    try:
        root = repo_root(args.root)
        if args.action == "audit":
            return audit(root, args.scope)
        if args.action == "preflight":
            clean_memory_branch(root)
            print("Clean, dedicated Morphazoid memory branch; no network operation or mutation.")
        elif args.action == "capture":
            capture(args, root)
        elif args.action == "approve":
            approve(args, root)
        elif args.action == "sync":
            sync(root)
        elif args.action == "install-cron":
            install_cron(root, confirm=args.confirm)
        return 0
    except (SafetyError, OSError) as error:
        print(f"Memory updater stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Isolated Git-repository tests; never use live user history or crontab."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/agent-memory.py"


class AgentMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="morphazoid-memory-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "personal-repo"
        self.root.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Morphazoid Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.root / "AGENTS.md").write_text("# Morphazoid agents\n")
        (self.root / "package.json").write_text('{"name":"morphazoid"}\n')
        (self.root / ".gitignore").write_text(".morphazoid-local/\n")
        (self.root / "docs/agent-memory").mkdir(parents=True)
        (self.root / "docs/agent-memory/README.md").write_text("# Reviewed notes\n")
        (self.root / "scripts").mkdir()
        shutil.copyfile(SCRIPT, self.root / "scripts/agent-memory.py")
        self.git("add", "AGENTS.md", "package.json", ".gitignore", "scripts/agent-memory.py", "docs/agent-memory/README.md")
        self.git("commit", "-qm", "Test personal Morphazoid checkout")
        self.git("remote", "add", "origin", "git@github.com:blechdom/morphazoid.git")
        self.git("switch", "-qc", "agent-memory/test")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.root), *args],
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()

    def cli(self, *args, env=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args, "--root", str(self.root)],
            check=False,
            text=True,
            capture_output=True,
            env=env,
        )

    def capture(self, **overrides):
        fields = {
            "kind": "style",
            "summary": "An instrument's graphic and sound should agree.",
            "observation": "Dragging the visible mechanism changed the sound audibly.",
            "reuse_when": "When planning the next instrument's main gesture.",
        }
        fields.update(overrides)
        args = ["capture"]
        for key, value in fields.items():
            args += ["--" + key.replace("_", "-"), value]
        args += ["--evidence", "AGENTS.md"]
        result = self.cli(*args)
        if result.returncode != 0:
            return result, None
        match = re.search(r"Pending private observation: ([0-9a-f-]{36})", result.stdout)
        self.assertIsNotNone(match, result.stdout)
        return result, match.group(1)

    def test_only_approved_note_is_committed_and_retry_is_idempotent(self):
        result, note_id = self.capture()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.git("status", "--porcelain"))
        self.assertEqual(self.cli("sync").returncode, 0)
        self.assertIn("nothing to commit", self.cli("sync").stdout)
        self.assertNotEqual(self.cli("approve", "--id", note_id).returncode, 0)
        pending = self.root / ".morphazoid-local/memory/pending" / f"{note_id}.json"
        self.assertTrue(pending.is_file())
        self.assertEqual(self.cli("approve", "--id", note_id, "--reviewed").returncode, 0)

        inherited_author = os.environ | {
            "GIT_AUTHOR_EMAIL": "unrelated-job@example.invalid",
            "GIT_COMMITTER_EMAIL": "unrelated-job@example.invalid",
        }
        committed = self.cli("sync", env=inherited_author)
        self.assertEqual(committed.returncode, 0, committed.stderr)
        notes = list((self.root / "docs/agent-memory/notes").rglob("*.json"))
        self.assertEqual(len(notes), 1)
        expected = notes[0].relative_to(self.root).as_posix()
        self.assertEqual(self.git("show", "--pretty=format:", "--name-only", "HEAD"), expected)
        self.assertTrue(self.git("log", "-1", "--format=%s").startswith("docs(agent-memory):"))
        self.assertEqual(
            self.git("log", "-1", "--format=%an <%ae> | %cn <%ce>"),
            "Morphazoid Memory <blechdom@users.noreply.github.com> | Morphazoid Memory <blechdom@users.noreply.github.com>",
        )
        self.assertFalse(self.git("status", "--porcelain"))
        self.assertEqual(self.cli("audit", "--scope", "notes").returncode, 0)
        self.assertEqual(self.cli("sync").returncode, 0)
        self.assertTrue((self.root / ".morphazoid-local/memory/processed" / f"{note_id}.json").is_file())
        self.assertTrue((self.root / ".morphazoid-local/memory/processed" / f"{note_id}.sha256").is_file())
        self.assertEqual(self.git("rev-list", "--count", "HEAD"), "2")

    def test_edit_after_approval_stops_sync_without_staging(self):
        _, note_id = self.capture()
        self.assertEqual(self.cli("approve", "--id", note_id, "--reviewed").returncode, 0)
        approved = self.root / ".morphazoid-local/memory/approved" / f"{note_id}.json"
        approved.write_text(approved.read_text().replace("Dragging", "Changing"))
        result = self.cli("sync")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("changed after owner review", result.stderr)
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "")
        self.assertEqual(self.git("rev-list", "--count", "HEAD"), "1")

    def test_default_evidence_is_a_commit_from_this_repository(self):
        result = self.cli(
            "capture",
            "--kind", "workflow",
            "--summary", "Keep the source and generated artifact separate.",
            "--observation", "An authored source file had a generated counterpart.",
            "--reuse-when", "When editing an instrument's browser runtime.",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        pending = list((self.root / ".morphazoid-local/memory/pending").glob("*.json"))
        self.assertEqual(len(pending), 1)
        self.assertEqual(
            json.loads(pending[0].read_text())["evidence"],
            ["git:" + self.git("rev-parse", "HEAD")],
        )
        invalid = self.cli(
            "capture",
            "--kind", "workflow",
            "--summary", "Keep the source and generated artifact separate.",
            "--observation", "An authored source file had a generated counterpart.",
            "--reuse-when", "When editing an instrument's browser runtime.",
            "--evidence", "git:" + "0" * 40,
        )
        self.assertNotEqual(invalid.returncode, 0)
        self.assertEqual(len(list(pending[0].parent.glob("*.json"))), 1)

    def test_project_remote_and_workplace_or_secret_text_fail_closed(self):
        self.git("remote", "set-url", "origin", "git@github.com:someone/another-repo.git")
        self.assertNotEqual(self.capture()[0].returncode, 0)
        self.git("remote", "set-url", "origin", "git@github.com:blechdom/morphazoid.git")
        for value in (
            "Do not paste NVIDIA work into a personal note.",
            "Avoid adding NIM-related details from a job task.",
            "The password=examplevalue was present in the output.",
            "Contact me at someone@example.com about the instrument.",
            "Read /home/someone/private/file to continue.",
            "Follow https://example.com/internal for instructions.",
        ):
            with self.subTest(value=value):
                self.assertNotEqual(self.capture(observation=value)[0].returncode, 0)
        self.assertFalse(self.git("status", "--porcelain"))

    def test_dirty_or_wrong_branch_refuses_automatic_commit(self):
        _, note_id = self.capture()
        self.assertEqual(self.cli("approve", "--id", note_id, "--reviewed").returncode, 0)
        (self.root / "AGENTS.md").write_text("# Unrelated pending user edit\n")
        self.assertNotEqual(self.cli("sync").returncode, 0)
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "")
        (self.root / "AGENTS.md").write_text("# Morphazoid agents\n")
        self.git("switch", "-q", "main")
        self.assertNotEqual(self.cli("sync").returncode, 0)
        self.assertEqual(self.git("rev-list", "--count", "HEAD"), "1")

    def test_symlinked_approved_file_is_never_read_or_committed(self):
        _, note_id = self.capture()
        self.assertEqual(self.cli("approve", "--id", note_id, "--reviewed").returncode, 0)
        approved = self.root / ".morphazoid-local/memory/approved"
        (approved / "rogue.json").symlink_to(self.root / "AGENTS.md")
        result = self.cli("sync")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("rev-list", "--count", "HEAD"), "1")
        self.assertFalse(self.git("status", "--porcelain"))

    def test_staged_audit_reports_only_filenames_and_stops_on_marker(self):
        (self.root / "unexpected.md").write_text("NIM\n")
        self.git("add", "unexpected.md")
        result = self.cli("audit", "--scope", "staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected.md", result.stdout)
        self.assertNotIn("\nNIM\n", result.stdout)

    def test_staged_symlink_is_explicitly_uninspected(self):
        (self.root / "not-a-text-file").symlink_to("AGENTS.md")
        self.git("add", "not-a-text-file")
        result = self.cli("audit", "--scope", "staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("'symlink/missing': 1", result.stdout)

    def test_install_cron_keeps_existing_entries_and_is_idempotent(self):
        bin_directory = self.root.parent / "bin"
        bin_directory.mkdir()
        state = self.root.parent / "fake-crontab"
        state.write_text("0 8 * * * echo existing # unrelated\n")
        fake = bin_directory / "crontab"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import os, pathlib, sys\n"
            "p = pathlib.Path(os.environ['FAKE_CRON_STATE'])\n"
            "if sys.argv[1] == '-l': print(p.read_text(), end='')\n"
            "elif sys.argv[1] == '-': p.write_text(sys.stdin.read())\n"
            "else: raise SystemExit(2)\n"
        )
        fake.chmod(0o755)
        env = os.environ | {"PATH": str(bin_directory) + os.pathsep + os.environ["PATH"], "FAKE_CRON_STATE": str(state)}
        self.assertNotEqual(self.cli("install-cron", env=env).returncode, 0)
        first = self.cli("install-cron", "--confirm", env=env)
        self.assertEqual(first.returncode, 0, first.stderr)
        second = self.cli("install-cron", "--confirm", env=env)
        self.assertEqual(second.returncode, 0, second.stderr)
        contents = state.read_text()
        self.assertTrue(contents.startswith("0 8 * * * echo existing # unrelated\n"))
        self.assertEqual(contents.count("# morphazoid-agent-memory"), 1)
        self.assertIn("15 9 * * 1", contents)
        self.assertFalse(self.git("status", "--porcelain"))


if __name__ == "__main__":
    unittest.main()

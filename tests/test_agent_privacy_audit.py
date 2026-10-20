"""Isolated public-checkout checks; no private histories or actual user files."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/agent-privacy-audit.py"


class AgentPrivacyAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="morphazoid-public-audit-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "public-project"
        self.root.mkdir()
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Morphazoid Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.root / "AGENTS.md").write_text("# Personal project\n")
        (self.root / "package.json").write_text('{"name":"morphazoid"}\n')
        (self.root / "scripts").mkdir()
        shutil.copyfile(SCRIPT, self.root / "scripts/agent-privacy-audit.py")
        self.git("add", "AGENTS.md", "package.json", "scripts/agent-privacy-audit.py")
        self.git("commit", "-qm", "Initial public checkout")
        self.git("remote", "add", "origin", "git@github.com:blechdom/morphazoid.git")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.root), *args], check=True, text=True, capture_output=True
        ).stdout.strip()

    def cli(self, scope):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "audit", "--scope", scope, "--root", str(self.root)],
            check=False, text=True, capture_output=True,
        )

    def test_clean_public_checkout_has_no_private_paths(self):
        self.assertEqual(self.cli("forbidden").returncode, 0)
        self.assertEqual(self.cli("tracked").returncode, 0)
        self.assertEqual(self.cli("staged").returncode, 0)

    def test_private_notes_and_agent_caches_fail_even_if_forced_into_index(self):
        for path in ("docs/agent-memory/notes/2026-10/reviewed.json", ".codex/sessions/chat.json"):
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('{"kind":"style"}\n')
        self.git("add", "-f", "docs/agent-memory/notes/2026-10/reviewed.json", ".codex/sessions/chat.json")
        for scope in ("forbidden", "staged"):
            with self.subTest(scope=scope):
                result = self.cli(scope)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("forbidden path(s)", result.stdout)
                self.assertIn("docs/agent-memory/notes/", result.stdout)
        self.git("commit", "-qm", "Simulate mistakenly committed files")
        self.assertNotEqual(self.cli("forbidden").returncode, 0)
        self.assertNotEqual(self.cli("tracked").returncode, 0)

    def test_staged_audit_reports_paths_not_content(self):
        (self.root / "unexpected.md").write_text("NIM\n")
        self.git("add", "unexpected.md")
        result = self.cli("staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected.md", result.stdout)
        self.assertNotIn("\nNIM\n", result.stdout)
        self.assertEqual(self.cli("forbidden").returncode, 0)

    def test_staged_audit_reads_index_and_refuses_uninspected_symlinks(self):
        (self.root / "not-a-text-file").symlink_to("AGENTS.md")
        self.git("add", "not-a-text-file")
        result = self.cli("staged")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("'symlink/missing': 1", result.stdout)

    def test_audit_refuses_other_origins(self):
        self.git("remote", "set-url", "origin", "git@github.com:other/project.git")
        self.assertNotEqual(self.cli("forbidden").returncode, 0)


if __name__ == "__main__":
    unittest.main()

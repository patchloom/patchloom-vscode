#!/usr/bin/env python3
"""Tests for scripts/apply-release-notes.sh."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "apply-release-notes.sh"


def run_script(
    env: dict[str, str], cwd: Path | None = None
) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged.pop("GH_TOKEN", None)
    merged.pop("GITHUB_TOKEN", None)
    merged.pop("RELEASE_NOTES", None)
    merged.pop("RELEASE_NOTES_TAG", None)
    merged.update(env)
    return subprocess.run(
        ["bash", str(SCRIPT)],
        capture_output=True,
        text=True,
        env=merged,
        cwd=cwd,
        check=False,
    )


class ApplyReleaseNotesTests(unittest.TestCase):
    def test_rejects_bad_tag(self) -> None:
        r = run_script({"TAG": "canact-v0.1.2", "GH_REPO": "patchloom/patchloom-vscode"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("patchloom-vX.Y.Z", r.stderr)

    def test_accepts_patchloom_tag(self) -> None:
        r = run_script(
            {
                "TAG": "patchloom-v0.6.0",
                "GH_REPO": "patchloom/patchloom-vscode",
                "DRY_RUN": "1",
            }
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("leaving auto notes", r.stdout)

    def test_accepts_v_tag(self) -> None:
        r = run_script(
            {
                "TAG": "v0.6.0",
                "GH_REPO": "patchloom/patchloom-vscode",
                "DRY_RUN": "1",
            }
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("leaving auto notes", r.stdout)

    def test_notes_file_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            notes = Path(td) / "RELEASE_NOTES.md"
            notes.write_text("patchloom 0.6.0 notes\n", encoding="utf-8")
            r = run_script(
                {
                    "TAG": "patchloom-v0.6.0",
                    "GH_REPO": "patchloom/patchloom-vscode",
                    "DRY_RUN": "1",
                    "NOTES_FILE": str(notes),
                }
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("DRY_RUN: would apply file:", r.stdout)
            self.assertNotIn("would delete branch", r.stdout)

    def test_empty_file_is_noop(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            notes = Path(td) / "RELEASE_NOTES.md"
            notes.write_text("", encoding="utf-8")
            r = run_script(
                {
                    "TAG": "patchloom-v0.6.0",
                    "GH_REPO": "patchloom/patchloom-vscode",
                    "DRY_RUN": "1",
                    "NOTES_FILE": str(notes),
                }
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("leaving auto notes", r.stdout)

    def test_variable_requires_matching_tag(self) -> None:
        r = run_script(
            {
                "TAG": "patchloom-v0.6.0",
                "GH_REPO": "patchloom/patchloom-vscode",
                "DRY_RUN": "1",
                "RELEASE_NOTES": "hello",
                "RELEASE_NOTES_TAG": "0.5.0",
            }
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("leaving auto notes", r.stdout)

    def test_variable_matches_semver_pin(self) -> None:
        r = run_script(
            {
                "TAG": "patchloom-v0.6.0",
                "GH_REPO": "patchloom/patchloom-vscode",
                "DRY_RUN": "1",
                "RELEASE_NOTES": "hello notes\n",
                "RELEASE_NOTES_TAG": "0.6.0",
            }
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("DRY_RUN: would apply variable", r.stdout)

    def test_legacy_checkout_file(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            Path(td, "RELEASE_NOTES.md").write_text("legacy notes\n", encoding="utf-8")
            r = run_script(
                {
                    "TAG": "patchloom-v0.6.0",
                    "GH_REPO": "patchloom/patchloom-vscode",
                    "DRY_RUN": "1",
                },
                cwd=Path(td),
            )
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("legacy RELEASE_NOTES.md", r.stdout)
            self.assertIn("DRY_RUN: would apply file:RELEASE_NOTES.md", r.stdout)


if __name__ == "__main__":
    unittest.main()

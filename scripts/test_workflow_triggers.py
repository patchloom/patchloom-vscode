#!/usr/bin/env python3
"""Lock Recipe A, Recipe G stand-ins, and required check names."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"

REQUIRED_NAMES = (
    "ci",
    "npm audit",
    "Trivy vulnerability scan",
    "Gitleaks secret detection",
    "DCO sign-off",
    "CodeQL analysis",
)


def _on_block(text: str) -> str:
    start = text.index("\non:")
    rest = text[start + 1 :]
    end = rest.index("\njobs:")
    block = rest[:end]
    lines = []
    for line in block.splitlines():
        stripped = line.split("#", 1)[0].rstrip()
        if stripped:
            lines.append(stripped)
    return "\n".join(lines)


class WorkflowTriggerTests(unittest.TestCase):
    def test_required_check_names_still_exist(self) -> None:
        blob = "\n".join(
            p.read_text(encoding="utf-8") for p in WORKFLOWS.glob("*.yml")
        )
        for name in REQUIRED_NAMES:
            self.assertIn(f"name: {name}", blob, name)

    def test_ci_has_no_push_compile(self) -> None:
        on_block = _on_block((WORKFLOWS / "ci.yml").read_text(encoding="utf-8"))
        self.assertIn("pull_request:", on_block)
        self.assertIn("merge_group:", on_block)
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("push:", on_block)
        self.assertNotIn("tags:", on_block)

    def test_ci_has_release_please_stand_in(self) -> None:
        text = (WORKFLOWS / "ci.yml").read_text(encoding="utf-8")
        self.assertIn("startsWith(github.head_ref, 'release-please')", text)
        self.assertIn("npx tsc --noEmit", text)
        self.assertIn("release-please-check", text)

    def test_security_has_no_push_to_main(self) -> None:
        on_block = _on_block((WORKFLOWS / "security.yml").read_text(encoding="utf-8"))
        self.assertIn("pull_request:", on_block)
        self.assertIn("merge_group:", on_block)
        self.assertIn("schedule:", on_block)
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("push:", on_block)

    def test_codeql_stand_in_is_quoted(self) -> None:
        text = (WORKFLOWS / "security.yml").read_text(encoding="utf-8")
        self.assertIn(
            "echo 'version-bump PR; CodeQL already ran on the feature PR'",
            text,
        )
        self.assertNotIn('echo "OK:', text)

    def test_fossa_paths_on_push_and_pr(self) -> None:
        text = (WORKFLOWS / "fossa.yml").read_text(encoding="utf-8")
        on_block = _on_block(text)
        self.assertEqual(on_block.count("package.json"), 2)
        self.assertEqual(on_block.count(".github/workflows/fossa.yml"), 2)
        self.assertIn("startsWith(github.head_ref, 'release-please')", text)

    def test_post_merge_does_not_dispatch_ci_or_security(self) -> None:
        text = (WORKFLOWS / "post-merge.yml").read_text(encoding="utf-8")
        self.assertNotIn("gh workflow run ci.yml", text)
        self.assertNotIn("gh workflow run security.yml", text)
        self.assertIn("gh workflow run scorecard.yml", text)

    def test_release_stays_same_workflow(self) -> None:
        text = (WORKFLOWS / "release.yml").read_text(encoding="utf-8")
        on_block = _on_block(text)
        self.assertIn("push:", on_block)
        self.assertIn("branches: [main]", on_block)
        self.assertIn("workflow_dispatch:", on_block)
        self.assertNotIn("pull_request:", on_block)
        self.assertIn("scripts/apply-release-notes.sh", text)
        self.assertNotIn("gh workflow run Release", text)


if __name__ == "__main__":
    unittest.main()

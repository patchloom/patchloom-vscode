#!/usr/bin/env bash
# Strong guard against merging release-please PRs without explicit user approval.
#
# Usage:
#   bash scripts/guard-no-release-merge.sh [PR_NUMBER]
#   # or with current branch context (will try to detect open PR)
#
# Exits 0 if safe to merge (non-release PR).
# Exits 1 and prints guidance if release PR detected, unless ALLOW_RELEASE_MERGE=yes.
#
# This is a defense-in-depth guard for agents and humans.
# See AGENTS.md for the full "Release PRs - Strong Guard" policy.
# Per global rules: report the PR, ask user "Should I merge it?", only proceed after explicit "yes".

set -euo pipefail

pr="${1:-}"

if [[ -z "$pr" ]]; then
  # Try to detect PR from current context (works if gh pr view succeeds for head)
  if pr=$(gh pr view --json number --jq '.number' 2>/dev/null); then
    :
  else
    echo "ERROR: No PR number provided and could not auto-detect current PR."
    echo "Usage: $0 <pr-number>"
    exit 2
  fi
fi

echo "Guard: inspecting PR #$pr for release-please markers..."

title=$(gh pr view "$pr" --json title --jq '.title' 2>/dev/null || echo "")
labels=$(gh pr view "$pr" --json labels --jq '.labels[].name' 2>/dev/null || true)
body=$(gh pr view "$pr" --json body --jq '.body' 2>/dev/null | head -c 500 || true)

is_release=false
reason=""

if echo "$labels" | grep -q 'autorelease: pending'; then
  is_release=true
  reason="has label 'autorelease: pending'"
elif echo "$title" | grep -qiE '^(chore|release).*release |release v?[0-9]+\.[0-9]+'; then
  is_release=true
  reason="title looks like release: '$title'"
elif echo "$body" | grep -qi 'release-please'; then
  is_release=true
  reason="body mentions release-please"
fi

if [[ "$is_release" == "true" ]]; then
  echo ""
  echo "================================================================"
  echo "STRONG GUARD TRIGGERED"
  echo "================================================================"
  echo "PR #$pr is a release PR ($reason)."
  echo "Title: $title"
  echo ""
  echo "Release PRs (release-please etc) MUST NEVER be merged without the"
  echo "user's explicit approval in this chat session."
  echo ""
  echo "  1. Report: \"Release PR #$pr ($title) is ready to merge.\""
  echo "  2. Ask the user using ask_user_question or directly: \"Should I merge it?\""
  echo "  3. ONLY proceed after an explicit \"yes\" (or equivalent)."
  echo ""
  echo "Merging publishes a new version, creates tags, and triggers releases."
  echo "The user (not the agent) controls release cadence."
  echo ""
  echo "To bypass (ONLY after receiving explicit user yes):"
  echo "  ALLOW_RELEASE_MERGE=yes $0 $pr"
  echo "================================================================"
  echo ""

  if [[ "${ALLOW_RELEASE_MERGE:-}" != "yes" ]]; then
    exit 1
  fi
  echo "BYPASS: ALLOW_RELEASE_MERGE=yes detected. Proceeding (user approved)."
  exit 0
fi

echo "Guard OK: PR #$pr does not appear to be a release PR. Safe to consider merge."
exit 0

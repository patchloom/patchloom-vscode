#!/usr/bin/env bash
# Strong guard against merging release-please PRs without explicit user approval.
#
# Usage:
#   bash scripts/guard-no-release-merge.sh [PR_NUMBER]
#
# Exits 0 if the PR is not a release.
# Exits 1 if it is a release, unless ALLOW_RELEASE_MERGE=yes.
# Exits 2 if the PR title cannot be read. That is not permission to merge.
#
# A failed `gh` lookup used to print "safe to merge". PR #332
# (chore(main): release patchloom 0.10.0) was merged after that OK line.

set -euo pipefail

pr="${1:-}"

if [[ -z "$pr" ]]; then
  if pr=$(gh pr view --json number --jq '.number' 2>/dev/null); then
    :
  else
    echo "ERROR: No PR number provided and could not read the current PR."
    echo "Refusing to treat that as safe to merge."
    echo "Usage: $0 <pr-number>"
    exit 2
  fi
fi

repo_args=()
if [[ -n "${GH_REPO:-}" ]]; then
  repo_args=(--repo "$GH_REPO")
fi

echo "Guard: inspecting PR #$pr for release-please markers..."

if ! title=$(gh pr view "$pr" "${repo_args[@]}" --json title --jq '.title' 2>/dev/null); then
  echo "ERROR: could not read PR #$pr. Refusing to treat it as safe to merge."
  exit 2
fi
if [[ -z "${title//[[:space:]]/}" ]]; then
  echo "ERROR: PR #$pr has an empty title. Refusing to treat it as safe to merge."
  exit 2
fi

labels=$(gh pr view "$pr" "${repo_args[@]}" --json labels --jq '.labels[].name' 2>/dev/null || true)
body=$(gh pr view "$pr" "${repo_args[@]}" --json body --jq '.body' 2>/dev/null || true)

is_release=false
reason=""

shopt -s nocasematch
release_title_re='^(chore|release)(\([^)]*\))?:[[:space:]]*release[[:space:]]'
release_version_re='release[[:space:]]+v?[0-9]+\.[0-9]+'
if [[ "$labels" == *autorelease:* ]]; then
  is_release=true
  reason="has an autorelease label"
elif [[ "$title" =~ $release_title_re ]]; then
  is_release=true
  reason="title looks like release: '$title'"
elif [[ "$title" =~ $release_version_re ]]; then
  is_release=true
  reason="title looks like release: '$title'"
elif [[ "$body" == *release-please* ]]; then
  is_release=true
  reason="body mentions release-please"
fi
shopt -u nocasematch

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

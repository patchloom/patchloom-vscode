#!/bin/bash
# Patch all downloaded test VS Code .app bundles on macOS to run as
# background apps (no Dock icon, no Cmd+Tab, no focus stealing).
# Safe to run multiple times; skips already-patched bundles.
# No-op on Linux/Windows.

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

patched=0
shopt -s nullglob

for plist in \
  .vscode-test/*/Visual\ Studio\ Code*.app/Contents/Info.plist; do
  [ -f "$plist" ] || continue

  if plutil -extract LSUIElement raw "$plist" >/dev/null 2>&1; then
    continue
  fi

  plutil -insert LSUIElement -bool true "$plist"
  patched=$((patched + 1))
  echo "Patched: $plist"
done

if [[ $patched -eq 0 ]]; then
  echo "No test VS Code bundles to patch"
fi

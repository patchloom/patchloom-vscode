#!/usr/bin/env bash
# Classifier tests for guard-no-release-merge.sh. Uses a fake gh.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
guard="$root/scripts/guard-no-release-merge.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat >"$tmp/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${GUARD_GH_FAIL:-}" == "1" ]]; then
  echo "gh failed" >&2
  exit 1
fi
field=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--json" ]]; then
    field="$arg"
  fi
  prev="$arg"
done
case "$field" in
  title) printf '%s\n' "${GUARD_TITLE-}" ;;
  labels) printf '%s\n' "${GUARD_LABELS-}" ;;
  body) printf '%s\n' "${GUARD_BODY-}" ;;
  *)
    echo "unexpected gh: $*" >&2
    exit 1
    ;;
esac
EOF
chmod +x "$tmp/gh"

expect() {
  local want="$1"
  local needle="$2"
  shift 2
  local out got
  set +e
  out="$(PATH="$tmp:$PATH" "$@" 2>&1)"
  got=$?
  set -e
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: exit $got, wanted $want"
    printf '%s\n' "$out"
    exit 1
  fi
  if ! printf '%s\n' "$out" | grep -q "$needle"; then
    echo "FAIL: missing [$needle]"
    printf '%s\n' "$out"
    exit 1
  fi
  echo "OK: exit $want [$needle]"
}

GUARD_GH_FAIL=1 \
  expect 2 "could not read" \
  bash "$guard" 332

GUARD_GH_FAIL= \
  GUARD_TITLE="" \
  expect 2 "empty title" \
  bash "$guard" 332

GUARD_GH_FAIL= \
  GUARD_TITLE="chore(main): release patchloom 0.10.0" \
  GUARD_LABELS="" \
  GUARD_BODY="" \
  expect 1 "STRONG GUARD TRIGGERED" \
  bash "$guard" 332

ALLOW_RELEASE_MERGE=yes \
  GUARD_GH_FAIL= \
  GUARD_TITLE="chore(main): release patchloom 0.10.0" \
  expect 0 "BYPASS" \
  bash "$guard" 332

ALLOW_RELEASE_MERGE= \
  GUARD_TITLE="fix: correct status and install messages" \
  GUARD_LABELS="" \
  GUARD_BODY="ordinary bugfix" \
  expect 0 "does not appear to be a release PR" \
  bash "$guard" 332

GUARD_TITLE="chore: deps" \
  GUARD_LABELS="autorelease: tagged" \
  GUARD_BODY="" \
  expect 1 "autorelease" \
  bash "$guard" 332

GUARD_TITLE="docs: notes" \
  GUARD_LABELS="" \
  GUARD_BODY=":robot: I have created a release *beep* *boop* release-please" \
  expect 1 "release-please" \
  bash "$guard" 332

echo "DONE: release guard classifier"

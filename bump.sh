#!/bin/bash
# Bump version in manifest.json. Usage: ./bump.sh [patch|minor|major] [--tag]
set -e

bump=${1:-patch}
case "$bump" in
  patch|minor|major) ;;
  *) echo "usage: $0 [patch|minor|major] [--tag]" >&2; exit 1 ;;
esac

if command -v python3 >/dev/null 2>&1; then
  python_cmd=python3
elif command -v python >/dev/null 2>&1; then
  python_cmd=python
else
  echo "python3 or python is required" >&2
  exit 1
fi

read -r current next < <("$python_cmd" - "$bump" <<'PY'
import re, sys, pathlib
bump = sys.argv[1]
p = pathlib.Path('manifest.json')
data = p.read_bytes()
m = re.search(rb'"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"', data)
if not m:
    raise SystemExit('could not find version in manifest.json')
major, minor, patch = map(int, m.groups())
current = f'{major}.{minor}.{patch}'
if bump == 'major':
    major, minor, patch = major + 1, 0, 0
elif bump == 'minor':
    minor, patch = minor + 1, 0
else:
    patch += 1
nxt = f'{major}.{minor}.{patch}'
new_line = f'"version": "{nxt}"'.encode()
patched = re.sub(rb'"version"\s*:\s*"\d+\.\d+\.\d+"', new_line, data, count=1)
p.write_bytes(patched)
print(current, nxt)
PY
)

echo "$current -> $next"

if [ "${2:-}" = "--tag" ]; then
  git add manifest.json
  git commit -m "chore: bump version to $next"
  git tag -a "v$next" -m "v$next"
  echo "tagged v$next (push with: git push --follow-tags)"
fi

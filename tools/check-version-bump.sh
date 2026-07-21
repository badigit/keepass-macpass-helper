#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# There is no version to compare against in a repository without a first commit.
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  exit 0
fi

changed=$(git diff --name-only HEAD -- \
  manifest.json worker.js _locales connect data tools \
  ':(exclude)tools/check-version-bump.sh' \
  ':(exclude)tools/*.test.js')

if [ -z "$changed" ]; then
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  python_cmd=python3
elif command -v python >/dev/null 2>&1; then
  python_cmd=python
else
  echo "python3 or python is required for the version check" >&2
  exit 1
fi

read_version() {
  "$python_cmd" -c 'import json,sys; print(json.load(sys.stdin)["version"])'
}

head_version=$(git show HEAD:manifest.json | read_version)
current_version=$(read_version < manifest.json)

if [ "$current_version" = "$head_version" ]; then
  echo "Extension files changed, but manifest.json is still version $current_version." >&2
  echo "Run ./bump.sh patch (or minor/major) before building." >&2
  exit 1
fi

echo "Version check passed: $head_version -> $current_version"

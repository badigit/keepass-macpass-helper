#!/bin/bash
set -e

# Build KeePassHelper extension from repository root for Chrome
echo "Building KeePassHelper extension..."

# Refuse to package changed extension code under the previous version.
bash tools/check-version-bump.sh

# Clean up previous build
rm -f keepass-helper.zip

# Create ZIP archive only from extension assets in repository root.
if command -v zip >/dev/null 2>&1; then
  zip -r keepass-helper.zip \
    manifest.json \
    worker.js \
    _locales \
    connect \
    data \
    tools \
    -x '*.DS_Store'
elif command -v 7z >/dev/null 2>&1; then
  7z a -tzip keepass-helper.zip \
    manifest.json \
    worker.js \
    _locales \
    connect \
    data \
    tools \
    -xr!'*.DS_Store' >/dev/null
elif command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path 'manifest.json','worker.js','_locales','connect','data','tools' -DestinationPath 'keepass-helper.zip' -Force"
else
  echo "zip or powershell.exe is required to build the extension" >&2
  exit 1
fi

echo "Build completed: keepass-helper.zip"

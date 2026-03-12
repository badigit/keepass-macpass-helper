#!/bin/bash
set -e

# Build KeePassHelper extension from repository root for Chrome
echo "Building KeePassHelper extension..."

# Clean up previous build
rm -f keepass-helper.zip

# Create ZIP archive only from extension assets in repository root
zip -r keepass-helper.zip \
  manifest.json \
  worker.js \
  _locales \
  connect \
  data \
  tools \
  -x '*.DS_Store'

echo "Build completed: keepass-helper.zip"

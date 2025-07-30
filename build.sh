#!/bin/bash
set -e

# Build KeePassHelper extension from v3 directory for Chrome
echo "Building KeePassHelper extension..."

# Clean up previous build
rm -f keepass-helper.zip

# Create ZIP archive for Chrome extension
cd v3
zip -r ../keepass-helper.zip . -x '*.DS_Store'
cd ..

echo "Build completed: keepass-helper.zip"

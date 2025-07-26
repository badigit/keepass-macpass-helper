#!/bin/sh
set -e
# Build KeePassHelper extension from v3 directory
rm -f keepass-helper.zip
cd v3
zip -r ../keepass-helper.zip . -x '*.DS_Store'

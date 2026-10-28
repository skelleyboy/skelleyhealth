#!/bin/bash
# Double-click to publish skelleyhealth.netlify.app and start syncing your NOOP data.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
clear
echo "=== Publishing skelleyhealth ==="
echo
if ./deploy.sh skelleyhealth; then
  echo
  echo "=== Setting up the sync from your iPhone ==="
  ./sync/install.sh
fi
echo
read -n 1 -s -r -p "Press any key to close this window."

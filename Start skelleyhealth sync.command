#!/bin/bash
# Double-click to start (or repair) syncing your NOOP data to skelleyhealth.netlify.app.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
clear
echo "=== skelleyhealth: setting up the sync from your iPhone ==="
echo "(The site is already live at https://skelleyhealth.netlify.app and redeploys from GitHub.)"
echo
./sync/install.sh
echo
read -n 1 -s -r -p "Press any key to close this window."

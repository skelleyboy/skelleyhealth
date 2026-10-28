#!/bin/bash
# Stops the background sync and removes the saved passphrase. Your site and NOOP are untouched.
LABEL="com.noopweb.sync"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
security delete-generic-password -a "$USER" -s noop-web-passphrase >/dev/null 2>&1 || true
echo "Background sync stopped and passphrase removed."

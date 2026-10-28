#!/bin/bash
# One-time setup for the Mac sync: saves your passphrase in the Keychain, runs a first sync,
# and schedules it every 15 minutes in the background (a LaunchAgent).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
NODE="$(command -v node || true)"
LABEL="com.noopweb.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/noop-web-sync.log"

[ -n "$NODE" ] || { echo "Node.js isn't installed. Get it from https://nodejs.org, then run this again."; exit 1; }
[ -f "$ROOT/.netlify/state.json" ] || { echo "Run ./deploy.sh first to create your Netlify site."; exit 1; }

echo "→ Installing sync dependencies"
(cd "$DIR" && npm install --silent --no-fund --no-audit)

if security find-generic-password -a "$USER" -s noop-web-passphrase >/dev/null 2>&1; then
  echo "→ Passphrase already saved in your Keychain (delete 'noop-web-passphrase' in Keychain Access to change it)"
else
  echo
  echo "Choose a passphrase. It encrypts your health data before it leaves this Mac,"
  echo "and you'll type it once on each phone/iPad. Netlify never sees it."
  while true; do
    read -r -s -p "Passphrase: " P1; echo
    read -r -s -p "Again: " P2; echo
    [ "$P1" = "$P2" ] && [ ${#P1} -ge 8 ] && break
    echo "They didn't match or it's under 8 characters. Try again."
  done
  security add-generic-password -U -a "$USER" -s noop-web-passphrase -w "$P1"
  unset P1 P2
  echo "→ Saved to your Keychain"
fi

echo "→ First sync (macOS may ask to let Terminal access NOOP's data. Click Allow.)"
if ! "$NODE" "$DIR/noop-sync.mjs"; then
  echo
  echo "The first sync failed. If it mentions access or permission, give Terminal Full Disk Access:"
  echo "System Settings → Privacy & Security → Full Disk Access → turn on Terminal, then run this again."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || true
  exit 1
fi

echo "→ Scheduling background sync every 15 minutes"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/noop-sync.mjs</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 6
if tail -n 5 "$LOG" 2>/dev/null | grep -q "uploaded"; then
  echo "→ Background sync is working."
else
  echo
  echo "One more permission: the background sync runs node, which macOS needs to allow too."
  echo "In the window that opens, click +, then press Cmd+Shift+G, paste this path, and add it:"
  echo "    $NODE"
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" || true
  echo "Then check it worked with:  tail -n 3 \"$LOG\""
fi
echo
echo "Setup complete. Open your Netlify site on your phone, unlock with your passphrase,"
echo "then tap Share → Add to Home Screen."

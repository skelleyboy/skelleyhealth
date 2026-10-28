# NOOP Web

Your NOOP data as a private website for your phone, iPad, and Mac. It copies NOOP's Today,
Sleep, Trends, and Workouts screens.

```
WHOOP strap → NOOP on iPhone → daily backup to iCloud Drive/NOOP Backups ┐
            → NOOP on Mac (optional) ────────────────────────────────────┴→ sync/noop-sync.mjs on Mac
              (every 15 min, merges both, freshest wins) → encrypted → Netlify → your devices
```

- Data is encrypted on your Mac with your passphrase before upload. Netlify only stores ciphertext.
- The sync only reads NOOP's database and never writes to it.
- iPhone data reaches the site when NOOP saves a backup (daily automatic, or tap **Back up now**
  in NOOP → Settings → Backup & Sync), and your Mac is awake to pick it up from iCloud.
- If the strap syncs to the Mac instead, that data shows up within 15 minutes.

## First-time setup (about 10 minutes)

In Terminal:

```bash
cd ~/Documents/noop-web
./deploy.sh          # logs in to Netlify (browser), creates the site, publishes it
./sync/install.sh    # choose a passphrase, first sync, background sync every 15 min
```

Then open the site URL on your iPhone/iPad, unlock with your passphrase, and tap
**Share → Add to Home Screen**.

## Changing the design

Everything lives in `src/app.html` (one file: CSS at the top, views in the script).

```bash
npm run dev          # http://localhost:8888 with your real data, rebuilds on save
./deploy.sh          # publish when you're happy
```

Each `./deploy.sh` is a production deploy: 15 of your 300 free Netlify credits a month, so
about 20 a month. Iterate locally and deploy in batches. Data syncs don't use deploys.

## Useful commands

```bash
tail -n 5 ~/Library/Logs/noop-web-sync.log   # did the last sync work?
npm run sync                                  # sync right now
./sync/uninstall.sh                           # stop syncing, remove the saved passphrase
```

## Notes

- NOOP is PolyForm Noncommercial. This is fine for personal use, but don't sell it.
- Passphrase lives in your Mac's Keychain as `noop-web-passphrase`. Forgot it? Run
  `./sync/uninstall.sh`, then `./sync/install.sh` to pick a new one.

#!/bin/bash
# Publishes the website to Netlify. Run once to create the site, then only when you change the design.
# Each production deploy costs 15 of your 300 free Netlify credits per month, so iterate locally
# (npm run dev) and deploy when you're happy. Your data syncs separately and costs no deploys.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then run this again."; exit 1; }

echo "→ Installing dependencies"
npm install --silent --no-fund --no-audit
node tools/build.mjs

if ! npx --yes netlify-cli status >/dev/null 2>&1; then
  echo "→ Opening your browser to log in to Netlify"
  npx --yes netlify-cli login
fi

if [ ! -f .netlify/state.json ]; then
  NAME="${1:-skelleyhealth}"
  echo "→ Creating Netlify site: $NAME"
  npx --yes netlify-cli sites:create --name "$NAME"
fi

echo "→ Deploying"
npx --yes netlify-cli deploy --prod --dir site --functions netlify/functions
echo
echo "Done. Your site: https://skelleyhealth.netlify.app (if that name was free)."
echo "Next: run ./sync/install.sh to start sending your NOOP data."

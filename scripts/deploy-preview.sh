#!/usr/bin/env bash
# DEL-1 stage 2 (T-018): build and deploy the preview Worker. The build runs without any local
# .env* file (they hold local Supabase URLs/keys), and the deploy aborts unless OpenNext baked an
# empty environment; runtime configuration comes from `env.preview` vars and secrets.
set -euo pipefail
held=()
restore() { for f in "${held[@]}"; do mv "$f.deploy-hold" "$f"; done; }
trap restore EXIT
for f in .env .env.local .env.production .env.production.local; do
  if [ -e "$f.deploy-hold" ]; then echo "deploy-preview: $f.deploy-hold exists from an earlier run; restore it first" >&2; exit 1; fi
  if [ -f "$f" ]; then mv "$f" "$f.deploy-hold"; held+=("$f"); fi
done
pnpm exec opennextjs-cloudflare build
node scripts/check-client-bundle.mjs
node -e '
  import("./.open-next/cloudflare/next-env.mjs").then((m) => {
    const baked = ["production", "development", "test"].flatMap((k) => Object.keys(m[k] ?? {}));
    if (baked.length) { console.error("deploy-preview: build baked env keys: " + baked.join(", ")); process.exit(1); }
  });'
env -u CLOUDFLARE_API_TOKEN -u CF_API_TOKEN pnpm exec wrangler deploy --env preview

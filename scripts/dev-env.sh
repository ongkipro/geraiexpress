#!/usr/bin/env bash
# Writes local-only server env for `next dev` (.env.local) and `wrangler dev` (.dev.vars) from the
# running local Supabase stack. Both files are gitignored. Never point these at a shared project.
set -euo pipefail
json="$(pnpm exec supabase status -o json 2>/dev/null | sed -n '/^{/,$p')"
url="$(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.API_URL)' "$json")"
key="$(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.PUBLISHABLE_KEY||s.ANON_KEY)' "$json")"
printf 'SUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$url" "$key" > .env.local
printf 'NEXTJS_ENV=development\nSUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$url" "$key" > .dev.vars
echo "dev-env: wrote .env.local and .dev.vars for $url"

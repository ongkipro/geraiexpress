#!/usr/bin/env bash
# Writes local-only server env for `next dev` (.env.local) and `wrangler dev` (.dev.vars) from the
# running local Supabase stack. Both files are gitignored. Never point these at a shared project.
set -euo pipefail
json="$(pnpm exec supabase status -o json 2>/dev/null | sed -n '/^{/,$p')"
url="$(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.API_URL)' "$json")"
key="$(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.PUBLISHABLE_KEY||s.ANON_KEY)' "$json")"
# Local-only credential sealing key (T-015), only in .dev.vars: it reaches `next dev` and
# `wrangler dev` as a Cloudflare binding. It must never go into .env.local, because OpenNext bakes
# .env* values into the Worker build (check:bundle fails if it does). Reused if valid so locally
# stored ciphertext stays readable; never printed. Production uses `wrangler secret put`.
cred="$(sed -n 's/^CREDENTIAL_KEY=//p' .dev.vars 2>/dev/null | head -1)"
if [ "$(printf '%s' "$cred" | base64 -d 2>/dev/null | wc -c)" != "32" ]; then
  cred="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')"
fi
umask 077
printf 'SUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\n' "$url" "$key" > .env.local
# TURNSTILE_SITE_KEY is public; locally Cloudflare's always-pass test site key (T-016).
# DEC-009: the hook secret is shared with the local Auth stack via supabase/.env; mail goes to
# the local Mailpit capture only.
hook="$(sed -n 's/^GE_SEND_EMAIL_HOOK_SECRET=//p' supabase/.env 2>/dev/null | head -1)"
mailpit="$(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.MAILPIT_URL||s.INBUCKET_URL||"")' "$json")"
# DEC-010: the local stack's secret key is the dispatcher's machine identity; like CREDENTIAL_KEY
# it goes only into .dev.vars (a binding), never .env.local. Live Mengantar calls use the sandbox.
secret="$(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.SECRET_KEY||s.SERVICE_ROLE_KEY)' "$json")"
printf 'NEXTJS_ENV=development\nSUPABASE_URL=%s\nSUPABASE_PUBLISHABLE_KEY=%s\nCREDENTIAL_KEY=%s\nTURNSTILE_SITE_KEY=1x00000000000000000000AA\nSEND_EMAIL_HOOK_SECRET=%s\nMAIL_TRANSPORT=mailpit\nMAILPIT_URL=%s\nSUPABASE_SECRET_KEY=%s\nMENGANTAR_ENV=sandbox\n' "$url" "$key" "$cred" "$hook" "$mailpit" "$secret" > .dev.vars
chmod 600 .env.local .dev.vars
echo "dev-env: wrote .env.local and .dev.vars for $url"

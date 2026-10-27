#!/usr/bin/env bash
# Local-only values that supabase/config.toml reads through env() (T-016). supabase/.env is
# gitignored. The Turnstile secret here is Cloudflare's documented always-pass TEST secret; a
# real project sets its own secret in its Auth settings and never receives this file.
set -euo pipefail
if [ ! -f supabase/.env ] || ! grep -q '^GE_AUTH_CAPTCHA_SECRET[=]' supabase/.env; then
  umask 077
  printf '# Local only (T-016): Cloudflare documented always-pass Turnstile TEST secret.\nGE_AUTH_CAPTCHA_SECRET=1x0000000000000000000000000000000AA\n' >> supabase/.env
fi
# DEC-009: local signing secret for the Send Email Hook (random, generated once, never printed).
if ! grep -q '^GE_SEND_EMAIL_HOOK_SECRET[=]' supabase/.env; then
  umask 077
  printf '%s=v1,whsec_%s\n' 'GE_SEND_EMAIL_HOOK_SECRET' "$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64"))')" >> supabase/.env
fi
chmod 600 supabase/.env

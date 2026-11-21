#!/bin/sh
# Caddy container entrypoint: check the settings from .env, hash the dashboard password, start Caddy.
set -eu

fail() {
  echo "$1 (see .env.example)" >&2
  exit 1
}

[ -n "${OCULUS_DOMAIN:-}" ] || fail "OCULUS_DOMAIN is not set: put the DNS name that points at this server in .env"
# The name goes into the Caddyfile as-is, so keep it to characters that can't break the syntax.
case "${DASHBOARD_USER:-}" in
  "" | *[!A-Za-z0-9._-]*) fail "DASHBOARD_USER must be set, using only letters, digits, '.', '_' or '-'" ;;
esac
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:-}
[ "${#DASHBOARD_PASSWORD}" -ge 12 ] || fail "DASHBOARD_PASSWORD must be set and at least 12 characters"

# Caddy only accepts a password hash. Hashing here means .env holds a normal password; it's
# piped in (not passed as an argument) so it never shows up in the process list.
DASHBOARD_PASSWORD_HASH=$(printf '%s' "$DASHBOARD_PASSWORD" | caddy hash-password)
export DASHBOARD_PASSWORD_HASH
unset DASHBOARD_PASSWORD

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile

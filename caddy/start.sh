#!/bin/sh
# Caddy container entrypoint: check the settings from .env, then start Caddy. Caddy would also
# fail on bad values, but with a less obvious message.
set -eu

fail() {
  echo "$1 (see .env.example)" >&2
  exit 1
}

[ -n "${DOMAIN:-}" ] || fail "DOMAIN is not set: put the DNS name that points at this server in .env"
# The name goes into the Caddyfile as-is, so keep it to characters that can't break the syntax.
case "${DASHBOARD_USER:-}" in
  "" | *[!A-Za-z0-9._-]*) fail "DASHBOARD_USER must be set, using only letters, digits, '.', '_' or '-'" ;;
esac
# A bcrypt hash: $2a$ / $2b$ / $2y$, a two-digit cost, then 53 characters (60 in all). If it is
# shorter, the usual cause is a .env value in double quotes or none: compose then reads the
# "$2a..." parts as variables. Single quotes keep it literal.
HASH=${DASHBOARD_PASSWORD_HASH:-}
case "$HASH" in
  '$2'[aby]'$'[0-9][0-9]'$'*) [ "${#HASH}" -eq 60 ] ||
    fail "DASHBOARD_PASSWORD_HASH isn't a whole bcrypt hash (${#HASH} characters, expected 60): paste the full output of caddy hash-password, in single quotes" ;;
  *) fail "DASHBOARD_PASSWORD_HASH must be a bcrypt hash: make one with 'docker run --rm -it caddy:2-alpine caddy hash-password'" ;;
esac

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile

#!/bin/sh
# Runs at container start, before nginx renders its config (the image's /docker-entrypoint.d/).
#
# Turns the dashboard's read keys from .env into two files:
#   /etc/nginx/oculus/read-keys.map  game slug -> read key, for the nginx map in default.conf.
#                                    Only nginx's master process (root) reads it.
#   /etc/nginx/oculus/games.json     the slugs alone, served at /dash/games.json for the
#                                    dashboard's game picker. No keys in it.
#
# Accepted settings (one or the other, not both):
#   OCULUS_READ_KEYS="my-game=ocl_...,other-game=ocl_..."   several games
#   OCULUS_READ_KEY=ocl_...                                 one game (its slug is "main")
#
# Anything malformed stops the container with a message, rather than starting a dashboard
# that quietly shows the wrong game or none. This check lives here, not in docker-compose.yml,
# because compose checks required variables for every service, which would make
# `docker compose up -d db` need a .env too.
set -eu
set -f # the key list is split on commas below; never expand * or ? in it

fail() {
  echo "oculus: $*" >&2
  echo "oculus: see OCULUS_READ_KEYS in .env.example" >&2
  exit 1
}

keys="${OCULUS_READ_KEYS:-}"
single="${OCULUS_READ_KEY:-}"
if [ -n "$keys" ] && [ -n "$single" ]; then
  fail "both OCULUS_READ_KEYS and OCULUS_READ_KEY are set: keep only OCULUS_READ_KEYS (add the old key to it as slug=key)"
fi
if [ -z "$keys" ]; then
  [ -n "$single" ] || fail "no read key: set OCULUS_READ_KEYS (or OCULUS_READ_KEY for a single game) in .env"
  keys="main=$single"
fi

dir=/etc/nginx/oculus
mkdir -p "$dir"
map="$dir/read-keys.map"
umask 077
: >"$map"
umask 022

json=""
seen=" "
count=0
old_ifs=$IFS
IFS=,
for pair in $keys; do
  pair=$(printf '%s' "$pair" | tr -d ' \t\r\n')
  [ -n "$pair" ] || continue
  case "$pair" in
    *=*) ;;
    *) fail "an entry in OCULUS_READ_KEYS has no \"=\": write each game as slug=key" ;;
  esac
  slug=${pair%%=*}
  key=${pair#*=}
  # Lowercase letters, digits and dashes: safe in a header, a JSON string and an nginx map,
  # and nginx compares map keys without case anyway.
  printf '%s\n' "$slug" | grep -Eq '^[a-z0-9][a-z0-9-]{0,31}$' ||
    fail "game slug \"$slug\" must be 1-32 lowercase letters, digits or dashes (e.g. my-game)"
  # Words that mean something special inside an nginx map.
  case "$slug" in
    default | hostnames | include | volatile) fail "\"$slug\" can't be a game slug: pick another name" ;;
  esac
  # Same shape the API accepts (lib/keys.ts parseBearer), so nothing odd lands in the config.
  printf '%s\n' "$key" | grep -Eq '^[A-Za-z0-9_-]{16,128}$' ||
    fail "the key for \"$slug\" doesn't look like an Oculus key (ocl_...)"
  case "$seen" in
    *" $slug "*) fail "game slug \"$slug\" is listed twice" ;;
  esac
  seen="$seen$slug "
  printf '%s %s;\n' "$slug" "$key" >>"$map"
  json="$json${json:+,}{\"slug\":\"$slug\"}"
  count=$((count + 1))
done
IFS=$old_ifs
[ "$count" -gt 0 ] || fail "OCULUS_READ_KEYS lists no games"

printf '{"games":[%s]}\n' "$json" >"$dir/games.json"
echo "oculus: dashboard games: $(printf '%s' "$seen" | sed 's/^ //; s/ $//; s/ /, /g')"

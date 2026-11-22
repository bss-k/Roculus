#!/bin/sh
# Restores a dump from ./backups into a NEW database, and never touches the live one.
#
#   scripts/restore.sh oculus-2026-11-21T030000Z.dump [target_db]     (default target: oculus_restore)
#
# It runs pg_restore inside the `backup` service's container: that container can read the
# root-only dump files and reach Postgres over the compose network. Afterwards it prints row
# counts so you can compare them with the live database. Putting the restored copy into
# service (renaming databases) is a separate, deliberate step: see docs/deploy-oracle.md.
set -eu

cd "$(dirname "$0")/.."
file=${1:-}
target=${2:-oculus_restore}

if [ -z "$file" ]; then
  echo "usage: scripts/restore.sh <dump file in ./backups> [target_db]" >&2
  echo "available dumps:" >&2
  docker compose --profile deploy run --rm --no-deps -T --entrypoint ls backup -1 /backups >&2 || true
  exit 1
fi
case "$file" in
  */* | .*) echo "give the file name only (as listed in ./backups), not a path" >&2; exit 1 ;;
esac
case "$target" in
  oculus) echo "refusing to restore over the live 'oculus' database; restore to a new one and switch deliberately" >&2; exit 1 ;;
  *[!a-z0-9_]* | "") echo "target database name: lowercase letters, digits and _ only" >&2; exit 1 ;;
esac

# Runs a command in a one-off backup container (same image, env and /backups mount).
run() {
  cmd=$1
  shift
  docker compose --profile deploy run --rm --no-deps -T --entrypoint "$cmd" backup "$@"
}

run test -f "/backups/$file" || { echo "no such dump: backups/$file" >&2; exit 1; }

echo "creating database $target (fails if it already exists, so nothing is overwritten)"
run createdb "$target"

echo "restoring backups/$file into $target"
# --no-owner: objects belong to whoever restores them. --exit-on-error: stop at the first
# problem rather than leave a half-restored database that looks fine.
run pg_restore --no-owner --exit-on-error --dbname "$target" "/backups/$file"

echo "row counts in $target:"
run psql --dbname "$target" --no-psqlrc --pset footer=off -c \
  "SELECT 'games' AS table_name, count(*) FROM games
   UNION ALL SELECT 'api_keys', count(*) FROM api_keys
   UNION ALL SELECT 'events', count(*) FROM events
   UNION ALL SELECT 'rejected_requests', count(*) FROM rejected_requests
   UNION ALL SELECT 'admin_audit', count(*) FROM admin_audit"
echo "done. Compare with the live database:  docker compose exec db psql -U oculus -c 'SELECT count(*) FROM events'"

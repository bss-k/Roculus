#!/bin/sh
# Runs in the `backup` compose service (postgres image, so pg_dump matches the server version).
#
#   (no argument)  every night at BACKUP_HOUR_UTC, dump the database into /backups, then delete
#                  dumps older than BACKUP_KEEP_DAYS
#   now            take one dump right away and exit:  docker compose --profile deploy run --rm backup now
#
# Dumps use pg_dump's custom format (-Fc): compressed, and pg_restore can restore all of it or
# pick single tables. Restore with scripts/restore.sh. Connection settings come from the PG*
# environment variables set in docker-compose.yml.
set -eu

HOUR=${BACKUP_HOUR_UTC:-3}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-7}
DIR=/backups

# Dumps hold every event and key hash: readable by root only.
umask 077

dump() {
  name="oculus-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
  # Write to a temporary name and rename at the end, so a failed or interrupted dump never
  # looks like a good one.
  if pg_dump -Fc --file "$DIR/.$name.partial"; then
    mv "$DIR/.$name.partial" "$DIR/$name"
    echo "$(date -u +%FT%TZ) backup ok: $name ($(du -h "$DIR/$name" | cut -f1))"
    # Prune only after a successful dump, so failing backups never delete the last good ones.
    find "$DIR" -maxdepth 1 -name 'oculus-*.dump' -mtime "+$((KEEP_DAYS - 1))" -print -delete |
      sed 's/^/  deleted old backup: /'
  else
    rm -f "$DIR/.$name.partial"
    echo "$(date -u +%FT%TZ) BACKUP FAILED (older backups kept)" >&2
    return 1
  fi
}

if [ "${1:-}" = "now" ]; then
  dump
  exit
fi

echo "backups at ${HOUR}:00 UTC every night, keeping ${KEEP_DAYS} days, in ./backups"
while true; do
  # Seconds until the next HOUR:00 UTC.
  now=$(date -u +%s)
  next=$((now / 86400 * 86400 + HOUR * 3600))
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  sleep $((next - now))
  dump || true # keep the loop alive; the failure is in the logs
done

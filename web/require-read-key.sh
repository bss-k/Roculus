#!/bin/sh
# Runs at container start, before nginx renders its config (the image's /docker-entrypoint.d/).
# Without a read key nginx would send "Bearer " and every dashboard call would get a 401, so
# refuse to start instead. This lives here, not in docker-compose.yml, because compose checks
# required variables for every service, which would make `docker compose up -d db` need a .env too.
if [ -z "${OCULUS_READ_KEY:-}" ]; then
  echo "OCULUS_READ_KEY is not set: put a read-scoped key in .env (see .env.example)." >&2
  exit 1
fi

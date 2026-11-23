# Changelog

All notable changes to this project. Versions follow [Semantic Versioning](https://semver.org).

## [1.0.0] - 2026-11-23

First release: ingest, dashboard, key management and a production deploy setup.

### Ingest API
- `POST /v1/events` accepts batches of up to 100 Remote-Guard violation events.
- Per-game API keys (stored only as SHA-256 hashes) in `ingest`, `read` and `admin` scopes.
- Per-key token-bucket rate limits, a 128 KB body cap, and strict Zod schemas that reject unknown fields.
- Every refused request is logged to `rejected_requests` with its reason, with a cap so floods can't fill the table.

### Dashboard
- Screens: Overview, Violations, Players, Remotes, and Ingestion & keys.
- 1h / 24h / 7d windows, player and remote drill-down drawers, and live polling.
- Several games on one deploy. Read keys stay on the server and never reach the browser.

### Key management
- Rotation with a grace period (0–168 h), during which the old and new keys both work.
- Revocation, plus an admin audit log of every rotate and revoke.
- The admin key is typed into the dashboard and kept in memory only.

### Roblox
- `OculusClient.luau`: a Remote-Guard sink that queues events and sends them in batches.
- Retries with exponential backoff and jitter, a capped queue, and UTF-8-safe truncation of every field.

### Deploy
- Docker Compose deploy with Caddy (automatic HTTPS, security headers, dashboard login).
- Nightly `pg_dump` backups with 7-day retention, plus `restore.sh` and the `smoke.mjs` end-to-end check.
- Guides: [Oracle Cloud deploy](docs/deploy-oracle.md) and [Roblox integration](docs/roblox-integration.md).

### Quality
- 213 API tests against a real Postgres database.
- CI runs lint, typecheck and tests, builds both images, and validates the Caddy, nginx and compose configs.

### Upgrading
- Fresh install: the API applies migrations `001`–`003` on start.

[1.0.0]: https://github.com/bss-k/Roculus/releases/tag/v1.0.0

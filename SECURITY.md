# Security policy

Roculus is a security tool, so reports are welcome.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and what an attacker could do with it.
You'll get a reply within 7 days.

## Supported versions

Only the latest release gets fixes.

## In scope

- The API (`api/`): authentication, key scopes, rotation and expiry, rate limiting, validation,
  per-game isolation, the audit log
- The deploy setup: `caddy/`, `docker-compose.yml`, the nginx config in `web/`
- `roblox/OculusClient.luau`

## Out of scope

- Weaknesses that need an attacker who already has a valid admin key or shell access to the server
- Denial of service through sheer traffic volume (the deploy targets one small VM)
- Known limits listed in the README's threat model

## Handling secrets

Never paste a real API key into an issue or pull request. If a key leaks, rotate it from the
Ingestion & keys screen or with `npm run create-key -w api`.

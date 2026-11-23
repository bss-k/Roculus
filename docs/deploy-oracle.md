# Deploying Roculus on an Oracle Cloud Always Free VM

This takes you from an empty Oracle Cloud account to Roculus running at `https://<your domain>`,
with game servers posting to `https://<your domain>/v1/events` and the dashboard behind a login.

Every command after "Install Docker" was run end to end on a local copy of this deploy
(`DOMAIN=localhost`, Caddy's internal CA) before this guide was written. The Oracle-specific steps
(console, security list, iptables, DNS) can only be checked on a real VM: follow them, then test
from outside as described.

```
Internet ──► Caddy :80/:443 (TLS, security headers, body limit)
               ├─ /v1/*        ──► api:3000   (game servers and API clients; API keys)
               └─ everything else ─ login ─► web:80 (nginx: dashboard, /dash proxies) ──► api:3000
             api ──► db (Postgres, localhost only) ◄── backup (nightly pg_dump into ./backups)
```

## 1. Create the VM

**Check the limits first.** Always Free allowances change, so read Oracle's
[Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
page on the day you create the VM. When this guide was written (November 2026) it said, for the
Ampere A1 shape `VM.Standard.A1.Flex`:

- 2 OCPUs and 12 GB of memory in total, as one instance or two (1 OCPU each), in your **home region** only;
- 200 GB of block storage in total, boot volumes included (a boot volume is 50 GB by default);
- 10 TB of outbound data per month;
- idle instances "may be reclaimed": an instance counts as idle when, over 7 days, 95th-percentile
  CPU, network and (for A1) memory utilization are all under 20%. A lightly used Roculus can look
  idle, so keep copies of your backups off the VM (section 9).

If the page says something different, follow the page. Then, in the Oracle Cloud console:

1. **Compute → Instances → Create instance.**
2. **Image:** Canonical Ubuntu (the latest LTS). **Shape:** Ampere `VM.Standard.A1.Flex`, with the
   OCPUs and memory the page allows (one instance with all of it is simplest).
3. **Networking:** a public subnet, and assign a public IPv4 address.
4. **SSH keys:** upload your public key (or download the generated pair and keep the private key safe).
5. Create it. "Out of host capacity" means the region has no free A1 capacity right now; Oracle
   describes it as temporary, so try again later.

## 2. Open ports 80 and 443: two layers

Traffic has to pass **both** Oracle's network rules and the VM's own firewall.

**a) Security list (Oracle console).** Networking → Virtual cloud networks → your VCN → the
subnet's security list → **Add ingress rules**:

| Source CIDR | Protocol | Destination port | Why |
| --- | --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 | Let's Encrypt's HTTP challenge, and redirects to HTTPS |
| `0.0.0.0/0` | TCP | 443 | HTTPS |
| `0.0.0.0/0` | UDP | 443 | HTTP/3 (optional) |

Leave SSH (22) as it is, or better, restrict its source to your own IP.

**b) The VM's iptables rules (the Oracle Ubuntu gotcha).** Oracle's Ubuntu images ship with
iptables rules that allow SSH and then **reject everything else**. A rule appended at the end
comes after that REJECT and never matches, so insert yours *above* it. SSH in, then:

```bash
sudo iptables -L INPUT -n --line-numbers      # find the line number of the REJECT rule
```

Say the REJECT rule is line 5. Insert the new rules at that position (they push it down):

```bash
sudo iptables -I INPUT 5 -p tcp --dport 80 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -m state --state NEW -j ACCEPT
sudo iptables -I INPUT 5 -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save                # keep them after a reboot
sudo iptables -L INPUT -n --line-numbers      # the ACCEPTs must now be above the REJECT
```

You'll test both layers from outside in section 6.

## 3. Install Docker

Follow Docker's official guide for Ubuntu:
<https://docs.docker.com/engine/install/ubuntu/> ("Install using the apt repository"). It installs
Docker Engine and the Compose plugin; all images Roculus uses are published for ARM (aarch64).
Then let your user run docker without sudo, and log out and back in:

```bash
sudo usermod -aG docker $USER
```

Check: `docker compose version`.

## 4. Point a DNS name at the VM

At your DNS provider, add an **A record** for the name you'll use (e.g. `oculus.example.com`)
pointing at the VM's public IP. Caddy can only get a certificate once this resolves. Check from
your own computer:

```bash
dig +short oculus.example.com
```

If you ever recreate the VM, its public IP changes: update the record.

## 5. Configure

```bash
git clone <your repo URL> oculus && cd oculus
cp .env.example .env
```

Fill in `.env` (it's git-ignored; never commit it):

| Variable | What to put |
| --- | --- |
| `POSTGRES_PASSWORD` | a long random value: `openssl rand -hex 24` |
| `DOMAIN` | the DNS name from step 4 |
| `DASHBOARD_USER` | the dashboard login name (letters, digits, `.`, `_`, `-`) |
| `DASHBOARD_PASSWORD_HASH` | a bcrypt hash of the dashboard password, **in single quotes** (see below) |
| `OCULUS_READ_KEYS` | leave empty for now: created in step 6 |
| `BACKUP_HOUR_UTC`, `BACKUP_KEEP_DAYS` | optional; default 3 (03:00 UTC) and 7 |

Make the password hash (it asks for the password twice, without echoing it):

```bash
docker run --rm -it caddy:2-alpine caddy hash-password
```

Paste the output into `.env` **between single quotes**:
`DASHBOARD_PASSWORD_HASH='$2a$14$...'`. Without them, compose reads each `$...` as a variable and
the hash is mangled; Caddy's container then refuses to start and says so.

## 6. First boot

```bash
docker compose --profile deploy up -d --build
```

The first time, this builds the images, starts Postgres and the API (which applies the database
migrations), and then stops with **"dependency failed to start: container …-web-1 is unhealthy"**.
That is expected: the dashboard refuses to start without a read key, and Caddy waits for the
dashboard. Create the keys now (each is printed **once**; only its hash is stored):

```bash
docker compose --profile deploy exec api node dist/bin/create-key.js --game "My Game" --universe <universeId> --scope read
docker compose --profile deploy exec api node dist/bin/create-key.js --game "My Game" --universe <universeId> --scope ingest
docker compose --profile deploy exec api node dist/bin/create-key.js --game "My Game" --universe <universeId> --scope admin
```

- **read**: put it in `.env` as `OCULUS_READ_KEYS=my-game=<read key>`. `my-game` is a short
  name you pick for this game (lowercase letters, digits and dashes); the dashboard shows the
  game's real name. The older `OCULUS_READ_KEY=<read key>` also still works for a single game,
  but set only one of the two.
- **ingest**: goes into Roblox as the `OculusApiKey` secret ([roblox-integration.md](roblox-integration.md)).
- **admin**: keep it in your password manager. It unlocks key management on the dashboard's
  "Ingestion & keys" screen. It is never stored by the dashboard, only typed in when needed.

Then start everything again:

```bash
docker compose --profile deploy up -d
docker compose --profile deploy ps
```

All of `db`, `api`, `web` should show `(healthy)`, and `caddy` and `backup` `Up`. Caddy gets the
certificate within a minute or so; `docker compose --profile deploy logs caddy` shows progress.

**Test from outside** (your own computer), which also proves the two firewall layers are open:

```bash
curl -I http://oculus.example.com/            # expect 308, redirecting to https://
curl -I https://oculus.example.com/           # expect 401: the dashboard wants its login
```

Then run the smoke test. It needs Node 20+; on the VM itself, run it in a container:

```bash
docker run --rm -v "$PWD/scripts:/scripts:ro" \
  -e BASE_URL=https://oculus.example.com -e OCULUS_INGEST_KEY=<ingest key> -e OCULUS_READ_KEY=<read key> \
  node:22-alpine node /scripts/smoke.mjs
```

Use one game's ingest and read keys (the same game's). It posts one test event (remote `OculusSmokeTest`, player `OculusSmoke`, shadow mode), reads it
back, checks that a made-up key is refused and that Caddy's security headers are present, and
exits non-zero if anything fails. The test event stays visible on the dashboard. Finally, open
`https://oculus.example.com/` in a browser and log in.

### More than one game

The dashboard can switch between several games (a menu appears in its header once there are
two or more). For each extra game:

1. Create its keys with a new name and universe ID:

   ```bash
   docker compose --profile deploy exec api node dist/bin/create-key.js --game "Other Game" --universe <its universeId> --scope read
   docker compose --profile deploy exec api node dist/bin/create-key.js --game "Other Game" --universe <its universeId> --scope ingest
   docker compose --profile deploy exec api node dist/bin/create-key.js --game "Other Game" --universe <its universeId> --scope admin
   ```

2. Add its read key to the list in `.env`, separated by a comma (placeholders shown):

   ```bash
   OCULUS_READ_KEYS=my-game=ocl_xxxxxxxx,other-game=ocl_yyyyyyyy
   ```

   If your `.env` still has the single-game `OCULUS_READ_KEY=...` line, move that key into the
   list (as `my-game=<that key>`) and delete the old line: the dashboard refuses to start with both.

3. Restart the dashboard: `docker compose --profile deploy up -d web`. Its log
   (`docker compose --profile deploy logs web`) lists the games it found, or says what's wrong
   with the list.

The ingest key goes into that game's Roblox secrets, as for the first game. Each admin key only
manages its own game's keys: the keys screen refuses another game's admin key, so pick the game
in the header menu first.

How it stays safe: the read keys never leave the server. The browser only says which game it
wants (by its short name); nginx adds that game's read key, and refuses a name it doesn't know
rather than falling back to another game's key.

## 7. Updating

```bash
git pull
docker compose --profile deploy up -d --build
```

The API applies any new migrations when it starts.

## 8. Keys

On the dashboard: **Ingestion & keys → Keys**, unlock with the admin key.

- **Rotate the read key:** pick a grace period (both keys work during it), put the new key in
  `.env` after that game's `slug=` in `OCULUS_READ_KEYS`, then
  `docker compose --profile deploy up -d web` before the grace period ends.
- **Rotate the ingest key:** see [roblox-integration.md](roblox-integration.md#rotating-the-ingest-key).
- **Revoke:** immediate, for read and ingest keys.
- **Admin key:** only replaced with `create-key ... --scope admin` (no grace period; the old one stops
  at once). The dashboard can't revoke or rotate it, so it can't lock you out.

Every rotation and revocation, including CLI ones, is in the dashboard's audit log.

## 9. Backups and restore

The `backup` service runs `pg_dump -Fc` every night at `BACKUP_HOUR_UTC` (03:00 UTC by default)
into `./backups`, and deletes dumps older than `BACKUP_KEEP_DAYS` (7) after each successful dump,
so a failing backup never deletes the last good ones. `-Fc` is Postgres's "custom" format:
compressed, and `pg_restore` can restore all of it or only some tables. The files are readable
by root only (they contain every event and key hash).

```bash
docker compose --profile deploy logs backup             # "backup ok: oculus-2026-...dump (…)"
docker compose --profile deploy run --rm backup now     # take one now (e.g. before an upgrade)
sudo ls -l backups/
```

**Keep copies off the VM.** A dump on the VM is lost with the VM. For example, from your computer:

```bash
ssh ubuntu@<vm ip> 'sudo cat oculus/backups/oculus-2026-11-21T030000Z.dump' > oculus-2026-11-21.dump
```

### Restore drill (do this once now, and after big changes)

```bash
scripts/restore.sh oculus-2026-11-21T030000Z.dump        # into a NEW database, oculus_restore
```

It refuses to touch the live `oculus` database or an existing database, restores with
`--exit-on-error`, and prints row counts per table. Compare them with the live database:

```bash
docker compose exec db psql -U oculus -c "SELECT count(*) FROM events"
```

Then remove the copy: `docker compose exec db dropdb -U oculus oculus_restore`.

### Recovering from a backup

1. `scripts/restore.sh <dump>` (restores into `oculus_restore`) and check the counts.
2. Swap the databases (API and dashboard stopped, so nothing is connected):

   ```bash
   docker compose --profile deploy stop api web
   docker compose exec db psql -U oculus -d postgres \
     -c "ALTER DATABASE oculus RENAME TO oculus_before_restore" \
     -c "ALTER DATABASE oculus_restore RENAME TO oculus"
   docker compose --profile deploy start api web
   ```

3. Run the smoke test. Once you're sure, drop `oculus_before_restore`.

## 10. Moving to another host

1. A day before, lower the DNS record's TTL (e.g. to 300 seconds) so the switch takes effect quickly.
2. Set up the new host with sections 2–5, copying `.env` from the old one, and start only Postgres:
   `docker compose up -d db`.
3. On the old host, stop accepting events and take a final dump:

   ```bash
   docker compose --profile deploy stop api
   docker compose --profile deploy run --rm backup now
   ```

   While the API is down, game servers retry and then drop events (their queue holds 1,000), so
   keep this window short.
4. Copy that dump into `oculus/backups/` on the new host (`mkdir -p backups` first), then:
   `scripts/restore.sh <dump>` and the database swap from section 9 (step 2, without the stop/start).
5. `docker compose --profile deploy up -d --build` on the new host.
6. Change the DNS A record to the new IP. Caddy on the new host gets its own certificate once the
   name resolves to it. Run the smoke test against the domain.
7. When the smoke test passes, shut the old host down.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `curl` to the domain times out | a firewall layer: security list ingress (2a) or iptables order (2b) |
| Caddy logs certificate errors | DNS not pointing at this VM yet, or port 80 blocked |
| `caddy` keeps restarting | `docker compose --profile deploy logs caddy`: a missing `DOMAIN`, a bad `DASHBOARD_USER`, or a hash not in single quotes |
| `web` keeps restarting | `docker compose --profile deploy logs web` says why: no read key yet (section 6), both `OCULUS_READ_KEYS` and `OCULUS_READ_KEY` set, or a malformed `slug=key` entry |
| Dashboard loads but shows "Can't reach the API" | the read key in `.env` was revoked or expired: put the current one in and `up -d web` |
| A game in the menu says "read key not working" | that game's key in `OCULUS_READ_KEYS` is mistyped, revoked or expired: put its current read key in and `up -d web` |
| Keys screen says the admin key "is for" another game | pick that game in the header menu first, or use the admin key of the game on screen |
| Game servers' events don't arrive | the Ingestion & keys screen: refusals by reason, and which servers are sending |

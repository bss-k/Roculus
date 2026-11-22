# Connecting a Roblox game

How to get Remote-Guard violations from your game's servers into Oculus, test it in Studio, and
rotate the key later. You need a deployed Oculus ([deploy-oracle.md](deploy-oracle.md)) and an
**ingest** key for your game (`create-key ... --scope ingest`).

Roblox references used below: [Secrets store](https://create.roblox.com/docs/cloud-services/secrets)
and [`HttpService:GetSecret`](https://create.roblox.com/docs/reference/engine/classes/HttpService#GetSecret).
Check them if the menus have moved.

## How the key gets to Oculus

`OculusClient.luau` runs on the **server** only. It reads the key with
`HttpService:GetSecret("OculusApiKey")` and only ever puts it in the `Authorization` header:
Roblox secrets can be added to a URL or header but can't be read as text or put in a request
body. Clients (players' devices) never see it. The client reads the secret **once**, when
`Oculus.new` runs, so a running server keeps the key it started with.

## 1. Allow HTTP requests

In Studio: **File → Experience Settings → Security → Allow HTTP Requests** on, then publish.
Roblox's secrets documentation says this must be on before secrets can be used.

## 2. Add the `OculusApiKey` secret (live servers)

In the [Creator Dashboard](https://create.roblox.com/dashboard/creations): select your experience
→ **Secrets → Create Secret**. You need to own the experience (or its group).

- **Name:** `OculusApiKey` (or pass another name as `secretName` to `Oculus.new`)
- **Secret:** the ingest key (`ocl_…`)
- **Domain:** your Oculus host exactly, e.g. `oculus.example.com`. The secret can then only be sent
  to that host. Avoid `*`.

## 3. Add the client and connect it to Remote-Guard

Put `roblox/OculusClient.luau` in **ServerScriptService** (a ModuleScript named `OculusClient`) and
attach it to Remote-Guard from a server Script:

```lua
local ServerScriptService = game:GetService("ServerScriptService")
local Guard = require(ServerScriptService.RemoteGuard)
local Oculus = require(ServerScriptService.OculusClient)

local oculus = Oculus.new({ url = "https://oculus.example.com/v1/events" })
Guard.logger:addSink(oculus:sink())
game:BindToClose(function()
	oculus:close()
end)
```

Each Remote-Guard violation becomes one event: the remote's name, the violated rule (Remote-Guard's
`violation` name; the demo data uses names like `RateLimit` and `Schema`), the reason as detail,
the player, the server's `JobId`, and the remote's mode (`enforce` or `shadow`). Events are sent
in batches every 5 seconds. If the API is down or rate-limits the server, the client retries with
backoff; it never blocks or errors the game.

If the secret can't be loaded, the client disables itself and warns once in the server output:
`[Oculus] disabled: could not load API key secret (...)`. The game keeps running.

## 4. Testing in Studio

**Use a separate test game in Oculus,** so play-test events don't mix with live data:

```bash
docker compose --profile deploy exec api node dist/bin/create-key.js --game "My Game (test)" --universe <a different id> --scope ingest
```

(The universe id only has to be unique in Oculus; any number you don't use for a real game works.)
A dashboard read key belongs to one game, so to *see* the test game's events, point a dashboard at
it: locally with `npm run dev` and a read key for the test game in `web/.env.local`, or temporarily
swap `OCULUS_READ_KEY` on the server.

Studio has its own **local secrets**: **File → Experience Settings → Security → Local Secrets**.
Add `OculusApiKey` there with the test key, following the form Studio shows. Roblox's secrets
documentation also says that secrets fail with "Can't find secret with given key" in plain local
play tests and work on live servers and in collaborative testing. If you see that error (or the
`[Oculus] disabled` warning), use **Team Test**, or a private server of a published test place
with the secret set in Creator Hub. Don't paste the key into a script instead: scripts are saved
in the place file.

### Play-test plan

With the test game's dashboard open:

1. **Start a test server** (Team Test or a private server) and join with one player.
   On the server output, there should be no `[Oculus]` warning.
2. **Trigger a rate-limit violation.** Pick a remote that has a rate limit in your Remote-Guard
   config. From the client (a temporary LocalScript, or Studio's command bar in the client view),
   fire it faster than its limit, e.g. `for i = 1, 50 do remote:FireServer() end`.
3. **Trigger a schema violation.** Fire a remote with arguments of the wrong type, e.g. a string
   where the schema expects a number: `remote:FireServer("not-a-number")`.
4. **Within about 5 seconds**, on the dashboard:
   - **Overview:** both violations in the live feed, with your player name and the remote's mode.
   - **Ingestion & keys:** your test server's `JobId` under Game servers, "sending", with the
     events counted under Accepted; nothing under Refused.
   - **Players** and **Remotes:** your player and the remotes you fired.
5. **Check enforce vs shadow.** A remote in `enforce` mode should have blocked the bad calls in
   the game; in `shadow` mode they ran and were only reported.
6. **Stop the server** (`BindToClose` sends anything still queued). About 10 minutes later the
   server shows as "silent" on the Ingestion screen.

If nothing arrives: the server output (any `[Oculus]` warning), then the Ingestion screen's
Refused by reason (`bad_key` means a wrong, expired or revoked key; `invalid_schema` means the
payload didn't validate).

## Rotating the ingest key

Running servers keep the key they started with (it's read once, in `Oculus.new`), so give them
time to be replaced:

1. Dashboard → **Ingestion & keys → Keys**, unlock with the admin key, **Rotate** the ingest key
   with a grace period longer than your servers usually live (e.g. 3 or 7 days). Copy the new key
   from the one-time dialog.
2. Creator Dashboard → your experience → **Secrets** → edit `OculusApiKey` → paste the new key.
   New servers use it from now on; old servers keep working with the old key until the grace
   period ends.
3. Watch the **Ingestion** screen. After the grace period, any server still on the old key shows
   up as `bad_key` refusals (the old key is logged as expired). Restart those servers (for example
   by publishing an update and shutting down old servers) if you want them back sooner.

If the key leaked, rotate with grace period **None**: the old key stops at once, and servers still
using it lose their events until they restart with the new secret.

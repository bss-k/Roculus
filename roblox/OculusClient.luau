--!strict
--[[
	OculusClient: ships Remote-Guard violations from a game SERVER to the Oculus API.

	Events are queued in memory and sent in batches every `flushInterval` seconds with
	HttpService:RequestAsync. The API key comes from the Roblox Secrets Store and is only ever
	placed in the Authorization header (Secrets can't be read as plain strings or put in a body).

	    local Guard = require(ServerScriptService.RemoteGuard)
	    local Oculus = require(ServerScriptService.OculusClient)

	    local oculus = Oculus.new({ url = "https://oculus.example.com/v1/events" })
	    Guard.logger:addSink(oculus:sink())
	    game:BindToClose(function()
	    	oculus:close()
	    end)

	Setup: enable Game Settings > Security > Allow HTTP Requests, and add a secret named
	"OculusApiKey" (an ingest key from `npm run create-key`) for your experience.

	Failure behaviour (never affects gameplay):
	  - 2xx            -> batch done
	  - 429, 5xx, network error -> retry with exponential backoff + jitter, then drop with a warning
	  - other 4xx      -> drop immediately with a warning (resending a bad request can't succeed)
	  - queue full     -> new events are dropped; one summary warning per flush interval
]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

-- Must match the API's limits (api/src/schemas/events.ts).
local API_MAX_BATCH = 100
local FIELD_LIMITS = { serverId = 64, playerName = 32, remote = 100, rule = 64, detail = 256 }

export type Mode = "shadow" | "enforce"

export type Event = {
	timestamp: number, -- Unix ms
	serverId: string,
	playerId: number,
	playerName: string,
	remote: string,
	rule: string,
	detail: string,
	mode: Mode,
}

export type Response = { Success: boolean, StatusCode: number, StatusMessage: string, Headers: { [string]: string }, Body: string }

export type Options = {
	url: string,
	secretName: string?, -- default "OculusApiKey"
	flushInterval: number?, -- seconds, default 5
	maxBatch: number?, -- events per request, default and max 100
	maxBatchesPerFlush: number?, -- requests per flush, default 3 (stays under the API rate limit)
	maxQueue: number?, -- default 1000
	maxRetries: number?, -- retries per batch, default 4
	baseBackoff: number?, -- seconds, default 1
	maxBackoff: number?, -- seconds, default 30
	serverId: string?, -- default game.JobId ("studio" in Studio)

	-- Seams for tests; leave nil in real use.
	request: ((options: { [string]: any }) -> Response)?,
	authHeader: any?,
	wait: ((seconds: number) -> ())?,
	warn: ((message: string) -> ())?,
	random: (() -> number)?,
	autoStart: boolean?,
}

-- Subset of Remote-Guard's Types.Event that this module reads.
type GuardEvent = {
	kind: string,
	remote: string,
	userId: number,
	playerName: string,
	violation: string?,
	reason: string?,
	t: number,
	serverId: string,
	mode: Mode,
}

export type Client = {
	push: (self: Client, event: Event) -> boolean,
	flush: (self: Client) -> (),
	sink: (self: Client) -> { name: string, write: (events: { GuardEvent }) -> () },
	close: (self: Client) -> (),
	queueSize: (self: Client) -> number,
}

local OculusClient = {}

-- Truncates to `max` characters without splitting a multi-byte character, and replaces invalid
-- UTF-8 (which JSONEncode would choke on). Details can contain exploiter-controlled text.
local function clean(value: string, max: number): string
	if utf8.len(value) == nil then
		return "<invalid utf-8>"
	end
	local cut = utf8.offset(value, max + 1)
	return if cut then string.sub(value, 1, cut - 1) else value
end

local function sanitize(event: Event): Event
	return {
		timestamp = math.floor(event.timestamp),
		serverId = clean(event.serverId, FIELD_LIMITS.serverId),
		playerId = event.playerId,
		playerName = clean(event.playerName, FIELD_LIMITS.playerName),
		remote = clean(event.remote, FIELD_LIMITS.remote),
		rule = clean(event.rule, FIELD_LIMITS.rule),
		detail = clean(event.detail, FIELD_LIMITS.detail),
		mode = event.mode,
	}
end

local function defaultRequest(options: { [string]: any }): Response
	return (HttpService:RequestAsync(options :: any) :: any) :: Response
end

local function loadAuthHeader(secretName: string): any
	-- A Secret can be prefixed and used as a header value, but never read as text.
	return HttpService:GetSecret(secretName):AddPrefix("Bearer ")
end

local function header(headers: { [string]: string }?, name: string): string?
	if not headers then
		return nil
	end
	for key, value in headers do
		if string.lower(key) == name then
			return value
		end
	end
	return nil
end

function OculusClient.new(options: Options): Client
	assert(RunService:IsServer(), "OculusClient must run on the server")
	assert(type(options.url) == "string" and options.url ~= "", "OculusClient: options.url is required")

	local url = options.url
	local flushInterval = options.flushInterval or 5
	local maxBatch = math.min(options.maxBatch or API_MAX_BATCH, API_MAX_BATCH)
	local maxBatchesPerFlush = options.maxBatchesPerFlush or 3
	local maxQueue = options.maxQueue or 1000
	local maxRetries = options.maxRetries or 4
	local baseBackoff = options.baseBackoff or 1
	local maxBackoff = options.maxBackoff or 30
	local serverId = options.serverId or (if game.JobId ~= "" then game.JobId else "studio")
	local request = options.request or defaultRequest
	local wait = options.wait or task.wait
	local warnFn = options.warn or function(message: string)
		warn("[Oculus] " .. message)
	end
	local random = options.random or math.random

	local authHeader = options.authHeader
	local enabled = true
	if authHeader == nil then
		local ok, result = pcall(loadAuthHeader, options.secretName or "OculusApiKey")
		if ok then
			authHeader = result
		else
			enabled = false
			warnFn("disabled: could not load API key secret (" .. tostring(result) .. ")")
		end
	end

	local queue: { Event } = {}
	local dropped = 0
	local running = true

	local function takeBatch(): { Event }
		local count = math.min(#queue, maxBatch)
		local batch = table.create(count) :: { Event }
		local rest = table.create(#queue - count) :: { Event }
		table.move(queue, 1, count, 1, batch)
		table.move(queue, count + 1, #queue, 1, rest)
		queue = rest
		return batch
	end

	local function backoffSeconds(attempt: number): number
		local exp = math.min(maxBackoff, baseBackoff * 2 ^ attempt)
		return exp * (0.5 + random() * 0.5) -- jitter: servers that failed together don't retry together
	end

	-- Sends one batch, retrying transient failures. Returns true if the API accepted it.
	local function send(batch: { Event }, retries: number): boolean
		local body = HttpService:JSONEncode({ events = batch })
		for attempt = 0, retries do
			local ok, response = pcall(request, {
				Url = url,
				Method = "POST",
				Headers = { ["Content-Type"] = "application/json", Authorization = authHeader },
				Body = body,
			})

			local status = if ok then response.StatusCode else 0
			if ok and status >= 200 and status < 300 then
				return true
			end
			local retryable = not ok or status == 429 or status >= 500
			if not retryable then
				warnFn(string.format("dropped %d events: HTTP %d %s", #batch, status, response.Body or ""))
				return false
			end
			if attempt == retries then
				break
			end

			local retryAfter = if ok then tonumber(header(response.Headers, "retry-after")) else nil
			wait(if retryAfter then math.min(retryAfter, maxBackoff) else backoffSeconds(attempt))
		end
		warnFn(string.format("dropped %d events after %d retries", #batch, retries))
		return false
	end

	local function reportDropped()
		if dropped > 0 then
			warnFn(string.format("queue full (%d): dropped %d events", maxQueue, dropped))
			dropped = 0
		end
	end

	local client = {} :: Client

	function client.push(_self: Client, event: Event): boolean
		if not enabled then
			return false
		end
		if #queue >= maxQueue then
			dropped += 1
			return false
		end
		table.insert(queue, sanitize(event))
		return true
	end

	function client.flush(_self: Client)
		reportDropped()
		for _ = 1, maxBatchesPerFlush do
			if #queue == 0 then
				return
			end
			send(takeBatch(), maxRetries)
		end
	end

	-- A Remote-Guard sink: Guard.logger:addSink(client:sink())
	function client.sink(self: Client)
		return {
			name = "Oculus",
			write = function(events: { GuardEvent })
				for _, event in events do
					if event.kind == "violation" then
						self:push({
							timestamp = event.t * 1000,
							serverId = serverId,
							playerId = event.userId,
							playerName = event.playerName,
							remote = event.remote,
							rule = event.violation or "Unknown",
							detail = event.reason or "",
							mode = event.mode,
						})
					end
				end
			end,
		}
	end

	-- For game:BindToClose: stop the loop and make one quick attempt to send what's left.
	function client.close(_self: Client)
		running = false
		reportDropped()
		while enabled and #queue > 0 do
			send(takeBatch(), 0)
		end
	end

	function client.queueSize(_self: Client): number
		return #queue
	end

	if enabled and options.autoStart ~= false then
		task.spawn(function()
			while running do
				wait(flushInterval)
				if running then
					client:flush()
				end
			end
		end)
	end

	return client
end

return OculusClient

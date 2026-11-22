#!/usr/bin/env node
/*
  End-to-end smoke test for a running Oculus deploy. Node built-ins only (fetch, crypto).

    BASE_URL=https://oculus.example.com OCULUS_INGEST_KEY=... OCULUS_READ_KEY=... node scripts/smoke.mjs

  1. posts one test event to /v1/events with the ingest key
  2. reads it back from /v1/violations with the read key
  3. checks that a made-up key is refused (401 bad_key)
  4. over HTTPS, checks Caddy's security headers are present
  Exits 1 if anything fails.

  The test event stays in the data (remote "OculusSmokeTest", player "OculusSmoke", shadow mode),
  so it shows on the dashboard. That's the point: it proves the whole path works.
  For a local deploy with Caddy's own CA, also set NODE_EXTRA_CA_CERTS to its root.crt.
*/
import { randomBytes, randomUUID } from "node:crypto";

const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const ingestKey = process.env.OCULUS_INGEST_KEY ?? "";
const readKey = process.env.OCULUS_READ_KEY ?? "";
if (!base || !ingestKey || !readKey) {
  console.error("set BASE_URL, OCULUS_INGEST_KEY and OCULUS_READ_KEY");
  process.exit(2);
}

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

async function request(path, { key, method = "GET", body } = {}) {
  const headers = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, json, text };
}

const marker = `smoke ${randomUUID()}`;

try {
  // 1. Ingest one event.
  const posted = await request("/v1/events", {
    key: ingestKey,
    method: "POST",
    body: {
      events: [
        {
          timestamp: Date.now(),
          serverId: "oculus-smoke",
          playerId: 1,
          playerName: "OculusSmoke",
          remote: "OculusSmokeTest",
          rule: "SmokeTest",
          detail: marker,
          mode: "shadow",
        },
      ],
    },
  });
  check("POST /v1/events accepts a test event", posted.status === 202 && posted.json?.accepted === 1, `HTTP ${posted.status}`);

  // 2. Read it back (retry briefly, though it should be there at once).
  let found = false;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5 && !found; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000));
    const read = await request("/v1/violations?remote=OculusSmokeTest&limit=20", { key: readKey });
    lastStatus = read.status;
    found = read.status === 200 && Boolean(read.json?.items?.some((v) => v.detail === marker));
  }
  check("GET /v1/violations returns it with the read key", found, `HTTP ${lastStatus}`);

  // 3. A key that doesn't exist is refused.
  const bogus = `ocl_${randomBytes(32).toString("base64url")}`;
  const refused = await request("/v1/stats/summary", { key: bogus });
  check("a made-up key is refused", refused.status === 401 && refused.json?.error === "bad_key", `HTTP ${refused.status}`);

  // 4. Security headers (only meaningful through Caddy over HTTPS).
  if (base.startsWith("https://")) {
    const h = refused.headers;
    const missing = ["strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy"].filter(
      (name) => !h.get(name),
    );
    check("Caddy security headers are set", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");
    check("no Server header", !h.get("server"), h.get("server") ?? "");
  } else {
    console.log("SKIP  security headers (BASE_URL isn't https)");
  }
} catch (err) {
  check("reach the API", false, err.cause?.code ?? err.message);
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The dashboard calls /dash/v1/*. In dev, Vite forwards those calls to the API and adds the
// chosen game's read key on the server side, so no key ever ships in the browser bundle.
// (The keys have no VITE_ prefix, which keeps Vite from exposing them to client code.)
//
// /dash/admin/* is different: the person using the dashboard supplies an admin key, and the
// proxy only passes it through (same as nginx in deploy). It moves X-Oculus-Admin-Key into
// "Authorization: Bearer" and never adds a key of its own.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.OCULUS_API_URL ?? "http://127.0.0.1:3000";
  return {
    plugins: [react(), readKeys(parseReadKeys(env))],
    server: {
      port: 5173,
      // Listed before /dash: the first matching prefix wins.
      proxy: {
        "/dash/admin": {
          target,
          rewrite: (path) => path.replace(/^\/dash\/admin/, "/v1/admin"),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              const adminKey = req.headers["x-oculus-admin-key"];
              proxyReq.removeHeader("x-oculus-admin-key");
              proxyReq.removeHeader("authorization");
              if (typeof adminKey === "string" && adminKey) proxyReq.setHeader("authorization", `Bearer ${adminKey}`);
            });
          },
        },
        // The read key was put on the request by the readKeys plugin below.
        "/dash": {
          target,
          rewrite: (path) => path.replace(/^\/dash/, ""),
        },
      },
    },
  };
});

/*
  The dev twin of web/render-read-keys.sh (which does this for nginx in deploy), with the same
  rules: OCULUS_READ_KEYS="slug=key,slug2=key2" for several games, or OCULUS_READ_KEY for one
  (slug "main"), from web/.env.local (written by `npm run seed`).
*/
function parseReadKeys(env: Record<string, string>): Map<string, string> {
  const many = env.OCULUS_READ_KEYS?.trim() ?? "";
  const single = env.OCULUS_READ_KEY?.trim() ?? "";
  const fail = (message: string): never => {
    throw new Error(`web/.env.local: ${message}`);
  };
  if (many && single) fail("both OCULUS_READ_KEYS and OCULUS_READ_KEY are set: keep only OCULUS_READ_KEYS");

  const games = new Map<string, string>();
  const entries = many ? many.split(",") : single ? [`main=${single}`] : [];
  for (const entry of entries.map((e) => e.replace(/\s/g, "")).filter(Boolean)) {
    const at = entry.indexOf("=");
    if (at < 0) fail('an entry in OCULUS_READ_KEYS has no "=": write each game as slug=key');
    const slug = entry.slice(0, at);
    const key = entry.slice(at + 1);
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(slug)) fail(`game slug "${slug}" must be 1-32 lowercase letters, digits or dashes`);
    if (["default", "hostnames", "include", "volatile"].includes(slug)) fail(`"${slug}" can't be a game slug`);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail(`the key for "${slug}" doesn't look like an Oculus key (ocl_...)`);
    if (games.has(slug)) fail(`game slug "${slug}" is listed twice`);
    games.set(slug, key);
  }
  if (games.size === 0) console.warn("No dashboard read key in web/.env.local: run `npm run setup` to create demo games.");
  return games;
}

// Serves /dash/games.json and puts the chosen game's read key on /dash/v1 calls, before Vite's
// proxy forwards them. Missing or unknown game: 400, never another game's key.
function readKeys(games: Map<string, string>): Plugin {
  const list = JSON.stringify({ games: [...games.keys()].map((slug) => ({ slug })) });
  return {
    name: "oculus-read-keys",
    configureServer(server) {
      // Added straight away (not in a returned function), so this runs before Vite's proxy.
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path === "/dash/games.json") {
          res.setHeader("content-type", "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(list);
          return;
        }
        if (path.startsWith("/dash/v1/")) {
          const slug = req.headers["x-oculus-game"];
          const key = typeof slug === "string" ? games.get(slug.toLowerCase()) : undefined;
          delete req.headers["x-oculus-game"];
          if (!key) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "unknown_game", message: "unknown game: reload the page and pick one from the list" }));
            return;
          }
          req.headers.authorization = `Bearer ${key}`;
        }
        next();
      });
    },
  };
}

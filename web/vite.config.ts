import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The dashboard calls /dash/v1/*. In dev, Vite forwards those calls to the API and adds the
// read key on the server side, so the key never ships in the browser bundle.
// (OCULUS_READ_KEY has no VITE_ prefix, which keeps Vite from exposing it to client code.)
//
// /dash/admin/* is different: the person using the dashboard supplies an admin key, and the
// proxy only passes it through (same as nginx in deploy). It moves X-Oculus-Admin-Key into
// "Authorization: Bearer" and never adds a key of its own.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.OCULUS_API_URL ?? "http://127.0.0.1:3000";
  return {
    plugins: [react()],
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
        "/dash": {
          target,
          rewrite: (path) => path.replace(/^\/dash/, ""),
          headers: { authorization: `Bearer ${env.OCULUS_READ_KEY ?? ""}` },
        },
      },
    },
  };
});

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The dashboard calls /dash/v1/*. In dev, Vite forwards those calls to the API and adds the
// read key on the server side, so the key never ships in the browser bundle.
// (OCULUS_READ_KEY has no VITE_ prefix, which keeps Vite from exposing it to client code.)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/dash": {
          target: env.OCULUS_API_URL ?? "http://127.0.0.1:3000",
          rewrite: (path) => path.replace(/^\/dash/, ""),
          headers: { authorization: `Bearer ${env.OCULUS_READ_KEY ?? ""}` },
        },
      },
    },
  };
});

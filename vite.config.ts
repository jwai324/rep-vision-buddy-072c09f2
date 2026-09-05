import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  define: {
    // Vercel exposes the deploying commit at build time. Error reports carry
    // it so the triage routine can tell a report filed against an old build
    // from one filed against current main. Local builds say "dev".
    __APP_VERSION__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7)),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
});

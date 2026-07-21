import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

// Build id written by scripts/gen-version.mjs (runs before build). Baked into
// the app so it can compare itself against the live version.json and auto-
// reload after a deploy. Defaults to "dev" when the file isn't present.
let buildVersion = "dev";
try {
  buildVersion = JSON.parse(readFileSync("./public/version.json", "utf-8")).version;
} catch {
  /* dev server / first run — no version file yet */
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    watch: {
      usePolling: true,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-charts": ["recharts"],
          "vendor-ui": ["axios"],
        },
      },
    },
    // Increase chunk size warning threshold (some pages are legitimately large)
    chunkSizeWarningLimit: 600,
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "../../package.json" with { type: "json" };

// Game content (map data, later jobs/events/etc.) lives in the repo-level data/ folder
// and is served as static files, so the same build works in the browser and in Tauri.
const dataDir = fileURLToPath(new URL("../../data", import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  publicDir: dataDir,
  // Relative base so the built game can be opened from any folder or packaged in Tauri.
  base: "./",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMPTY = path.resolve(__dirname, "src/empty-module.js");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "canvg", replacement: EMPTY },
      { find: "html2canvas", replacement: EMPTY },
      { find: "dompurify", replacement: EMPTY },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});

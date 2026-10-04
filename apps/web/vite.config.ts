import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development Vite serves the UI and forwards the API to `sprachanker serve` on its default port.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:4580" } },
});

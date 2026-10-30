import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      statements: 90,
      branches: 90,
      functions: 90,
      lines: 90,
    },
  },
});

import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./webview/src"),
      "@shared": path.resolve(rootDir, "./shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    include: ["webview/src/**/*.test.{ts,tsx}", "shared/**/*.test.ts"],
  },
});

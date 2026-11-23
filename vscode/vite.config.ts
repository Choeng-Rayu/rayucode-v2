import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = import.meta.dirname;

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./webview/src"),
      "@shared": path.resolve(rootDir, "./shared"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(rootDir, "./dist/extension"),
    emptyOutDir: false,
    assetsDir: "media",
    cssCodeSplit: false,
    sourcemap: Boolean(process.env.RAYU_SOURCEMAP),
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: path.resolve(rootDir, "./webview/src/main.tsx"),
      output: {
        format: "es",
        entryFileNames: "media/webview.js",
        chunkFileNames: "media/chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? assetInfo.name ?? "";
          if (name.endsWith(".css")) {
            return "media/webview.css";
          }
          return "media/assets/[name]-[hash][extname]";
        },
      },
    },
  },
});

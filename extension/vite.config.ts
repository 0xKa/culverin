import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  publicDir: "public",
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    modulePreload: false,
    emptyOutDir: !process.argv.includes("--watch"),
    sourcemap: false,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "src/background/main.ts"),
        popup: resolve(import.meta.dirname, "popup.html"),
        offscreen: resolve(import.meta.dirname, "offscreen.html"),
        settings: resolve(import.meta.dirname, "settings.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        advancedChunks: {
          groups: [{ name: "preact", test: /node_modules[\\/]preact/ }],
        },
      },
    },
  },
});

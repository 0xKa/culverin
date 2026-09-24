import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    modulePreload: false,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        background: resolve(import.meta.dirname, "src/background/main.ts"),
        content: resolve(import.meta.dirname, "src/content/main.ts"),
        offscreen: resolve(import.meta.dirname, "offscreen.html"),
        options: resolve(import.meta.dirname, "options.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

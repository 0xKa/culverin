import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const diagnostic = mode === "diagnostic";
  return {
    publicDir: "public",
    plugins: [
      tailwindcss(),
      ...(diagnostic
        ? [
            {
              name: "diagnostic-offscreen-entry",
              transformIndexHtml: {
                order: "pre" as const,
                handler(html: string, context: { filename: string }) {
                  return context.filename ===
                    resolve(import.meta.dirname, "offscreen.html")
                    ? html.replace(
                        "/src/archive/offscreen.ts",
                        `/@fs/${resolve(import.meta.dirname, "../tests/extension/offscreen.ts")}`,
                      )
                    : html;
                },
              },
            },
          ]
        : []),
    ],
    build: {
      outDir: diagnostic
        ? resolve(import.meta.dirname, "../.bun/test-extension")
        : "dist",
      modulePreload: false,
      emptyOutDir: !process.argv.includes("--watch"),
      sourcemap: false,
      rollupOptions: {
        input: {
          background: diagnostic
            ? resolve(import.meta.dirname, "../tests/extension/background.ts")
            : resolve(import.meta.dirname, "src/background/main.ts"),
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
  };
});

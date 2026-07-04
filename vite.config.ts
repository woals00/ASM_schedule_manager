import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension, { readJsonFile } from "vite-plugin-web-extension";
import { fileURLToPath, URL } from "node:url";

function generateManifest() {
  const manifest = readJsonFile("src/manifest.json");
  const pkg = readJsonFile("package.json");
  return {
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    ...manifest,
  };
}

export default defineConfig({
  css: {
    modules: {
      localsConvention: "camelCase",
    },
  },
  resolve: {
    alias: {
      "@entrypoints": fileURLToPath(new URL("./src/entrypoints", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  plugins: [
    react(),
    webExtension({
      manifest: generateManifest,
      // CSS-modules-as-string (`import css from './x.module.css?inline'`) still
      // makes the plugin emit a `style.css` and auto-attach it to every
      // content_script. We inject those styles into Shadow DOM ourselves, so
      // strip the auto-attachment to keep the SOMA page free of our CSS.
      transformManifest(manifest) {
        for (const cs of manifest.content_scripts ?? []) {
          if (Array.isArray(cs.css)) {
            cs.css = cs.css.filter((p) => p !== "style.css");
          }
        }
        return manifest;
      },
    }),
  ],
});

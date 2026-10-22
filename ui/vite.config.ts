import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { instantPaint } from "./instant-paint-plugin"
import { shellManifestPlugin } from "./shell-manifest-plugin.mjs"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), instantPaint(), shellManifestPlugin()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "framework7-core",
              // Keep React and other shared dependencies outside this lazy
              // group; otherwise importing React downloads all of Framework7.
              includeDependenciesRecursively: false,
              // Keep the adapter and its internally circular component graph
              // together, without absorbing React into the deferred runtime.
              test: /node_modules[\\/](?:framework7|framework7-react)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4173",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})

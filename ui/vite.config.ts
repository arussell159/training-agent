import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "framework7-core",
              // Group only the shared runtime. Including every Framework7
              // component here pulls lazy editor/picker code into startup.
              test: /node_modules[\\/](?:framework7[\\/](?:framework7-lite\.esm\.js|(?:shared|modules)[\\/]|components[\\/](?:app|statusbar|view|navbar|toolbar|subnavbar|touch-ripple|touch-highlight|modal|dialog|sortable)[\\/])|framework7-react[\\/](?:shared[\\/]|components[\\/](?:app|routable-modals|navbar|nav-left|nav-right|nav-title|toolbar|toolbar-pane|tabs|tab|link|icon|badge|button|preloader)\.js))/,
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

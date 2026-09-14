import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") }, dedupe: ["react", "react-dom"] },
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": "http://localhost:4173" } },
})

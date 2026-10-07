import { defineConfig, mergeConfig } from "vite"
import appConfig from "./vite.config.ts"

export default mergeConfig(appConfig, defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:5178",
    },
  },
}))

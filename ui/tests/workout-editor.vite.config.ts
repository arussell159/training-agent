import { defineConfig, mergeConfig } from "vite"
import base from "../vite.config.ts"
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5175,
      host: "127.0.0.1",
      proxy: { "/api": "http://127.0.0.1:4185" },
    },
  })
)

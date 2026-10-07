import { defineConfig, mergeConfig } from "vite"
import base from "../vite.config.ts"
export default mergeConfig(
  base,
  defineConfig({ server: { port: 5177, host: "127.0.0.1", strictPort: true, hmr: false } }),
)

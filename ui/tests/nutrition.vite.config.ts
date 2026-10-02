import { defineConfig, mergeConfig } from "vite"
import base from "../vite.config.ts"
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5190,
      host: "127.0.0.1",
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:4190",
          changeOrigin: false,
          configure: (proxy) => {
            proxy.on("proxyReq", (request) => {
              request.setHeader("host", "127.0.0.1:5190")
              request.setHeader("origin", "http://127.0.0.1:5190")
            })
          },
        },
      },
    },
  })
)

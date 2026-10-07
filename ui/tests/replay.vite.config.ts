import { fileURLToPath } from "node:url"
import { defineConfig, mergeConfig } from "vite"
import base from "../vite.config.ts"

// An exact alias preserves Mapbox's stylesheet while preventing its workers,
// tile requests and real WebGL from being created by the replay regression.
export default mergeConfig(
  base,
  defineConfig({
    server: { port: 5178, host: "127.0.0.1", strictPort: true, hmr: false },
    define: {
      "import.meta.env.VITE_MAPBOX_STYLE": JSON.stringify(
        "mapbox://styles/fixture/replay"
      ),
      "import.meta.env.VITE_MAPBOX_ACCESS_TOKEN": JSON.stringify(
        "local-replay-fixture"
      ),
    },
    resolve: {
      alias: [
        {
          find: /^mapbox-gl$/,
          replacement: fileURLToPath(
            new URL("./replay-mapbox-fixture.ts", import.meta.url)
          ),
        },
      ],
    },
  })
)

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import mkcert from "vite-plugin-mkcert"
import framer from "vite-plugin-framer"
import tailwindcss from "@tailwindcss/vite"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const pkgRoot = dirname(fileURLToPath(import.meta.url))
const pluginUiSrc = resolve(pkgRoot, "../../packages/plugin-ui/src")

export default defineConfig({
  plugins: [tailwindcss(), react(), mkcert(), framer()],
  resolve: {
    alias: {
      "@": pluginUiSrc,
      "@insta2figma/plugin-ui": resolve(pluginUiSrc, "index.ts"),
      "@insta2figma/shared-contracts": resolve(
        pkgRoot,
        "../../packages/shared-contracts/src/index.ts",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
})

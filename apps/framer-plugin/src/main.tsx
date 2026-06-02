import { framer } from "framer-plugin"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, ThemePreferenceProvider } from "@insta2figma/plugin-ui"
import { FramerHost } from "./FramerHost"

framer.showUI({ position: "top right", width: 872, height: 667 })

const host = new FramerHost()

function Root() {
  return (
    <ThemePreferenceProvider>
      <App host={host} />
    </ThemePreferenceProvider>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Root element not found")

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

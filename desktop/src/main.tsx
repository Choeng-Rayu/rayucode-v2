import * as React from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "./styles/globals.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Failed to find #root mount element for RayuCode Desktop")
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

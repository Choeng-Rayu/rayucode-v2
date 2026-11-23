/// <reference types="vite/client" />

export interface ElectronWebviewElement extends HTMLElement {
  src: string
  partition?: string
  canGoBack?: () => boolean
  canGoForward?: () => boolean
  goBack?: () => void
  goForward?: () => void
  reload?: () => void
  stop?: () => void
  setZoomFactor?: (factor: number) => void
  findInPage?: (text: string) => number
  stopFindInPage?: (
    action: "clearSelection" | "keepSelection" | "activateSelection"
  ) => void
  print?: () => Promise<void> | void
  loadURL?: (url: string) => Promise<void> | void
}

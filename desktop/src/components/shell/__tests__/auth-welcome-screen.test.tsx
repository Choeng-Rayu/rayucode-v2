import "@testing-library/jest-dom/vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthWelcomeScreen } from "@/components/shell/AuthWelcomeScreen"
import { useAppStore } from "@/lib/app-store"
import { ipcClient } from "@/lib/ipc-client"

describe("AuthWelcomeScreen", () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: "dark",
      accent: "green",
      authState: {
        signedIn: false,
        method: "none",
        signingIn: false,
        pendingAuthUrl: null,
        user: null,
        credits: null,
        allowedModels: [],
        apiBase: "https://api.rayucode.com/api",
        webBase: "https://rayucode.com",
        gatewayBase: "https://gateway.rayucode.com",
        error: null,
      },
      authBypassed: false,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders Welcome logo, Sign up, and Log in actions and launches browser login", async () => {
    const signInSpy = vi
      .spyOn(ipcClient.auth, "signInWithBrowser")
      .mockResolvedValue({
        signedIn: true,
        method: "oauth",
        signingIn: false,
        pendingAuthUrl: null,
        user: {
          id: 1,
          email: "builder@rayucode.com",
          displayName: "Rayu Builder",
          avatarUrl: null,
          role: "user",
        },
        credits: null,
        allowedModels: [],
        apiBase: "https://api.rayucode.com/api",
        webBase: "https://rayucode.com",
        gatewayBase: "https://gateway.rayucode.com",
        error: null,
      })

    render(<AuthWelcomeScreen />)

    expect(screen.getByAltText("RayuCode")).toBeInTheDocument()
    expect(screen.getByText("Welcome to RayuCode")).toBeInTheDocument()
    expect(screen.getByTestId("welcome-signup-btn")).toBeInTheDocument()
    expect(screen.getByTestId("welcome-login-btn")).toBeInTheDocument()

    fireEvent.click(screen.getByTestId("welcome-login-btn"))
    await waitFor(() => expect(signInSpy).toHaveBeenCalledTimes(1))
  })

  it("walks through Sign up -> Choose Plan -> Onboarding -> RayuCode Web sign-up", async () => {
    const openExternalSpy = vi
      .spyOn(ipcClient.native, "openExternal")
      .mockResolvedValue({ ok: true })

    render(<AuthWelcomeScreen />)

    // Step 1: Click Sign up -> Choose Plan
    fireEvent.click(screen.getByTestId("welcome-signup-btn"))
    expect(screen.getByTestId("signup-choose-plan")).toBeInTheDocument()

    // Select Pro plan and continue
    fireEvent.click(screen.getByTestId("plan-card-pro"))
    fireEvent.click(screen.getByTestId("plan-continue-btn"))

    // Step 2: Onboarding workspace setup
    expect(screen.getByTestId("signup-onboarding")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("onboarding-create-account-btn"))

    // Step 3: Opens rayucode.com/sign-up?plan=pro and shows Desktop authorization screen
    expect(await screen.findByTestId("signup-connect-account")).toBeInTheDocument()
    expect(openExternalSpy).toHaveBeenCalledWith(
      "https://rayucode.com/sign-up?plan=pro"
    )
  })

  it("shows Copy sign-in link while waiting for browser sign-in", async () => {
    useAppStore.setState({
      authState: {
        signedIn: false,
        method: "none",
        signingIn: true,
        pendingAuthUrl:
          "https://rayucode.com/cli-login?port=51234&state=deadbeef",
        user: null,
        credits: null,
        allowedModels: [],
        apiBase: "https://api.rayucode.com/api",
        webBase: "https://rayucode.com",
        gatewayBase: "https://gateway.rayucode.com",
        error: null,
      },
    })

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<AuthWelcomeScreen />)

    const copyBtn = screen.getByTestId("copy-signin-link-btn")
    expect(copyBtn).toBeInTheDocument()
    fireEvent.click(copyBtn)
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://rayucode.com/cli-login?port=51234&state=deadbeef"
      )
    )
  })
})

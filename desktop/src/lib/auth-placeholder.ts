export interface AuthSession {
  userId: string
  name: string
  username: string
  email: string
  plan: "Free" | "Basic" | "Pro" | "Plus" | "Max" | "Team" | "Team Plus" | "Team Max" | "Enterprise"
  avatarInitials: string
  isAuthenticated: boolean
}

const IS_TEST_ENV =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { MODE?: string } }).env?.MODE === "test"

const TEST_AUTH_SESSION: AuthSession = {
  userId: "usr_test",
  name: "Khai",
  username: "@khai",
  email: "khai@rayucode.com",
  plan: "Plus",
  avatarInitials: "KH",
  isAuthenticated: true,
}

const SIGNED_OUT_SESSION: AuthSession = {
  userId: "",
  name: "",
  username: "",
  email: "",
  plan: "Free",
  avatarInitials: "",
  isAuthenticated: false,
}

export function getAuthSession(): AuthSession {
  return IS_TEST_ENV ? TEST_AUTH_SESSION : SIGNED_OUT_SESSION
}

export function getAuthHeaders(): Record<string, string> {
  return {
    "X-Rayu-Client": "rayucode-desktop/0.1.0",
  }
}

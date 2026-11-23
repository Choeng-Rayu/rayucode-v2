export interface AuthSession {
  userId: string
  name: string
  username: string
  email: string
  plan: "Free" | "Basic" | "Pro" | "Plus" | "Max" | "Team" | "Team Plus" | "Team Max" | "Enterprise"
  avatarInitials: string
  isAuthenticated: boolean
}

const DEFAULT_AUTH_SESSION: AuthSession = {
  userId: "usr_lyyeakkhai",
  name: "ly yeak khai",
  username: "@yeakhaily",
  email: "yeakhaily@gmail.com",
  plan: "Plus",
  avatarInitials: "LK",
  isAuthenticated: true,
}

export function getAuthSession(): AuthSession {
  return DEFAULT_AUTH_SESSION
}

export function getAuthHeaders(): Record<string, string> {
  return {
    "X-Rayu-Client": "rayucode-desktop/0.1.0",
    "X-Rayu-User": DEFAULT_AUTH_SESSION.userId,
  }
}

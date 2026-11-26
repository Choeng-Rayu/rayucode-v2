import type { AcpProfile, RayuProduct } from "./types.js";

export type AcpIdeTarget =
  | "vscode"
  | "zed"
  | "jetbrains"
  | "neovim-codecompanion"
  | "desktop"
  | "generic";

export interface IdeConfigOptions {
  /** Executable path or command name (defaults to `"rayu"`). */
  command?: string;
  /** Compatibility profile (`"standard"` recommended for third-party IDEs; `"extended"` for Rayu Desktop / VS Code). */
  profile?: AcpProfile;
  /** Optional product attribution (`"studio"`, `"rayucode"`, `"cli"`). */
  product?: RayuProduct;
  /** Optional extra environment variables. */
  env?: Record<string, string>;
}

export interface AcpServerLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Resolve the canonical `rayu acp` launch specification for any product or IDE.
 */
export function buildAcpLaunchSpec(options: IdeConfigOptions = {}): AcpServerLaunchSpec {
  const command = options.command?.trim() || "rayu";
  const args = ["acp"];
  if (options.profile && options.profile !== "standard") {
    args.push("--profile", options.profile);
  }
  if (options.product) {
    args.push("--product", options.product);
  }
  const env: Record<string, string> = { ...(options.env ?? {}) };
  if (options.product && !env.RAYU_CLIENT_PRODUCT) {
    env.RAYU_CLIENT_PRODUCT = options.product;
  }
  return { command, args, env };
}

/**
 * Generate an IDE-ready configuration object for connecting any ACP-compatible
 * editor or first-party Rayu product to `rayu acp`.
 */
export function buildIdeAcpConfig(
  target: AcpIdeTarget,
  options: IdeConfigOptions = {},
): Record<string, unknown> {
  const defaultProduct: RayuProduct | undefined =
    options.product ??
    (target === "desktop" ? "studio" : target === "vscode" ? "rayucode" : undefined);
  const defaultProfile: AcpProfile | undefined =
    options.profile ?? (target === "desktop" || target === "vscode" ? "extended" : "standard");
  const spec = buildAcpLaunchSpec({
    ...options,
    profile: defaultProfile,
    product: defaultProduct,
  });

  switch (target) {
    case "zed":
      return {
        agent_servers: {
          RayuCode: {
            command: spec.command,
            args: spec.args,
            env: spec.env,
          },
        },
      };
    case "jetbrains":
      return {
        agent_servers: {
          RayuCode: {
            command: spec.command,
            args: spec.args,
            env: spec.env,
          },
        },
      };
    case "neovim-codecompanion":
      return {
        adapters: {
          acp: {
            rayucode: {
              name: "rayucode",
              formatted_name: "RayuCode",
              type: "acp",
              commands: {
                default: [spec.command, ...spec.args],
              },
              env: spec.env,
            },
          },
        },
      };
    case "vscode":
      return {
        name: "RayuCode",
        transport: "stdio",
        command: spec.command,
        args: spec.args,
        env: spec.env,
      };
    case "desktop":
      return {
        name: "RayuCode Desktop",
        transport: "stdio",
        command: spec.command,
        args: spec.args,
        env: spec.env,
      };
    case "generic":
      return {
        name: "rayu",
        title: "RayuCode",
        command: spec.command,
        args: spec.args,
        env: spec.env,
      };
  }
}

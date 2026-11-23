import { spawn } from "node:child_process"

export interface TerminalCommandResult {
  id: string
  prompt: string
  command: string
  output: string
  exitCode: number
  durationMs: number
  isOk: boolean
  isError: boolean
}

const MAX_OUTPUT_BYTES = 128 * 1024

export async function runTerminalCommand(
  cwd: string,
  command: string,
  timeoutMs = 30_000
): Promise<TerminalCommandResult> {
  const startedAt = Date.now()
  const shell =
    process.platform === "win32"
      ? process.env.COMSPEC ?? "cmd.exe"
      : process.env.SHELL ?? "/bin/zsh"
  const shellArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command]

  return new Promise((resolve) => {
    const child = spawn(shell, shellArgs, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let truncated = false
    let timedOut = false

    const append = (chunk: Buffer) => {
      if (truncated) return
      const text = chunk.toString("utf8")
      if (output.length + text.length > MAX_OUTPUT_BYTES) {
        output += text.slice(0, MAX_OUTPUT_BYTES - output.length)
        output += "\n[output truncated at 128 KB]"
        truncated = true
      } else {
        output += text
      }
    }

    child.stdout?.on("data", append)
    child.stderr?.on("data", append)

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
    }, timeoutMs)

    child.once("error", (err) => {
      clearTimeout(timer)
      resolve({
        id: `term_${Date.now()}`,
        prompt: "$",
        command,
        output: err.message,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        isOk: false,
        isError: true,
      })
    })

    child.once("close", (code) => {
      clearTimeout(timer)
      const exitCode = timedOut ? 124 : (code ?? 1)
      const trimmed = output.trimEnd()
      const finalOutput = timedOut
        ? `${trimmed}\n[timed out after ${Math.round(timeoutMs / 1000)}s]`.trim()
        : trimmed || `(exit ${exitCode})`
      resolve({
        id: `term_${Date.now()}`,
        prompt: "$",
        command,
        output: finalOutput,
        exitCode,
        durationMs: Date.now() - startedAt,
        isOk: exitCode === 0,
        isError: exitCode !== 0,
      })
    })
  })
}

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"

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

const PTY_DRIVER_PY = `
import fcntl, json, os, pty, select, signal, struct, sys, termios

shell = sys.argv[1]
cols = max(20, int(sys.argv[2]))
rows = max(5, int(sys.argv[3]))

pid, master_fd = pty.fork()
if pid == 0:
    try:
        os.setsid()
    except OSError:
        pass
    os.environ["TERM"] = "xterm-256color"
    os.environ["COLORTERM"] = "truecolor"
    try:
        os.execv(shell, [shell, "-i", "-l"])
    except OSError:
        os.execv("/bin/sh", ["/bin/sh", "-i"])

stop_requested = False

def terminate_child_group(signum=None, frame=None):
    global stop_requested
    stop_requested = True
    try:
        os.killpg(pid, signal.SIGTERM)
    except OSError:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

signal.signal(signal.SIGTERM, terminate_child_group)
signal.signal(signal.SIGHUP, terminate_child_group)

def set_size(c, r):
    try:
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
        os.kill(pid, signal.SIGWINCH)
    except OSError:
        pass

def write_all(fd, data):
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        view = view[written:]

set_size(cols, rows)
stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()
in_buf = b""

while not stop_requested:
    try:
        rlist, _, _ = select.select([master_fd, stdin_fd], [], [], 0.25)
    except InterruptedError:
        continue

    if master_fd in rlist:
        try:
            data = os.read(master_fd, 8192)
            if not data:
                break
            write_all(stdout_fd, data)
        except OSError:
            break

    if stdin_fd in rlist:
        try:
            chunk = os.read(stdin_fd, 8192)
        except OSError:
            break
        if not chunk:
            break
        in_buf += chunk
        while b"\\n" in in_buf:
            line, in_buf = in_buf.split(b"\\n", 1)
            if not line.strip():
                continue
            try:
                msg = json.loads(line.decode("utf-8", "ignore"))
                t = msg.get("t")
                if t == "d":
                    d = msg.get("d", "")
                    if d:
                        write_all(master_fd, d.encode("utf-8"))
                elif t == "r":
                    set_size(max(20, int(msg.get("c", 80))), max(5, int(msg.get("r", 24))))
            except Exception:
                pass

    try:
        wpid, _ = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            break
    except ChildProcessError:
        break

terminate_child_group()
try:
    os.waitpid(pid, os.WNOHANG)
except ChildProcessError:
    pass
try:
    os.close(master_fd)
except OSError:
    pass
`

function resolveExistingCwd(candidate: string | undefined, fallback: string): string {
  const raw = (candidate?.trim() || fallback).trim()
  const expanded = raw.startsWith("~/")
    ? path.join(os.homedir(), raw.slice(2))
    : raw
  const resolved = path.resolve(expanded)
  try {
    if (fs.statSync(resolved).isDirectory()) {
      return resolved
    }
  } catch {
    // fall through
  }
  return fallback
}

interface PtySessionEntry {
  child: ChildProcess
  cwd: string
}

interface PtySessionEntry {
  child: ChildProcess
  cwd: string
  generation: number
}

export class TerminalPtyManager {
  private sessions = new Map<string, PtySessionEntry>()
  private nextGeneration = 0

  create(options: {
    sessionId: string
    cwd?: string
    fallbackCwd: string
    cols?: number
    rows?: number
    onData: (data: string) => void
    onExit: (exitCode: number) => void
  }): { ok: boolean; cwd: string; shell: string } {
    this.kill(options.sessionId)

    const generation = ++this.nextGeneration
    const cwd = resolveExistingCwd(options.cwd, options.fallbackCwd)
    const cols = Math.max(20, Math.min(400, options.cols ?? 96))
    const rows = Math.max(5, Math.min(200, options.rows ?? 28))
    const shell =
      process.platform === "win32"
        ? process.env.COMSPEC ?? "cmd.exe"
        : process.env.SHELL ?? "/bin/zsh"

    const child =
      process.platform === "win32"
        ? spawn(shell, [], {
            cwd,
            env: { ...process.env, TERM: "xterm-256color" },
            stdio: ["pipe", "pipe", "pipe"],
          })
        : spawn("python3", ["-u", "-c", PTY_DRIVER_PY, shell, String(cols), String(rows)], {
            cwd,
            env: {
              ...process.env,
              TERM: "xterm-256color",
              COLORTERM: "truecolor",
            },
            stdio: ["pipe", "pipe", "pipe"],
          })

    this.sessions.set(options.sessionId, { child, cwd, generation })
    if (process.platform === "win32") {
      options.onData(
        "[Windows terminal mode: interactive piped shell without POSIX PTY resize]\r\n"
      )
    }

    const stdoutDecoder = new StringDecoder("utf8")
    const stderrDecoder = new StringDecoder("utf8")

    child.stdout?.on("data", (buf: Buffer) => {
      const current = this.sessions.get(options.sessionId)
      if (!current || current.generation !== generation) return
      const text = stdoutDecoder.write(buf)
      if (text) options.onData(text)
    })
    child.stderr?.on("data", (buf: Buffer) => {
      const current = this.sessions.get(options.sessionId)
      if (!current || current.generation !== generation) return
      const text = stderrDecoder.write(buf)
      if (text) options.onData(text)
    })
    child.once("error", (err) => {
      const current = this.sessions.get(options.sessionId)
      if (!current || current.generation !== generation) return
      options.onData(`\r\n[terminal error: ${err.message}]\r\n`)
    })
    child.once("close", (code) => {
      const restOut = stdoutDecoder.end()
      const restErr = stderrDecoder.end()
      const current = this.sessions.get(options.sessionId)
      if (current && current.generation === generation) {
        if (restOut) options.onData(restOut)
        if (restErr) options.onData(restErr)
        this.sessions.delete(options.sessionId)
        options.onExit(code ?? 0)
      }
    })

    return { ok: true, cwd, shell }
  }

  write(sessionId: string, data: string): { ok: boolean } {
    const entry = this.sessions.get(sessionId)
    if (!entry?.child.stdin || entry.child.stdin.destroyed) {
      return { ok: false }
    }
    try {
      if (process.platform === "win32") {
        entry.child.stdin.write(data)
      } else {
        entry.child.stdin.write(`${JSON.stringify({ t: "d", d: data })}\n`)
      }
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  resize(sessionId: string, cols: number, rows: number): { ok: boolean } {
    const entry = this.sessions.get(sessionId)
    if (!entry?.child.stdin || entry.child.stdin.destroyed) {
      return { ok: false }
    }
    if (process.platform === "win32") {
      return { ok: true }
    }
    try {
      entry.child.stdin.write(
        `${JSON.stringify({
          t: "r",
          c: Math.max(20, Math.min(400, Math.round(cols))),
          r: Math.max(5, Math.min(200, Math.round(rows))),
        })}\n`
      )
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  kill(sessionId: string): { ok: boolean } {
    const entry = this.sessions.get(sessionId)
    if (!entry) return { ok: false }
    this.sessions.delete(sessionId)
    try {
      entry.child.stdin?.end()
      entry.child.kill("SIGTERM")
    } catch {
      // ignore
    }
    return { ok: true }
  }

  killAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.kill(sessionId)
    }
  }
}

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Runs the local Claude Code CLI headless (`claude -p`) with its own login, so a company Claude seat
 * works without an API key. Safe mode drops CLAUDE.md, plugins, hooks and MCP; no tools; nothing is
 * saved as a session. Output is validated against a JSON schema by the CLI.
 */

const CANDIDATES = [join(homedir(), '.local/bin/claude'), join(homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']

/** Path to `claude`, or null. CLAUDE_BIN overrides; otherwise PATH, then the usual install locations. */
export function claudeBin(): string | null {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  for (const dir of (process.env.PATH ?? '').split(':')) if (dir && existsSync(join(dir, 'claude'))) return join(dir, 'claude')
  return CANDIDATES.find((p) => existsSync(p)) ?? null
}

interface CliResult {
  is_error?: boolean
  result?: string
  structured_output?: unknown
  modelUsage?: Record<string, unknown>
}

export async function claudeCodeJson<T>(opts: { system: string; prompt: string; schema: object; model: string; timeoutMs?: number }) {
  const bin = claudeBin()
  if (!bin) throw new Error('Claude Code (`claude`) not found. Install it, or set CLAUDE_BIN to its path.')
  // The CLI's validator doesn't know the draft-2020 meta-schema zod stamps on; the schema itself is fine
  const { $schema: _meta, ...schema } = opts.schema as Record<string, unknown>
  const args = [
    '-p',
    '--safe-mode',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--model', opts.model,
    '--system-prompt', opts.system,
    '--tools', '',
    '--no-session-persistence',
  ]
  const out = await new Promise<string>((resolve, reject) => {
    // Run outside any project so nothing project-specific is picked up
    const child = spawn(bin, args, { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => (child.kill('SIGTERM'), reject(new Error('Claude Code timed out'))), opts.timeoutMs ?? 180_000)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (e) => (clearTimeout(timer), reject(e)))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (stdout.trim()) resolve(stdout)
      else reject(new Error(`Claude Code exited with ${code}: ${stderr.trim().slice(0, 300) || 'no output'}`))
    })
    child.stdin.end(opts.prompt)
  })

  let res: CliResult
  try {
    res = JSON.parse(out) as CliResult
  } catch {
    throw new Error(`Claude Code returned unexpected output: ${out.trim().slice(0, 300)}`)
  }
  if (res.is_error) throw new Error(`Claude Code: ${res.result ?? 'unknown error'}`)
  if (res.structured_output == null) throw new Error('Claude Code returned no structured output')
  return { data: res.structured_output as T, model: Object.keys(res.modelUsage ?? {})[0] ?? opts.model }
}

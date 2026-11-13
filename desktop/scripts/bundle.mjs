// Bundles what the Mac app runs: the server (and the MCP server) as single ES modules, and the built
// web app. The app runs them with its own Node (Electron 45: Node 24, which has node:sqlite).
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const desktop = fileURLToPath(new URL('..', import.meta.url))
const root = join(desktop, '..')
const out = join(desktop, 'app')

// The app's version follows the repo's
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const pkgPath = join(desktop, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
if (pkg.version !== version) writeFileSync(pkgPath, JSON.stringify({ ...pkg, version }, null, 2) + '\n')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

console.log('Building the web app…')
execSync('npm run build', { cwd: root, stdio: 'inherit' })
cpSync(join(root, 'web', 'dist'), join(out, 'web'), { recursive: true })

console.log('Bundling the server…')
await build({
  entryPoints: { server: join(root, 'server/src/index.ts'), mcp: join(root, 'server/src/mcp.ts') },
  outdir: join(out, 'server'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outExtension: { '.js': '.mjs' },
  // Some dependencies still call require(): give ESM bundles one
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
})
if (!existsSync(join(out, 'server', 'server.mjs'))) throw new Error('server bundle missing')
console.log(`Bundled PR Deck ${version} into desktop/app`)

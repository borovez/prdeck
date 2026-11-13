import './quiet.ts'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DB_PATH, getSettings, getSyncState, saveSyncState } from './db.ts'
import { api } from './routes.ts'
import { runSync } from './sync.ts'

const PORT = Number(process.env.PRDECK_PORT ?? 4317)
// Bound to loopback only: this process holds your GitHub and Jira tokens.
const HOST = '127.0.0.1'

const app = new Hono()
app.route('/api', api)

// In production, serve the built Vue app.
const dist = fileURLToPath(new URL('../../web/dist', import.meta.url))
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: dist }))
  // SPA fallback. Read on each request: a rebuild renames the hashed assets it points to
  app.get('*', (c) => c.html(readFileSync(`${dist}/index.html`, 'utf8')))
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`prdeck API on http://${HOST}:${PORT}  (db: ${DB_PATH})`)
})

// A sync cut short by a restart left "running" behind; mark it stopped, with unfinished steps as queued
const stale = getSyncState()
if (stale.running) {
  saveSyncState({
    ...stale,
    running: false,
    steps: stale.steps?.map((s) => (s.status === 'running' ? { ...s, status: 'error', detail: 'Interrupted (server restarted)' } : s)),
  })
}

// Background sync loop – re-reads the interval every tick so settings changes apply.
let last = 0
setInterval(() => {
  const s = getSettings()
  if (!s.sync.auto || !s.github.accounts.some((a) => a.token)) return
  const minutes = Math.max(1, Number(s.sync.intervalMinutes) || 5)
  if (Date.now() - last < minutes * 60_000) return
  last = Date.now()
  runSync().catch((e) => console.error('[sync]', e))
}, 30_000)

import type { RepoCatalog, RepoCatalogEntry } from '../../shared/types.ts'
import { getSettings, kvGet, kvSet } from './db.ts'
import { listRepos, whoAmI } from './github.ts'

const MAX_AGE_MS = 60 * 60_000
let inFlight: Promise<RepoCatalog> | null = null

/**
 * Every repo the GitHub accounts can see, across each account's own repos and its orgs (or only the
 * orgs an account is limited to). Stored in the database for an hour so Settings opens instantly,
 * also after a restart; `refresh` lists again. One listing at a time.
 */
export function repoCatalog(refresh = false): Promise<RepoCatalog> {
  const cached = kvGet<RepoCatalog | null>('repoCatalog', null)
  if (!refresh && cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < MAX_AGE_MS) return Promise.resolve(cached)
  inFlight ??= build().finally(() => (inFlight = null))
  return inFlight
}

async function build(): Promise<RepoCatalog> {
  const accounts = getSettings().github.accounts.filter((a) => a.token)
  const errors: string[] = []
  const owners = new Map<string, string>() // owner (lowercase) → token that lists it
  await Promise.all(
    accounts.map(async (acc) => {
      try {
        const me = await whoAmI(acc.token)
        for (const o of acc.orgs.length ? acc.orgs : [me.login, ...me.orgs]) if (!owners.has(o.toLowerCase())) owners.set(o.toLowerCase(), acc.token)
      } catch (e) {
        errors.push(`${acc.label}: ${(e as Error).message}`)
      }
    }),
  )
  const repos = new Map<string, RepoCatalogEntry>()
  const list = [...owners]
  // A few owners at a time
  for (let i = 0; i < list.length; i += 4) {
    await Promise.all(
      list.slice(i, i + 4).map(async ([owner, token]) => {
        try {
          const r = await listRepos(token, owner)
          for (const x of r.repos)
            repos.set(x.nameWithOwner.toLowerCase(), {
              nameWithOwner: x.nameWithOwner,
              owner: x.nameWithOwner.split('/')[0],
              ownerAvatarUrl: r.avatarUrl,
              pushedAt: x.pushedAt,
              isPrivate: x.isPrivate,
              description: x.description,
            })
        } catch (e) {
          errors.push(`${owner}: ${(e as Error).message}`)
        }
      }),
    )
  }
  const catalog: RepoCatalog = {
    repos: [...repos.values()].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt)),
    fetchedAt: new Date().toISOString(),
    errors,
  }
  // Keep the last good list when everything failed (e.g. offline)
  if (!catalog.repos.length && errors.length) {
    const old = kvGet<RepoCatalog | null>('repoCatalog', null)
    if (old?.repos.length) return { ...old, errors }
  }
  kvSet('repoCatalog', catalog)
  return catalog
}

import type { FeatureFlag, LaunchDarklyConfig } from '../../shared/types.ts'

/** Read-only LaunchDarkly REST client: GET requests only. */
export class LaunchDarklyError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

async function get<T>(cfg: LaunchDarklyConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'GET',
    headers: { Authorization: cfg.apiToken, Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300)
    throw new LaunchDarklyError(`LaunchDarkly ${res.status} ${path}: ${text}`, res.status)
  }
  return (await res.json()) as T
}

/** Check the token and project; returns the project's name and environment keys */
export async function testLaunchDarkly(cfg: LaunchDarklyConfig) {
  const p = await get<{ name: string; environments: { items?: { key: string; name: string }[] } | { key: string; name: string }[] }>(
    cfg,
    `/api/v2/projects/${encodeURIComponent(cfg.projectKey)}?expand=environments`,
  )
  const envs = Array.isArray(p.environments) ? p.environments : (p.environments.items ?? [])
  return { project: p.name, environments: envs.map((e) => e.key) }
}

/** One flag with its on/off state in the configured environments */
export async function getFlag(cfg: LaunchDarklyConfig, key: string): Promise<FeatureFlag> {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const url = `${base}/projects/${encodeURIComponent(cfg.projectKey)}/flags/${encodeURIComponent(key)}`
  const fetchedAt = new Date().toISOString()
  try {
    const qs = cfg.environments.map((e) => `env=${encodeURIComponent(e)}`).join('&')
    const f = await get<any>(cfg, `/api/v2/flags/${encodeURIComponent(cfg.projectKey)}/${encodeURIComponent(key)}${qs ? `?${qs}` : ''}`)
    return {
      key,
      name: f.name ?? key,
      url,
      archived: !!f.archived,
      temporary: !!f.temporary,
      envs: cfg.environments
        .filter((e) => f.environments?.[e])
        .map((e) => ({ key: e, on: !!f.environments[e].on, lastModified: f.environments[e].lastModified ? new Date(f.environments[e].lastModified).toISOString() : null })),
      fetchedAt,
    }
  } catch (e) {
    const notFound = (e as LaunchDarklyError).status === 404
    return { key, name: key, url, archived: false, temporary: false, envs: [], fetchedAt, error: notFound ? `Not found in project ${cfg.projectKey}` : (e as Error).message }
  }
}

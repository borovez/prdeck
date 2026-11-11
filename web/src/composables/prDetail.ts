import type { PrDetail, PrView } from '@shared/types'
import { api } from '@/api'

/** PR description and files, fetched once per PR version (updatedAt) and shared by the panel and previews */
const cache = new Map<string, Promise<PrDetail>>()

export function loadPrDetail(pr: Pick<PrView, 'id' | 'updatedAt'>): Promise<PrDetail> {
  const key = `${pr.id}|${pr.updatedAt}`
  let p = cache.get(key)
  if (!p) {
    p = api.prDetail(pr.id)
    cache.set(key, p)
    p.catch(() => cache.delete(key)) // retry next time
  }
  return p
}

/** Plain-text start of GitHub's rendered description, for previews */
export function descriptionExcerpt(html: string, max = 280): string {
  const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

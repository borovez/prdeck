import { adfToMarkdown } from '../../shared/adf.ts'
import type { PrView } from '../../shared/types.ts'
import { getSettings } from './db.ts'
import { getIssueDetail } from './jira.ts'
import { buildOverview } from './model.ts'

/**
 * A self-contained prompt for any AI coding agent to implement a Jira issue: the issue and its links,
 * the description and latest comments, the PRs, repos, flags and Slack threads tied to it, and how to
 * work (repo conventions, branch, PR rules). Built from what PR Deck knows; no AI call.
 */
export async function buildAgentPrompt(key: string): Promise<string> {
  const s = getSettings()
  const o = buildOverview()
  const k = key.toUpperCase()
  const issue = o.jira.find((j) => j.key === k)
  const base = (o.jiraBaseUrl ?? s.jira?.baseUrl ?? '').replace(/\/+$/, '')
  const browse = (x: string) => (base ? `${base}/browse/${x}` : x)
  const detail = s.jira?.apiToken ? await getIssueDetail(s.jira, k, 6).catch(() => null) : null

  // Jira-hosted images can't be opened by an agent: say they exist instead
  const readable = (md: string) =>
    md.replace(/!\[([^\]]*)\]\(jira-media:[^)]+\)/g, (_, alt: string) => `_(image in Jira${alt ? `: ${alt}` : ''}; open the issue to see it)_`).trim()
  // The description's headings go under this prompt's "## Description"
  const nested = (md: string) => md.replace(/^(#{1,4})[ \t]/gm, (_, h: string) => `${'#'.repeat(Math.min(h.length + 2, 6))} `)
  const description = detail?.description ? nested(readable(adfToMarkdown(detail.description))) : ''

  const linked: PrView[] = (issue?.prs ?? []).map((id) => o.prs.find((p) => p.id === id)).filter((p): p is PrView => !!p)
  // Release PRs carry many issues' keys: they say where the work ships, not where it's done
  const prs = linked.filter((p) => p.flow !== 'release')
  const releases = linked.filter((p) => p.flow === 'release')
  const repos = [...new Set(prs.map((p) => p.repo))]
  const flags = [...new Set(prs.flatMap((p) => p.flags))]
  const flagState = new Map(o.flags.map((f) => [f.key, f]))
  const slack = o.slack.filter((i) => i.jiraKey === k)

  const title = issue?.summary ?? k
  const slug = title
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-[^-]*$/, (m) => (m.length < 4 ? '' : m))
  const branchType = /bug/i.test(issue?.type ?? '') ? 'fix' : 'feat'

  const facts = issue
    ? [
        issue.type,
        issue.status,
        issue.priority && `priority ${issue.priority}`,
        issue.assignee && `assigned to ${issue.assignee.displayName}`,
        issue.fixVersions.length && `fix version ${issue.fixVersions.join(', ')}`,
        issue.labels.length && `labels: ${issue.labels.join(', ')}`,
      ].filter(Boolean)
    : []

  const prLine = (p: PrView) => {
    const state = p.state === 'OPEN' ? (p.isDraft ? 'draft' : 'open') : p.state.toLowerCase()
    const deps = p.dependsOn.map((d) => `${d.kind === 'release' ? 'needs release of' : 'depends on'} ${d.to}${d.satisfied ? ' (done)' : ''}`)
    const extra = [
      `${p.headRef} → ${p.baseRef}`,
      p.state === 'OPEN' && `checks ${p.checks.state.toLowerCase()}`,
      p.state === 'OPEN' && p.action.label,
      ...deps,
    ].filter(Boolean)
    return `- [${p.id}](${p.url}): ${p.title} (${state}; ${extra.join('; ')})`
  }

  const sections = [
    `# Implement ${k}: ${title}`,
    `You're implementing the Jira issue below. Read the linked context first, then plan the change, then implement it. Where something is unclear, list the questions instead of guessing.`,
    `## Issue\n- Jira: [${k}](${browse(k)})${facts.length ? ` (${facts.join(' · ')})` : ''}${
      issue?.parent ? `\n- Parent: [${issue.parent.key}](${browse(issue.parent.key)}) ${issue.parent.summary}${issue.parent.status ? ` (${issue.parent.status})` : ''}` : ''
    }`,
    `## Description\n${description || (s.jira?.apiToken ? '_(no description in Jira)_' : '_(open the issue in Jira for the description)_')}`,
    issue?.links.length
      ? `## Related issues\n${issue.links.map((l) => `- ${l.label} [${l.key}](${browse(l.key)}) ${l.summary} (${l.status})`).join('\n')}`
      : '',
    `## Pull requests\n${prs.length ? prs.map(prLine).join('\n') : '- None yet: this work starts a new PR.'}${
      releases.length ? `\n\nShips in: ${releases.map((p) => `[${p.id}](${p.url}) (${p.state === 'OPEN' ? 'open' : p.state.toLowerCase()})`).join(', ')}` : ''
    }${
      repos.length ? `\n\nRepos involved: ${repos.map((r) => `[${r}](https://github.com/${r})`).join(', ')}` : ''
    }`,
    flags.length
      ? `## Feature flags\n${flags
          .map((f) => {
            const st = flagState.get(f)
            const envs = st?.envs.map((e) => `${e.key} ${e.on ? 'on' : 'off'}`).join(', ')
            return `- \`${f}\`${st?.url ? ` ([LaunchDarkly](${st.url}))` : ''}${envs ? `: ${envs}` : ''}`
          })
          .join('\n')}\nKeep new behaviour behind the flag.`
      : '',
    slack.length
      ? `## Slack threads\n${slack.map((i) => `- ${i.permalink ? `[${i.userName} in ${i.channelName}](${i.permalink})` : `${i.userName} in ${i.channelName}`}: ${i.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}`
      : '',
    detail?.comments.length
      ? `## Latest comments (oldest first)\n${detail.comments
          .map((c) => `- ${c.author} (${c.created.slice(0, 10)}): ${readable(adfToMarkdown(c.body)).replace(/\n+/g, ' ').slice(0, 600)}`)
          .join('\n')}`
      : '',
    `## How to work
- ${repos.length === 1 ? `Work in ${repos[0]}.` : repos.length ? `The change spans ${repos.join(', ')}; keep each repo's part in its own PR.` : 'Find the repo this belongs to from the description, or ask.'} Read its CLAUDE.md / AGENTS.md and follow its conventions, architecture and tests.
- ${prs.some((p) => p.state === 'OPEN') ? 'Continue on the open PR branch above when the work belongs there; otherwise branch' : 'Branch'} as \`${branchType}/${k}-${slug || 'work'}\`.
- Add or update tests for the behaviour you change, and run the repo's checks before opening the PR.
- The PR title ends with \`[${k}]\`. The description starts with a \`## JIRA\` section linking [${k}](${browse(k)}), follows the repo's PR template, declares ordering with \`Depends on: owner/repo#n\` lines (and \`Blocks:\` on the other PR), names flags with \`Feature flag: key\`, and has a \`## Deployment steps\` checklist (or "None: a normal deploy.").
- Don't change behaviour outside this issue's scope; mention follow-ups in the PR instead.`,
  ]
  return `${sections.filter(Boolean).join('\n\n')}\n`
}

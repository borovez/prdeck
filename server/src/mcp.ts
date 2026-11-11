import './quiet.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { Overview, PrView } from '../../shared/types.ts'
import { addManualDep, getSettings, getSlackItem, listSlack, removeManualDep, setSlackStatus } from './db.ts'
import { createIssue, requiredFields } from './jira.ts'
import { replyInThread, threadContext } from './slack.ts'
import { buildOverview } from './model.ts'
import { normaliseRef } from './refs.ts'
import { runSync } from './sync.ts'

// stdio MCP server over the same SQLite cache the web app uses.
// Register in Claude Code:  claude mcp add prdeck --scope user -- <node> <tsx cli> <this file>

const server = new McpServer({ name: 'prdeck', version: '0.1.0' })

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

function line(p: PrView): string {
  const bits = [
    `${p.id}`,
    `"${p.title}"`,
    `[${p.state}${p.isDraft ? ', draft' : ''}]`,
    `action: ${p.action.label}${p.action.detail ? ` (${p.action.detail})` : ''}`,
    `author: ${p.author.login}`,
    p.jiraKeys.length ? `jira: ${p.jiraKeys.join(', ')}` : '',
    p.dependsOn.length ? `depends on: ${p.dependsOn.map((e) => `${e.to}${e.satisfied ? ' ✓' : ` (${e.kind})`}`).join(', ')}` : '',
    p.url,
  ]
  return '- ' + bits.filter(Boolean).join(' · ')
}

function summary(o: Overview): string {
  const sec = (title: string, prs: PrView[]) => (prs.length ? `## ${title} (${prs.length})\n${prs.map(line).join('\n')}\n` : '')
  const by = (b: string) => o.prs.filter((p) => p.bucket === b)
  const chains = o.chains
    .filter((c) => !c.done)
    .map((c) => `- ${c.prs.join(' → ')}  (next: ${c.nextStep})`)
    .join('\n')
  return [
    `GitHub user(s): ${o.me.join(', ') || 'unknown'} · last sync: ${o.sync.lastFinishedAt ?? 'never'}`,
    o.sync.errors.length ? `Sync errors:\n${o.sync.errors.map((e) => `  ! ${e}`).join('\n')}` : '',
    sec('Needs my action', by('action')),
    sec('Blocked by dependencies', by('blocked')),
    sec('Waiting on others', by('waiting')),
    chains ? `## Open dependency chains (prerequisites first)\n${chains}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

server.registerTool(
  'overview',
  {
    title: 'PR overview',
    description:
      'Summary of my pull requests across all GitHub orgs: what needs my action (reviews, CI, feedback, merges, releases), what is blocked on dependencies, what waits on others, and open cross-repo dependency chains.',
    inputSchema: {},
  },
  async () => text(summary(buildOverview())),
)

server.registerTool(
  'list_prs',
  {
    title: 'List pull requests',
    description: 'List cached PRs with optional filters. Returns one line per PR.',
    inputSchema: {
      bucket: z.enum(['action', 'waiting', 'blocked', 'watching', 'done']).optional(),
      mine: z.boolean().optional().describe('Only PRs I authored'),
      reviewRequested: z.boolean().optional().describe('Only PRs where my review is requested'),
      repo: z.string().optional().describe('owner/name'),
      jiraKey: z.string().optional(),
      query: z.string().optional().describe('Substring match on title / branch / id'),
    },
  },
  async (f) => {
    let prs = buildOverview().prs
    if (f.bucket) prs = prs.filter((p) => p.bucket === f.bucket)
    if (f.mine) prs = prs.filter((p) => p.isMine)
    if (f.reviewRequested) prs = prs.filter((p) => p.action.kind === 'review')
    if (f.repo) prs = prs.filter((p) => p.repo.toLowerCase() === f.repo!.toLowerCase())
    if (f.jiraKey) prs = prs.filter((p) => p.jiraKeys.includes(f.jiraKey!.toUpperCase()))
    if (f.query) {
      const q = f.query.toLowerCase()
      prs = prs.filter((p) => `${p.id} ${p.title} ${p.headRef}`.toLowerCase().includes(q))
    }
    return text(prs.length ? prs.map(line).join('\n') : 'No matching PRs.')
  },
)

server.registerTool(
  'get_pr',
  {
    title: 'PR details',
    description: 'Full details for one PR: reviews, checks, Jira issues, dependencies in both directions, release status.',
    inputSchema: { pr: z.string().describe('owner/repo#123 or GitHub PR URL') },
  },
  async ({ pr }) => {
    const id = normaliseRef(pr)
    const o = buildOverview()
    const p = o.prs.find((x) => x.id === id)
    if (!p) return text(`${pr} is not in the cache. Add it as a dependency or track its repo, then sync.`)
    const jira = o.jira.filter((j) => p.jiraKeys.includes(j.key))
    return text(JSON.stringify({ ...p, jira }, null, 2))
  },
)

server.registerTool(
  'jira_issue',
  {
    title: 'Jira issue with PRs',
    description: 'A Jira issue (status, links) together with every PR that references it.',
    inputSchema: { key: z.string().describe('e.g. PROJ-123') },
  },
  async ({ key }) => {
    const o = buildOverview()
    const issue = o.jira.find((j) => j.key === key.toUpperCase())
    if (!issue) return text(`${key} is not cached (no PR references it and it is not assigned to you).`)
    const prs = o.prs.filter((p) => issue.prs.includes(p.id))
    return text(`${issue.key} [${issue.status}] ${issue.summary}\n${issue.url}\n\nPRs:\n${prs.map(line).join('\n') || '(none)'}`)
  },
)

server.registerTool(
  'add_dependency',
  {
    title: 'Add PR dependency',
    description:
      'Record that `pr` cannot be merged until `dependsOn` is merged (kind=merge) or merged AND released (kind=release). Works across repos and orgs.',
    inputSchema: {
      pr: z.string().describe('The dependent PR (owner/repo#123 or URL)'),
      dependsOn: z.string().describe('The prerequisite PR'),
      kind: z.enum(['merge', 'release']).default('merge'),
      note: z.string().optional(),
    },
  },
  async ({ pr, dependsOn, kind, note }) => {
    const from = normaliseRef(pr)
    const to = normaliseRef(dependsOn)
    if (!from || !to) return text('Could not parse PR references. Use owner/repo#123 or a GitHub PR URL.')
    const id = addManualDep(from, to, kind, note ?? null)
    return text(`Added dependency #${id}: ${from} waits on ${kind} of ${to}. Run "sync" to fetch any PR not cached yet.`)
  },
)

server.registerTool(
  'remove_dependency',
  {
    title: 'Remove PR dependency',
    description: 'Remove a manual dependency by id (ids are shown by get_pr). Dependencies parsed from PR bodies or Jira cannot be removed here.',
    inputSchema: { id: z.number().int() },
  },
  async ({ id }) => text(removeManualDep(id) ? `Removed dependency #${id}.` : `No manual dependency #${id}.`),
)

server.registerTool(
  'sync',
  {
    title: 'Sync now',
    description: 'Refresh PRs from GitHub and issues from Jira, then return the overview.',
    inputSchema: {},
  },
  async () => {
    await runSync()
    return text(summary(buildOverview()))
  },
)

server.registerTool(
  'slack_inbox',
  {
    title: 'Slack inbox',
    description:
      'Slack messages that need my attention: @-mentions anywhere, and DMs / group DMs where someone wrote after my last reply. Defaults to status "new".',
    inputSchema: { status: z.enum(['new', 'done', 'dismissed', 'all']).default('new') },
  },
  async ({ status }) => {
    const items = listSlack().filter((i) => status === 'all' || i.status === status)
    if (!items.length) return text('Slack inbox is empty.')
    return text(
      items
        .map(
          (i) =>
            `- id: ${i.id} · ${i.kind} · ${i.channelName} · ${i.userName} · ${i.postedAt.slice(0, 16)}${i.jiraKey ? ` · jira: ${i.jiraKey}` : ''}\n  ${i.text.replace(/\n/g, ' ').slice(0, 300)}${i.permalink ? `\n  ${i.permalink}` : ''}`,
        )
        .join('\n'),
    )
  },
)

server.registerTool(
  'slack_thread',
  {
    title: 'Slack thread context',
    description: 'Full thread (or surrounding conversation) for a Slack inbox item, as plain text – use it before drafting a Jira issue.',
    inputSchema: { id: z.string().describe('Slack item id from slack_inbox') },
  },
  async ({ id }) => {
    const cfg = getSettings().slack
    const item = getSlackItem(id)
    if (!cfg?.token || !item) return text(`Unknown Slack item ${id}`)
    return text(await threadContext(cfg, item))
  },
)

server.registerTool(
  'set_slack_status',
  {
    title: 'Mark Slack item',
    description: 'Mark a Slack inbox item as done, dismissed, or new again.',
    inputSchema: { id: z.string(), status: z.enum(['new', 'done', 'dismissed']) },
  },
  async ({ id, status }) => {
    setSlackStatus(id, status)
    return text(`Marked ${id} as ${status}.`)
  },
)

server.registerTool(
  'create_jira_issue',
  {
    title: 'Create Jira issue',
    description:
      'Create a Jira issue (description in Markdown) using the configured defaults (project, extra required fields, assign to me). ' +
      'Pass slackItemId to link it to a Slack inbox item and mark that item done; set replyInThread to post the issue link back in the Slack thread. ' +
      'Show the user the draft and get confirmation before calling this.',
    inputSchema: {
      summary: z.string(),
      description: z.string().describe('Markdown'),
      issueType: z.string().default('Task'),
      projectKey: z.string().optional().describe('Defaults to the configured project'),
      labels: z.array(z.string()).optional(),
      slackItemId: z.string().optional(),
      replyInThread: z.boolean().default(false),
      fields: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Values for fields the project requires, in Jira shape, e.g. {"customfield_12345": {"id": "10001"}}. If one is missing, the tool lists the options.'),
    },
  },
  async (input) => {
    const s = getSettings()
    if (!s.jira?.apiToken) return text('Jira is not configured in PR Deck settings.')
    const projectKey = input.projectKey || s.jira.create.projectKey
    if (!projectKey) return text('No projectKey given and no default project configured.')
    // Ask for required fields up front instead of surfacing Jira's 400
    let defaults: Record<string, unknown> = {}
    try {
      defaults = JSON.parse(s.jira.create.extraFieldsJson || '{}')
    } catch {
      /* createIssue reports invalid JSON */
    }
    const missing = (await requiredFields(s.jira, projectKey, input.issueType)).filter((f) => !(f.key in { ...defaults, ...input.fields }))
    if (missing.length)
      return text(
        `Not created: ${projectKey} ${input.issueType} needs these fields. Ask the user, then call again with \`fields\`:\n` +
          missing
            .map((f) => `- ${f.name} (${f.key})${f.options.length ? `: ${f.options.map((o) => `${o.label} = {"id": "${o.id}"}`).join(', ')}` : ': text'}`)
            .join('\n'),
      )
    const item = input.slackItemId ? getSlackItem(input.slackItemId) : null
    const description = item?.permalink ? `${input.description}\n\n---\nSource: [Slack message from ${item.userName}](${item.permalink})` : input.description
    const created = await createIssue(s.jira, { ...input, projectKey, description })
    if (item) {
      setSlackStatus(item.id, 'done', created.key)
      if (input.replyInThread && s.slack?.token)
        await replyInThread(s.slack, item, `Tracked in Jira: <${created.url}|${created.key}> – ${input.summary}`)
    }
    return text(`Created ${created.key}: ${created.url}`)
  },
)

await server.connect(new StdioServerTransport())

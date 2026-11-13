import './quiet.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { JiraFieldMeta, JiraFieldValue, JiraValueLabels, Overview, PrView } from '../../shared/types.ts'
import { addManualDep, getSettings, getSlackItem, listSlack, removeManualDep, setSlackStatus, upsertJira } from './db.ts'
import { addComment, choicesFor, composeCreate, composeUpdate, createMeta, editable, resolveFieldInput } from './jira.ts'
import { claudeMdGuide } from './guides.ts'
import { buildAgentPrompt } from './agentPrompt.ts'
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

/** How a field's value reads for Claude: option labels, names, keys */
function valueText(f: JiraFieldMeta, v: JiraFieldValue | undefined, known: JiraValueLabels): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return 'none'
  const list = Array.isArray(v) ? v : [String(v)]
  return list.map((x) => f.options.find((o) => o.id === x)?.label ?? known[f.key]?.[x]?.label ?? x).join(', ')
}

server.registerTool(
  'jira_prompt',
  {
    title: 'Implementation brief for a Jira issue',
    description:
      'Everything needed to implement a Jira issue, as one Markdown brief: the issue, description, parent and related issues, ' +
      'its PRs and repos, feature flags, Slack threads, latest comments, and how to work (branch, PR rules). Use it before starting the work.',
    inputSchema: { key: z.string().describe('e.g. PROJ-123') },
  },
  async ({ key }) => text(await buildAgentPrompt(key)),
)

server.registerTool(
  'jira_fields',
  {
    title: 'Jira fields and writing guide',
    description:
      'Before creating or editing a Jira issue: the fields it has (type, required, choices such as priorities, active/future sprints, open epics), ' +
      "the project's writing guide (PR Deck settings) and optionally a repo's CLAUDE.md guidance. With `key`, also the issue's current " +
      'summary, Markdown description and field values (edit the description from this text: image lines ![…](jira-media:…) are its attachments and must be kept).',
    inputSchema: {
      key: z.string().optional().describe('An existing issue to edit, e.g. PROJ-123'),
      projectKey: z.string().optional().describe('For a new issue; defaults to the configured project'),
      issueType: z.string().optional().describe('For a new issue, e.g. Bug; defaults to the configured type'),
      repo: z.string().optional().describe('owner/name whose CLAUDE.md has issue-writing guidance'),
    },
  },
  async ({ key, projectKey, issueType, repo }) => {
    const s = getSettings()
    const cfg = s.jira
    if (!cfg?.apiToken) return text('Jira is not configured in PR Deck settings.')
    let head: string
    let fields: JiraFieldMeta[]
    let values: Record<string, JiraFieldValue> = {}
    let known: JiraValueLabels = {}
    let project: string
    let current = ''
    if (key) {
      const e = await editable(cfg, key.toUpperCase())
      project = e.project.key
      fields = e.fields
      values = e.values
      known = e.labels
      const type = e.issueTypes.find((t) => t.id === e.issueTypeId)?.name ?? ''
      head = `${e.key} (${project}) · type ${type} (can change to: ${e.issueTypes.map((t) => t.name).join(', ')})\n${e.url}`
      current = `\n\n## Current summary\n${e.summary}\n\n## Current description (Markdown)\n${e.description || '(empty)'}`
    } else {
      project = (projectKey || cfg.create.projectKey || '').toUpperCase()
      if (!project) return text('No projectKey given and no default project configured.')
      let meta = await createMeta(cfg, project)
      const wanted = issueType && meta.issueTypes.find((t) => t.name.toLowerCase() === issueType.toLowerCase())
      if (wanted && wanted.id !== meta.issueTypeId) meta = await createMeta(cfg, project, wanted.id)
      fields = meta.fields
      values = meta.defaults
      known = meta.labels
      const type = meta.issueTypes.find((t) => t.id === meta.issueTypeId)?.name ?? ''
      head = `New ${type} in ${meta.project.key} (${meta.project.name}) · types: ${meta.issueTypes.filter((t) => !t.subtask).map((t) => t.name).join(', ')}`
    }
    const rows = await Promise.all(
      fields.map(async (f) => {
        const choices = f.kind.startsWith('user') ? [] : await choicesFor(cfg, project, f, '', key)
        const c = choices.length ? `: ${choices.slice(0, 40).map((o) => (o.detail ? `${o.label} [${o.detail}]` : o.label)).join(' | ')}` : f.kind.startsWith('user') ? ': a person (name or email)' : ''
        const now = values[f.key] !== undefined ? ` (current: ${valueText(f, values[f.key], known)})` : ''
        return `- ${f.name}${f.required ? ' *' : ''} [${f.kind}]${c}${now}`
      }),
    )
    const guide = cfg.guides?.[project]?.trim()
    const repoGuide = repo ? await claudeMdGuide(repo).catch(() => null) : null
    return text(
      [
        head,
        guide ? `## Writing guide for ${project} (PR Deck settings; follow it)\n${guide}` : '',
        repoGuide ? `## ${repo} CLAUDE.md (issue guidance)\n${repoGuide}` : '',
        `## Fields (* = required; pass them to create_jira_issue / update_jira_issue by name, choices by label)\n${rows.join('\n')}`,
        current,
      ]
        .filter(Boolean)
        .join('\n\n'),
    )
  },
)

const FieldsInput = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('By field name or key: {"Priority": "High", "Story Points": 3, "Sprint": "Sprint 54", "Parent": "PROJ-12", "Labels": ["api"]}. null clears.')

server.registerTool(
  'create_jira_issue',
  {
    title: 'Create Jira issue',
    description:
      'Create a Jira issue (description in Markdown). Call jira_fields first for the fields, choices and writing guide. ' +
      'Uses the configured defaults (project, type, assign to me). Pass slackItemId to link it to a Slack inbox item and mark that item done; ' +
      'set replyInThread to post the issue link back in the Slack thread. Show the user the draft and get confirmation before calling this.',
    inputSchema: {
      summary: z.string(),
      description: z.string().describe('Markdown'),
      issueType: z.string().optional().describe('e.g. Task, Bug; defaults to the configured type'),
      projectKey: z.string().optional().describe('Defaults to the configured project'),
      fields: FieldsInput,
      slackItemId: z.string().optional(),
      replyInThread: z.boolean().default(false),
    },
  },
  async (input) => {
    const s = getSettings()
    const cfg = s.jira
    if (!cfg?.apiToken) return text('Jira is not configured in PR Deck settings.')
    const projectKey = (input.projectKey || cfg.create.projectKey || '').toUpperCase()
    if (!projectKey) return text('No projectKey given and no default project configured.')
    let meta = await createMeta(cfg, projectKey)
    if (input.issueType) {
      const t = meta.issueTypes.find((x) => x.name.toLowerCase() === input.issueType!.toLowerCase())
      if (!t) return text(`Not created: ${projectKey} has no issue type "${input.issueType}". Types: ${meta.issueTypes.map((x) => x.name).join(', ')}`)
      if (t.id !== meta.issueTypeId) meta = await createMeta(cfg, projectKey, t.id)
    }
    const { values, problems } = await resolveFieldInput(cfg, projectKey, meta.fields, input.fields ?? {})
    const all = { ...meta.defaults, ...values }
    const empty = (v: JiraFieldValue | undefined) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
    for (const f of meta.fields.filter((x) => x.required && empty(all[x.key]))) {
      const choices = await choicesFor(cfg, projectKey, f)
      problems.push(`${f.name} is required${choices.length ? `. Choices: ${choices.map((o) => o.label).join(' | ')}` : ''}`)
    }
    if (problems.length) return text(`Not created. Ask the user, then call again:\n${problems.map((p) => `- ${p}`).join('\n')}`)
    const item = input.slackItemId ? getSlackItem(input.slackItemId) : null
    const description = item?.permalink ? `${input.description}\n\n---\nSource: [Slack message from ${item.userName}](${item.permalink})` : input.description
    const issue = await composeCreate(cfg, {
      projectKey,
      issueTypeId: meta.issueTypeId,
      summary: input.summary,
      description,
      values: Object.fromEntries(Object.entries(all).filter(([, v]) => !empty(v))),
    })
    upsertJira(issue)
    if (item) {
      setSlackStatus(item.id, 'done', issue.key)
      if (input.replyInThread && s.slack?.token)
        await replyInThread(s.slack, item, `Tracked in Jira: <${issue.url}|${issue.key}> – ${input.summary}`)
    }
    return text(`Created ${issue.key}: ${issue.url}`)
  },
)

server.registerTool(
  'update_jira_issue',
  {
    title: 'Update Jira issue',
    description:
      'Change an existing Jira issue: only what you pass is written. Call jira_fields with the key first, and edit the description from the ' +
      'Markdown it returns (keep its image lines). Optionally add a comment (Markdown) saying what changed. ' +
      'Show the user the changes and get confirmation before calling this.',
    inputSchema: {
      key: z.string().describe('e.g. PROJ-123'),
      summary: z.string().optional(),
      description: z.string().optional().describe('Markdown: the whole new description'),
      issueType: z.string().optional(),
      fields: FieldsInput,
      comment: z.string().optional().describe('Markdown comment to add'),
    },
  },
  async (input) => {
    const cfg = getSettings().jira
    if (!cfg?.apiToken) return text('Jira is not configured in PR Deck settings.')
    const key = input.key.toUpperCase()
    const e = await editable(cfg, key)
    const { values, problems } = await resolveFieldInput(cfg, e.project.key, e.fields, input.fields ?? {}, key)
    let issueTypeId: string | undefined
    if (input.issueType) {
      const t = e.issueTypes.find((x) => x.name.toLowerCase() === input.issueType!.toLowerCase())
      if (!t) problems.push(`No issue type "${input.issueType}" for ${key}. Types: ${e.issueTypes.map((x) => x.name).join(', ')}`)
      else if (t.id !== e.issueTypeId) issueTypeId = t.id
    }
    if (problems.length) return text(`Not updated. Ask the user, then call again:\n${problems.map((p) => `- ${p}`).join('\n')}`)
    // Lost Jira images would be a silent loss: refuse a description that drops them
    const media = (md: string) => [...md.matchAll(/jira-media:([\w-]+)/g)].map((m) => m[1])
    if (input.description !== undefined) {
      const dropped = media(e.description).filter((id) => !media(input.description!).includes(id))
      if (dropped.length)
        return text(
          `Not updated: the new description drops ${dropped.length} of the issue's image(s). Keep their ![…](jira-media:…) lines from jira_fields; images can only be removed in Jira itself.`,
        )
    }
    const issue = await composeUpdate(cfg, key, {
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(issueTypeId ? { issueTypeId } : {}),
      values,
    })
    if (input.comment?.trim()) await addComment(cfg, key, input.comment)
    upsertJira(issue)
    const changed = [
      input.summary !== undefined && 'summary',
      input.description !== undefined && 'description',
      issueTypeId && 'type',
      ...Object.keys(values).map((k) => e.fields.find((f) => f.key === k)?.name ?? k),
      input.comment?.trim() && 'comment added',
    ].filter(Boolean)
    return text(`Updated ${issue.key} (${changed.join(', ') || 'nothing changed'}): ${issue.url}`)
  },
)

await server.connect(new StdioServerTransport())

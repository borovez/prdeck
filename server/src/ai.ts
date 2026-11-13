import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { AiConfig, JiraFieldMeta, JiraFieldOption, JiraFieldValue, JiraIssueTypeMeta } from '../../shared/types.ts'
import { claudeBin, claudeCodeJson } from './claudeCode.ts'

export function aiClient(cfg: AiConfig) {
  // Blank key → SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
  return cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : new Anthropic()
}

/** Credentials the server process has of its own (used when no key is stored) */
export const envCredentials = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)

/** Whether drafting can work with this config (for the UI) */
export const aiAvailable = (cfg: AiConfig) => (cfg.provider === 'claude-code' ? !!claudeBin() : !!cfg.apiKey || envCredentials())

/** API: checks key and model with a model lookup (no tokens). Claude Code: a tiny structured call. */
export async function testAi(cfg: AiConfig) {
  if (cfg.provider === 'claude-code') {
    const r = await claudeCodeJson<{ ok: boolean }>({
      system: 'Reply with the requested JSON only.',
      prompt: 'Return ok: true.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      model: cfg.model,
      timeoutMs: 60_000,
    })
    return { model: r.model, source: 'claude-code' }
  }
  try {
    const m = await aiClient(cfg).models.retrieve(cfg.model)
    return { model: m.display_name, source: cfg.apiKey ? 'key' : 'environment' }
  } catch (e) {
    if (!cfg.apiKey && !envCredentials())
      throw new Error('No API key. Paste one from console.anthropic.com, or start the server with ANTHROPIC_API_KEY set.')
    throw e
  }
}

// ---------- Composer: Claude writes or reworks the issue ----------

const ISSUE_SYSTEM = `You write Jira issues for a software team, in the composer of a dashboard.
Write for an engineer who hasn't seen the source material: the problem or request, the context that matters
(systems, customers, error messages and links quoted verbatim), and concrete acceptance criteria.
Use only facts from the request and the context given; where something needed is unknown, list it under
"## Open questions" instead of guessing. No filler, no restating the summary.
Follow the team's writing guide when one is given (sections, naming, tone); the project's own guide wins over a
repo's CLAUDE.md where they differ. When the request asks to change the current draft, keep what it doesn't
mention (and when editing an existing issue, keep fields as they are unless the request is about them).
Keep image lines (![…](…)) exactly as they are: they are the issue's attachments.
Fields: when writing a new issue, suggest a value for every listed field - the person reviews your picks. Use the
listed options exactly. Priority from impact and urgency; story points as an estimate on 1, 2, 3, 5, 8, 13;
parent: the epic the work belongs to, if one fits; sprint: the active sprint unless the work is clearly for later;
labels: 1-3 short ones that help find the issue; required fields always. Use null only when a field truly doesn't
apply. Mention uncertain picks in the rationale.`

export interface IssueDraftInput {
  projectKey: string
  issueTypes: JiraIssueTypeMeta[]
  issueTypeId: string
  /** Fields Claude may set (shown as chips; users and sprints excluded) */
  fields: JiraFieldMeta[]
  /** Choices for search-based fields, e.g. open epics for parent */
  choices: Record<string, JiraFieldOption[]>
  prompt: string
  current: { summary: string; description: string; values: Record<string, JiraFieldValue> }
  guide: string | null
  claudeMd: { repo: string; text: string } | null
  pr: { id: string; title: string; branch: string; body: string; files: string[] } | null
  slack: { channel: string; permalink: string | null; thread: string } | null
  /** Screenshots and other images pasted into the composer */
  images: { name: string; type: string; data: string }[]
  /** Editing an existing issue: its key, latest comments and linked PRs */
  issue: { key: string; comments: { author: string; created: string; body: string }[]; prs: { id: string; title: string; body: string }[] } | null
}

/** Field → zod schema of what Claude may answer (labels, not ids) */
function fieldSchema(f: JiraFieldMeta, choices: JiraFieldOption[] | undefined): z.ZodType | null {
  const opts = f.options.length ? f.options : (choices ?? [])
  const labels = [...new Set(opts.map((o) => o.label))] as [string, ...string[]]
  switch (f.kind) {
    case 'option':
    case 'parent':
    case 'sprint':
      return opts.length ? z.enum(labels).nullable() : null
    case 'options':
      return opts.length ? z.array(z.enum(labels)) : null
    case 'labels':
      return z.array(z.string()).describe('0-3 short labels, lowercase-with-dashes')
    case 'number':
      return z.number().nullable()
    case 'string':
    case 'text':
      return z.string().nullable()
    case 'date':
      return z.string().nullable().describe('YYYY-MM-DD')
    default:
      return null // users: you pick those
  }
}

export async function draftJiraIssue(cfg: AiConfig, input: IssueDraftInput, signal?: AbortSignal) {
  const writable = input.fields.map((f) => [f, fieldSchema(f, input.choices[f.key])] as const).filter(([, s]) => s)
  const typeNames = [...new Set(input.issueTypes.map((t) => t.name))] as [string, ...string[]]
  const schema = z.object({
    summary: z.string().describe('Imperative Jira summary, max ~90 chars, no ticket prefix'),
    description: z.string().describe('Markdown body'),
    issueType: z.enum(typeNames),
    fields: z.object(Object.fromEntries(writable.map(([f, s]) => [f.key, s!.describe(f.name)]))),
    rationale: z.string().describe('One sentence: the choices you made, and anything the user should check'),
    changeSummary: z.string().describe(input.issue ? 'What you changed, as 1-4 short Markdown bullets (for a Jira comment)' : 'Empty string'),
  })
  type Raw = { summary: string; description: string; issueType: string; fields: Record<string, unknown>; rationale: string; changeSummary: string }

  const optionsOf = (f: JiraFieldMeta) => (f.options.length ? f.options : (input.choices[f.key] ?? []))
  const describeValue = (f: JiraFieldMeta, v: JiraFieldValue | undefined) => {
    if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === '') return 'not set'
    const list = Array.isArray(v) ? v : [String(v)]
    return list.map((x) => optionsOf(f).find((o) => o.id === x)?.label ?? x).join(', ')
  }
  const currentType = input.issueTypes.find((t) => t.id === input.issueTypeId)?.name ?? ''
  const hasDraft = input.current.summary.trim() || input.current.description.trim()

  const prompt = [
    `Jira project: ${input.projectKey}`,
    input.guide ? `<project_writing_guide>\n${input.guide}\n</project_writing_guide>` : '',
    input.claudeMd ? `<repo_claude_md repo="${input.claudeMd.repo}">\n${input.claudeMd.text}\n</repo_claude_md>` : '',
    `<fields>\n${writable
      .map(([f]) => `- ${f.name}${f.required ? ' (required)' : ''}${optionsOf(f).length ? `: ${optionsOf(f).map((o) => (o.detail ? `${o.label} [${o.detail}]` : o.label)).join(' | ')}` : ''}`)
      .join('\n')}\n</fields>`,
    input.pr
      ? `<pull_request id="${input.pr.id}" branch="${input.pr.branch}">\nTitle: ${input.pr.title}\n\n${input.pr.body.slice(0, 6000)}\n\nChanged files:\n${input.pr.files.slice(0, 60).join('\n')}\n</pull_request>`
      : '',
    input.images.length ? `${input.images.length} image(s) are attached above (${input.images.map((i) => i.name).join(', ')}): use what they show.` : '',
    input.issue
      ? `<existing_issue key="${input.issue.key}">\nYou are editing this issue: change only what the request asks; keep every other part of the summary, description and fields exactly as it is.\n${
          input.issue.comments.length
            ? `\n<latest_comments>\n${input.issue.comments.map((c) => `${c.author} (${c.created.slice(0, 10)}):\n${c.body.slice(0, 2000)}`).join('\n\n')}\n</latest_comments>`
            : ''
        }${input.issue.prs.length ? `\n<linked_pull_requests>\n${input.issue.prs.map((p) => `${p.id}: ${p.title}\n${p.body.slice(0, 1500)}`).join('\n\n')}\n</linked_pull_requests>` : ''}\n</existing_issue>`
      : '',
    input.slack ? `<slack_conversation channel="${input.slack.channel}">\n${input.slack.thread}\n</slack_conversation>` : '',
    hasDraft
      ? `<current_draft type="${currentType}">\nSummary: ${input.current.summary}\n\n${input.current.description}\n\n${writable
          .map(([f]) => `${f.name}: ${describeValue(f, input.current.values[f.key])}`)
          .join('\n')}\n</current_draft>`
      : '',
    `<request>\n${input.prompt.trim() || (hasDraft ? 'Improve the current draft.' : 'Write the issue from the context above.')}\n</request>`,
  ]
    .filter(Boolean)
    .join('\n\n')

  let raw: Raw
  if (cfg.provider === 'claude-code') {
    const { data } = await claudeCodeJson<Raw>({ system: ISSUE_SYSTEM, prompt, schema: z.toJSONSchema(schema), model: cfg.model || 'claude-opus-5-5', signal, images: input.images })
    raw = schema.parse(data) as Raw
  } else {
    const response = await aiClient(cfg).beta.messages.parse({
      model: cfg.model || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      system: ISSUE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...input.images.map((i) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: i.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: i.data },
            })),
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    }, { signal })
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to draft this issue')
    if (!response.parsed_output) throw new Error(`Claude returned no draft (stop_reason: ${response.stop_reason})`)
    raw = response.parsed_output as Raw
  }

  // Labels back to ids
  const values: Record<string, JiraFieldValue> = {}
  const labels: Record<string, Record<string, JiraFieldOption>> = {}
  for (const [f] of writable) {
    const v = raw.fields[f.key]
    if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === '') continue
    const byLabel = (l: string) => optionsOf(f).find((o) => o.label === l)
    if (f.kind === 'option' || f.kind === 'parent' || f.kind === 'sprint') {
      const o = byLabel(String(v))
      if (!o) continue
      values[f.key] = o.id
      if (f.kind !== 'option') labels[f.key] = { [o.id]: o }
    } else if (f.kind === 'options') values[f.key] = (v as string[]).map((l) => byLabel(l)?.id).filter((x): x is string => !!x)
    else if (f.kind === 'labels') values[f.key] = (v as string[]).map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean)
    else if (f.kind === 'number') values[f.key] = Number(v)
    else values[f.key] = String(v)
  }
  const type = input.issueTypes.find((t) => t.name === raw.issueType)
  return {
    summary: raw.summary,
    description: raw.description,
    issueTypeId: type?.id ?? input.issueTypeId,
    values,
    labels,
    rationale: raw.rationale,
    changeSummary: input.issue ? raw.changeSummary : '',
  }
}

// ---------- PR writer: title and description of an existing PR ----------

const PR_SYSTEM = `You write pull request titles and descriptions for a software team.
Follow the repo's pull request template (keep its sections and order; drop only comment-only hints) and the
rules in its CLAUDE.md (title format, Jira section, dependency and feature-flag lines, deployment steps).
Describe what the change does and why, from the diff, commits and linked issues; be specific (endpoints,
tables, components), no filler. Never invent facts: where the template asks for something the material doesn't
show (how it was tested, deployment specifics), write a short TODO for the author instead of guessing.
Keep these from the current description exactly as they are: dependency lines (Depends on / Requires release of /
Blocks / Release blocks), feature flag lines, ticked checklist items, images and links. When the request asks for a
specific change, change only that and keep the rest.`

export interface PrDraftInput {
  pr: { id: string; title: string; base: string; head: string; author: string }
  prompt: string
  current: { title: string; body: string }
  claudeMd: string | null
  template: { path: string; text: string } | null
  files: { filename: string; status: string; additions: number; deletions: number; patch: string | null }[]
  commits: string[]
  jira: { key: string; summary: string; status: string; url: string; description: string }[]
  facts: string[]
  images: { name: string; type: string; data: string }[]
}

export async function draftPrText(cfg: AiConfig, input: PrDraftInput, signal?: AbortSignal) {
  const schema = z.object({
    title: z.string().describe('PR title, following the repo conventions'),
    body: z.string().describe('The full PR description in GitHub Markdown'),
    rationale: z.string().describe('One sentence: what you changed and anything the author should fill in or check'),
  })
  // Diff within a budget: every file listed, patches until ~40k characters
  let budget = 40_000
  const diff = input.files
    .map((f) => {
      const headLine = `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`
      if (!f.patch || budget <= 0) return headLine
      const patch = f.patch.slice(0, Math.min(budget, 6000))
      budget -= patch.length
      return `${headLine}\n\`\`\`diff\n${patch}${patch.length < f.patch.length ? '\n… (cut)' : ''}\n\`\`\``
    })
    .join('\n\n')
  const prompt = [
    `Pull request ${input.pr.id} by ${input.pr.author}: ${input.pr.head} → ${input.pr.base}`,
    input.claudeMd ? `<repo_claude_md>\n${input.claudeMd}\n</repo_claude_md>` : '',
    input.template ? `<pull_request_template path="${input.template.path}">\n${input.template.text}\n</pull_request_template>` : '',
    input.jira.length
      ? `<jira_issues>\n${input.jira.map((j) => `${j.key} [${j.status}] ${j.summary} (${j.url})\n${j.description.slice(0, 2000)}`).join('\n\n')}\n</jira_issues>`
      : '',
    input.facts.length ? `<known_from_pr_deck>\n${input.facts.join('\n')}\n</known_from_pr_deck>` : '',
    input.commits.length ? `<commits>\n${input.commits.slice(0, 60).map((c) => `- ${c.slice(0, 500)}`).join('\n')}\n</commits>` : '',
    `<diff>\n${diff}\n</diff>`,
    input.images.length ? `${input.images.length} image(s) are attached above: use what they show.` : '',
    `<current_title>\n${input.current.title}\n</current_title>`,
    `<current_description>\n${input.current.body || '(empty)'}\n</current_description>`,
    `<request>\n${input.prompt.trim()}\n</request>`,
  ]
    .filter(Boolean)
    .join('\n\n')

  type Raw = { title: string; body: string; rationale: string }
  if (cfg.provider === 'claude-code') {
    const { data } = await claudeCodeJson<Raw>({ system: PR_SYSTEM, prompt, schema: z.toJSONSchema(schema), model: cfg.model || 'claude-opus-5-5', signal, images: input.images })
    return schema.parse(data) as Raw
  }
  const response = await aiClient(cfg).beta.messages.parse(
    {
      model: cfg.model || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      system: PR_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            ...input.images.map((i) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: i.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: i.data },
            })),
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    },
    { signal },
  )
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to write this description')
  if (!response.parsed_output) throw new Error(`Claude returned no description (stop_reason: ${response.stop_reason})`)
  return response.parsed_output as Raw
}

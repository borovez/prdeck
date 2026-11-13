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
mention. Field values must be one of the listed options; use null for a field you have no grounds to set.`

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
}

/** Field → zod schema of what Claude may answer (labels, not ids) */
function fieldSchema(f: JiraFieldMeta, choices: JiraFieldOption[] | undefined): z.ZodType | null {
  const opts = f.options.length ? f.options : (choices ?? [])
  const labels = [...new Set(opts.map((o) => o.label))] as [string, ...string[]]
  switch (f.kind) {
    case 'option':
    case 'parent':
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
      return null // users, sprints: you pick those
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
  })
  type Raw = { summary: string; description: string; issueType: string; fields: Record<string, unknown>; rationale: string }

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
      .map(([f]) => `- ${f.name}${f.required ? ' (required)' : ''}${optionsOf(f).length ? `: ${optionsOf(f).map((o) => o.label).join(' | ')}` : ''}`)
      .join('\n')}\n</fields>`,
    input.pr
      ? `<pull_request id="${input.pr.id}" branch="${input.pr.branch}">\nTitle: ${input.pr.title}\n\n${input.pr.body.slice(0, 6000)}\n\nChanged files:\n${input.pr.files.slice(0, 60).join('\n')}\n</pull_request>`
      : '',
    input.images.length ? `${input.images.length} image(s) are attached above (${input.images.map((i) => i.name).join(', ')}): use what they show.` : '',
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
    if (f.kind === 'option' || f.kind === 'parent') {
      const o = byLabel(String(v))
      if (!o) continue
      values[f.key] = o.id
      if (f.kind === 'parent') labels[f.key] = { [o.id]: o }
    } else if (f.kind === 'options') values[f.key] = (v as string[]).map((l) => byLabel(l)?.id).filter((x): x is string => !!x)
    else if (f.kind === 'labels') values[f.key] = (v as string[]).map((l) => l.trim().replace(/\s+/g, '-')).filter(Boolean)
    else if (f.kind === 'number') values[f.key] = Number(v)
    else values[f.key] = String(v)
  }
  const type = input.issueTypes.find((t) => t.name === raw.issueType)
  return { summary: raw.summary, description: raw.description, issueTypeId: type?.id ?? input.issueTypeId, values, labels, rationale: raw.rationale }
}

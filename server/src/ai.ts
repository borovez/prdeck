import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { AiConfig, JiraDraft, JiraRequiredField, SlackItem } from '../../shared/types.ts'
import { claudeBin, claudeCodeJson } from './claudeCode.ts'

const DraftSchema = z.object({
  summary: z.string().describe('Imperative Jira summary, max ~90 chars, no ticket prefix'),
  description: z
    .string()
    .describe('Markdown body: ## Context, ## Problem / Request, ## Acceptance criteria (bullets), ## Notes. Facts only from the conversation.'),
  issueType: z.enum(['Task', 'Bug', 'Story', 'Improvement']),
  labels: z.array(z.string()).describe('0-3 short lowercase labels, only when clearly useful'),
  rationale: z.string().describe('One sentence: why this issue type, and anything ambiguous the user should check'),
})

const SYSTEM = `You turn Slack conversations into well-formed Jira issues for a software team.
Write for an engineer who has not seen the Slack thread: state the problem or request, the relevant context
(systems, customers, error messages, links quoted verbatim), and concrete acceptance criteria.
Use only facts present in the conversation or the user's extra context. Where something needed is unknown,
list it under "## Open questions" instead of guessing. Keep it tight - no filler, no restating the summary.`

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

/** The draft schema, plus one property per required Jira field (selects as an enum of option labels). */
function draftSchema(required: JiraRequiredField[]) {
  if (!required.length) return DraftSchema
  const shape = Object.fromEntries(
    required.map((f) => [
      f.key,
      f.options.length ? z.enum(f.options.map((o) => o.label) as [string, ...string[]]).describe(f.name) : z.string().describe(f.name),
    ]),
  )
  return DraftSchema.extend({
    fields: z.object(shape).describe("Fields this Jira project requires. Pick the option that best fits the issue; mention a close call in the rationale."),
  })
}

export async function draftJiraFromSlack(
  cfg: AiConfig,
  item: SlackItem,
  thread: string,
  extraContext: string,
  projectKey: string,
  required: JiraRequiredField[] = [],
): Promise<JiraDraft> {
  const schema = draftSchema(required)
  const prompt = [
    `Jira project: ${projectKey || '(unspecified)'}`,
    `Slack source: ${item.channelName}${item.permalink ? ` - ${item.permalink}` : ''}`,
    `<slack_conversation>\n${thread}\n</slack_conversation>`,
    extraContext.trim() ? `<extra_context_from_me>\n${extraContext.trim()}\n</extra_context_from_me>` : '',
    'Draft the Jira issue for the starred message (use the rest of the conversation as context).',
  ]
    .filter(Boolean)
    .join('\n\n')

  const source = item.permalink ? `\n\n---\nSource: [Slack message from ${item.userName}](${item.permalink})` : ''
  type Raw = z.infer<typeof DraftSchema> & { fields?: Record<string, string> }
  /** Option labels back to Jira option ids */
  const finish = ({ fields, ...d }: Raw): JiraDraft => ({
    ...d,
    description: d.description + source,
    fields: fields
      ? Object.fromEntries(
          required.map((f) => [f.key, f.options.length ? (f.options.find((o) => o.label === fields[f.key])?.id ?? '') : (fields[f.key] ?? '')]),
        )
      : undefined,
  })

  if (cfg.provider === 'claude-code') {
    const { data } = await claudeCodeJson<Raw>({
      system: SYSTEM,
      prompt,
      schema: z.toJSONSchema(schema),
      model: cfg.model || 'claude-opus-5-5',
    })
    return finish(schema.parse(data) as Raw)
  }

  const client = aiClient(cfg)
  const response = await client.beta.messages.parse({
    model: cfg.model || 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to draft this issue')
  if (!response.parsed_output) throw new Error(`Claude returned no draft (stop_reason: ${response.stop_reason})`)
  return finish(response.parsed_output as Raw)
}

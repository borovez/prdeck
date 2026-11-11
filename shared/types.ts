// Contract shared by the API server, the MCP server and the Vue app.

/** Stable PR id: "owner/repo#123" */
export type PrId = string

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED'

/** Why a PR is in the cache. A PR can have several. */
export type Relation =
  | 'authored' // I opened it
  | 'review_requested' // my review is requested
  | 'reviewed' // I reviewed it (still open)
  | 'assigned' // assigned to me
  | 'tracked' // open PR in a repo I track (team view)
  | 'dependency' // pulled in only because something depends on it

/** merge = prerequisite must be merged. release = prerequisite must be merged AND shipped. */
export type DependencyKind = 'merge' | 'release'

/** manual = added in the UI/MCP, body = parsed from PR description, jira = inferred from Jira "blocks" links */
export type DependencySource = 'manual' | 'body' | 'jira'

export type ActionKind =
  | 'review' // someone needs my review
  | 'address_feedback' // changes requested on my PR
  | 'resolve_conflicts'
  | 'fix_ci'
  | 'finish_draft'
  | 'merge' // approved, green, unblocked
  | 'release' // merged, others wait on its release
  | 'wait_review'
  | 'wait_deps'
  | 'awaiting_release' // my PR merged, not shipped yet
  | 'none'
  | 'done'

export type Bucket = 'action' | 'waiting' | 'blocked' | 'watching' | 'done'

export type CheckState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | 'NONE'

export interface UserRef {
  login: string
  avatarUrl?: string
}

/** Raw PR snapshot as synced from GitHub. */
export interface PrRecord {
  id: PrId
  nodeId: string
  owner: string
  repo: string // "owner/name"
  number: number
  title: string
  url: string
  state: PrState
  isDraft: boolean
  body: string
  author: UserRef
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
  headRef: string
  baseRef: string
  defaultBranch: string | null
  mergeCommitSha: string | null
  additions: number
  deletions: number
  changedFiles: number
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  labels: { name: string; color: string }[]
  assignees: UserRef[]
  requestedReviewers: { login: string; avatarUrl?: string; isTeam: boolean }[]
  reviews: { login: string; avatarUrl?: string; state: string; submittedAt: string | null }[]
  comments: number
  unresolvedThreads: number
  /** Unresolved review conversations (details), newest activity last */
  threads: ReviewThread[]
  checks: { state: CheckState; total: number; failing: { name: string; url: string | null }[] }
  /** Which configured GitHub account saw this PR */
  accountId: string
}

export interface ReviewThread {
  /** Link to the first comment */
  url: string
  path: string
  line: number | null
  /** The code changed since; GitHub shows it collapsed */
  outdated: boolean
  author: UserRef
  /** First comment, plain text, trimmed */
  body: string
  createdAt: string
  /** Total comments in the thread */
  comments: number
  lastAuthor: string | null
  lastAt: string | null
}

export interface ReleaseInfo {
  released: boolean
  /** Ref the merge commit was checked against (tag name or branch) */
  ref: string | null
  checkedAt: string
  error?: string
}

export interface DepEdge {
  /** Only manual edges have an id (and can be deleted) */
  id: number | null
  from: PrId // the dependent PR (waits)
  to: PrId // the prerequisite PR
  kind: DependencyKind
  source: DependencySource
  note: string | null
  satisfied: boolean
  /** Prerequisite isn't in the cache (yet) */
  missing: boolean
}

export interface JiraLink {
  type: string
  direction: 'inward' | 'outward'
  label: string // "is blocked by", "blocks", "relates to"
  key: string
  summary: string
  status: string
  statusCategory: string
}

export interface JiraIssue {
  key: string
  url: string
  summary: string
  status: string
  statusCategory: 'new' | 'indeterminate' | 'done' | string
  type: string
  typeIconUrl: string | null
  priority: string | null
  priorityIconUrl: string | null
  assignee: { displayName: string; accountId: string; avatarUrl: string | null } | null
  parent: { key: string; summary: string } | null
  fixVersions: string[]
  labels: string[]
  updated: string
  links: JiraLink[]
  /** Assigned to me (came from my JQL) */
  isMine: boolean
}

export interface PrView extends Omit<PrRecord, 'body'> {
  relations: Relation[]
  isMine: boolean
  jiraKeys: string[]
  release: ReleaseInfo | null
  dependsOn: DepEdge[]
  dependents: DepEdge[]
  blocked: boolean
  action: { kind: ActionKind; label: string; detail?: string }
  bucket: Bucket
  note: string | null
  pinned: boolean
  approvals: string[]
  changesRequestedBy: string[]
}

export interface JiraIssueView extends JiraIssue {
  prs: PrId[]
}

/** Connected component of the dependency graph, topologically ordered (prerequisites first). */
export interface DependencyChain {
  id: string
  prs: PrId[]
  repos: string[]
  /** First PR in the chain that is not done yet */
  nextStep: PrId | null
  done: boolean
}

export interface Overview {
  me: string[]
  prs: PrView[]
  edges: DepEdge[]
  chains: DependencyChain[]
  jira: JiraIssueView[]
  slack: SlackItem[]
  stats: Record<Bucket, number> & {
    reviewRequests: number
    mine: number
    slackNew: number
    /** Unresolved review conversations on my open PRs, and how many PRs have any */
    myThreads: number
    myThreadPrs: number
  }
  sync: SyncState
  configured: { github: boolean; jira: boolean; slack: boolean; ai: boolean }
  autoSync: { enabled: boolean; intervalMinutes: number }
  jiraBaseUrl: string | null
}

export interface SyncState {
  running: boolean
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  errors: string[]
  counts: { prs: number; jira: number; slack: number } | null
}

// ---------- Slack ----------

/** saved = Slack "Save for later" / bookmarked; todo = I reacted with one of my todo emojis */
export type SlackKind = 'mention' | 'dm' | 'group' | 'saved' | 'todo'
export type SlackStatus = 'new' | 'done' | 'dismissed'

export interface SlackItem {
  id: string // "<channel>:<ts>"
  channelId: string
  channelName: string // "#general", "DM", or member names for group DMs
  kind: SlackKind
  ts: string
  threadTs: string | null
  user: string
  userName: string
  userAvatar: string | null
  text: string // rendered (mentions/links resolved)
  permalink: string | null
  postedAt: string
  /** In a DM/group: nobody (me) has replied after this message */
  awaitingReply: boolean
  status: SlackStatus
  jiraKey: string | null
}

/** A field Jira requires when creating an issue of a given project + type (beyond summary, description etc.) */
export interface JiraRequiredField {
  key: string // e.g. customfield_12345
  name: string
  /** Select options; empty for free-text fields */
  options: { id: string; label: string }[]
  /** Multi-select: the value is a list */
  multiple: boolean
}

/** A message shown around a Slack inbox item (side panel) */
export interface SlackMessage {
  ts: string
  user: string
  userName: string
  userAvatar: string | null
  text: string
  postedAt: string
  /** The inbox item itself */
  isTarget: boolean
}

export interface JiraDraft {
  summary: string
  description: string // markdown
  issueType: 'Task' | 'Bug' | 'Story' | 'Improvement'
  labels: string[]
  rationale: string
  /** Claude's picks for the project's required fields: option id (selects) or text, by field key */
  fields?: Record<string, string>
}

// ---------- Settings ----------

export interface GithubAccount {
  id: string
  label: string
  /** Never sent to the browser; replaced with "" + hasToken */
  token: string
  hasToken?: boolean
  login: string | null
  /** Restrict searches to these orgs/users. Empty = everything the token sees. */
  orgs: string[]
  source: 'pat' | 'gh-cli'
}

export interface JiraConfig {
  baseUrl: string // https://acme.atlassian.net
  email: string
  apiToken: string
  hasToken?: boolean
  /** Only treat KEY-123 strings with these project keys as Jira refs. Empty = any. */
  projectKeys: string[]
  /** JQL for "my tasks" */
  myJql: string
  /** Defaults for issues created from Slack */
  create: {
    projectKey: string
    issueType: string
    /** Extra fields JSON merged into the create payload, e.g. {"customfield_12345":{"id":"10001"}} */
    extraFieldsJson: string
    assignToMe: boolean
  }
}

export interface SlackConfig {
  /** User token (xoxp-…) */
  token: string
  hasToken?: boolean
  userId: string | null
  teamUrl: string | null
  lookbackDays: number
  /** Max DM / group conversations scanned per sync */
  maxConversations: number
  /** Include messages I saved / bookmarked ("Later") – needs stars:read */
  includeSaved: boolean
  /** Messages I reacted to with any of these emoji names count as todos – needs reactions:read */
  todoReactions: string[]
}

/** api = Anthropic API key; claude-code = the local `claude` CLI and its login (e.g. a company Claude seat) */
export type AiProvider = 'api' | 'claude-code'

export interface AiConfig {
  provider: AiProvider
  /** Anthropic API key. Blank = use ANTHROPIC_API_KEY / `ant auth login` profile. */
  apiKey: string
  hasKey?: boolean
  model: string
}

export interface Settings {
  github: { accounts: GithubAccount[] }
  /** Repos whose every open PR is pulled in (team view), "owner/name" */
  trackedRepos: string[]
  jira: JiraConfig | null
  slack: SlackConfig | null
  ai: AiConfig
  /** auto: the server syncs in the background every intervalMinutes */
  sync: { auto: boolean; intervalMinutes: number; mergedLookbackDays: number }
  /**
   * How "released" is decided per repo. Default: the latest GitHub release / tag
   * contains the merge commit. Override with a branch name (e.g. "master") when
   * a release means "promoted to that branch".
   */
  releaseRefs: Record<string, string>
  defaultReleaseRef: string // "latest-release" | branch name
}

export const DEFAULT_SETTINGS: Settings = {
  github: { accounts: [] },
  trackedRepos: [],
  jira: null,
  slack: null,
  ai: { provider: 'claude-code', apiKey: '', model: 'claude-opus-5-5' },
  sync: { auto: true, intervalMinutes: 5, mergedLookbackDays: 14 },
  releaseRefs: {},
  defaultReleaseRef: 'latest-release',
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  review: 'Review requested',
  address_feedback: 'Address feedback',
  resolve_conflicts: 'Resolve conflicts',
  fix_ci: 'Fix CI',
  finish_draft: 'Finish draft',
  merge: 'Ready to merge',
  release: 'Release needed',
  wait_review: 'Waiting for review',
  wait_deps: 'Blocked by dependency',
  awaiting_release: 'Merged, awaiting release',
  none: 'Watching',
  done: 'Done',
}

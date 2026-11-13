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
  | 'backmerge' // my hotfix is merged but not back in the integration branch
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

/** Loaded on demand for the PR panel's Description and Files tabs */
export interface PrDetail {
  /** GitHub's rendered description (sanitize before display) */
  bodyHTML: string
  files: PrFile[]
  /** More files than were loaded */
  filesTruncated: boolean
}
export interface PrFile {
  filename: string
  previousFilename: string | null
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  /** Unified diff; null for binary or too-large files */
  patch: string | null
  /** The patch was cut to its first lines */
  patchTruncated: boolean
  url: string
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
  /** How the repo releases: a GitHub release/tag, or a branch it gets merged into (set on the overview) */
  via?: 'release' | 'branch'
  /** Ref the merge commit was checked against (tag name or branch) */
  ref: string | null
  checkedAt: string
  error?: string
}

/**
 * Where a PR sits in a repo's release flow (repos with an integration branch such as dev):
 * release = promotes to the release branch (dev → master, release/* → master),
 * hotfix = goes straight to the release branch, backmerge = brings the release branch back into dev.
 */
export type PrFlow = 'release' | 'hotfix' | 'backmerge'

/** A PR shipped by a release PR */
export interface ReleaseItem {
  id: PrId
  title: string
  url: string
  author: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  mergedAt: string | null
  /** How it was found: a commit of the release, a cherry-pick trailer, or a reference in its description */
  via: 'commit' | 'cherry-pick' | 'description'
}

/** What a release PR contains. Cached per release PR and recomputed when the PR changes. */
export interface ReleaseContents {
  prId: PrId
  /** The release PR's updatedAt it was computed for */
  forUpdatedAt: string
  items: ReleaseItem[]
  jiraKeys: string[]
  commitsScanned: number
  /** More commits than were scanned */
  truncated: boolean
  fetchedAt: string
  error?: string
}

/** What a tag shipped: the PRs between the previous tag and this one. prId is "<repo>@<tag>". */
export interface TagRelease extends ReleaseContents {
  repo: string
  tag: string
  previous: string | null
  /** Commit date of the tag */
  date: string | null
  url: string
}

/**
 * Releases in different repos that belong together: a PR in one depends on a PR in another (order),
 * or they ship the same Jira issues (jira).
 */
export interface ReleaseTrain {
  id: string
  /** Suggested shipping order: prerequisites first; releases with no known order keep a stable order */
  releases: PrId[]
  /** order: `from` ships before `to`; jira: shared issues, no order implied */
  links: { from: PrId; to: PrId; kind: 'order' | 'jira'; reasons: string[] }[]
  /** Jira issues shipped by more than one release of the train */
  jiraKeys: string[]
  /** First open release whose prerequisites are all merged */
  next: PrId | null
  /** Some releases wait on each other in a circle; the order is a best effort */
  cycle: boolean
}

/** Has a merged hotfix made it back into the integration branch? */
export interface BackmergeInfo {
  backmerged: boolean
  /** Integration branch checked, e.g. dev */
  into: string
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
  /** Epic or parent issue; status and type when Jira includes them */
  parent: { key: string; summary: string; status?: string; statusCategory?: string; type?: string } | null
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
  flow: PrFlow | null
  /** Release PRs that contain this PR (open ones first) */
  shipsIn: { id: PrId; state: 'OPEN' | 'MERGED' | 'CLOSED' }[]
  /** Hotfixes: whether the merge reached the integration branch, and an open backmerge PR if there is one */
  backmerge: BackmergeInfo | null
  backmergePr: PrId | null
  /** Feature flag keys from the description ("Feature flag: key" lines, LaunchDarkly links) */
  flags: string[]
  /** The tag that shipped this PR (tag-based repos) */
  releasedIn: { tag: string; url: string } | null
}

/** Loaded on demand for the Jira side panel. Rich text stays in Jira's document format (ADF). */
export interface JiraIssueDetail {
  key: string
  description: import('./adf.ts').AdfDoc | null
  comments: { id: string; author: string; avatarUrl: string | null; created: string; body: import('./adf.ts').AdfDoc }[]
  /** Total comments on the issue (only the latest are included) */
  commentTotal: number
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
  /** Contents of release PRs (see PrView.flow) */
  releases: ReleaseContents[]
  /** Releases across repos that ship together */
  trains: ReleaseTrain[]
  /** LaunchDarkly state of the flags PRs mention */
  flags: FeatureFlag[]
  /** Latest tags of tag-based repos, newest first, with what each shipped */
  tags: TagRelease[]
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
  configured: { github: boolean; jira: boolean; slack: boolean; ai: boolean; launchdarkly: boolean }
  autoSync: { enabled: boolean; intervalMinutes: number }
  /** Where added dependencies are written (Settings → Dependencies) */
  dependencyWrites: { description: boolean; bothSides: boolean }
  jiraBaseUrl: string | null
}

export interface SyncState {
  running: boolean
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  errors: string[]
  counts: { prs: number; jira: number; slack: number } | null
  /** Each stage of the current (or last) sync, in run order */
  steps?: SyncStep[]
}

export type SyncStepStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped'

export interface SyncStep {
  id: string
  label: string
  status: SyncStepStatus
  startedAt?: string
  finishedAt?: string
  /** Short result ("42 PRs") or the reason it was skipped or failed */
  detail?: string
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
  text: string // plain text (mentions/links resolved), for search and drafting
  /** Slack mrkdwn with user mentions named (<@U1|Name>), for formatted display */
  rich?: string
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
  /** Slack mrkdwn with user mentions named, for formatted display */
  rich: string
  postedAt: string
  /** The inbox item itself */
  isTarget: boolean
}

/** Messages around a Slack inbox item, and whether the conversation goes on either side */
export interface SlackContext {
  messages: SlackMessage[]
  hasBefore: boolean
  hasAfter: boolean
}

// ---------- Repo catalog (Settings → tracked repos) ----------

export interface RepoCatalogEntry {
  nameWithOwner: string
  owner: string
  ownerAvatarUrl: string | null
  pushedAt: string
  isPrivate: boolean
  description: string | null
}

/** Every repo the GitHub accounts can see, across their orgs; cached on the server for an hour */
export interface RepoCatalog {
  repos: RepoCatalogEntry[]
  fetchedAt: string | null
  /** Orgs or accounts that couldn't be listed (e.g. SSO not authorised) */
  errors: string[]
}

// ---------- Jira issue composer (create and edit) ----------

/**
 * How the composer edits a field, from Jira's create / edit metadata (schema type, system, custom):
 * option(s) for selects, priority, components and versions; user for assignee; labels; parent;
 * sprint (Jira Software); number (story points); string / text (rich text, sent as ADF); date.
 */
export type JiraFieldKind = 'option' | 'options' | 'user' | 'users' | 'labels' | 'parent' | 'sprint' | 'number' | 'string' | 'text' | 'date'

export interface JiraFieldOption {
  id: string
  label: string
  iconUrl?: string | null
  /** Muted second line (an epic's status, a sprint's state) */
  detail?: string
}

export interface JiraFieldMeta {
  key: string // "priority", "customfield_10016"
  name: string
  kind: JiraFieldKind
  required: boolean
  /** Fixed choices; empty for fields searched on the fly (users, parent, sprint, labels) */
  options: JiraFieldOption[]
  /** Jira's custom type, e.g. "…:float", "…:gh-sprint", "jsw-story-points" (to recognise story points, sprint) */
  custom?: string
  /** Jira's schema type ("datetime" vs "date", "version"…), used when writing the value */
  schemaType?: string
}

export interface JiraIssueTypeMeta {
  id: string
  name: string
  iconUrl: string | null
  subtask: boolean
}

export interface JiraProjectMeta {
  key: string
  name: string
  avatarUrl: string | null
}

/** Create metadata for one project and issue type */
export interface JiraCreateMeta {
  project: JiraProjectMeta
  issueTypes: JiraIssueTypeMeta[]
  issueTypeId: string
  fields: JiraFieldMeta[]
  /** Starting values from Settings → Jira (assign to me, default fields) */
  defaults: Record<string, JiraFieldValue>
  /** Labels for the defaults (me as assignee) */
  labels: JiraValueLabels
}

/**
 * A field value in the composer: option id(s), account id(s), labels, a parent key, a sprint id,
 * a number, text (Markdown for rich text) or a date (YYYY-MM-DD). null clears it.
 */
export type JiraFieldValue = string | string[] | number | null

/** Labels for values that aren't in a field's options (users, parent, sprint), by field key then value */
export type JiraValueLabels = Record<string, Record<string, JiraFieldOption>>

/** An issue opened for editing */
export interface JiraEditable {
  key: string
  url: string
  project: JiraProjectMeta
  issueTypeId: string
  issueTypes: JiraIssueTypeMeta[]
  summary: string
  /** Markdown converted from the issue's ADF description (only sent back if changed) */
  description: string
  fields: JiraFieldMeta[]
  values: Record<string, JiraFieldValue>
  labels: JiraValueLabels
}

/** Ask Claude to write (or rework) the issue in the composer */
export interface JiraDraftRequest {
  projectKey: string
  issueTypeId: string
  /** Fields shown as chips: Claude only fills these */
  fieldKeys: string[]
  /** What you want, in your words */
  prompt: string
  /** What's in the composer now, so a prompt like "make it a bug" refines it */
  current: { summary: string; description: string; values: Record<string, JiraFieldValue> }
  context: { prId?: string | null; slackItemId?: string | null; repo?: string | null }
  /** Pasted or dropped images, for Claude to look at */
  images?: ImageAttachment[]
}

/** An image pasted or dropped into the composer: base64 without the data: prefix */
export interface ImageAttachment {
  name: string
  type: string
  data: string
}

export interface JiraAiDraft {
  summary: string
  description: string
  issueTypeId: string
  /** Only the fields Claude set (option ids, labels, a parent key, numbers, text, dates) */
  values: Record<string, JiraFieldValue>
  labels: JiraValueLabels
  rationale: string
  /** What Claude was given, shown under the bar */
  used: { guide: boolean; claudeMd: string | null; pr: string | null; slack: boolean }
}

export interface JiraWriteInput {
  projectKey: string
  issueTypeId: string
  summary: string
  /** Markdown */
  description: string
  values: Record<string, JiraFieldValue>
  /** Created from a Slack message: mark it done (and reply in its thread) */
  slackItemId?: string | null
  replyInThread?: boolean
  /** Uploaded to the issue as attachments */
  attachments?: ImageAttachment[]
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
    assignToMe: boolean
  }
  /** How each project writes issues (sections, acceptance criteria, naming), by project key; Claude follows it */
  guides?: Record<string, string>
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
  /** A todo I also reacted to with one of these counts as done (moves to the Done tab) */
  doneReactions: string[]
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

/** LaunchDarkly, read only: flag states for the flags PRs mention */
export interface LaunchDarklyConfig {
  /** API access token (a Reader role is enough); never sent to the browser */
  apiToken: string
  hasToken?: boolean
  baseUrl: string
  projectKey: string
  /** Environment keys to show, in this order (e.g. production, staging) */
  environments: string[]
}

/** A feature flag mentioned in a PR description, with its state per environment */
export interface FeatureFlag {
  key: string
  name: string
  url: string
  archived: boolean
  temporary: boolean
  envs: { key: string; on: boolean; lastModified: string | null }[]
  /** Not found in the project, or the request failed */
  error?: string
  fetchedAt: string
}

export interface Settings {
  github: { accounts: GithubAccount[] }
  /** Repos whose every open PR is pulled in (team view), "owner/name" */
  trackedRepos: string[]
  jira: JiraConfig | null
  slack: SlackConfig | null
  launchdarkly: LaunchDarklyConfig | null
  ai: AiConfig
  /** auto: the server syncs in the background every intervalMinutes */
  sync: { auto: boolean; intervalMinutes: number; mergedLookbackDays: number }
  /**
   * writeToDescription: adding/removing a dependency edits the dependent PR's description on GitHub
   * ("Depends on: B"); writeBothSides: also the prerequisite's ("Blocks: A")
   */
  dependencies: { writeToDescription: boolean; writeBothSides: boolean }
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
  launchdarkly: null,
  ai: { provider: 'claude-code', apiKey: '', model: 'claude-opus-5-5' },
  sync: { auto: true, intervalMinutes: 5, mergedLookbackDays: 14 },
  dependencies: { writeToDescription: true, writeBothSides: true },
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
  backmerge: 'Needs backmerge',
  none: 'Watching',
  done: 'Done',
}

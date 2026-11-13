# AI writing: Jira issues (create and update), then pull requests (update only)

Two separate features sharing one AI layer (`server/src/ai.ts`, whichever provider is configured:
Claude Code CLI or the API). Jira first; pull requests after.

Ground rule for both: **Claude drafts, you decide.** Nothing is written to Jira or GitHub until you
review the result and press Create / Save. Updates are shown as a diff, field by field.

## What exists today

- `ai.ts` `draftJiraFromSlack`: Slack thread + note → summary, Markdown description, type, labels,
  and the project's required fields (from Jira create metadata, as enums of option labels).
- `jira.ts`: `createIssue` (Markdown → ADF, settings defaults, per-issue fields), `requiredFields`,
  transitions, issue detail (description + comments).
- `SlackToJiraModal.vue`: the only way to create an issue. No way to edit an issue's fields.

---

## Part 1: Jira issues

### 1.1 Issue composer (no AI yet)

A Linear-style dialog, `JiraComposer.vue`, used for both **New issue** and **Edit issue**:

- Header: project chip (switchable) › "New issue" or the issue key; expand to full screen; close.
- Title, then a Markdown description (`MarkdownEditor`).
- Property chips row, each a small picker that shows its value once set:
  type, priority, assignee (default from settings: me), labels, parent / epic, sprint, story points,
  components, fix version, plus **the project's required custom fields**, read from metadata (create
  metadata for new issues, edit metadata for existing ones), so a project that needs a category gets a
  chip for it automatically.
- A **⋯ More** chip lists every other field the project's metadata allows (select, multi-select, number,
  text, date), so team-specific fields such as Urgency or Severity can be added without code. Fields you
  add are remembered per project. Story points, sprint and similar custom fields are found by name in the
  metadata (their `customfield_*` ids differ per site).
- Footer: "Create more" switch (keeps the dialog open and clears it), Create issue / Save.

Entry points:

- Header **New issue** button, shortcut `C`, and a Global search action.
- Jira page toolbar.
- Jira panel: **Edit** (opens the composer on the issue).
- PR panel: **Create Jira issue** (pre-filled from the PR), and link it to the PR's title afterwards (optional).
- Slack panel: replaces `SlackToJiraModal`; the Slack reply-in-thread option moves into the composer footer.

Server:

- `GET /jira/meta?project=&type=`: issue types, priorities, required and optional fields with options
  (createmeta), cached a few minutes.
- `GET /jira/:key/editmeta`: which fields this issue allows editing, with options.
- `GET /jira/users?project=&q=`: assignable users (`/user/assignable/search`).
- `GET /jira/labels?q=`, `GET /jira/epics?project=&q=` (JQL `issuetype = Epic`), `GET /jira/sprints?project=` (Agile API, open and future sprints).
- `POST /jira/create` (extended) and `PUT /jira/:key` (`/rest/api/3/issue/{key}`, only changed fields).
- After a write: refresh that issue in the cache so the Jira page and PR rows update without a full sync.

### 1.2 Drafting with Claude (create)

An **Ask Claude** bar at the top of the composer: "Describe the issue, paste notes, or a stack trace…".
Claude fills title, description and properties; you edit, then create.

Context Claude can use (shown as removable chips under the bar, so you see what's being sent):

- Your text.
- A Slack thread (opened from Slack), a PR (title, description, changed files, Jira keys), or an existing issue (e.g. "split this", "create the follow-up").
- The parent epic's summary and description, when one is picked.
- A **writing guide**: how this team writes issues (sections, acceptance criteria, naming), from two places:
  - Settings → Jira, a text per Jira project.
  - The related repo's `CLAUDE.md` (fetched from GitHub's default branch) when the issue comes from a PR
    or a repo is picked: the parts about Jira / issues / tickets, or the whole file when it's short.
  Both are sent when both exist; the Settings text wins on conflicts.

Output schema (built per request from metadata, so values are always valid): summary, Markdown description,
type, priority, labels, parent, required custom fields (enums of their option labels → ids), and a short
rationale shown under the bar. Assignee and sprint are suggested only, never auto-set.

### 1.3 Updating with Claude (edit)

In Edit mode the bar becomes "What should change?" ("add acceptance criteria", "rewrite from the
latest comments", "it's a bug, set priority high"). Claude gets the current issue (fields, description,
latest comments, linked PRs) and returns **only the fields it changes**, plus a rationale.

Claude may change **every editable field** (from edit metadata): summary, description, type, priority,
labels, parent, sprint, story points, components, fix version and custom fields.

The composer shows the proposal as a diff (description as a text diff, each property as old → new),
each change with its own checkbox; Save applies the ticked ones. Optional: post a comment summarising
the change.

### 1.4 MCP

Claude Code writes the text itself, so the tools give it what PR Deck knows and write safely:
`jira_fields` (fields, choices, current values and description, writing guides), `create_jira_issue` and
`update_jira_issue` (fields by name, choices by label; refuse with the choices when something doesn't match).

### Steps

1. ✅ Metadata endpoints and edit / create writes in `jira.ts` + routes.
2. ✅ `JiraComposer` (manual create and edit), ⋯ More fields, entry points, cache refresh.
3. ✅ Claude drafting for create (generalise `draftJiraFromSlack` into `draftIssue(context, meta)`), writing
   guides (Settings + repo CLAUDE.md), replace `SlackToJiraModal` (reply in thread and mark done move
   into the composer when it's opened from Slack).
4. ✅ Claude updates for edit, with the diff review.
5. ✅ MCP tools (`jira_fields`, `create_jira_issue`, `update_jira_issue`), CLAUDE.md, README.

---

## Part 2: Pull requests (update only, later)

PR Deck never opens PRs; it rewrites an existing PR's **title and description** with Claude:

- Context: the repo's `CLAUDE.md` and `.github/pull_request_template.md` (fetched from the PR's base
  branch through the GitHub API, also `docs/`-level templates if the repo has them), the diff
  (files and patches, trimmed to a budget), commits, linked Jira issues, dependencies and flags PR Deck knows about.
- Keeps what's already there: dependency lines (`Depends on:` / `Blocks:` …), feature flag lines, ticked
  checklist items and anything you mark as "keep".
- Review as a diff in the PR panel, then Save (PATCH title/body, the same path as dependency writes).
- Entry point: PR panel **Rewrite with Claude**, with an optional instruction ("shorter", "add deployment steps").

Details to plan when Part 1 is done.

---

## Decisions

- Chips: type, priority, assignee, labels, parent / epic, sprint, story points, components, fix version,
  required fields, and ⋯ More for any other field (Urgency, Severity, …).
- Writing guide: both Settings (per Jira project) and the related repo's CLAUDE.md.
- Edit with Claude: every editable field, reviewed as a diff.
- The composer replaces the Slack → Jira dialog.

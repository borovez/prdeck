# PR Deck

Personal, local-only dashboard for pull requests across several GitHub orgs, with cross-repo
dependencies (merge-before / release-before), Jira status, and a Slack inbox. It also exposes an MCP
server so Claude Code can query and edit the same data.

## Run

Node lives in nvm and isn't on the default PATH: `export PATH=~/.nvm/versions/node/v24.13.1/bin:$PATH`.

- `npm run dev` (root) runs API `127.0.0.1:4317` (tsx watch) and Vite `localhost:5317` (proxies `/api`). The user usually has this running already; both hot-reload.
- `npm run mcp` runs the stdio MCP server. Settings → MCP shows the `claude mcp add` command.
- Typecheck: `npx tsc --noEmit -p server` and `cd web && npx vue-tsc -b`. Build: `cd web && npx vite build`.
- Installed app: the web app is a PWA (`web/public/manifest.webmanifest`, `sw.js` that caches nothing, registered in production only). `npm run app:install` builds and runs the server as a LaunchAgent (`prdeck.server`, port 4317, log `~/Library/Logs/PRDeck.log`); it conflicts with `npm run dev` on the same port.
- Data: SQLite at `~/.prdeck/prdeck.db` (`PRDECK_DATA_DIR` overrides). Tokens live there; the API binds to loopback only and never returns tokens (masked as `hasToken`).

## Layout

- `shared/types.ts`: the contract for server, web and MCP. Change types here first.
- `server/src/`
  - `db.ts`: `node:sqlite` (WAL, shared by the API and MCP processes). Tables: kv (settings, sync state, UI prefs), prs, jira_issues, dependencies (manual), pr_meta (note/pin), slack_items.
  - `github.ts`: GraphQL search plus aliased batch fetch, release detection (latest release/tag or a per-repo branch, via the compare API). Retries 5xx.
  - `jira.ts`: REST v3 (`/search/jql`), transitions, create (Markdown → ADF).
  - `slack.ts`: user token (xoxp). Sources: mentions (search.messages), unanswered DMs/group DMs, saved items (stars.list), todo reactions (reactions.list).
  - `ai.ts`: Claude drafts a Jira issue from a Slack thread. Provider `claude-code` (default) runs the local `claude -p` CLI with its own login via `claudeCode.ts` (safe mode, no tools, `--json-schema`; strip zod's `$schema`); provider `api` uses `@anthropic-ai/sdk` `beta.messages.parse` + zod with server-side fallbacks. Model default `claude-opus-5-5`.
  - `sync.ts`: single-flight sync. GitHub searches per account return ids only (`searchPrHits`, 100 per page, two searches at a time); results are deduped, then open PRs and changed merged/closed PRs get the full fields by node id (`fetchPrsByNodeId`, batches of 10, 4 in parallel); unchanged merged/closed PRs reuse the stored copy (checks and mergeability change without touching updatedAt, so open PRs are always fetched). Then dependency targets (2 levels) and prune. Slack runs alongside from the start; after the PRs are saved, release checks, LaunchDarkly and Jira run in parallel. Each step collects its own errors.
    Each stage is a step (`progress()`: queued, running, done, error, skipped; `note()` for "search 3 of 7") saved to the sync state as it changes; `GET /api/sync/status` serves it, the header's `SyncButton` polls it while a sync runs (manual, auto or MCP) and shows the steps in a hover card. A restart marks a stale `running` state stopped.
  - `model.ts`: `buildOverview()` derives everything: dependency edges (manual > PR body `Depends on:` / `Requires release of` > Jira "is blocked by"), satisfied/blocked, action and bucket per PR, dependency chains (topologically sorted connected components).
  - `routes.ts` (Hono, `/api/*`), `index.ts` (server + background sync loop; honours `settings.sync.auto` / `intervalMinutes`, toggled from the header via `PUT /api/sync/auto`), `mcp.ts` (13 tools; Jira writing: `jira_fields` (fields, choices, current values and description, writing guides), `create_jira_issue` and `update_jira_issue` take fields by name and choices by label via `resolveFieldInput` (exact, or an unambiguous partial match; otherwise they refuse and list the choices), check required fields, and refuse a description that drops the issue's `jira-media` images).
- `web/src/`: Vue 3 + TS, Pinia, vue-router, **shadcn-vue** (`components/ui/*`, generated, reka-ui based), Tailwind v4, Phosphor icons.
  - `stores/deck.ts`: overview data, selected PR (drawer), slackToJira (dialog).
  - `stores/layout.ts`: customizable dashboard panels (order, pin, collapse, width, sort, filter, limit), per-view state via `layout.view(name, defaults)`. Persisted to `/api/prefs`.
  - Overview panels (`stores/layout.ts` DEFAULT_PANELS): PR lists, Slack, Jira, chains, releases (open releases with ship-next, hotfixes not back in dev, my unreleased work). New default panels are appended to saved layouts on load.
  - `components/`: PrRow, PrCard (compact card for graph nodes and the PR board), PrDrawer (resizable detail panel, add/remove dependencies), DashPanel (panel chrome), GroupCard (collapsible list section), SortDirButton, ActionBar (sticky bottom toolbar), SlackRow, SlackToJiraModal, JiraRow, JiraPill, JiraTransition, GraphNode.
  - `views/`: Dashboard, PullRequests, Slack, Graph, Jira, Settings.

## UI conventions

- Use shadcn-vue components wherever one fits. Add new ones with `npx shadcn-vue@latest add <name> --yes </dev/null`, then fix any `from 'cn'` imports to `from '@/lib/utils'` and `npm uninstall cn` if the CLI added it (a CLI bug).
- Local tweaks to generated components: `TabsTrigger` takes `count` (right-aligned badge), `Alert` takes `closable` (emits `close`), `AlertAction` is vertically centred, Toggle/ToggleGroup on-state is primary, Switch off-track is visible in light mode, CardHeader has `gap-x-6` before a CardAction.
- Writes go through `deck.mutate(fn, successMsg?)`: it toasts errors (and the success message), reloads, and returns whether it worked. Don't keep per-component error state for writes. Transient feedback is a toast (vue-sonner, `toast` from 'vue-sonner'); alerts are for persistent state.
- Page-level save/actions live in `ActionBar` (sticky bottom), not floating buttons.
- Tracked repos (Settings → GitHub) are picked with `MultiPicker` from the repo catalog (`server/src/repoCatalog.ts`, `GET /setup/github/repo-catalog`): every repo of every account's orgs (or the orgs an account is limited to), all pages, stored in kv for an hour (survives restarts), `?refresh=1` from the refresh button; typed `owner/name` can still be added.
- Settings: state in `stores/settings.ts` (page form + `saveSection(patch)` for one section on top of the last saved copy). Integrations are `components/settings/*` built on `ConnectionCard` (read-only details; Connect, or Edit + Disconnect) with `FormDialog` (draft, Test, Save). Destructive confirms use `ConfirmDialog`. Form fields use `Field`.
- Global search (`components/GlobalSearch.vue`): `/` or Cmd/Ctrl+K opens a palette over PRs, Jira issues, Slack messages, pages and actions; groups are ordered by their best match.
- Escape closes custom panels via `onEscape(fn)` (`composables/escape.ts`); reka dialogs/menus handle their own. Side panels use `SidePanel` (resizable, Escape). With one open, Arrow Up/Down moves through visible `[data-pr-id]` / `[data-slack-id]` elements in on-screen order (`useArrowNav` in `composables/prNav.ts`); put the attribute on any new PR or Slack item.
- reka-ui sets `data-state`, the generated classes use `data-checked:` etc.; `style.css` maps them with `@custom-variant`. Keep that block when regenerating components.
- Colours only via theme tokens in `web/src/style.css` (zinc + indigo; light, `.dark`, and System via `useTheme()`). Status tokens: `success`, `warning`, `info`, `merged`, `destructive`. Badge has matching soft variants (`primary|success|warning|info|merged|muted`). Never hard-code colours. Check both themes.
- Persist user view choices through `useLayout().view(...)`, not localStorage.
- List toolbars (Linear-style): `FilterMenu` (popover: search fields and values, open a field to tick several, F opens it; options carry counts given the other filters, `hint` for muted text like a repo's org) with `ActiveFilters` chips in a row under the toolbar; `DisplayMenu` (popover: List/Board switch, select / order+direction / switch rows, display-property pills that store the hidden ones). The PRs page uses them (`v.filters`, `v.hidden` → `PrRow :hide`); other pages still use the older `ViewMenu` dropdown.
- A count of PRs is a `PrListPopover` chip ("N PRs", `compact` for the count only): opens a filterable list (arrows, Enter opens the PR panel; `fallback` for untracked PRs opens GitHub; `numbered`/`highlight`; `#detail` slot for extra lines). Used for release contents (PrRow, PrCard; `hide: ['contents']`), Jira linked PRs (Dashboard, dense Jira rows) and PRs naming a flag (`useFlagPrs`: FlagChip, FlagStatus popover, FlagList).
- Scrolling lists and menus use `ScrollArea`; for a max height, put it on the viewport: `class="[&>[data-slot=scroll-area-viewport]]:max-h-80"`. Native scrollbars (page, dialogs, code) are themed in `style.css` to match.
- No DaisyUI (removed on purpose).

## Pages

### Dependency graph (`/graph`)

`views/GraphView.vue` + `components/GraphNode.vue` (Vue Flow + dagre LR). Edges drawn prerequisite → dependent (solid merge, dashed release; green/muted satisfied, amber waiting). Filters persist via `layout.view('graph', …)`. Drag right handle → left handle creates a dependency (kind from the "New links" toggle); click an edge to see it and delete manual ones. "Unlinked PRs" shows open PRs without deps so links can be drawn to them. Vue Flow is themed in the view's unscoped `<style>` (`.dep-graph`).

### Feature flags (LaunchDarkly, read only)

PRs name flags in their description: `Feature flag: key` / `Flags: a, b` lines (colon required; with backticks only the backticked keys count), qualified prose ("`key` LaunchDarkly flag", "feature flags `a` / `b`"), or LaunchDarkly flag links (`parseFeatureFlags` in refs.ts; `PrView.flags`). Sync step 4c (`launchdarkly.ts`, GET only) caches each referenced flag's on/off per configured environment (`feature_flags`, Overview `flags`). UI: `FlagStatus` (rows/cards), `FlagList` (PR panel), `FlagChip` (release contents roll-up), flag icon on release graph rows, `settings/LaunchDarklySettings.vue` (Reader access token, project key, environments).

### Dependencies written to GitHub

Adding a dependency (PR panel, graph) edits the dependent PR's description on GitHub (`bodyDeps.ts`: fetch the current body, add `Depends on: org/repo#N` / `Requires release of: …`, PATCH), so the edge's source becomes `body`. Removing a `body` edge takes the ref out of that line. With `writeBothSides` the prerequisite also gets `Blocks: A` / `Release blocks: A` (`withBlocks`; read back by `parseBodyBlocks`), and removing takes both lines out. If neither write works, the dependency is stored as manual and the toast says why. `settings.dependencies.writeToDescription` / `writeBothSides` (Settings → Dependencies) turn this off; Overview `dependencyWrites` exposes them. Web side: `composables/dependencies.ts` (one write per pair at a time, shared `busy` for disabling controls, existing dependencies skipped). PRs are picked with `PrPicker` (title/repo/number/branch/Jira search; `filter`, `disabledReason` for already-linked PRs) in the PR panel, the graph's Add dependency form and the Release train section. The MCP `add_dependency` tool still stores manual deps.

### Releases (`/releases`)

`views/ReleasesView.vue`. `server/src/flow.ts` classifies PRs (`PrView.flow`): release (dev/release/* → master/main), hotfix (other branches → master/main in repos that use dev), backmerge (master → dev). Release trains (`buildTrains` in model.ts, Overview `trains`): open releases across repos linked by dependencies between their contents (ordered, topological) or shared Jira issues (unordered); Trains tab (`TrainCard`); the order is set in the PR panel's Release train section (`TrainOrder`: ship this after / before it, remove order; adds a merge dependency between the release PRs), dotted "same Jira" edges in the graph, a line in the PR panel banner. Tag-based repos: `syncTags` caches what each of the latest 5 tags shipped (`tag_contents`, compare previous...tag → commits → PRs); Overview `tags`, PR `releasedIn`, a Tags section on the Releases tab, and the graph's Released box. Release detection: `releaseRefFor` (per-repo setting, else the release branch for repos that release through PRs, else latest tag). Sync step 4b (`releases.ts`) caches what each release PR ships (`release_contents`: commit → associated PRs, cherry-pick trailers, PR refs in the description; backmerges excluded), recomputed when the PR's updatedAt changes, and checks merged hotfixes against dev (`backmerges`). Overview carries `releases`; PRs get `shipsIn`, `backmerge`, `backmergePr`, action `backmerge`. Releases tab: release PRs with contents (`ReleaseItems`, nested releases expand with level arrows) and merged work not in a release yet; Hotfixes tab: needs backmerge, open, done. Graph tab (`ReleaseGraph.vue`, `ReleaseGroupNode.vue`): fixed column × repo-lane layout (merged to dev → in a release → merged to master → released), one repo at a time via repo tabs (other repos show only items linked to it by dependencies; "All repos" shows everything), releases, unreleased work and hotfixes as boxes with one handle pair per row so dependency edges attach to PRs; release-order, rolls-into and back-into-dev edges; Released column is one box per repo named after its release ref; state in `layout.view('releaseGraph')`. Vue Flow theme is shared in `components/flowTheme.css`. Both graphs: nodes zIndex 10 so edges never draw over cards; hover raises edges to 5. Dependencies page hover highlights the whole upstream/downstream chain. The PR panel has a Contents tab for release PRs and a status banner with ships-in / backmerge.

### Jira (`/jira`)

One row per Jira key: my JQL issues plus keys found in PRs, so it works before Jira is connected (details fill in once it is). Linked PRs render as compact `PrRow`s. Scope tabs (Mine, With PRs, No PRs) with counts, project/status filters, group by status/project/parent.


### Jira issue composer (create and edit)

`components/JiraComposer.vue` (Linear-style dialog, `deck.composer = { mode: 'create', …seed } | { mode: 'edit', key }`), opened from the header button / `C`, global search, the Jira page, the Jira panel's Edit, and the PR panel (Create issue pre-filled from the PR; edit linked issues). Fields are metadata-driven: `jira.ts` maps create metadata (`createMeta`) and edit metadata (`editable`, `?expand=editmeta&fields=*all`) to `JiraFieldMeta` with a `JiraFieldKind` (option(s), user(s), labels, parent, sprint, number, string, text, date), so each project's own fields (required ones, story points, sprint, Urgency…) work without code. `JiraFieldChip.vue` edits one field (fixed options, or `GET /jira/options` for users / epics / sprints via the Agile API / label suggestions, `cf[id]` for custom label fields). Values travel as `JiraFieldValue` (ids, account ids, keys, numbers, Markdown, dates) and `toJiraFields` builds Jira's payload (`{id}`, `{accountId}`, `{key}`, sprint id, ADF, datetime vs date). Descriptions are edited as Markdown (`adfToMarkdown` in shared/adf.ts) and only sent back when changed; edit sends only changed fields. Projects: Settings → Jira picks them from Jira's own list (`MultiPicker`, `POST /setup/jira/projects` with the form's credentials) into `projectKeys`, which also limits `GET /jira/projects` (composer, default project; all when none are picked); default project and type are dropdowns from that. Defaults: Settings → Jira (assign to me) via `createMeta().defaults`; last required values and ⋯-added fields per project in `layout.view('jira-composer')`. Writes (`POST /jira/issues`, `PUT /jira/issues/:key`) upsert the issue into the cache (`upsertJira`).

Claude drafting (create mode): the purple "Ask Claude" box sends `POST /jira/draft` (`draftJiraIssue` in ai.ts) with your prompt (required), the current draft, the chip fields (`fieldKeys`; Claude answers option labels, mapped back to ids; users and sprints are left to you) and context: a PR (stored body, changed files via `prFileNames`), a Slack thread, the repo's CLAUDE.md (`guides.ts` `claudeMdGuide`: Jira/issue/ticket sections, or a short file whole; kept an hour), the project's writing guide (Settings → Jira `guides`, wins over CLAUDE.md), and images. Stop aborts the fetch; the route listens for the connection closing and kills the `claude` process. Undo restores the previous draft. Images (`composables/imageAttachments.ts`): pasted/dropped on the Claude box = context only; on the description = inserted as `![name](attachment:name)` (one upload per image by content hash, reused when pasted again; the server uploads, then rewrites refs to the attachment URL: `resolveAttachmentRefs`); anywhere else = attached. Claude gets each image once (`uniqueForDraft`), scaled to ≤1600 px; Claude Code receives them via `--input-format stream-json`. Claude suggests every chip field when writing (priority, story points on 1-13, parent epic and sprint from `fieldOptions` choices with their details, labels, required fields); chips it set show a sparkle (`suggested`) until you change them. Edit mode (step 4): the same box sends `issueKey`, the route uses the issue's edit metadata and adds its latest comments and PRs naming it; Claude changes only what's asked and returns `changeSummary`. The answer becomes a review panel (`proposalChanges`: old → new per field, `lineDiff` for the description) with a checkbox per change; Apply puts the ticked ones in the form, Save writes them, optionally with a "Updated with Claude" comment (`addComment`). Descriptions round-trip Jira's own images as `![name](jira-media:<id>?width=…)` (`mediaAttrs`/`jiraMediaUrl` in shared/adf.ts), so editing never drops them. Slack's "Create Jira" opens the composer with the message as context (reply in thread, mark done on create); the old Slack dialog is gone. Plan and next steps (Claude drafting, updates with a diff, replacing the Slack dialog): `docs/tasks/ai-jira-and-pr-writing.md`.

## Pull request dependencies, feature flags and deployment steps

When opening or editing a pull request (in this repo, and in the repos PR Deck tracks), declare ordering in the description, one kind per line, always with the full `owner/repo#number` (never a bare `#12` for another repo, never only a URL). These are the formats PR Deck itself reads (`server/src/refs.ts`):

- `Depends on: owner/repo#12`: this PR merges only after owner/repo#12 is merged.
- `Requires release of: owner/repo#34`: this PR needs owner/repo#34 released (deployed), not just merged.
- `Blocks: owner/repo#56`: owner/repo#56 waits for this PR's merge (the other side of its "Depends on").
- `Release blocks: owner/repo#78`: owner/repo#78 waits for this PR's release.

Rules:

- Several PRs of the same kind go on one line, comma separated (`Depends on: owner/api#12, owner/web#40`); don't repeat the label.
- Write both sides: `Depends on:` here and `Blocks: <this PR>` on the other PR (`Requires release of:` / `Release blocks:` for release dependencies). Fetch its body with `gh pr view <n> --repo <owner/repo> --json body --jq .body`, change only that line, write it back with `gh pr edit <n> --repo <owner/repo> --body-file <file>`. No access? Say so.
- When a dependency goes away, remove it from both PRs and drop empty lines. Never remove or reword dependency lines someone else wrote unless asked.
- Before opening a PR, check whether it needs another repo's or open PR's change; ask if unsure; with none, leave the lines out (no "Depends on: none").
- Release PRs (dev → main/master, `release/*` → main/master) that must ship after another repo's release get `Depends on: <that release PR>`, and that one gets `Blocks: <this release PR>`.
- Feature flags: `Feature flag: flag-key` (several: `Feature flags: flag-a, flag-b`), exact key; for a new flag, say its default and what turning it on does.
- Deployment steps: every PR has a `## Deployment steps` section, an ordered `- [ ]` checklist of what shipping it takes, in order: what deploys first (matching the dependency lines), config/env to change (names only, never values), migrations (safe with the old code live?), commands or backfills, flags to turn on and where, what to verify, how to roll back (and what can't be undone). Nothing special: `None: a normal deploy.`

The PR template (`.github/pull_request_template.md`) has these sections.

## Other open items

- Embedded GitHub/Jira pages need a native shell (Electron); spec in `docs/tasks/electron-embedded-browser.md`. Until then "Open beside" uses a popup window.
- Slack, Jira and Claude drafting are not yet tested against real credentials (Slack needs scopes incl. `stars:read`, `reactions:read`, `reactions:write` for marking todos done in Slack).
- Graph, Jira, toasts and ActionBar not yet checked in a browser (Chrome extension wasn't connected). Jira page untested with real Jira data.

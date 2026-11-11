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
  - `sync.ts`: single-flight sync. GitHub searches per account, then dependency targets (2 levels), prune, release checks, Jira, Slack.
  - `model.ts`: `buildOverview()` derives everything: dependency edges (manual > PR body `Depends on:` / `Requires release of` > Jira "is blocked by"), satisfied/blocked, action and bucket per PR, dependency chains (topologically sorted connected components).
  - `routes.ts` (Hono, `/api/*`), `index.ts` (server + background sync loop; honours `settings.sync.auto` / `intervalMinutes`, toggled from the header via `PUT /api/sync/auto`), `mcp.ts` (11 tools).
- `web/src/`: Vue 3 + TS, Pinia, vue-router, **shadcn-vue** (`components/ui/*`, generated, reka-ui based), Tailwind v4, Phosphor icons.
  - `stores/deck.ts`: overview data, selected PR (drawer), slackToJira (dialog).
  - `stores/layout.ts`: customizable dashboard panels (order, pin, collapse, width, sort, filter, limit), per-view state via `layout.view(name, defaults)`. Persisted to `/api/prefs`.
  - `components/`: PrRow, PrCard (compact card for graph nodes and the PR board), PrDrawer (resizable detail panel, add/remove dependencies), DashPanel (panel chrome), GroupCard (collapsible list section), SortDirButton, ActionBar (sticky bottom toolbar), SlackRow, SlackToJiraModal, JiraRow, JiraPill, JiraTransition, GraphNode.
  - `views/`: Dashboard, PullRequests, Slack, Graph, Jira, Settings.

## UI conventions

- Use shadcn-vue components wherever one fits. Add new ones with `npx shadcn-vue@latest add <name> --yes </dev/null`, then fix any `from 'cn'` imports to `from '@/lib/utils'` and `npm uninstall cn` if the CLI added it (a CLI bug).
- Local tweaks to generated components: `TabsTrigger` takes `count` (right-aligned badge), `Alert` takes `closable` (emits `close`), `AlertAction` is vertically centred, Toggle/ToggleGroup on-state is primary, Switch off-track is visible in light mode, CardHeader has `gap-x-6` before a CardAction.
- Writes go through `deck.mutate(fn, successMsg?)`: it toasts errors (and the success message), reloads, and returns whether it worked. Don't keep per-component error state for writes. Transient feedback is a toast (vue-sonner, `toast` from 'vue-sonner'); alerts are for persistent state.
- Page-level save/actions live in `ActionBar` (sticky bottom), not floating buttons.
- Settings: state in `stores/settings.ts` (page form + `saveSection(patch)` for one section on top of the last saved copy). Integrations are `components/settings/*` built on `ConnectionCard` (read-only details; Connect, or Edit + Disconnect) with `FormDialog` (draft, Test, Save). Destructive confirms use `ConfirmDialog`. Form fields use `Field`.
- Global search (`components/GlobalSearch.vue`): `/` or Cmd/Ctrl+K opens a palette over PRs, Jira issues, Slack messages, pages and actions; groups are ordered by their best match.
- Escape closes custom panels via `onEscape(fn)` (`composables/escape.ts`); reka dialogs/menus handle their own. Side panels use `SidePanel` (resizable, Escape). With one open, Arrow Up/Down moves through visible `[data-pr-id]` / `[data-slack-id]` elements in on-screen order (`useArrowNav` in `composables/prNav.ts`); put the attribute on any new PR or Slack item.
- reka-ui sets `data-state`, the generated classes use `data-checked:` etc.; `style.css` maps them with `@custom-variant`. Keep that block when regenerating components.
- Colours only via theme tokens in `web/src/style.css` (zinc + indigo; light, `.dark`, and System via `useTheme()`). Status tokens: `success`, `warning`, `info`, `merged`, `destructive`. Badge has matching soft variants (`primary|success|warning|info|merged|muted`). Never hard-code colours. Check both themes.
- Persist user view choices through `useLayout().view(...)`, not localStorage.
- No DaisyUI (removed on purpose).

## Pages

### Dependency graph (`/graph`)

`views/GraphView.vue` + `components/GraphNode.vue` (Vue Flow + dagre LR). Edges drawn prerequisite → dependent (solid merge, dashed release; green/muted satisfied, amber waiting). Filters persist via `layout.view('graph', …)`. Drag right handle → left handle creates a dependency (kind from the "New links" toggle); click an edge to see it and delete manual ones. "Unlinked PRs" shows open PRs without deps so links can be drawn to them. Vue Flow is themed in the view's unscoped `<style>` (`.dep-graph`).

### Dependencies written to GitHub

Adding a dependency (PR panel, graph) edits the dependent PR's description on GitHub (`bodyDeps.ts`: fetch the current body, add `Depends on: org/repo#N` / `Requires release of: …`, PATCH), so the edge's source becomes `body`. Removing a `body` edge takes the ref out of that line. If the write fails, the dependency is stored as manual and the toast says why. `settings.dependencies.writeToDescription` (Settings → Dependencies) turns this off. Web side: `composables/dependencies.ts`. The MCP `add_dependency` tool still stores manual deps.

### Releases (`/releases`)

`views/ReleasesView.vue`. `server/src/flow.ts` classifies PRs (`PrView.flow`): release (dev/release/* → master/main), hotfix (other branches → master/main in repos that use dev), backmerge (master → dev). Release detection: `releaseRefFor` (per-repo setting, else the release branch for repos that release through PRs, else latest tag). Sync step 4b (`releases.ts`) caches what each release PR ships (`release_contents`: commit → associated PRs, cherry-pick trailers, PR refs in the description; backmerges excluded), recomputed when the PR's updatedAt changes, and checks merged hotfixes against dev (`backmerges`). Overview carries `releases`; PRs get `shipsIn`, `backmerge`, `backmergePr`, action `backmerge`. Releases tab: release PRs with contents (`ReleaseItems`, nested releases expand with level arrows) and merged work not in a release yet; Hotfixes tab: needs backmerge, open, done. Graph tab (`ReleaseGraph.vue`, `ReleaseGroupNode.vue`): fixed column × repo-lane layout (merged to dev → in a release → merged to master → released), one repo at a time via repo tabs (other repos show only items linked to it by dependencies; "All repos" shows everything), releases, unreleased work and hotfixes as boxes with one handle pair per row so dependency edges attach to PRs; release-order, rolls-into and back-into-dev edges; Released column is one box per repo named after its release ref; state in `layout.view('releaseGraph')`. Vue Flow theme is shared in `components/flowTheme.css`. Both graphs: nodes zIndex 10 so edges never draw over cards; hover raises edges to 5. Dependencies page hover highlights the whole upstream/downstream chain. The PR panel has a Contents tab for release PRs and a status banner with ships-in / backmerge.

### Jira (`/jira`)

One row per Jira key: my JQL issues plus keys found in PRs, so it works before Jira is connected (details fill in once it is). Linked PRs render as compact `PrRow`s. Scope tabs (Mine, With PRs, No PRs) with counts, project/status filters, group by status/project/parent.

## Other open items

- Embedded GitHub/Jira pages need a native shell (Electron); spec in `docs/tasks/electron-embedded-browser.md`. Until then "Open beside" uses a popup window.
- Slack, Jira and Claude drafting are not yet tested against real credentials (Slack needs scopes incl. `stars:read`, `reactions:read`).
- Graph, Jira, toasts and ActionBar not yet checked in a browser (Chrome extension wasn't connected). Jira page untested with real Jira data.

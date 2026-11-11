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
- Escape closes custom panels via `onEscape(fn)` (`composables/escape.ts`); reka dialogs/menus handle their own. Side panels use `SidePanel` (resizable, Escape). With one open, Arrow Up/Down moves through visible `[data-pr-id]` / `[data-slack-id]` elements in on-screen order (`useArrowNav` in `composables/prNav.ts`); put the attribute on any new PR or Slack item.
- reka-ui sets `data-state`, the generated classes use `data-checked:` etc.; `style.css` maps them with `@custom-variant`. Keep that block when regenerating components.
- Colours only via theme tokens in `web/src/style.css` (zinc + indigo; light, `.dark`, and System via `useTheme()`). Status tokens: `success`, `warning`, `info`, `merged`, `destructive`. Badge has matching soft variants (`primary|success|warning|info|merged|muted`). Never hard-code colours. Check both themes.
- Persist user view choices through `useLayout().view(...)`, not localStorage.
- No DaisyUI (removed on purpose).

## Pages

### Dependency graph (`/graph`)

`views/GraphView.vue` + `components/GraphNode.vue` (Vue Flow + dagre LR). Edges drawn prerequisite → dependent (solid merge, dashed release; green/muted satisfied, amber waiting). Filters persist via `layout.view('graph', …)`. Drag right handle → left handle creates a manual dep (kind from the "New links" toggle); click an edge to see it and delete manual ones. "Unlinked PRs" shows open PRs without deps so links can be drawn to them. Vue Flow is themed in the view's unscoped `<style>` (`.dep-graph`).

### Jira (`/jira`)

One row per Jira key: my JQL issues plus keys found in PRs, so it works before Jira is connected (details fill in once it is). Linked PRs render as compact `PrRow`s. Scope tabs (Mine, With PRs, No PRs) with counts, project/status filters, group by status/project/parent.

## Other open items

- Embedded GitHub/Jira pages need a native shell (Electron); spec in `docs/tasks/electron-embedded-browser.md`. Until then "Open beside" uses a popup window.
- Slack, Jira and Claude drafting are not yet tested against real credentials (Slack needs scopes incl. `stars:read`, `reactions:read`).
- Graph, Jira, toasts and ActionBar not yet checked in a browser (Chrome extension wasn't connected). Jira page untested with real Jira data.

# PR Deck

Personal, local-only dashboard for pull requests across several GitHub orgs, with cross-repo
dependencies (merge-before / release-before), Jira status, and a Slack inbox. It also exposes an MCP
server so Claude Code can query and edit the same data.

## Run

Node lives in nvm and isn't on the default PATH: `export PATH=~/.nvm/versions/node/v24.13.1/bin:$PATH`.

- `npm run dev` (root) runs API `127.0.0.1:4317` (tsx watch) and Vite `localhost:5317` (proxies `/api`). The user usually has this running already; both hot-reload.
- `npm run mcp` runs the stdio MCP server. Settings → MCP shows the `claude mcp add` command.
- Typecheck: `npx tsc --noEmit -p server` and `cd web && npx vue-tsc -b`. Build: `cd web && npx vite build`.
- Data: SQLite at `~/.prdeck/prdeck.db` (`PRDECK_DATA_DIR` overrides). Tokens live there; the API binds to loopback only and never returns tokens (masked as `hasToken`).

## Layout

- `shared/types.ts`: the contract for server, web and MCP. Change types here first.
- `server/src/`
  - `db.ts`: `node:sqlite` (WAL, shared by the API and MCP processes). Tables: kv (settings, sync state, UI prefs), prs, jira_issues, dependencies (manual), pr_meta (note/pin), slack_items.
  - `github.ts`: GraphQL search plus aliased batch fetch, release detection (latest release/tag or a per-repo branch, via the compare API). Retries 5xx.
  - `jira.ts`: REST v3 (`/search/jql`), transitions, create (Markdown → ADF).
  - `slack.ts`: user token (xoxp). Sources: mentions (search.messages), unanswered DMs/group DMs, saved items (stars.list), todo reactions (reactions.list).
  - `ai.ts`: Claude drafts a Jira issue from a Slack thread (`@anthropic-ai/sdk`, `beta.messages.parse` + zod, `claude-opus-5-5`, server-side fallbacks).
  - `sync.ts`: single-flight sync. GitHub searches per account, then dependency targets (2 levels), prune, release checks, Jira, Slack.
  - `model.ts`: `buildOverview()` derives everything: dependency edges (manual > PR body `Depends on:` / `Requires release of` > Jira "is blocked by"), satisfied/blocked, action and bucket per PR, dependency chains (topologically sorted connected components).
  - `routes.ts` (Hono, `/api/*`), `index.ts` (server + 5-min sync loop), `mcp.ts` (11 tools).
- `web/src/`: Vue 3 + TS, Pinia, vue-router, **shadcn-vue** (`components/ui/*`, generated, reka-ui based), Tailwind v4, Phosphor icons.
  - `stores/deck.ts`: overview data, selected PR (drawer), slackToJira (dialog).
  - `stores/layout.ts`: customizable dashboard panels (order, pin, collapse, width, sort, filter, limit), per-view state via `layout.view(name, defaults)`. Persisted to `/api/prefs`.
  - `components/`: PrRow, PrDrawer (resizable detail panel, add/remove dependencies), DashPanel (panel chrome), SlackRow, SlackToJiraModal, JiraPill, JiraTransition.
  - `views/`: Dashboard, PullRequests, Slack, Settings; `ComingSoonView` is a placeholder for /graph and /jira.

## UI conventions

- Use shadcn-vue components wherever one fits. Add new ones with `npx shadcn-vue@latest add <name> --yes </dev/null`, then fix any `from 'cn'` imports to `from '@/lib/utils'` (a CLI bug).
- Colours only via theme tokens in `web/src/style.css` (zinc + indigo; light, `.dark`, and System via `useTheme()`). Status tokens: `success`, `warning`, `info`, `merged`, `destructive`. Badge has matching soft variants (`primary|success|warning|info|merged|muted`). Never hard-code colours. Check both themes.
- Persist user view choices through `useLayout().view(...)`, not localStorage.
- No DaisyUI (removed on purpose).

## Next task: dependency graph page (`/graph`)

Replace the placeholder route in `web/src/router.ts` with `views/GraphView.vue`. The packages are already installed: `@vue-flow/core`, `@vue-flow/background`, `@vue-flow/controls`, `@dagrejs/dagre` (CSS: `@vue-flow/core/dist/style.css`, `theme-default.css`, `@vue-flow/controls/dist/style.css`; theme them to the tokens).

- Data is already there: `deck.overview.edges` (`DepEdge`: from = dependent, to = prerequisite, kind merge|release, source manual|body|jira, satisfied, missing) and `deck.overview.chains`. Draw arrows prerequisite → dependent.
- Nodes are compact PR cards: repo#number, title, action badge (`ACTION_TONE`), CI icon, Jira key/status. Group or colour by repo/org. Mark the chain's `nextStep`, and mark missing (not-synced) nodes.
- Edges: solid for merge, dashed for release; satisfied edges muted/green, unsatisfied amber; label the source on hover.
- Dagre auto-layout (LR), fit view, mini controls. Clicking a node opens the existing PrDrawer (`deck.selectedId = id`).
- Filters (persisted via `layout.view('graph', …)`): repo/org, hide finished chains, only chains involving my PRs.
- Optionally drag from one node's handle to another to create a manual dependency (`api.addDep(from, to, kind)` then `deck.load()`), and select an edge to delete a manual one (`api.removeDep(id)`).
- There are currently no edges in the user's data. To test, add a couple with `POST /api/deps` (or the drawer form) and remove them afterwards.

## Other open items

- `/jira` page (Jira tasks with their linked PRs) is still a placeholder.
- Slack, Jira and Claude drafting are not yet tested against real credentials (Slack needs scopes incl. `stars:read`, `reactions:read`).
- Not committed to git yet (repo initialised, no commits).

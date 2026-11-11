# PR Deck

A local dashboard for the pull requests you care about across several GitHub orgs, with the things
around them: cross-repo dependencies, Jira status, and a Slack inbox. It also runs an MCP server, so
Claude Code can query and edit the same data.

It runs on your machine only. The API binds to `127.0.0.1`, tokens stay in a local SQLite file, and
nothing is hosted.

![PR Deck overview: stat tiles, the "Needs my action" list, the Slack inbox and dependency chains (demo data)](docs/screenshot.png)

## Features

- **Overview**: what needs your action (reviews, failing CI, feedback, conflicts, merges, releases),
  what's blocked, what you're waiting on. Customisable panels and clickable stat tiles.
- **Pull requests**: list or board, grouped by status, repo or org; search, filters, sort. A detail
  panel with checks, reviews, unresolved review conversations (linked to each comment), Jira issues,
  dependencies and a private note.
- **Dependencies**: "merge before" and "release before" links between PRs in different repos, from
  the PR description (`Depends on: owner/repo#12`, `Requires release of owner/repo#34`), Jira "is
  blocked by" links, or added by hand. An interactive graph shows the chains and the next step.
- **Releases**: a "needs release" dependency is satisfied once the prerequisite's merge commit is in
  the latest GitHub release or tag, or in a branch you choose per repo.
- **Jira**: your issues and the issues referenced by PRs, with their linked PRs and status
  transitions.
- **Slack inbox**: mentions, unanswered DMs and group DMs, saved messages, and messages you reacted to
  with a "todo" emoji, shown in context and formatted.
- **Slack to Jira**: Claude drafts an issue from a Slack thread, including the project's required
  fields, and can reply in the thread with the link.
- **MCP server** for Claude Code with tools: `overview`, `list_prs`, `get_pr`, `jira_issue`,
  `add_dependency`, `remove_dependency`, `sync`, `slack_inbox`, `slack_thread`, `set_slack_status`,
  `create_jira_issue`.
- Light, dark and system themes; keyboard navigation (arrow keys, Escape, shortcuts in the Slack
  panel).

## Requirements

- Node.js 24 (see `.nvmrc`)
- A GitHub account: the [GitHub CLI](https://cli.github.com/) login, or a personal access token
  with `repo` and `read:org`
- Optional: Jira Cloud, Slack, and Claude (Claude Code or an Anthropic API key)

## Getting started

```bash
git clone https://github.com/borovez/prdeck.git
cd prdeck
npm install
npm run dev
```

Open <http://localhost:5317> and go to **Settings**:

1. **GitHub**: click **Use my gh CLI login**, or add a token. Optionally limit each account to some
   orgs, and add **tracked repos** to pull in every open PR in those repos (team view).
2. **Jira** (optional): site URL, email and an
   [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
3. **Slack** (optional): create a Slack app, add these **User Token Scopes**, install it to your
   workspace and paste the `xoxp-…` user token:
   `search:read, im:history, mpim:history, im:read, mpim:read, channels:history, groups:history, users:read, stars:read, reactions:read, chat:write`
4. **Claude** (optional, for drafting Jira issues): use your local
   [Claude Code](https://claude.com/claude-code) login (no API key needed), or an Anthropic API key.

Then press **Sync**. With **Auto** on, the server syncs in the background (every 5 minutes by
default).

### Use from Claude Code

Settings → MCP shows the exact `claude mcp add` command for your machine. It runs `npm run mcp`
(a stdio MCP server) against the same database.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API on `127.0.0.1:4317` and the web app on `localhost:5317`, both reloading on change |
| `npm run build` | Build the web app into `web/dist` |
| `npm start` | Run the API, which also serves the built app |
| `npm run mcp` | Run the MCP server (stdio) |
| `npm run typecheck` | Typecheck the server and the web app |

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRDECK_DATA_DIR` | `~/.prdeck` | Where the SQLite database lives (settings, tokens, cache) |
| `PRDECK_PORT` | `4317` | API port |
| `CLAUDE_BIN` | found on `PATH` | Path to the `claude` CLI, if it isn't found |
| `ANTHROPIC_API_KEY` | | Used for drafting when no key is stored in Settings |

## Security

- The API only listens on loopback (`127.0.0.1`) and never returns stored tokens to the browser.
- Tokens are stored unencrypted in the local database under `PRDECK_DATA_DIR`. Protect that folder
  like any other credentials file.
- Drafting through Claude Code runs `claude -p` in safe mode with no tools and no saved session.

## Stack

- **Server**: Node.js, TypeScript, Hono, `node:sqlite`, GitHub GraphQL, Jira REST v3, Slack Web API,
  `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`
- **Web**: Vue 3, Pinia, vue-router, Tailwind CSS v4, shadcn-vue (reka-ui), Phosphor icons,
  Vue Flow + dagre for the dependency graph, vue-sonner

## License

[MIT](LICENSE)

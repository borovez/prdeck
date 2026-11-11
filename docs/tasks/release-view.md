# Plan: see what a release contains (Releases view)

Status: planned, not started

## Goal

For any release, see which PRs it ships, across repos, with their dependencies and Jira issues:
"what's in `release/abc-12-34`", "what will the next dev → master promotion ship",
"which merged PRs aren't in any release yet", "in which order do the FE and BE releases go out".

## How releases happen today (from the synced data)

Three shapes, all handled:

| Shape | Example | Contents |
| --- | --- | --- |
| Promotion PR | `dev → master`, `dev → main` | every PR merged into `dev` since the last promotion |
| Cherry-pick release branch | `release/abc-12-34 → master` | selected commits, cherry-picked (often with `-x`) |
| Tag / GitHub release | `v3.2.0`, `6.11.0` | whatever the tagged commit contains (already used for "released") |

Backmerges (`master → dev`, `backmerge/* → dev`) are not releases and are excluded.

## What counts as a release PR

A PR is a release PR when its base is a repo's release branch (default: `master`/`main`, or the
per-repo branch in Settings → Releases) **and** either its head is the integration branch (`dev`,
`develop`, `staging`) or a `release/*` branch, or its title starts with `release`. Configurable per repo
later if the defaults miss.

## Working out the contents

Server-side, on demand and cached (keyed by the release PR's head SHA, so it only changes when the
release branch moves). Never inside the regular sync loop, to stay well clear of GitHub limits.

1. **Promotion PR**: the release PR's `commits` (GraphQL, up to 250) → each commit's
   `associatedPullRequests` → keep PRs merged into the head branch. Squash and merge commits both
   resolve this way.
2. **Cherry-pick branch**: commits are new SHAs, so step 1 finds nothing. Read each commit's
   `(cherry picked from commit <sha>)` trailer (`git cherry-pick -x`) and resolve the *original* SHA's
   associated PR. Fallback: PR references in the release PR's description (`#816`, URLs) and its Jira
   keys, matched to synced PRs.
3. **Tag**: compare the previous tag with this one (`/compare/prev...tag`), then the same
   commit → PR resolution. Gives "what shipped in v3.2.0".
4. **Unreleased**: PRs merged into the integration branch that are in no open release PR and not in
   the latest tag: the candidates for the next release.

Result type (shared):

```ts
interface ReleaseContents {
  release: { kind: 'pr' | 'tag'; repo: string; id: string; title: string; base: string; head: string; state: 'open' | 'merged' | 'tagged' }
  prs: { id: PrId; via: 'commit' | 'cherry-pick' | 'description' | 'jira' }[]
  jiraKeys: string[]
  commitsScanned: number
  truncated: boolean // more than 250 commits
}
```

## Where it shows up

1. **Releases mode on the Dependencies page** (toggle: Dependencies | Releases)
   - Each release is a **group node** (Vue Flow parent node) titled
     `web-app · release/abc-12… → master · open`, with its PRs as cards inside (the existing
     `PrCard`, compact).
   - Existing dependency edges stay drawn between cards, so cross-repo release order is visible
     (e.g. the FE release waits on the BE release's merge or release).
   - An **Unreleased** group per repo collects merged PRs waiting for a release.
   - Filters (View menu): repo/org, open releases only, include the last N tags.
   - Group header roll-up: number of PRs, their Jira keys and statuses (all Done / Ready for QA?),
     CI state of the release PR.
2. **PR panel**
   - A release PR gets a **Contents** tab: the PRs and Jira issues it ships.
   - Any PR shows **"Ships in #724"** (open release PR containing it) or **"Released in v3.2.0"**.
3. **Jira panel**: "Ships in" for issues whose PRs are in an open release.

## Phases

1. **Data**: release-PR detection, contents resolution for promotion and cherry-pick PRs, cache,
   `GET /api/releases/:prId`; Contents tab in the PR panel; "Ships in" badge. *Smallest useful step.*
2. **Releases graph mode**: group nodes, dagre layout per group, Unreleased bucket, filters.
3. **Tags**: contents per tag (previous → current), "Released in" from contents instead of
   compare-per-PR, last N tags per repo in the graph.
4. **Release trains**: link releases across repos that share Jira keys or dependency edges, and
   suggest an order.

## Cost and limits

- One GraphQL query per release PR (commits + associated PRs, paged), cached by head SHA. A dozen
  open release PRs is a dozen queries, refreshed only when their branches move.
- Cherry-pick trailers add one batched GraphQL lookup (`object(oid:)` aliases) per release.
- Caps: 250 commits per release (flag `truncated`), 50 tags per repo.

## Open questions

- Is "base = master/main, head = dev or `release/*`, or title starts with `release`" right for every
  repo, or do some promote via other branches (`staging`, `production`)?
- Do all cherry-pick release branches use `git cherry-pick -x`? Without the trailer, contents fall back
  to the description and Jira keys, which is less reliable.
- Should Jira **fix versions** count as releases too (e.g. group by fix version alongside branches)?
- How far back should tags go in the graph (last 3? last month?)?

## Relevant code

- Release detection today: `server/src/github.ts` (`resolveReleaseRef`, `isCommitIn`),
  `server/src/sync.ts` (release checks), `shared/release.ts` (wording).
- Graph: `web/src/views/GraphView.vue`, `web/src/components/GraphNode.vue`, `PrCard.vue`.
- PR panel tabs: `web/src/components/PrDrawer.vue`; detail cache: `web/src/composables/prDetail.ts`.

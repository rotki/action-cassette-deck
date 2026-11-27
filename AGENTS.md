# rotki/action-cassette-deck

A JavaScript GitHub Action that keeps a cassette repository in step with the main one: when a pull
request is merged in the main repository, it merges the matching pull request or branch in the
cassette repository and comments on the original pull request with the result. rotki runs it from
`.github/workflows/rotki_cassette_merge.yml` in `rotki/rotki`, pinned by commit SHA with a version
comment (`rotki/action-cassette-deck@<sha> # v4.2.1`). The README documents the `@v4` major tag
for everyone else.

This file is the maintenance guide for humans and coding agents. `README.md` covers what the action
does, its inputs, creating the merge token and the workflow setup; this guide links there instead
of repeating it.

## Toolchain

- Node.js 24 (`.nvmrc`; CI reads its version from there). The action runs on the `node24` runtime
  (`action.yml`), so the two move together.
- pnpm 12, pinned through `packageManager` in `package.json`.
- TypeScript, bundled with Rollup into a single ESM file. Tests use Vitest. Linting uses
  `@rotki/eslint-config` with the slop rules (`eslint.config.mjs`).
- Husky hooks: `pre-commit` runs lint-staged (ESLint on staged files), `commit-msg` runs
  commitlint.

## Layout

- `action.yml`: inputs (`token`, `cassette_repo`, `pr_number`), runtime and entry point
  (`dist/index.js`).
- `src/index.ts`: entry point, calls `run()`.
- `src/main.ts`: everything else: reading the pull request (from the event payload or through the
  API when `pr_number` is set), finding the merge target in the cassette repository, merging,
  commenting and the job summary.
- `tests/run.test.ts`: behavior tests with `@actions/core` and `@actions/github` mocked.
- `tests/main.test.ts` with `tests/payload.json`: reading a `pull_request` event payload.
- `dist/index.js` and `dist/index.js.map`: the committed bundle that GitHub runs. Never edit it by
  hand.
- `rollup.config.mjs`, `tsconfig.build.json`: bundle and build settings.

## Commands

| Command                      | What it does                                                |
| ---------------------------- | ----------------------------------------------------------- |
| `pnpm run build`             | Type check only (`tsc --noEmit`). It does not write `dist/` |
| `pnpm run package`           | Bundle `src/` into `dist/` with Rollup                      |
| `pnpm run lint` / `lint:fix` | ESLint over the repository                                  |
| `pnpm test` / `test:watch`   | Run the tests once / in watch mode                          |
| `pnpm run all`               | Type check, lint, package and test, as CI does              |

CI (`.github/workflows/ci.yml`) runs commitlint, `pnpm run all`, and a `test` job that runs the
action from the working tree (`uses: ./`) with dummy inputs. `Check dist/` rebuilds the bundle and
fails when the committed one differs.

## The committed `dist/`

GitHub runs `dist/index.js` straight from the tagged commit, so `dist/` is part of every change
that touches `src/` or a runtime dependency (`@actions/core`, `@actions/github`, the Octokit
types):

1. Run `pnpm run all`. It rebuilds `dist/`.
2. Commit the rebuilt `dist/` in the same commit as the change that caused it.

A dependency update that only touches dev tooling can still change the bundle (Rollup, its plugins,
TypeScript), so rebuild after those too.

## Conventions

- Commits follow Conventional Commits; the git hooks run commitlint and lint-staged. `feat` and
  `fix` commits end up in the generated changelog.
- Dependencies are pinned exactly (`saveExact: true`). Add them with `pnpm add -E`.
- A change to the action's interface updates `action.yml`, the inputs table and usage examples in
  `README.md`, and the tests together. A change to how it picks or merges the target updates the
  numbered description at the top of the README.

## Hard rules

Follow these in every change.

- **Never edit `dist/` by hand.** Rebuild it with `pnpm run package` (or `pnpm run all`) and commit
  it with the change that caused it.
- **Tests never reach GitHub.** Mock `@actions/github` and `@actions/core` as `tests/run.test.ts`
  does. Never put a real token in a test, a fixture or a workflow; the token belongs in the
  consumer's `cassette-merge` environment secret.
- **Fail loudly on anything but a clear "nothing to merge".** Only a 404 counts as a missing
  branch, and a merge that does not go through fails the job. Do not turn errors into silent
  skips; a skipped merge leaves the cassette repository behind without anyone noticing.
- **Do not break workflows that use the action silently.** Removing or renaming an input, or
  failing where the action used to succeed, is a major release (see Versioning).
- **Keep the runtime and Node in step.** `runs.using` in `action.yml` and `.nvmrc` name the same
  Node major.
- **Do not lower a check to make it pass.** No `eslint-disable`, `@ts-expect-error`, skipped tests
  or zizmor ignores, unless the commit explains why the check is wrong for this case.
- **Do not bypass the git hooks** (`--no-verify`).

## Verify before you finish

A change is done when the checks for it pass locally. Report which commands you ran and their
result; if you skipped one, say so and why.

| You changed                          | Run                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Anything                             | `pnpm run all` (type check, lint, package, test)                                                        |
| `src/`, `action.yml` or a dependency | `pnpm run all`, then check that `git status dist/` shows the rebuilt bundle and commit it               |
| Merge or comment behavior            | A test in `tests/run.test.ts` that fails without your change                                            |
| Inputs or setup                      | `action.yml`, the README inputs table and examples                                                      |
| `.github/workflows/`                 | `actionlint` and `GH_TOKEN=$(gh auth token) zizmor .github/workflows`; pin every action to a commit SHA |
| `README.md` or `AGENTS.md`           | `pnpm run lint` (Markdown is linted too)                                                                |

When a check fails, find the cause. Do not retry until it passes, and do not change a test to match
broken behavior.

## Git and pull requests

On top of the Conventions above, for agents:

- Branch names: `type/short-description` (`fix/branch-lookup-errors`), never an agent-tool prefix
  such as `claude/`.
- End every commit you create or amend with exactly one of each trailer, after a blank line:

  ```text
  LLM-Model: <provider>/<model-id>
  Harness: <harness-name> <version>
  ```

  Use the model selected in the current session, and the version of the harness process that runs
  you, not of a CLI on `PATH` (a desktop app ships its own copy). Walk up the parent processes
  (`ps -o pid=,ppid=,args= -p <pid>`) to the binary and ask it for `--version`. If you cannot
  verify either value, ask before committing.

- No AI `Co-Authored-By` trailers and no "generated with" lines in commits, pull requests or code.
- Do not push to `main`, merge pull requests, create or move tags, or run `pnpm run release` unless
  the maintainer asks for that specific step.

## Recording what you learn

Before you finish, ask whether you hit something the next person would trip over. If you did, first
try to make a tool catch it: a lint rule, a test or a CI check. Write it down only when no tool can,
short and with the fix or the reason, in this file and in the same pull request. Unfinished work
goes to the maintainer as a proposed GitHub issue, never as a to-do list in this file.

## Dependency updates

Renovate lists updates on the Dependency Dashboard issue and opens pull requests only on approval
(`.github/renovate.json5`).

**Prefer one batched update over approving Renovate pull requests one at a time.** Use the
dashboard as the checklist, and do a maintenance pass by hand when updates have piled up and before
a release. A batch is a single branch and pull request, so the lockfile and `dist/` are rebuilt
once and CI and review run once. Renovate notices the merged versions and clears those dashboard
entries by itself. Tick a single dashboard box only for an update that cannot wait, such as a fix
for a security advisory.

### Policy

- **7-day release-age cooldown** in both `.github/renovate.json5` and `pnpm-workspace.yaml`.
  `@rotki/eslint-config` and `@rotki/eslint-plugin` are excluded.
- **Node and pnpm follow the runtime.** `@types/node` and `node` stay on 24.x and pnpm on 12.x.
  Moving to a new Node major also changes `runs.using` in `action.yml`, which is a major release.
- **TypeScript stays below 7.** typescript-eslint and `@rollup/plugin-typescript` need the
  TypeScript 6 JavaScript API. Renovate enforces this.
- **Overrides:** `pnpm-workspace.yaml` overrides `katex` (under `micromark-extension-math`) and
  `tinypool` (under `oxfmt`) for security advisories. Both come in through `@rotki/eslint-config`.
  Check on each pass whether the parents have caught up, and remove an override once they have.
- **`@actions/github` and its Octokit types** change the API surface the action uses. Read their
  changelogs, run the tests, and read the `dist/` diff.
- GitHub Actions are pinned by commit SHA with the version in a trailing comment.

### Procedure

1. Start from an up to date `main` on a branch such as `chore/deps-update`.
2. Gather the state: `pnpm audit`, `pnpm outdated`, and the dashboard
   (`gh issue list -R rotki/action-cassette-deck --search "Dependency Dashboard in:title"`).
3. Check publish dates (`npm view <package> "time[<version>]"`) and skip anything younger than 7
   days.
4. Bump with `pnpm add -E` (runtime) and `pnpm add -D -E` (dev), keeping both `@commitlint/*`
   packages on the same version. Update pnpm with `corepack use pnpm@<version>` and action pins
   with `gh api repos/<owner>/<repo>/commits/<tag> -q .sha`.
5. Refresh vulnerable transitive packages with `pnpm update --depth Infinity <package> ...`, and
   trace what remains with `pnpm why`.
6. Run `pnpm run all` and commit the rebuilt `dist/`.
7. Commit in parts: `ci: update github actions` for workflow pins, and `chore(deps): update
dependencies` (or `fix(deps):` for a runtime dependency) for the rest, with `dist/`.

## Workflow changes

Check any change under `.github/workflows/`, including pin bumps, with both tools:

- [actionlint](https://github.com/rhysd/actionlint) checks that workflows are valid: syntax,
  expressions, references, action inputs, and `run:` scripts through shellcheck. Run `actionlint`
  from the repository root.
- [zizmor](https://docs.zizmor.sh/) checks workflow security. Run it with a token so the online
  audits (impostor commits, pin and comment mismatches, known-vulnerable actions) run too:

  ```sh
  GH_TOKEN=$(gh auth token) zizmor .github/workflows
  ```

The current baseline is no actionlint findings and one low zizmor finding, `self-repository`, on
`uses: ./` in the `test` job of `ci.yml`. Running the action from the working tree is the point of
that job, so the finding is expected. A change must not add findings beyond this baseline. Keep the
existing patterns: `permissions: {}` at the top level with per-job grants,
`persist-credentials: false` on checkout, SHA pins with a version comment, and expressions that
carry outside input passed to `run:` through `env:`.

## Releasing

A release is a version tag plus the moving major tag. Pushing a `v*.*` tag runs
`.github/workflows/release.yml`, which only creates the GitHub release with `changelogithub`. It
names the previous `vX.Y.Z` tag itself, so a major tag already on the release commit cannot confuse
it. Nothing is published to npm (the package is private).

1. Make sure `main` is green, contains everything for the release, and that the committed `dist/`
   is current.
2. Pick the version (see Versioning) and run `pnpm run release` (`bumpp --no-push`). It bumps
   `package.json`, commits `chore: release vX.Y.Z` and tags it locally.
3. Push the commit and the tag:

   ```sh
   git push origin main --follow-tags
   ```

4. Move the major tag to the same commit, so `@vN` users get the release:

   ```sh
   git tag -f vN vX.Y.Z
   git push -f origin vN
   ```

   This force-pushes a tag. Only ever move the major tag of the release line you just published,
   and only forward. Never move it across a major version.

5. Verify: `gh release view vX.Y.Z -R rotki/action-cassette-deck`, and that `vN` and `vX.Y.Z`
   point at the same commit (`git rev-list -n1 vN` and `git rev-list -n1 vX.Y.Z`).

   If the release is missing, read the `release` run's log and fix the cause. To publish the
   notes for a tag that is already pushed, run `changelogithub` yourself with the previous release
   and the repository named, since `origin` can be a fork. For example:

   ```sh
   GITHUB_TOKEN=$(gh auth token) npx changelogithub@14.0.0 --github rotki/action-cassette-deck \
     --from v4.2.1 --to v4.2.2
   ```

6. Update the consumer: change the `rotki/action-cassette-deck@<sha> # vX.Y.Z` reference in
   `rotki/rotki`'s `.github/workflows/rotki_cassette_merge.yml` to the new commit and version
   (Renovate in that repository may propose it).

### Versioning

Semantic versioning, applied to what workflows that use the action see:

- **Patch:** bug fixes and dependency updates that do not change behavior.
- **Minor:** new optional inputs, new supported triggers, and better reporting.
- **Major:** removed or renamed inputs, a changed merge rule that existing workflows notice (for
  example failing where it used to succeed), and a new Node runtime in `action.yml`. A major starts
  a new `vN` tag; the previous one stays where it is.

## Repository settings

These live in GitHub, not in the repository. Keep this list current when they change.

- `main` is protected: 1 approving review, and the `commit-lint`, `check-dist`, `build`, `test`
  and `Analyze` checks must pass. `Check dist/` skips changes that only touch Markdown, so a
  Markdown-only pull request waits for `check-dist` until an admin merges it.
- `CODEOWNERS` assigns everything to `@rotki/maintainers`, which has write access.
- The release workflow uses only the built-in `GITHUB_TOKEN`. There are no environments or
  repository secrets.

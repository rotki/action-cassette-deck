# action-cassette-deck

Keeps a second repository in step with the main one by merging its matching PRs.

When a PR is merged in the main repository, the action looks in the cassette repository for
work on the same branch:

1. An open PR from the same author and branch, targeting the same base branch, gets merged.
2. Otherwise, a branch with the same name gets merged into the base branch and then deleted.
   A protected branch is a base branch, not cassette work, so it is skipped without failing
   the job.
3. If neither exists, there is nothing to merge. Only a 404 counts as a missing branch: any
   other error while looking it up (permissions, rate limits, outages) fails the job.

It then comments on the original PR with the result, and fails the job if the merge did not
go through, including when the merge request itself errors (for example a conflict).

## Inputs

| Input           | Required | Description                                                                                          |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `token`         | yes      | Token used to merge in the cassette repository and comment on the main repository.                   |
| `cassette_repo` | yes      | Name of the cassette repository. It must have the same owner as the repository running the action.   |
| `pr_number`     | no       | Number of the merged PR in the main repository. Set it when the workflow does not run on a PR event. |

## Setup

### Creating the merge token

Pick the account that should merge PRs in the cassette repository and comment on the main
one. Merges and comments will show up under this account.

1. In the account `Settings`, open `Developer settings` > `Personal access tokens` >
   `Fine-grained tokens` and press `Generate new token`.
2. Pick an expiration. GitHub and your organization's policy limit how long it can be.
3. Set the resource owner to the user or organization that owns both repositories.
4. Under `Repository access`, select only the main and the cassette repository.
5. Under `Permissions`, give `Read and write` access to `Contents` and `Pull requests`.
   The action needs nothing else.
6. Generate the token and copy it.

### Setting up the environment

1. In the repository running the action, open `Settings` > `Environments` and add an
   environment named `cassette-merge`.
2. Add an environment secret named `MERGE_TOKEN` with the token as its value.

Keeping the secret in an environment exposes it only to the job that uses that environment.

## Usage

### Triggering on push

Fork pull requests do not get repository secrets, so the action needs a trigger that runs
with access to `MERGE_TOKEN`. Run it on pushes to the branches PRs merge into, find the PR
that the pushed commit merged, and pass its number as `pr_number`.

```yaml
name: Cassette Merge

on:
  push:
    branches: [develop, bugfixes, master]

permissions: {}

jobs:
  merge:
    runs-on: ubuntu-latest
    environment: cassette-merge
    permissions:
      contents: read
      pull-requests: read
    steps:
      - name: Find the merged PR
        id: pr
        run: |
          number=$(gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls" \
            --jq '[.[] | select(.merged_at != null)][0].number // empty')
          echo "number=${number}" >> "$GITHUB_OUTPUT"
        env:
          GH_TOKEN: ${{ github.token }}

      - if: steps.pr.outputs.number != ''
        uses: rotki/action-cassette-deck@v4
        with:
          token: ${{ secrets.MERGE_TOKEN }}
          cassette_repo: test-caching
          pr_number: ${{ steps.pr.outputs.number }}
```

### Triggering on pull_request_target

Without `pr_number` the action reads the PR from the event payload, so trigger it only on
closed pull requests.

> Note: from 2026-11-02 GitHub blocks `pull_request_target` on public repositories unless
> the repository's Actions event policy allows it. Prefer the push trigger above.

```yaml
name: Cassette Merge

on:
  pull_request_target:
    types: [closed]

jobs:
  merge:
    runs-on: ubuntu-latest
    environment: cassette-merge
    steps:
      - uses: rotki/action-cassette-deck@v4
        with:
          token: ${{ secrets.MERGE_TOKEN }}
          cassette_repo: test-caching
```

## License

[AGPL-3.0](./LICENSE.md) License &copy; 2023- [Rotki Solutions GmbH](https://github.com/rotki)

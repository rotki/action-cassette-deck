# action-cassette-deck

Used to automatically merge PRs in a second repository

## Usage

### Basic

#### Preparing the merge token

Use an account that will be responsible for merging the PRs on the second repo and commenting
PRs on successful merge.

This account will appear as the one that performing the merges.

Go to the account `Settings` and then select `Developer Settings`.
There you will find the `Personal access tokens`. Expand and select the `Fine-grained tokens`.
Press `Generate new token` to create a new token for usage with the action.

For the duration you can select whatever you want but the max you can set is 2 years.
As the owner select the user or organization that owns the repos in question.
Then go to the repository section and select only the two repos that will be used.

After selecting the repositories, go to permissions and make sure to give `read/write` access
for `pull-requests` and `content` for the two repos. These are the only permissions needed
for the action to work.

Finish creating the new personal token and copy the token.

#### Setting up the environment

Then in the repo running the action go to `Settings`/`Environment`,
and add a new environment named `cassette-merge`.

Once the environment is created add a new `Secret` named `MERGE_TOKEN`. As a value
paste the fine-grained personal access token you created before and save.

The environment usage is encouraged so that the secret is only exposed to this job specifically.

#### Triggering on push

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

#### Triggering on pull_request_target

Without `pr_number` the action reads the PR from the `pull_request` event payload.
It should only trigger on pull request closed events.

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

[AGPL-3.0](./LICENSE) License &copy; 2023- [Rotki Solutions GmbH](https://github.com/rotki)

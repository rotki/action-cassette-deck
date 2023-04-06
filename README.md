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

```yaml

name: Cassette Merge

# only trigger on pull request closed events
on:
  pull_request_target:
    types: [ closed ]
    
jobs:
  merge:
    runs-on: ubuntu-latest
    environment: cassette-merge
    steps:
      - uses: rotki/action-cassette-deck@v1
        with:
          token: ${{ secrets.MERGE_TOKEN }}
          cassette_repo: test-caching

```


## License

[AGPL-3.0](./LICENSE) License &copy; 2023- [Rotki Solutions GmbH](https://github.com/rotki)
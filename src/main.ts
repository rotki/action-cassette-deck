import * as github from '@actions/github';
import { error, getInput, info, setFailed } from '@actions/core';
import { type PullRequest } from '@octokit/webhooks-definitions/schema';

async function run(): Promise<void> {
  try {
    const githubToken: string = getInput('token', { required: true });
    const repo: string = getInput('cassette_repo', { required: true });

    const octokit = github.getOctokit(githubToken);
    const { context } = github;

    if (!context.payload.pull_request) {
      info(`Didn't detect a PR`);
      return;
    }

    const pr = context.payload.pull_request as PullRequest;
    if (!pr.merged) {
      info(`PR #${pr.number} was not merged`);
      return;
    }

    const headRef = pr.head.ref;
    const owner = context.repo.owner;

    const matchingPrs = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${headRef}`,
    });

    info('2');

    if (!matchingPrs || matchingPrs.data.length === 0) {
      info(`No open matching PRs found for ${headRef}`);
      return;
    }

    const cassettePr = matchingPrs.data[0];
    const prLink = `${owner}/${repo}#${cassettePr.number}`;

    info(`found ${prLink} with head ref: ${headRef} preparing to merge`);

    const mergeResult = await octokit.rest.pulls.merge({
      owner,
      repo,
      // eslint-disable-next-line camelcase
      pull_number: cassettePr.number,
    });

    if (mergeResult.data.merged) {
      const body = `${prLink} was successfully merged`;
      info(body);
      await octokit.rest.issues.createComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        issue_number: pr.number,
        body,
      });
    } else {
      const body = `Could not merge ${owner}/${repo}#${cassettePr.number} automatically`;
      setFailed(body);
      error(body);
      await octokit.rest.issues.createComment({
        owner,
        repo,
        // eslint-disable-next-line camelcase
        issue_number: pr.number,
        body,
      });
      return;
    }
  } catch (e) {
    if (e instanceof Error) {
      setFailed(e.message);
      error(e.message);
    }

    console.error(e);
  }
}

run();

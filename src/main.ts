import * as github from '@actions/github';
import {
  debug,
  error,
  getInput,
  info,
  setFailed,
  summary,
} from '@actions/core';
import type { PullRequest } from '@octokit/webhooks-types/schema';
import type { GitHub } from '@actions/github/lib/utils';

interface MergeStatus {
  identifier: string;
  merged: boolean;
}

interface Repo {
  owner: string;
  repo: string;
}

interface Message extends Repo {
  number: number;
  body: string;
}

type Octokit = InstanceType<typeof GitHub>;

async function writeSummary(message: string, failure = false): Promise<void> {
  if (failure)
    setFailed(message);
  else
    info(message);

  await summary.addHeading('Status').addRaw(message).write();
}

async function createComment(octokit: Octokit, message: Message): Promise<void> {
  const { number, ...repo } = message;
  await octokit.rest.issues.createComment({
    ...repo,

    issue_number: number,
  });
}

async function mergePr(octokit: Octokit, { owner, repo }: Repo, prNumber: number): Promise<MergeStatus> {
  const identifier = `${owner}/${repo}#${prNumber}`;

  info(`found ${identifier}, preparing to merge`);

  const mergeResult = await octokit.rest.pulls.merge({
    owner,

    pull_number: prNumber,
    repo,
  });

  const merged = mergeResult.data.merged;
  return { identifier, merged };
}

async function mergeBranch(octokit: Octokit, { owner, repo }: Repo, base: string, branch: string): Promise<MergeStatus> {
  const identifier = `${owner}/${repo}/tree/${branch}`;

  info(`found ${identifier}, preparing to merge`);

  await octokit.rest.repos.merge({
    base,
    head: branch,
    owner,
    repo,
  });

  const ref = `heads/${branch}`;

  info(`branch ${ref} was merged successfully, preparing to delete`);

  await octokit.rest.git.deleteRef({
    owner,
    ref,
    repo,
  });

  return { identifier, merged: true };
}

async function run(): Promise<void> {
  try {
    const githubToken: string = getInput('token', { required: true });
    const repo: string = getInput('cassette_repo', { required: true });

    const octokit = github.getOctokit(githubToken);
    const { context } = github;
    const mainRepo = context.repo;
    const cassetteRepo = { ...mainRepo, repo };

    if (!context.payload.pull_request) {
      await writeSummary(`Didn't detect a PR`);
      return;
    }

    const pr = context.payload.pull_request as PullRequest;

    if (!pr.merged) {
      await writeSummary(`PR #${pr.number} was not merged`);
      return;
    }

    const prBranch = pr.head.ref;
    const prBaseBranch = pr.base.ref;

    const matchingPrs = await octokit.rest.pulls.list({
      ...cassetteRepo,
      base: prBaseBranch,
      head: `${pr.user.login}:${prBranch}`,
      state: 'open',
    });

    let branchFound = false;
    try {
      const targetBranch = await octokit.rest.repos.getBranch({
        ...cassetteRepo,
        branch: prBranch,
      });

      if (targetBranch.data.protected) {
        await writeSummary(`branch ${prBranch} is protected, bailing`, true);
        return;
      }

      branchFound = true;
    }
    catch (error_) {
      if (error_ instanceof Error)
        debug(error_.message);
    }

    let identifier = '';
    let merged = false;

    if (matchingPrs && matchingPrs.data.length > 0) {
      ({ identifier, merged } = await mergePr(
        octokit,
        cassetteRepo,
        matchingPrs.data[0].number,
      ));
    }
    else if (branchFound) {
      ({ identifier, merged } = await mergeBranch(
        octokit,
        cassetteRepo,
        prBaseBranch,
        prBranch,
      ));
    }
    else {
      await writeSummary(`No open matching PRs/branches found for ${prBranch}`);
      return;
    }

    const message: Message = {
      ...mainRepo,
      body: merged
        ? `${identifier} was successfully merged`
        : `Could not merge ${identifier} automatically`,
      number: pr.number,
    };

    await createComment(octokit, message);
    await summary.addHeading('Status').addRaw(message.body).write();

    if (merged) {
      info(message.body);
    }
    else {
      error(message.body);
      setFailed(message.body);
    }
  }
  catch (error_) {
    if (error_ instanceof Error) {
      setFailed(error_.message);
      error(error_.message);
    }

    console.error(error_);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises,unicorn/prefer-top-level-await
run();

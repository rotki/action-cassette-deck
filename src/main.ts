import type { GitHub } from '@actions/github/lib/utils';
import type { components } from '@octokit/openapi-webhooks-types';
import {
  debug,
  error,
  getInput,
  info,
  setFailed,
  summary,
} from '@actions/core';
import * as github from '@actions/github';

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

type PullRequest = components['schemas']['pull-request-webhook'];

interface PullRequestInfo {
  base: { ref: string };
  head: { ref: string };
  merged: boolean | null;
  number: number;
  user: { login: string } | null;
}

type BranchStatus = 'found' | 'missing' | 'protected';

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

async function getBranchStatus(octokit: Octokit, repo: Repo, branch: string): Promise<BranchStatus> {
  try {
    const targetBranch = await octokit.rest.repos.getBranch({
      ...repo,
      branch,
    });

    return targetBranch.data.protected ? 'protected' : 'found';
  }
  catch (error_) {
    if (error_ instanceof Error)
      debug(error_.message);

    return 'missing';
  }
}

async function getPullRequest(octokit: Octokit, repo: Repo): Promise<PullRequestInfo | undefined> {
  const prNumber = getInput('pr_number');

  if (prNumber) {
    if (!/^\d+$/.test(prNumber))
      throw new Error(`pr_number must be a pull request number, got '${prNumber}'`);

    const { data } = await octokit.rest.pulls.get({
      ...repo,
      pull_number: Number(prNumber),
    });
    return data;
  }

  const { pull_request: payload } = github.context.payload;
  if (!payload) {
    await writeSummary(`Didn't detect a PR`);
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub Actions context lacks strong typing
  const pr = payload as PullRequest;
  return pr;
}

function getAuthor(pr: PullRequestInfo): string {
  if (!pr.user)
    throw new Error(`PR #${pr.number} has no author`);

  return pr.user.login;
}

export async function run(): Promise<void> {
  try {
    const githubToken: string = getInput('token', { required: true });
    const repo: string = getInput('cassette_repo', { required: true });

    const octokit = github.getOctokit(githubToken);
    const { context } = github;
    const mainRepo = context.repo;
    const cassetteRepo = { ...mainRepo, repo };

    const pr = await getPullRequest(octokit, mainRepo);
    if (!pr)
      return;

    if (!pr.merged) {
      await writeSummary(`PR #${pr.number} was not merged`);
      return;
    }

    const author = getAuthor(pr);
    const prBranch = pr.head.ref;
    const prBaseBranch = pr.base.ref;

    const matchingPrs = await octokit.rest.pulls.list({
      ...cassetteRepo,
      base: prBaseBranch,
      head: `${author}:${prBranch}`,
      state: 'open',
    });

    const branchStatus = await getBranchStatus(octokit, cassetteRepo, prBranch);

    if (branchStatus === 'protected') {
      await writeSummary(`branch ${prBranch} is protected, bailing`, true);
      return;
    }

    let identifier = '';
    let merged = false;

    if (matchingPrs.data.length > 0) {
      ({ identifier, merged } = await mergePr(
        octokit,
        cassetteRepo,
        matchingPrs.data[0].number,
      ));
    }
    else if (branchStatus === 'found') {
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

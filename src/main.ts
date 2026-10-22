import type { GitHub } from '@actions/github/lib/utils';
import type { components } from '@octokit/openapi-webhooks-types';
import {
  debug,
  error,
  getInput,
  info,
  setFailed,
  summary,
  warning,
} from '@actions/core';
import * as github from '@actions/github';

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

interface MergeTarget {
  identifier: string;
  merge: () => Promise<boolean>;
}

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

function getErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error))
    return String(cause);

  // Octokit's RequestError carries the HTTP status separately from the message.
  if ('status' in cause && typeof cause.status === 'number')
    return `${cause.message} (HTTP ${cause.status})`;

  return cause.message;
}

async function mergePr(octokit: Octokit, { owner, repo }: Repo, prNumber: number, identifier: string): Promise<boolean> {
  info(`found ${identifier}, preparing to merge`);

  const mergeResult = await octokit.rest.pulls.merge({
    owner,

    pull_number: prNumber,
    repo,
  });

  return mergeResult.data.merged;
}

async function mergeBranch(octokit: Octokit, { owner, repo }: Repo, base: string, branch: string, identifier: string): Promise<boolean> {
  info(`found ${identifier}, preparing to merge`);

  await octokit.rest.repos.merge({
    base,
    head: branch,
    owner,
    repo,
  });

  const ref = `heads/${branch}`;

  info(`branch ${ref} was merged successfully, preparing to delete`);

  // The merge already went through, so a failed delete only leaves the branch behind.
  try {
    await octokit.rest.git.deleteRef({
      owner,
      ref,
      repo,
    });
  }
  catch (error_) {
    warning(`${identifier} was merged but the branch could not be deleted: ${getErrorMessage(error_)}`);
  }

  return true;
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

async function findMergeTarget(octokit: Octokit, cassetteRepo: Repo, pr: PullRequestInfo): Promise<MergeTarget | undefined> {
  const author = getAuthor(pr);
  const prBranch = pr.head.ref;
  const prBaseBranch = pr.base.ref;
  const { owner, repo } = cassetteRepo;

  const matchingPrs = await octokit.rest.pulls.list({
    ...cassetteRepo,
    base: prBaseBranch,
    head: `${author}:${prBranch}`,
    state: 'open',
  });

  if (matchingPrs.data.length > 0) {
    const prNumber = matchingPrs.data[0].number;
    const identifier = `${owner}/${repo}#${prNumber}`;
    return { identifier, merge: async () => mergePr(octokit, cassetteRepo, prNumber, identifier) };
  }

  const branchStatus = await getBranchStatus(octokit, cassetteRepo, prBranch);

  // A protected branch is a base branch, never a cassette branch to merge and delete.
  if (branchStatus === 'protected') {
    await writeSummary(`branch ${prBranch} is protected, nothing to merge`);
    return undefined;
  }

  if (branchStatus === 'missing') {
    await writeSummary(`No open matching PRs/branches found for ${prBranch}`);
    return undefined;
  }

  const identifier = `${owner}/${repo}/tree/${prBranch}`;
  return { identifier, merge: async () => mergeBranch(octokit, cassetteRepo, prBaseBranch, prBranch, identifier) };
}

async function reportMergeFailure(octokit: Octokit, message: Message): Promise<void> {
  // Fail first so that a failing comment cannot mask the merge error.
  error(message.body);
  setFailed(message.body);

  try {
    await createComment(octokit, message);
  }
  catch (error_) {
    warning(`Could not comment on PR #${message.number}: ${getErrorMessage(error_)}`);
  }

  await summary.addHeading('Status').addRaw(message.body).write();
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

    const target = await findMergeTarget(octokit, cassetteRepo, pr);
    if (!target)
      return;

    const { identifier, merge } = target;

    let merged: boolean;
    try {
      merged = await merge();
    }
    catch (error_) {
      await reportMergeFailure(octokit, {
        ...mainRepo,
        body: `Could not merge ${identifier} automatically: ${getErrorMessage(error_)}`,
        number: pr.number,
      });
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

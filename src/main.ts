import * as github from '@actions/github';
import {
  debug,
  error,
  getInput,
  info,
  setFailed,
  summary,
} from '@actions/core';
import { type PullRequest } from '@octokit/webhooks-types/schema';
import { type GitHub } from '@actions/github/lib/utils';

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

const writeSummary = async (
  message: string,
  failure = false
): Promise<void> => {
  if (failure) {
    setFailed(message);
  } else {
    info(message);
  }

  await summary.addHeading('Status').addRaw(message).write();
};

const createComment = async (
  octokit: Octokit,
  message: Message
): Promise<void> => {
  const { number, ...repo } = message;
  await octokit.rest.issues.createComment({
    ...repo,
    // eslint-disable-next-line camelcase
    issue_number: number,
  });
};

const mergePr = async (
  octokit: Octokit,
  { repo, owner }: Repo,
  prNumber: number
): Promise<MergeStatus> => {
  const identifier = `${owner}/${repo}#${prNumber}`;

  info(`found ${identifier}, preparing to merge`);

  const mergeResult = await octokit.rest.pulls.merge({
    owner,
    repo,
    // eslint-disable-next-line camelcase
    pull_number: prNumber,
  });

  const merged = mergeResult.data.merged;
  return { identifier, merged };
};

const mergeBranch = async (
  octokit: Octokit,
  { repo, owner }: Repo,
  base: string,
  branch: string
): Promise<MergeStatus> => {
  const identifier = `${owner}/${repo}/tree/${branch}`;

  info(`found ${identifier}, preparing to merge`);

  await octokit.rest.repos.merge({
    owner,
    repo,
    base,
    head: branch,
  });

  const ref = `heads/${branch}`;

  info(`branch ${ref} was merged successfully, preparing to delete`);

  await octokit.rest.git.deleteRef({
    owner,
    repo,
    ref,
  });

  return { identifier, merged: true };
};

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
      state: 'open',
      head: `${mainRepo.owner}:${prBranch}`,
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
    } catch (e) {
      if (e instanceof Error) {
        debug(e.message);
      }
    }

    let identifier = '';
    let merged = false;

    if (matchingPrs && matchingPrs.data.length > 0) {
      ({ identifier, merged } = await mergePr(
        octokit,
        cassetteRepo,
        matchingPrs.data[0].number
      ));
    } else if (branchFound) {
      ({ identifier, merged } = await mergeBranch(
        octokit,
        cassetteRepo,
        prBaseBranch,
        prBranch
      ));
    } else {
      await writeSummary(`No open matching PRs/branches found for ${prBranch}`);
      return;
    }

    const message: Message = {
      ...mainRepo,
      number: pr.number,
      body: merged
        ? `${identifier} was successfully merged`
        : `Could not merge ${identifier} automatically`,
    };

    await createComment(octokit, message);
    await summary.addHeading('Status').addRaw(message.body).write();

    if (merged) {
      info(message.body);
    } else {
      error(message.body);
      setFailed(message.body);
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

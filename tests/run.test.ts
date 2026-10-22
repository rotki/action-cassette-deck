import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/main';

const mocks = vi.hoisted(() => {
  const summary = {
    addHeading: vi.fn(),
    addRaw: vi.fn(),
    write: vi.fn(),
  };
  summary.addHeading.mockReturnValue(summary);
  summary.addRaw.mockReturnValue(summary);

  const payload: Record<string, unknown> = {};
  const inputs: Record<string, string> = {};

  return {
    context: {
      payload,
      repo: { owner: 'test', repo: 'mr' },
    },
    inputs,
    octokit: {
      rest: {
        git: { deleteRef: vi.fn() },
        issues: { createComment: vi.fn() },
        pulls: { get: vi.fn(), list: vi.fn(), merge: vi.fn() },
        repos: { getBranch: vi.fn(), merge: vi.fn() },
      },
    },
    setFailed: vi.fn(),
    summary,
    warning: vi.fn(),
  };
});

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  getInput: (name: string): string => mocks.inputs[name] ?? '',
  info: vi.fn(),
  setFailed: mocks.setFailed,
  summary: mocks.summary,
  warning: mocks.warning,
}));

vi.mock('@actions/github', () => ({
  context: mocks.context,
  getOctokit: () => mocks.octokit,
}));

const { pulls } = mocks.octokit.rest;

describe('run with pr_number', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inputs = { cassette_repo: 'sr', token: 'github_token' };
    // A push event payload has no pull_request key.
    mocks.context.payload = { ref: 'refs/heads/develop' };
  });

  it('fetches the pull request through the API on push events', async () => {
    mocks.inputs.pr_number = '42';
    pulls.get.mockResolvedValue({
      data: {
        base: { ref: 'develop' },
        head: { ref: 'feature' },
        merged: true,
        number: 42,
        user: { login: 'contributor' },
      },
    });
    pulls.list.mockResolvedValue({ data: [{ number: 7 }] });
    pulls.merge.mockResolvedValue({ data: { merged: true } });
    mocks.octokit.rest.repos.getBranch.mockRejectedValue(new Error('Branch not found'));

    await run();

    expect(pulls.get).toHaveBeenCalledWith({ owner: 'test', pull_number: 42, repo: 'mr' });
    expect(pulls.list).toHaveBeenCalledWith({
      base: 'develop',
      head: 'contributor:feature',
      owner: 'test',
      repo: 'sr',
      state: 'open',
    });
    expect(pulls.merge).toHaveBeenCalledWith({ owner: 'test', pull_number: 7, repo: 'sr' });
    expect(mocks.octokit.rest.issues.createComment).toHaveBeenCalledWith({
      body: 'test/sr#7 was successfully merged',
      issue_number: 42,
      owner: 'test',
      repo: 'mr',
    });
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });

  it('fails on a pr_number that is not a number', async () => {
    mocks.inputs.pr_number = '42abc';

    await run();

    expect(pulls.get).not.toHaveBeenCalled();
    expect(mocks.setFailed).toHaveBeenCalledWith(`pr_number must be a pull request number, got '42abc'`);
  });

  it('fails when the pull request has no author', async () => {
    mocks.inputs.pr_number = '42';
    pulls.get.mockResolvedValue({
      data: {
        base: { ref: 'develop' },
        head: { ref: 'feature' },
        merged: true,
        number: 42,
        user: null,
      },
    });

    await run();

    expect(pulls.list).not.toHaveBeenCalled();
    expect(mocks.setFailed).toHaveBeenCalledWith('PR #42 has no author');
  });

  it('skips a push event without pr_number', async () => {
    await run();

    expect(pulls.get).not.toHaveBeenCalled();
    expect(mocks.summary.addRaw).toHaveBeenCalledWith(`Didn't detect a PR`);
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });
});

describe('run merging cassettes', () => {
  const { git, issues, repos } = mocks.octokit.rest;

  function requestError(message: string, status: number): Error {
    return Object.assign(new Error(message), { status });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inputs = { cassette_repo: 'sr', pr_number: '42', token: 'github_token' };
    mocks.context.payload = { ref: 'refs/heads/develop' };
    pulls.get.mockResolvedValue({
      data: {
        base: { ref: 'develop' },
        head: { ref: 'feature' },
        merged: true,
        number: 42,
        user: { login: 'contributor' },
      },
    });
    issues.createComment.mockResolvedValue({});
  });

  it('merges a matching PR without looking up a protected branch', async () => {
    pulls.list.mockResolvedValue({ data: [{ number: 7 }] });
    pulls.merge.mockResolvedValue({ data: { merged: true } });
    repos.getBranch.mockResolvedValue({ data: { protected: true } });

    await run();

    expect(pulls.merge).toHaveBeenCalledWith({ owner: 'test', pull_number: 7, repo: 'sr' });
    expect(repos.getBranch).not.toHaveBeenCalled();
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });

  it('skips a protected branch when no PR matches', async () => {
    pulls.list.mockResolvedValue({ data: [] });
    repos.getBranch.mockResolvedValue({ data: { protected: true } });

    await run();

    expect(repos.merge).not.toHaveBeenCalled();
    expect(git.deleteRef).not.toHaveBeenCalled();
    expect(mocks.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining('nothing to merge'));
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });

  it('comments on the PR when merging the cassette PR throws', async () => {
    pulls.list.mockResolvedValue({ data: [{ number: 7 }] });
    pulls.merge.mockRejectedValue(requestError('Pull Request is not mergeable', 405));

    await run();

    expect(issues.createComment).toHaveBeenCalledWith({
      body: expect.stringMatching(/^Could not merge test\/sr#7 automatically:/),
      issue_number: 42,
      owner: 'test',
      repo: 'mr',
    });
    expect(mocks.setFailed).toHaveBeenCalledWith(expect.stringContaining('Pull Request is not mergeable'));
  });

  it('comments on the PR when merging the cassette branch throws', async () => {
    pulls.list.mockResolvedValue({ data: [] });
    repos.getBranch.mockResolvedValue({ data: { protected: false } });
    repos.merge.mockRejectedValue(requestError('Merge conflict', 409));

    await run();

    expect(issues.createComment).toHaveBeenCalledWith({
      body: expect.stringMatching(/^Could not merge test\/sr\/tree\/feature automatically:/),
      issue_number: 42,
      owner: 'test',
      repo: 'mr',
    });
    expect(mocks.setFailed).toHaveBeenCalledWith(expect.stringContaining('Merge conflict'));
    expect(git.deleteRef).not.toHaveBeenCalled();
  });

  it('reports a merged branch that could not be deleted as merged', async () => {
    pulls.list.mockResolvedValue({ data: [] });
    repos.getBranch.mockResolvedValue({ data: { protected: false } });
    repos.merge.mockResolvedValue({ data: {} });
    git.deleteRef.mockRejectedValue(requestError('Reference does not exist', 422));

    await run();

    expect(issues.createComment).toHaveBeenCalledWith({
      body: 'test/sr/tree/feature was successfully merged',
      issue_number: 42,
      owner: 'test',
      repo: 'mr',
    });
    expect(mocks.warning).toHaveBeenCalledWith(expect.stringContaining('could not be deleted'));
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });

  it('still fails with the merge error when commenting throws', async () => {
    pulls.list.mockResolvedValue({ data: [{ number: 7 }] });
    pulls.merge.mockRejectedValue(requestError('Pull Request is not mergeable', 405));
    issues.createComment.mockRejectedValue(requestError('Resource not accessible by integration', 403));

    await run();

    expect(issues.createComment).toHaveBeenCalledOnce();
    expect(mocks.setFailed).toHaveBeenCalledWith(expect.stringContaining('Pull Request is not mergeable'));
    expect(mocks.setFailed).not.toHaveBeenCalledWith(expect.stringContaining('Resource not accessible'));
  });
});

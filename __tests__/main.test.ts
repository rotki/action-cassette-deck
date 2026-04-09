import * as cp from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import { describe, it } from 'vitest';

const org = 'test';
const repo = 'mr';
const cassetteRepo = 'sr';

function createTmpSummaryFile(): string {
  const summaryFile = path.join(
    os.tmpdir(),
    `summary_${randomBytes(16).toString('hex')}`,
  );
  fs.closeSync(fs.openSync(summaryFile, 'w'));
  return summaryFile;
}

describe('main', () => {
  // shows how the runner will run a javascript action with env / stdout protocol
  it('test runs', () => {
    const summaryFile = createTmpSummaryFile();
    process.env.INPUT_TOKEN = 'github_token';
    process.env.INPUT_CASSETTE_REPO = cassetteRepo;
    process.env.GITHUB_REPOSITORY = `${org}/${repo}`;
    process.env.GITHUB_EVENT_PATH = path.join(import.meta.dirname, 'payload.json');
    process.env.GITHUB_STEP_SUMMARY = summaryFile;

    const np = process.execPath;
    const ip = path.join(import.meta.dirname, '..', 'dist', 'index.js');
    const options: cp.ExecFileSyncOptions = {
      env: process.env,
    };
    // eslint-disable-next-line no-console
    console.log(cp.execFileSync(np, [ip], options).toString());
    fs.rmSync(summaryFile);
  });
});

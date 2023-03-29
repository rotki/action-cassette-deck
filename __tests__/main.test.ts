import * as process from 'node:process';
import * as cp from 'node:child_process';
import * as path from 'node:path';
import { test } from 'vitest';

const org = 'test';
const repo = 'mr';
const cassetteRepo = 'sr';

// shows how the runner will run a javascript action with env / stdout protocol
test('test runs', () => {
  process.env['INPUT_TOKEN'] = 'github_token';
  process.env['INPUT_CASSETTE_REPO'] = cassetteRepo;
  process.env['GITHUB_REPOSITORY'] = `${org}/${repo}`;
  process.env['GITHUB_EVENT_PATH'] = path.join(__dirname, 'payload.json');

  const np = process.execPath;
  const ip = path.join(__dirname, '..', 'lib', 'main.js');
  const options: cp.ExecFileSyncOptions = {
    env: process.env,
  };
  // eslint-disable-next-line no-console
  console.log(cp.execFileSync(np, [ip], options).toString());
});

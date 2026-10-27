import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'bin', 'docdrift.js');

function run(args, cwd) {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  env.NO_COLOR = '1';

  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

test('check works with default paths from the project folder', () => {
  const result = run(['check', '--no-color'], join(here, 'fixtures-check'));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /docdrift check: 3 code endpoints/);
  assert.match(result.stdout, /STALE \(documented, not in code\)/);
});

test('scan defaults to the current folder', () => {
  const result = run(['scan'], join(here, 'fixtures-check'));

  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).length, 3);
});

test('zero Spring endpoints print the hint and exit 2', () => {
  const result = run(
    ['check', 'test/fixtures-docs', '--no-color'],
    join(here, '..'),
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /No Spring REST endpoints found in "test\/fixtures-docs" - run docdrift/,
  );
  assert.match(
    result.stderr,
    /pass the path: docdrift check <codeDir> \[docsDir\]/,
  );
});